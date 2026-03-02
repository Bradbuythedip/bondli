// BONDLI v3.0 — Signal Detector (Helius + X API Wallet Profiling)
import CONFIG from "./config.mjs";

export class SignalDetector {
  constructor() {
    this.profiles = new Map();
    this.heliusBase = "https://api.helius.xyz/v0";
  }

  // Profile a wallet using Helius enriched transactions
  async profileWallet(address) {
    if (this.profiles.has(address)) return this.profiles.get(address);

    const profile = {
      address,
      txCount: 0,
      pumpTxCount: 0,
      avgHoldTime: 0,
      winRate: 0,
      totalVolume: 0,
      firstSeen: null,
      isBot: false,
      riskScore: 0,
    };

    try {
      if (CONFIG.HELIUS_API_KEY) {
        const res = await fetch(
          `${this.heliusBase}/addresses/${address}/transactions?api-key=${CONFIG.HELIUS_API_KEY}&limit=50`
        );
        if (res.ok) {
          const txs = await res.json();
          profile.txCount = txs.length;
          profile.firstSeen = txs[txs.length - 1]?.timestamp;

          // Analyze pump.fun activity
          const pumpTxs = txs.filter(t =>
            t.instructions?.some(i => i.programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")
          );
          profile.pumpTxCount = pumpTxs.length;

          // Bot detection: high frequency, low variance in timing
          if (profile.txCount >= 20) {
            const gaps = [];
            for (let i = 1; i < Math.min(txs.length, 20); i++) {
              gaps.push(txs[i-1].timestamp - txs[i].timestamp);
            }
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            const variance = gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length;
            const cv = Math.sqrt(variance) / avgGap;
            profile.isBot = cv < 0.3 && avgGap < 10;
          }

          profile.riskScore = this._calcRisk(profile);
        }
      }
    } catch (e) {
      console.error(`[SIGNAL] Profile error for ${address.slice(0,8)}: ${e.message}`);
    }

    this.profiles.set(address, profile);
    return profile;
  }

  // Check X/Twitter for token mentions
  async getTokenSentiment(tokenName) {
    if (!CONFIG.X_BEARER_TOKEN) return { mentions: 0, sentiment: "neutral" };

    try {
      const res = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(tokenName)}&max_results=100`,
        { headers: { Authorization: `Bearer ${CONFIG.X_BEARER_TOKEN}` } }
      );
      if (!res.ok) return { mentions: 0, sentiment: "neutral" };
      const data = await res.json();
      const count = data.meta?.result_count || 0;
      return {
        mentions: count,
        sentiment: count > 50 ? "hot" : count > 10 ? "warm" : "cold",
        trending: count > 100,
      };
    } catch {
      return { mentions: 0, sentiment: "neutral" };
    }
  }

  _calcRisk(profile) {
    let risk = 0;
    if (profile.isBot) risk += 40;
    if (profile.txCount < 5) risk += 20; // new wallet
    if (profile.pumpTxCount > 30) risk += 15; // heavy pump trader
    if (!profile.firstSeen || Date.now()/1000 - profile.firstSeen < 86400) risk += 25; // <1 day old
    return Math.min(100, risk);
  }
}

export default SignalDetector;
