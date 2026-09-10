// On-chain pump.fun trade decoding, offline, against a real TradeEvent sample.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTradeEvent, pumpTradesFromLogs, toPortalTrade, PUMP_PROGRAM, TRADE_DISC_B64 } from "../../src/api/radar-onchain.mjs";

const SAMPLE = "vdt/007mYe4I2s9bQJeDK7Vsc0abb1HZtkn00oEApJL31hHDmDkdn4elBH4AAAAANMdMxxcLAAABQFvoWh4tpYvdaQpW4wxu9sWX0f+5ye2VIR53vUXOYLdYSHFnAAAAAJ7V3KMRAAAArWn3u2uCAQCeKbmnCgAAAK3R5G/agwAA";

test("decodes a real TradeEvent with fixed offsets", () => {
  const t = decodeTradeEvent(Buffer.from(SAMPLE, "base64"));
  assert.equal(t.mint, "bZn91ZcKVcSZRwVmmKGiQ6yZJd71fyAw3y4TMekpump");
  assert.equal(t.solAmount, 2.114233735);
  assert.ok(Math.abs(t.tokenAmount - 12196755.85106) < 0.01);
  assert.equal(t.isBuy, true);
  assert.equal(t.user, "5LENpdG1eX9jhcxZ1J2X9qst2LVN7nFDMZ9FWdAZwUQe");
  assert.equal(t.timestamp, 1735477336);
  assert.equal(t.vSol, 75763602846);
  assert.equal(t.vTok, 424874203376045);
  assert.equal(decodeTradeEvent(Buffer.from(SAMPLE, "base64").subarray(0, 100)), null);
});

test("maps to PumpPortal's wire shape", () => {
  const p = toPortalTrade(decodeTradeEvent(Buffer.from(SAMPLE, "base64")), "sig1", 123);
  assert.equal(p.txType, "buy");
  assert.equal(p.mint, "bZn91ZcKVcSZRwVmmKGiQ6yZJd71fyAw3y4TMekpump");
  assert.equal(p.traderPublicKey, "5LENpdG1eX9jhcxZ1J2X9qst2LVN7nFDMZ9FWdAZwUQe");
  assert.equal(p.vSolInBondingCurve, 75.763602846);
  assert.ok(Math.abs(p.marketCapSol - 178.32) < 0.05);
  assert.equal(p.source, "onchain");
  assert.equal(p.signature, "sig1");
});

test("only decodes events emitted while pump.fun is executing", () => {
  const dataLine = "Program data: " + SAMPLE;
  const nested = [
    "Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]",
    `Program ${PUMP_PROGRAM} invoke [2]`,
    "Program log: Instruction: Buy",
    dataLine,
    `Program ${PUMP_PROGRAM} success`,
    "Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 success",
  ];
  assert.equal(pumpTradesFromLogs(nested).length, 1);
  const collision = [
    "Program MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG invoke [1]",
    dataLine,
    "Program MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG success",
  ];
  assert.equal(pumpTradesFromLogs(collision).length, 0);
  assert.equal(pumpTradesFromLogs([`Program ${PUMP_PROGRAM} invoke [1]`, "Program data: " + TRADE_DISC_B64 + "AAAA", `Program ${PUMP_PROGRAM} success`]).length, 0, "garbage payload is skipped");
  assert.equal(pumpTradesFromLogs(null).length, 0);
});
