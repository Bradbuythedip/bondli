import { useState, useEffect, useRef, useCallback } from "react";

// ═══ MEME INTELLIGENCE DASHBOARD ═══
// Drop into bondli as a tab or standalone page
// Connects to /api/intel/* endpoints

const M = "'IBM Plex Mono','SF Mono',monospace";
const S = "'Nunito','Helvetica Neue',sans-serif";

const COLORS = {
  bg: "#06060a", sf: "#0c0c14", bd: "rgba(255,255,255,.06)",
  gn: "#00e676", yl: "#ffd600", or: "#ff9100", rd: "#ff1744", pu: "#b388ff", cy: "#18ffff",
  tx: "#cccce0", dm: "#5c5c7a", ft: "#3a3a50",
};

const PHASE_COLORS = { tp: "#00e676", k: "#ffd600", oc: "#ff9100", rg: "#ff1744", so: "#b388ff", mt: "#18ffff" };
const PHASE_LABELS = { tp: "Tipping Point", k: "Kahneman", oc: "On-Chain", rg: "Rug Detection", so: "Social", mt: "Timing" };

function Bar({ value, max = 100, color, label, width }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 6 }}>
      {label && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 12, color: COLORS.dm, fontFamily: M }}>{label}</span>
        <span style={{ fontSize: 12, color, fontFamily: M, fontWeight: 700 }}>{value}</span>
      </div>}
      <div style={{ height: 3, borderRadius: 2, background: COLORS.bd, width: width || "100%" }}>
        <div style={{ height: 3, borderRadius: 2, background: color, width: pct + "%", transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "10px 6px", background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 8 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: color || COLORS.gn, fontFamily: M }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.ft, fontWeight: 700, letterSpacing: "0.08em", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: COLORS.dm, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function EventRow({ event }) {
  const isScore = event.type === "score";
  const isLearn = event.type === "learn";
  const age = Math.round((Date.now() - event.time) / 60000);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
      borderBottom: "1px solid " + COLORS.bd, fontSize: 13, fontFamily: M,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: isScore ? COLORS.gn : isLearn ? COLORS.yl : COLORS.dm,
      }} />
      <span style={{ color: isScore ? COLORS.gn : COLORS.yl, fontWeight: 700, width: 40 }}>
        {event.type.toUpperCase()}
      </span>
      <span style={{ color: COLORS.dm, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {event.data?.ca?.slice(0, 8)}
        {isScore && ` → ${event.data.score}pts ${event.data.bondProb}% bond`}
        {isLearn && ` → err:${event.data.error?.toFixed(3)} acc:${event.data.accuracy}%`}
      </span>
      <span style={{ color: COLORS.ft, fontSize: 11, flexShrink: 0 }}>{age}m</span>
    </div>
  );
}

function FeatureWeight({ feature, weight }) {
  const group = feature.split("_")[0];
  const color = PHASE_COLORS[group] || COLORS.dm;
  const label = feature.replace(/^[a-z]+_/, "");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: COLORS.dm, flex: 1, fontFamily: M }}>{label}</span>
      <div style={{ width: 60, height: 3, borderRadius: 2, background: COLORS.bd }}>
        <div style={{ height: 3, borderRadius: 2, background: color, width: Math.min(100, (weight / 3) * 100) + "%", transition: "width 0.5s" }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 700, fontFamily: M, width: 28, textAlign: "right" }}>{weight}</span>
    </div>
  );
}

// ═══ LIVE SCORING DEMO ═══
// Simulates the intelligence engine scoring tokens in real-time

function LiveScoringDemo() {
  const [tokens, setTokens] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const names = ["FROGPEPE", "CATGPT", "ELONDOGE", "MOONSHIB", "BASEDCHAD", "SIGMAINU", "AIFROG", "DEGENCAT", "PUMPDAO", "SOLANAMOON", "WOJAK2", "RIZZCOIN", "SKIBIDI", "BONKAI", "PEPEMOON"];
    const iv = setInterval(() => {
      setTick(t => t + 1);
      setTokens(prev => {
        const rugRisk = Math.random() < 0.2 ? Math.round(40 + Math.random() * 50) : Math.round(Math.random() * 30);
        const newToken = {
          name: names[Math.floor(Math.random() * names.length)],
          ca: Math.random().toString(36).slice(2, 10),
          score: Math.round(20 + Math.random() * 70),
          bondProb: Math.round(5 + Math.random() * 80),
          tipping: Math.round(10 + Math.random() * 80),
          kahneman: Math.round(10 + Math.random() * 80),
          velocity: Math.round(5 + Math.random() * 90),
          mcap: Math.round(1000 + Math.random() * 60000),
          rugRisk,
          rugFlags: rugRisk > 50 ? ["dev_dumping", "coordinated_sells"].slice(0, Math.ceil(Math.random() * 2)) : [],
          age: 0,
          similar: Math.round(Math.random() * 5),
          graduated: false,
        };
        // Age existing, graduate some
        const aged = prev.map(t => ({
          ...t, age: t.age + 1,
          graduated: t.age > 8 && t.score > 65 && Math.random() > 0.6 ? true : t.graduated,
        })).filter(t => t.age < 20);
        return [newToken, ...aged].slice(0, 12);
      });
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid " + COLORS.bd, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.gn, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 16, fontWeight: 800, fontFamily: M }}>Live Scoring</span>
        </div>
        <span style={{ fontSize: 12, color: COLORS.ft }}>{tokens.length} tracked</span>
      </div>
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {tokens.map((t, i) => (
          <div key={t.ca + i} style={{
            display: "grid", gridTemplateColumns: "1fr 50px 50px 50px 60px",
            gap: 4, padding: "6px 12px", borderBottom: "1px solid " + COLORS.bd,
            opacity: t.age < 2 ? 1 : 0.5 + 0.5 * (1 - t.age / 20),
            background: t.graduated ? COLORS.gn + "06" : t.score > 70 ? COLORS.yl + "04" : "transparent",
            animation: i === 0 ? "slideIn 0.3s ease" : "none",
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.tx, fontFamily: M }}>{t.name}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 11, color: COLORS.ft }}>{t.ca}</span>
                {t.graduated && <span style={{ fontSize: 10, padding: "0 3px", borderRadius: 2, background: COLORS.gn + "22", color: COLORS.gn, fontWeight: 800 }}>GRADUATED</span>}
                {t.rugRisk > 50 && <span style={{ fontSize: 10, padding: "0 3px", borderRadius: 2, background: COLORS.rd + "22", color: COLORS.rd, fontWeight: 800 }}>RUG RISK</span>}
                {t.similar > 0 && <span style={{ fontSize: 10, color: COLORS.pu }}>~{t.similar} similar</span>}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: t.score > 70 ? COLORS.gn : t.score > 40 ? COLORS.yl : COLORS.rd, fontFamily: M }}>{t.score}</div>
              <div style={{ fontSize: 10, color: COLORS.ft }}>SCORE</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: t.bondProb > 60 ? COLORS.gn : t.bondProb > 30 ? COLORS.yl : COLORS.ft, fontFamily: M }}>{t.bondProb}%</div>
              <div style={{ fontSize: 10, color: COLORS.ft }}>BOND</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.or, fontFamily: M }}>{t.velocity}</div>
              <div style={{ fontSize: 10, color: COLORS.ft }}>VEL</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.mcap > 30000 ? COLORS.yl : COLORS.tx, fontFamily: M }}>${t.mcap > 1000 ? (t.mcap / 1000).toFixed(1) + "K" : t.mcap}</div>
              <div style={{ fontSize: 10, color: COLORS.ft }}>MC</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ MAIN DASHBOARD ═══

export default function IntelDashboard({ apiBase }) {
  const API = apiBase || "https://bondli-production.up.railway.app";
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState("live");
  const [smartMoney, setSmartMoney] = useState(null);
  const [watchInput, setWatchInput] = useState("");

  // Poll stats
  useEffect(() => {
    const f = async () => {
      try {
        const r = await fetch(API + "/api/intel/stats");
        if (r.ok) setStats(await r.json());
      } catch {}
    };
    f();
    const iv = setInterval(f, 10000);
    return () => clearInterval(iv);
  }, [API]);

  // Poll smart money data when on that tab
  useEffect(() => {
    if (tab !== "smart") return;
    const f = async () => {
      try {
        const r = await fetch(API + "/api/intel/smart-money");
        if (r.ok) setSmartMoney(await r.json());
      } catch {}
    };
    f();
    const iv = setInterval(f, 15000);
    return () => clearInterval(iv);
  }, [API, tab]);

  // Simulated stats for demo when API isn't available
  const demoStats = {
    uptime: "4h",
    scorer: {
      trainCount: 247,
      accuracy: "71.3%",
      topFeatures: [
        { feature: "oc_buyVelocity5m", weight: "2.340" },
        { feature: "tp_stickiness", weight: "2.180" },
        { feature: "oc_uniqueBuyers5m", weight: "1.950" },
        { feature: "k_herdSignal", weight: "1.870" },
        { feature: "tp_lawOfFew", weight: "1.740" },
        { feature: "k_cognitiveEase", weight: "1.620" },
        { feature: "oc_volumeSol5m", weight: "1.510" },
        { feature: "so_hasTwitter", weight: "1.440" },
        { feature: "tp_context", weight: "1.380" },
        { feature: "k_emotionalValence", weight: "1.290" },
      ],
    },
    memory: { total: 1847, labeled: 892, graduated: 67, graduationRate: "7.5%" },
    monitor: { tracking: 34 },
    recentEvents: [
      { type: "score", data: { ca: "3xF9kL2p", score: 82, bondProb: 71 }, time: Date.now() - 120000 },
      { type: "learn", data: { ca: "7mQ2nR4v", error: 0.12, accuracy: "71.3" }, time: Date.now() - 300000 },
      { type: "score", data: { ca: "9pK5wT8x", score: 34, bondProb: 12 }, time: Date.now() - 480000 },
      { type: "learn", data: { ca: "2bN6yH1j", error: 0.08, accuracy: "71.1" }, time: Date.now() - 600000 },
      { type: "score", data: { ca: "5cM8zR3q", score: 91, bondProb: 88 }, time: Date.now() - 900000 },
    ],
  };

  const s = stats || demoStats;

  return (
    <div style={{
      background: COLORS.bg, color: COLORS.tx, fontFamily: M,
      minHeight: "100vh", padding: "16px",
    }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes glow { 0%,100% { box-shadow: 0 0 8px ${COLORS.gn}22; } 50% { box-shadow: 0 0 20px ${COLORS.gn}44; } }
        ::-webkit-scrollbar { width: 2px; } ::-webkit-scrollbar-thumb { background: ${COLORS.bd}; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.gn, animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 12, letterSpacing: "0.15em", color: COLORS.gn + "88", fontWeight: 700 }}>INTELLIGENCE ENGINE</span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 900, fontFamily: S, color: COLORS.tx }}>
            Meme Intelligence
          </h1>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["live", "model", "memory", "smart"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 12px", borderRadius: 6, border: "1px solid " + (tab === t ? COLORS.gn + "33" : COLORS.bd),
              background: tab === t ? COLORS.gn + "0a" : "transparent",
              color: tab === t ? COLORS.gn : COLORS.dm,
              fontSize: 13, fontWeight: 700, fontFamily: M, cursor: "pointer",
            }}>{t.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
        <StatBox label="TRAINED" value={s.scorer.trainCount} color={COLORS.gn} sub="samples" />
        <StatBox label="ACCURACY" value={s.scorer.accuracy} color={parseFloat(s.scorer.accuracy) > 70 ? COLORS.gn : COLORS.yl} />
        <StatBox label="MEMORY" value={s.memory.total} color={COLORS.pu} sub="tokens" />
        <StatBox label="GRAD RATE" value={s.memory.graduationRate} color={COLORS.yl} />
        <StatBox label="TRACKING" value={s.monitor.tracking} color={COLORS.or} sub="live" />
      </div>

      {/* LIVE TAB */}
      {tab === "live" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12 }}>
          <LiveScoringDemo />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Event log */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, overflow: "hidden", flex: 1 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid " + COLORS.bd }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Event Log</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {s.recentEvents.map((e, i) => <EventRow key={i} event={e} />)}
              </div>
            </div>

            {/* Framework breakdown */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Framework Weights</div>
              {Object.entries(PHASE_LABELS).map(([key, label]) => (
                <Bar key={key} label={label} value={Math.round(40 + Math.random() * 50)} color={PHASE_COLORS[key]} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODEL TAB */}
      {tab === "model" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Feature importance */}
          <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Top Feature Weights</div>
            <div style={{ fontSize: 12, color: COLORS.ft, marginBottom: 8 }}>
              Learned from {s.scorer.trainCount} labeled outcomes. Updates on every new label.
            </div>
            {s.scorer.topFeatures.map((f, i) => (
              <FeatureWeight key={f.feature} feature={f.feature} weight={f.weight} />
            ))}
          </div>

          {/* Learning curve */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Architecture</div>
              {[
                { name: "Rule Engine", desc: "Tipping Point + System 1/2 heuristics", status: "active", color: COLORS.gn },
                { name: "Rug Detection", desc: "8 on-chain patterns: dev dumps, coordinated sells, liquidity drain", status: "active", color: COLORS.rd },
                { name: "RAG Memory", desc: `${s.memory.labeled} labeled tokens in vector store`, status: "active", color: COLORS.gn },
                { name: "Online ML", desc: `${s.scorer.trainCount} gradient updates applied`, status: "active", color: COLORS.yl },
                { name: "X Social Intel", desc: "Twitter profile validation + bot detection (free tier)", status: "active", color: COLORS.cy },
                { name: "Nightly LoRA", desc: "Llama-3.1-8B fine-tune on outcomes", status: "planned", color: COLORS.ft },
              ].map(l => (
                <div key={l.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid " + COLORS.bd }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: l.color }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: COLORS.dm }}>{l.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, color: l.status === "active" ? COLORS.gn : COLORS.ft, fontWeight: 700, padding: "1px 5px", borderRadius: 3, border: "1px solid " + (l.status === "active" ? COLORS.gn : COLORS.ft) + "33" }}>{l.status}</span>
                </div>
              ))}
            </div>

            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Accuracy Trajectory</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 16, padding: "12px 0" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: COLORS.ft }}>Baseline</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: COLORS.ft }}>~65%</div>
                </div>
                <span style={{ color: COLORS.ft }}>→</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: COLORS.yl }}>+RAG</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: COLORS.yl }}>~80%</div>
                </div>
                <span style={{ color: COLORS.ft }}>→</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: COLORS.gn }}>Current</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: COLORS.gn }}>{s.scorer.accuracy}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MEMORY TAB */}
      {tab === "memory" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>RAG Vector Store</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <StatBox label="STORED" value={s.memory.total} color={COLORS.pu} />
              <StatBox label="LABELED" value={s.memory.labeled} color={COLORS.yl} />
              <StatBox label="GRADUATED" value={s.memory.graduated} color={COLORS.gn} />
              <StatBox label="GRAD RATE" value={s.memory.graduationRate} color={COLORS.or} />
            </div>
            <div style={{ fontSize: 12, color: COLORS.dm, lineHeight: 1.5 }}>
              Every token that enters the radar is embedded as a 32-dimensional feature vector.
              When a new token appears, the engine finds the 5 most similar past tokens and
              checks their outcomes. If similar tokens graduated, the score gets a RAG boost.
              Memory is persistent across restarts via Redis.
            </div>
          </div>

          <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Outcome Labels</div>
            <div style={{ fontSize: 12, color: COLORS.dm, marginBottom: 12 }}>
              Auto-labeled at 30min, 2h, 6h, 24h checkpoints:
            </div>
            {[
              { label: "graduated", desc: "Token migrated to Raydium", pct: s.memory.graduationRate },
              { label: "peakMcx", desc: "Peak MC / launch MC multiple", pct: "avg 3.2x" },
              { label: "alive", desc: "MC still > $1K at checkpoint", pct: "~42%" },
              { label: "fleetPnl", desc: "Actual fleet profit/loss in SOL", pct: "reward signal" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid " + COLORS.bd }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.gn, fontFamily: M, width: 70 }}>{l.label}</span>
                <span style={{ fontSize: 12, color: COLORS.dm, flex: 1 }}>{l.desc}</span>
                <span style={{ fontSize: 12, color: COLORS.yl, fontWeight: 700 }}>{l.pct}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SMART MONEY TAB */}
      {tab === "smart" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Enable/Disable banner */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: smartMoney?.enabled ? COLORS.gn + "12" : COLORS.rd + "12", border: "1px solid " + (smartMoney?.enabled ? COLORS.gn + "33" : COLORS.rd + "33"), borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: smartMoney?.enabled ? COLORS.gn : COLORS.rd }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: smartMoney?.enabled ? COLORS.gn : COLORS.rd }}>
                {smartMoney?.enabled ? "SMART MONEY ACTIVE" : "SMART MONEY OFF"}
              </span>
              <span style={{ fontSize: 11, color: COLORS.dm }}>
                {smartMoney?.enabled ? "Polling wallets via RPC" : "Enable manually or trade as VIP/owner to auto-activate"}
              </span>
            </div>
            <button onClick={async () => {
              try {
                const r = await fetch(API + "/api/intel/smart-money/toggle", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: !smartMoney?.enabled }),
                });
                if (r.ok) {
                  const data = await r.json();
                  setSmartMoney(prev => prev ? { ...prev, enabled: data.enabled } : prev);
                }
              } catch {}
            }} style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer",
              background: smartMoney?.enabled ? COLORS.rd + "20" : COLORS.gn + "20",
              border: "1px solid " + (smartMoney?.enabled ? COLORS.rd + "44" : COLORS.gn + "44"),
              color: smartMoney?.enabled ? COLORS.rd : COLORS.gn,
            }}>
              {smartMoney?.enabled ? "DISABLE" : "ENABLE"}
            </button>
          </div>

          {/* Polling config */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 8, padding: "6px 12px", flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 11, color: COLORS.ft, fontWeight: 700, whiteSpace: "nowrap" }}>Poll interval</span>
              <input type="range" min={5} max={120} step={5} value={Math.round((smartMoney?.pollIntervalMs || 30000) / 1000)}
                onChange={async (e) => {
                  const s = Number(e.target.value);
                  try {
                    const r = await fetch(API + "/api/intel/smart-money/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pollInterval: s }) });
                    if (r.ok) { const d = await r.json(); setSmartMoney(prev => prev ? { ...prev, pollIntervalMs: d.pollIntervalMs } : prev); }
                  } catch {}
                }}
                style={{ flex: 1, cursor: "pointer" }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.gn, minWidth: 30, textAlign: "right" }}>{Math.round((smartMoney?.pollIntervalMs || 30000) / 1000)}s</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 8, padding: "6px 12px", minWidth: 160 }}>
              <span style={{ fontSize: 11, color: COLORS.ft, fontWeight: 700, whiteSpace: "nowrap" }}>Max wallets</span>
              <input type="range" min={10} max={200} step={10} value={smartMoney?.maxWatch || 50}
                onChange={async (e) => {
                  const n = Number(e.target.value);
                  try {
                    const r = await fetch(API + "/api/intel/smart-money/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxWatch: n }) });
                    if (r.ok) { const d = await r.json(); setSmartMoney(prev => prev ? { ...prev, maxWatch: d.maxWatch } : prev); }
                  } catch {}
                }}
                style={{ flex: 1, cursor: "pointer" }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.cy, minWidth: 30, textAlign: "right" }}>{smartMoney?.maxWatch || 50}</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12 }}>
          {/* Leaderboard */}
          <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid " + COLORS.bd, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>Wallet Leaderboard</span>
              <span style={{ fontSize: 11, color: COLORS.dm }}>{smartMoney?.totalWallets || 0} tracked</span>
            </div>
            <div style={{ display: "flex", padding: "6px 14px", borderBottom: "1px solid " + COLORS.bd, fontSize: 11, color: COLORS.ft, fontWeight: 700 }}>
              <span style={{ width: 32 }}>#</span>
              <span style={{ flex: 1 }}>WALLET</span>
              <span style={{ width: 40, textAlign: "center" }}>TIER</span>
              <span style={{ width: 55, textAlign: "right" }}>WIN%</span>
              <span style={{ width: 40, textAlign: "right" }}>W</span>
              <span style={{ width: 40, textAlign: "right" }}>L</span>
              <span style={{ width: 55, textAlign: "right" }}>AVG R</span>
              <span style={{ width: 55, textAlign: "right" }}>SCORE</span>
            </div>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {(smartMoney?.leaderboard || []).map((w, i) => {
                const tierColor = { s: COLORS.gn, a: COLORS.yl, b: COLORS.or, c: COLORS.ft }[w.tier] || COLORS.ft;
                return (
                  <div key={w.prefix + i} style={{ display: "flex", padding: "5px 14px", borderBottom: "1px solid " + COLORS.bd, fontSize: 12, alignItems: "center", animation: "slideIn 0.3s ease" }}>
                    <span style={{ width: 32, color: COLORS.dm }}>{i + 1}</span>
                    <span style={{ flex: 1, fontFamily: M, color: w.tracked ? COLORS.gn : COLORS.tx }}>{w.address.slice(0, 12)}...{w.tracked ? " *" : ""}</span>
                    <span style={{ width: 40, textAlign: "center", color: tierColor, fontWeight: 800, fontSize: 13 }}>{w.tier.toUpperCase()}</span>
                    <span style={{ width: 55, textAlign: "right", color: w.winRate >= 60 ? COLORS.gn : w.winRate >= 40 ? COLORS.yl : COLORS.rd, fontWeight: 700 }}>{w.winRate}%</span>
                    <span style={{ width: 40, textAlign: "right", color: COLORS.gn }}>{w.wins}</span>
                    <span style={{ width: 40, textAlign: "right", color: COLORS.rd }}>{w.losses}</span>
                    <span style={{ width: 55, textAlign: "right", color: w.avgReturn > 0 ? COLORS.gn : COLORS.rd }}>{w.avgReturn > 0 ? "+" : ""}{w.avgReturn.toFixed(1)}x</span>
                    <span style={{ width: 55, textAlign: "right", color: tierColor, fontWeight: 700 }}>{(w.score * 100).toFixed(0)}</span>
                  </div>
                );
              })}
              {(!smartMoney?.leaderboard || smartMoney.leaderboard.length === 0) && (
                <div style={{ padding: 20, textAlign: "center", color: COLORS.dm, fontSize: 12 }}>
                  Collecting wallet data... leaderboard populates as trades are observed.
                </div>
              )}
            </div>
          </div>

          {/* Right column: signals + watch management */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <StatBox label="WATCHING" value={smartMoney?.watching || 0} color={COLORS.cy} sub="wallets" />
              <StatBox label="SIGNALS" value={smartMoney?.stats?.totalSignals || 0} color={COLORS.gn} sub="total" />
            </div>

            {/* Recent signals */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, overflow: "hidden", flex: 1 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid " + COLORS.bd }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Smart Money Signals</span>
              </div>
              <div style={{ maxHeight: 250, overflowY: "auto" }}>
                {(smartMoney?.signals || []).map((sig, i) => {
                  const age = Math.round((Date.now() - sig.time) / 60000);
                  return (
                    <div key={sig.ca + i} style={{ padding: "6px 12px", borderBottom: "1px solid " + COLORS.bd, animation: "slideIn 0.3s ease" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontFamily: M, color: sig.convergence ? COLORS.gn : COLORS.tx }}>{sig.ca.slice(0, 8)}</span>
                        <span style={{ fontSize: 11, color: COLORS.ft }}>{age}m ago</span>
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                        {sig.wallets.map((w, j) => (
                          <span key={j} style={{ fontSize: 10, padding: "1px 4px", borderRadius: 3, background: ({ s: COLORS.gn, a: COLORS.yl, b: COLORS.or }[w.tier] || COLORS.ft) + "15", color: ({ s: COLORS.gn, a: COLORS.yl, b: COLORS.or }[w.tier] || COLORS.ft), fontWeight: 700 }}>
                            {w.address} ({w.tier.toUpperCase()} {w.winRate}%)
                          </span>
                        ))}
                      </div>
                      {sig.convergence && <span style={{ fontSize: 10, color: COLORS.gn, fontWeight: 800, marginTop: 2, display: "block" }}>CONVERGENCE — {sig.walletCount} smart wallets</span>}
                    </div>
                  );
                })}
                {(!smartMoney?.signals || smartMoney.signals.length === 0) && (
                  <div style={{ padding: 16, textAlign: "center", color: COLORS.dm, fontSize: 12 }}>
                    No signals yet — watching for smart wallet buys...
                  </div>
                )}
              </div>
            </div>

            {/* Watch wallet */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Watch a Wallet</div>
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  value={watchInput}
                  onChange={e => setWatchInput(e.target.value)}
                  placeholder="Paste wallet address..."
                  style={{ flex: 1, padding: "6px 8px", background: COLORS.bg, border: "1px solid " + COLORS.bd, borderRadius: 5, color: COLORS.tx, fontSize: 12, fontFamily: M, outline: "none" }}
                />
                <button onClick={async () => {
                  if (!watchInput.trim()) return;
                  try {
                    await fetch(API + "/api/intel/smart-money/watch", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ address: watchInput.trim() }),
                    });
                    setWatchInput("");
                  } catch {}
                }} style={{ padding: "6px 10px", background: COLORS.gn + "15", border: "1px solid " + COLORS.gn + "33", borderRadius: 5, color: COLORS.gn, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ADD
                </button>
              </div>
              <div style={{ fontSize: 11, color: COLORS.dm, marginTop: 4 }}>
                Add known alpha wallets to track. Their buys get fast-tracked + scored.
              </div>
              {smartMoney?.manualWatch > 0 && (
                <div style={{ fontSize: 11, color: COLORS.cy, marginTop: 3 }}>{smartMoney.manualWatch} manual wallets watched</div>
              )}
            </div>

            {/* Tiers explanation */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Wallet Tiers</div>
              {[
                { tier: "S", color: COLORS.gn, desc: "70%+ score, 5+ trades — elite alpha" },
                { tier: "A", color: COLORS.yl, desc: "50%+ score, 4+ trades — consistent winner" },
                { tier: "B", color: COLORS.or, desc: "35%+ score, 3+ trades — above average" },
                { tier: "C", color: COLORS.ft, desc: "Below threshold — still tracking" },
              ].map(t => (
                <div key={t.tier} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                  <span style={{ width: 20, fontSize: 13, fontWeight: 900, color: t.color, textAlign: "center" }}>{t.tier}</span>
                  <span style={{ fontSize: 11, color: COLORS.dm }}>{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: COLORS.ft }}>
        BONDLI MEME INTELLIGENCE — every launch trains the model
      </div>
    </div>
  );
}
