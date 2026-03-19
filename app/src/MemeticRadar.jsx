import { useState, useEffect, useRef, useCallback } from "react";

// ═══ MEMETIC RADAR — PULSE UI ═══
// Live radar: every pump.fun token appears, scores in real-time,
// pulses with intensity proportional to composite score.

const M = "'IBM Plex Mono','SF Mono',monospace";
const S = "'Nunito','Helvetica Neue',sans-serif";

const C = {
  bg: "#06060a", sf: "#0c0c14", bd: "rgba(255,255,255,.06)",
  gn: "#00e676", yl: "#ffd600", or: "#ff9100", rd: "#ff1744",
  pu: "#b388ff", cy: "#18ffff", tx: "#cccce0", dm: "#5c5c7a", ft: "#3a3a50",
};

const ARCH_COLORS = {
  organic_runner: "#00e676",
  cultural_catalyst: "#ff9100",
  camp_absurdist: "#b388ff",
  influencer_cascade: "#18ffff",
  rug_signal: "#ff1744",
  noise: "#5c5c7a",
};

const ARCH_LABELS = {
  organic_runner: "Organic Runner",
  cultural_catalyst: "Cultural Catalyst",
  camp_absurdist: "Camp / Absurdist",
  influencer_cascade: "Influencer Cascade",
  rug_signal: "Rug Signal",
  noise: "Noise",
};

const MODS = {
  linguistic: { label: "Linguistic", color: "#00e676" },
  visual: { label: "Visual", color: "#ff9100" },
  cultural: { label: "Cultural", color: "#ffd600" },
  community: { label: "Community", color: "#18ffff" },
  influencer: { label: "Influencer", color: "#b388ff" },
  absurdity: { label: "Absurdity", color: "#ff1744" },
  temporal: { label: "Temporal", color: "#e040fb" },
};

function fmtAge(ms) {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h " + (m % 60) + "m";
  return Math.floor(h / 24) + "d";
}

function fmtSol(v) { return v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4); }

// ═══ SPIDER CHART ═══
function Spider({ scores = {}, size = 180 }) {
  const keys = Object.keys(MODS);
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const step = (2 * Math.PI) / keys.length;
  const pt = (i, v) => {
    const a = step * i - Math.PI / 2;
    return { x: cx + r * v * Math.cos(a), y: cy + r * v * Math.sin(a) };
  };
  const pts = keys.map((k, i) => pt(i, scores[k] ?? 0.5));
  const poly = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map(ring => (
        <polygon key={ring} points={keys.map((_, i) => { const p = pt(i, ring); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      ))}
      {keys.map((_, i) => { const p = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />; })}
      <polygon points={poly} fill="rgba(0,230,118,0.1)" stroke="#00e67688" strokeWidth="1.5" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={MODS[keys[i]].color} />)}
      {keys.map((k, i) => { const p = pt(i, 1.22); return <text key={k} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill={MODS[k].color} fontSize="8" fontFamily={M} fontWeight="700">{MODS[k].label}</text>; })}
    </svg>
  );
}

// ═══ TOKEN DOT ═══
function Dot({ token, onClick, selected }) {
  const color = ARCH_COLORS[token.archetype] || C.dm;
  const sz = 10 + (token.score || 0) * 22;
  const op = 0.35 + (token.score || 0) * 0.65;
  const age = Date.now() - (token.timestamp || Date.now());
  const fadeOp = Math.max(0.15, 1 - age / 180000); // fade over 3 min

  return (
    <div onClick={() => onClick(token)} style={{
      position: "absolute", left: token.x + "%", top: token.y + "%",
      width: sz, height: sz, borderRadius: "50%", background: color,
      opacity: op * fadeOp, cursor: "pointer",
      transform: "translate(-50%, -50%)", transition: "all 0.6s cubic-bezier(.4,0,.2,1)",
      border: selected ? `2px solid ${C.tx}` : `1px solid ${color}33`,
      boxShadow: token.score > 0.6 ? `0 0 ${sz * 0.8}px ${color}33` : "none",
      animation: token.isNew ? "radarPulse 0.8s cubic-bezier(.4,0,.2,1)" : "none",
      zIndex: Math.round((token.score || 0) * 100),
    }} title={`${token.symbol} — ${((token.score || 0) * 100).toFixed(0)} — ${fmtAge(age)}`}>
      {(token.score || 0) > 0.55 && (
        <span style={{ position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)", fontSize: 9, fontFamily: M, fontWeight: 800, color, whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,.8)" }}>
          {token.symbol}
        </span>
      )}
      {token.entrySignal && <span style={{ position: "absolute", bottom: -13, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: C.yl }}>⚡</span>}
    </div>
  );
}

// ═══ SCORE PANEL (slide-out) ═══
function ScorePanel({ token, onClose, onBuy, user, tradingBalance, solPrice }) {
  const [buyAmt, setBuyAmt] = useState(0.1);
  const [buying, setBuying] = useState(false);
  const [buyResult, setBuyResult] = useState(null);
  if (!token) return null;

  const color = ARCH_COLORS[token.archetype] || C.dm;
  const bonuses = token.interactionBonuses || [];
  const age = Date.now() - (token.timestamp || Date.now());
  const canBuy = user && !user.demo && tradingBalance >= buyAmt;

  const handleBuy = async () => {
    if (!canBuy || buying) return;
    setBuying(true);
    setBuyResult(null);
    try {
      const sig = await onBuy(token.tokenAddress, buyAmt);
      setBuyResult({ ok: true, sig });
    } catch (e) {
      setBuyResult({ ok: false, err: e.message });
    }
    setBuying(false);
  };

  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: 340,
      background: C.sf + "f8", borderLeft: `1px solid ${C.bd}`,
      backdropFilter: "blur(12px)", overflowY: "auto", zIndex: 200, padding: 16,
      animation: "slideInRight 0.25s cubic-bezier(.4,0,.2,1)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: C.tx, fontFamily: M }}>{token.symbol}</div>
          <div style={{ fontSize: 11, color: C.dm, marginBottom: 4 }}>{token.name}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.ft, fontFamily: M }}>{fmtAge(age)} old</span>
            {token.mcap && <span style={{ fontSize: 10, color: C.yl, fontFamily: M }}>${token.mcap > 1000 ? (token.mcap / 1000).toFixed(1) + "K" : token.mcap}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.dm, fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
      </div>

      {/* Score + Archetype */}
      <div style={{ textAlign: "center", padding: "8px 0", marginBottom: 8 }}>
        <div style={{ fontSize: 44, fontWeight: 900, color, fontFamily: M, lineHeight: 1 }}>{((token.score || 0) * 100).toFixed(0)}</div>
        <div style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: color + "18", color, fontSize: 10, fontWeight: 800, marginTop: 4 }}>
          {ARCH_LABELS[token.archetype] || "Unknown"}
        </div>
        {token.trajectory && <div style={{ fontSize: 10, color: C.dm, marginTop: 4 }}>{token.trajectory.replace(/_/g, " ")}</div>}
      </div>

      {/* BUY SECTION */}
      <div style={{ background: C.bg, border: `1px solid ${C.gn}22`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.gn }}>QUICK BUY</span>
          {tradingBalance != null && <span style={{ fontSize: 10, color: C.ft, marginLeft: "auto" }}>{fmtSol(tradingBalance)} SOL</span>}
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[0.05, 0.1, 0.25, 0.5].map(amt => (
            <button key={amt} onClick={() => setBuyAmt(amt)} style={{
              flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: buyAmt === amt ? C.gn + "18" : C.sf,
              border: `1px solid ${buyAmt === amt ? C.gn + "44" : C.bd}`,
              color: buyAmt === amt ? C.gn : C.dm, cursor: "pointer", fontFamily: M,
            }}>{amt}</button>
          ))}
        </div>
        <button onClick={handleBuy} disabled={!canBuy || buying} style={{
          width: "100%", padding: "8px 0", borderRadius: 6, border: "none", fontSize: 13,
          fontWeight: 900, fontFamily: M, cursor: canBuy && !buying ? "pointer" : "not-allowed",
          background: canBuy ? `linear-gradient(135deg, ${C.gn}dd, ${C.gn}88)` : C.ft + "33",
          color: canBuy ? "#000" : C.ft, transition: "all 0.2s",
        }}>
          {buying ? "SENDING..." : !user ? "CONNECT WALLET" : user.demo ? "DEMO MODE" : `BUY ${buyAmt} SOL`}
        </button>
        {buyResult && (
          <div style={{ fontSize: 10, marginTop: 4, color: buyResult.ok ? C.gn : C.rd, fontFamily: M }}>
            {buyResult.ok ? `Sent! ${buyResult.sig?.slice(0, 12)}...` : buyResult.err}
          </div>
        )}
      </div>

      {/* Spider chart */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <Spider scores={token.moduleScores} size={190} />
      </div>

      {/* Module scores */}
      <div style={{ marginBottom: 12 }}>
        {Object.entries(MODS).map(([key, { label, color: mc }]) => {
          const score = token.moduleScores?.[key] ?? 0.5;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: mc, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: C.dm, flex: 1, fontFamily: M }}>{label}</span>
              <div style={{ width: 70, height: 2.5, borderRadius: 2, background: C.bd }}>
                <div style={{ height: 2.5, borderRadius: 2, background: mc, width: (score * 100) + "%", transition: "width 0.5s" }} />
              </div>
              <span style={{ fontSize: 10, color: mc, fontWeight: 700, fontFamily: M, width: 24, textAlign: "right" }}>{(score * 100).toFixed(0)}</span>
            </div>
          );
        })}
      </div>

      {/* Interaction bonuses */}
      {bonuses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 4, color: C.tx }}>Memeplex Bonuses</div>
          {bonuses.map((b, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", background: C.gn + "06", borderRadius: 3, marginBottom: 1, fontSize: 10, fontFamily: M }}>
              <span style={{ color: C.gn }}>{b.name.replace(/_/g, " ")}</span>
              <span style={{ color: C.yl, fontWeight: 800 }}>×{b.multiplier.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* CA */}
      <div style={{ fontSize: 9, color: C.ft, fontFamily: M, wordBreak: "break-all", userSelect: "all", cursor: "text", padding: "4px 0" }}>
        {token.tokenAddress}
      </div>
    </div>
  );
}

// ═══ TREND RIBBON ═══
function TrendRibbon({ trends = [] }) {
  return (
    <div style={{
      display: "flex", gap: 6, padding: "5px 12px", overflowX: "auto",
      borderBottom: `1px solid ${C.bd}`, background: C.sf,
      scrollbarWidth: "none",
    }}>
      <span style={{ fontSize: 9, color: C.ft, fontWeight: 700, flexShrink: 0, alignSelf: "center", letterSpacing: ".08em" }}>TRENDS</span>
      {trends.length === 0 && <span style={{ fontSize: 10, color: C.dm }}>Scanning...</span>}
      {trends.map((t, i) => (
        <span key={i} style={{ padding: "2px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: C.yl + "10", color: C.yl, whiteSpace: "nowrap", fontFamily: M, flexShrink: 0 }}>
          {t.name} <span style={{ color: C.ft, fontWeight: 400 }}>({t.tokens || 0})</span>
        </span>
      ))}
    </div>
  );
}

// ═══ ATTENTION HEATMAP ═══
function Heatmap({ intensity = 0.5 }) {
  const a = Math.round(intensity * 12).toString(16).padStart(2, "0");
  return <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, ${C.pu}${a} 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0 }} />;
}

// ═══ FLEET BAR ═══
function FleetBar({ stats = {} }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 3, padding: "6px 12px", borderTop: `1px solid ${C.bd}`, background: C.sf }}>
      {[
        { l: "BAL", v: `${fmtSol(stats.balance || 0)}`, c: C.tx },
        { l: "POS", v: stats.positions || 0, c: C.cy },
        { l: "PnL", v: `${stats.dailyPnl > 0 ? "+" : ""}${fmtSol(stats.dailyPnl || 0)}`, c: (stats.dailyPnl || 0) >= 0 ? C.gn : C.rd },
        { l: "WIN", v: `${(stats.winRate || 0).toFixed(0)}%`, c: (stats.winRate || 0) > 50 ? C.gn : C.yl },
        { l: "SHARPE", v: (stats.sharpe || 0).toFixed(2), c: (stats.sharpe || 0) > 1 ? C.gn : C.yl },
        { l: "SCAN", v: stats.tokensScanned || 0, c: C.dm },
      ].map(s => (
        <div key={s.l} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: s.c, fontFamily: M }}>{s.v}</div>
          <div style={{ fontSize: 8, color: C.ft, fontWeight: 700, letterSpacing: ".1em" }}>{s.l}</div>
        </div>
      ))}
    </div>
  );
}

// ═══ TOKEN LIST (sidebar compact view) ═══
function TokenList({ tokens, selected, onSelect }) {
  return (
    <div style={{ overflowY: "auto", maxHeight: "100%", scrollbarWidth: "thin" }}>
      {tokens.sort((a, b) => (b.score || 0) - (a.score || 0)).map(t => {
        const color = ARCH_COLORS[t.archetype] || C.dm;
        const age = Date.now() - (t.timestamp || Date.now());
        const isSel = selected?.tokenAddress === t.tokenAddress;
        return (
          <div key={t.tokenAddress} onClick={() => onSelect(t)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
            borderBottom: `1px solid ${C.bd}`, cursor: "pointer",
            background: isSel ? color + "0a" : "transparent",
            borderLeft: isSel ? `2px solid ${color}` : "2px solid transparent",
            transition: "all 0.15s",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: (t.score || 0) > 0.6 ? `0 0 6px ${color}66` : "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: M, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.symbol || t.name}</div>
              <div style={{ fontSize: 9, color: C.ft }}>{fmtAge(age)}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color, fontFamily: M }}>{((t.score || 0) * 100).toFixed(0)}</div>
            </div>
          </div>
        );
      })}
      {tokens.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.dm, fontSize: 11 }}>Waiting for tokens...</div>}
    </div>
  );
}

// ═══ MAIN COMPONENT ═══
export default function MemeticRadar({ apiBase, onBuy, user, tradingBalance, solPrice }) {
  const API = apiBase || "https://bondli-production.up.railway.app";
  const [tokens, setTokens] = useState([]);
  const [selected, setSelected] = useState(null);
  const [trends, setTrends] = useState([]);
  const [fleet, setFleet] = useState({});
  const [heatLevel, setHeatLevel] = useState(0.3);
  const [view, setView] = useState("radar"); // "radar" or "list"
  const [now, setNow] = useState(Date.now());
  const wsRef = useRef(null);

  // Tick for age updates
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(iv);
  }, []);

  const assignPos = useCallback(() => ({
    x: 8 + Math.random() * 84,
    y: 8 + Math.random() * 84,
  }), []);

  // WebSocket
  useEffect(() => {
    function connect() {
      const wsUrl = API.replace("https://", "wss://").replace("http://", "ws://") + "/ws";
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "token_scored") {
            setTokens(prev => {
              const idx = prev.findIndex(t => t.tokenAddress === msg.tokenAddress);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], ...msg, isNew: false };
                return updated;
              }
              const pos = assignPos();
              return [{ ...msg, ...pos, isNew: true, timestamp: Date.now() }, ...prev].slice(0, 120);
            });
          }
          if (msg.type === "token_detected") {
            setTokens(prev => {
              if (prev.find(t => t.tokenAddress === msg.tokenAddress)) return prev;
              const pos = assignPos();
              return [{ ...msg, ...pos, isNew: true, score: 0, archetype: "noise", moduleScores: {}, timestamp: Date.now() }, ...prev].slice(0, 120);
            });
          }
          if (msg.type === "position_update") {
            setTokens(prev => prev.map(t =>
              t.tokenAddress === msg.tokenAddress ? { ...t, pnl: msg.pnl, trajectory: msg.trajectory, entrySignal: true } : t
            ));
          }
          if (msg.type === "trends") setTrends(msg.trends || []);
          if (msg.type === "fleet_stats") setFleet(msg.stats || {});
          if (msg.type === "attention_level") setHeatLevel(msg.intensity || 0.3);
        } catch {}
      };
      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => {};
      wsRef.current = ws;
    }
    connect();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [API, assignPos]);

  // Demo tokens
  useEffect(() => {
    if (tokens.length > 0) return;
    const demos = [
      { name: "FROGPEPE", symbol: "FRGPE", archetype: "camp_absurdist", score: 0.82 },
      { name: "CatGPT", symbol: "CATGPT", archetype: "cultural_catalyst", score: 0.71 },
      { name: "ELONDOGE", symbol: "EDOGE", archetype: "influencer_cascade", score: 0.65 },
      { name: "BasedChad", symbol: "BCHAD", archetype: "organic_runner", score: 0.78 },
      { name: "SKIBIDI", symbol: "SKBD", archetype: "camp_absurdist", score: 0.59 },
      { name: "SigmaInu", symbol: "SINU", archetype: "noise", score: 0.33 },
      { name: "RUG3000", symbol: "RUG3K", archetype: "rug_signal", score: 0.15 },
      { name: "MoonShib", symbol: "MSHIB", archetype: "noise", score: 0.42 },
      { name: "FARTKING", symbol: "FRTK", archetype: "camp_absurdist", score: 0.74 },
      { name: "TurboAI", symbol: "TURBO", archetype: "cultural_catalyst", score: 0.68 },
    ];
    const iv = setInterval(() => {
      const d = demos[Math.floor(Math.random() * demos.length)];
      setTokens(prev => [{ ...d, ...assignPos(), tokenAddress: Math.random().toString(36).slice(2, 14), isNew: true, timestamp: Date.now() - Math.random() * 120000,
        mcap: Math.round(1000 + Math.random() * 80000),
        moduleScores: { linguistic: .3+Math.random()*.5, visual: .3+Math.random()*.5, cultural: .2+Math.random()*.6, community: .2+Math.random()*.6, influencer: .1+Math.random()*.5, absurdity: .2+Math.random()*.7, temporal: .3+Math.random()*.4 },
        interactionBonuses: d.score > 0.7 ? [{ name: "memeplex_integration", multiplier: 1.15 }] : [],
      }, ...prev].slice(0, 60));
    }, 3500);
    return () => clearInterval(iv);
  }, [tokens.length, assignPos]);

  // Expire old tokens
  useEffect(() => {
    const iv = setInterval(() => setTokens(prev => prev.filter(t => Date.now() - t.timestamp < 300000)), 15000);
    return () => clearInterval(iv);
  }, []);

  // Keep selected token updated
  useEffect(() => {
    if (selected) {
      const updated = tokens.find(t => t.tokenAddress === selected.tokenAddress);
      if (updated && updated !== selected) setSelected(updated);
    }
  }, [tokens, selected]);

  return (
    <div style={{ background: C.bg, color: C.tx, fontFamily: M, height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 10, border: `1px solid ${C.bd}` }}>
      <style>{`
        @keyframes radarPulse { 0% { transform: translate(-50%,-50%) scale(0.3); opacity: 0; } 50% { transform: translate(-50%,-50%) scale(1.2); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); } }
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        .memetic-scroll::-webkit-scrollbar { width: 2px; } .memetic-scroll::-webkit-scrollbar-thumb { background: ${C.bd}; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${C.bd}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.gn, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 14, fontWeight: 900, fontFamily: S }}>MEMETIC RADAR</span>
          <span style={{ fontSize: 10, color: C.ft }}>{tokens.length} live</span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {/* View toggle */}
          <button onClick={() => setView(v => v === "radar" ? "list" : "radar")} style={{
            padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.bd}`, background: "none",
            fontSize: 10, fontWeight: 700, color: C.dm, cursor: "pointer", fontFamily: M,
          }}>{view === "radar" ? "LIST" : "RADAR"}</button>
          {/* Legend */}
          {Object.entries(ARCH_COLORS).slice(0, 4).map(([k, color]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
              <span style={{ fontSize: 8, color: C.ft }}>{ARCH_LABELS[k]?.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      <TrendRibbon trends={trends} />

      {/* Main area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        {view === "radar" ? (
          /* RADAR VIEW */
          <div style={{ flex: 1, position: "relative" }}>
            <Heatmap intensity={heatLevel} />
            <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
              backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
              backgroundSize: "50px 50px",
            }} />
            {/* Crosshair */}
            <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.02)", zIndex: 1, pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: 0, top: "50%", width: "100%", height: 1, background: "rgba(255,255,255,0.02)", zIndex: 1, pointerEvents: "none" }} />

            {tokens.map(t => <Dot key={t.tokenAddress} token={t} onClick={setSelected} selected={selected?.tokenAddress === t.tokenAddress} />)}

            <div style={{ position: "absolute", bottom: 6, left: 10, fontSize: 10, color: C.ft, zIndex: 10 }}>
              {tokens.length} tokens · {tokens.filter(t => (t.score || 0) > 0.6).length} hot
            </div>
          </div>
        ) : (
          /* LIST VIEW */
          <div style={{ flex: 1 }} className="memetic-scroll">
            <TokenList tokens={tokens} selected={selected} onSelect={setSelected} />
          </div>
        )}

        {/* Score panel */}
        <ScorePanel token={selected} onClose={() => setSelected(null)}
          onBuy={onBuy} user={user} tradingBalance={tradingBalance} solPrice={solPrice} />
      </div>

      <FleetBar stats={fleet} />
    </div>
  );
}
