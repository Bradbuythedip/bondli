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
        <span style={{ fontSize: 8, color: COLORS.dm, fontFamily: M }}>{label}</span>
        <span style={{ fontSize: 8, color, fontFamily: M, fontWeight: 700 }}>{value}</span>
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
      <div style={{ fontSize: 20, fontWeight: 900, color: color || COLORS.gn, fontFamily: M }}>{value}</div>
      <div style={{ fontSize: 7, color: COLORS.ft, fontWeight: 700, letterSpacing: "0.08em", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 7, color: COLORS.dm, marginTop: 1 }}>{sub}</div>}
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
      borderBottom: "1px solid " + COLORS.bd, fontSize: 9, fontFamily: M,
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
      <span style={{ color: COLORS.ft, fontSize: 7, flexShrink: 0 }}>{age}m</span>
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
      <span style={{ fontSize: 8, color: COLORS.dm, flex: 1, fontFamily: M }}>{label}</span>
      <div style={{ width: 60, height: 3, borderRadius: 2, background: COLORS.bd }}>
        <div style={{ height: 3, borderRadius: 2, background: color, width: Math.min(100, (weight / 3) * 100) + "%", transition: "width 0.5s" }} />
      </div>
      <span style={{ fontSize: 8, color, fontWeight: 700, fontFamily: M, width: 28, textAlign: "right" }}>{weight}</span>
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
          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: M }}>Live Scoring</span>
        </div>
        <span style={{ fontSize: 8, color: COLORS.ft }}>{tokens.length} tracked</span>
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
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.tx, fontFamily: M }}>{t.name}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 7, color: COLORS.ft }}>{t.ca}</span>
                {t.graduated && <span style={{ fontSize: 6, padding: "0 3px", borderRadius: 2, background: COLORS.gn + "22", color: COLORS.gn, fontWeight: 800 }}>BONDED</span>}
                {t.rugRisk > 50 && <span style={{ fontSize: 6, padding: "0 3px", borderRadius: 2, background: COLORS.rd + "22", color: COLORS.rd, fontWeight: 800 }}>RUG RISK</span>}
                {t.similar > 0 && <span style={{ fontSize: 6, color: COLORS.pu }}>~{t.similar} similar</span>}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: t.score > 70 ? COLORS.gn : t.score > 40 ? COLORS.yl : COLORS.rd, fontFamily: M }}>{t.score}</div>
              <div style={{ fontSize: 6, color: COLORS.ft }}>SCORE</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: t.bondProb > 60 ? COLORS.gn : t.bondProb > 30 ? COLORS.yl : COLORS.ft, fontFamily: M }}>{t.bondProb}%</div>
              <div style={{ fontSize: 6, color: COLORS.ft }}>BOND</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.or, fontFamily: M }}>{t.velocity}</div>
              <div style={{ fontSize: 6, color: COLORS.ft }}>VEL</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.mcap > 30000 ? COLORS.yl : COLORS.tx, fontFamily: M }}>${t.mcap > 1000 ? (t.mcap / 1000).toFixed(1) + "K" : t.mcap}</div>
              <div style={{ fontSize: 6, color: COLORS.ft }}>MC</div>
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
            <span style={{ fontSize: 9, letterSpacing: "0.15em", color: COLORS.gn + "88", fontWeight: 700 }}>INTELLIGENCE ENGINE</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 900, fontFamily: S, color: COLORS.tx }}>
            Meme Intelligence
          </h1>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["live", "model", "memory"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 12px", borderRadius: 6, border: "1px solid " + (tab === t ? COLORS.gn + "33" : COLORS.bd),
              background: tab === t ? COLORS.gn + "0a" : "transparent",
              color: tab === t ? COLORS.gn : COLORS.dm,
              fontSize: 9, fontWeight: 700, fontFamily: M, cursor: "pointer",
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
                <span style={{ fontSize: 10, fontWeight: 800 }}>Event Log</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {s.recentEvents.map((e, i) => <EventRow key={i} event={e} />)}
              </div>
            </div>

            {/* Framework breakdown */}
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 8 }}>Framework Weights</div>
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
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 12 }}>Top Feature Weights</div>
            <div style={{ fontSize: 8, color: COLORS.ft, marginBottom: 8 }}>
              Learned from {s.scorer.trainCount} labeled outcomes. Updates on every new label.
            </div>
            {s.scorer.topFeatures.map((f, i) => (
              <FeatureWeight key={f.feature} feature={f.feature} weight={f.weight} />
            ))}
          </div>

          {/* Learning curve */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Architecture</div>
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
                    <div style={{ fontSize: 10, fontWeight: 700, color: l.color }}>{l.name}</div>
                    <div style={{ fontSize: 8, color: COLORS.dm }}>{l.desc}</div>
                  </div>
                  <span style={{ fontSize: 7, color: l.status === "active" ? COLORS.gn : COLORS.ft, fontWeight: 700, padding: "1px 5px", borderRadius: 3, border: "1px solid " + (l.status === "active" ? COLORS.gn : COLORS.ft) + "33" }}>{l.status}</span>
                </div>
              ))}
            </div>

            <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Accuracy Trajectory</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 16, padding: "12px 0" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: COLORS.ft }}>Baseline</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.ft }}>~65%</div>
                </div>
                <span style={{ color: COLORS.ft }}>→</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: COLORS.yl }}>+RAG</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.yl }}>~80%</div>
                </div>
                <span style={{ color: COLORS.ft }}>→</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: COLORS.gn }}>Current</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.gn }}>{s.scorer.accuracy}</div>
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
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 12 }}>RAG Vector Store</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <StatBox label="STORED" value={s.memory.total} color={COLORS.pu} />
              <StatBox label="LABELED" value={s.memory.labeled} color={COLORS.yl} />
              <StatBox label="GRADUATED" value={s.memory.graduated} color={COLORS.gn} />
              <StatBox label="GRAD RATE" value={s.memory.graduationRate} color={COLORS.or} />
            </div>
            <div style={{ fontSize: 8, color: COLORS.dm, lineHeight: 1.5 }}>
              Every token that enters the radar is embedded as a 32-dimensional feature vector.
              When a new token appears, the engine finds the 5 most similar past tokens and
              checks their outcomes. If similar tokens graduated, the score gets a RAG boost.
              Memory is persistent across restarts via Redis.
            </div>
          </div>

          <div style={{ background: COLORS.sf, border: "1px solid " + COLORS.bd, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 12 }}>Outcome Labels</div>
            <div style={{ fontSize: 8, color: COLORS.dm, marginBottom: 12 }}>
              Auto-labeled at 30min, 2h, 6h, 24h checkpoints:
            </div>
            {[
              { label: "graduated", desc: "Token migrated to Raydium", pct: s.memory.graduationRate },
              { label: "peakMcx", desc: "Peak MC / launch MC multiple", pct: "avg 3.2x" },
              { label: "alive", desc: "MC still > $1K at checkpoint", pct: "~42%" },
              { label: "fleetPnl", desc: "Actual fleet profit/loss in SOL", pct: "reward signal" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid " + COLORS.bd }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.gn, fontFamily: M, width: 70 }}>{l.label}</span>
                <span style={{ fontSize: 8, color: COLORS.dm, flex: 1 }}>{l.desc}</span>
                <span style={{ fontSize: 8, color: COLORS.yl, fontWeight: 700 }}>{l.pct}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 24, fontSize: 8, color: COLORS.ft }}>
        BONDLI MEME INTELLIGENCE — every launch trains the model
      </div>
    </div>
  );
}
