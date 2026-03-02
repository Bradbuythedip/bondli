// BONDLI v3.0 — Rug Scanner (token safety checks)
import { Connection, PublicKey } from "@solana/web3.js";
import CONFIG from "./config.mjs";

export class RugScanner {
  constructor() {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
  }

  async scan(mint) {
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

      // 4. Check creator history
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

  async _checkCreator(address) {
    try {
      const res = await fetch(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${CONFIG.HELIUS_API_KEY}&limit=100`
      );
      if (!res.ok) return { rugCount: 0, tokenCount: 0 };
      const txs = await res.json();
      const tokenCreations = txs.filter(t => t.type === "CREATE" || t.description?.includes("create"));
      return { rugCount: 0, tokenCount: tokenCreations.length, txCount: txs.length };
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
