// ═══ The chain venue: the same interface as the simulator, on Robinhood Chain through ethers ═══
// Mainnet (4663) talks to the live PONS V2 factory and, for the launch, its launch-and-buy router.
// Testnet (46630) has no PONS deployment, so the venue talks to a FleetTestLaunchpad you deploy
// (`deploy-launchpad`); its ABI is the subset of PONS the fleet uses. A local node works the same
// way. Every wallet gets its own signer with a NonceManager and sends are serialised per wallet;
// different wallets send in parallel. Trades by anyone on the curve are read from CurveBuy /
// CurveSell logs and streamed as 'trade' events, which is what the game state eats.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { JsonRpcProvider, Wallet, NonceManager, Contract, ContractFactory, Interface, MaxUint256, ZeroAddress, ZeroHash, formatEther } from "ethers";
import { FACTORY, FACTORY_ABI, CURVE_ABI, ERC20_ABI, DEFAULT_RPC_URL, EXPLORER, TOPICS, decodeLog, curveBuyQuote, curveSellQuote, mcapQuote, curveProgress } from "../../../src/velocity/venues/pons/chain.mjs";
import { ethToWei, toEth, toTokens, snipeTaxBpsAt, DEFAULT_ECONOMICS } from "./curve-model.mjs";
import { realClock, seededRng } from "./clock.mjs";

export const NETWORKS = Object.freeze({
  4663:  { name: "robinhood",         rpc: DEFAULT_RPC_URL, explorer: EXPLORER, factory: FACTORY, router: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948", live: true },
  46630: { name: "robinhood-testnet", rpc: "https://rpc.testnet.chain.robinhood.com/rpc", explorer: "https://explorer.testnet.chain.robinhood.com", faucet: "https://faucet.testnet.chain.robinhood.com", factory: null, router: null, live: false },
});
const TOKEN_PARAMS_TUPLE = "(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)";
export const LAUNCH_ABI = [
  `function launchToken(${TOKEN_PARAMS_TUPLE} params,uint256 launchConfigId,address pairToken,address[] snipeTaxExemptions) payable returns (address token,address curve)`,
  `function launchAndBuy(${TOKEN_PARAMS_TUPLE} params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve)`,
  "function launchFee() view returns (uint256)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function previewLaunchEconomics(uint256 launchConfigId,address pairToken) view returns (bytes32)",
  "function canLaunch(address) view returns (bool)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256) view returns (tuple(uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))",
  "function launchConfigs(uint256) view returns (uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled)",
  "function launchEnabled() view returns (bool)",
];
const CURVE_EXTRA_ABI = ["function snipeTaxBps(address) view returns (uint256)", "function sellableTokens() view returns (uint256)", "function launchedAt() view returns (uint256)"];
export const GAS_LIMITS = Object.freeze({ buy: 400_000n, sell: 350_000n, approve: 80_000n, transfer: 21_000n });
const GAS_UNITS_EST = Object.freeze({ buy: 165_000n, sell: 135_000n, approve: 46_000n, transfer: 21_000n, launch: 3_600_000n });
const lc = (a) => String(a || "").toLowerCase();
const here = path.dirname(new URL(import.meta.url).pathname);

export class ChainVenue extends EventEmitter {
  /**
   * @param opts { chainId, rpcUrl, factory, router, explorer, launchConfigId, pollMs, confirmTimeoutMs, log, rng }
   */
  constructor(opts = {}) {
    super();
    this.opts = opts; this.mode = "chain";
    this.chainId = Number(opts.chainId || 0); const net = NETWORKS[this.chainId] || {};
    this.name = opts.name || net.name || `chain-${this.chainId || "?"}`;
    this.rpcUrl = opts.rpcUrl || net.rpc || null; this.explorer = opts.explorer || net.explorer || null;
    this.factoryAddress = opts.factory || net.factory || null; this.routerAddress = opts.router || net.router || null;
    this.launchConfigId = Number(opts.launchConfigId ?? 0); this.pollMs = opts.pollMs ?? 1500; this.confirmTimeoutMs = opts.confirmTimeoutMs ?? 60_000;
    this.log = opts.log || (() => {}); this.rng = opts.rng || seededRng(Date.now());
    const c = realClock(); this.now = c.now; this.sleep = c.sleep; this.clock = c;
    this.signers = new Map(); this.locks = new Map(); this.trades = []; this.token = null; this.curve = null; this.launchedAt = 0; this._gasPrice = null; this._gasPriceAt = 0;
    this.running = false; this._lastBlock = null; this.errors = [];
  }

  async init() {
    if (!this.rpcUrl) throw new Error(`no RPC for chain ${this.chainId}: set FLEET_RPC_URL`);
    this.provider = new JsonRpcProvider(this.rpcUrl, this.chainId ? { chainId: this.chainId, name: this.name } : undefined, { staticNetwork: !!this.chainId, cacheTimeout: -1, batchMaxCount: 10 });
    const net = await this.provider.getNetwork(); const id = Number(net.chainId);
    if (this.chainId && id !== this.chainId) throw new Error(`RPC is chain ${id}, expected ${this.chainId}`);
    this.chainId = id; if (!NETWORKS[id] && !this.opts.name) this.name = `local-${id}`;
    if (!this.factoryAddress) throw new Error(`no launchpad on chain ${id}: PONS has no testnet deployment; run deploy-launchpad or set FLEET_FACTORY`);
    const code = await this.provider.getCode(this.factoryAddress);
    if (code === "0x") throw new Error(`no contract at ${this.factoryAddress} on chain ${id}`);
    this.factory = new Contract(this.factoryAddress, [...FACTORY_ABI, ...LAUNCH_ABI], this.provider);
    this.router = this.routerAddress ? new Contract(this.routerAddress, LAUNCH_ABI, this.provider) : null;
    await this._refreshGasPrice();
    return { chainId: id, name: this.name, rpc: this.rpcUrl.split("?")[0], factory: this.factoryAddress, router: this.routerAddress, explorer: this.explorer, gasPriceGwei: Number(this._gasPrice) / 1e9 };
  }
  async start() { this.running = true; }
  async stop() { this.running = false; if (this._pollTimer) clearTimeout(this._pollTimer); }

  createWallet() { const w = Wallet.createRandom(); return { address: w.address, privateKey: w.privateKey }; }
  walletFromKey(privateKey) { const w = new Wallet(privateKey); return { address: w.address, privateKey }; }
  _signer(wallet) {
    const k = lc(wallet.address);
    if (!this.signers.has(k)) { if (!wallet.privateKey) throw new Error(`no private key for ${wallet.address}`); this.signers.set(k, new NonceManager(new Wallet(wallet.privateKey, this.provider))); }
    return this.signers.get(k);
  }
  /** One send at a time per wallet (nonce order); different wallets run in parallel. */
  _locked(wallet, fn) { const k = lc(wallet.address); const prev = this.locks.get(k) || Promise.resolve(); const next = prev.then(fn, fn); this.locks.set(k, next.catch(() => {})); return next; }

  async _refreshGasPrice() { if (this._gasPrice && this.now() - this._gasPriceAt < 30_000) return this._gasPrice; try { const fd = await this.provider.getFeeData(); this._gasPrice = fd.gasPrice || fd.maxFeePerGas || 100_000_000n; } catch { this._gasPrice ||= 100_000_000n; } this._gasPriceAt = this.now(); return this._gasPrice; }
  gasWei(kind) { return GAS_UNITS_EST[kind] * (this._gasPrice || 100_000_000n); }
  gasEth(kind) { return toEth(this.gasWei(kind)); }
  async ethBalance(address) { return this.provider.getBalance(address); }
  async tokenBalance(address, token = this.token) { if (!token) return 0n; return BigInt(await new Contract(token, ERC20_ABI, this.provider).balanceOf(address)); }
  explorerTx(hash) { return this.explorer ? `${this.explorer}/tx/${hash}` : hash; }

  async _wait(tx) {
    const r = await Promise.race([tx.wait(), this.sleep(this.confirmTimeoutMs).then(() => null)]);
    if (!r) throw new Error(`tx ${tx.hash} not confirmed within ${this.confirmTimeoutMs / 1000}s`);
    return r;
  }
  _gasOf(r) { return BigInt(r.gasUsed) * BigInt(r.gasPrice ?? r.effectiveGasPrice ?? this._gasPrice ?? 0n); }

  /** The fee fields a transfer is sent with, and the per-gas ceiling they imply: read fresh, 20% over
   *  the node's suggestion. A sweep that reserves 21000 × perGas and sends with these same fields can
   *  never be refused for `value + gas > balance`, which is what stranded ETH in the first on-chain run
   *  (the reserve was priced at the cached gasPrice, the send at ethers' higher maxFeePerGas). */
  async _fees() {
    const fd = await this.provider.getFeeData();
    if (fd.maxFeePerGas != null) { const max = fd.maxFeePerGas * 12n / 10n; return { maxFeePerGas: max, maxPriorityFeePerGas: fd.maxPriorityFeePerGas ?? 0n, perGas: max }; }
    const gp = (fd.gasPrice ?? this._gasPrice ?? 100_000_000n) * 12n / 10n; return { gasPrice: gp, perGas: gp };
  }
  /** What a sweep must leave behind for its own gas. */
  async sweepReserveWei() { const f = await this._fees(); return GAS_LIMITS.transfer * f.perGas; }
  async transfer(from, to, wei, { fees = null } = {}) {
    return this._locked(from, async () => {
      try {
        const f = fees || await this._fees(); const s = this._signer(from);
        const tx = await s.sendTransaction({ to, value: BigInt(wei), gasLimit: GAS_LIMITS.transfer, ...(f.gasPrice != null ? { gasPrice: f.gasPrice } : { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas }) });
        const r = await this._wait(tx); if (r.status !== 1) return { ok: false, error: "transfer reverted", hash: tx.hash }; return { ok: true, hash: tx.hash, gasWei: this._gasOf(r) };
      } catch (e) { return { ok: false, error: e.shortMessage || e.message }; }
    });
  }
  /** Everything in the wallet minus the gas of the transfer itself, priced as it is sent. */
  async sweepAll(from, to) {
    const f = await this._fees(); const bal = await this.ethBalance(from.address); const reserve = GAS_LIMITS.transfer * f.perGas;
    if (bal <= reserve) return { ok: false, error: "dust", swept: 0n };
    const r = await this.transfer(from, to, bal - reserve, { fees: f }); return { ...r, swept: r.ok ? bal - reserve : 0n };
  }

  async launchTerms() {
    const f = this.factory; const out = { launchFeeWei: 0n, snipeTaxStartBps: Number(DEFAULT_ECONOMICS.snipeTaxStartBps), snipeTaxSeconds: Number(DEFAULT_ECONOMICS.snipeTaxSeconds), canLaunch: null, config: null };
    try { out.launchFeeWei = BigInt(await f.launchFee()); } catch (e) { out.launchFeeError = e.shortMessage || e.message; }
    try { out.snipeTaxStartBps = Number(await f.snipeTaxStartBps()); out.snipeTaxSeconds = Number(await f.snipeTaxSeconds()); } catch {}
    for (const fn of ["getLaunchConfig", "launchConfigs"]) { try { const c = await f[fn](this.launchConfigId); out.config = { supply: toTokens(c.supply ?? c[0]), curveFeeBps: Number(c.curveFeeBps ?? c[1]), phantomQuote: toEth(c.phantomQuote ?? c[2]), graduationThreshold: toEth(c.graduationThreshold ?? c[3]), enabled: !!(c.enabled ?? c[6]) }; break; } catch {} }
    try { out.economics = await f.previewLaunchEconomics(this.launchConfigId, ZeroAddress); } catch {}
    try { out.launchEnabled = await f.launchEnabled(); } catch {}
    return out;
  }
  async canLaunch(address) { try { return !!(await this.factory.canLaunch(address)); } catch { return null; } }

  _params(params, from) {
    const p = params || {};
    return { name: p.name || "Token", symbol: p.symbol || "TKN", logo: p.logo || "", description: p.description || "", socials: { twitter: p.twitter || p.socials?.twitter || "", telegram: p.telegram || p.socials?.telegram || "", discord: p.discord || p.socials?.discord || "", website: p.website || p.socials?.website || "", farcaster: p.farcaster || p.socials?.farcaster || "" }, creatorFeeRecipient: p.creatorFeeRecipient || from, creatorTaxBps: Number(p.creatorTaxBps || 0), buybackEnabled: p.buybackEnabled ?? true, expectedEconomics: p.expectedEconomics || ZeroHash, salt: p.salt || ZeroHash };
  }
  /** Launch with the fleet declared exempt: through the router with the dev buy in the same tx when there is one, else the factory. `dryRun` stops after the static call. */
  async launch({ from, params = {}, exemptions = [], devBuyWei = 0n, dryRun = false }) {
    if (this.token) return { ok: false, error: `this venue already holds ${this.token}` };
    devBuyWei = BigInt(devBuyWei);
    const terms = await this.launchTerms(); const fee = terms.launchFeeWei;
    const struct = this._params({ expectedEconomics: terms.economics, ...params }, from.address);
    const signer = this._signer(from);
    const viaRouter = !!this.router && devBuyWei > 0n;
    const target = viaRouter ? this.router.connect(signer) : this.factory.connect(signer);
    const args = viaRouter ? [struct, this.launchConfigId, ZeroAddress, devBuyWei, 0n, from.address, exemptions] : [struct, this.launchConfigId, ZeroAddress, exemptions];
    const fn = viaRouter ? "launchAndBuy" : "launchToken";
    const value = viaRouter ? fee + devBuyWei : fee;
    try {
      const bal = await this.ethBalance(from.address);
      if (bal < value + this.gasWei("launch")) return { ok: false, error: `wallet has ${formatEther(bal)} ETH; the launch needs ${formatEther(value)} plus gas` };
      // The simulation returns the (token, curve) the launch would create. With a mined vanity address
      // (params.expectedToken, from pons-launch.mjs), a mismatch means the salt no longer lands there:
      // refuse before paying for it.
      let simulatedToken = null;
      try { const sim = await target[fn].staticCall(...args, { value }); const t = sim?.token ?? sim?.[0]; if (typeof t === "string" && /^0x[0-9a-fA-F]{40}$/.test(t)) simulatedToken = lc(t); } catch (e) { return { ok: false, error: `the launch would revert: ${e.reason || e.shortMessage || e.message}` }; }
      const expectedToken = params.expectedToken ? lc(params.expectedToken) : null;
      if (expectedToken && simulatedToken && simulatedToken !== expectedToken) return { ok: false, error: `the launch would create ${simulatedToken}, not the mined ${expectedToken}: the salt, the wallet, a launch parameter or the factory's terms changed since mining; re-run mine` };
      const gas = await target[fn].estimateGas(...args, { value });
      if (dryRun) return { ok: true, dryRun: true, fn, viaRouter, value, gas, struct, simulatedToken, expectedToken };
      const tx = await this._locked(from, () => target[fn](...args, { value, gasLimit: gas * 13n / 10n }));
      const r = await this._wait(tx);
      if (r.status !== 1) return { ok: false, error: `launch reverted: ${tx.hash}`, hash: tx.hash };
      const ev = r.logs.map(decodeLog).find(x => x?.kind === "launch");
      if (!ev) return { ok: false, error: `no TokenLaunched in ${tx.hash}`, hash: tx.hash };
      if (expectedToken && lc(ev.token) !== expectedToken) this.log(`[CHAIN] WARNING: launched ${ev.token}, not the mined ${expectedToken}`);
      const block = await this.provider.getBlock(r.blockNumber);
      this._attach(ev.token, ev.curve, (block?.timestamp || Math.floor(this.now() / 1000)) * 1000, r.blockNumber);
      let devBuy = null;
      const buyRec = r.logs.filter(l => lc(l.address) === lc(ev.curve)).map(decodeLog).find(x => x?.kind === "buy");
      if (buyRec) { devBuy = { ok: true, hash: tx.hash, tokensOut: ethUnits(buyRec.tokens), quoteIn: ethToWei(buyRec.quote), fee: ethToWei(buyRec.fee), tax: ethToWei(buyRec.tax), gasWei: 0n }; this._record({ ...buyRec, wallet: lc(from.address), time: this.launchedAt }); }
      else if (devBuyWei > 0n) { devBuy = await this.buy(from, devBuyWei, { slippagePct: 50 }); }
      return { ok: true, token: this.token, curve: this.curve, hash: tx.hash, launchFeeWei: fee, gasWei: this._gasOf(r), devBuy, launchedAt: this.launchedAt, viaRouter, tokenMismatch: !!(expectedToken && lc(ev.token) !== expectedToken) };
    } catch (e) { return { ok: false, error: e.shortMessage || e.message }; }
  }
  _attach(token, curve, launchedAtMs, fromBlock) {
    this.token = lc(token); this.curve = lc(curve); this.launchedAt = launchedAtMs || 0;
    this.curveContract = new Contract(this.curve, [...CURVE_ABI, ...CURVE_EXTRA_ABI], this.provider);
    this.tokenContract = new Contract(this.token, ERC20_ABI, this.provider);
    this._lastBlock = fromBlock != null ? fromBlock + 1 : null;
    this._startPolling();
  }
  /** An existing launch: the factory names the curve; the launch time comes from the TokenLaunched log if it is within reach. */
  async attach(token) {
    try {
      const r = await this.factory.getLaunchedToken(token);
      const curve = lc(r.curve || r[1] || ""); if (!curve || /^0x0+$/.test(curve)) return { ok: false, error: "the factory does not know this token" };
      const graduated = !!(r.graduated ?? r[6]);
      let launchedAt = 0, fromBlock = null;
      try { const head = await this.provider.getBlockNumber(); const logs = await this.provider.getLogs({ address: this.factoryAddress, topics: [TOPICS.TokenLaunched, null, null], fromBlock: Math.max(0, head - 50_000), toBlock: head }); const mine = logs.find(l => lc("0x" + l.topics[1].slice(26)) === lc(token)); if (mine) { const b = await this.provider.getBlock(mine.blockNumber); launchedAt = (b?.timestamp || 0) * 1000; fromBlock = mine.blockNumber; } } catch {}
      if (!launchedAt) { try { const c = new Contract(curve, CURVE_EXTRA_ABI, this.provider); launchedAt = Number(await c.launchedAt()) * 1000; } catch {} }
      this._attach(token, curve, launchedAt, fromBlock ?? (await this.provider.getBlockNumber()));
      return { ok: true, token: this.token, curve: this.curve, deployer: lc(r.deployer || r[2] || ""), graduated, launchedAt };
    } catch (e) { return { ok: false, error: e.shortMessage || e.message }; }
  }

  /** Poll the curve's logs for everyone's trades. */
  _startPolling() {
    this.running = true;
    const tick = async () => {
      if (!this.running || !this.curve) return;
      try {
        const head = await this.provider.getBlockNumber();
        if (this._lastBlock == null) this._lastBlock = head;
        if (head >= this._lastBlock) {
          const to = Math.min(head, this._lastBlock + 2000);
          const logs = await this.provider.getLogs({ address: this.curve, topics: [[TOPICS.CurveBuy, TOPICS.CurveSell, TOPICS.CurveCompleted]], fromBlock: this._lastBlock, toBlock: to });
          logs.sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.index ?? 0) - (b.index ?? 0)));
          const now = this.now();
          for (const l of logs) { const rec = decodeLog(l); if (!rec) continue; if (rec.kind === "complete") { this.graduatedSeen = true; continue; } if (this._seen?.has(rec.tx + ":" + rec.logIndex)) continue; this._record({ ...rec, time: now }); }
          this._lastBlock = to + 1;
        }
      } catch (e) { this.errors.push(`${new Date().toISOString()} ${e.shortMessage || e.message}`); if (this.errors.length > 50) this.errors.shift(); }
      if (this.running) this._pollTimer = setTimeout(tick, this.pollMs);
    };
    tick();
  }
  _record(rec) {
    (this._seen ||= new Set()).add(rec.tx + ":" + rec.logIndex);
    const t = { time: rec.time || this.now(), kind: rec.kind, wallet: lc(rec.wallet), quote: rec.quote, tokens: rec.tokens, fee: rec.fee, tax: rec.tax, tx: rec.tx, block: rec.block };
    this.trades.push(t); if (this.trades.length > 5000) this.trades = this.trades.slice(-4000);
    this.emit("trade", t);
  }

  async curveInfo() {
    if (!this.curveContract) return null;
    const c = this.curveContract;
    const [[q, t], real, feeBps, taxBps, thr, phantom, graduated] = await Promise.all([c.getReserves(), c.realQuoteReserve(), c.feeBps().catch(() => 100n), c.creatorTaxBps().catch(() => 0n), c.graduationThreshold().catch(() => 0n), c.phantomQuote().catch(() => 0n), c.graduated().catch(() => false)]);
    const info = { quoteReserve: toEth(q), tokenReserve: toTokens(t), realQuoteReserve: toEth(real), feeBps: Number(feeBps), creatorTaxBps: Number(taxBps), graduationThreshold: toEth(thr), phantomQuote: toEth(phantom), graduated: !!graduated, native: true, address: this.curve, token: this.token, launchedAt: this.launchedAt };
    info.progress = info.graduated ? 1 : curveProgress(info.realQuoteReserve, info.graduationThreshold);
    info.mcapEth = mcapQuote(info); info.spotEth = info.tokenReserve > 0 ? info.quoteReserve / info.tokenReserve : 0;
    return info;
  }
  async _snipeBps(address) {
    try { return Number(await this.curveContract.snipeTaxBps(address)); } catch {}
    if (!this.launchedAt) return 0;
    const terms = this._terms || (this._terms = await this.launchTerms());
    return Number(snipeTaxBpsAt(BigInt(terms.snipeTaxStartBps), terms.snipeTaxSeconds, (this.now() - this.launchedAt) / 1000));
  }
  async quoteBuy(wei, wallet) {
    try { const info = await this.curveInfo(); if (!info) return { ok: false, error: "no curve" }; if (info.graduated) return { ok: false, error: "graduated" }; const snipe = await this._snipeBps(wallet?.address || wallet); const q = curveBuyQuote(info, toEth(wei), info.feeBps + info.creatorTaxBps + snipe); return { ok: true, tokensOut: q.tokensOut, spent: toEth(wei), fee: q.feeQuote, snipeTaxBps: snipe, spot: q.spot }; } catch (e) { return { ok: false, error: e.shortMessage || e.message }; }
  }
  async quoteSell(units) {
    try { const info = await this.curveInfo(); if (!info) return { ok: false, error: "no curve" }; if (info.graduated) return { ok: false, error: "graduated" }; const q = curveSellQuote(info, toTokens(units), info.feeBps + info.creatorTaxBps); return { ok: true, quoteOut: q.quoteOut, fee: q.feeQuote, spot: q.spot }; } catch (e) { return { ok: false, error: e.shortMessage || e.message }; }
  }

  async buy(wallet, quoteWei, { slippagePct = 15 } = {}) {
    if (!this.curve) return { ok: false, error: "no launch attached" };
    quoteWei = BigInt(quoteWei);
    return this._locked(wallet, async () => {
      try {
        const q = await this.quoteBuy(quoteWei, wallet); if (!q.ok) return q;
        const minOut = ethUnits(q.tokensOut * (1 - slippagePct / 100));
        const c = this.curveContract.connect(this._signer(wallet));
        const tx = await c.buy(quoteWei, minOut, wallet.address, { value: quoteWei, gasLimit: GAS_LIMITS.buy });
        const r = await this._wait(tx);
        const gasWei = this._gasOf(r);
        if (r.status !== 1) return { ok: false, error: `buy reverted: ${tx.hash}`, hash: tx.hash, gasWei };
        const rec = r.logs.filter(l => lc(l.address) === this.curve).map(decodeLog).find(x => x?.kind === "buy");
        if (rec) this._record({ ...rec, wallet: lc(wallet.address), time: this.now() });
        const graduated = r.logs.filter(l => lc(l.address) === this.curve).map(decodeLog).some(x => x?.kind === "complete");
        return { ok: true, hash: tx.hash, tokensOut: rec ? ethUnits(rec.tokens) : ethUnits(q.tokensOut), quoteIn: rec ? ethToWei(rec.quote) : quoteWei, fee: rec ? ethToWei(rec.fee) : 0n, tax: rec ? ethToWei(rec.tax) : 0n, gasWei, graduated, block: r.blockNumber, exact: !!rec };
      } catch (e) { return { ok: false, error: e.reason || e.shortMessage || e.message }; }
    });
  }
  async sell(wallet, tokenUnits, { slippagePct = 15 } = {}) {
    if (!this.curve) return { ok: false, error: "no launch attached" };
    tokenUnits = BigInt(tokenUnits);
    return this._locked(wallet, async () => {
      try {
        const signer = this._signer(wallet); const token = this.tokenContract.connect(signer);
        const allowance = BigInt(await token.allowance(wallet.address, this.curve)); let gasWei = 0n;
        if (allowance < tokenUnits) { const a = await token.approve(this.curve, MaxUint256, { gasLimit: GAS_LIMITS.approve }); const ar = await this._wait(a); gasWei += this._gasOf(ar); if (ar.status !== 1) return { ok: false, error: `approve reverted: ${a.hash}`, gasWei }; }
        const q = await this.quoteSell(tokenUnits); if (!q.ok) return q;
        const minOut = ethToWei(Math.max(0, q.quoteOut * (1 - slippagePct / 100)));
        const c = this.curveContract.connect(signer);
        try { await c.sell.staticCall(tokenUnits, minOut, wallet.address); } catch (e) { return { ok: false, error: `sell would revert: ${e.reason || e.shortMessage || e.message}`, revert: e.reason || null }; }
        const tx = await c.sell(tokenUnits, minOut, wallet.address, { gasLimit: GAS_LIMITS.sell });
        const r = await this._wait(tx); gasWei += this._gasOf(r);
        if (r.status !== 1) return { ok: false, error: `sell reverted: ${tx.hash}`, hash: tx.hash, gasWei };
        const rec = r.logs.filter(l => lc(l.address) === this.curve).map(decodeLog).find(x => x?.kind === "sell");
        if (rec) this._record({ ...rec, wallet: lc(wallet.address), time: this.now() });
        return { ok: true, hash: tx.hash, quoteOut: rec ? ethToWei(rec.quote) : ethToWei(q.quoteOut), tokensIn: tokenUnits, fee: rec ? ethToWei(rec.fee) : 0n, tax: rec ? ethToWei(rec.tax) : 0n, gasWei, block: r.blockNumber, exact: !!rec };
      } catch (e) { return { ok: false, error: e.reason || e.shortMessage || e.message }; }
    });
  }
  /** Allowances for every fleet wallet up front, so a rug is one sell per wallet with nothing in between. */
  async approveAll(wallets) {
    if (!this.curve) return;
    await Promise.allSettled(wallets.map(w => this._locked(w, async () => { try { const t = this.tokenContract.connect(this._signer(w)); if (BigInt(await t.allowance(w.address, this.curve)) < MaxUint256 / 2n) { const a = await t.approve(this.curve, MaxUint256, { gasLimit: GAS_LIMITS.approve }); await this._wait(a); } } catch (e) { this.log(`[CHAIN] approve ${w.address.slice(0, 8)} failed: ${e.shortMessage || e.message}`); } })));
  }

  /** Testnet or local only: deploy FleetTestLaunchpad from the committed artifact. */
  static async deployTestLaunchpad({ rpcUrl, chainId, privateKey, launchFeeEth = 0.001, economics = {}, log = () => {} }) {
    const art = JSON.parse(fs.readFileSync(path.join(here, "..", "contracts", "FleetTestLaunchpad.json"), "utf8"));
    const provider = new JsonRpcProvider(rpcUrl, chainId ? { chainId, name: "rh" } : undefined, { staticNetwork: !!chainId, cacheTimeout: -1 });
    const id = Number((await provider.getNetwork()).chainId);
    if (NETWORKS[id]?.live) throw new Error(`refusing to deploy the test launchpad on ${NETWORKS[id].name} (chain ${id}): mainnet has the real PONS factory`);
    const wallet = new Wallet(privateKey, provider);
    const e = { ...DEFAULT_ECONOMICS, ...economics };
    const f = new ContractFactory(art.contracts.FleetTestLaunchpad.abi, art.contracts.FleetTestLaunchpad.bytecode, wallet);
    const c = await f.deploy(ethToWei(launchFeeEth), BigInt(e.supply), BigInt(e.curveFeeBps), BigInt(e.phantomQuote), BigInt(e.graduationThreshold));
    const r = await c.deploymentTransaction().wait();
    const address = await c.getAddress();
    log(`[CHAIN] FleetTestLaunchpad deployed at ${address} on chain ${id} (tx ${r.hash})`);
    return { address, chainId: id, hash: r.hash, deployer: wallet.address };
  }
  stats() { const ext = this.trades; return { trades: ext.length, buys: ext.filter(t => t.kind === "buy").length, sells: ext.filter(t => t.kind === "sell").length, wallets: new Set(ext.map(t => t.wallet)).size, errors: this.errors.slice(-3) }; }
}
/** Token units from a float count (18 decimals), rounded down. */
function ethUnits(tokens) { return BigInt(Math.floor(Math.max(0, tokens) * 1e6)) * 10n ** 12n; }
export default ChainVenue;
