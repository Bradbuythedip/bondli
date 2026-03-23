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

import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  transfer,
} from "@solana/spl-token";
import bs58 from "bs58";
import { resolveMarket } from "./nosana-client.mjs";

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

      // Resolve tier (GPU is free for everyone)
      const tierInfo = await getWalletTier(wallet);

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

      const platformFee = tierInfo.isVip ? 0.05 : 0.15;

      // Resolve GPU → Nosana market for node registration
      const market = resolveMarket(gpuModel);

      // Store node data
      await redis.hSet(`bondli:gpu:node:${nodeAddress}`, {
        wallet,
        gpuModel,
        tier: tierInfo.isVip ? "VIP" : "FREE",
        platformFee: platformFee.toString(),
        registeredAt: Date.now().toString(),
        status: "registered",
        totalEarningsNOS: "0",
        totalJobsCompleted: "0",
        nosanaMarket: market.address,
        nosanaMarketName: market.name,
        nosPerSec: market.nosPerSec.toString(),
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
        nosanaMarket: market.address,
        nosanaMarketName: market.name,
        nosPerSec: market.nosPerSec,
        spoofGpuName: market.spoofGpuName || "",
        message: "Your node keypair has been generated. The agent will configure it automatically.",
      });
    } catch (err) {
      console.error("[GPU] Register error:", err.message);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ═══════════════════════════════════════
  // POST /api/gpu/reconnect — Retrieve existing node keypair for re-setup
  // ═══════════════════════════════════════
  app.post("/api/gpu/reconnect", gpuLimiter, async (req, res) => {
    try {
      const { wallet, gpuModel } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (!nodeAddress) {
        return res.status(404).json({ error: "No registered node found", hint: "Register first" });
      }

      const nodeData = await redis.hGetAll(`bondli:gpu:node:${nodeAddress}`);
      const nodeSecret = await redis.get(`bondli:gpu:nodekey:${nodeAddress}`);
      if (!nodeSecret) {
        return res.status(500).json({ error: "Node keypair not found — please deregister and re-register" });
      }

      // Reconstruct keypair JSON for the agent
      const keypair = Keypair.fromSecretKey(bs58.decode(nodeSecret));
      const keypairJson = JSON.stringify(Array.from(keypair.secretKey));

      // Update GPU model if changed (e.g. user upgraded)
      if (gpuModel && gpuModel !== nodeData.gpuModel) {
        const market = resolveMarket(gpuModel);
        await redis.hSet(`bondli:gpu:node:${nodeAddress}`, {
          gpuModel,
          nosanaMarket: market.address,
          nosanaMarketName: market.name,
          nosPerSec: market.nosPerSec.toString(),
        });
      }

      const market = resolveMarket(gpuModel || nodeData.gpuModel);

      console.log(`[GPU] Reconnect node ${nodeAddress.slice(0, 8)}... for wallet ${wallet.slice(0, 8)}...`);

      res.json({
        success: true,
        reconnected: true,
        nodeAddress,
        keypairJson,
        platformFee: parseFloat(nodeData.platformFee || "0.15"),
        nosanaMarket: market.address,
        nosanaMarketName: market.name,
        nosPerSec: market.nosPerSec,
        spoofGpuName: market.spoofGpuName || "",
        message: "Reconnected to existing node. Your funded SOL balance is preserved.",
      });
    } catch (err) {
      console.error("[GPU] Reconnect error:", err.message);
      res.status(500).json({ error: "Reconnect failed" });
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
      let nosSwept = 0, solSwept = 0;
      try {
        await sweepNodeBalance(redis, connection, nodeAddress, wallet);
      } catch (err) {
        console.warn(`[GPU] NOS sweep on deregister failed for ${nodeAddress}:`, err.message);
      }

      // Sweep SOL back to user wallet
      try {
        solSwept = await sweepNodeSol(redis, connection, nodeAddress, wallet);
      } catch (err) {
        console.warn(`[GPU] SOL sweep on deregister failed for ${nodeAddress}:`, err.message);
      }

      // Cleanup all Redis keys
      await redis.del(`bondli:gpu:node:${nodeAddress}`);
      await redis.del(`bondli:gpu:user_node:${wallet}`);
      await redis.del(`bondli:gpu:nodekey:${nodeAddress}`);
      await redis.sRem("bondli:gpu:all_nodes", nodeAddress);

      console.log(`[GPU] Deregistered node ${nodeAddress.slice(0, 8)}... for wallet ${wallet.slice(0, 8)}... (swept ${solSwept.toFixed(6)} SOL)`);

      res.json({
        success: true,
        solSwept: solSwept > 0 ? solSwept : undefined,
        message: solSwept > 0
          ? `Node deregistered. ${solSwept.toFixed(6)} SOL swept back to your wallet.`
          : "Node deregistered. You can register a new GPU.",
      });
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

      // Fetch recent command log
      const cmdLogRaw = await redis.lRange(`bondli:gpu:cmd_log:${nodeAddress}`, 0, 9);
      const commandLog = cmdLogRaw.map(c => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean);

      // Check for command results (auto-expire commands older than 5 minutes)
      for (const cmd of commandLog) {
        const resultRaw = await redis.get(`bondli:gpu:cmd_result:${nodeAddress}:${cmd.id}`);
        if (resultRaw) {
          try { cmd.result = JSON.parse(resultRaw); } catch {}
        } else if (cmd.issuedAt && Date.now() - cmd.issuedAt > 300_000) {
          cmd.result = { status: "expired", output: "Command timed out" };
        }
      }

      const isOnline = nodeData.lastHeartbeat && Date.now() - parseInt(nodeData.lastHeartbeat) < 300_000;

      res.json({
        registered: true,
        node: {
          address: nodeAddress,
          gpuModel: nodeData.gpuModel,
          status: isOnline ? (nodeData.status || "idle") : "offline",
          gpuUtil: nodeData.gpuUtil || "0",
          gpuTemp: nodeData.gpuTemp || "0",
          powerDraw: nodeData.powerDraw || null,
          powerLimit: nodeData.powerLimit || null,
          fanSpeed: nodeData.fanSpeed || null,
          gpuClock: nodeData.gpuClock || null,
          memClock: nodeData.memClock || null,
          lastHeartbeat: nodeData.lastHeartbeat || null,
          nosanaMarket: nodeData.nosanaMarketName || null,
          nosPerSec: parseFloat(nodeData.nosPerSec || "0"),
        },
        earnings: {
          totalNOS: parseFloat(nodeData.totalEarningsNOS || "0"),
          totalJobsCompleted: parseInt(nodeData.totalJobsCompleted || "0"),
          pendingNOS,
        },
        recentJobs: logs.slice(0, 20),
        commandLog: commandLog.filter(c => !(c.result && c.result.status === "expired")),
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
      const { nodeAddress, gpuUtil, gpuTemp, memUsed, memTotal, status,
              powerDraw, powerLimit, fanSpeed, gpuClock, memClock,
              commandResults } = req.body;
      if (!nodeAddress) return res.status(400).json({ error: "nodeAddress required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const exists = await redis.exists(`bondli:gpu:node:${nodeAddress}`);
      if (!exists) return res.status(404).json({ error: "Unknown node" });

      // If agent sends "offline", set lastHeartbeat to 0 so dashboard shows offline immediately
      const isOfflineSignal = status === "offline";
      const updates = {
        lastHeartbeat: isOfflineSignal ? "0" : Date.now().toString(),
        gpuUtil: String(gpuUtil || 0),
        gpuTemp: String(gpuTemp || 0),
        memUsed: String(memUsed || 0),
        memTotal: String(memTotal || 0),
        status: isOfflineSignal ? "offline" : (status || "idle"),
      };
      // Extended GPU metrics
      if (powerDraw !== undefined) updates.powerDraw = String(powerDraw);
      if (powerLimit !== undefined) updates.powerLimit = String(powerLimit);
      if (fanSpeed !== undefined) updates.fanSpeed = String(fanSpeed);
      if (gpuClock !== undefined) updates.gpuClock = String(gpuClock);
      if (memClock !== undefined) updates.memClock = String(memClock);

      await redis.hSet(`bondli:gpu:node:${nodeAddress}`, updates);

      // Store command results from agent
      if (Array.isArray(commandResults)) {
        for (const result of commandResults) {
          if (!result.id) continue;
          await redis.set(
            `bondli:gpu:cmd_result:${nodeAddress}:${result.id}`,
            JSON.stringify(result),
            { EX: 3600 }
          );
          // Store logs if get_logs command
          if (result.type === "get_logs" && result.output) {
            const lines = result.output.split("\n").slice(-200);
            await redis.del(`bondli:gpu:node_logs:${nodeAddress}`);
            if (lines.length > 0) {
              await redis.lPush(`bondli:gpu:node_logs:${nodeAddress}`, lines.reverse());
              await redis.lTrim(`bondli:gpu:node_logs:${nodeAddress}`, 0, 199);
              await redis.expire(`bondli:gpu:node_logs:${nodeAddress}`, 3600);
            }
          }
        }
      }

      // Pop pending commands for this node
      const pendingRaw = await redis.lRange(`bondli:gpu:cmd_queue:${nodeAddress}`, 0, -1);
      if (pendingRaw.length > 0) {
        await redis.del(`bondli:gpu:cmd_queue:${nodeAddress}`);
      }
      const commands = pendingRaw.map(c => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean);

      res.json({ ok: true, commands });
    } catch (err) {
      console.error("[GPU] Heartbeat error:", err.message);
      res.status(500).json({ error: "Heartbeat failed" });
    }
  });

  // ═══════════════════════════════════════
  // POST /api/gpu/command — Send command to node via heartbeat relay
  // ═══════════════════════════════════════
  const ALLOWED_COMMANDS = ["stop_node", "restart_node", "get_logs", "set_power_limit", "get_gpu_details"];

  app.post("/api/gpu/command", gpuLimiter, async (req, res) => {
    try {
      const { wallet, command, params } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!command || !ALLOWED_COMMANDS.includes(command)) {
        return res.status(400).json({ error: `Invalid command. Allowed: ${ALLOWED_COMMANDS.join(", ")}` });
      }
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (!nodeAddress) return res.status(404).json({ error: "No registered node for this wallet" });

      // Validate power limit range
      if (command === "set_power_limit") {
        const pl = parseInt(params?.powerLimit);
        if (!pl || pl < 50 || pl > 500) {
          return res.status(400).json({ error: "powerLimit must be between 50 and 500 watts" });
        }
      }

      const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const cmdObj = { id: cmdId, type: command, params: params || {}, issuedAt: Date.now(), issuedBy: wallet };

      // Queue command for agent pickup on next heartbeat
      await redis.lPush(`bondli:gpu:cmd_queue:${nodeAddress}`, JSON.stringify(cmdObj));

      // Log command history (expires after 1 hour)
      await redis.lPush(`bondli:gpu:cmd_log:${nodeAddress}`, JSON.stringify(cmdObj));
      await redis.lTrim(`bondli:gpu:cmd_log:${nodeAddress}`, 0, 99);
      await redis.expire(`bondli:gpu:cmd_log:${nodeAddress}`, 3600);

      // Immediately update node status for stop/restart so dashboard reflects it
      if (command === "stop_node") {
        await redis.hSet(`bondli:gpu:node:${nodeAddress}`, { status: "stopping" });
      } else if (command === "restart_node") {
        await redis.hSet(`bondli:gpu:node:${nodeAddress}`, { status: "restarting" });
      }

      res.json({ success: true, cmdId, message: "Command queued — will execute on next heartbeat (~15s)" });
    } catch (err) {
      console.error("[GPU] Command error:", err.message);
      res.status(500).json({ error: "Command failed" });
    }
  });

  // ═══════════════════════════════════════
  // GET /api/gpu/command-status — Check result of a sent command
  // ═══════════════════════════════════════
  app.get("/api/gpu/command-status", gpuLimiter, async (req, res) => {
    try {
      const { wallet, cmdId } = req.query;
      if (!wallet || !cmdId) return res.status(400).json({ error: "wallet and cmdId required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (!nodeAddress) return res.status(404).json({ error: "No registered node" });

      const resultRaw = await redis.get(`bondli:gpu:cmd_result:${nodeAddress}:${cmdId}`);
      if (!resultRaw) return res.json({ status: "pending" });

      res.json(JSON.parse(resultRaw));
    } catch (err) {
      console.error("[GPU] Command-status error:", err.message);
      res.status(500).json({ error: "Status check failed" });
    }
  });

  // ═══════════════════════════════════════
  // GET /api/gpu/node-logs — Get recent Docker logs from node
  // ═══════════════════════════════════════
  app.get("/api/gpu/node-logs", gpuLimiter, async (req, res) => {
    try {
      const { wallet } = req.query;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
      if (!nodeAddress) return res.status(404).json({ error: "No registered node" });

      const logs = await redis.lRange(`bondli:gpu:node_logs:${nodeAddress}`, 0, 199);
      res.json({ logs });
    } catch (err) {
      console.error("[GPU] Node-logs error:", err.message);
      res.status(500).json({ error: "Logs unavailable" });
    }
  });

  // ═══════════════════════════════════════
  // POST /api/gpu/job-completed — Agent reports a completed Nosana job
  // ═══════════════════════════════════════
  app.post("/api/gpu/job-completed", heartbeatLimiter, async (req, res) => {
    try {
      const { nodeAddress, jobId, durationSec, nosEarned } = req.body;
      if (!nodeAddress) return res.status(400).json({ error: "nodeAddress required" });
      if (!redis) return res.status(503).json({ error: "Service unavailable" });

      const exists = await redis.exists(`bondli:gpu:node:${nodeAddress}`);
      if (!exists) return res.status(404).json({ error: "Unknown node" });

      // Increment job counter
      await redis.hIncrBy(`bondli:gpu:node:${nodeAddress}`, "totalJobsCompleted", 1);

      // Log the job
      const nodeData = await redis.hGetAll(`bondli:gpu:node:${nodeAddress}`);
      if (nodeData.wallet) {
        await redis.lPush(`bondli:gpu:earnings_log:${nodeData.wallet}`, JSON.stringify({
          type: "job_completed",
          nodeAddress,
          jobId: jobId || null,
          durationSec: durationSec || 0,
          nosEarned: nosEarned || 0,
          timestamp: Date.now(),
        }));
        await redis.lTrim(`bondli:gpu:earnings_log:${nodeData.wallet}`, 0, 999);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[GPU] Job-completed error:", err.message);
      res.status(500).json({ error: "Job tracking failed" });
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
            nosanaMarket: data.nosanaMarketName || null,
            nosPerSec: parseFloat(data.nosPerSec || "0"),
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

/**
 * Sweep native SOL balance from a node wallet back to the user.
 * Keeps a tiny amount for rent exemption. Returns the amount swept in SOL.
 */
async function sweepNodeSol(redis, connection, nodeAddress, userWallet) {
  const nodeSecret = await redis.get(`bondli:gpu:nodekey:${nodeAddress}`);
  if (!nodeSecret) return 0;

  const nodeKeypair = Keypair.fromSecretKey(bs58.decode(nodeSecret));
  const balance = await connection.getBalance(nodeKeypair.publicKey);

  // Keep 5000 lamports for tx fee, sweep the rest
  const fee = 5000;
  const sweepAmount = balance - fee;
  if (sweepAmount <= 0) return 0;

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: nodeKeypair.publicKey,
      toPubkey: new PublicKey(userWallet),
      lamports: sweepAmount,
    })
  );

  await sendAndConfirmTransaction(connection, tx, [nodeKeypair]);

  const solAmount = sweepAmount / LAMPORTS_PER_SOL;
  console.log(`[GPU SOL SWEEP] ${nodeAddress.slice(0, 8)}...: ${solAmount.toFixed(6)} SOL → ${userWallet.slice(0, 8)}...`);
  return solAmount;
}

export { sweepNodeBalance, sweepNodeSol };
