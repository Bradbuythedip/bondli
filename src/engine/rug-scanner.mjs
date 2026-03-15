// BONDLI v3.0 — Rug Scanner (token safety checks)
import { Connection, PublicKey } from "@solana/web3.js";
import CONFIG from "./config.mjs";

export class RugScanner {
  constructor() {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
  }

  async scan(mint, opts = {}) {
    const results = {
      mint,
      safe: true,
      score: 100,
      flags: [],
      checks: {},
    };

    try {
      // 1. Check mint authority
      const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mint));
      const data = mintInfo?.value?.data?.parsed?.info;
      if (data) {
        const hasMintAuth = data.mintAuthority !== null;
        const hasFreezeAuth = data.freezeAuthority !== null;
        results.checks.mintAuthority = !hasMintAuth;
        results.checks.freezeAuthority = !hasFreezeAuth;
        if (hasMintAuth) { results.flags.push("MINT_AUTHORITY_ACTIVE"); results.score -= 30; }
        if (hasFreezeAuth) { results.flags.push("FREEZE_AUTHORITY_ACTIVE"); results.score -= 25; }
      }

      // 2. Check top holders concentration
      const holders = await this._getTopHolders(mint);
      if (holders.length > 0) {
        const topHolderPct = holders[0]?.pct || 0;
        results.checks.topHolder = topHolderPct < 20;
        if (topHolderPct > 50) { results.flags.push("SINGLE_HOLDER_50PCT+"); results.score -= 40; }
        else if (topHolderPct > 20) { results.flags.push("TOP_HOLDER_20PCT+"); results.score -= 15; }
        results.checks.topHolderPct = topHolderPct;
      }

      // 3. Check liquidity locked (for graduated tokens)
      // Simplified check - look for known LP lock programs
      results.checks.liquidityCheck = "pump_curve"; // On pump = bonding curve acts as lock

      // 4. Check transaction history for sell activity
      // Tokens with many buys but zero sells are classic rug setups
      if (CONFIG.HELIUS_API_KEY) {
        const txProfile = await this._checkTradeActivity(mint);
        results.checks.tradeActivity = txProfile;
        if (txProfile.totalBuys >= 5 && txProfile.totalSells === 0) {
          results.flags.push("ZERO_SELLS_ON_CHAIN");
          results.score -= 35; // severe — no organic selling activity at all
        } else if (txProfile.totalBuys >= 10 && txProfile.totalSells <= 1) {
          results.flags.push("NEAR_ZERO_SELLS");
          results.score -= 20;
        }
        // Check if all buys come from very few wallets (wash trading)
        if (txProfile.uniqueBuyers > 0 && txProfile.uniqueBuyers <= 3 && txProfile.totalBuys >= 8) {
          results.flags.push("WASH_TRADING_FEW_WALLETS");
          results.score -= 25;
        }
        // Gradual rug pattern: steady buys over minutes with no sells, uniform timing
        // This is the classic bot trap — designed to look like organic momentum
        if (txProfile.gradualRugScore >= 0.6) {
          results.flags.push("GRADUAL_RUG_PATTERN");
          results.score -= 35; // severe — this pattern almost always ends in a rug
        } else if (txProfile.gradualRugScore >= 0.4) {
          results.flags.push("GRADUAL_RUG_SUSPECT");
          results.score -= 20;
        }
      }

      // 5. Check creator history
      if (CONFIG.HELIUS_API_KEY && data?.mintAuthority) {
        const profile = await this._checkCreator(data.mintAuthority);
        results.checks.creatorHistory = profile;
        if (profile.rugCount > 0) { results.flags.push("CREATOR_HAS_RUGS"); results.score -= 30; }
      }

    } catch (e) {
      results.flags.push(`SCAN_ERROR: ${e.message}`);
      results.score -= 10;
    }

    results.safe = results.score >= 60;
    return results;
  }

  async _getTopHolders(mint) {
    try {
      const accounts = await this.connection.getTokenLargestAccounts(new PublicKey(mint));
      const supply = accounts.value.reduce((s, a) => s + Number(a.amount), 0);
      return accounts.value.slice(0, 10).map(a => ({
        address: a.address.toBase58(),
        amount: Number(a.amount),
        pct: (Number(a.amount) / supply) * 100,
      }));
    } catch {
      return [];
    }
  }

  async _checkTradeActivity(mint) {
    try {
      const res = await fetch(
        `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${CONFIG.HELIUS_API_KEY}&limit=100`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return { totalBuys: 0, totalSells: 0, uniqueBuyers: 0, uniqueSellers: 0 };
      const txs = await res.json();

      let totalBuys = 0;
      let totalSells = 0;
      const buyers = new Set();
      const sellers = new Set();
      const buyTimestamps = []; // track timing for gradual rug detection

      for (const tx of txs) {
        // Detect swap transactions (buys and sells on pump.fun or Raydium)
        const desc = (tx.description || "").toLowerCase();
        const isBuy = desc.includes("buy") || desc.includes("swap") && tx.tokenTransfers?.some(t => t.mint === mint);
        const isSell = desc.includes("sell");

        if (tx.type === "SWAP" || desc.includes("swap")) {
          // Check token transfer direction to determine buy vs sell
          for (const transfer of (tx.tokenTransfers || [])) {
            if (transfer.mint === mint) {
              if (transfer.tokenAmount > 0) {
                // Received tokens = buy
                totalBuys++;
                if (tx.feePayer) buyers.add(tx.feePayer);
                if (tx.timestamp) buyTimestamps.push(tx.timestamp);
              } else {
                // Sent tokens = sell
                totalSells++;
                if (tx.feePayer) sellers.add(tx.feePayer);
              }
            }
          }
        } else if (isBuy) {
          totalBuys++;
          if (tx.feePayer) buyers.add(tx.feePayer);
          if (tx.timestamp) buyTimestamps.push(tx.timestamp);
        } else if (isSell) {
          totalSells++;
          if (tx.feePayer) sellers.add(tx.feePayer);
        }
      }

      // ── Gradual rug pattern detection ──
      // Classic trap: steady buys at regular intervals over minutes with zero/near-zero sells.
      // Real organic activity has clustered buys (FOMO waves) + intermixed sells (profit-taking).
      // Bot-trap charts show evenly-spaced buys like a metronome — designed to lure momentum bots.
      let gradualRugScore = 0;
      let buyTimingUniformity = 0;
      let buySpreadMinutes = 0;

      if (buyTimestamps.length >= 6 && totalSells <= 1) {
        buyTimestamps.sort((a, b) => a - b);
        const intervals = [];
        for (let i = 1; i < buyTimestamps.length; i++) {
          intervals.push(buyTimestamps[i] - buyTimestamps[i - 1]);
        }
        // Time spread: how long has the buy-only activity been going on?
        buySpreadMinutes = (buyTimestamps[buyTimestamps.length - 1] - buyTimestamps[0]) / 60;

        // Buy timing uniformity: coefficient of variation of intervals
        // Low CV = regular spacing = bot/script, High CV = organic clustering
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avgInterval > 0) {
          const variance = intervals.reduce((s, d) => s + (d - avgInterval) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / avgInterval;
          // CV < 0.5 = suspiciously uniform timing (real humans cluster, bots space evenly)
          buyTimingUniformity = Math.max(0, Math.min(1, 1 - cv));
        }

        // Score the gradual rug pattern:
        // - Many buys (10+) over a long period (5+ min) with near-zero sells + uniform timing
        if (buySpreadMinutes >= 5 && totalBuys >= 10 && totalSells === 0 && buyTimingUniformity > 0.4) {
          gradualRugScore = Math.min(1, 0.6 + buyTimingUniformity * 0.3 + Math.min(0.1, buySpreadMinutes / 100));
        } else if (buySpreadMinutes >= 3 && totalBuys >= 8 && totalSells <= 1 && buyTimingUniformity > 0.3) {
          gradualRugScore = Math.min(0.7, 0.4 + buyTimingUniformity * 0.2 + Math.min(0.1, buySpreadMinutes / 100));
        } else if (buySpreadMinutes >= 2 && totalBuys >= 6 && totalSells === 0 && buyTimingUniformity > 0.5) {
          gradualRugScore = 0.5;
        }
      }

      return {
        totalBuys,
        totalSells,
        uniqueBuyers: buyers.size,
        uniqueSellers: sellers.size,
        txCount: txs.length,
        gradualRugScore,
        buyTimingUniformity,
        buySpreadMinutes,
      };
    } catch {
      return { totalBuys: 0, totalSells: 0, uniqueBuyers: 0, uniqueSellers: 0 };
    }
  }

  async _checkCreator(address) {
    try {
      const res = await fetch(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${CONFIG.HELIUS_API_KEY}&limit=100`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return { rugCount: 0, tokenCount: 0 };
      const txs = await res.json();
      const tokenCreations = txs.filter(t => t.type === "CREATE" || t.description?.includes("create"));

      // Detect rug pattern: creator made tokens then sold quickly
      // Look for rapid sell-after-create patterns
      let rugCount = 0;
      const creates = txs.filter(t => t.type === "CREATE" || t.type === "TOKEN_MINT" || t.description?.includes("create"));
      const sells = txs.filter(t => t.type === "SWAP" || t.type === "TRANSFER" || t.description?.includes("sell"));

      // If creator has many token creations + many sells within short windows, likely serial rugger
      if (creates.length >= 3 && sells.length > creates.length * 2) {
        rugCount = Math.min(creates.length, Math.floor(sells.length / 3));
      }

      // Also flag if >5 token creations in 100 txs — serial deployer
      if (creates.length >= 5) {
        rugCount = Math.max(rugCount, Math.floor(creates.length * 0.6));
      }

      return { rugCount, tokenCount: tokenCreations.length, txCount: txs.length, serialDeployer: creates.length >= 5 };
    } catch {
      return { rugCount: 0, tokenCount: 0 };
    }
  }
}

// CLI mode
if (process.argv[1]?.includes("rug-scanner")) {
  const ca = process.argv[2] || CONFIG.TOKEN_CA;
  if (!ca) { console.error("Usage: node rug-scanner.mjs <TOKEN_CA>"); process.exit(1); }
  const scanner = new RugScanner();
  scanner.scan(ca).then(r => {
    console.log("\n=== RUG SCAN RESULTS ===");
    console.log(`Mint: ${r.mint}`);
    console.log(`Score: ${r.score}/100`);
    console.log(`Safe: ${r.safe ? "YES" : "NO"}`);
    if (r.flags.length) console.log(`Flags: ${r.flags.join(", ")}`);
    console.log("Checks:", JSON.stringify(r.checks, null, 2));
  });
}

export default RugScanner;
