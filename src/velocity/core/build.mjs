// ═══ VELOCITY — Build an engine from a config file ═══
import path from "node:path";
import { loadRiskEnvelope } from "./risk.mjs";
import { Engine } from "./engine.mjs";
import { Alerter } from "./alerts.mjs";
import { PumpfunFeed } from "../venues/pumpfun/feed.mjs";
import { makePumpfunEdge } from "../venues/pumpfun/edge.mjs";
import { PumpfunPaperRouter, PumpfunLiveRouter } from "../venues/pumpfun/router.mjs";
import { PolymarketFeed, FileFactSource, HttpFactSource } from "../venues/polymarket/feed.mjs";
import { makePolymarketEdge } from "../venues/polymarket/edge.mjs";
import { PolymarketPaperRouter, PolymarketLiveRouter } from "../venues/polymarket/router.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  dataDir: "./data/velocity",
  riskFile: "./risk.json",
  host: "127.0.0.1",
  port: 3210,
  alerts: { webhook: null },
  venues: {
    pumpfun: { mode: "paper", bondliUrl: "http://127.0.0.1:3001", minScore: 40, pollMs: 2000, tickMs: 1000, pumpportal: false },
    polymarket: { mode: "paper", maxMarkets: 150, minLiquidity: 1000, factSources: [{ type: "file", path: "./data/velocity/facts.json", source: "manual", confidence: 0.95 }] },
    perps: { mode: "off" },
  },
});

export function buildEngine(config, { clock } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, venues: { ...DEFAULT_CONFIG.venues, ...(config.venues || {}) } };
  const dataDir = path.resolve(cfg.dataDir);
  const envelope = loadRiskEnvelope(path.resolve(cfg.riskFile));
  const venues = {};
  const pf = cfg.venues.pumpfun;
  if (pf && pf.mode !== "off") {
    venues.pumpfun = {
      mode: pf.mode,
      feed: new PumpfunFeed({ bondliUrl: pf.bondliUrl, minScore: pf.minScore, pollMs: pf.pollMs, tickMs: pf.tickMs, pumpportal: !!pf.pumpportal, clock, latencyBoundMs: envelope.venues.pumpfun.latency_budget_ms.observe }),
      edge: makePumpfunEdge(),
      router: new PumpfunPaperRouter({ bookFile: path.join(dataDir, "paper-book-pumpfun.json"), clock }),
      liveRouter: new PumpfunLiveRouter({ clock }),
    };
  }
  const pm = cfg.venues.polymarket;
  if (pm && pm.mode !== "off") {
    const sources = (pm.factSources || []).map(s => s.type === "http" ? new HttpFactSource({ url: s.url, source: s.source, confidence: s.confidence }) : new FileFactSource({ path: path.resolve(s.path), source: s.source, confidence: s.confidence }));
    venues.polymarket = {
      mode: pm.mode,
      feed: new PolymarketFeed({ maxMarkets: pm.maxMarkets, minLiquidity: pm.minLiquidity, factSources: sources, clock, latencyBoundMs: envelope.venues.polymarket.latency_budget_ms.observe }),
      edge: makePolymarketEdge(),
      router: new PolymarketPaperRouter({ bookFile: path.join(dataDir, "paper-book-polymarket.json"), clock }),
      liveRouter: new PolymarketLiveRouter({ clock }),
    };
  }
  const engine = new Engine({ dataDir, envelope, venues, clock });
  engine.alerter = new Alerter({ store: engine.store, ledger: engine.ledger, webhookUrl: cfg.alerts?.webhook || null, statusUrl: `http://${cfg.host}:${cfg.port}` });
  return { engine, cfg, dataDir, envelope };
}
