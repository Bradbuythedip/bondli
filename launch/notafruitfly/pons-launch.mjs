#!/usr/bin/env node
// ═══ Not a fruit fly on PONS (Robinhood Chain): vanity-address miner and launcher ═══
//
// The live PonsV2LaunchDeployer (0x3711…1A42) deploys curve then token with CREATE2, salt =
// keccak256(abi.encode(originalDeployer, userSalt)). So the token's address is decided by the launch
// wallet, the user salt, the launch parameters, and the deployer's live creation bytecode. This script:
//
//   node pons-launch.mjs abi        fetch the factory / deployer / router ABIs from Blockscout into ./pons-abi/
//   node pons-launch.mjs inspect    print the launch structs, the launch functions, canLaunch(wallet), a recent launch
//   node pons-launch.mjs template   trace one recent real launch (debug_traceTransaction) and lift the two CREATE2
//                                   init codes: everything before the constructor args is the live creation code,
//                                   the args carry the factory's config values. Saved to pons-template.json.
//   node pons-launch.mjs mine       grind a user salt so the TOKEN address matches VANITY_PREFIX / VANITY_SUFFIX.
//                                   Before grinding, one candidate is checked against predictLaunchAddresses on
//                                   chain: if the offline math and the deployer disagree, nothing runs.
//                                   The found salt is checked on chain again. Saved to pons-state.json.
//   node pons-launch.mjs launch     send the launch through the launch-and-buy router with the mined salt and the
//                                   dev buy (DEV_BUY_ETH). Dry-runs first; prints the CA; asks you to type LAUNCH.
//   node pons-launch.mjs status     what is on chain for the launched token.
//
// .env in this folder (never committed): PRIVATE_KEY=0x…  PONS_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/…
// Any CONFIG key can be overridden with FLY_<KEY> in the environment. Nothing is signed except by `launch`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { JsonRpcProvider, Wallet, Contract, Interface, AbiCoder, keccak256, getCreate2Address, concat, toBeHex, zeroPadValue, parseEther, formatEther, getBytes, hexlify } from "ethers";

const CONFIG = {
  TOKEN_NAME: "Not a fruit fly",
  TOKEN_SYMBOL: "NOTAFRUITFLY",
  LOGO: "https://bondli.fun/fly.png",             // set to the image URL you upload for the launch
  DESCRIPTION: "flybrain is a fruit fly. this is not. Bondli's own token.",
  SOCIALS: "https://bondli.fun https://x.com/notafruitfly", // check the struct: PONS may want a JSON string or separate fields
  DEV_BUY_ETH: "0.02",                            // the launch-and-buy dev buy, exempt from the opening tax
  CREATOR_TAX_BPS: 0,
  BUYBACK_ENABLED: true,
  VANITY_PREFIX: "",                              // hex only. "f00d" alone: seconds. 5 characters: minutes. 6: an hour or two.
  VANITY_SUFFIX: "f00d",
  VANITY_MAX_SECONDS: 7200,
  CHAIN_ID: 4663,
  RPC_FALLBACK: "https://rpc.mainnet.chain.robinhood.com",
  FACTORY: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  DEPLOYER: "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42",
  ROUTER: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
  EXPLORER: "https://robinhoodchain.blockscout.com",
  STATE_FILE: "pons-state.json",
  TEMPLATE_FILE: "pons-template.json",
  ABI_DIR: "pons-abi",
};
const cfg = k => { const v = process.env["FLY_" + k]; if (v == null) return CONFIG[k]; if (typeof CONFIG[k] === "boolean") return /^(1|true|yes)$/i.test(v); if (typeof CONFIG[k] === "number") return Number(v); return v; };
const here = path.dirname(new URL(import.meta.url).pathname);
const file = n => path.join(here, n);
const readJson = (n, d = null) => { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return d; } };
const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, (k, x) => typeof x === "bigint" ? x.toString() : x, 2));
const coder = AbiCoder.defaultAbiCoder();
const TOKEN_LAUNCHED = keccak256(Buffer.from("TokenLaunched(address,address,address,address,uint256,uint256)"));
const die = m => { console.error("\nSTOP: " + m); process.exit(1); };
const UA = { Accept: "application/json", "User-Agent": "Mozilla/5.0 bondli-launch/1.0" };

function loadEnv() { try { for (const line of fs.readFileSync(file(".env"), "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch {} }
function provider() { const url = process.env.PONS_RPC_URL || process.env.FLY_RPC_URL || cfg("RPC_FALLBACK"); return new JsonRpcProvider(url, { chainId: cfg("CHAIN_ID"), name: "robinhood" }, { staticNetwork: true }); }
async function ask(q) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); })); }

// ── ABIs: from the explorer, cached, so struct names and function names are the live ones ──
async function fetchAbi(addr) {
  const cached = readJson(path.join(cfg("ABI_DIR"), addr.toLowerCase() + ".json"));
  if (cached) return cached;
  const r = await fetch(`${cfg("EXPLORER")}/api/v2/smart-contracts/${addr}`, { headers: UA });
  if (!r.ok) throw new Error(`explorer ${r.status} for ${addr}`);
  const j = await r.json();
  const abi = [...(j.abi || [])];
  for (const impl of j.implementations || []) { try { const r2 = await fetch(`${cfg("EXPLORER")}/api/v2/smart-contracts/${impl.address}`, { headers: UA }); const j2 = await r2.json(); abi.push(...(j2.abi || [])); } catch {} }
  if (!abi.length) throw new Error(`no verified ABI for ${addr}; paste it into ${cfg("ABI_DIR")}/${addr.toLowerCase()}.json`);
  fs.mkdirSync(file(cfg("ABI_DIR")), { recursive: true });
  writeJson(path.join(cfg("ABI_DIR"), addr.toLowerCase() + ".json"), abi);
  return abi;
}
async function abis() { const [factory, deployer, router] = await Promise.all([fetchAbi(cfg("FACTORY")), fetchAbi(cfg("DEPLOYER")), fetchAbi(cfg("ROUTER"))]); return { factory: new Interface(factory), deployer: new Interface(deployer), router: new Interface(router), raw: { factory, deployer, router } }; }
const fnsNamed = (iface, re) => iface.fragments.filter(f => f.type === "function" && re.test(f.name));
const describe = f => `${f.name}(${f.inputs.map(i => `${i.type === "tuple" ? "{" + i.components.map(c => `${c.type} ${c.name}`).join(", ") + "}" : i.type} ${i.name}`).join(", ")})${f.payable ? " payable" : ""}`;

// ── the launch struct: filled by field name from CONFIG, so a renamed field shows up as "unset" in inspect ──
function fillStruct(components, wallet, salt) {
  const out = {};
  for (const c of components) {
    const n = c.name.toLowerCase();
    if (c.type === "tuple") { out[c.name] = fillStruct(c.components, wallet, salt); continue; }
    if (/^name$/.test(n)) out[c.name] = cfg("TOKEN_NAME");
    else if (/symbol|ticker/.test(n)) out[c.name] = cfg("TOKEN_SYMBOL");
    else if (/logo|image/.test(n)) out[c.name] = cfg("LOGO");
    else if (/description/.test(n)) out[c.name] = cfg("DESCRIPTION");
    else if (/social|website|twitter|telegram/.test(n)) out[c.name] = c.type === "string" ? cfg("SOCIALS") : c.type.endsWith("[]") ? cfg("SOCIALS").split(/\s+/) : cfg("SOCIALS");
    else if (/salt/.test(n)) out[c.name] = salt;
    else if (/originaldeployer|deployer|creator$|owner/.test(n) && c.type === "address") out[c.name] = wallet;
    else if (/feerecipient|recipient/.test(n) && c.type === "address") out[c.name] = wallet;
    else if (/pairtoken|quote/.test(n) && c.type === "address") out[c.name] = "0x0000000000000000000000000000000000000000"; // ETH
    else if (/creatortax/.test(n)) out[c.name] = cfg("CREATOR_TAX_BPS");
    else if (/buyback/.test(n) && c.type === "bool") out[c.name] = cfg("BUYBACK_ENABLED");
    else if (/launchconfig|configid/.test(n)) out[c.name] = process.env.FLY_LAUNCH_CONFIG_ID != null ? Number(process.env.FLY_LAUNCH_CONFIG_ID) : 0;
    else out[c.name] = c.type.startsWith("uint") ? 0 : c.type === "bool" ? false : c.type === "address" ? "0x0000000000000000000000000000000000000000" : c.type === "bytes32" ? "0x" + "0".repeat(64) : "";
  }
  return out;
}
function predictFn(iface) { const f = fnsNamed(iface, /^predictLaunchAddresses$/)[0]; if (!f) die("the deployer ABI has no predictLaunchAddresses"); return f; }
function launchFn(iface) {
  const cands = fnsNamed(iface, /launch/i).filter(f => f.stateMutability !== "view");
  const chosen = process.env.FLY_LAUNCH_FN ? cands.find(f => f.name === process.env.FLY_LAUNCH_FN) : cands.find(f => /launchandbuy/i.test(f.name)) || cands[0];
  if (!chosen) die(`no launch function on the router; candidates: ${cands.map(describe).join(" | ") || "none"}`);
  return { fn: chosen, cands };
}

// ── commands ──
async function cmdInspect(p) {
  const { factory, deployer, router } = await abis();
  loadEnv(); const wallet = process.env.PRIVATE_KEY ? new Wallet(process.env.PRIVATE_KEY).address : null;
  console.log("deployer.predictLaunchAddresses:", describe(predictFn(deployer)));
  const { fn, cands } = launchFn(router);
  console.log("router launch functions:"); for (const c of cands) console.log(`  ${c === fn ? "*" : " "} ${describe(c)}`);
  console.log("  (* is the one `launch` will call; set FLY_LAUNCH_FN=<name> to pick another)");
  const struct = predictFn(deployer).inputs[0];
  console.log("\nlaunch struct as `mine` would fill it (wallet " + (wallet || "unknown, no PRIVATE_KEY") + "):");
  console.log(JSON.stringify(fillStruct(struct.components || [struct], wallet || "0x" + "0".repeat(40), 1), null, 2));
  for (const f of fnsNamed(factory, /canLaunch|isWhitelisted|launchAllowed|publicLaunch/i)) {
    try { const c = new Contract(cfg("FACTORY"), factory, p); const args = f.inputs.length === 1 && f.inputs[0].type === "address" ? [wallet || "0x" + "0".repeat(40)] : []; console.log(`factory.${f.name}(${args.join(",")}) =`, String(await c[f.name](...args))); } catch (e) { console.log(`factory.${f.name}: ${e.shortMessage || e.message}`); }
  }
  const recent = await recentLaunch(p);
  console.log("\nmost recent launch:", recent ? `${recent.token} (curve ${recent.curve}) in tx ${recent.tx}, block ${recent.block}` : "none in the last blocks scanned");
}

async function recentLaunch(p, span = 20_000) {
  const head = await p.getBlockNumber();
  for (let to = head, tries = 0; tries < 8 && to > 0; tries++) {
    const from = Math.max(0, to - span);
    let logs = [];
    try { logs = await p.getLogs({ address: cfg("FACTORY"), fromBlock: from, toBlock: to, topics: [TOKEN_LAUNCHED] }); } catch { span = Math.floor(span / 4); continue; }
    if (logs.length) { const l = logs[logs.length - 1]; return { token: "0x" + l.topics[1].slice(26), curve: "0x" + l.topics[2].slice(26), deployerWallet: "0x" + l.topics[3].slice(26), tx: l.transactionHash, block: l.blockNumber }; }
    to = from - 1;
  }
  return null;
}

/** Lift the two CREATE2 init codes from a real launch's trace. The deployer is the CREATE2 caller for both. */
async function cmdTemplate(p, txHash) {
  const recent = txHash ? { tx: txHash } : await recentLaunch(p);
  if (!recent) die("no recent launch found to trace; pass a launch tx hash: node pons-launch.mjs template 0x…");
  let trace;
  try { trace = await p.send("debug_traceTransaction", [recent.tx, { tracer: "callTracer" }]); }
  catch (e) { die(`debug_traceTransaction failed (${e.shortMessage || e.message}). Alchemy Growth or a node with debug enabled is needed; or paste the two creation bytecodes by hand into ${cfg("TEMPLATE_FILE")} as {curveInitCode, tokenInitCode}`); }
  const creates = [];
  (function walk(c) { if (!c) return; if (/^CREATE2$/i.test(c.type) && String(c.from).toLowerCase() === cfg("DEPLOYER").toLowerCase()) creates.push(c); for (const s of c.calls || []) walk(s); })(trace);
  if (creates.length < 2) die(`expected two CREATE2 calls from the deployer in ${recent.tx}, found ${creates.length}`);
  const [curveC, tokenC] = creates; // deployLaunch: curve first, then token
  const rcpt = await p.getTransactionReceipt(recent.tx);
  const ev = rcpt.logs.find(l => l.topics[0] === TOKEN_LAUNCHED && l.address.toLowerCase() === cfg("FACTORY").toLowerCase());
  const token = "0x" + ev.topics[1].slice(26), curve = "0x" + ev.topics[2].slice(26);
  if (String(curveC.to).toLowerCase() !== curve.toLowerCase() || String(tokenC.to).toLowerCase() !== token.toLowerCase()) die("the traced CREATE2 addresses do not match the TokenLaunched event; the deploy order may differ");
  // The token's args end with (…, originalDeployer, curve, factory, supply) per the verified source; the
  // curve's args start with (pairToken, creatorFeeRecipient, factory, …). We keep the full init codes and
  // the argument layouts and let `mine` re-encode the args it changes, keeping every other word as traced.
  const tpl = { tx: recent.tx, block: rcpt.blockNumber, sampleToken: token, sampleCurve: curve, sampleDeployerWallet: "0x" + ev.topics[3].slice(26), curveInitCode: curveC.input, tokenInitCode: tokenC.input };
  writeJson(cfg("TEMPLATE_FILE"), tpl);
  console.log(`template from ${recent.tx}: curve init ${(tpl.curveInitCode.length - 2) / 2} bytes, token init ${(tpl.tokenInitCode.length - 2) / 2} bytes -> ${cfg("TEMPLATE_FILE")}`);
}

/** Split init code into creation code + constructor args by locating where the args begin: the token args
 *  are ABI-encoded and contain the curve address and factory as whole words, so we find the LAST 32-byte-
 *  aligned window from which decoding as the expected tuple reproduces the sample values. */
function splitArgs(initCode, types, expectWords) {
  const bytes = getBytes(initCode);
  for (let cut = bytes.length - 32; cut >= 0; cut--) {
    try {
      const args = coder.decode(types, hexlify(bytes.slice(cut)));
      if (expectWords.every(([i, v]) => String(args[i]).toLowerCase() === String(v).toLowerCase())) return { creation: hexlify(bytes.slice(0, cut)), args: [...args] };
    } catch {}
  }
  return null;
}

async function offline(tpl, deployerIface, wallet) {
  // token constructor: (name, symbol, logo, description, socials, originalDeployer, curve, factory, supply)
  // curve constructor: (pairToken, creatorFeeRecipient, factory, feePolicy, policy(tuple), feeEscrow, buybackVault, phantomQuote, curveFeeBps, creatorTaxBps, buybackEnabled, graduationThreshold)
  // The policy tuple's exact shape is not knowable here, so the curve args are treated as opaque words: only
  // pairToken (word 0), creatorFeeRecipient (word 1) are substituted, and for creatorTaxBps / buybackEnabled the
  // sample's values must already equal ours, or `mine` refuses (change CONFIG to match, or trace a launch that matches).
  const tokenTypes = ["string", "string", "string", "string", "string", "address", "address", "address", "uint256"];
  const tok = splitArgs(tpl.tokenInitCode, tokenTypes, [[5, tpl.sampleDeployerWallet], [6, tpl.sampleCurve], [7, cfg("FACTORY")]]);
  if (!tok) die("could not locate the token constructor args in the traced init code (has the token's constructor changed? update tokenTypes)");
  const curveBytes = getBytes(tpl.curveInitCode);
  // curve args: find the trailing region that starts with pairToken(word)=0x0 or an address and creatorFeeRecipient=sample wallet, factory
  let curveCut = -1;
  for (let cut = curveBytes.length - 96; cut >= 0; cut -= 1) {
    const w1 = hexlify(curveBytes.slice(cut + 32, cut + 64)), w2 = hexlify(curveBytes.slice(cut + 64, cut + 96));
    if (w1.toLowerCase() === zeroPadValue(tpl.sampleDeployerWallet, 32).toLowerCase() && w2.toLowerCase() === zeroPadValue(cfg("FACTORY"), 32).toLowerCase()) { curveCut = cut; break; }
  }
  if (curveCut < 0) die("could not locate the curve constructor args (creatorFeeRecipient, factory) in the traced init code");
  const curveCreation = hexlify(curveBytes.slice(0, curveCut)), curveArgs = hexlify(curveBytes.slice(curveCut));
  const words = []; for (let i = 0; i < (curveArgs.length - 2) / 64; i++) words.push("0x" + curveArgs.slice(2 + i * 64, 66 + i * 64));
  const ours = [...words]; ours[1] = zeroPadValue(wallet, 32);
  // creatorTaxBps and buybackEnabled are the last-but-two and last-but-one words in the listed order
  const n = words.length, taxWord = BigInt(words[n - 3]), buybackWord = BigInt(words[n - 2]);
  if (taxWord !== BigInt(cfg("CREATOR_TAX_BPS")) || (buybackWord !== 0n) !== !!cfg("BUYBACK_ENABLED")) die(`the traced launch used creatorTaxBps=${taxWord} buybackEnabled=${buybackWord !== 0n}; set FLY_CREATOR_TAX_BPS / FLY_BUYBACK_ENABLED to match it, or trace a launch (template 0xTX) that used yours. Substituting these words blindly would mis-predict the address.`);
  const curveInit = concat([curveCreation, ...ours]);
  const curveHash = keccak256(curveInit);
  const tokenArgsFor = (curve) => coder.encode(tokenTypes, [cfg("TOKEN_NAME"), cfg("TOKEN_SYMBOL"), cfg("LOGO"), cfg("DESCRIPTION"), cfg("SOCIALS"), wallet, curve, cfg("FACTORY"), tok.args[8]]);
  const predict = (userSalt) => {
    const salt = keccak256(coder.encode(["address", "uint256"], [wallet, userSalt]));
    const curve = getCreate2Address(cfg("DEPLOYER"), salt, curveHash);
    const token = getCreate2Address(cfg("DEPLOYER"), salt, keccak256(concat([tok.creation, tokenArgsFor(curve)])));
    return { salt, curve, token };
  };
  return { predict, tokenCreation: tok.creation, curveHash, supply: tok.args[8].toString(), tokenTypes, curveInitLen: (curveInit.length - 2) / 2 };
}

async function onChainPredict(p, deployerIface, wallet, userSalt) {
  const f = predictFn(deployerIface);
  const struct = f.inputs[0];
  const params = fillStruct(struct.components || [struct], wallet, userSalt);
  const c = new Contract(cfg("DEPLOYER"), deployerIface, p);
  const r = await c.predictLaunchAddresses(params);
  return { token: String(r.token ?? r[0]), curve: String(r.curve ?? r[1]), params };
}

async function cmdMine(p) {
  loadEnv(); if (!process.env.PRIVATE_KEY) die("PRIVATE_KEY missing (.env)");
  const wallet = new Wallet(process.env.PRIVATE_KEY).address;
  const tpl = readJson(cfg("TEMPLATE_FILE")); if (!tpl) die("run `template` first");
  const { deployer } = await abis();
  const off = await offline(tpl, deployer, wallet);
  const prefix = String(cfg("VANITY_PREFIX")).toLowerCase().replace(/^0x/, ""), suffix = String(cfg("VANITY_SUFFIX")).toLowerCase();
  if (/[^0-9a-f]/.test(prefix + suffix)) die("vanity pattern must be hex");
  // Proof before work: the offline formula must agree with the deployer on one salt.
  const trial = 7n;
  const mine = off.predict(trial), chain = await onChainPredict(p, deployer, wallet, trial);
  console.log(`offline  salt ${trial}: token ${mine.token} curve ${mine.curve}`);
  console.log(`deployer salt ${trial}: token ${chain.token} curve ${chain.curve}`);
  if (mine.token.toLowerCase() !== chain.token.toLowerCase() || mine.curve.toLowerCase() !== chain.curve.toLowerCase()) die("offline prediction disagrees with the deployer. Nothing mined. Likely a struct field the script filled differently from CONFIG (run `inspect`), or a constructor layout change; fix and rerun.");
  console.log("offline math matches the deployer. grinding for 0x" + prefix + "…" + suffix + ` (${(16 ** (prefix.length + suffix.length)).toLocaleString()} tries expected)`);
  const found = await grind({ off, prefix, suffix, wallet, tokenCreation: off.tokenCreation, curveHash: off.curveHash, supply: off.supply, tokenTypes: off.tokenTypes }, cfg("VANITY_MAX_SECONDS"));
  if (found == null) die("no match in time; shorten the pattern or raise VANITY_MAX_SECONDS");
  const again = await onChainPredict(p, deployer, wallet, found);
  const ours = off.predict(found);
  if (again.token.toLowerCase() !== ours.token.toLowerCase()) die("the found salt does not reproduce on chain; not saving it");
  const st = readJson(cfg("STATE_FILE"), {});
  Object.assign(st, { wallet, userSalt: found.toString(), predictedToken: again.token, predictedCurve: again.curve, params: again.params, minedAt: Date.now(), templateTx: tpl.tx });
  writeJson(cfg("STATE_FILE"), st);
  console.log(`\nsalt ${found}\nTOKEN ${again.token}\ncurve ${again.curve}\nsaved to ${cfg("STATE_FILE")}. Any change to name, symbol, logo, description, socials, tax, buyback, or wallet changes the address: re-run mine.`);
}

function grind(job, maxSeconds) {
  const workers = Math.max(1, os.cpus().length - 1), chunk = 2000;
  return new Promise((resolve) => {
    let next = 1n, done = false, tried = 0n; const t0 = Date.now(); let last = t0;
    const ws = [];
    const finish = v => { if (done) return; done = true; for (const w of ws) w.terminate(); resolve(v); };
    for (let i = 0; i < workers; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { role: "grind", wallet: job.wallet, tokenCreation: job.tokenCreation, curveHash: job.curveHash, supply: job.supply, tokenTypes: job.tokenTypes, prefix: job.prefix, suffix: job.suffix, cfg: { TOKEN_NAME: cfg("TOKEN_NAME"), TOKEN_SYMBOL: cfg("TOKEN_SYMBOL"), LOGO: cfg("LOGO"), DESCRIPTION: cfg("DESCRIPTION"), SOCIALS: cfg("SOCIALS"), FACTORY: cfg("FACTORY"), DEPLOYER: cfg("DEPLOYER") } } });
      ws.push(w);
      const give = () => { const start = next; next += BigInt(chunk); w.postMessage({ start: start.toString(), count: chunk }); };
      w.on("message", m => {
        if (m.found != null) return finish(BigInt(m.found));
        tried += BigInt(m.count);
        const now = Date.now();
        if (now - last > 10_000) { last = now; console.log(`  …${tried.toLocaleString()} tried, ${Math.round((now - t0) / 1000)}s, ${Math.round(Number(tried) / ((now - t0) / 1000)).toLocaleString()}/s`); }
        if (now - t0 > maxSeconds * 1000) return finish(null);
        give();
      });
      w.on("error", e => { console.error("worker:", e.message); finish(null); });
      give();
    }
  });
}
if (!isMainThread && workerData?.role === "grind") {
  const d = workerData, c = d.cfg;
  const tokenArgsFor = (curve) => coder.encode(d.tokenTypes, [c.TOKEN_NAME, c.TOKEN_SYMBOL, c.LOGO, c.DESCRIPTION, c.SOCIALS, d.wallet, curve, c.FACTORY, BigInt(d.supply)]);
  parentPort.on("message", ({ start, count }) => {
    for (let s = BigInt(start), end = BigInt(start) + BigInt(count); s < end; s++) {
      const salt = keccak256(coder.encode(["address", "uint256"], [d.wallet, s]));
      const curve = getCreate2Address(c.DEPLOYER, salt, d.curveHash);
      const token = getCreate2Address(c.DEPLOYER, salt, keccak256(concat([d.tokenCreation, tokenArgsFor(curve)]))).slice(2).toLowerCase();
      if (token.startsWith(d.prefix) && token.endsWith(d.suffix)) return parentPort.postMessage({ found: s.toString() });
    }
    parentPort.postMessage({ count });
  });
}

async function cmdLaunch(p, dryRun) {
  loadEnv(); if (!process.env.PRIVATE_KEY) die("PRIVATE_KEY missing (.env)");
  const st = readJson(cfg("STATE_FILE")); if (!st?.userSalt) die("run `mine` first");
  const signer = new Wallet(process.env.PRIVATE_KEY, p);
  if (signer.address.toLowerCase() !== st.wallet.toLowerCase()) die(`the salt was mined for ${st.wallet}, this key is ${signer.address}`);
  const { deployer, router } = await abis();
  // the address must still be the same today (fees or config on the deployer may have changed since mining)
  const now = await onChainPredict(p, deployer, signer.address, BigInt(st.userSalt));
  if (now.token.toLowerCase() !== st.predictedToken.toLowerCase()) die(`the deployer now predicts ${now.token}, not ${st.predictedToken}: something changed since mining; re-run mine`);
  if ((await p.getCode(st.predictedToken)) !== "0x") die(`${st.predictedToken} already has code: the token was launched; run status`);
  const { fn } = launchFn(router);
  // arguments by name: the struct, the buy amount, the recipient; anything else unknown stops here
  const args = fn.inputs.map(i => {
    if (i.type === "tuple") return fillStruct(i.components, signer.address, BigInt(st.userSalt));
    const n = i.name.toLowerCase();
    if (/min|slippage/.test(n)) return 0;
    if (/recipient|to$/.test(n) && i.type === "address") return signer.address;
    if (/deadline/.test(n)) return Math.floor(Date.now() / 1000) + 1200;
    if (/amount|value|eth|quote/.test(n) && i.type.startsWith("uint")) return parseEther(cfg("DEV_BUY_ETH"));
    die(`launch function argument '${i.name}' (${i.type}) is not something this script knows how to fill; set FLY_LAUNCH_FN to another function or extend cmdLaunch`);
  });
  const value = fn.payable ? parseEther(cfg("DEV_BUY_ETH")) : 0n;
  const c = new Contract(cfg("ROUTER"), router, signer);
  console.log(`launch via router.${fn.name} with dev buy ${formatEther(value)} ETH -> token ${st.predictedToken}`);
  console.log("struct:", JSON.stringify(args[0], (k, v) => typeof v === "bigint" ? v.toString() : v));
  const bal = await p.getBalance(signer.address);
  if (bal < value + parseEther("0.01")) die(`wallet has ${formatEther(bal)} ETH; needs the dev buy plus ~0.01 for gas`);
  try { await c[fn.name].staticCall(...args, { value }); } catch (e) { die(`the launch would revert: ${e.reason || e.shortMessage || e.message}`); }
  const gas = await c[fn.name].estimateGas(...args, { value });
  console.log(`dry run ok, gas ${gas}`);
  if (dryRun) { console.log("dry run; nothing sent"); return; }
  if ((await ask("Type LAUNCH to send: ")) !== "LAUNCH") die("not confirmed");
  const tx = await c[fn.name](...args, { value, gasLimit: gas * 13n / 10n });
  console.log("sent", tx.hash); const r = await tx.wait();
  if (r.status !== 1) die(`reverted: ${tx.hash}`);
  const ev = r.logs.find(l => l.topics[0] === TOKEN_LAUNCHED);
  const token = ev ? "0x" + ev.topics[1].slice(26) : st.predictedToken;
  Object.assign(st, { launchTx: tx.hash, token, launchedAt: Date.now() }); writeJson(cfg("STATE_FILE"), st);
  console.log(`\nLIVE: ${token}\n${cfg("EXPLORER")}/token/${token}\nhttps://www.ponsfamily.com/launchpad/${token}\n\nnow: node ../../tools/launch-push.mjs --venue pons --address ${token} --update "We are live."`);
}

async function cmdStatus(p) {
  const st = readJson(cfg("STATE_FILE"), {});
  console.log(JSON.stringify(st, null, 2));
  if (st.token) console.log(`explorer ${cfg("EXPLORER")}/token/${st.token}\nlaunchpad https://www.ponsfamily.com/launchpad/${st.token}`);
}

if (isMainThread) {
  const [cmd = "inspect", extra] = process.argv.slice(2);
  loadEnv();
  const p = provider();
  const run = { abi: () => abis().then(a => console.log("ABIs cached:", Object.keys(a.raw).map(k => `${k} ${a.raw[k].length} entries`).join(", "))), inspect: () => cmdInspect(p), template: () => cmdTemplate(p, extra), mine: () => cmdMine(p), launch: () => cmdLaunch(p, extra === "--dry-run"), status: () => cmdStatus(p) }[cmd];
  if (!run) die("commands: abi | inspect | template [txHash] | mine | launch [--dry-run] | status");
  run().catch(e => die(e.stack || e.message));
}
