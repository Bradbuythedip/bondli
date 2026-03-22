/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI GPU EARNINGS — 1 user = 1 GPU = 1 node = 1 keypair
 * ═══════════════════════════════════════════════════════════════
 *
 * Nosana constraint: 1 private key per GPU, 1 GPU per PC.
 * Each Bondli Pro/VIP user runs one Nosana node on their PC.
 * Bondli is an aggregation layer — easy setup, earnings tracking,
 * and AI job routing across the collective GPU fleet.
 *
 * Trust model (Option C — Bondli Custody Wallet):
 *   - Bondli generates a Solana keypair for each user's node
 *   - Nosana pays NOS directly to that keypair
 *   - Bondli holds the private key for fee sweeping
 *   - Hourly cron splits NOS: user share → user wallet, fee → treasury
 *   - All transfers are on-chain, verifiable on Solana explorer
 *
 * Security requirements (production):
 *   - Encrypt node private keys at rest (KMS/Vault, NOT plaintext Redis)
 *   - Rate-limit heartbeat endpoint separately (higher limit, IP-pinned)
 *   - Verify heartbeat sender IP matches registration IP
 *   - Add signature verification on earnings reports
 *   - Implement node key rotation mechanism
 *   - Monitor sweep failures with alerts
 *   - Audit log all keypair generation and fee distributions
 * ═══════════════════════════════════════════════════════════════
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  transfer,
} from "@solana/spl-token";
import bs58 from "bs58";

const NOS_MINT = new PublicKey("nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7");
const BONDLI_TREASURY = new PublicKey(
  process.env.PLATFORM_WALLET || "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx"
);

// Minimum sweep threshold: 1 NOS (NOS has 6 decimals)
const MIN_SWEEP_AMOUNT = 1_000_000;
// Sweep interval: 1 hour
const SWEEP_INTERVAL_MS = 3600 * 1000;
// Startup delay before first sweep
const SWEEP_STARTUP_DELAY_MS = 60_000;

/**
 * Mount GPU earnings routes onto an Express app.
 *
 * @param {import("express").Express} app
 * @param {object} deps - { redis, connection, getUser, saveUser, resolveTier, rateLimit }
 */
export function mountGpuRoutes(app, deps) {
  const { redis, connection, getUser, saveUser, resolveTier, rateLimit } = deps;

  // Rate limiter for GPU API endpoints
  const gpuLimiter = rateLimit
    ? rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "rl:gpu:", message: "GPU API rate limit exceeded" })
    : (_req, _res, next) => next();

  // Higher-rate limiter for heartbeat (1 per node per 60s, but allow some burst)
  const heartbeatLimiter = rateLimit
    ? rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "rl:gpu:hb:", message: "Heartbeat rate limit exceeded" })
    : (_req, _res, next) => next();

  // ── Helper: resolve wallet tier for GPU eligibility ──
  async function getWalletTier(wallet) {
    const user = await getUser(wallet);
    const tierInfo = resolveTier(wallet, user._redisError ? {} : user);
    return {
      isPro: tierInfo.tier === "pro" || tierInfo.tier === "vip",
      isVip: tierInfo.tier === "vip",
      tier: tierInfo.tier,
    };
  }

  // ═══════════════════════════════════════
  // POST /api/gpu/register — Generate keypair for user's node
  // ═══════════════════════════════════════
  app.post("/api/gpu/register", gpuLimiter, async (req, res) => {
    try {
      const { wallet, gpuModel } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!gpuModel) return res.status(400).json({ error: "gpuModel required" });

      if (!redis) return res.status(503).json({ error: "Service unavailable — Redis required" });

      // Verify Pro or VIP
      const tierInfo = await getWalletTier(wallet);
      if (!tierInfo.isPro && !tierInfo.isVip) {
        return res.status(403).json({ error: "Pro or VIP required to register a GPU node" });
      }

      // Enforce 1 node per user
      const existingNode = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (existingNode) {
        return res.status(409).json({
          error: "You already have a registered GPU node",
          nodeAddress: existingNode,
          hint: "1 GPU per user. To re-register, deregister first via POST /api/gpu/deregister",
        });
      }

      // Generate a new Solana keypair for this user's node
      const nodeKeypair = Keypair.generate();
      const nodeAddress = nodeKeypair.publicKey.toBase58();
      const nodeSecret = bs58.encode(nodeKeypair.secretKey);

      const platformFee = tierInfo.isVip ? 0.05 : 0.10;

      // Store node data
      await redis.hSet(`bondli:gpu:node:${nodeAddress}`, {
        wallet,
        gpuModel,
        tier: tierInfo.isVip ? "VIP" : "PRO",
        platformFee: platformFee.toString(),
        registeredAt: Date.now().toString(),
        status: "registered",
        totalEarningsNOS: "0",
        totalJobsCompleted: "0",
      });

      // Map user wallet → their single node (1:1 enforced)
      await redis.set(`bondli:gpu:user_node:${wallet}`, nodeAddress);

      // Store keypair (⚠️ ENCRYPT IN PRODUCTION with KMS — not plaintext Redis)
      await redis.set(`bondli:gpu:nodekey:${nodeAddress}`, nodeSecret);

      // Add to global fleet set
      await redis.sAdd("bondli:gpu:all_nodes", nodeAddress);

      // Return the keypair JSON for the agent to write to ~/.nosana/nosana_key.json
      const keypairJson = JSON.stringify(Array.from(nodeKeypair.secretKey));

      console.log(`[GPU] Registered node ${nodeAddress.slice(0, 8)}... for wallet ${wallet.slice(0, 8)}... (${gpuModel}, ${tierInfo.tier})`);

      res.json({
        success: true,
        nodeAddress,
        keypairJson,
        platformFee,
        message: "Your node keypair has been generated. The agent will configure it automatically.",
      });
    } catch (err) {
      console.error("[GPU] Register error:", err.message);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ═══════════════════════════════════════
  // POST /api/gpu/deregister — Remove node, allow re-registration
  // ═══════════════════════════════════════
  app.post("/api/gpu/deregister", gpuLimiter, async (req, res) => {
    try {
      const { wallet } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (!nodeAddress) {
        return res.status(404).json({ error: "No registered node found" });
      }

      // Sweep any remaining NOS balance to user first
      try {
        await sweepNodeBalance(redis, connection, nodeAddress, wallet);
      } catch (err) {
        console.warn(`[GPU] Sweep on deregister failed for ${nodeAddress}:`, err.message);
      }

      // Cleanup all Redis keys
      await redis.del(`bondli:gpu:node:${nodeAddress}`);
      await redis.del(`bondli:gpu:user_node:${wallet}`);
      await redis.del(`bondli:gpu:nodekey:${nodeAddress}`);
      await redis.sRem("bondli:gpu:all_nodes", nodeAddress);

      console.log(`[GPU] Deregistered node ${nodeAddress.slice(0, 8)}... for wallet ${wallet.slice(0, 8)}...`);

      res.json({ success: true, message: "Node deregistered. You can register a new GPU." });
    } catch (err) {
      console.error("[GPU] Deregister error:", err.message);
      res.status(500).json({ error: "Deregistration failed" });
    }
  });

  // ═══════════════════════════════════════
  // GET /api/gpu/dashboard — User sees their single node
  // ═══════════════════════════════════════
  app.get("/api/gpu/dashboard", gpuLimiter, async (req, res) => {
    try {
      const wallet = req.query.wallet;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);

      if (!nodeAddress) {
        return res.json({
          registered: false,
          message: "No GPU registered. Set up your node to start earning.",
        });
      }

      const nodeData = await redis.hGetAll(`bondli:gpu:node:${nodeAddress}`);
      const recentLogs = await redis.lRange(`bondli:gpu:earnings_log:${wallet}`, 0, 49);
      const logs = recentLogs.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      // Get current NOS balance of node wallet (on-chain check)
      let pendingNOS = 0;
      try {
        const nodeSecret = await redis.get(`bondli:gpu:nodekey:${nodeAddress}`);
        if (nodeSecret) {
          const keypair = Keypair.fromSecretKey(bs58.decode(nodeSecret));
          const ata = await getAssociatedTokenAddress(NOS_MINT, keypair.publicKey);
          const account = await getAccount(connection, ata);
          pendingNOS = Number(account.amount) / 1e6; // NOS has 6 decimals
        }
      } catch {
        // ATA might not exist yet or node has zero balance
      }

      res.json({
        registered: true,
        node: {
          address: nodeAddress,
          gpuModel: nodeData.gpuModel,
          tier: nodeData.tier,
          platformFee: parseFloat(nodeData.platformFee || "0.10"),
          status: nodeData.status || "offline",
          gpuUtil: nodeData.gpuUtil || "0",
          gpuTemp: nodeData.gpuTemp || "0",
          lastHeartbeat: nodeData.lastHeartbeat || null,
        },
        earnings: {
          totalNOS: parseFloat(nodeData.totalEarningsNOS || "0"),
          totalJobsCompleted: parseInt(nodeData.totalJobsCompleted || "0"),
          pendingNOS,
        },
        recentJobs: logs.slice(0, 20),
      });
    } catch (err) {
      console.error("[GPU] Dashboard error:", err.message);
      res.status(500).json({ error: "Dashboard unavailable" });
    }
  });

  // ═══════════════════════════════════════
  // POST /api/gpu/heartbeat — Agent pings every 60s
  // ═══════════════════════════════════════
  app.post("/api/gpu/heartbeat", heartbeatLimiter, async (req, res) => {
    try {
      const { nodeAddress, gpuUtil, gpuTemp, memUsed, memTotal, status } = req.body;
      if (!nodeAddress) return res.status(400).json({ error: "nodeAddress required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const exists = await redis.exists(`bondli:gpu:node:${nodeAddress}`);
      if (!exists) return res.status(404).json({ error: "Unknown node" });

      await redis.hSet(`bondli:gpu:node:${nodeAddress}`, {
        lastHeartbeat: Date.now().toString(),
        gpuUtil: String(gpuUtil || 0),
        gpuTemp: String(gpuTemp || 0),
        memUsed: String(memUsed || 0),
        memTotal: String(memTotal || 0),
        status: status || "idle",
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[GPU] Heartbeat error:", err.message);
      res.status(500).json({ error: "Heartbeat failed" });
    }
  });

  // ═══════════════════════════════════════
  // GET /api/gpu/fleet — Aggregate fleet view (all Bondli GPU nodes)
  // ═══════════════════════════════════════
  app.get("/api/gpu/fleet", gpuLimiter, async (req, res) => {
    try {
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const allNodes = await redis.sMembers("bondli:gpu:all_nodes");
      const totalFees = parseFloat((await redis.get("bondli:gpu:platform_fees_total")) || "0");

      const nodes = await Promise.all(
        allNodes.map(async (addr) => {
          const data = await redis.hGetAll(`bondli:gpu:node:${addr}`);
          const isOnline =
            data.lastHeartbeat &&
            Date.now() - parseInt(data.lastHeartbeat) < 300_000; // 5 min timeout
          return {
            nodeId: addr.slice(0, 4) + "..." + addr.slice(-4),
            gpuModel: data.gpuModel,
            tier: data.tier,
            status: isOnline ? data.status || "idle" : "offline",
            totalEarningsNOS: parseFloat(data.totalEarningsNOS || "0"),
            totalJobsCompleted: parseInt(data.totalJobsCompleted || "0"),
          };
        })
      );

      res.json({
        totalNodes: allNodes.length,
        onlineNodes: nodes.filter((n) => n.status !== "offline").length,
        totalPlatformFees: totalFees,
        nodes: nodes.sort((a, b) => b.totalEarningsNOS - a.totalEarningsNOS),
      });
    } catch (err) {
      console.error("[GPU] Fleet error:", err.message);
      res.status(500).json({ error: "Fleet data unavailable" });
    }
  });

  // ═══════════════════════════════════════
  // Fee Sweep Cron — runs every hour
  // ═══════════════════════════════════════
  async function sweepAllNodeFees() {
    if (!redis) return;

    const allNodes = await redis.sMembers("bondli:gpu:all_nodes");
    let swept = 0;
    let errors = 0;

    for (const nodeAddress of allNodes) {
      try {
        const didSweep = await sweepNodeBalance(redis, connection, nodeAddress);
        if (didSweep) swept++;
      } catch (err) {
        errors++;
        console.error(`[GPU SWEEP] Error for ${nodeAddress.slice(0, 8)}...:`, err.message);
      }
    }

    if (swept > 0 || errors > 0) {
      console.log(`[GPU SWEEP] Complete: ${swept} swept, ${errors} errors, ${allNodes.length} total nodes`);
    }
  }

  // Schedule sweep cron
  const sweepInterval = setInterval(sweepAllNodeFees, SWEEP_INTERVAL_MS);
  const sweepStartup = setTimeout(sweepAllNodeFees, SWEEP_STARTUP_DELAY_MS);

  console.log("[GPU] Earnings routes mounted — sweep cron: every 1h");

  // Return cleanup function (for graceful shutdown)
  return {
    cleanup: () => {
      clearInterval(sweepInterval);
      clearTimeout(sweepStartup);
    },
  };
}

/**
 * Sweep NOS balance from a node wallet — split between user and treasury.
 *
 * @param {object} redis - Redis client
 * @param {import("@solana/web3.js").Connection} connection - Solana connection
 * @param {string} nodeAddress - Node public key (base58)
 * @param {string} [overrideWallet] - Override user wallet (used during deregister)
 * @returns {boolean} Whether a sweep was executed
 */
async function sweepNodeBalance(redis, connection, nodeAddress, overrideWallet = null) {
  const nodeData = await redis.hGetAll(`bondli:gpu:node:${nodeAddress}`);
  const wallet = overrideWallet || nodeData.wallet;
  if (!wallet) return false;

  const platformFee = parseFloat(nodeData.platformFee || "0.10");

  // Get node keypair
  const nodeSecret = await redis.get(`bondli:gpu:nodekey:${nodeAddress}`);
  if (!nodeSecret) return false;
  const nodeKeypair = Keypair.fromSecretKey(bs58.decode(nodeSecret));

  // Check NOS balance
  const ata = await getAssociatedTokenAddress(NOS_MINT, nodeKeypair.publicKey);
  let balance;
  try {
    const account = await getAccount(connection, ata);
    balance = Number(account.amount); // raw amount (6 decimals)
  } catch {
    return false; // No ATA or zero balance
  }

  // Minimum sweep threshold
  if (balance < MIN_SWEEP_AMOUNT) return false;

  const feeAmount = Math.floor(balance * platformFee);
  const userAmount = balance - feeAmount;

  // Transfer user's share to their Bondli wallet
  const userWalletPubkey = new PublicKey(wallet);
  const userATA = await getAssociatedTokenAddress(NOS_MINT, userWalletPubkey);
  await transfer(
    connection,
    nodeKeypair,
    ata,
    userATA,
    nodeKeypair,
    userAmount
  );

  // Transfer Bondli's fee to treasury
  const treasuryATA = await getAssociatedTokenAddress(NOS_MINT, BONDLI_TREASURY);
  await transfer(
    connection,
    nodeKeypair,
    ata,
    treasuryATA,
    nodeKeypair,
    feeAmount
  );

  // Update tracking
  const nosEarned = balance / 1_000_000;
  await redis.hIncrByFloat(`bondli:gpu:node:${nodeAddress}`, "totalEarningsNOS", nosEarned);
  await redis.incrByFloat("bondli:gpu:platform_fees_total", feeAmount / 1_000_000);

  // Log earnings
  await redis.lPush(
    `bondli:gpu:earnings_log:${wallet}`,
    JSON.stringify({
      nodeAddress,
      totalNOS: nosEarned,
      userNOS: userAmount / 1_000_000,
      feeNOS: feeAmount / 1_000_000,
      timestamp: Date.now(),
    })
  );
  await redis.lTrim(`bondli:gpu:earnings_log:${wallet}`, 0, 999);

  console.log(
    `[GPU SWEEP] ${nodeAddress.slice(0, 8)}...: ${nosEarned.toFixed(4)} NOS → ${(userAmount / 1e6).toFixed(4)} user + ${(feeAmount / 1e6).toFixed(4)} fee`
  );

  return true;
}

export { sweepNodeBalance };
