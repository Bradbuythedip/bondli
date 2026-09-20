// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title FleetTestLaunchpad: a PONS-shaped launchpad for Robinhood Chain testnet
/// @notice PONS V2 has no testnet deployment, so the fleet launcher is rehearsed against this: the
///         same function and event signatures bondli's PONS venue and the fleet's chain venue call
///         (TokenLaunched, CurveBuy, CurveSell, CurveCompleted, getLaunchedToken, buy, sell,
///         getReserves, realQuoteReserve, readyToGraduate, feeBps, creatorTaxBps, phantomQuote,
///         graduationThreshold, launchToken with snipe-tax exemptions, launchAndBuy), the same
///         constant-product curve with quote-denominated fees, the same clamped last buy, the same
///         graduation point, and an opening snipe tax that decays across a window with exemptions.
///         Graduation escrows the raise and the seed supply in the launchpad, per token, for a
///         seeder to open a pool with; on Ink that seeder mints a Calamari v4 position. It is not a
///         test double any more in the parts that hold money -- payouts cannot revert, the levies
///         cannot exceed the principal, the pool is seeded at the curve's closing price rather than
///         a third below it, and the owner cannot reach a raise -- but it has no buyback vault, no
///         LP locker and no vanity CREATE2, and it has not been audited by anyone but itself.

contract FleetTestToken {
    string public name; string public symbol; uint8 public constant decimals = 18; uint256 public totalSupply;
    address public immutable deployer; address public immutable curve; string public logo; string public description;
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor(string memory name_, string memory symbol_, string memory logo_, string memory description_, address deployer_, address curve_, uint256 supply_) {
        name = name_; symbol = symbol_; logo = logo_; description = description_; deployer = deployer_; curve = curve_;
        totalSupply = supply_; balanceOf[curve_] = supply_; emit Transfer(address(0), curve_, supply_);
    }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) { require(a >= amount, "allowance"); allowance[from][msg.sender] = a - amount; }
        _transfer(from, to, amount); return true;
    }
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero address"); uint256 b = balanceOf[from]; require(b >= amount, "balance");
        unchecked { balanceOf[from] = b - amount; balanceOf[to] += amount; } emit Transfer(from, to, amount);
    }
}

contract FleetTestCurve {
    uint256 private constant BASIS_POINTS = 10_000;
    error CurveGraduated(); error ZeroAmount(); error ZeroAddress(); error SlippageExceeded(uint256 actual, uint256 minimum);
    error NotFactory(); error TransferFailed(); error NativeValueMismatch(uint256 supplied, uint256 expected); error InsufficientLiquidity();
    error LeviesExceedPrincipal(uint256 bps);
    error NothingOwed();
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax);
    event CurveBuyRefunded(address indexed buyer, uint256 refund);
    event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax);
    event CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut);
    event SnipeTaxExempted(address indexed wallet);
    /// The opening tax charged on a buy. Its own event rather than a field on CurveBuy, because
    /// CurveBuy's signature is the one bondli's PONS adapter already indexes by topic and PONS
    /// itself does not emit this; adding a field would break the reader for both venues.
    event SnipeTaxCharged(address indexed buyer, uint256 amount);
    event PaymentDeferred(address indexed to, uint256 amount);
    event Claimed(address indexed to, uint256 amount);
    event TokensBurned(uint256 amount);

    address public token; address public immutable factory; address public immutable pairToken = address(0);
    /// Who launched the token. This is the identity a rug model follows across launches, and it used
    /// to be overwritten with the creator's chosen fee recipient -- a different address whenever the
    /// creator nominated one, which silently split the thing being tracked in two and disagreed with
    /// the factory's own LaunchedToken.deployer for the same token.
    address public deployer;
    /// Where the creator's tax goes. Chosen by the launcher, and therefore not an identity at all.
    address public feeRecipient;
    uint256 public immutable phantomQuote; uint256 public immutable feeBps; uint256 public immutable creatorTaxBps; uint256 public immutable graduationThreshold;
    uint256 public immutable snipeTaxStartBps; uint256 public immutable snipeTaxSeconds; uint256 public launchedAt;
    uint256 public trackedQuote; uint256 public trackedTokens; uint256 public reservedTokens; uint256 public quoteFeeBalance; uint256 public creatorTaxBalance; uint256 public snipeTaxPaid;
    /// Payments that could not be pushed. See _pay.
    mapping(address => uint256) public owed; uint256 public totalOwed;
    bool public graduated;
    mapping(address => bool) public snipeTaxExempt;

    modifier onlyFactory() { if (msg.sender != factory) revert NotFactory(); _; }

    constructor(address deployer_, address feeRecipient_, uint256 phantomQuote_, uint256 feeBps_, uint256 creatorTaxBps_, uint256 graduationThreshold_, uint256 snipeStart_, uint256 snipeSeconds_) {
        if (deployer_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        // The standing levies must leave something to buy with. These two are fixed for the life of
        // the curve, so the check belongs here; the snipe tax is time-varying and is clamped against
        // whatever they leave, in snipeTaxBps below.
        if (feeBps_ + creatorTaxBps_ >= BASIS_POINTS) revert LeviesExceedPrincipal(feeBps_ + creatorTaxBps_);
        factory = msg.sender; deployer = deployer_; feeRecipient = feeRecipient_; phantomQuote = phantomQuote_; feeBps = feeBps_; creatorTaxBps = creatorTaxBps_; graduationThreshold = graduationThreshold_;
        snipeTaxStartBps = snipeStart_; snipeTaxSeconds = snipeSeconds_;
        snipeTaxExempt[deployer_] = true; snipeTaxExempt[feeRecipient_] = true; snipeTaxExempt[msg.sender] = true; // the dev, their payee, and launch-and-buy
    }
    function initialize(address token_) external onlyFactory {
        require(token == address(0), "initialized"); token = token_; launchedAt = block.timestamp;
        uint256 supply = FleetTestToken(token_).totalSupply();
        reservedTokens = (supply * phantomQuote) / (phantomQuote + graduationThreshold);
        require(reservedTokens > 0 && reservedTokens < supply, "economics");
        trackedTokens = FleetTestToken(token_).balanceOf(address(this));
    }
    function exemptFromSnipeTax(address wallet) external onlyFactory { snipeTaxExempt[wallet] = true; emit SnipeTaxExempted(wallet); }

    /**
     * Pay, and if the recipient will not take it, remember that we owe them.
     *
     * Every payout here used to be a push that reverted the whole transaction on failure, and three
     * of them sat on the graduation path: the creator's tax, the protocol's fee and the raise
     * itself. The creator's fee recipient is chosen by whoever launched the token, so for the price
     * of one launch fee anyone could nominate a contract whose receive() reverts and the curve would
     * fill to the last token and then refuse every further buy, forever, with the fees stranded and
     * every holder trapped just below the top. An honest creator using a Safe without a payable
     * fallback does the same thing to themselves by accident.
     *
     * The gas stipend is the other half of it: without a cap a recipient can burn the whole gas
     * limit in its fallback and fail the transaction that way instead.
     *
     * So the happy path still pushes -- a seller gets their ETH in the same transaction, which is
     * what anyone expects -- and the unhappy path becomes a debt they can collect, rather than a
     * lever on everybody else. Nothing on the graduation path can revert any more.
     */
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool s,) = payable(to).call{value: amount, gas: 30_000}("");
        if (!s) { owed[to] += amount; totalOwed += amount; emit PaymentDeferred(to, amount); }
    }

    /// @notice Push any ETH the curve holds beyond what it owes to the launchpad. Nothing here
    ///         accepts a plain transfer, but selfdestruct and a coinbase payout do not ask, so
    ///         without this a donation is stuck in the contract for good. Permissionless, because it
    ///         can only ever move money that belongs to nobody.
    function skim() external returns (uint256 extra) {
        uint256 owedOut = trackedQuote + totalOwed;
        uint256 bal = address(this).balance;
        if (bal <= owedOut) return 0;
        extra = bal - owedOut;
        _pay(factory, extra);
    }

    /// @notice Collect a payment that could not be pushed. Sends only to the caller.
    function claim() external returns (uint256 amount) {
        amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0; totalOwed -= amount;
        emit Claimed(msg.sender, amount);
        (bool s,) = payable(msg.sender).call{value: amount}("");
        if (!s) revert TransferFailed();
    }

    function isNativeQuote() external pure returns (bool) { return true; }
    function getReserves() public view returns (uint256 quoteReserve_, uint256 tokenReserve_) { quoteReserve_ = phantomQuote + trackedQuote - quoteFeeBalance - creatorTaxBalance; tokenReserve_ = trackedTokens; }
    function quoteReserve() external view returns (uint256 q) { (q,) = getReserves(); }
    function tokenReserve() external view returns (uint256 t) { (, t) = getReserves(); }
    function realQuoteReserve() public view returns (uint256) { return trackedQuote - quoteFeeBalance - creatorTaxBalance; }
    function sellableTokens() public view returns (uint256) { return trackedTokens > reservedTokens ? trackedTokens - reservedTokens : 0; }
    function readyToGraduate() public view returns (bool) { return !graduated && sellableTokens() == 0; }
    /**
     * @notice The opening tax `who` would pay right now, in bps: zero if exempt or past the window;
     *         start*(left/window)^2 inside it, clamped so the levies can never reach the principal.
     *
     * The clamp is not a nicety. With the shipped defaults -- a 1% curve fee and a 9900 bps opening
     * tax -- the levies total exactly 10000 with no creator tax and more than that with any, so the
     * whole of the launch block reverted: `ZeroAmount` at exactly 10000 because the net spend
     * rounded to nothing, and a bare `Panic(0x11)` above it from `spent - fee - tax - snipe`
     * underflowing. The clamped final buy divides by `BASIS_POINTS - totalBps`, which was a division
     * by zero on the same inputs. So the most contested second of a launch -- the one the tax exists
     * for -- was not taxed at 99%, it was unavailable, and the first trade anyone could make was a
     * second later at 86%.
     *
     * Reported here rather than at the point of charge so that this view and what a buyer is
     * actually charged cannot disagree: a quote that lies about the tax is worse than no quote.
     */
    function snipeTaxBps(address who) public view returns (uint256) {
        if (snipeTaxExempt[who] || snipeTaxStartBps == 0 || launchedAt == 0) return 0;
        uint256 elapsed = block.timestamp - launchedAt; if (elapsed >= snipeTaxSeconds) return 0;
        uint256 left = snipeTaxSeconds - elapsed;
        uint256 bps = (snipeTaxStartBps * left * left) / (snipeTaxSeconds * snipeTaxSeconds);
        // One basis point of the principal always survives, so a buy in the first instant is a
        // terrible trade -- which is the intent -- rather than an impossible one.
        uint256 headroom = BASIS_POINTS - 1 - feeBps - creatorTaxBps;
        return bps > headroom ? headroom : bps;
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        if (amountIn == 0) revert ZeroAmount(); if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 out = (amountIn * reserveOut) / (reserveIn + amountIn); if (out == 0) revert InsufficientLiquidity(); return out;
    }
    function _amountIn(uint256 amountOutWanted, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        if (reserveOut <= amountOutWanted) revert InsufficientLiquidity();
        return (amountOutWanted * reserveIn) / (reserveOut - amountOutWanted) + 1;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256) {
        return _buy(quoteIn, minTokensOut, recipient, msg.sender);
    }

    /**
     * @notice As buy, but the refund from a clamped final buy goes to `refundTo`.
     *
     * The launchpad's launchAndBuy forwards the opening buy to the curve, so inside buy() the
     * msg.sender is the launchpad, not the person who paid. The clamped final buy refunds to
     * msg.sender -- so a launcher who overpaid on a nearly-full curve sent their change to the
     * launchpad's own balance, where the only way out was an owner withdrawal, and the
     * CurveBuyRefunded log named the launchpad so no reconciler could even attribute it.
     */
    function buyFor(uint256 quoteIn, uint256 minTokensOut, address recipient, address refundTo) external payable returns (uint256) {
        return _buy(quoteIn, minTokensOut, recipient, refundTo == address(0) ? msg.sender : refundTo);
    }

    function _buy(uint256 quoteIn, uint256 minTokensOut, address recipient, address refundTo) private returns (uint256 tokensOut) {
        if (graduated) revert CurveGraduated(); if (recipient == address(0)) revert ZeroAddress();
        if (msg.value != quoteIn) revert NativeValueMismatch(msg.value, quoteIn); if (quoteIn == 0) revert ZeroAmount();
        (uint256 qr, uint256 tr) = getReserves();
        uint256 snipeBps = snipeTaxBps(msg.sender); uint256 totalBps = feeBps + creatorTaxBps + snipeBps;
        // snipeTaxBps already clamps, so this cannot fire. It is here because everything below --
        // the subtraction of the levies from the spend, and the division by their complement in the
        // clamped final buy -- is unsafe if it ever does, and a named error beats a panic.
        if (totalBps >= BASIS_POINTS) revert LeviesExceedPrincipal(totalBps);
        uint256 spent = quoteIn; uint256 fee = (spent * feeBps) / BASIS_POINTS; uint256 tax = (spent * creatorTaxBps) / BASIS_POINTS; uint256 snipe = (spent * snipeBps) / BASIS_POINTS;
        tokensOut = _amountOut(spent - fee - tax - snipe, qr, tr);
        uint256 sellable = sellableTokens(); if (sellable == 0) revert CurveGraduated();
        if (tokensOut > sellable) {
            tokensOut = sellable;
            uint256 net = _amountIn(sellable, qr, tr);
            uint256 grossed = (net * BASIS_POINTS + (BASIS_POINTS - totalBps) - 1) / (BASIS_POINTS - totalBps);
            spent = grossed < quoteIn ? grossed : quoteIn;
            fee = (spent * feeBps) / BASIS_POINTS; tax = (spent * creatorTaxBps) / BASIS_POINTS; snipe = (spent * snipeBps) / BASIS_POINTS;
        }
        // A floor on the tokens, not on the rate. The old check compared ratios -- spent*min against
        // quoteIn*out -- which the clamped final buy always satisfies, because it spends
        // proportionally less for what little is left. Measured on this contract: a buyer asking for
        // at least 49,773,503 tokens received 1,889,169, which is 3.80% of what they demanded, and
        // the transaction succeeded. The price was fine; the quantity was not, and minTokensOut is a
        // quantity. Anyone who genuinely wants whatever remains passes zero.
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);
        quoteFeeBalance += fee; creatorTaxBalance += tax; trackedQuote += spent - snipe; snipeTaxPaid += snipe; trackedTokens -= tokensOut;
        FleetTestToken(token).transfer(recipient, tokensOut);
        // Announced before it is forwarded. Without this the only public record of a buy was
        // CurveBuy, which reports the gross spend and the fee and tax but not the snipe, so any
        // reader tracking the curve's real reserve from logs credited it with money the curve never
        // kept: measured at 7.76x on a one-second-old launch, where the tax is 8624 bps.
        if (snipe != 0) emit SnipeTaxCharged(msg.sender, snipe);
        _pay(factory, snipe);
        uint256 refund = quoteIn - spent;
        // The refund is only ever non-zero on the buy that fills the curve, which is the buy that
        // graduates it -- so a buyer who cannot receive ETH used to be able to block graduation for
        // everyone by overpaying on the last trade.
        if (refund != 0) { emit CurveBuyRefunded(refundTo, refund); _pay(refundTo, refund); }
        emit CurveBuy(msg.sender, recipient, spent, tokensOut, fee, tax);
        if (readyToGraduate()) _graduate();
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut) {
        if (graduated || readyToGraduate()) revert CurveGraduated(); if (tokensIn == 0) revert ZeroAmount(); if (recipient == address(0)) revert ZeroAddress();
        (uint256 qr, uint256 tr) = getReserves();
        FleetTestToken(token).transferFrom(msg.sender, address(this), tokensIn);
        uint256 gross = _amountOut(tokensIn, tr, qr);
        uint256 fee = (gross * feeBps) / BASIS_POINTS; uint256 tax = (gross * creatorTaxBps) / BASIS_POINTS;
        quoteOut = gross - fee - tax;
        if (quoteOut < minQuoteOut) revert SlippageExceeded(quoteOut, minQuoteOut);
        if (quoteOut > realQuoteReserve()) revert InsufficientLiquidity();
        quoteFeeBalance += fee; creatorTaxBalance += tax; trackedQuote -= quoteOut; trackedTokens += tokensIn;
        emit CurveSell(msg.sender, recipient, tokensIn, quoteOut, fee, tax);
        // Booked and announced before the money moves: a recipient that re-enters can no longer see
        // a curve whose state disagrees with the log it has already emitted.
        _pay(recipient, quoteOut);
    }

    /// @notice Pays pending fees out: the base fee to the launchpad (protocol), the creator tax to the creator.
    function sweepFees() public {
        uint256 fee = quoteFeeBalance; uint256 tax = creatorTaxBalance; if (fee == 0 && tax == 0) return;
        quoteFeeBalance = 0; creatorTaxBalance = 0; trackedQuote -= fee + tax;
        _pay(factory, fee);
        _pay(feeRecipient, tax);
    }
    /// Where the burnt remainder goes. The token refuses address(0), so the conventional dead
    /// address stands in for it.
    address private constant BURN = 0x000000000000000000000000000000000000dEaD;

    /**
     * Hand the raise over at the price the curve closed at.
     *
     * The curve's last price is its priced reserve over its token reserve, and the priced reserve
     * includes the phantom quote -- money that was never deposited and cannot be handed to a pool.
     * So seeding a pool with everything left, the whole raise against the whole reserved supply,
     * opens it at raise/reserved when the curve closed at (phantom+raise)/reserved. The ratio is
     * raise/(phantom+raise): at the shipped economics an instant 33.3% gap down, landing on every
     * holder at the moment the interface congratulates them. Worse for this repo specifically:
     * bondli's own dip read would see that manufactured gap as a token that ran and gave some back,
     * and buy it.
     *
     * Seeding only the tokens the raise can actually back opens the pool at the curve's closing
     * price. The remainder is burnt rather than kept, because a launchpad holding a third of every
     * graduated supply is a launchpad nobody should trade on.
     *
     * The fees stay parked. getReserves and realQuoteReserve already net them out, so leaving them
     * does not move the price, and paying them here is what used to put a stranger's fallback on
     * the graduation path.
     */
    function _graduate() private {
        graduated = true;
        uint256 priced = phantomQuote + trackedQuote - quoteFeeBalance - creatorTaxBalance;
        uint256 raise = trackedQuote - quoteFeeBalance - creatorTaxBalance;
        uint256 tokens = trackedTokens;
        uint256 seedTokens = priced != 0 ? (raise * tokens) / priced : tokens;
        uint256 burned = tokens - seedTokens;
        // Whatever is still owed stays tracked, so realQuoteReserve reads zero and the books balance.
        trackedQuote = quoteFeeBalance + creatorTaxBalance;
        trackedTokens = 0;
        if (burned != 0) { FleetTestToken(token).transfer(BURN, burned); emit TokensBurned(burned); }
        if (seedTokens != 0) FleetTestToken(token).transfer(factory, seedTokens);
        _pay(factory, raise);
        emit CurveCompleted(factory, raise, seedTokens);
        FleetTestLaunchpad(payable(factory)).onGraduated(token, seedTokens, raise);
    }
}

contract FleetTestLaunchpad {
    struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
    struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }
    struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }
    struct LaunchedToken { address token; address curve; address deployer; address pairToken; uint256 launchConfigId; uint256 graduationThreshold; bool graduated; }

    error NotOwner(); error LaunchFeeNotPaid(); error TransferFailed(); error SnipeTaxOutOfRange(uint256 startBps, uint256 secondsWindow);
    error NotSeeder(); error NotPendingOwner(); error NothingEscrowed(); error LaunchConfigDisabled(uint256 id); error TokenParamTooLong(); error InvalidLaunchConfigId(); error InvalidTokenParams(); error ExemptionListTooLong(); error CreatorTaxTooHigh(); error PairTokenNotApproved(); error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual); error NotCurve();
    event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold);
    event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount);
    event LaunchFeeUpdated(uint256 launchFee);
    event SnipeTaxUpdated(uint256 startBps, uint256 secondsWindow);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event SeederUpdated(address indexed seeder);
    event LaunchConfigAdded(uint256 indexed id, bool enabled);
    event LaunchConfigEnabled(uint256 indexed id, bool enabled);
    event RaiseReleased(address indexed token, address indexed to, uint256 quote, uint256 tokens);

    uint256 private constant MAX_SNIPE_TAX_EXEMPTIONS = 32;
    /// The longest opening window the owner may set. bondli's own edge already refuses candidates
    /// younger than sixty seconds (src/velocity/venues/pons/chain.mjs, SNIPE_TAX_WINDOW_MS), so a
    /// window beyond it would be a tax on trades no model here would make anyway -- and an unbounded
    /// one is a permanent toll booth on every buyer of every future launch.
    uint256 public constant MAX_SNIPE_TAX_SECONDS = 60;
    address public owner; address public pendingOwner; uint256 public launchFee;
    /// Per token, the ETH a graduated curve handed over. Escrowed, never revenue.
    mapping(address => uint256) public raiseOf; uint256 public totalEscrowed;
    /// The only account that may move an escrowed raise, and only into a pool. Zero until set.
    address public seeder; uint256 public snipeTaxStartBps = 9_900; uint256 public snipeTaxSeconds = 15; uint256 public maxCreatorTaxBps = 1_000;
    LaunchConfig[] private _configs; mapping(address => LaunchedToken) private _launched; mapping(address => bool) private _isCurve;
    uint256 private constant BASIS_POINTS = 10_000;

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(uint256 launchFee_, uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold) {
        owner = msg.sender; launchFee = launchFee_;
        _configs.push(LaunchConfig({ supply: supply, curveFeeBps: curveFeeBps, phantomQuote: phantomQuote, graduationThreshold: graduationThreshold, poolFee: 0, tickSpacing: 60, enabled: true }));
    }
    receive() external payable {}

    function launchConfigCount() external view returns (uint256) { return _configs.length; }
    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory) { if (id >= _configs.length) revert InvalidLaunchConfigId(); return _configs[id]; }
    function addLaunchConfig(LaunchConfig calldata c) external onlyOwner {
        if (c.curveFeeBps + maxCreatorTaxBps + snipeTaxStartBps >= BASIS_POINTS) revert SnipeTaxOutOfRange(snipeTaxStartBps, snipeTaxSeconds);
        _configs.push(c); emit LaunchConfigAdded(_configs.length - 1, c.enabled);
    }
    /// Configs are append-only by design -- a launched token's economics must never move under it --
    /// but `enabled` was declared and never read, so a config with bad economics was launchable
    /// forever with no way to take it out of service short of deploying a new launchpad.
    function setLaunchConfigEnabled(uint256 id, bool on) external onlyOwner {
        if (id >= _configs.length) revert InvalidLaunchConfigId();
        _configs[id].enabled = on; emit LaunchConfigEnabled(id, on);
    }
    function setLaunchFee(uint256 f) external onlyOwner { launchFee = f; emit LaunchFeeUpdated(f); }
    function setSnipeTax(uint256 startBps, uint256 secondsWindow) external onlyOwner {
        if (startBps >= BASIS_POINTS || secondsWindow > MAX_SNIPE_TAX_SECONDS) revert SnipeTaxOutOfRange(startBps, secondsWindow);
        snipeTaxStartBps = startBps; snipeTaxSeconds = secondsWindow;
        emit SnipeTaxUpdated(startBps, secondsWindow);
    }
    /**
     * @notice Withdraw the protocol's own revenue -- launch fees and swept curve fees -- never a raise.
     *
     * This used to send address(this).balance, and every graduated raise is paid into that balance.
     * Forty graduations at six ETH is two hundred and forty ETH of other people's money one owner
     * call from gone, with no event and nothing a holder could see coming. The escrowed total is
     * subtracted, so a raise is simply not reachable from here whatever the owner does.
     */
    function withdraw(address to) external onlyOwner {
        uint256 free = address(this).balance - totalEscrowed;
        (bool s,) = payable(to).call{value: free}(""); require(s, "withdraw");
    }

    /// @notice Hand one token's raise and its seed supply to the seeder, once, to open its pool. On
    ///         Ink that is a Calamari v4 position; here it is whatever the seeder does with them.
    ///         The reserved supply used to be transferred to this contract, which has no way to send
    ///         an ERC-20 at all, so no pool could be seeded even in good faith.
    function releaseRaise(address token) external returns (uint256 quote, uint256 tokens) {
        if (seeder == address(0) || msg.sender != seeder) revert NotSeeder();
        quote = raiseOf[token];
        tokens = FleetTestToken(token).balanceOf(address(this));
        if (quote == 0 && tokens == 0) revert NothingEscrowed();
        raiseOf[token] = 0; totalEscrowed -= quote;
        emit RaiseReleased(token, msg.sender, quote, tokens);
        if (tokens != 0) FleetTestToken(token).transfer(msg.sender, tokens);
        if (quote != 0) { (bool s,) = payable(msg.sender).call{value: quote}(""); if (!s) revert TransferFailed(); }
    }
    function setSeeder(address s_) external onlyOwner { seeder = s_; emit SeederUpdated(s_); }

    /// Ownership moves in two steps, so a mistyped address cannot take the launchpad with it. The
    /// key this ships with should become a multisig the day it is deployed.
    function transferOwnership(address to) external onlyOwner { pendingOwner = to; emit OwnershipTransferStarted(owner, to); }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender); owner = msg.sender; pendingOwner = address(0);
    }
    function canLaunch(address) external pure returns (bool) { return true; }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory) { return _launched[token]; }
    /**
     * @notice The hash a launcher pins so that terms cannot change between quoting and mining.
     *
     * It used to cover the curve's shape and four uint16(0) placeholders, which meant it did not
     * cover the launch fee, the creator-tax ceiling, or the opening tax -- the three things the
     * owner can actually change. A launcher could pin their economics, have the owner raise the
     * opening tax to a permanent toll in the same block, and launch anyway with the pin satisfied.
     */
    function previewLaunchEconomics(uint256 id, address pairToken) public view returns (bytes32) {
        if (id >= _configs.length) revert InvalidLaunchConfigId(); LaunchConfig memory c = _configs[id];
        return keccak256(abi.encode(c.phantomQuote, c.graduationThreshold, c.supply, c.curveFeeBps, c.poolFee, c.tickSpacing,
            snipeTaxStartBps, snipeTaxSeconds, maxCreatorTaxBps, launchFee, pairToken));
    }

    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken) external payable returns (address token, address curve) {
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender); _refundOverpay();
    }
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken, address[] calldata snipeTaxExemptions) external payable returns (address token, address curve) {
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender); _exempt(curve, snipeTaxExemptions); _refundOverpay();
    }
    /// The fee is a price, not a floor. Anything above it was never ours; _launch checks `<` so that
    /// a fee raised between quoting and mining does not fail the launch, and the change comes back.
    function _refundOverpay() private {
        uint256 over = msg.value - launchFee;
        if (over == 0) return;
        (bool s,) = payable(msg.sender).call{value: over}("");
        if (!s) revert TransferFailed();
    }
    /// @notice Launch and make the opening buy in one transaction: msg.value = launchFee + quoteIn.
    function launchAndBuy(TokenParams calldata params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] calldata snipeTaxExemptions) external payable returns (address token, address curve) {
        if (msg.value != launchFee + quoteIn) revert LaunchFeeNotPaid();
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender); _exempt(curve, snipeTaxExemptions);
        if (quoteIn != 0) FleetTestCurve(curve).buyFor{value: quoteIn}(quoteIn, minTokensOut, recipient == address(0) ? msg.sender : recipient, msg.sender);
    }
    function _exempt(address curve, address[] calldata list) private {
        if (list.length > MAX_SNIPE_TAX_EXEMPTIONS) revert ExemptionListTooLong();
        for (uint256 i = 0; i < list.length; ++i) FleetTestCurve(curve).exemptFromSnipeTax(list[i]);
    }
    function _launch(TokenParams calldata params, uint256 id, address pairToken, address deployer) private returns (address token, address curve) {
        if (id >= _configs.length) revert InvalidLaunchConfigId();
        if (msg.value < launchFee) revert LaunchFeeNotPaid();
        if (bytes(params.name).length == 0 || bytes(params.symbol).length == 0) revert InvalidTokenParams();
        if (!_configs[id].enabled) revert LaunchConfigDisabled(id);
        // Every one of these is stored on chain and read back unbounded by bondli's feed. A launcher
        // paying gas for a megabyte of description is paying to make every reader of this launchpad
        // slower, and a name that long is not a name.
        if (bytes(params.name).length > 64 || bytes(params.symbol).length > 16
            || bytes(params.logo).length > 256 || bytes(params.description).length > 512) revert TokenParamTooLong();
        if (params.creatorTaxBps > maxCreatorTaxBps) revert CreatorTaxTooHigh();
        if (pairToken != address(0)) revert PairTokenNotApproved();
        bytes32 econ = previewLaunchEconomics(id, pairToken);
        if (params.expectedEconomics != bytes32(0) && params.expectedEconomics != econ) revert LaunchEconomicsMismatch(params.expectedEconomics, econ);
        LaunchConfig memory c = _configs[id];
        address feeRecipient = params.creatorFeeRecipient == address(0) ? deployer : params.creatorFeeRecipient;
        FleetTestCurve cv = new FleetTestCurve(deployer, feeRecipient, c.phantomQuote, c.curveFeeBps, params.creatorTaxBps, c.graduationThreshold, snipeTaxStartBps, snipeTaxSeconds);
        FleetTestToken tk = new FleetTestToken(params.name, params.symbol, params.logo, params.description, deployer, address(cv), c.supply);
        cv.initialize(address(tk));
        // Both are exempt from the constructor; nothing further to do here.
        token = address(tk); curve = address(cv); _isCurve[curve] = true;
        _launched[token] = LaunchedToken({ token: token, curve: curve, deployer: deployer, pairToken: pairToken, launchConfigId: id, graduationThreshold: c.graduationThreshold, graduated: false });
        emit TokenLaunched(token, curve, deployer, pairToken, id, c.graduationThreshold);
    }
    function onGraduated(address token, uint256 tokenAmount, uint256 quoteAmount) external {
        if (!_isCurve[msg.sender]) revert NotCurve();
        // A curve may only speak for its own token. Without this any registered curve could name any
        // token, flip its graduated flag, and credit a raise against somebody else's escrow.
        if (_launched[token].curve != msg.sender) revert NotCurve();
        _launched[token].graduated = true;
        raiseOf[token] += quoteAmount; totalEscrowed += quoteAmount;
        emit PoolGraduated(token, 0, tokenAmount, quoteAmount);
    }
}
