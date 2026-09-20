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
///         Graduation here parks the reserves in the launchpad instead of seeding a Uniswap V4 pool.
///         Test double only: no fee escrow, no buyback vault, no locker, no vanity CREATE2.

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
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax);
    event CurveBuyRefunded(address indexed buyer, uint256 refund);
    event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax);
    event CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut);
    event SnipeTaxExempted(address indexed wallet);

    address public token; address public immutable factory; address public deployer; address public immutable pairToken = address(0);
    uint256 public immutable phantomQuote; uint256 public immutable feeBps; uint256 public immutable creatorTaxBps; uint256 public immutable graduationThreshold;
    uint256 public immutable snipeTaxStartBps; uint256 public immutable snipeTaxSeconds; uint256 public launchedAt;
    uint256 public trackedQuote; uint256 public trackedTokens; uint256 public reservedTokens; uint256 public quoteFeeBalance; uint256 public creatorTaxBalance; uint256 public snipeTaxPaid;
    bool public graduated;
    mapping(address => bool) public snipeTaxExempt;

    modifier onlyFactory() { if (msg.sender != factory) revert NotFactory(); _; }

    constructor(address deployer_, uint256 phantomQuote_, uint256 feeBps_, uint256 creatorTaxBps_, uint256 graduationThreshold_, uint256 snipeStart_, uint256 snipeSeconds_) {
        if (deployer_ == address(0)) revert ZeroAddress();
        // The standing levies must leave something to buy with. These two are fixed for the life of
        // the curve, so the check belongs here; the snipe tax is time-varying and is clamped against
        // whatever they leave, in snipeTaxBps below.
        if (feeBps_ + creatorTaxBps_ >= BASIS_POINTS) revert LeviesExceedPrincipal(feeBps_ + creatorTaxBps_);
        factory = msg.sender; deployer = deployer_; phantomQuote = phantomQuote_; feeBps = feeBps_; creatorTaxBps = creatorTaxBps_; graduationThreshold = graduationThreshold_;
        snipeTaxStartBps = snipeStart_; snipeTaxSeconds = snipeSeconds_;
        snipeTaxExempt[deployer_] = true; snipeTaxExempt[msg.sender] = true; // the dev, and the launchpad's launch-and-buy
    }
    function initialize(address token_) external onlyFactory {
        require(token == address(0), "initialized"); token = token_; launchedAt = block.timestamp;
        uint256 supply = FleetTestToken(token_).totalSupply();
        reservedTokens = (supply * phantomQuote) / (phantomQuote + graduationThreshold);
        require(reservedTokens > 0 && reservedTokens < supply, "economics");
        trackedTokens = FleetTestToken(token_).balanceOf(address(this));
    }
    function exemptFromSnipeTax(address wallet) external onlyFactory { snipeTaxExempt[wallet] = true; emit SnipeTaxExempted(wallet); }

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

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut) {
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
        if (spent * minTokensOut > quoteIn * tokensOut) revert SlippageExceeded(tokensOut, minTokensOut);
        quoteFeeBalance += fee; creatorTaxBalance += tax; trackedQuote += spent - snipe; snipeTaxPaid += snipe; trackedTokens -= tokensOut;
        FleetTestToken(token).transfer(recipient, tokensOut);
        if (snipe != 0) { (bool s,) = payable(factory).call{value: snipe}(""); if (!s) revert TransferFailed(); }
        uint256 refund = quoteIn - spent;
        if (refund != 0) { emit CurveBuyRefunded(msg.sender, refund); (bool r,) = payable(msg.sender).call{value: refund}(""); if (!r) revert TransferFailed(); }
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
        (bool s,) = payable(recipient).call{value: quoteOut}(""); if (!s) revert TransferFailed();
        emit CurveSell(msg.sender, recipient, tokensIn, quoteOut, fee, tax);
    }

    /// @notice Pays pending fees out: the base fee to the launchpad (protocol), the creator tax to the creator.
    function sweepFees() public {
        uint256 fee = quoteFeeBalance; uint256 tax = creatorTaxBalance; if (fee == 0 && tax == 0) return;
        quoteFeeBalance = 0; creatorTaxBalance = 0; trackedQuote -= fee + tax;
        if (fee != 0) { (bool a,) = payable(factory).call{value: fee}(""); if (!a) revert TransferFailed(); }
        if (tax != 0) { (bool b,) = payable(deployer).call{value: tax}(""); if (!b) revert TransferFailed(); }
    }
    function _graduate() private {
        graduated = true; sweepFees();
        uint256 quoteOut = trackedQuote; uint256 tokenOut = trackedTokens; trackedQuote = 0; trackedTokens = 0;
        if (quoteOut != 0) { (bool s,) = payable(factory).call{value: quoteOut}(""); if (!s) revert TransferFailed(); }
        if (tokenOut != 0) FleetTestToken(token).transfer(factory, tokenOut);
        emit CurveCompleted(factory, quoteOut, tokenOut);
        FleetTestLaunchpad(payable(factory)).onGraduated(token, tokenOut, quoteOut);
    }
}

contract FleetTestLaunchpad {
    struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
    struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }
    struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }
    struct LaunchedToken { address token; address curve; address deployer; address pairToken; uint256 launchConfigId; uint256 graduationThreshold; bool graduated; }

    error NotOwner(); error LaunchFeeNotPaid(); error InvalidLaunchConfigId(); error InvalidTokenParams(); error ExemptionListTooLong(); error CreatorTaxTooHigh(); error PairTokenNotApproved(); error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual); error NotCurve();
    event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold);
    event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount);
    event LaunchFeeUpdated(uint256 launchFee);

    uint256 private constant MAX_SNIPE_TAX_EXEMPTIONS = 32;
    address public owner; uint256 public launchFee; uint256 public snipeTaxStartBps = 9_900; uint256 public snipeTaxSeconds = 15; uint256 public maxCreatorTaxBps = 1_000;
    LaunchConfig[] private _configs; mapping(address => LaunchedToken) private _launched; mapping(address => bool) private _isCurve;

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(uint256 launchFee_, uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold) {
        owner = msg.sender; launchFee = launchFee_;
        _configs.push(LaunchConfig({ supply: supply, curveFeeBps: curveFeeBps, phantomQuote: phantomQuote, graduationThreshold: graduationThreshold, poolFee: 0, tickSpacing: 60, enabled: true }));
    }
    receive() external payable {}

    function launchConfigCount() external view returns (uint256) { return _configs.length; }
    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory) { if (id >= _configs.length) revert InvalidLaunchConfigId(); return _configs[id]; }
    function addLaunchConfig(LaunchConfig calldata c) external onlyOwner { _configs.push(c); }
    function setLaunchFee(uint256 f) external onlyOwner { launchFee = f; emit LaunchFeeUpdated(f); }
    function setSnipeTax(uint256 startBps, uint256 secondsWindow) external onlyOwner { snipeTaxStartBps = startBps; snipeTaxSeconds = secondsWindow; }
    function withdraw(address to) external onlyOwner { (bool s,) = payable(to).call{value: address(this).balance}(""); require(s, "withdraw"); }
    function canLaunch(address) external pure returns (bool) { return true; }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory) { return _launched[token]; }
    function previewLaunchEconomics(uint256 id, address pairToken) public view returns (bytes32) {
        if (id >= _configs.length) revert InvalidLaunchConfigId(); LaunchConfig memory c = _configs[id];
        return keccak256(abi.encode(c.phantomQuote, c.graduationThreshold, c.supply, c.curveFeeBps, c.poolFee, c.tickSpacing, uint16(0), uint16(0), uint16(0), uint16(0), pairToken));
    }

    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken) external payable returns (address token, address curve) {
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender);
    }
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken, address[] calldata snipeTaxExemptions) external payable returns (address token, address curve) {
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender); _exempt(curve, snipeTaxExemptions);
    }
    /// @notice Launch and make the opening buy in one transaction: msg.value = launchFee + quoteIn.
    function launchAndBuy(TokenParams calldata params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] calldata snipeTaxExemptions) external payable returns (address token, address curve) {
        if (msg.value != launchFee + quoteIn) revert LaunchFeeNotPaid();
        (token, curve) = _launch(params, launchConfigId, pairToken, msg.sender); _exempt(curve, snipeTaxExemptions);
        if (quoteIn != 0) FleetTestCurve(curve).buy{value: quoteIn}(quoteIn, minTokensOut, recipient == address(0) ? msg.sender : recipient);
    }
    function _exempt(address curve, address[] calldata list) private {
        if (list.length > MAX_SNIPE_TAX_EXEMPTIONS) revert ExemptionListTooLong();
        for (uint256 i = 0; i < list.length; ++i) FleetTestCurve(curve).exemptFromSnipeTax(list[i]);
    }
    function _launch(TokenParams calldata params, uint256 id, address pairToken, address deployer) private returns (address token, address curve) {
        if (id >= _configs.length) revert InvalidLaunchConfigId();
        if (msg.value < launchFee) revert LaunchFeeNotPaid();
        if (bytes(params.name).length == 0 || bytes(params.symbol).length == 0) revert InvalidTokenParams();
        if (params.creatorTaxBps > maxCreatorTaxBps) revert CreatorTaxTooHigh();
        if (pairToken != address(0)) revert PairTokenNotApproved();
        bytes32 econ = previewLaunchEconomics(id, pairToken);
        if (params.expectedEconomics != bytes32(0) && params.expectedEconomics != econ) revert LaunchEconomicsMismatch(params.expectedEconomics, econ);
        LaunchConfig memory c = _configs[id];
        address feeRecipient = params.creatorFeeRecipient == address(0) ? deployer : params.creatorFeeRecipient;
        FleetTestCurve cv = new FleetTestCurve(feeRecipient, c.phantomQuote, c.curveFeeBps, params.creatorTaxBps, c.graduationThreshold, snipeTaxStartBps, snipeTaxSeconds);
        FleetTestToken tk = new FleetTestToken(params.name, params.symbol, params.logo, params.description, deployer, address(cv), c.supply);
        cv.initialize(address(tk));
        cv.exemptFromSnipeTax(deployer); if (feeRecipient != deployer) cv.exemptFromSnipeTax(feeRecipient);
        token = address(tk); curve = address(cv); _isCurve[curve] = true;
        _launched[token] = LaunchedToken({ token: token, curve: curve, deployer: deployer, pairToken: pairToken, launchConfigId: id, graduationThreshold: c.graduationThreshold, graduated: false });
        emit TokenLaunched(token, curve, deployer, pairToken, id, c.graduationThreshold);
    }
    function onGraduated(address token, uint256 tokenAmount, uint256 quoteAmount) external {
        if (!_isCurve[msg.sender]) revert NotCurve(); _launched[token].graduated = true;
        emit PoolGraduated(token, 0, tokenAmount, quoteAmount);
    }
}
