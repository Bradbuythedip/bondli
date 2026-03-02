// BONDLI v3.0 — PRODUCTION API Server
// Hardened with: rate limiting, auth, validation, CORS, security headers, payment gate
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Connection } from "@solana/web3.js";

// Engine
import { Orchestrator } from "../engine/orchestrator.mjs";
import { calculateFee, getFeeTier, isOwnerWallet, registerOwner } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";

// Security middleware
import { cors, securityHeaders, requestId, bodyLimit, extractIP } from "../middleware/security.mjs";
import { initRedis, apiLimiter, launchLimiter, wsLimiter } from "../middleware/rate-limiter.mjs";
import { requireAuth, optionalAuth } from "../middleware/auth.mjs";
import { launchSchema, closeSchema } from "../middleware/validate.mjs";

// Payments
import PaymentVerifier from "../payments/payment-verifier.mjs";
import createPaymentRoutes from "../payments/payment-routes.mjs";

// Sessions
import SessionStore from "../db/session-store.mjs";

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
const app = express();
const IS_PROD = process.env.NODE_ENV === "production";

// Trust nginx proxy
if (IS_PROD) app.set("trust proxy", 1);

// ── Global Middleware (order matters) ───
app.use(requestId);
app.use(extractIP);
app.use(securityHeaders);
app.use(cors);
app.use(bodyLimit(100_000)); // 100KB max body
app.use(express.json({ limit: "100kb" }));

// ── Request Logging ─────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
    console.log(`${color}${req.method} ${req.path} ${status}\x1b[0m ${ms}ms [${req.clientIP}] ${req.id?.slice(0,8)}`);
  });
  next();
});

// ═══════════════════════════════════════
// SERVICES
// ═══════════════════════════════════════
let sessionStore;
let paymentVerifier;
const orch = new Orchestrator();

async function initServices() {
  // Redis
  const redis = await initRedis(process.env.REDIS_URL);

  // Session store
  sessionStore = new SessionStore(redis);

  // Payment verifier
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  paymentVerifier = new PaymentVerifier(connection);
  await paymentVerifier.init();

  console.log("[INIT] All services ready");
}

// ═══════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════

// ── Health (no auth, no rate limit) ─────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: IS_PROD ? "production" : "development" });
});

// ── Payment Routes (no auth required) ───
// These are mounted after initServices() below

// ── Public Routes (rate limited) ────────
app.get("/api/status", apiLimiter, optionalAuth, (req, res) => {
  const status = orch.status();
  // Non-auth users get limited info
  if (!req.user) {
    return res.json({ ok: true, dryRun: status.dryRun, activeSessions: Object.keys(status.sessions).length });
  }
  res.json({ ok: true, ...status });
});

app.get("/api/config", apiLimiter, (req, res) => {
  res.json({
    dryRun: CONFIG.DRY_RUN,
    totalSol: CONFIG.TOTAL_SOL,
    slippageBps: CONFIG.SLIPPAGE_BPS,
    purgePercent: CONFIG.PURGE_PERCENT,
    platformWallet: CONFIG.PLATFORM_WALLET,
    accessFee: parseFloat(process.env.ACCESS_FEE_SOL || "0.1"),
  });
});

app.get("/api/fees", apiLimiter, (req, res) => {
  const sol = Math.min(100, Math.max(0, parseFloat(req.query.sol || "1")));
  const tier = getFeeTier(sol);
  const wallet = req.query.wallet || "";
  const owner = wallet ? isOwnerWallet(wallet) : false;
  res.json({ ...tier, isOwner: owner });
});

// ── Protected Routes (auth + rate limit) ─
app.get("/api/wallets", apiLimiter, requireAuth, (req, res) => {
  res.json({ wallets: orch.walletOpt.summary() });
});

app.get("/api/curve/:ca", apiLimiter, requireAuth, async (req, res) => {
  try {
    // Validate CA format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) {
      return res.status(400).json({ error: "Invalid contract address" });
    }
    const info = await orch.router.getCurveInfo(req.params.ca);
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch curve info" });
  }
});

app.post("/api/launch", launchLimiter, requireAuth, launchSchema, async (req, res) => {
  try {
    const { ca, totalSol, force } = req.body;
    const sol = Math.min(totalSol || CONFIG.TOTAL_SOL, 100); // cap at 100 SOL

    // Track session
    if (sessionStore) {
      await sessionStore.recordLaunch(req.user.wallet, ca, sol);
    }

    const result = await orch.launch(ca, { totalSol: sol, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/close", apiLimiter, requireAuth, closeSchema, async (req, res) => {
  try {
    const { ca } = req.body;
    const result = await orch.close(ca);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/close-all", apiLimiter, requireAuth, async (req, res) => {
  try {
    const result = await orch.closeAll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/fees/calculate", apiLimiter, requireAuth, (req, res) => {
  const { solIn, solReturn, wallet } = req.body;
  if (typeof solIn !== "number" || typeof solReturn !== "number") {
    return res.status(400).json({ error: "solIn and solReturn must be numbers" });
  }
  const fee = calculateFee(solIn, solReturn, wallet || "");
  res.json(fee);
});

// ── Admin Routes ────────────────────────
app.post("/api/register-owner", (req, res) => {
  const { secret, pubkey } = req.body;
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!pubkey || typeof pubkey !== "string") return res.status(400).json({ error: "pubkey required" });
  registerOwner(pubkey);
  res.json({ ok: true });
});

app.get("/api/admin/sessions", async (req, res) => {
  if (req.headers["x-admin-secret"] !== CONFIG.API_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!sessionStore) return res.json({ sessions: [] });
  const sessions = await sessionStore.allSessions();
  res.json({ count: sessions.length, sessions });
});

// ── 404 Handler ─────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error Handler ───────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.id?.slice(0,8)} ${err.stack || err.message}`);
  res.status(500).json({
    error: IS_PROD ? "Internal server error" : err.message,
  });
});

// ═══════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-real-ip"] || req.socket.remoteAddress;
  console.log(`[WS] Connected: ${ip}`);

  // Connection limit per IP
  let connFromIP = 0;
  wss.clients.forEach(c => {
    if (c._bondliIP === ip) connFromIP++;
  });
  if (connFromIP >= 3) {
    ws.close(4029, "Too many connections from your IP");
    return;
  }
  ws._bondliIP = ip;

  ws.send(JSON.stringify({ event: "connected", data: { dryRun: CONFIG.DRY_RUN } }));

  const handler = (msg) => {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch {}
    }
  };
  orch.onEvent(handler);

  // Heartbeat
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("close", () => {
    const idx = orch.listeners.indexOf(handler);
    if (idx >= 0) orch.listeners.splice(idx, 1);
  });

  ws.on("message", (data) => {
    // Rate limit WS messages
    const now = Date.now();
    if (!ws._lastMsg) ws._lastMsg = 0;
    if (now - ws._lastMsg < 100) return; // max 10 msg/sec
    ws._lastMsg = now;

    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    } catch {}
  });
});

// WS heartbeat interval
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
const PORT = CONFIG.API_PORT;

async function start() {
  try {
    await initServices();

    // Mount payment routes (needs paymentVerifier)
    app.use(createPaymentRoutes(paymentVerifier));

    server.listen(PORT, () => {
      console.log("");
      console.log("  \x1b[35m=========================================\x1b[0m");
      console.log("  \x1b[35m  BONDLI v3.0 — PRODUCTION SERVER\x1b[0m");
      console.log("  \x1b[35m=========================================\x1b[0m");
      console.log(`  HTTP:  http://localhost:${PORT}`);
      console.log(`  WS:    ws://localhost:${PORT}/ws`);
      console.log(`  Mode:  ${CONFIG.DRY_RUN ? "\x1b[33mDRY RUN\x1b[0m" : "\x1b[31mLIVE\x1b[0m"}`);
      console.log(`  Env:   ${IS_PROD ? "production" : "development"}`);
      console.log("");
    });
  } catch (e) {
    console.error("[FATAL]", e);
    process.exit(1);
  }
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  server.close(() => {
    console.log("[SHUTDOWN] HTTP server closed");
    wss.close(() => {
      console.log("[SHUTDOWN] WebSocket server closed");
      process.exit(0);
    });
  });
  // Force kill after 10s
  setTimeout(() => { console.error("[SHUTDOWN] Forced exit"); process.exit(1); }, 10000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();

export default app;
