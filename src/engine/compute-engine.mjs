/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI COMPUTE ENGINE — Demand-side client for Nosana GPU marketplace
 * ═══════════════════════════════════════════════════════════════
 *
 * Bondli users submit inference jobs → Bondli backend orchestrates
 * payment (SOL→NOS swap via Jupiter) and job lifecycle via Nosana SDK/API.
 *
 * Flow:
 *   User pays SOL → Jupiter swap to NOS → Nosana job created →
 *   GPU node executes → Results returned via WS/poll → Bondli takes margin
 *
 * Supports:
 *   - Batch jobs (one-shot: score a token, run inference)
 *   - Persistent deployments (always-on inference endpoints)
 *   - User job tracking and cost accounting via Redis
 * ═══════════════════════════════════════════════════════════════
 */

import { Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import {
  nosanaClient,
  buildJobDefinition,
  buildBondliInferenceJob,
  NOSANA_MARKETS,
  NOS_MINT,
} from "./nosana-client.mjs";

// Jupiter API
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Bondli margin on compute jobs (15%)
const BONDLI_MARGIN = 0.15;

// NOS has 6 decimals
const NOS_DECIMALS = 6;

// Job status polling interval
const JOB_POLL_INTERVAL_MS = 10_000; // 10s

// Max concurrent job polls
const MAX_ACTIVE_POLLS = 20;

/**
 * Compute engine that manages user-facing GPU job submission and tracking.
 */
export class ComputeEngine {
  constructor({ redis, connection, broadcastWS, computeKeypair } = {}) {
    this.redis = redis;
    this.connection = connection;
    this.broadcastWS = broadcastWS || (() => {});
    this.enabled = nosanaClient.enabled;

    // Compute wallet — holds NOS for job payments
    // Use COMPUTE_WALLET_SECRET env or fall back to platform wallet
    this.computeKeypair = computeKeypair || this._loadComputeKeypair();

    // Active job polling
    this._activePolls = new Map(); // jobId → intervalId
  }

  _loadComputeKeypair() {
    const secret = process.env.COMPUTE_WALLET_SECRET;
    if (secret) {
      try {
        return Keypair.fromSecretKey(bs58.decode(secret));
      } catch {
        console.warn("[COMPUTE] Invalid COMPUTE_WALLET_SECRET");
      }
    }
    return null;
  }

  // ═══════════════════════════════════════
  // MARKETS — Available GPU tiers + pricing
  // ═══════════════════════════════════════

  getMarkets() {
    return Object.entries(NOSANA_MARKETS).map(([name, m]) => ({
      name,
      address: m.address,
      nosPerSec: m.nosPerSec,
      vram: m.vram,
      // Estimate cost in SOL per hour (rough, based on NOS price)
      estCostPerHourNOS: +(m.nosPerSec * 3600).toFixed(4),
    }));
  }

  // ═══════════════════════════════════════
  // SOL → NOS SWAP via Jupiter
  // ═══════════════════════════════════════

  /**
   * Get a quote for swapping SOL to NOS.
   * @param {number} solAmount - Amount of SOL to swap
   * @returns {{ nosAmount: number, quote: object, pricePerNOS: number }}
   */
  async getSwapQuote(solAmount) {
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    const params = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: NOS_MINT,
      amount: lamports.toString(),
      slippageBps: "100", // 1% slippage for utility swap
    });

    const res = await fetch(`${JUPITER_QUOTE}?${params}`);
    if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
    const quote = await res.json();

    const nosRaw = parseInt(quote.outAmount);
    const nosAmount = nosRaw / Math.pow(10, NOS_DECIMALS);
    const pricePerNOS = solAmount / nosAmount;

    return { nosAmount, nosRaw, quote, pricePerNOS };
  }

  /**
   * Execute SOL → NOS swap via Jupiter.
   * @param {Keypair} keypair - Wallet paying SOL
   * @param {object} quote - Jupiter quote response
   * @returns {{ sig: string, nosAmount: number }}
   */
  async executeSwap(keypair, quote) {
    if (!keypair) throw new Error("No compute keypair configured");

    const swapRes = await fetch(JUPITER_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: 5000, // minimal priority
      }),
    });

    const { swapTransaction } = await swapRes.json();
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    tx.sign([keypair]);

    const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.connection.confirmTransaction(sig, "confirmed");

    const nosAmount = parseInt(quote.outAmount) / Math.pow(10, NOS_DECIMALS);
    return { sig, nosAmount };
  }

  // ═══════════════════════════════════════
  // JOB SUBMISSION — User pays SOL, Bondli submits to Nosana
  // ═══════════════════════════════════════

  /**
   * Submit a compute job. Handles the full flow:
   *   1. Validate user + tier
   *   2. Estimate cost (NOS per sec × estimated duration)
   *   3. Swap SOL → NOS via Jupiter (if not using credits)
   *   4. Submit job to Nosana via API
   *   5. Track in Redis, push WS updates
   *
   * @param {object} opts
   * @param {string} opts.userId - User wallet pubkey
   * @param {string} opts.market - GPU market name (e.g., "RTX 4090")
   * @param {string} opts.image - Docker image
   * @param {string[]} [opts.cmd] - Container command
   * @param {number} [opts.port] - Port to expose
   * @param {string} [opts.healthPath] - Health check path
   * @param {object} [opts.variables] - Env variables
   * @param {number} [opts.timeout=3600] - Job timeout in seconds
   * @param {number} [opts.requiredVram] - Required VRAM in GB
   * @param {"batch"|"deploy"} [opts.type="batch"] - Job type
   * @returns {{ jobId, status, estimatedCost, market }}
   */
  async submitJob(opts) {
    if (!this.enabled) throw new Error("Nosana compute not configured");

    const {
      userId,
      market: marketName = "RTX 4090",
      image,
      cmd,
      port,
      healthPath,
      variables,
      timeout = 3600,
      requiredVram,
      type = "batch",
    } = opts;

    if (!image) throw new Error("Docker image required");
    if (!userId) throw new Error("userId required");

    // Resolve market
    const marketInfo = NOSANA_MARKETS[marketName];
    if (!marketInfo) throw new Error(`Unknown GPU market: ${marketName}`);

    // Estimate cost
    const nosPerSec = marketInfo.nosPerSec;
    const estimatedNOS = +(nosPerSec * timeout).toFixed(4);
    const estimatedNOSWithMargin = +(estimatedNOS * (1 + BONDLI_MARGIN)).toFixed(4);

    // Build job definition
    const jobDef = buildJobDefinition({
      image,
      cmd,
      gpu: true,
      port,
      healthPath,
      variables,
      requiredVram: requiredVram || marketInfo.vram,
    });

    // Submit to Nosana
    const result = await nosanaClient.createJob(jobDef, marketInfo.address, timeout);
    const jobId = result.jobId;

    // Track in Redis
    const jobRecord = {
      jobId,
      userId,
      market: marketName,
      marketAddress: marketInfo.address,
      image,
      type,
      status: "queued",
      estimatedNOS,
      estimatedNOSWithMargin,
      timeout,
      createdAt: Date.now(),
      completedAt: null,
      result: null,
    };

    if (this.redis) {
      await Promise.all([
        this.redis.set(`compute:job:${jobId}`, JSON.stringify(jobRecord), { EX: 86400 * 7 }), // 7 days
        this.redis.zAdd(`compute:user:${userId}:jobs`, { score: Date.now(), value: jobId }),
        this.redis.expire(`compute:user:${userId}:jobs`, 86400 * 30), // 30 days
      ]);
    }

    // Start polling for status updates
    this._pollJobStatus(jobId, userId);

    // Broadcast to user
    this.broadcastWS({
      event: "compute_job",
      data: { jobId, status: "queued", market: marketName, userId },
    });

    console.log(`[COMPUTE] Job submitted: ${jobId} (${marketName}, ${image}, est ${estimatedNOS} NOS)`);

    return {
      jobId,
      status: "queued",
      market: marketName,
      estimatedNOS,
      estimatedNOSWithMargin,
      timeout,
    };
  }

  /**
   * Submit a persistent deployment (always-on service).
   */
  async submitDeployment(opts) {
    if (!this.enabled) throw new Error("Nosana compute not configured");

    const {
      userId,
      name,
      market: marketName = "RTX 4090",
      image,
      cmd,
      port = 8080,
      healthPath = "/health",
      variables,
      replicas = 1,
      timeout = 3600,
    } = opts;

    if (!image) throw new Error("Docker image required");
    if (!name) throw new Error("Deployment name required");

    const marketInfo = NOSANA_MARKETS[marketName];
    if (!marketInfo) throw new Error(`Unknown GPU market: ${marketName}`);

    const jobDef = buildJobDefinition({
      image,
      cmd,
      gpu: true,
      port,
      healthPath,
      variables,
    });

    const result = await nosanaClient.createDeployment({
      name: `bondli-${userId.slice(0, 8)}-${name}`,
      jobDefinition: jobDef,
      market: marketInfo.address,
      timeout,
      replicas,
      strategy: "SCHEDULED",
      schedule: "0 * * * *", // hourly re-check
    });

    // Start the deployment
    await nosanaClient.startDeployment(result.id);

    const deployRecord = {
      deploymentId: result.id,
      userId,
      name,
      market: marketName,
      image,
      replicas,
      status: "starting",
      createdAt: Date.now(),
    };

    if (this.redis) {
      await this.redis.set(`compute:deploy:${result.id}`, JSON.stringify(deployRecord), { EX: 86400 * 30 });
      await this.redis.zAdd(`compute:user:${userId}:deploys`, { score: Date.now(), value: result.id });
    }

    console.log(`[COMPUTE] Deployment created: ${result.id} (${name}, ${replicas} replicas)`);

    return {
      deploymentId: result.id,
      status: "starting",
      market: marketName,
      replicas,
    };
  }

  // ═══════════════════════════════════════
  // JOB STATUS + RESULTS
  // ═══════════════════════════════════════

  /**
   * Get job status from Nosana + local Redis record.
   */
  async getJobStatus(jobId) {
    let local = null;
    if (this.redis) {
      const raw = await this.redis.get(`compute:job:${jobId}`);
      if (raw) local = JSON.parse(raw);
    }

    // If job is already completed locally, return cached result
    if (local?.status === "completed" || local?.status === "failed") {
      return local;
    }

    // Fetch live status from Nosana
    try {
      const nosanaJob = await nosanaClient.getJob(jobId);
      const status = nosanaJob?.status || nosanaJob?.state || "unknown";

      if (local && this.redis) {
        local.status = status;
        if (status === "completed" || status === "finished") {
          local.status = "completed";
          local.completedAt = Date.now();
          local.result = nosanaJob.result || nosanaJob.output || null;
        }
        if (status === "failed" || status === "error") {
          local.status = "failed";
          local.completedAt = Date.now();
          local.result = nosanaJob.error || nosanaJob.result || null;
        }
        await this.redis.set(`compute:job:${jobId}`, JSON.stringify(local), { EX: 86400 * 7 });
      }

      return local || { jobId, status, ...nosanaJob };
    } catch (err) {
      return local || { jobId, status: "unknown", error: err.message };
    }
  }

  /**
   * Get user's job history.
   */
  async getUserJobs(userId, limit = 20) {
    if (!this.redis) return [];

    const jobIds = await this.redis.zRange(`compute:user:${userId}:jobs`, 0, limit - 1, { REV: true });
    if (!jobIds?.length) return [];

    const jobs = await Promise.all(
      jobIds.map(async (id) => {
        const raw = await this.redis.get(`compute:job:${id}`);
        return raw ? JSON.parse(raw) : { jobId: id, status: "unknown" };
      })
    );

    return jobs;
  }

  /**
   * Get user's deployments.
   */
  async getUserDeployments(userId, limit = 10) {
    if (!this.redis) return [];

    const deployIds = await this.redis.zRange(`compute:user:${userId}:deploys`, 0, limit - 1, { REV: true });
    if (!deployIds?.length) return [];

    const deploys = await Promise.all(
      deployIds.map(async (id) => {
        const raw = await this.redis.get(`compute:deploy:${id}`);
        return raw ? JSON.parse(raw) : { deploymentId: id, status: "unknown" };
      })
    );

    return deploys;
  }

  // ═══════════════════════════════════════
  // JOB STATUS POLLING — Push updates via WS
  // ═══════════════════════════════════════

  _pollJobStatus(jobId, userId) {
    if (this._activePolls.size >= MAX_ACTIVE_POLLS) return;
    if (this._activePolls.has(jobId)) return;

    let checks = 0;
    const maxChecks = 360; // 360 × 10s = 1 hour max

    const interval = setInterval(async () => {
      checks++;
      if (checks > maxChecks) {
        clearInterval(interval);
        this._activePolls.delete(jobId);
        return;
      }

      try {
        const job = await this.getJobStatus(jobId);
        const status = job?.status;

        // Broadcast status to frontend
        this.broadcastWS({
          event: "compute_job_update",
          data: { jobId, status, userId, result: job?.result },
        });

        // Stop polling on terminal states
        if (status === "completed" || status === "failed") {
          clearInterval(interval);
          this._activePolls.delete(jobId);
        }
      } catch {
        // Silently continue polling
      }
    }, JOB_POLL_INTERVAL_MS);

    this._activePolls.set(jobId, interval);
  }

  // ═══════════════════════════════════════
  // PRICE ESTIMATION
  // ═══════════════════════════════════════

  /**
   * Estimate job cost in SOL + NOS.
   */
  async estimateCost(marketName, durationSeconds = 3600) {
    const marketInfo = NOSANA_MARKETS[marketName];
    if (!marketInfo) return null;

    const nosNeeded = +(marketInfo.nosPerSec * durationSeconds).toFixed(4);
    const nosWithMargin = +(nosNeeded * (1 + BONDLI_MARGIN)).toFixed(4);

    // Try to get live SOL price for NOS
    let solEstimate = null;
    try {
      const swapQuote = await this.getSwapQuote(0.1); // quote for 0.1 SOL
      const nosPerSol = swapQuote.nosAmount / 0.1;
      solEstimate = +(nosWithMargin / nosPerSol).toFixed(6);
    } catch {
      // No swap quote available
    }

    return {
      market: marketName,
      vram: marketInfo.vram,
      nosPerSec: marketInfo.nosPerSec,
      durationSeconds,
      nosEstimate: nosNeeded,
      nosWithMargin,
      bondliMarginPct: BONDLI_MARGIN * 100,
      solEstimate,
    };
  }

  // ═══════════════════════════════════════
  // EXPRESS ROUTES
  // ═══════════════════════════════════════

  mountRoutes(app, { getUser, resolveTier, isOwnerWallet } = {}) {
    // GET /api/compute/markets — Available GPU tiers + pricing
    app.get("/api/compute/markets", async (_req, res) => {
      const markets = this.getMarkets();
      res.json({ markets, enabled: this.enabled });
    });

    // POST /api/compute/estimate — Estimate job cost
    app.post("/api/compute/estimate", async (req, res) => {
      const { market, duration } = req.body || {};
      if (!market) return res.status(400).json({ error: "market required" });
      try {
        const estimate = await this.estimateCost(market, duration || 3600);
        if (!estimate) return res.status(400).json({ error: "Unknown market" });
        res.json(estimate);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/compute/submit — Submit a compute job
    app.post("/api/compute/submit", async (req, res) => {
      const { wallet, market, image, cmd, port, healthPath, variables, timeout, requiredVram } = req.body || {};

      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!image) return res.status(400).json({ error: "image required" });

      // Auth: VIP/owner only for now
      if (getUser && resolveTier) {
        const userInfo = await getUser(wallet);
        const tier = resolveTier(wallet, userInfo._redisError ? {} : userInfo);
        const isPrivileged = (isOwnerWallet && isOwnerWallet(wallet)) || tier.tier === "vip" || userInfo?.whitelisted;
        if (!isPrivileged) {
          return res.status(403).json({ error: "VIP or owner access required for compute jobs" });
        }
      }

      try {
        const result = await this.submitJob({
          userId: wallet,
          market,
          image,
          cmd,
          port,
          healthPath,
          variables,
          timeout,
          requiredVram,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/compute/deploy — Create a persistent deployment
    app.post("/api/compute/deploy", async (req, res) => {
      const { wallet, name, market, image, cmd, port, healthPath, variables, replicas, timeout } = req.body || {};

      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!image) return res.status(400).json({ error: "image required" });
      if (!name) return res.status(400).json({ error: "name required" });

      // Auth: owner only for deployments
      if (isOwnerWallet && !isOwnerWallet(wallet)) {
        return res.status(403).json({ error: "Owner access required for deployments" });
      }

      try {
        const result = await this.submitDeployment({
          userId: wallet,
          name,
          market,
          image,
          cmd,
          port,
          healthPath,
          variables,
          replicas,
          timeout,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/compute/status/:jobId — Get job status
    app.get("/api/compute/status/:jobId", async (req, res) => {
      try {
        const job = await this.getJobStatus(req.params.jobId);
        res.json(job || { error: "Job not found" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/compute/jobs — Get user's job history
    app.get("/api/compute/jobs", async (req, res) => {
      const wallet = req.query.wallet;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      try {
        const jobs = await this.getUserJobs(wallet, parseInt(req.query.limit) || 20);
        res.json({ jobs });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/compute/deployments — Get user's deployments
    app.get("/api/compute/deployments", async (req, res) => {
      const wallet = req.query.wallet;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      try {
        const deploys = await this.getUserDeployments(wallet, parseInt(req.query.limit) || 10);
        res.json({ deployments: deploys });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/compute/swap-quote — Get SOL→NOS swap quote
    app.get("/api/compute/swap-quote", async (req, res) => {
      const sol = parseFloat(req.query.sol || "1");
      if (isNaN(sol) || sol <= 0) return res.status(400).json({ error: "Invalid SOL amount" });
      try {
        const quote = await this.getSwapQuote(sol);
        res.json({ sol, nosAmount: quote.nosAmount, pricePerNOS: quote.pricePerNOS });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/compute/summary — Overall compute engine stats
    app.get("/api/compute/summary", async (_req, res) => {
      res.json({
        enabled: this.enabled,
        activePolls: this._activePolls.size,
        marketsAvailable: Object.keys(NOSANA_MARKETS).length,
        nosanaConfigured: nosanaClient.enabled,
        computeWallet: this.computeKeypair?.publicKey?.toBase58()?.slice(0, 8) + "..." || null,
      });
    });

    console.log("[COMPUTE] Routes mounted: /api/compute/*");
  }

  // ═══════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════

  cleanup() {
    for (const [, interval] of this._activePolls) {
      clearInterval(interval);
    }
    this._activePolls.clear();
  }
}

export default ComputeEngine;
