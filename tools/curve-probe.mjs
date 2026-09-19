#!/usr/bin/env node
// Read one token's bonding curve straight off the chain and print what the radar would believe
// against what the wire says. Run it on a mint that showed an impossible market cap:
//
//   node tools/curve-probe.mjs <mint> [<mint> ...]
//
// A standard pump.fun launch prints supply 1,000,000,000 and overstates 1.0x. A launch made through
// somebody else's front end prints its own supply and the factor by which every quote for it is wrong.
import { Connection, PublicKey } from "@solana/web3.js";
import { reconcileFromCurve, decodeBondingCurve } from "../src/api/pumpcurve.mjs";
import { PUMP_PROGRAM } from "../src/api/mayhem.mjs";

const RPC = process.env.RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const mints = process.argv.slice(2).filter(Boolean);
if (!mints.length) { console.error("usage: node tools/curve-probe.mjs <mint> [<mint> ...]"); process.exit(1); }

const solPrice = await (async () => {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot");
    return Number((await r.json())?.data?.amount) || 0;
  } catch { return 0; }
})();
console.log(`rpc ${RPC.replace(/\/v2\/.*$/, "/v2/<key>")}  sol $${solPrice || "?"}\n`);

const connection = new Connection(RPC, "confirmed");
for (const mint of mints) {
  try {
    const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAM));
    const info = await connection.getAccountInfo(bc);
    if (!info?.data) { console.log(`${mint}  no bonding-curve account (migrated, or not a pump.fun curve)`); continue; }
    const raw = decodeBondingCurve(info.data);
    const r = reconcileFromCurve(info.data, { solPrice });
    if (!r) { console.log(`${mint}  account found (${info.data.length} bytes) but it does not decode as a curve`); continue; }
    console.log(`${mint}`);
    console.log(`  account        ${info.data.length} bytes, curve ${bc.toBase58()}`);
    console.log(`  supply         ${Math.round(r.supply).toLocaleString()}${r.standard ? "  (standard)" : "  ← NOT pump.fun's 1B"}`);
    console.log(`  reserves       virtual ${(raw.virtualSolReserves / 1e9).toFixed(3)} SOL / ${(raw.virtualTokenReserves / 1e6).toLocaleString()} tokens`);
    console.log(`  raised         ${r.realSol.toFixed(3)} SOL real  ->  curve ${(r.curvePct * 100).toFixed(1)}%${r.graduated ? "  (complete)" : ""}`);
    console.log(`  market cap     ${r.mcapSol.toFixed(4)} SOL  =  $${r.mcapUsd.toLocaleString()}`);
    console.log(`  wire overstates by ${r.supplyRatio.toFixed(2)}x  ->  it would quote $${Math.round(r.mcapUsd * r.supplyRatio).toLocaleString()}\n`);
  } catch (e) { console.log(`${mint}  ${e.message}\n`); }
}
