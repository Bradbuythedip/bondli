import React, { useState, useEffect, useRef, useCallback } from "react";
import * as API from "./api.js";

// ═══════════════════════════════════════════
// BONDLI v3.0 — THE LAUNCHPAD
// ═══════════════════════════════════════════

// ── Pill Icon SVG (pump.fun style capsule) ──
const PillIcon = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} style={{ display: "inline-block", verticalAlign: "middle" }}>
    <defs>
      <linearGradient id="pillGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ff2d78" />
        <stop offset="50%" stopColor="#ff2d78" />
        <stop offset="50%" stopColor="#00e87b" />
        <stop offset="100%" stopColor="#00e87b" />
      </linearGradient>
    </defs>
    <rect x="6" y="4" width="20" height="24" rx="10" fill="url(#pillGrad)" />
    <line x1="6" y1="16" x2="26" y2="16" stroke="#0a0a0a" strokeWidth="1.5" />
  </svg>
);

// ── Crown badge for owner ──
const CrownBadge = () => (
  <span style={{ fontSize: 14, marginLeft: 4 }} title="Owner — Zero Fees">👑</span>
);

// ── Wallet Role Emojis ──
const ROLE_EMOJI = {
  sniper: "🎯", accumulator: "🐜", momentum: "🏎️",
  swing: "🎢", whale: "🐋", liquidator: "💰", recycler: "♻️",
};

const ROLE_COLORS = {
  sniper: "#ff4444", accumulator: "#44aaff", momentum: "#ffaa00",
  swing: "#aa44ff", whale: "#00ccaa", liquidator: "#ff8800", recycler: "#88ff44",
};

// ── Fee Tier Data ──
const PROFIT_TIERS = [
  { m: 1, r: 0.10 }, { m: 5, r: 0.12 }, { m: 15, r: 0.15 },
  { m: 30, r: 0.18 }, { m: "∞", r: 0.20 },
];
const LOSS_TIERS = [
  { m: 1, f: 0.002 }, { m: 5, f: 0.005 }, { m: 15, f: 0.010 },
  { m: 30, f: 0.015 }, { m: "∞", f: 0.020 },
];

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════
const S = {
  app: {
    background: "#0a0a0a", color: "#e0e0e0", fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    minHeight: "100vh", display: "flex", flexDirection: "column",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 24px", borderBottom: "1px solid #1a1a2e",
    background: "linear-gradient(180deg, #0f0f1a 0%, #0a0a0a 100%)",
  },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoText: {
    fontSize: 22, fontWeight: 800, letterSpacing: -0.5,
    background: "linear-gradient(135deg, #ff2d78, #00e87b)", WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  tag: {
    fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
    background: "#1a1a2e", color: "#666", letterSpacing: 1,
  },
  main: { display: "flex", flex: 1, overflow: "hidden" },
  sidebar: {
    width: 320, borderRight: "1px solid #1a1a2e", padding: 20, overflowY: "auto",
    background: "#0c0c14",
  },
  content: { flex: 1, padding: 20, overflowY: "auto" },
  card: {
    background: "#111118", border: "1px solid #1a1a2e", borderRadius: 12,
    padding: 16, marginBottom: 16,
  },
  cardTitle: {
    fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase",
    letterSpacing: 1.5, marginBottom: 12,
  },
  input: {
    width: "100%", padding: "10px 12px", background: "#0a0a10", border: "1px solid #222",
    borderRadius: 8, color: "#e0e0e0", fontFamily: "inherit", fontSize: 13,
    outline: "none", boxSizing: "border-box",
  },
  btn: {
    padding: "10px 20px", border: "none", borderRadius: 8, cursor: "pointer",
    fontFamily: "inherit", fontWeight: 700, fontSize: 13, letterSpacing: 0.5,
    transition: "all 0.15s",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #ff2d78, #cc1155)", color: "#fff",
  },
  btnGreen: {
    background: "linear-gradient(135deg, #00e87b, #00bb55)", color: "#0a0a0a",
  },
  btnDanger: {
    background: "linear-gradient(135deg, #ff4444, #cc2222)", color: "#fff",
  },
  btnGhost: {
    background: "transparent", border: "1px solid #333", color: "#888",
  },
  label: { fontSize: 11, color: "#666", marginBottom: 4, display: "block" },
  row: { display: "flex", gap: 8, alignItems: "center" },
  badge: {
    fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700,
  },
  slider: {
    width: "100%", accentColor: "#ff2d78", cursor: "pointer",
  },
  feed: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.8,
    color: "#888", maxHeight: 400, overflowY: "auto", padding: 8,
    background: "#08080e", borderRadius: 8, border: "1px solid #151520",
  },
  walletCard: {
    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
    background: "#0e0e16", borderRadius: 10, border: "1px solid #1a1a2e",
    marginBottom: 8, transition: "border-color 0.2s",
  },
  tabs: { display: "flex", gap: 2, marginBottom: 16 },
  tab: {
    padding: "8px 16px", background: "#111118", border: "1px solid #1a1a2e",
    borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: 12, fontWeight: 600,
    color: "#666", fontFamily: "inherit", transition: "all 0.15s",
  },
  tabActive: { background: "#1a1a2e", color: "#e0e0e0", borderBottomColor: "#1a1a2e" },
  modal: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999,
  },
  modalBox: {
    background: "#111118", border: "1px solid #2a2a3e", borderRadius: 16,
    padding: 32, maxWidth: 480, width: "90%", textAlign: "center",
  },
  footer: {
    padding: "12px 24px", borderTop: "1px solid #1a1a2e", textAlign: "center",
    fontSize: 11, color: "#333",
  },
};

// ═══════════════════════════════════════════
// APP COMPONENT
// ═══════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("create");
  const [ca, setCa] = useState("");
  const [totalSol, setTotalSol] = useState(1);
  const [purge, setPurge] = useState(30);
  const [dryRun, setDryRun] = useState(true);
  const [wallets, setWallets] = useState([]);
  const [feed, setFeed] = useState([]);
  const [sessions, setSessions] = useState({});
  const [connected, setConnected] = useState(false);
  const [showCloseAll, setShowCloseAll] = useState(false);
  const [feeResult, setFeeResult] = useState(null);
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [ownerWallet, setOwnerWallet] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [curveInfo, setCurveInfo] = useState(null);
  const feedRef = useRef(null);
  const wsRef = useRef(null);

  // WebSocket
  useEffect(() => {
    const ws = API.connectWS((msg) => {
      if (msg.event === "connected") {
        setConnected(true);
        setDryRun(msg.data?.dryRun ?? true);
      }
      if (msg.event === "trade" || msg.event === "phase" || msg.event === "wallet:funded") {
        setFeed(prev => [...prev.slice(-200), { ...msg, id: Date.now() + Math.random() }]);
      }
      if (msg.event === "session:closed" && msg.data?.fee) {
        setFeeResult(msg.data);
        setShowFeeModal(true);
      }
    });
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

  // Fetch config on mount
  useEffect(() => {
    API.getConfig().then(cfg => {
      setDryRun(cfg.dryRun);
      setTotalSol(cfg.totalSol);
      setPurge(cfg.purgePercent || 30);
    }).catch(() => {});
  }, []);

  // Check owner status
  useEffect(() => {
    if (ownerWallet) {
      API.getFees(totalSol, ownerWallet).then(f => setIsOwner(f.isOwner)).catch(() => {});
    }
  }, [ownerWallet, totalSol]);

  // Wallet count from SOL budget
  const walletCount = totalSol <= 0.5 ? 3 : totalSol <= 1 ? 5 : totalSol <= 2 ? 7 :
    totalSol <= 5 ? 10 : totalSol <= 10 ? 13 : totalSol <= 20 ? 16 : 20;

  // Fee tier for current SOL
  const currentTier = PROFIT_TIERS.find(t => totalSol <= (t.m === "∞" ? Infinity : t.m)) || PROFIT_TIERS[4];
  const currentLoss = LOSS_TIERS.find(t => totalSol <= (t.m === "∞" ? Infinity : t.m)) || LOSS_TIERS[4];

  // ── Handlers ──
  const handleLaunch = async () => {
    if (!ca) return;
    try {
      const result = await API.launch(ca, totalSol, false);
      setWallets(result.wallets || []);
      setSessions(prev => ({ ...prev, [ca]: { phase: "DEPLOY", running: true } }));
      setFeed(prev => [...prev, { event: "ui", data: { msg: `Launched ${ca.slice(0,12)}...` }, id: Date.now() }]);
    } catch (e) {
      setFeed(prev => [...prev, { event: "error", data: { msg: e.message }, id: Date.now() }]);
    }
  };

  const handleClose = async (targetCa) => {
    try {
      const result = await API.closeSession(targetCa);
      if (result.fee) {
        setFeeResult({ ...result, ca: targetCa });
        setShowFeeModal(true);
      }
    } catch (e) {
      setFeed(prev => [...prev, { event: "error", data: { msg: e.message }, id: Date.now() }]);
    }
  };

  const handleCloseAll = async () => {
    setShowCloseAll(false);
    try {
      const result = await API.closeAll();
      // Fee modal will trigger from WS event
    } catch (e) {
      setFeed(prev => [...prev, { event: "error", data: { msg: e.message }, id: Date.now() }]);
    }
  };

  const handleLaunchAll = () => {
    if (!ca) return;
    handleLaunch();
  };

  const handleReset = () => {
    setWallets([]);
    setSessions({});
    setFeed([]);
    setFeeResult(null);
    setCa("");
  };

  const fetchCurve = async () => {
    if (!ca) return;
    try {
      const info = await API.getCurve(ca);
      setCurveInfo(info);
    } catch {}
  };

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  return (
    <div style={S.app}>
      {/* ── HEADER ── */}
      <div style={S.header}>
        <div style={S.logo}>
          <PillIcon size={30} />
          <span style={S.logoText}>bondli.fun</span>
          <span style={{ ...S.tag, marginLeft: 8 }}>v3.0</span>
          {dryRun && <span style={{ ...S.badge, background: "#332200", color: "#ffaa00" }}>DRY RUN</span>}
        </div>
        <div style={S.row}>
          <div style={{ ...S.badge, background: connected ? "#003322" : "#331111", color: connected ? "#00e87b" : "#ff4444" }}>
            {connected ? "● LIVE" : "● OFFLINE"}
          </div>
          {isOwner && <CrownBadge />}
          <button style={{ ...S.btn, ...S.btnDanger, fontSize: 11, padding: "6px 14px" }}
            onClick={() => setShowCloseAll(true)}>
            ☠ CLOSE ALL
          </button>
        </div>
      </div>

      <div style={S.main}>
        {/* ── SIDEBAR ── */}
        <div style={S.sidebar}>
          {/* SOL Budget */}
          <div style={S.card}>
            <div style={S.cardTitle}>Budget</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "#00e87b" }}>{totalSol}</span>
              <span style={{ fontSize: 12, color: "#555", alignSelf: "flex-end" }}>SOL</span>
            </div>
            <input type="range" min="0.1" max="50" step="0.1" value={totalSol}
              onChange={e => setTotalSol(parseFloat(e.target.value))}
              style={S.slider} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginTop: 4 }}>
              <span>{walletCount} wallets</span>
              <span>max 20</span>
            </div>
          </div>

          {/* Fee Model Card */}
          <div style={S.card}>
            <div style={S.cardTitle}>Fee Model {isOwner && <CrownBadge />}</div>
            {isOwner ? (
              <div style={{ color: "#00e87b", fontSize: 13, fontWeight: 600 }}>
                Owner detected — ALL FEES WAIVED
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
                  At {totalSol} SOL:
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, padding: 8, background: "#0a0a10", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#00e87b" }}>PROFIT</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#00e87b" }}>
                      {(currentTier.r * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: 8, background: "#0a0a10", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#ff4444" }}>LOSS</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#ff4444" }}>
                      {currentLoss.f} SOL
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Purge Control */}
          <div style={S.card}>
            <div style={S.cardTitle}>Anti-Sniper Purge</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: "#ff2d78" }}>{purge}%</span>
              <span style={{ fontSize: 11, color: "#555", alignSelf: "flex-end" }}>of positions</span>
            </div>
            <input type="range" min="0" max="60" step="5" value={purge}
              onChange={e => setPurge(parseInt(e.target.value))}
              style={{ ...S.slider, accentColor: "#ff2d78" }} />
          </div>

          {/* Owner Wallet */}
          <div style={S.card}>
            <div style={S.cardTitle}>Owner Wallet</div>
            <input style={S.input} placeholder="your wallet pubkey..."
              value={ownerWallet} onChange={e => setOwnerWallet(e.target.value)} />
            {isOwner && <div style={{ fontSize: 11, color: "#00e87b", marginTop: 6 }}>👑 Verified owner</div>}
          </div>

          {/* Global Controls */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={{ ...S.btn, ...S.btnGreen, flex: 1 }} onClick={handleLaunchAll}>
              ▶ LAUNCH ALL
            </button>
            <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} onClick={handleReset}>
              ↺ RESET
            </button>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={S.content}>
          {/* Tabs */}
          <div style={S.tabs}>
            {["create", "wallets", "feed", "config"].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }}>
                {{ create: "🪙 Create", wallets: "🤖 Wallets", feed: "📊 Feed", config: "⚙️ Config" }[t]}
              </button>
            ))}
          </div>

          {/* ── CREATE TAB ── */}
          {tab === "create" && (
            <div>
              <div style={S.card}>
                <div style={S.cardTitle}>
                  <PillIcon size={16} /> Token Launch
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Contract Address (CA)</label>
                  <input style={S.input} placeholder="paste token CA or deploy new..."
                    value={ca} onChange={e => setCa(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn, ...S.btnPrimary, flex: 1 }} onClick={handleLaunch}
                    disabled={!ca}>
                    <PillIcon size={14} /> LAUNCH
                  </button>
                  <button style={{ ...S.btn, ...S.btnGhost }} onClick={fetchCurve} disabled={!ca}>
                    📈 Curve
                  </button>
                </div>
              </div>

              {/* Curve Info */}
              {curveInfo && curveInfo.exists && (
                <div style={S.card}>
                  <div style={S.cardTitle}>Bonding Curve</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={S.label}>Status</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: curveInfo.graduated ? "#00e87b" : "#ffaa00" }}>
                        {curveInfo.graduated ? "GRADUATED" : "ON CURVE"}
                      </div>
                    </div>
                    <div>
                      <div style={S.label}>Progress</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#ff2d78" }}>
                        {curveInfo.progress?.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div style={S.label}>SOL Reserves</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {curveInfo.solReserves?.toFixed(2)} SOL
                      </div>
                    </div>
                    <div>
                      <div style={S.label}>Price</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {curveInfo.price?.toExponential(4)}
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ marginTop: 12, height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, width: `${Math.min(100, curveInfo.progress || 0)}%`,
                      background: "linear-gradient(90deg, #ff2d78, #00e87b)",
                      transition: "width 0.5s",
                    }} />
                  </div>
                </div>
              )}

              {/* Active Sessions */}
              {Object.keys(sessions).length > 0 && (
                <div style={S.card}>
                  <div style={S.cardTitle}>Active Sessions</div>
                  {Object.entries(sessions).map(([sca, s]) => (
                    <div key={sca} style={{ ...S.walletCard, justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e0e0" }}>
                          {sca.slice(0, 12)}...
                        </div>
                        <div style={{ fontSize: 10, color: "#666" }}>
                          Phase: <span style={{ color: "#ffaa00" }}>{s.phase}</span>
                        </div>
                      </div>
                      <button style={{ ...S.btn, ...S.btnDanger, fontSize: 10, padding: "4px 10px" }}
                        onClick={() => handleClose(sca)}>
                        ✕ CLOSE
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── WALLETS TAB ── */}
          {tab === "wallets" && (
            <div>
              {wallets.length === 0 ? (
                <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#444" }}>
                  No wallets yet. Launch a session to generate fleet.
                </div>
              ) : (
                wallets.map((w, i) => (
                  <div key={i} style={{
                    ...S.walletCard,
                    borderColor: ROLE_COLORS[w.role] + "33",
                  }}>
                    <span style={{ fontSize: 20 }}>{ROLE_EMOJI[w.role] || "?"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: ROLE_COLORS[w.role] }}>
                          {w.role.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 10, color: "#555" }}>{w.pubkey}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                        {w.alloc} SOL | {w.trades} trades | PnL: <span style={{
                          color: parseFloat(w.pnl) >= 0 ? "#00e87b" : "#ff4444"
                        }}>{w.pnl}</span>
                      </div>
                    </div>
                    <div style={{
                      ...S.badge,
                      background: w.funded ? "#003322" : "#1a1a2e",
                      color: w.funded ? "#00e87b" : "#555",
                    }}>
                      {w.funded ? "FUNDED" : "PENDING"}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── FEED TAB ── */}
          {tab === "feed" && (
            <div style={S.card}>
              <div style={S.cardTitle}>Live Trade Stream</div>
              <div ref={feedRef} style={S.feed}>
                {feed.length === 0 && (
                  <div style={{ color: "#333", textAlign: "center", padding: 20 }}>
                    Waiting for events...
                  </div>
                )}
                {feed.map(f => (
                  <div key={f.id} style={{ borderBottom: "1px solid #111" }}>
                    <span style={{ color: "#333" }}>[{new Date(f.ts || Date.now()).toLocaleTimeString()}]</span>
                    {" "}
                    <span style={{
                      color: f.event === "trade" ? "#00e87b" :
                        f.event === "phase" ? "#ffaa00" :
                        f.event === "error" ? "#ff4444" : "#555",
                    }}>
                      {f.event}
                    </span>
                    {" "}
                    <span style={{ color: "#777" }}>
                      {f.data?.msg || f.data?.phase || (f.data?.type ? `${f.data.type} ${(f.data.solAmount || f.data.tokenAmount || "")}` : JSON.stringify(f.data).slice(0, 80))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── CONFIG TAB ── */}
          {tab === "config" && (
            <div>
              {/* Fee Explainer */}
              <div style={S.card}>
                <div style={S.cardTitle}>Fee Structure</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  {/* Profit column */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#00e87b", marginBottom: 8 }}>
                      PROFIT SHARE
                    </div>
                    {PROFIT_TIERS.map((t, i) => (
                      <div key={i} style={{
                        padding: "6px 8px", marginBottom: 4, borderRadius: 4, fontSize: 11,
                        background: currentTier === t ? "#002211" : "transparent",
                        border: currentTier === t ? "1px solid #00e87b33" : "1px solid transparent",
                      }}>
                        <span style={{ color: "#555" }}>≤{t.m} SOL:</span>{" "}
                        <span style={{ color: "#00e87b", fontWeight: 700 }}>{(t.r * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  {/* Loss column */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ff4444", marginBottom: 8 }}>
                      INFRA FEE (LOSS)
                    </div>
                    {LOSS_TIERS.map((t, i) => (
                      <div key={i} style={{
                        padding: "6px 8px", marginBottom: 4, borderRadius: 4, fontSize: 11,
                        background: currentLoss === t ? "#220000" : "transparent",
                        border: currentLoss === t ? "1px solid #ff444433" : "1px solid transparent",
                      }}>
                        <span style={{ color: "#555" }}>≤{t.m} SOL:</span>{" "}
                        <span style={{ color: "#ff4444", fontWeight: 700 }}>{t.f} SOL</span>
                      </div>
                    ))}
                  </div>
                  {/* Owner column */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ffaa00", marginBottom: 8 }}>
                      OWNER
                    </div>
                    <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                      👑 anal.sol or registered owner wallets pay <span style={{ color: "#00e87b", fontWeight: 700 }}>ZERO</span> fees on all trades.
                    </div>
                    <div style={{ marginTop: 12, fontSize: 10, color: "#444" }}>
                      Owners are verified via SHA-256 hash comparison with timing-safe equality check.
                    </div>
                  </div>
                </div>
              </div>

              {/* Config Values */}
              <div style={S.card}>
                <div style={S.cardTitle}>Engine Config</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                  {[
                    ["Dry Run", dryRun ? "YES" : "NO"],
                    ["Budget", `${totalSol} SOL`],
                    ["Wallets", walletCount],
                    ["Slippage", "25%"],
                    ["Priority Fee", "100k μlamports"],
                    ["Jito Tip", "10k lamports"],
                    ["Purge", `${purge}%`],
                    ["Platform", "anal.sol"],
                  ].map(([k, v], i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #111" }}>
                      <span style={{ color: "#555" }}>{k}</span>
                      <span style={{ fontWeight: 700, color: "#aaa" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CLOSE ALL MODAL ── */}
      {showCloseAll && (
        <div style={S.modal} onClick={() => setShowCloseAll(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>☠️</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#ff4444", marginBottom: 8 }}>
              CLOSE ALL SESSIONS
            </div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
              This will sell ALL positions across ALL active sessions and sweep SOL back to master.
              Fees will be calculated and settled.
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => setShowCloseAll(false)}>
                Cancel
              </button>
              <button style={{ ...S.btn, ...S.btnDanger }} onClick={handleCloseAll}>
                ☠ CONFIRM CLOSE ALL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FEE SETTLEMENT MODAL ── */}
      {showFeeModal && feeResult && (
        <div style={S.modal} onClick={() => setShowFeeModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <PillIcon size={48} />
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e0e0e0", marginTop: 12, marginBottom: 4 }}>
              SESSION SETTLED
            </div>
            {feeResult.ca && (
              <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>
                {feeResult.ca}
              </div>
            )}
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#666" }}>IN</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#888" }}>
                  {feeResult.totalIn?.toFixed(4)}
                </div>
              </div>
              <div style={{ fontSize: 24, color: "#333", alignSelf: "center" }}>→</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#666" }}>OUT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: feeResult.totalReturn >= feeResult.totalIn ? "#00e87b" : "#ff4444" }}>
                  {feeResult.totalReturn?.toFixed(4)}
                </div>
              </div>
            </div>
            <div style={{
              padding: 16, background: "#0a0a10", borderRadius: 8, marginBottom: 16,
              border: `1px solid ${feeResult.fee?.isOwner ? "#ffaa0033" : feeResult.fee?.type === "profit-share" ? "#00e87b33" : "#ff444433"}`,
            }}>
              {feeResult.fee?.isOwner ? (
                <div>
                  <div style={{ fontSize: 12, color: "#ffaa00" }}>👑 OWNER — ZERO FEES</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
                    {feeResult.fee?.type === "profit-share" ? "PROFIT SHARE" : "INFRA FEE"}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: feeResult.fee?.type === "profit-share" ? "#00e87b" : "#ff4444" }}>
                    {feeResult.fee?.fee?.toFixed(6)} SOL
                  </div>
                  {feeResult.fee?.rate && (
                    <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                      {(feeResult.fee.rate * 100)}% of {feeResult.fee.net?.toFixed(4)} SOL profit
                    </div>
                  )}
                </div>
              )}
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowFeeModal(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <div style={S.footer}>
        bondli.fun v3.0 — game theory engine — built for degens — fees settle to anal.sol
      </div>
    </div>
  );
}
