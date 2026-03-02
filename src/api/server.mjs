// BONDLI v3.0 — Express + WebSocket API Server
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Orchestrator } from "../engine/orchestrator.mjs";
import { calculateFee, getFeeTier, isOwnerWallet, registerOwner } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";

const app = express();
app.use(express.json());

// CORS for dev
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const orch = new Orchestrator();

// ── REST Endpoints ──────────────────────

// Status
app.get("/api/status", (req, res) => {
  res.json({ ok: true, ...orch.status() });
});

// Config (safe subset)
app.get("/api/config", (req, res) => {
  res.json({
    dryRun: CONFIG.DRY_RUN,
    totalSol: CONFIG.TOTAL_SOL,
    slippageBps: CONFIG.SLIPPAGE_BPS,
    priorityFee: CONFIG.PRIORITY_FEE,
    purgePercent: CONFIG.PURGE_PERCENT,
    platformWallet: CONFIG.PLATFORM_WALLET,
  });
});

// Wallets
app.get("/api/wallets", (req, res) => {
  res.json({ wallets: orch.walletOpt.summary() });
});

// Curve info
app.get("/api/curve/:ca", async (req, res) => {
  try {
    const info = await orch.router.getCurveInfo(req.params.ca);
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fee tiers
app.get("/api/fees", (req, res) => {
  const sol = parseFloat(req.query.sol || "1");
  const tier = getFeeTier(sol);
  const wallet = req.query.wallet || "";
  const owner = isOwnerWallet(wallet);
  res.json({ ...tier, isOwner: owner, wallet });
});

// Calculate fee
app.post("/api/fees/calculate", (req, res) => {
  const { solIn, solReturn, wallet } = req.body;
  const fee = calculateFee(solIn || 0, solReturn || 0, wallet || "");
  res.json(fee);
});

// Launch
app.post("/api/launch", async (req, res) => {
  try {
    const { ca, totalSol, force } = req.body;
    if (!ca) return res.status(400).json({ error: "Missing ca" });
    const result = await orch.launch(ca, { totalSol, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Close session
app.post("/api/close", async (req, res) => {
  try {
    const { ca } = req.body;
    if (!ca) return res.status(400).json({ error: "Missing ca" });
    const result = await orch.close(ca);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Close all
app.post("/api/close-all", async (req, res) => {
  try {
    const result = await orch.closeAll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Owner registration (protected)
app.post("/api/register-owner", (req, res) => {
  const { secret, pubkey } = req.body;
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  registerOwner(pubkey);
  res.json({ ok: true });
});

// ── WebSocket ───────────────────────────

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  ws.send(JSON.stringify({ event: "connected", data: { dryRun: CONFIG.DRY_RUN } }));

  const handler = (msg) => {
    if (ws.readyState === 1) ws.send(msg);
  };
  orch.onEvent(handler);

  ws.on("close", () => {
    const idx = orch.listeners.indexOf(handler);
    if (idx >= 0) orch.listeners.splice(idx, 1);
    console.log("[WS] Client disconnected");
  });
});

// ── Start ───────────────────────────────

const PORT = CONFIG.API_PORT;
server.listen(PORT, () => {
  console.log(`\n=== BONDLI API v3.0 ===`);
  console.log(`  HTTP: http://localhost:${PORT}`);
  console.log(`  WS:   ws://localhost:${PORT}/ws`);
  console.log(`  Mode: ${CONFIG.DRY_RUN ? "DRY RUN" : "LIVE"}\n`);
});

export default app;
