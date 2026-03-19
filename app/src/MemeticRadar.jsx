import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══ MEMETIC RADAR — PULSE UI ═══
// Live radar where every new pump.fun token appears, scores in real-time,
// and pulses with intensity proportional to composite score.

const M = "'IBM Plex Mono','SF Mono',monospace";
const S = "'Nunito','Helvetica Neue',sans-serif";

const COLORS = {
  bg: "#06060a", sf: "#0c0c14", bd: "rgba(255,255,255,.06)",
  gn: "#00e676", yl: "#ffd600", or: "#ff9100", rd: "#ff1744",
  pu: "#b388ff", cy: "#18ffff", tx: "#cccce0", dm: "#5c5c7a", ft: "#3a3a50",
};

// Archetype color map
const ARCHETYPE_COLORS = {
  organic_runner: "#00e676",    // green
  cultural_catalyst: "#ff9100", // orange
  camp_absurdist: "#b388ff",    // purple
  influencer_cascade: "#18ffff",// cyan
  rug_signal: "#ff1744",        // red
  noise: "#5c5c7a",             // gray
};

const ARCHETYPE_LABELS = {
  organic_runner: "Organic Runner",
  cultural_catalyst: "Cultural Catalyst",
  camp_absurdist: "Camp / Absurdist",
  influencer_cascade: "Influencer Cascade",
  rug_signal: "Rug Signal",
  noise: "Noise",
};

const MODULE_LABELS = {
  linguistic: "Linguistic",
  visual: "Visual",
  cultural: "Cultural Timing",
  community: "Community",
  influencer: "Influencer",
  absurdity: "Absurdity",
  temporal: "Temporal",
};

const MODULE_COLORS = {
  linguistic: "#00e676",
  visual: "#ff9100",
  cultural: "#ffd600",
  community: "#18ffff",
  influencer: "#b388ff",
  absurdity: "#ff1744",
  temporal: "#e040fb",
};

// ═══ SPIDER CHART ═══
function SpiderChart({ scores = {}, size = 200 }) {
  const modules = Object.keys(MODULE_LABELS);
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const angleStep = (2 * Math.PI) / modules.length;

  const getPoint = (index, value) => {
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: cx + r * value * Math.cos(angle),
      y: cy + r * value * Math.sin(angle),
    };
  };

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Data polygon
  const points = modules.map((mod, i) => getPoint(i, scores[mod] ?? 0.5));
  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {rings.map(ring => (
        <polygon key={ring} points={modules.map((_, i) => {
          const p = getPoint(i, ring);
          return `${p.x},${p.y}`;
        }).join(" ")} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      ))}

      {/* Axis lines */}
      {modules.map((_, i) => {
        const p = getPoint(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />;
      })}

      {/* Data polygon */}
      <polygon points={polygonPoints} fill="rgba(0,230,118,0.12)" stroke="#00e676" strokeWidth="1.5" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={MODULE_COLORS[modules[i]]} />
      ))}

      {/* Labels */}
      {modules.map((mod, i) => {
        const p = getPoint(i, 1.25);
        return (
          <text key={mod} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
            fill={MODULE_COLORS[mod]} fontSize="9" fontFamily={M} fontWeight="700">
            {MODULE_LABELS[mod]}
          </text>
        );
      })}
    </svg>
  );
}

// ═══ TOKEN PULSE DOT ═══
function PulseDot({ token, onClick, isSelected }) {
  const color = ARCHETYPE_COLORS[token.archetype] || COLORS.dm;
  const size = 8 + (token.score || 0) * 24; // 8-32px based on score
  const opacity = 0.3 + (token.score || 0) * 0.7;

  return (
    <div
      onClick={() => onClick(token)}
      style={{
        position: "absolute",
        left: token.x + "%",
        top: token.y + "%",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        opacity,
        cursor: "pointer",
        transform: "translate(-50%, -50%)",
        transition: "all 0.5s ease",
        border: isSelected ? `2px solid ${COLORS.tx}` : "none",
        boxShadow: token.score > 0.65 ? `0 0 ${size}px ${color}44` : "none",
        animation: token.isNew ? "radarPulse 1s ease-out" : "none",
        zIndex: Math.round(token.score * 100),
      }}
      title={`${token.symbol} — ${(token.score * 100).toFixed(0)}pts — ${ARCHETYPE_LABELS[token.archetype] || "Unknown"}`}
    >
      {token.score > 0.65 && (
        <span style={{
          position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)",
          fontSize: 9, fontFamily: M, fontWeight: 800, color, whiteSpace: "nowrap",
        }}>
          {token.symbol}
        </span>
      )}
      {token.entrySignal && (
        <span style={{
          position: "absolute", bottom: -12, left: "50%", transform: "translateX(-50%)",
          fontSize: 11, color: COLORS.yl,
        }}>⚡</span>
      )}
    </div>
  );
}

// ═══ SCORE BREAKDOWN PANEL ═══
function ScorePanel({ token, onClose }) {
  if (!token) return null;

  const color = ARCHETYPE_COLORS[token.archetype] || COLORS.dm;
  const bonuses = token.interactionBonuses || [];

  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: 340,
      background: COLORS.sf, borderLeft: `1px solid ${COLORS.bd}`,
      overflowY: "auto", zIndex: 200, padding: 16,
      animation: "slideInRight 0.3s ease",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.tx, fontFamily: M }}>{token.symbol}</div>
          <div style={{ fontSize: 12, color: COLORS.dm }}>{token.name}</div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: COLORS.dm, fontSize: 20, cursor: "pointer",
        }}>×</button>
      </div>

      {/* Score */}
      <div style={{ textAlign: "center", padding: "12px 0", marginBottom: 12 }}>
        <div style={{ fontSize: 48, fontWeight: 900, color, fontFamily: M }}>
          {(token.score * 100).toFixed(0)}
        </div>
        <div style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 4,
          background: color + "22", color, fontSize: 11, fontWeight: 800,
        }}>
          {ARCHETYPE_LABELS[token.archetype] || "Unknown"}
        </div>
      </div>

      {/* Spider chart */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <SpiderChart scores={token.moduleScores} size={220} />
      </div>

      {/* Module scores */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: COLORS.tx }}>Module Scores</div>
        {Object.entries(MODULE_LABELS).map(([key, label]) => {
          const score = token.moduleScores?.[key] ?? 0.5;
          const pct = (score * 100).toFixed(0);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: MODULE_COLORS[key] }} />
              <span style={{ fontSize: 11, color: COLORS.dm, flex: 1, fontFamily: M }}>{label}</span>
              <div style={{ width: 80, height: 3, borderRadius: 2, background: COLORS.bd }}>
                <div style={{
                  height: 3, borderRadius: 2, background: MODULE_COLORS[key],
                  width: pct + "%", transition: "width 0.5s",
                }} />
              </div>
              <span style={{ fontSize: 11, color: MODULE_COLORS[key], fontWeight: 700, fontFamily: M, width: 28, textAlign: "right" }}>
                {pct}
              </span>
            </div>
          );
        })}
      </div>

      {/* Interaction bonuses */}
      {bonuses.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: COLORS.tx }}>Memeplex Bonuses</div>
          {bonuses.map((b, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", padding: "4px 8px",
              background: COLORS.gn + "08", borderRadius: 4, marginBottom: 2,
              fontSize: 11, fontFamily: M,
            }}>
              <span style={{ color: COLORS.gn }}>{b.name.replace(/_/g, " ")}</span>
              <span style={{ color: COLORS.yl, fontWeight: 800 }}>×{b.multiplier.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Token address */}
      <div style={{ fontSize: 10, color: COLORS.ft, fontFamily: M, wordBreak: "break-all", marginTop: 8 }}>
        {token.tokenAddress}
      </div>
    </div>
  );
}

// ═══ TREND RIBBON ═══
function TrendRibbon({ trends = [] }) {
  return (
    <div style={{
      display: "flex", gap: 8, padding: "6px 12px", overflowX: "auto",
      borderBottom: `1px solid ${COLORS.bd}`, background: COLORS.sf,
      scrollbarWidth: "none", msOverflowStyle: "none",
    }}>
      <span style={{ fontSize: 10, color: COLORS.ft, fontWeight: 700, flexShrink: 0, alignSelf: "center" }}>TRENDS</span>
      {trends.length === 0 && (
        <span style={{ fontSize: 11, color: COLORS.dm }}>Scanning for active cultural moments...</span>
      )}
      {trends.map((trend, i) => (
        <span key={i} style={{
          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
          background: COLORS.yl + "12", color: COLORS.yl, whiteSpace: "nowrap",
          fontFamily: M, flexShrink: 0,
        }}>
          {trend.name} <span style={{ color: COLORS.ft, fontWeight: 400 }}>({trend.tokens || 0})</span>
        </span>
      ))}
    </div>
  );
}

// ═══ ATTENTION HEATMAP BACKGROUND ═══
function AttentionHeatmap({ intensity = 0.5 }) {
  const alpha = Math.round(intensity * 15).toString(16).padStart(2, "0");
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `radial-gradient(ellipse at center, ${COLORS.pu}${alpha} 0%, transparent 70%)`,
      pointerEvents: "none", zIndex: 0,
    }} />
  );
}

// ═══ FLEET DASHBOARD ═══
function FleetDashboard({ stats = {} }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4,
      padding: "8px 12px", borderTop: `1px solid ${COLORS.bd}`, background: COLORS.sf,
    }}>
      {[
        { label: "BALANCE", value: `${(stats.balance || 0).toFixed(2)} SOL`, color: COLORS.tx },
        { label: "POSITIONS", value: stats.positions || 0, color: COLORS.cy },
        { label: "DAILY PnL", value: `${stats.dailyPnl > 0 ? "+" : ""}${(stats.dailyPnl || 0).toFixed(3)}`, color: stats.dailyPnl >= 0 ? COLORS.gn : COLORS.rd },
        { label: "WIN RATE", value: `${(stats.winRate || 0).toFixed(0)}%`, color: stats.winRate > 50 ? COLORS.gn : COLORS.yl },
        { label: "SHARPE", value: (stats.sharpe || 0).toFixed(2), color: stats.sharpe > 1 ? COLORS.gn : COLORS.yl },
        { label: "SCANNED", value: stats.tokensScanned || 0, color: COLORS.dm },
      ].map(s => (
        <div key={s.label} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: s.color, fontFamily: M }}>{s.value}</div>
          <div style={{ fontSize: 9, color: COLORS.ft, fontWeight: 700, letterSpacing: "0.1em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ═══ MAIN RADAR COMPONENT ═══
export default function MemeticRadar({ apiBase }) {
  const API = apiBase || "https://bondli-production.up.railway.app";
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [trends, setTrends] = useState([]);
  const [fleetStats, setFleetStats] = useState({});
  const [attentionIntensity, setAttentionIntensity] = useState(0.3);
  const wsRef = useRef(null);

  // Assign radar positions to tokens
  const assignPosition = useCallback(() => ({
    x: 10 + Math.random() * 80,
    y: 10 + Math.random() * 80,
  }), []);

  // WebSocket connection for real-time updates
  useEffect(() => {
    function connect() {
      const wsUrl = API.replace("https://", "wss://").replace("http://", "ws://") + "/ws";
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === "token_scored") {
            setTokens(prev => {
              const existing = prev.find(t => t.tokenAddress === msg.tokenAddress);
              if (existing) {
                return prev.map(t => t.tokenAddress === msg.tokenAddress
                  ? { ...t, ...msg, isNew: false }
                  : t
                );
              }
              const pos = assignPosition();
              return [{ ...msg, ...pos, isNew: true, timestamp: Date.now() }, ...prev].slice(0, 100);
            });
          }

          if (msg.type === "token_detected") {
            setTokens(prev => {
              if (prev.find(t => t.tokenAddress === msg.tokenAddress)) return prev;
              const pos = assignPosition();
              return [{
                ...msg, ...pos, isNew: true, score: 0, archetype: "noise",
                moduleScores: {}, timestamp: Date.now(),
              }, ...prev].slice(0, 100);
            });
          }

          if (msg.type === "position_update") {
            // Update token with position data
            setTokens(prev => prev.map(t =>
              t.tokenAddress === msg.tokenAddress
                ? { ...t, pnl: msg.pnl, trajectory: msg.trajectory, entrySignal: true }
                : t
            ));
          }

          if (msg.type === "trends") {
            setTrends(msg.trends || []);
          }

          if (msg.type === "fleet_stats") {
            setFleetStats(msg.stats || {});
          }

          if (msg.type === "attention_level") {
            setAttentionIntensity(msg.intensity || 0.3);
          }
        } catch {}
      };

      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => {};
      wsRef.current = ws;
    }

    connect();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [API, assignPosition]);

  // Simulate tokens for demo when no WS data
  useEffect(() => {
    if (tokens.length > 0) return;

    const demoNames = [
      { name: "FROGPEPE", symbol: "FRGPE", archetype: "camp_absurdist", score: 0.82 },
      { name: "CatGPT", symbol: "CATGPT", archetype: "cultural_catalyst", score: 0.71 },
      { name: "ELONDOGE", symbol: "EDOGE", archetype: "influencer_cascade", score: 0.65 },
      { name: "BasedChad", symbol: "BCHAD", archetype: "organic_runner", score: 0.78 },
      { name: "SKIBIDI", symbol: "SKBD", archetype: "camp_absurdist", score: 0.59 },
      { name: "SigmaInu", symbol: "SINU", archetype: "noise", score: 0.33 },
      { name: "RUG3000", symbol: "RUG3K", archetype: "rug_signal", score: 0.15 },
      { name: "MoonShib", symbol: "MSHIB", archetype: "noise", score: 0.42 },
    ];

    const interval = setInterval(() => {
      const demo = demoNames[Math.floor(Math.random() * demoNames.length)];
      const pos = assignPosition();
      setTokens(prev => [{
        ...demo, ...pos,
        tokenAddress: Math.random().toString(36).slice(2, 14),
        isNew: true,
        timestamp: Date.now(),
        moduleScores: {
          linguistic: 0.3 + Math.random() * 0.5,
          visual: 0.3 + Math.random() * 0.5,
          cultural: 0.2 + Math.random() * 0.6,
          community: 0.2 + Math.random() * 0.6,
          influencer: 0.1 + Math.random() * 0.5,
          absurdity: 0.2 + Math.random() * 0.7,
          temporal: 0.3 + Math.random() * 0.4,
        },
        interactionBonuses: demo.score > 0.7 ? [
          { name: "memeplex_integration", multiplier: 1.15 },
        ] : [],
      }, ...prev].slice(0, 50));
    }, 4000);

    return () => clearInterval(interval);
  }, [tokens.length, assignPosition]);

  // Fade old tokens
  useEffect(() => {
    const interval = setInterval(() => {
      setTokens(prev => prev.filter(t => Date.now() - t.timestamp < 120000));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      background: COLORS.bg, color: COLORS.tx, fontFamily: M,
      height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <style>{`
        @keyframes radarPulse { 0% { transform: translate(-50%,-50%) scale(0.5); opacity: 0; } 50% { transform: translate(-50%,-50%) scale(1.3); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        ::-webkit-scrollbar { width: 2px; } ::-webkit-scrollbar-thumb { background: ${COLORS.bd}; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: `1px solid ${COLORS.bd}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.gn, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 18, fontWeight: 900, fontFamily: S }}>BONDLI</span>
          <span style={{ fontSize: 11, color: COLORS.gn + "88", fontWeight: 700, letterSpacing: "0.12em" }}>MEMETIC RADAR</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Archetype legend */}
          {Object.entries(ARCHETYPE_COLORS).slice(0, 5).map(([key, color]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
              <span style={{ fontSize: 9, color: COLORS.dm }}>{ARCHETYPE_LABELS[key]?.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trend ribbon */}
      <TrendRibbon trends={trends} />

      {/* Main radar area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <AttentionHeatmap intensity={attentionIntensity} />

        {/* Radar grid lines */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
        }} />

        {/* Radar crosshair */}
        <div style={{
          position: "absolute", left: "50%", top: "50%", width: 1, height: "100%",
          background: "rgba(255,255,255,0.03)", transform: "translateX(-50%)", zIndex: 1, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", left: 0, top: "50%", width: "100%", height: 1,
          background: "rgba(255,255,255,0.03)", transform: "translateY(-50%)", zIndex: 1, pointerEvents: "none",
        }} />

        {/* Token pulse dots */}
        {tokens.map(token => (
          <PulseDot
            key={token.tokenAddress}
            token={token}
            onClick={setSelectedToken}
            isSelected={selectedToken?.tokenAddress === token.tokenAddress}
          />
        ))}

        {/* Score breakdown panel */}
        <ScorePanel token={selectedToken} onClose={() => setSelectedToken(null)} />

        {/* Token count */}
        <div style={{
          position: "absolute", bottom: 8, left: 12, fontSize: 11,
          color: COLORS.ft, fontFamily: M, zIndex: 10,
        }}>
          {tokens.length} tokens on radar
        </div>
      </div>

      {/* Fleet dashboard */}
      <FleetDashboard stats={fleetStats} />
    </div>
  );
}
