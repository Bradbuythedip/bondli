// ═══ PONS V2 bonding curve, in the contract's own integers ═══
// A faithful port of PonsV2BondingCurve.buy/sell and PonsV2BondingCurveMath (ponsdotdev/ponsfamily,
// contractsV2/src/v2) in BigInt wei, so the simulator prices a trade the way the chain would: the
// trade fee and the creator tax come off the quote leg on both sides, a buy that would take the curve
// past its reserved allocation is clamped and refunded, a sell is refused once the curve is ready to
// graduate, and graduation is exactly the exhaustion of the sellable allocation.
//
// The one thing this file models that the published curve source does not show is the opening snipe
// tax. PonsV2LaunchFactory snapshots `snipeTaxStartBps` (99%) and `snipeTaxSeconds` (15) into every
// curve and exempts the deployer, the creator fee recipient and a declared list of up to 32 wallets;
// the factory's comment says the curve "decays it exponentially to zero" across the window. The shape
// here (start * (1 - t/window)^2, zero at the window) is an approximation of that decay; what the
// strategy depends on is only that undeclared buys inside the window are mostly a donation and
// declared ones are not, and that is exact. `preflight` reads the live start/window from the factory.
import { formatUnits } from "ethers";

export const BPS = 10_000n;
export const WAD = 10n ** 18n;
export const TOKEN_DECIMALS = 18;
export const MAX_SNIPE_TAX_EXEMPTIONS = 32;

/** Launch economics the simulator uses when the chain is not asked. The phantom reserve and the 1%
 *  curve fee are what bondli's PONS feed assumes for an unseen curve; the graduation threshold,
 *  launch fee and snipe terms are configurable, and `preflight` prints the live ones. */
export const DEFAULT_ECONOMICS = Object.freeze({
  phantomQuote: 3n * WAD,                 // virtual ETH seeded at deploy: sets the opening price
  graduationThreshold: 6n * WAD,          // real ETH the curve must hold before it graduates
  supply: 1_000_000_000n * WAD,           // fixed supply, all minted to the curve
  curveFeeBps: 100n,                      // 1% trade fee on the quote leg, both sides
  creatorTaxBps: 0n,                      // creator-chosen extra fee, paid to the creator
  launchFee: WAD / 1000n,                 // msg.value the factory demands to launch
  snipeTaxStartBps: 9_900n,               // 99% in the launch second …
  snipeTaxSeconds: 15,                    // … decaying to zero across this window
});

export class CurveError extends Error { constructor(name, detail = "") { super(detail ? `${name}(${detail})` : name); this.name = name; } }

export const mulDiv = (a, b, d, ceil = false) => { const q = (a * b) / d; return ceil && (a * b) % d !== 0n ? q + 1n : q; };
export const toEth = (wei) => Number(formatUnits(BigInt(wei), 18));
export const toTokens = (units) => Number(formatUnits(BigInt(units), TOKEN_DECIMALS));
export const ethToWei = (eth) => BigInt(Math.round(Number(eth) * 1e12)) * 10n ** 6n; // 12 decimals of ETH is plenty; exact for sums the strategy makes
export const tokensToUnits = (t) => BigInt(Math.floor(Number(t) * 1e6)) * 10n ** 12n;

/** PonsV2BondingCurveMath.getAmountOut: exact-input quote, fee on the input, reverting where the contract does. */
export function amountOut(amountIn, reserveIn, reserveOut, feeBps = 0n) {
  if (amountIn === 0n) throw new CurveError("InsufficientInputAmount");
  if (reserveIn === 0n || reserveOut === 0n) throw new CurveError("InsufficientLiquidity");
  const inFee = amountIn * (BPS - feeBps);
  const out = (inFee * reserveOut) / (reserveIn * BPS + inFee);
  if (out === 0n) throw new CurveError("InsufficientOutputAmount");
  return out;
}
/** PonsV2BondingCurveMath.getAmountIn: exact-output quote. */
export function amountIn(amountOutWanted, reserveIn, reserveOut, feeBps = 0n) {
  if (amountOutWanted === 0n) throw new CurveError("InsufficientOutputAmount");
  if (reserveIn === 0n || reserveOut <= amountOutWanted) throw new CurveError("InsufficientLiquidity");
  if (feeBps >= BPS) throw new CurveError("InsufficientLiquidity");
  return (amountOutWanted * reserveIn * BPS) / ((reserveOut - amountOutWanted) * (BPS - feeBps)) + 1n;
}

/** The opening tax an undeclared wallet pays, in bps, `elapsedSec` after launch. */
export function snipeTaxBpsAt(startBps, windowSec, elapsedSec) {
  if (startBps <= 0n || windowSec <= 0 || elapsedSec >= windowSec) return 0n;
  const left = Math.max(0, 1 - Math.max(0, elapsedSec) / windowSec);
  return BigInt(Math.floor(Number(startBps) * left * left));
}

export class CurveModel {
  /**
   * @param econ   DEFAULT_ECONOMICS-shaped, BigInt wei / units
   * @param opts   { launchedAtMs, deployer, creatorFeeRecipient, exemptions: address[] }
   */
  constructor(econ = {}, opts = {}) {
    const e = { ...DEFAULT_ECONOMICS, ...econ };
    this.phantomQuote = BigInt(e.phantomQuote); this.graduationThreshold = BigInt(e.graduationThreshold);
    this.supply = BigInt(e.supply); this.feeBps = BigInt(e.curveFeeBps); this.creatorTaxBps = BigInt(e.creatorTaxBps);
    this.snipeTaxStartBps = BigInt(e.snipeTaxStartBps); this.snipeTaxSeconds = Number(e.snipeTaxSeconds);
    if (this.feeBps + this.creatorTaxBps > 2_000n) throw new CurveError("InvalidFeePolicy");
    this.launchedAtMs = opts.launchedAtMs ?? 0;
    this.deployer = String(opts.deployer || "").toLowerCase();
    this.exempt = new Set([this.deployer, String(opts.creatorFeeRecipient || this.deployer).toLowerCase(), ...(opts.exemptions || []).map(a => String(a).toLowerCase())].filter(Boolean));
    if ((opts.exemptions || []).length > MAX_SNIPE_TAX_EXEMPTIONS) throw new CurveError("ExemptionListTooLong");
    // initialize(): the reserved balance is the graduation point expressed on the token side
    this.reservedTokens = mulDiv(this.supply, this.phantomQuote, this.phantomQuote + this.graduationThreshold);
    if (this.reservedTokens === 0n || this.reservedTokens >= this.supply) throw new CurveError("InvalidLaunchEconomics");
    this.trackedQuote = 0n; this.trackedTokens = this.supply;
    this.quoteFeeBalance = 0n; this.creatorTaxBalance = 0n; this.snipeTaxBalance = 0n;
    this.graduated = false;
    this.sweptQuote = 0n; this.sweptTokens = 0n;
  }

  getReserves() { return { quoteReserve: this.phantomQuote + this.trackedQuote - this.quoteFeeBalance - this.creatorTaxBalance, tokenReserve: this.trackedTokens }; }
  realQuoteReserve() { return this.trackedQuote - this.quoteFeeBalance - this.creatorTaxBalance; }
  sellableTokens() { return this.trackedTokens > this.reservedTokens ? this.trackedTokens - this.reservedTokens : 0n; }
  readyToGraduate() { return !this.graduated && this.sellableTokens() === 0n; }
  /** 0..1 progress to graduation, the way bondli's feed measures it. */
  progress() { return this.graduated ? 1 : Math.min(1, Math.max(0, Number(this.realQuoteReserve() * 10_000n / this.graduationThreshold) / 10_000)); }
  /** Spot price in ETH per token, and market cap in ETH (spot × supply), from the virtual reserves. */
  spotEth() { const { quoteReserve, tokenReserve } = this.getReserves(); return tokenReserve > 0n ? toEth(quoteReserve) / toTokens(tokenReserve) : 0; }
  mcapEth() { return this.spotEth() * toTokens(this.supply); }
  snipeTaxBpsFor(wallet, nowMs) { return this.exempt.has(String(wallet).toLowerCase()) ? 0n : snipeTaxBpsAt(this.snipeTaxStartBps, this.snipeTaxSeconds, (nowMs - this.launchedAtMs) / 1000); }

  /** What buy() would do with `received` wei from `buyer` now, without doing it. */
  quoteBuy(received, buyer, nowMs) {
    if (this.graduated) throw new CurveError("CurveGraduated");
    received = BigInt(received);
    if (received === 0n) throw new CurveError("ZeroAmount");
    const { quoteReserve, tokenReserve } = this.getReserves();
    const snipeBps = this.snipeTaxBpsFor(buyer, nowMs);
    const totalBps = this.feeBps + this.creatorTaxBps + snipeBps;
    if (totalBps >= BPS) throw new CurveError("InsufficientLiquidity");
    let spent = received;
    let fee = (spent * this.feeBps) / BPS, tax = (spent * this.creatorTaxBps) / BPS, snipe = (spent * snipeBps) / BPS;
    let tokensOut = amountOut(spent - fee - tax - snipe, quoteReserve, tokenReserve, 0n);
    const sellable = this.sellableTokens();
    if (sellable === 0n) throw new CurveError("CurveGraduated");
    let clamped = false;
    if (tokensOut > sellable) {
      // the last buy is filled up to the allocation and refunded the rest, never refused
      tokensOut = sellable; clamped = true;
      const net = amountIn(sellable, quoteReserve, tokenReserve, 0n);
      const grossed = mulDiv(net, BPS, BPS - totalBps, true);
      spent = grossed < received ? grossed : received;
      fee = (spent * this.feeBps) / BPS; tax = (spent * this.creatorTaxBps) / BPS; snipe = (spent * snipeBps) / BPS;
    }
    return { spent, fee, tax, snipe, snipeBps, tokensOut, refund: received - spent, clamped, spotBefore: toEth(quoteReserve) / toTokens(tokenReserve) };
  }

  /** buy(quoteIn = msg.value, minTokensOut, recipient). Returns the CurveBuy record. */
  buy(received, minTokensOut, buyer, nowMs) {
    const q = this.quoteBuy(received, buyer, nowMs);
    received = BigInt(received); minTokensOut = BigInt(minTokensOut || 0n);
    // a partial fill turns minTokensOut into a price bound: identical to tokensOut >= minTokensOut when nothing was clamped
    if (q.spent * minTokensOut > received * q.tokensOut) throw new CurveError("SlippageExceeded", `${q.tokensOut}, ${minTokensOut}`);
    this.quoteFeeBalance += q.fee; this.creatorTaxBalance += q.tax; this.snipeTaxBalance += q.snipe;
    this.trackedQuote += q.spent; this.trackedTokens -= q.tokensOut;
    // the snipe tax is paid out of the curve like any other fee, so it never prices trades
    this.trackedQuote -= q.snipe; this.snipeTaxBalance -= q.snipe; this.snipeTaxPaid = (this.snipeTaxPaid || 0n) + q.snipe;
    if (this.readyToGraduate()) this._graduate();
    return { kind: "buy", wallet: String(buyer).toLowerCase(), quoteIn: q.spent, tokensOut: q.tokensOut, fee: q.fee, tax: q.tax, snipe: q.snipe, refund: q.refund, graduated: this.graduated };
  }

  quoteSell(tokensIn) {
    if (this.graduated || this.readyToGraduate()) throw new CurveError("CurveGraduated");
    tokensIn = BigInt(tokensIn);
    if (tokensIn === 0n) throw new CurveError("ZeroAmount");
    const { quoteReserve, tokenReserve } = this.getReserves();
    const gross = amountOut(tokensIn, tokenReserve, quoteReserve, 0n);
    const fee = (gross * this.feeBps) / BPS, tax = (gross * this.creatorTaxBps) / BPS;
    const quoteOut = gross - fee - tax;
    if (quoteOut > this.realQuoteReserve()) throw new CurveError("InsufficientLiquidity"); // the curve cannot pay out phantom ETH
    return { gross, fee, tax, quoteOut, spotBefore: toEth(quoteReserve) / toTokens(tokenReserve) };
  }

  /** sell(tokensIn, minQuoteOut, recipient). Returns the CurveSell record. */
  sell(tokensIn, minQuoteOut, seller) {
    const q = this.quoteSell(tokensIn);
    minQuoteOut = BigInt(minQuoteOut || 0n);
    if (q.quoteOut < minQuoteOut) throw new CurveError("SlippageExceeded", `${q.quoteOut}, ${minQuoteOut}`);
    this.quoteFeeBalance += q.fee; this.creatorTaxBalance += q.tax;
    this.trackedQuote -= q.quoteOut; this.trackedTokens += BigInt(tokensIn);
    return { kind: "sell", wallet: String(seller).toLowerCase(), tokensIn: BigInt(tokensIn), quoteOut: q.quoteOut, fee: q.fee, tax: q.tax };
  }

  _graduate() {
    this.graduated = true;
    // sweep: fees leave, reserves are handed to the (unmodelled) V4 pool
    this.sweptQuote = this.trackedQuote - this.quoteFeeBalance - this.creatorTaxBalance;
    this.sweptTokens = this.trackedTokens;
    this.feesSwept = (this.feesSwept || 0n) + this.quoteFeeBalance + this.creatorTaxBalance;
    this.quoteFeeBalance = 0n; this.creatorTaxBalance = 0n;
  }

  /** The curve as bondli's feed and router describe it (floats), for anything that speaks that shape. */
  info() {
    const { quoteReserve, tokenReserve } = this.getReserves();
    return { quoteReserve: toEth(quoteReserve), tokenReserve: toTokens(tokenReserve), realQuoteReserve: toEth(this.realQuoteReserve()), feeBps: Number(this.feeBps), creatorTaxBps: Number(this.creatorTaxBps), graduationThreshold: toEth(this.graduationThreshold), phantomQuote: toEth(this.phantomQuote), graduated: this.graduated, progress: this.progress(), mcapEth: this.mcapEth(), spotEth: this.spotEth(), native: true, sellableTokens: toTokens(this.sellableTokens()) };
  }
}
