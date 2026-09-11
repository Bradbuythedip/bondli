#!/usr/bin/env node
// ═══ Fleet launcher for Robinhood Chain (PONS): simulate, rehearse on testnet, launch on mainnet ═══
//
//   node fleet-launch.mjs sim [--scenario organic] [--seed 1] [--budget 0.3] [--minutes 12] [--mode create|ape] [--runs 1] [--json] [--quiet]
//        the fleet simulator: the whole playbook against an in-memory PONS curve and a synthetic crowd, in seconds
//   node fleet-launch.mjs preflight                 chain id, wallet, launchpad terms, the cost of the launch you configured
//   node fleet-launch.mjs deploy-launchpad          testnet/local only: deploy FleetTestLaunchpad (PONS has no testnet)
//   node fleet-launch.mjs launch [--dry-run] [--yes] launch with the fleet declared snipe-tax exempt, then run the CREATE playbook
//   node fleet-launch.mjs ape --token 0x… [--yes]   Kelly-sized fleet into an existing curve
//   node fleet-launch.mjs close                      sell every wallet of the last run and sweep the ETH home
//   node fleet-launch.mjs recover                    sweep ETH (no sells) from every wallet the state file knows
//   node fleet-launch.mjs status                     what the state file says about the last run
//
// Configuration: launch/robinhood/.env (git-ignored) and FLEET_* in the environment. See README.md.
// While a launch runs, the terminal takes war-room commands: accumulate | hold | distribute | boost | auto | status | close
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { SimVenue, SCENARIOS } from "./lib/sim-venue.mjs";
import { ChainVenue, NETWORKS } from "./lib/chain-venue.mjs";
import { FleetTrader } from "./lib/fleet.mjs";
import { zeroPadValue, toBeHex } from "ethers";
import { ethToWei, toEth, DEFAULT_ECONOMICS } from "./lib/curve-model.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2); const cmd = argv[0] || "help";
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); if (i < 0) return d; const v = argv[i + 1]; return v == null || v.startsWith("--") ? true : v; };
const flag = (k) => argv.includes(`--${k}`);
const die = (m, code = 1) => { console.error(`\nSTOP: ${m}`); process.exit(code); };

function loadEnv() { try { for (const line of fs.readFileSync(path.join(here, ".env"), "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch {} }
const env = (k, d) => process.env[`FLEET_${k}`] ?? d;
const STATE_FILE = () => env("STATE_FILE", path.join(here, "fleet-state.json"));
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); } catch { return { launches: [] }; } };
const writeState = (st) => { const f = STATE_FILE(); fs.writeFileSync(f, JSON.stringify(st, (k, v) => typeof v === "bigint" ? v.toString() : v, 2), { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch {} };
async function ask(q) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); })); }
const fmt = (n, d = 5) => (Number(n) >= 0 ? "+" : "") + Number(n).toFixed(d);

/** Token metadata and fleet settings from the environment. */
function launchConfigFromEnv() {
  return {
    tokenParams: { name: env("TOKEN_NAME", "Token"), symbol: env("TOKEN_SYMBOL", "TKN"), logo: env("LOGO", ""), description: env("DESCRIPTION", ""), twitter: env("TWITTER", ""), telegram: env("TELEGRAM", ""), discord: env("DISCORD", ""), website: env("WEBSITE", ""), farcaster: env("FARCASTER", ""), creatorTaxBps: Number(env("CREATOR_TAX_BPS", 0)), buybackEnabled: env("BUYBACK_ENABLED", "1") !== "0" },
    budgetEth: Number(arg("budget", env("BUDGET_ETH", "0.05"))),
    devBuyEth: arg("dev-buy", env("DEV_BUY_ETH", null)) != null ? Number(arg("dev-buy", env("DEV_BUY_ETH"))) : undefined,
    fleetConfig: {
      durationMin: Number(arg("minutes", env("DURATION_MIN", "60"))), radarScore: Number(arg("score", env("RADAR_SCORE", "50"))), slippagePct: Number(env("SLIPPAGE_PCT", "15")), apeHoldMin: Number(env("APE_HOLD_MIN", "5")),
      autoRug: { enabled: env("AUTO_RUG", "1") !== "0", droughtSec: Number(env("AUTO_RUG_DROUGHT_SEC", "45")), minWaitSec: Number(env("AUTO_RUG_MIN_WAIT_SEC", "60")) },
      profitConfig: env("PLATFORM_WALLET") && Number(env("CUT_PERCENT", "0")) > 0 ? { platformWallet: env("PLATFORM_WALLET"), cutPercent: Number(env("CUT_PERCENT")) } : null,
    },
  };
}

/** A vanity salt and the token it was mined for: FLEET_SALT / FLEET_EXPECTED_TOKEN, or the miner's own
 *  pons-state.json (launch/notafruitfly) when it was mined for this master wallet. The launch refuses
 *  to send if its simulation would create any other token. */
function vanityFor(masterAddress) {
  let salt = env("SALT", null), expectedToken = env("EXPECTED_TOKEN", null), source = salt ? "FLEET_SALT" : null;
  if (!salt && env("USE_PONS_STATE", "1") !== "0") {
    try { const st = JSON.parse(fs.readFileSync(path.join(here, "..", "notafruitfly", "pons-state.json"), "utf8")); if (st?.userSalt && st.wallet && masterAddress && st.wallet.toLowerCase() === masterAddress.toLowerCase()) { salt = String(st.userSalt); expectedToken = expectedToken || st.predictedToken || null; source = "launch/notafruitfly/pons-state.json"; } } catch {}
  }
  if (salt && !/^0x[0-9a-fA-F]{64}$/.test(salt)) { try { salt = zeroPadValue(toBeHex(BigInt(salt)), 32); } catch { die(`FLEET_SALT must be a bytes32 hex string or an integer user salt, not ${salt}`); } }
  return { salt, expectedToken, source };
}

function printReport(rep, venueStats) {
  const lines = [
    `── ${rep.mode.toUpperCase()} ${rep.token || ""} ── phase ${rep.phase}, exit ${rep.exitReason || "-"}, ${rep.elapsedSec}s`,
    `budget ${rep.budgetEth} ETH → master ${rep.masterStartEth} → ${rep.masterEndEth} ETH   net ${fmt(rep.netEth)} ETH (${rep.netPct}%)${rep.strandedEth > 0 ? `   STRANDED ${rep.strandedEth} ETH in fleet wallets` : ""}`,
    `spent ${rep.ethSpent} ETH, recovered ${rep.ethRecovered} ETH, curve fees ${rep.feesEth} ETH, gas ${rep.gasEth} ETH, launch fee ${rep.launchFeeEth || 0} ETH, ${rep.trades} trades`,
    rep.devSells ? `dev sells: ${rep.devSells.sellCount} for ${rep.devSells.totalSoldPct}% of the position` : null,
    rep.orchestrator ? `playbook: dev sold ${rep.orchestrator.devSellCount}× (${rep.orchestrator.devSellEth.toFixed(5)} ETH), ${rep.orchestrator.cascadeBuyCount} cascade buys, ${rep.orchestrator.mixedBuyCount}/${rep.orchestrator.mixedSellCount} mixed, ${rep.orchestrator.externalBuyersTotal} external buyers seen` : null,
    rep.volume ? `volume engine: ${rep.volume.tradeCount} trades, ${rep.volume.totalVolumeEth} ETH, peak ${rep.volume.volumeMultiplier}x over ${rep.volume.elapsedSec}s` : null,
    rep.curve ? `curve now: mcap ${rep.curve.mcapEth} ETH, ${(rep.curve.progress * 100).toFixed(1)}% to graduation${rep.curve.graduated ? ", GRADUATED" : ""}` : null,
    venueStats?.external ? `crowd: ${venueStats.external.wallets} wallets, ${venueStats.external.buys} buys / ${venueStats.external.sells} sells, ${venueStats.external.volumeEth} ETH; peak mcap ${venueStats.peakMcapEth} ETH` : null,
    (rep.tokensLeft.dev > 1 || rep.tokensLeft.fleet > 1) ? `tokens still held: dev ${Math.round(rep.tokensLeft.dev)}, fleet ${Math.round(rep.tokensLeft.fleet)}` : `no tokens left in any wallet`,
    rep.error ? `error: ${rep.error}` : null,
  ].filter(Boolean);
  console.log(lines.join("\n"));
}

/** Read war-room commands from the terminal while a session runs. */
function warRoom(ft, key, onClose) {
  if (!process.stdin.isTTY) return () => {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "war-room> " });
  rl.on("line", async (line) => {
    const [c, d] = line.trim().split(/\s+/);
    if (!c) return rl.prompt();
    if (c === "status") console.log(JSON.stringify(ft.status(key), null, 1));
    else if (c === "close") { console.log("closing…"); await onClose(); }
    else console.log(JSON.stringify(ft.command(key, c, { duration: d ? Number(d) : undefined })));
    rl.prompt();
  });
  rl.prompt();
  return () => rl.close();
}

async function cmdSim() {
  const scenario = String(arg("scenario", "organic")); if (!SCENARIOS[scenario]) die(`unknown scenario ${scenario}; one of ${Object.keys(SCENARIOS).join(", ")}`);
  const runs = Number(arg("runs", 1)), seed0 = Number(arg("seed", 1)), quiet = flag("quiet") || runs > 1, json = flag("json");
  const mode = String(arg("mode", "create")); const budget = Number(arg("budget", "0.3")); const minutes = Number(arg("minutes", "12"));
  const rows = [];
  for (let i = 0; i < runs; i++) {
    const seed = seed0 + i;
    const v = new SimVenue({ seed, scenario, economics: { launchFee: ethToWei(Number(env("SIM_LAUNCH_FEE_ETH", toEth(DEFAULT_ECONOMICS.launchFee)))), graduationThreshold: ethToWei(Number(env("SIM_GRADUATION_ETH", toEth(DEFAULT_ECONOMICS.graduationThreshold)))), phantomQuote: ethToWei(Number(env("SIM_PHANTOM_ETH", toEth(DEFAULT_ECONOMICS.phantomQuote)))) } });
    await v.init(); const master = v.createWallet(); v.faucet(master.address, budget * 1.5); await v.start();
    const t0 = v.now();
    const ft = new FleetTrader(v, { log: quiet ? () => {} : (m) => console.log(`[${((v.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`) });
    const cfg = launchConfigFromEnv();
    let r;
    if (mode === "ape") {
      const dev = v.createWallet(); v.faucet(dev.address, 1); await v.launch({ from: dev, params: { name: "Their token", symbol: "THEIRS" }, devBuyWei: ethToWei(0.05) }); await v.sleep(60_000);
      r = await ft.launch({ master, budgetEth: budget, mode: "ape", token: v.token, fleetConfig: { ...cfg.fleetConfig, durationMin: minutes, radarScore: Number(arg("score", 70)), apeHoldMin: Number(arg("hold", 4)) } });
    } else r = await ft.launch({ master, budgetEth: budget, mode: "create", tokenParams: cfg.tokenParams, devBuyEth: cfg.devBuyEth, fleetConfig: { ...cfg.fleetConfig, durationMin: minutes } });
    if (!r.ok) die(`sim launch failed: ${r.error}`);
    if (!quiet) warRoom(ft, r.session.token || r.session.id, () => ft.close(r.session.token || r.session.id));
    await ft.wait(r.session);
    if (r.session.phase !== "closed" && r.session.phase !== "rugged") await ft.close(r.session.token || r.session.id);
    const rep = await ft.report(r.session.token || r.session.id); const st = v.stats(); const c = v.conservation();
    rows.push({ seed, netEth: rep.netEth, netPct: rep.netPct, exit: rep.exitReason, trades: rep.trades, external: st.external.wallets, peak: st.peakMcapEth, stranded: rep.strandedEth, conservation: String(c.diff) });
    if (json && runs === 1) console.log(JSON.stringify({ report: rep, venue: st, conservation: { ...c, minted: String(c.minted), diff: String(c.diff) } }, (k, x) => typeof x === "bigint" ? x.toString() : x, 1));
    else if (runs === 1) { console.log(""); printReport(rep, st); console.log(`every wei accounted for: ${c.diff === 0n ? "yes" : "NO, diff " + c.diff}`); }
    else console.log(`${scenario} seed ${seed}: net ${fmt(rep.netEth)} ETH (${rep.netPct}%) exit ${rep.exitReason} trades ${rep.trades} crowd ${st.external.wallets} peak ${st.peakMcapEth} ETH${rep.strandedEth > 0 ? " STRANDED " + rep.strandedEth : ""}`);
    await v.stop();
    if (!process.stdin.isTTY || quiet) {} else process.stdin.pause();
  }
  if (runs > 1) { const mean = rows.reduce((a, r) => a + r.netPct, 0) / rows.length; const wins = rows.filter(r => r.netPct > 0).length; console.log(`\n${scenario} × ${runs}: mean ${mean.toFixed(2)}%, wins ${wins}/${rows.length}, worst ${Math.min(...rows.map(r => r.netPct))}%, best ${Math.max(...rows.map(r => r.netPct))}%`); if (json) console.log(JSON.stringify(rows)); }
  process.exit(0);
}

function chainVenueFromEnv() {
  loadEnv();
  const chainId = Number(env("CHAIN_ID", "46630"));
  const st = readState();
  const factory = env("FACTORY", chainId === 4663 ? NETWORKS[4663].factory : st.launchpads?.[chainId] || null);
  const router = env("ROUTER", chainId === 4663 ? NETWORKS[4663].router : null);
  const v = new ChainVenue({ chainId, rpcUrl: env("RPC_URL", NETWORKS[chainId]?.rpc), factory, router, explorer: env("EXPLORER", NETWORKS[chainId]?.explorer), launchConfigId: Number(env("LAUNCH_CONFIG_ID", "0")), log: (m) => console.log(m) });
  return v;
}
function masterFromEnv() { loadEnv(); const pk = process.env.PRIVATE_KEY || process.env.FLEET_PRIVATE_KEY; if (!pk) die("PRIVATE_KEY missing (launch/robinhood/.env): the master wallet that funds the fleet"); return pk; }
function mainnetGuard(chainId) { if (NETWORKS[chainId]?.live && env("I_UNDERSTAND_MAINNET") !== "1") die(`chain ${chainId} is Robinhood Chain mainnet with real ETH. Rehearse on testnet (FLEET_CHAIN_ID=46630) first; set FLEET_I_UNDERSTAND_MAINNET=1 to proceed.`); }

async function cmdPreflight() {
  const v = chainVenueFromEnv(); const pk = masterFromEnv();
  const master = v.walletFromKey(pk);
  let init; try { init = await v.init(); } catch (e) { die(`RPC/launchpad: ${e.message}`); }
  const bal = toEth(await v.ethBalance(master.address));
  const terms = await v.launchTerms(); const can = await v.canLaunch(master.address);
  const cfg = launchConfigFromEnv();
  const fee = toEth(terms.launchFeeWei); const devBuy = cfg.devBuyEth ?? +(cfg.budgetEth * 0.10).toFixed(6);
  console.log(`chain ${init.chainId} (${init.name}) rpc ${init.rpc} gas ${init.gasPriceGwei} gwei`);
  console.log(`launchpad ${init.factory}${init.router ? ` router ${init.router}` : ""}${init.explorer ? `  explorer ${init.explorer}` : ""}`);
  console.log(`master ${master.address}: ${bal.toFixed(6)} ETH${NETWORKS[init.chainId]?.faucet ? `  (faucet: ${NETWORKS[init.chainId].faucet})` : ""}`);
  console.log(`terms: launch fee ${fee} ETH, snipe tax ${terms.snipeTaxStartBps} bps over ${terms.snipeTaxSeconds}s, canLaunch ${can}${terms.launchEnabled != null ? `, launchEnabled ${terms.launchEnabled}` : ""}${terms.config ? `, config #${v.launchConfigId}: supply ${terms.config.supply}, fee ${terms.config.curveFeeBps} bps, phantom ${terms.config.phantomQuote} ETH, graduation ${terms.config.graduationThreshold} ETH` : ""}`);
  console.log(`token: ${cfg.tokenParams.name} ($${cfg.tokenParams.symbol}) logo ${cfg.tokenParams.logo || "-"} creator tax ${cfg.tokenParams.creatorTaxBps} bps`);
  const vanity = vanityFor(master.address);
  console.log(vanity.salt ? `vanity: salt ${vanity.salt.slice(0, 18)}… from ${vanity.source}${vanity.expectedToken ? `, the launch must create ${vanity.expectedToken} or it is refused` : ""}` : `vanity: none (salt zero; mine one with launch/notafruitfly/pons-launch.mjs for a chosen address)`);
  console.log(`plan: budget ${cfg.budgetEth} ETH = launch fee ${fee} + dev buy ${devBuy} + fleet ${(cfg.budgetEth - fee - devBuy).toFixed(6)} ETH; duration ${cfg.fleetConfig.durationMin} min; auto-rug ${cfg.fleetConfig.autoRug.enabled ? `${cfg.fleetConfig.autoRug.droughtSec}s drought after ${cfg.fleetConfig.autoRug.minWaitSec}s` : "off"}`);
  const problems = [];
  if (bal < cfg.budgetEth + 0.002) problems.push(`master needs ${cfg.budgetEth + 0.002} ETH, has ${bal.toFixed(6)}`);
  if (can === false) problems.push("the factory says this wallet cannot launch (whitelist)");
  if (terms.launchEnabled === false) problems.push("launching is disabled on the factory");
  if (terms.launchFeeError) problems.push(`launch fee unreadable: ${terms.launchFeeError}`);
  if (NETWORKS[init.chainId]?.live && env("I_UNDERSTAND_MAINNET") !== "1") problems.push("mainnet: set FLEET_I_UNDERSTAND_MAINNET=1 to allow `launch`");
  console.log(problems.length ? `NOT READY:\n  - ${problems.join("\n  - ")}` : "READY");
  await v.stop(); process.exit(problems.length ? 2 : 0);
}

async function cmdDeployLaunchpad() {
  loadEnv(); const pk = masterFromEnv(); const chainId = Number(env("CHAIN_ID", "46630"));
  if (NETWORKS[chainId]?.live) die("mainnet has the real PONS factory; the test launchpad is for testnet and local nodes");
  const r = await ChainVenue.deployTestLaunchpad({ rpcUrl: env("RPC_URL", NETWORKS[chainId]?.rpc), chainId, privateKey: pk, launchFeeEth: Number(env("SIM_LAUNCH_FEE_ETH", "0.001")), log: (m) => console.log(m) }).catch(e => die(e.message));
  const st = readState(); st.launchpads = { ...(st.launchpads || {}), [r.chainId]: r.address }; writeState(st);
  console.log(`saved: FLEET_FACTORY for chain ${r.chainId} = ${r.address} (in ${STATE_FILE()})`);
}

async function runOnChain(mode) {
  const v = chainVenueFromEnv(); const pk = masterFromEnv(); const master = v.walletFromKey(pk);
  let init; try { init = await v.init(); } catch (e) { die(e.message); }
  mainnetGuard(init.chainId);
  const cfg = launchConfigFromEnv(); const dryRun = flag("dry-run");
  const token = mode === "ape" ? String(arg("token", "")) : null; if (mode === "ape" && !/^0x[0-9a-fA-F]{40}$/.test(token)) die("ape needs --token 0x…");
  const vanity = mode === "create" ? vanityFor(master.address) : { salt: null };
  const tokenParams = { ...cfg.tokenParams, ...(vanity.salt ? { salt: vanity.salt, expectedToken: vanity.expectedToken } : {}) };
  const bal = toEth(await v.ethBalance(master.address));
  console.log(`chain ${init.chainId} (${init.name}) | master ${master.address} ${bal.toFixed(6)} ETH | budget ${cfg.budgetEth} ETH | ${mode === "ape" ? `APE ${token}` : `CREATE ${cfg.tokenParams.name} ($${cfg.tokenParams.symbol})${vanity.salt ? ` salt from ${vanity.source}${vanity.expectedToken ? " → " + vanity.expectedToken : ""}` : ""}`}`);
  if (dryRun && mode === "create") {
    const terms = await v.launchTerms(); const devBuy = cfg.devBuyEth ?? +(cfg.budgetEth * 0.10).toFixed(6);
    const r = await v.launch({ from: master, params: tokenParams, exemptions: [], devBuyWei: ethToWei(devBuy), dryRun: true });
    if (!r.ok) die(`dry run: ${r.error}`);
    console.log(`dry run ok: ${r.fn} via ${r.viaRouter ? "router" : "factory"}, value ${toEth(r.value)} ETH (fee ${toEth(terms.launchFeeWei)} + dev buy ${devBuy}), gas ${r.gas}${r.simulatedToken ? `\nthe launch would create ${r.simulatedToken}${r.expectedToken ? " (matches the mined address)" : ""}` : ""}\nstruct: ${JSON.stringify(r.struct)}`);
    await v.stop(); return process.exit(0);
  }
  if (!flag("yes")) { const a = await ask(`Type ${mode === "ape" ? "APE" : "LAUNCH"} to fund ${cfg.budgetEth} ETH of fleet on chain ${init.chainId}: `); if (a !== (mode === "ape" ? "APE" : "LAUNCH")) die("not confirmed"); }
  const ft = new FleetTrader(v, { log: (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`) });
  const st = readState(); const entry = { sessionId: null, chainId: init.chainId, mode, token, master: master.address, walletKeys: [], startedAt: Date.now(), status: "starting" };
  st.launches = [...(st.launches || []), entry]; writeState(st);
  const save = () => { const s = readState(); const i = s.launches.findIndex(l => l.startedAt === entry.startedAt); if (i >= 0) s.launches[i] = entry; else s.launches.push(entry); writeState(s); };
  const r = await ft.launch({ master, budgetEth: cfg.budgetEth, mode, token, tokenParams, devBuyEth: cfg.devBuyEth, fleetConfig: cfg.fleetConfig, onWallets: (keys) => { entry.walletKeys = keys; entry.status = "funded"; save(); console.log(`[STATE] ${keys.length} wallet keys saved to ${STATE_FILE()} (chmod 600). Lose this file and you lose the fleet's ETH.`); } });
  if (!r.ok) die(r.error);
  entry.sessionId = r.sessionId; save();
  const key = r.session.token || r.session.id;
  const finish = async () => { try { if (r.session.phase !== "closed") await ft.close(r.session.token || r.session.id); } catch (e) { console.log(`close: ${e.message}`); } const rep = await ft.report(r.session.token || r.session.id); entry.token = r.session.token; entry.status = rep.phase; entry.report = rep; entry.endedAt = Date.now(); save(); console.log(""); printReport(rep, null); console.log(`state: ${STATE_FILE()}`); await v.stop(); process.exit(0); };
  process.on("SIGINT", () => { console.log("\nSIGINT: closing every wallet and sweeping…"); finish(); });
  const closeRoom = warRoom(ft, key, finish);
  const tick = setInterval(() => { entry.token = r.session.token; entry.status = r.session.phase; save(); }, 10_000);
  await ft.wait(r.session);
  clearInterval(tick);
  if (r.session.phase === "holding") { console.log(`[FLEET] holding. Type close (or Ctrl-C) to sell and sweep; the session closes itself at the duration limit.`); await new Promise(res => { const t = setInterval(() => { if (!r.session.running) { clearInterval(t); res(); } }, 1000); }); }
  closeRoom(); await finish();
}

/** close: sell every wallet of the last run and sweep. recover: sweep ETH only. */
async function cmdCloseOrRecover(sellFirst) {
  const v = chainVenueFromEnv(); const pk = masterFromEnv(); const master = v.walletFromKey(pk);
  try { await v.init(); } catch (e) { die(e.message); }
  const st = readState(); const which = arg("session", null);
  const entry = which ? st.launches.find(l => l.sessionId === which) : [...(st.launches || [])].reverse().find(l => l.walletKeys?.length);
  if (!entry) die("no launch with wallet keys in the state file");
  console.log(`${sellFirst ? "close" : "recover"} ${entry.sessionId || "?"} (${entry.mode} ${entry.token || "no token"}), ${entry.walletKeys.length} wallets → ${master.address}`);
  const wallets = entry.walletKeys.map(k => v.walletFromKey(k.privateKey));
  let sold = 0;
  if (sellFirst && entry.token) {
    const a = await v.attach(entry.token); if (!a.ok) console.log(`attach: ${a.error} (sweeping ETH only)`);
    else for (const w of [master, ...wallets]) { const held = await v.tokenBalance(w.address); if (held > 0n) { const r = await v.sell(w, held, { slippagePct: 30 }); console.log(`${w.address.slice(0, 10)} sell ${r.ok ? `→ ${toEth(r.quoteOut).toFixed(6)} ETH` : `failed: ${r.error}`}`); if (r.ok) sold++; } }
  }
  const ft = new FleetTrader(v, { log: (m) => console.log(m) });
  const r = await ft.recover(entry.walletKeys, master.address);
  for (const w of r.wallets) console.log(`${w.address.slice(0, 10)} ${w.status}${w.swept ? ` ${w.swept.toFixed(6)} ETH` : ""}${w.error ? ` ${w.error}` : ""}`);
  console.log(`sold ${sold}, recovered ${r.totalRecovered.toFixed(6)} ETH; master now ${toEth(await v.ethBalance(master.address)).toFixed(6)} ETH`);
  entry.status = sellFirst ? "closed" : "recovered"; entry.recoveredAt = Date.now(); writeState(st);
  await v.stop(); process.exit(0);
}

function cmdStatus() {
  const st = readState();
  console.log(`state file ${STATE_FILE()}${st.launchpads ? `\nlaunchpads: ${JSON.stringify(st.launchpads)}` : ""}`);
  for (const l of st.launches || []) console.log(`${new Date(l.startedAt).toISOString()} chain ${l.chainId} ${l.mode} ${l.token || "-"} status ${l.status} wallets ${l.walletKeys?.length || 0}${l.report ? ` net ${fmt(l.report.netEth)} ETH (${l.report.netPct}%) exit ${l.report.exitReason}` : ""}`);
  if (!(st.launches || []).length) console.log("no launches yet");
}

const commands = { sim: cmdSim, preflight: cmdPreflight, "deploy-launchpad": cmdDeployLaunchpad, launch: () => runOnChain("create"), ape: () => runOnChain("ape"), close: () => cmdCloseOrRecover(true), recover: () => cmdCloseOrRecover(false), status: cmdStatus };
if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 16).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd === "help" ? 0 : 2); }
commands[cmd]().catch(e => die(e.stack || e.message));
