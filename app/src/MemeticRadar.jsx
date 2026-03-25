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

// ═══ TOKEN IMAGE ═══
const radarImgProxy = (u, base) => !u ? "" : u.startsWith("data:") ? u : u.startsWith("/") ? u : (base || "") + "/api/img?url=" + encodeURIComponent(u);

function TImg({ src, symbol, size = 64, apiBase }) {
  const [ok, setOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retries, setRetries] = useState(0);
  const proxyUrl = radarImgProxy(src, apiBase);
  const letter = (symbol || "?")[0];
  const fallback = (
    <div style={{ width: size, height: size, borderRadius: 8, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 900, color: C.ft + "44" }}>
      {letter}
    </div>
  );
  if (!src || !ok) return fallback;
  const imgSrc = retries > 0 ? proxyUrl + "&_r=" + retries + "&_t=" + Date.now() : proxyUrl;
  return (
    <div style={{ width: size, height: size, position: "relative", borderRadius: 8, overflow: "hidden" }}>
      {!loaded && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 900, color: C.ft + "44", background: C.bg, zIndex: 1 }}>{letter}</div>}
      <img src={imgSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: loaded ? "blur(0)" : "blur(12px)", opacity: loaded ? 1 : 0.6, transform: loaded ? "scale(1)" : "scale(1.1)", transition: "filter .4s ease, opacity .4s ease, transform .4s ease" }} onLoad={() => setLoaded(true)} onError={() => { if (retries < 3) setTimeout(() => setRetries(r => r + 1), 500 * (retries + 1)); else setOk(false); }} />
    </div>
  );
}

// ═══ SCORE PANEL (slide-out with full detail) ═══
function ScorePanel({ token, onClose, onBuy, onSell, user, tradingBalance, solPrice, held, apiBase }) {
  const [buyAmt, setBuyAmt] = useState(0.1);
  const [buying, setBuying] = useState(false);
  const [selling, setSelling] = useState(false);
  const [buyResult, setBuyResult] = useState(null);
  if (!token) return null;

  const color = ARCH_COLORS[token.archetype] || C.dm;
  const bonuses = token.interactionBonuses || [];
  const age = Date.now() - (token.createdAt || token.timestamp || Date.now());
  const canBuy = user && !user.demo && onBuy && tradingBalance >= buyAmt;
  const isHeld = held?.has?.(token.tokenAddress) || held?.has?.(token.ca);

  const handleBuy = async () => {
    if (!canBuy || buying) return;
    setBuying(true); setBuyResult(null);
    try {
      const sig = await onBuy(token.tokenAddress || token.ca, buyAmt);
      setBuyResult({ ok: true, sig });
    } catch (e) { setBuyResult({ ok: false, err: e.message }); }
    setBuying(false);
  };

  const handleSell = async (pct) => {
    if (!onSell || selling) return;
    setSelling(true);
    try {
      await onSell(token.tokenAddress || token.ca, pct);
    } catch {}
    setSelling(false);
  };

  const fmtMcap = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };

  return (
    <div className="memetic-scroll" style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: 360,
      background: C.sf + "f8", borderLeft: `1px solid ${C.bd}`,
      backdropFilter: "blur(12px)", overflowY: "auto", zIndex: 200,
      animation: "slideInRight 0.25s cubic-bezier(.4,0,.2,1)",
    }}>
      {/* Header with image */}
      <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.bd}` }}>
        <TImg src={token.imageUri || token.image} symbol={token.symbol} size={72} apiBase={apiBase} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: C.tx }}>{token.name || token.symbol}</span>
            <span style={{ fontSize: 14, color: C.gn, fontWeight: 700 }}>{token.symbol || token.ticker}</span>
            {isHeld && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: C.gn + "18", color: C.gn }}>HELD</span>}
          </div>
          {/* Market cap + age */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 24, fontWeight: 900, color: (token.mcapUsd || token.mcap || 0) >= 100000 ? C.gn : C.tx, fontFamily: M }}>
              {fmtMcap(token.mcapUsd || token.mcap)}
            </span>
            {token.h1Change != null && <span style={{ fontSize: 14, fontWeight: 700, color: token.h1Change > 0 ? C.gn : C.rd }}>{token.h1Change > 0 ? "+" : ""}{token.h1Change.toFixed(1)}%</span>}
          </div>
          <div style={{ fontSize: 10, color: C.ft, fontFamily: M }}>{fmtAge(age)} old</div>
        </div>
        <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.bd}`, cursor: "pointer", color: C.dm, padding: "4px 8px", alignSelf: "flex-start", borderRadius: 5, fontSize: 13, fontFamily: M, fontWeight: 700 }}>×</button>
      </div>

      {/* Description */}
      {token.description && (
        <div style={{ padding: "6px 14px", fontSize: 12, color: C.dm, borderBottom: `1px solid ${C.bd}`, lineHeight: 1.5 }}>
          {token.description.length > 200 ? token.description.slice(0, 200) + "..." : token.description}
        </div>
      )}

      {/* Score + Archetype badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${C.bd}` }}>
        <div style={{ fontSize: 40, fontWeight: 900, color, fontFamily: M, lineHeight: 1 }}>{((token.score || 0) * 100).toFixed(0)}</div>
        <div>
          <div style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: color + "18", color, fontSize: 10, fontWeight: 800, marginBottom: 2 }}>
            {ARCH_LABELS[token.archetype] || "Unknown"}
          </div>
          {token.trajectory && <div style={{ fontSize: 9, color: C.dm }}>{token.trajectory.replace(/_/g, " ")}</div>}
          {token.entrySignal && <div style={{ fontSize: 9, color: C.gn, fontWeight: 700 }}>⚡ {token.entrySignal}</div>}
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          {token.memeticScore != null && <div style={{ fontSize: 10, color: C.dm }}>Memetic: {(token.memeticScore * 100).toFixed(0)}</div>}
          {token.elapsed != null && <div style={{ fontSize: 9, color: C.ft }}>{token.elapsed}ms</div>}
        </div>
      </div>

      {/* Social links + external */}
      <div style={{ display: "flex", gap: 3, padding: "6px 14px", borderBottom: `1px solid ${C.bd}`, flexWrap: "wrap" }}>
        {token.twitter && <a href={token.twitter.startsWith("http") ? token.twitter : "https://twitter.com/" + token.twitter.replace("@", "")} target="_blank" rel="noopener" style={linkStyle}>Twitter</a>}
        {token.telegram && <a href={token.telegram.startsWith("http") ? token.telegram : "https://t.me/" + token.telegram.replace("@", "")} target="_blank" rel="noopener" style={linkStyle}>Telegram</a>}
        {token.website && <a href={token.website.startsWith("http") ? token.website : "https://" + token.website} target="_blank" rel="noopener" style={linkStyle}>Website</a>}
        <a href={"https://pump.fun/coin/" + (token.tokenAddress || token.ca)} target="_blank" rel="noopener" style={{ ...linkStyle, background: C.gn + "08", borderColor: C.gn + "22", color: C.gn }}>pump.fun</a>
        <a href={"https://dexscreener.com/solana/" + (token.tokenAddress || token.ca)} target="_blank" rel="noopener" style={linkStyle}>dex</a>
        <a href={"https://www.gmgn.cc/sol/token/" + (token.tokenAddress || token.ca)} target="_blank" rel="noopener" style={linkStyle}>gmgn</a>
      </div>

      {/* BUY / SELL */}
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.bd}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.gn }}>BUY</span>
          {tradingBalance != null && <span style={{ fontSize: 10, color: C.ft, marginLeft: "auto" }}>{fmtSol(tradingBalance)} SOL avail</span>}
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
          {[0.05, 0.1, 0.25, 0.5, 1].map(amt => (
            <button key={amt} onClick={() => setBuyAmt(amt)} style={{
              flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: buyAmt === amt ? C.gn + "15" : C.bg,
              border: `1px solid ${buyAmt === amt ? C.gn + "44" : C.bd}`,
              color: buyAmt === amt ? C.gn : C.dm, cursor: "pointer", fontFamily: M,
            }}>{amt}</button>
          ))}
        </div>
        <button onClick={handleBuy} disabled={!canBuy || buying} style={{
          width: "100%", padding: "9px 0", borderRadius: 6, border: "none", fontSize: 14,
          fontWeight: 900, fontFamily: M, cursor: canBuy && !buying ? "pointer" : "not-allowed",
          background: canBuy ? `linear-gradient(135deg, ${C.gn}dd, ${C.gn}88)` : C.ft + "33",
          color: canBuy ? "#000" : C.ft, transition: "all 0.2s",
        }}>
          {buying ? "SENDING..." : !user ? "CONNECT WALLET" : user.demo ? "DEMO MODE" : `BUY ${buyAmt} SOL`}
        </button>
        {buyResult && <div style={{ fontSize: 10, marginTop: 3, color: buyResult.ok ? C.gn : C.rd, fontFamily: M }}>{buyResult.ok ? `Sent! ${buyResult.sig?.slice(0, 12)}...` : buyResult.err}{buyResult.ok && buyResult.verified && <span style={{ color: C.gn, marginLeft: 4, fontWeight: 800 }}>VERIFIED</span>}{buyResult.ok && buyResult.verified === false && <span style={{ color: C.yl || "#fa0", marginLeft: 4, fontWeight: 800 }}>VERIFYING...</span>}</div>}
        {/* Sell buttons if held */}
        {isHeld && onSell && (
          <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.rd, width: 32, alignSelf: "center" }}>SELL</span>
            {[25, 50, 100].map(pct => (
              <button key={pct} disabled={selling} onClick={() => handleSell(pct)} style={{
                flex: 1, padding: "7px 0", borderRadius: 5, fontSize: 12, fontWeight: 800,
                background: C.rd + "06", border: `1px solid ${C.rd}18`, color: C.rd, cursor: selling ? "default" : "pointer",
              }}>{pct === 100 ? "ALL" : pct + "%"}</button>
            ))}
          </div>
        )}
      </div>

      {/* Spider chart */}
      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
        <Spider scores={token.moduleScores} size={200} />
      </div>

      {/* Module scores */}
      <div style={{ padding: "0 14px 8px" }}>
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
        <div style={{ padding: "0 14px 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 4, color: C.tx }}>Memeplex Bonuses</div>
          {bonuses.map((b, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", background: C.gn + "06", borderRadius: 3, marginBottom: 1, fontSize: 10, fontFamily: M }}>
              <span style={{ color: C.gn }}>{b.name.replace(/_/g, " ")}</span>
              <span style={{ color: C.yl, fontWeight: 800 }}>×{b.multiplier.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* On-chain stats if available */}
      {(token.buys || token.sells || token.volumeSol || token.uniqueBuyers) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, padding: "6px 14px", borderTop: `1px solid ${C.bd}` }}>
          {[
            { l: "Buys", v: token.buys || 0, c: C.gn },
            { l: "Sells", v: token.sells || 0, c: C.rd },
            { l: "Buyers", v: token.uniqueBuyers || 0, c: C.cy },
            { l: "Vol", v: token.volumeSol ? fmtSol(token.volumeSol) : "—", c: C.or },
          ].map(s => (
            <div key={s.l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: s.c, fontFamily: M }}>{s.v}</div>
              <div style={{ fontSize: 8, color: C.ft, fontWeight: 700 }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* CA copy */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${C.bd}`, display: "flex", alignItems: "center" }}>
        <button onClick={() => navigator.clipboard?.writeText(token.tokenAddress || token.ca)} style={{
          padding: "4px 8px", background: "none", border: `1px solid ${C.bd}`, borderRadius: 4,
          fontSize: 9, color: C.ft, cursor: "pointer", fontFamily: M, wordBreak: "break-all", textAlign: "left", flex: 1,
        }}>{token.tokenAddress || token.ca}</button>
      </div>
    </div>
  );
}

const linkStyle = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px",
  background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)",
  borderRadius: 4, fontSize: 10, color: "#5c5c7a", textDecoration: "none", fontWeight: 600,
};

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

// ═══ PLATFORM STATS BAR (fees vs mcap) ═══
function PlatformBar({ platformStats }) {
  if (!platformStats) return null;
  const { fees, mcap, ratio, meta } = platformStats;

  const fmtUsd = (v) => {
    if (!v) return "$0";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 3, padding: "5px 12px", borderTop: `1px solid ${C.bd}`, background: C.bg }}>
      {[
        { l: "FEES", v: `${fmtSol(fees?.sessionSol || 0)}`, c: C.yl, sub: fmtUsd(fees?.sessionUsd) },
        { l: "LIFETIME", v: `${fmtSol(fees?.lifetimeSol || 0)}`, c: C.or, sub: fmtUsd(fees?.lifetimeUsd) },
        { l: "MCAP", v: fmtUsd(mcap?.combinedUsd), c: C.cy },
        { l: "GRAD MC", v: fmtUsd((mcap?.graduatedUsd || 0) + (mcap?.watchlistUsd || 0)), c: C.gn },
        { l: "FEE/MC", v: `${(ratio?.feeToMcapBps || 0).toFixed(1)}bp`, c: (ratio?.feeToMcapBps || 0) > 1 ? C.gn : C.dm },
        { l: "TOKENS", v: `${meta?.radarTokens || 0}`, c: C.dm, sub: `${meta?.graduatedCount || 0} grad` },
      ].map(s => (
        <div key={s.l} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: s.c, fontFamily: M }}>{s.v}</div>
          <div style={{ fontSize: 7, color: C.ft, fontWeight: 700, letterSpacing: ".08em" }}>
            {s.l}{s.sub ? <span style={{ color: C.dm, marginLeft: 3 }}>{s.sub}</span> : ""}
          </div>
        </div>
      ))}
    </div>
  );
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
            <div style={{ width: 28, height: 28, borderRadius: 5, overflow: "hidden", flexShrink: 0, background: C.bg, border: `1px solid ${color}22` }}>
              {(t.imageUri || t.image) ? <img src={radarImgProxy(t.imageUri || t.image, API)} alt="" style={{ width: 28, height: 28, objectFit: "cover", filter: "blur(12px)", opacity: 0.6, transform: "scale(1.1)", transition: "filter .4s ease, opacity .4s ease, transform .4s ease" }} onLoad={e => { e.target.style.filter = "blur(0)"; e.target.style.opacity = "1"; e.target.style.transform = "scale(1)"; }} onError={e => e.target.style.display = "none"} /> : <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: C.ft + "44" }}>{(t.symbol || "?")[0]}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: M, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.symbol || t.name}</div>
              <div style={{ fontSize: 9, color: C.ft }}>{fmtAge(age)} · {t.mcapUsd || t.mcap ? "$" + ((t.mcapUsd || t.mcap) >= 1000 ? ((t.mcapUsd || t.mcap) / 1000).toFixed(1) + "K" : (t.mcapUsd || t.mcap)) : "—"}</div>
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

// ═══ MINI SPARKLINE ═══
function MiniSpark({ data = [], width = 60, height = 20, color = C.gn }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

// ═══ GRADUATED TOKENS PANEL ═══
function GradPanel({ grads, onSelect, onBuy, user, tradingBalance, buying }) {
  if (!grads || grads.length === 0) return (
    <div style={{ padding: 30, textAlign: "center", color: C.dm, fontSize: 11 }}>No graduated tokens yet...</div>
  );

  const fmtMcap = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };

  return (
    <div style={{ overflowY: "auto", maxHeight: "100%", scrollbarWidth: "thin" }}>
      <div style={{ padding: "6px 10px", fontSize: 9, color: C.ft, borderBottom: `1px solid ${C.bd}`, display: "flex", justifyContent: "space-between" }}>
        <span>GRADUATED TOKENS — click to track & buy</span>
        <span>{grads.length} tracked</span>
      </div>
      {grads.map(g => {
        const isUp = (g.changePct || 0) > 0;
        const changeColor = isUp ? C.gn : g.changePct < -30 ? C.rd : C.or;
        const sparkColor = isUp ? C.gn : C.rd;
        return (
          <div key={g.ca} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            borderBottom: `1px solid ${C.bd}`, cursor: "pointer",
            transition: "background 0.15s",
          }} onClick={() => onSelect(g)}
            onMouseEnter={e => e.currentTarget.style.background = C.sf}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            {/* Image */}
            <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: C.bg, border: `1px solid ${C.bd}` }}>
              {g.image ? <img src={radarImgProxy(g.image, API)} alt="" style={{ width: 32, height: 32, objectFit: "cover", filter: "blur(12px)", opacity: 0.6, transform: "scale(1.1)", transition: "filter .4s ease, opacity .4s ease, transform .4s ease" }} onLoad={e => { e.target.style.filter = "blur(0)"; e.target.style.opacity = "1"; e.target.style.transform = "scale(1)"; }} onError={e => e.target.style.display = "none"} /> : <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: C.ft + "44" }}>{(g.ticker || g.name || "?")[0]}</div>}
            </div>

            {/* Name + Ticker */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.tx, fontFamily: M }}>{g.ticker || g.name}</span>
                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: C.gn + "12", color: C.gn, fontWeight: 700 }}>GRAD</span>
                {g.peakMultiple > 2 && <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: C.yl + "12", color: C.yl, fontWeight: 700 }}>{g.peakMultiple.toFixed(1)}x</span>}
              </div>
              <div style={{ fontSize: 9, color: C.ft, marginTop: 1 }}>
                {g.ageHours < 1 ? Math.round(g.ageHours * 60) + "m ago" : g.ageHours.toFixed(1) + "h ago"}
                {g.name && g.name !== g.ticker ? ` · ${g.name.slice(0, 20)}` : ""}
              </div>
            </div>

            {/* Sparkline */}
            <div style={{ flexShrink: 0 }}>
              <MiniSpark data={g.spark} width={50} height={18} color={sparkColor} />
            </div>

            {/* Price info */}
            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 65 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.tx, fontFamily: M }}>{fmtMcap(g.currentMcap)}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: changeColor, fontFamily: M }}>
                {isUp ? "+" : ""}{g.changePct?.toFixed(1)}%
              </div>
            </div>

            {/* Quick buy button */}
            <button
              onClick={(e) => { e.stopPropagation(); if (onBuy && user && !user.demo) onBuy(g.ca, 0.1); }}
              disabled={!user || user.demo || buying}
              style={{
                padding: "5px 8px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 800,
                background: user && !user.demo ? `linear-gradient(135deg, ${C.gn}cc, ${C.gn}66)` : C.ft + "22",
                color: user && !user.demo ? "#000" : C.ft,
                cursor: user && !user.demo && !buying ? "pointer" : "not-allowed",
                fontFamily: M, flexShrink: 0, whiteSpace: "nowrap",
              }}
            >BUY</button>
          </div>
        );
      })}
    </div>
  );
}

// ═══ RESURGENCE SIGNAL COLORS ═══
const RESURG_SIGNAL_COLORS = {
  STRONG_RESURGENCE: "#00e676",
  RESURGENCE: "#ffd600",
  WATCH: "#ff9100",
  WEAK: "#5c5c7a",
};

const RESURG_TYPE_LABELS = {
  smart_money_accumulation: "Smart Money",
  community_revival: "Community Revival",
  volume_breakout: "Volume Breakout",
  social_resurgence: "Social Resurgence",
  general: "General",
};

const RESURG_TYPE_COLORS = {
  smart_money_accumulation: "#b388ff",
  community_revival: "#18ffff",
  volume_breakout: "#ff9100",
  social_resurgence: "#ffd600",
  general: "#5c5c7a",
};

// ═══ RESURGENCE PANEL — Older coins having a revival ═══
function ResurgencePanel({ tokens, onSelect, onBuy, user, tradingBalance, buying, apiBase }) {
  if (!tokens || tokens.length === 0) return (
    <div style={{ padding: 30, textAlign: "center", color: C.dm, fontSize: 11 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, color: C.tx }}>RESURGENCE SCANNER</div>
      <div>Scanning for older coins (12h–2y) with renewed momentum...</div>
      <div style={{ marginTop: 8, fontSize: 10, color: C.ft }}>Looking for: smart money inflow, community growth, social revival</div>
    </div>
  );

  const API = apiBase;

  const fmtMcap = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };

  const fmtAgeLabel = (ageMs) => {
    if (!ageMs) return "?";
    const h = ageMs / 3600000;
    if (h < 24) return Math.round(h) + "h";
    const d = h / 24;
    if (d < 30) return Math.round(d) + "d";
    const mo = d / 30;
    if (mo < 12) return mo.toFixed(1) + "mo";
    return (d / 365).toFixed(1) + "y";
  };

  return (
    <div style={{ overflowY: "auto", maxHeight: "100%", scrollbarWidth: "thin" }}>
      <div style={{ padding: "6px 10px", fontSize: 9, color: C.ft, borderBottom: `1px solid ${C.bd}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>OLDER COINS RESURGENCE — smart money · community · social signals</span>
        <span>{tokens.filter(t => t.signal === "STRONG_RESURGENCE" || t.signal === "RESURGENCE").length} active</span>
      </div>

      {tokens.map(t => {
        const signalColor = RESURG_SIGNAL_COLORS[t.signal] || C.dm;
        const typeColor = RESURG_TYPE_COLORS[t.resurgenceType] || C.dm;
        const typeLabel = RESURG_TYPE_LABELS[t.resurgenceType] || t.resurgenceType;
        const isUp1h = (t.change1h || 0) > 0;
        const isUp24h = (t.change24h || 0) > 0;
        const f = t.features || {};

        return (
          <div key={t.ca} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            borderBottom: `1px solid ${C.bd}`, cursor: "pointer",
            transition: "background 0.15s",
          }} onClick={() => onSelect(t)}
            onMouseEnter={e => e.currentTarget.style.background = C.sf}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            {/* Image */}
            <div style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: C.bg, border: `1px solid ${C.bd}` }}>
              {t.image ? <img src={radarImgProxy(t.image, API)} alt="" style={{ width: 36, height: 36, objectFit: "cover", filter: "blur(12px)", opacity: 0.6, transform: "scale(1.1)", transition: "filter .4s ease, opacity .4s ease, transform .4s ease" }} onLoad={e => { e.target.style.filter = "blur(0)"; e.target.style.opacity = "1"; e.target.style.transform = "scale(1)"; }} onError={e => e.target.style.display = "none"} /> : <div style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: C.ft + "44" }}>{(t.ticker || t.name || "?")[0]}</div>}
            </div>

            {/* Name + Tags */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.tx, fontFamily: M }}>{t.ticker || t.name}</span>
                <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: signalColor + "15", color: signalColor, fontWeight: 700 }}>{t.signal?.replace(/_/g, " ")}</span>
                <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: typeColor + "12", color: typeColor, fontWeight: 700 }}>{typeLabel}</span>
              </div>
              <div style={{ fontSize: 9, color: C.ft, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span>{fmtAgeLabel(t.ageMs)} old</span>
                <span style={{ color: C.dm }}>·</span>
                <span>{fmtMcap(t.mcapUsd)}</span>
                {f.smartMoneyWallets > 0 && <><span style={{ color: C.dm }}>·</span><span style={{ color: C.pu, fontWeight: 700 }}>{f.smartMoneyWallets} smart wallet{f.smartMoneyWallets > 1 ? "s" : ""}</span></>}
                {f.smartMoneyConvergence && <span style={{ color: C.pu, fontWeight: 800 }}>CONVERGE</span>}
              </div>

              {/* Feature mini-bars */}
              <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                {[
                  { label: "SM", value: f.smartMoney || 0, color: "#b388ff" },
                  { label: "COM", value: f.communityGrowth || 0, color: "#18ffff" },
                  { label: "SOC", value: f.socialRevival || 0, color: "#ffd600" },
                  { label: "VOL", value: f.volumeSpike || 0, color: "#ff9100" },
                  { label: "REV", value: f.priceReversal || 0, color: "#00e676" },
                ].map(bar => (
                  <div key={bar.label} style={{ flex: 1 }} title={`${bar.label}: ${(bar.value * 100).toFixed(0)}%`}>
                    <div style={{ fontSize: 7, color: C.ft, textAlign: "center", marginBottom: 1 }}>{bar.label}</div>
                    <div style={{ height: 2, borderRadius: 1, background: C.bd }}>
                      <div style={{ height: 2, borderRadius: 1, background: bar.color, width: (bar.value * 100) + "%", transition: "width 0.5s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Price + Score */}
            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 60 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: signalColor, fontFamily: M }}>{((t.resurgenceScore || 0) * 100).toFixed(0)}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: isUp1h ? C.gn : C.rd, fontFamily: M }}>
                {isUp1h ? "+" : ""}{(t.change1h || 0).toFixed(1)}% <span style={{ fontSize: 8, color: C.ft }}>1h</span>
              </div>
              <div style={{ fontSize: 9, color: isUp24h ? C.gn : C.rd, fontFamily: M }}>
                {isUp24h ? "+" : ""}{(t.change24h || 0).toFixed(1)}% <span style={{ fontSize: 8, color: C.ft }}>24h</span>
              </div>
            </div>

            {/* Quick buy button */}
            <button
              onClick={(e) => { e.stopPropagation(); if (onBuy && user && !user.demo) onBuy(t.ca, 0.1); }}
              disabled={!user || user.demo || buying}
              style={{
                padding: "5px 8px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 800,
                background: user && !user.demo ? `linear-gradient(135deg, ${C.gn}cc, ${C.gn}66)` : C.ft + "22",
                color: user && !user.demo ? "#000" : C.ft,
                cursor: user && !user.demo && !buying ? "pointer" : "not-allowed",
                fontFamily: M, flexShrink: 0, whiteSpace: "nowrap",
              }}
            >BUY</button>
          </div>
        );
      })}
    </div>
  );
}

// ═══ MAIN COMPONENT ═══
export default function MemeticRadar({ apiBase, onBuy, onSell, user, tradingBalance, solPrice, held }) {
  const API = apiBase || "https://bondli-production.up.railway.app";
  const [tokens, setTokens] = useState([]);
  const [selected, setSelected] = useState(null);
  const [trends, setTrends] = useState([]);
  const [fleet, setFleet] = useState({});
  const [heatLevel, setHeatLevel] = useState(0.3);
  const [view, setView] = useState("radar"); // "radar", "list", "grads", or "resurgence"
  const [grads, setGrads] = useState([]);
  const [gradBuying, setGradBuying] = useState(false);
  const [resurgenceTokens, setResurgenceTokens] = useState([]);
  const [resurgenceBuying, setResurgenceBuying] = useState(false);
  const [platformStats, setPlatformStats] = useState(null);
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
          if (msg.event === "graduation") {
            // Refresh graduated list when a new token graduates
            fetchGrads();
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

  // Fetch graduated tokens
  const fetchGrads = useCallback(async () => {
    try {
      const r = await fetch(API + "/api/graduated");
      if (r.ok) { const d = await r.json(); setGrads(d.graduated || []); }
    } catch {}
  }, [API]);

  useEffect(() => {
    fetchGrads();
    const iv = setInterval(fetchGrads, 15000);
    return () => clearInterval(iv);
  }, [fetchGrads]);

  // Fetch resurgence tokens (older coins with renewed momentum)
  const fetchResurgence = useCallback(async () => {
    try {
      const r = await fetch(API + "/api/resurgence");
      if (r.ok) { const d = await r.json(); setResurgenceTokens(d.tokens || []); }
    } catch {}
  }, [API]);

  useEffect(() => {
    fetchResurgence();
    const iv = setInterval(fetchResurgence, 30000); // refresh every 30s
    return () => clearInterval(iv);
  }, [fetchResurgence]);

  // Fetch platform stats (fees vs mcap)
  useEffect(() => {
    const fetchPlatform = async () => {
      try {
        const r = await fetch(API + "/api/platform-stats");
        if (r.ok) setPlatformStats(await r.json());
      } catch {}
    };
    fetchPlatform();
    const iv = setInterval(fetchPlatform, 10000); // refresh every 10s
    return () => clearInterval(iv);
  }, [API]);

  // Handle buy from grad panel
  const handleGradBuy = useCallback(async (ca, amt) => {
    if (!onBuy || gradBuying) return;
    setGradBuying(true);
    try { await onBuy(ca, amt); } catch {}
    setGradBuying(false);
  }, [onBuy, gradBuying]);

  // Handle buy from resurgence panel
  const handleResurgenceBuy = useCallback(async (ca, amt) => {
    if (!onBuy || resurgenceBuying) return;
    setResurgenceBuying(true);
    try { await onBuy(ca, amt); } catch {}
    setResurgenceBuying(false);
  }, [onBuy, resurgenceBuying]);

  // When a resurgence token is clicked, select it
  const handleResurgenceSelect = useCallback((t) => {
    setSelected({
      tokenAddress: t.ca, ca: t.ca, name: t.name, symbol: t.ticker, ticker: t.ticker,
      image: t.image, mcapUsd: t.mcapUsd, mcap: t.mcapUsd,
      score: t.resurgenceScore || 0, archetype: "organic_runner",
      moduleScores: {},
      twitter: t.twitter, telegram: t.telegram, website: t.website,
      resurgence: true, resurgenceType: t.resurgenceType,
      features: t.features,
    });
  }, []);

  // When a grad token is clicked, select it (opens score panel if on radar, or navigate)
  const handleGradSelect = useCallback((g) => {
    // Try to find on radar first
    const radarToken = tokens.find(t => (t.tokenAddress || t.ca) === g.ca);
    if (radarToken) {
      setSelected(radarToken);
    } else {
      // Build a pseudo-token for the score panel
      setSelected({
        tokenAddress: g.ca, ca: g.ca, name: g.name, symbol: g.ticker, ticker: g.ticker,
        image: g.image, mcapUsd: g.currentMcap, mcap: g.currentMcap,
        score: 0, archetype: "organic_runner", graduated: true,
        spark: g.spark, moduleScores: {},
      });
    }
  }, [tokens]);

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
          {["radar", "list", "grads", "resurgence"].map(v => {
            const isResurg = v === "resurgence";
            const activeColor = isResurg ? C.pu : C.gn;
            const resurgActive = resurgenceTokens.filter(t => t.signal === "STRONG_RESURGENCE" || t.signal === "RESURGENCE").length;
            let label = v.toUpperCase();
            if (v === "grads") label = `GRADS${grads.length ? ` (${grads.length})` : ""}`;
            if (v === "resurgence") label = `RESURG${resurgActive ? ` (${resurgActive})` : ""}`;
            return (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "3px 8px", borderRadius: 4,
                border: `1px solid ${view === v ? activeColor + "44" : C.bd}`,
                background: view === v ? activeColor + "0a" : "none",
                fontSize: 10, fontWeight: 700,
                color: view === v ? activeColor : C.dm,
                cursor: "pointer", fontFamily: M,
              }}>
                {label}
              </button>
            );
          })}
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
        ) : view === "grads" ? (
          /* GRADUATED VIEW */
          <div style={{ flex: 1 }} className="memetic-scroll">
            <GradPanel grads={grads} onSelect={handleGradSelect} onBuy={handleGradBuy} user={user} tradingBalance={tradingBalance} buying={gradBuying} />
          </div>
        ) : view === "resurgence" ? (
          /* RESURGENCE VIEW — older coins with renewed momentum */
          <div style={{ flex: 1 }} className="memetic-scroll">
            <ResurgencePanel tokens={resurgenceTokens} onSelect={handleResurgenceSelect} onBuy={handleResurgenceBuy} user={user} tradingBalance={tradingBalance} buying={resurgenceBuying} apiBase={API} />
          </div>
        ) : (
          /* LIST VIEW */
          <div style={{ flex: 1 }} className="memetic-scroll">
            <TokenList tokens={tokens} selected={selected} onSelect={setSelected} />
          </div>
        )}

        {/* Score panel */}
        <ScorePanel token={selected} onClose={() => setSelected(null)}
          onBuy={onBuy} onSell={onSell} user={user} tradingBalance={tradingBalance} solPrice={solPrice} held={held} apiBase={API} />
      </div>

      <PlatformBar platformStats={platformStats} />
      <FleetBar stats={fleet} />
    </div>
  );
}
