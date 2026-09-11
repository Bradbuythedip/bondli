#!/usr/bin/env python3
"""
Not a fruit fly ($NOTAFRUITFLY) - one-click launcher for Robinhood Chain (chain id 4663).

    pip install web3
    echo 'PRIVATE_KEY=0x...' > .env      # or skip this and the script prompts for it (never stored)
    python3 launch.py check            # read-only preflight, sends nothing
    python3 launch.py                  # deploy -> pool -> verify -> summary, one LAUNCH confirmation

What it does:
  1. Deploys a tiny CREATE2 factory, then the token on an address starting 0x70A57 (TOAST).
     Plain ERC-20: fixed supply, no owner, no mint, no tax, no blacklist, no pause.
  2. Opens the NOTAFRUITFLY / ETH pool on Uniswap v2 and sends the LP tokens to 0x...dEaD.
  3. Verifies both contracts on Blockscout and prints the CA, pair, and links.

Nothing is signed until every check passes. Progress is saved in launch_state.json, so if a step
fails you fix the cause and run the same command again; finished steps are skipped.
Other commands: status (read-only summary), verify (Blockscout only).
Flags: --yes (skip the LAUNCH prompt), --dry-run (stop before the first signature).
Any CONFIG key can be overridden with an environment variable FLY_<KEY>.

Put your RPC URL (Alchemy) in .env as FLY_RPC_URL; the file itself carries no key.
"""

import argparse
import getpass
import json
import multiprocessing as mp
import os
import sys
import time
from decimal import Decimal

try:
    from web3 import Web3
    from web3.exceptions import ContractLogicError
    from web3.logs import DISCARD
    from eth_account import Account
    from eth_hash.auto import keccak
    from eth_abi import encode as abi_encode
except ImportError:
    sys.exit("missing dependency: run  pip install web3")

# ------------------------------------------------------------------------------------
# CONFIG - the only block you should need to edit
# ------------------------------------------------------------------------------------
CONFIG = {
    "TOKEN_NAME": "Not a fruit fly",
    "TOKEN_SYMBOL": "NOTAFRUITFLY",
    "TOTAL_SUPPLY": 1_000_000_000,     # whole tokens; 18 decimals are added by the script
    "LIQUIDITY_TOKEN_PCT": 100,       # % of supply into the pool (100 = fair launch, wallet keeps 0)
    "LIQUIDITY_ETH": "0.05",           # ETH seeded into the pool  <-- decide this
    "BURN_LP": True,                  # LP tokens -> 0x...dEaD (irreversible, liquidity locked forever)
    # Vanity address. Hex only (0-9 a-f), so "pump" and "fly" are impossible; words that work:
    # 70a57 toast, f00d food, ea7 eat, fed, feed, f1ea flea, dead, beef, cafe, babe, face, c0de, 0000 (mined look).
    # Wallets and explorers show "0x70A5...F00D": the last 4 characters are always visible, a 5-character
    # prefix is usually cut to 4. Cost is 16^(prefix+suffix length) tries; check prints the estimate.
    "VANITY_PREFIX": "",              # e.g. "70a57"
    "VANITY_SUFFIX": "f00d",          # e.g. "f00d". prefix + suffix of 8 characters is about an hour on 8 cores
    "VANITY_MAX_SECONDS": 3600,

    # Robinhood Chain mainnet. Uniswap addresses are from Uniswap/contracts deployments/4663.md
    "CHAIN_ID": 4663,
    "RPC_URL": "",                     # put your Alchemy URL in .env as FLY_RPC_URL; the public RPC below is the fallback
    "RPC_FALLBACK": "https://rpc.mainnet.chain.robinhood.com",
    "ROUTER": "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",   # UniswapV2Router02
    "FACTORY": "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",  # UniswapV2Factory
    "WETH": "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",     # WETH9
    "USDG": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",     # 6 decimals, only used to print a USD estimate
    "EXPLORER": "https://robinhoodchain.blockscout.com",
    "WEBSITE": "https://bondli.fun",
    "X_HANDLE": "notafruitfly",
    "STATE_FILE": "launch_state.json",
}

DEAD = "0x000000000000000000000000000000000000dEaD"
MINIMUM_LIQUIDITY = 1000  # LP wei Uniswap v2 locks in every pair forever
GWEI = 10**9

ROUTER_ABI = json.loads("""[
 {"name":"WETH","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
 {"name":"factory","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
 {"name":"addLiquidityETH","type":"function","stateMutability":"payable",
  "inputs":[{"name":"token","type":"address"},{"name":"amountTokenDesired","type":"uint256"},
            {"name":"amountTokenMin","type":"uint256"},{"name":"amountETHMin","type":"uint256"},
            {"name":"to","type":"address"},{"name":"deadline","type":"uint256"}],
  "outputs":[{"type":"uint256"},{"type":"uint256"},{"type":"uint256"}]}
]""")
FACTORY_ABI = json.loads("""[
 {"name":"getPair","type":"function","stateMutability":"view",
  "inputs":[{"type":"address"},{"type":"address"}],"outputs":[{"type":"address"}]}
]""")
PAIR_ABI = json.loads("""[
 {"name":"getReserves","type":"function","stateMutability":"view","inputs":[],
  "outputs":[{"type":"uint112"},{"type":"uint112"},{"type":"uint32"}]},
 {"name":"token0","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
 {"name":"totalSupply","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
 {"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]}
]""")

# ---- build artifacts: solc 0.8.26, optimizer 200 runs, evm paris. Generated by build_script.py ----
ARTIFACTS = json.loads(r'''{"Create2Factory":{"abi":[{"inputs":[],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"addr","type":"address"},{"indexed":true,"internalType":"bytes32","name":"salt","type":"bytes32"}],"name":"Deployed","type":"event"},{"inputs":[{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"bytes32","name":"initCodeHash","type":"bytes32"}],"name":"computeAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"bytes","name":"initCode","type":"bytes"}],"name":"deploy","outputs":[{"internalType":"address","name":"addr","type":"address"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"}],"bytecode":"0x60a0604052348015600f57600080fd5b50336080526080516103266100356000396000818160cb015261010801526103266000f3fe608060405234801561001057600080fd5b50600436106100415760003560e01c8063481286e6146100465780638da5cb5b146100c6578063cdcb760a146100ed575b600080fd5b6100aa6100543660046101f5565b604080516001600160f81b03196020808301919091523060601b6bffffffffffffffffffffffff191660218301526035820194909452605580820193909352815180820390930183526075019052805191012090565b6040516001600160a01b03909116815260200160405180910390f35b6100aa7f000000000000000000000000000000000000000000000000000000000000000081565b6100aa6100fb36600461022d565b6000336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146101665760405162461bcd60e51b81526020600482015260096024820152683737ba1037bbb732b960b91b60448201526064015b60405180910390fd5b828251602084016000f590506001600160a01b0381166101b95760405162461bcd60e51b815260206004820152600e60248201526d10d4915055114c8819985a5b195960921b604482015260640161015d565b60405183906001600160a01b038316907f94bfd9af14ef450884c8a7ddb5734e2e1e14e70a1c84f0801cc5a29e34d2642890600090a392915050565b6000806040838503121561020857600080fd5b50508035926020909101359150565b634e487b7160e01b600052604160045260246000fd5b6000806040838503121561024057600080fd5b82359150602083013567ffffffffffffffff81111561025e57600080fd5b8301601f8101851361026f57600080fd5b803567ffffffffffffffff81111561028957610289610217565b604051601f8201601f19908116603f0116810167ffffffffffffffff811182821017156102b8576102b8610217565b6040528181528282016020018710156102d057600080fd5b81602084016020830137600060208383010152809350505050925092905056fea264697066735822122012150cc38959caf95889fb5bfa981129f883fc5e4be729255daa9bae7a576a5364736f6c634300081a0033","source_file":"Create2Factory.sol","compiler":"v0.8.26+commit.8a97fa7a","optimizer_runs":200,"evm_version":"paris","source":"// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\n\n/// @title Create2Factory\n/// @notice Minimal CREATE2 deployer so the token can land on a chosen (vanity) address.\n///         Only the wallet that deployed the factory can use it.\ncontract Create2Factory {\n    address public immutable owner;\n\n    event Deployed(address indexed addr, bytes32 indexed salt);\n\n    constructor() {\n        owner = msg.sender;\n    }\n\n    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {\n        require(msg.sender == owner, \"not owner\");\n        assembly {\n            addr := create2(0, add(initCode, 0x20), mload(initCode), salt)\n        }\n        require(addr != address(0), \"CREATE2 failed\");\n        emit Deployed(addr, salt);\n    }\n\n    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {\n        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));\n    }\n}\n"},"NotAFruitFly":{"abi":[{"inputs":[{"internalType":"string","name":"name_","type":"string"},{"internalType":"string","name":"symbol_","type":"string"},{"internalType":"uint256","name":"supply_","type":"uint256"},{"internalType":"address","name":"to_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}],"bytecode":"0x608060405234801561001057600080fd5b506040516109e43803806109e483398101604081905261002f916101b7565b6001600160a01b0381166100895760405162461bcd60e51b815260206004820152601c60248201527f4e4f54414652554954464c593a207a65726f20726563697069656e7400000000604482015260640160405180910390fd5b600061009585826102d3565b5060016100a284826102d3565b5060028290556001600160a01b0381166000818152600360209081526040808320869055518581527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef910160405180910390a350505050610391565b634e487b7160e01b600052604160045260246000fd5b600082601f83011261012557600080fd5b81516001600160401b0381111561013e5761013e6100fe565b604051601f8201601f19908116603f011681016001600160401b038111828210171561016c5761016c6100fe565b60405281815283820160200185101561018457600080fd5b60005b828110156101a357602081860181015183830182015201610187565b506000918101602001919091529392505050565b600080600080608085870312156101cd57600080fd5b84516001600160401b038111156101e357600080fd5b6101ef87828801610114565b602087015190955090506001600160401b0381111561020d57600080fd5b61021987828801610114565b60408701516060880151919550935090506001600160a01b038116811461023f57600080fd5b939692955090935050565b600181811c9082168061025e57607f821691505b60208210810361027e57634e487b7160e01b600052602260045260246000fd5b50919050565b601f8211156102ce57806000526020600020601f840160051c810160208510156102ab5750805b601f840160051c820191505b818110156102cb57600081556001016102b7565b50505b505050565b81516001600160401b038111156102ec576102ec6100fe565b610300816102fa845461024a565b84610284565b6020601f821160018114610334576000831561031c5750848201515b600019600385901b1c1916600184901b1784556102cb565b600084815260208120601f198516915b828110156103645787850151825560209485019460019092019101610344565b50848210156103825786840151600019600387901b60f8161c191681555b50505050600190811b01905550565b610644806103a06000396000f3fe608060405234801561001057600080fd5b50600436106100935760003560e01c8063313ce56711610066578063313ce5671461010357806370a082311461011d57806395d89b411461013d578063a9059cbb14610145578063dd62ed3e1461015857600080fd5b806306fdde0314610098578063095ea7b3146100b657806318160ddd146100d957806323b872dd146100f0575b600080fd5b6100a0610183565b6040516100ad919061048d565b60405180910390f35b6100c96100c43660046104f7565b610211565b60405190151581526020016100ad565b6100e260025481565b6040519081526020016100ad565b6100c96100fe366004610521565b61027e565b61010b601281565b60405160ff90911681526020016100ad565b6100e261012b36600461055e565b60036020526000908152604090205481565b6100a0610345565b6100c96101533660046104f7565b610352565b6100e2610166366004610580565b600460209081526000928352604080842090915290825290205481565b60008054610190906105b3565b80601f01602080910402602001604051908101604052809291908181526020018280546101bc906105b3565b80156102095780601f106101de57610100808354040283529160200191610209565b820191906000526020600020905b8154815290600101906020018083116101ec57829003601f168201915b505050505081565b3360008181526004602090815260408083206001600160a01b038716808552925280832085905551919290917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9259061026c9086815260200190565b60405180910390a35060015b92915050565b6001600160a01b0383166000908152600460209081526040808320338452909152812054600019811461032f57828110156103005760405162461bcd60e51b815260206004820152601760248201527f4e4f54414652554954464c593a20616c6c6f77616e636500000000000000000060448201526064015b60405180910390fd5b61030a83826105ed565b6001600160a01b03861660009081526004602090815260408083203384529091529020555b61033a858585610368565b506001949350505050565b60018054610190906105b3565b600061035f338484610368565b50600192915050565b6001600160a01b0382166103be5760405162461bcd60e51b815260206004820152601a60248201527f4e4f54414652554954464c593a207a65726f206164647265737300000000000060448201526064016102f7565b6001600160a01b0383166000908152600360205260409020548181101561041f5760405162461bcd60e51b81526020600482015260156024820152744e4f54414652554954464c593a2062616c616e636560581b60448201526064016102f7565b6001600160a01b0380851660008181526003602052604080822086860390559286168082529083902080548601905591517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9061047f9086815260200190565b60405180910390a350505050565b602081526000825180602084015260005b818110156104bb576020818601810151604086840101520161049e565b506000604082850101526040601f19601f83011684010191505092915050565b80356001600160a01b03811681146104f257600080fd5b919050565b6000806040838503121561050a57600080fd5b610513836104db565b946020939093013593505050565b60008060006060848603121561053657600080fd5b61053f846104db565b925061054d602085016104db565b929592945050506040919091013590565b60006020828403121561057057600080fd5b610579826104db565b9392505050565b6000806040838503121561059357600080fd5b61059c836104db565b91506105aa602084016104db565b90509250929050565b600181811c908216806105c757607f821691505b6020821081036105e757634e487b7160e01b600052602260045260246000fd5b50919050565b8181038181111561027857634e487b7160e01b600052601160045260246000fdfea2646970667358221220c983eb8a149ccc01891a17d76b40f79da69d1ab757d7e23465cb08046289aecb64736f6c634300081a0033","source_file":"NotAFruitFly.sol","compiler":"v0.8.26+commit.8a97fa7a","optimizer_runs":200,"evm_version":"paris","source":"// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\n\n/// @title Not a fruit fly ($NOTAFRUITFLY)\n/// @notice Fixed-supply ERC-20. No owner. No mint. No tax. No blacklist. No pause. No proxy.\n///         The whole supply is minted once, in the constructor, to the launch wallet.\n///         After that the contract has no privileged functions of any kind.\ncontract NotAFruitFly {\n    string public name;\n    string public symbol;\n    uint8 public constant decimals = 18;\n    uint256 public totalSupply;\n\n    mapping(address => uint256) public balanceOf;\n    mapping(address => mapping(address => uint256)) public allowance;\n\n    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n\n    constructor(string memory name_, string memory symbol_, uint256 supply_, address to_) {\n        require(to_ != address(0), \"NOTAFRUITFLY: zero recipient\");\n        name = name_;\n        symbol = symbol_;\n        totalSupply = supply_;\n        balanceOf[to_] = supply_;\n        emit Transfer(address(0), to_, supply_);\n    }\n\n    function transfer(address to, uint256 amount) external returns (bool) {\n        _transfer(msg.sender, to, amount);\n        return true;\n    }\n\n    function approve(address spender, uint256 amount) external returns (bool) {\n        allowance[msg.sender][spender] = amount;\n        emit Approval(msg.sender, spender, amount);\n        return true;\n    }\n\n    function transferFrom(address from, address to, uint256 amount) external returns (bool) {\n        uint256 allowed = allowance[from][msg.sender];\n        if (allowed != type(uint256).max) {\n            require(allowed >= amount, \"NOTAFRUITFLY: allowance\");\n            allowance[from][msg.sender] = allowed - amount;\n        }\n        _transfer(from, to, amount);\n        return true;\n    }\n\n    function _transfer(address from, address to, uint256 amount) internal {\n        require(to != address(0), \"NOTAFRUITFLY: zero address\");\n        uint256 bal = balanceOf[from];\n        require(bal >= amount, \"NOTAFRUITFLY: balance\");\n        unchecked {\n            balanceOf[from] = bal - amount;\n            balanceOf[to] += amount;\n        }\n        emit Transfer(from, to, amount);\n    }\n}\n"}}''')


# ------------------------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------------------------
def log(msg=""):
    print(msg, flush=True)


def die(msg):
    log(f"\nSTOP: {msg}")
    sys.exit(1)


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def cfg(key):
    v = os.environ.get(f"FLY_{key}")
    if v is None:
        return CONFIG[key]
    if isinstance(CONFIG[key], bool):
        return v.strip().lower() in ("1", "true", "yes", "y")
    if isinstance(CONFIG[key], int):
        return int(v)
    return v


def addr(key):
    return Web3.to_checksum_address(cfg(key))


def load_state():
    p = cfg("STATE_FILE")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(cfg("STATE_FILE"), "w") as f:
        json.dump(state, f, indent=2)


def fmt_eth(wei):
    return f"{Decimal(wei) / Decimal(10**18):.6f} ETH"


def fmt_tok(wei):
    return f"{Decimal(wei) / Decimal(10**18):,.0f} {cfg('TOKEN_SYMBOL')}"


def supply_wei():
    return int(cfg("TOTAL_SUPPLY")) * 10**18


def pool_tokens_wei():
    return supply_wei() * int(cfg("LIQUIDITY_TOKEN_PCT")) // 100


def chain_now(w3):
    return int(w3.eth.get_block("latest")["timestamp"])


def connect():
    url = os.environ.get("FLY_RPC_URL") or cfg("RPC_URL") or cfg("RPC_FALLBACK")
    w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        log(f"primary RPC not reachable, trying fallback {cfg('RPC_FALLBACK')}")
        w3 = Web3(Web3.HTTPProvider(cfg("RPC_FALLBACK"), request_kwargs={"timeout": 60}))
        if not w3.is_connected():
            die("no RPC endpoint reachable")
    return w3


def get_account():
    load_dotenv()
    pk = os.environ.get("PRIVATE_KEY") or os.environ.get("FLY_PRIVATE_KEY")
    if not pk:
        pk = getpass.getpass("Launch wallet private key (input hidden, never stored): ").strip()
    if not pk:
        die("no private key")
    try:
        return Account.from_key(pk)
    except Exception as e:  # noqa: BLE001
        die(f"bad private key: {e}")


def send(w3, acct, to, data, value, label, gas_mult=1.3):
    """Estimate gas with margin, fill nonce/fees, sign locally, send, wait, require success."""
    tx = {"from": acct.address, "value": int(value), "data": data}
    if to is not None:
        tx["to"] = Web3.to_checksum_address(to)
    try:
        tx["gas"] = int(w3.eth.estimate_gas(tx) * gas_mult)
    except ContractLogicError as e:
        die(f"{label}: would revert: {e}")
    tx["chainId"] = w3.eth.chain_id
    tx["nonce"] = w3.eth.get_transaction_count(acct.address, "pending")
    base = w3.eth.get_block("latest").get("baseFeePerGas")
    if base is not None:
        tip = 0  # Arbitrum-style chains charge the base fee only
        if int(cfg("CHAIN_ID")) != 4663:
            try:
                tip = int(w3.eth.max_priority_fee)
            except Exception:  # noqa: BLE001
                tip = 0
        tx.update({"maxPriorityFeePerGas": tip, "maxFeePerGas": max(int(base) * 3 + tip, GWEI // 5), "type": 2})
    else:
        tx["gasPrice"] = int(w3.eth.gas_price * 1.2)
    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
    h = w3.eth.send_raw_transaction(raw)
    log(f"  {label}: sent {h.hex()} (gas limit {tx['gas']:,})")
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=300)
    if rcpt["status"] != 1:
        die(f"{label}: transaction {h.hex()} reverted")
    log(f"  {label}: confirmed in block {rcpt['blockNumber']}, gas used {rcpt['gasUsed']:,}")
    return rcpt


def contract(w3, name, address):
    return w3.eth.contract(address=Web3.to_checksum_address(address), abi=ARTIFACTS[name]["abi"])


def calldata(fn):
    return fn._encode_transaction_data()


def init_code(recipient):
    args = abi_encode(["string", "string", "uint256", "address"],
                      [cfg("TOKEN_NAME"), cfg("TOKEN_SYMBOL"), supply_wei(), Web3.to_checksum_address(recipient)])
    return bytes.fromhex(ARTIFACTS["NotAFruitFly"]["bytecode"][2:]) + args


def create2_address(factory, salt_bytes, init_code_hash):
    return Web3.to_checksum_address(keccak(b"\xff" + bytes.fromhex(factory[2:]) + salt_bytes + init_code_hash)[12:])


def _grind_worker(args):
    factory, init_code_hash, prefix, suffix, start, count = args
    pre = b"\xff" + bytes.fromhex(factory[2:])
    for i in range(start, start + count):
        h = keccak(pre + i.to_bytes(32, "big") + init_code_hash)[12:].hex()
        if h.startswith(prefix) and h.endswith(suffix):
            return i
    return None


def vanity_pattern():
    prefix = str(cfg("VANITY_PREFIX")).lower().removeprefix("0x")
    suffix = str(cfg("VANITY_SUFFIX")).lower()
    for part in (prefix, suffix):
        if any(c not in "0123456789abcdef" for c in part):
            die(f"vanity pattern must be hex (0-9 a-f), got {part!r}")
    return prefix, suffix


def keccak_rate():
    """Single-core keccak throughput, hashes per second (quick benchmark)."""
    pre = b"\xff" + bytes(20)
    t0 = time.time()
    for i in range(30_000):
        keccak(pre + i.to_bytes(32, "big") + pre)
    return 30_000 / (time.time() - t0)


def vanity_estimate():
    """(expected tries, seconds on all cores) for the configured pattern."""
    prefix, suffix = vanity_pattern()
    n = len(prefix) + len(suffix)
    if n == 0:
        return 0, 0.0
    tries = 16 ** n
    return tries, tries / (keccak_rate() * max(1, mp.cpu_count()))


def grind_salt(factory, init_code_hash, max_seconds):
    """Find a salt so the CREATE2 address matches VANITY_PREFIX / VANITY_SUFFIX. Offline, no gas."""
    prefix, suffix = vanity_pattern()
    if not prefix and not suffix:
        return 0
    workers = max(1, mp.cpu_count())
    chunk = 50_000
    tries, eta = vanity_estimate()
    log(f"  grinding for 0x{prefix}...{suffix} ({tries:,} tries expected, about {eta / 60:.1f} min on {workers} cores)")
    t0 = last = time.time()
    start = 0
    with mp.Pool(workers) as pool:
        while True:
            jobs = [(factory, init_code_hash, prefix, suffix, start + k * chunk, chunk) for k in range(workers)]
            for res in pool.imap_unordered(_grind_worker, jobs):
                if res is not None:
                    pool.terminate()
                    log(f"  found salt {res} after {time.time() - t0:.1f}s")
                    return res
            start += workers * chunk
            now = time.time()
            if now - t0 > max_seconds:
                pool.terminate()
                die(f"no match within {max_seconds}s. Shorten the pattern or raise VANITY_MAX_SECONDS and run again "
                    f"(the factory is already deployed; the run resumes at the grind)")
            if now - last > 10:
                last = now
                log(f"  ...{start:,} tried, {now - t0:.0f}s, {start / (now - t0):,.0f}/s")


def eth_usd(w3):
    """ETH price from the v2 WETH/USDG pool, or None."""
    try:
        fac = w3.eth.contract(address=addr("FACTORY"), abi=FACTORY_ABI)
        pair = fac.functions.getPair(addr("WETH"), addr("USDG")).call()
        if int(pair, 16) == 0:
            return None
        p = w3.eth.contract(address=pair, abi=PAIR_ABI)
        r0, r1, _ = p.functions.getReserves().call()
        weth_r, usd_r = (r0, r1) if p.functions.token0().call().lower() == cfg("WETH").lower() else (r1, r0)
        return (Decimal(usd_r) / Decimal(10**6)) / (Decimal(weth_r) / Decimal(10**18)) if weth_r else None
    except Exception:  # noqa: BLE001
        return None


def links(state):
    ex = cfg("EXPLORER")
    out = {}
    if state.get("token"):
        out["explorer_token"] = f"{ex}/token/{state['token']}"
        out["explorer_contract"] = f"{ex}/address/{state['token']}?tab=contract"
        out["uniswap_swap"] = f"https://app.uniswap.org/swap?chain=robinhood&outputCurrency={state['token']}"
    if state.get("pair"):
        out["dexscreener"] = f"https://dexscreener.com/robinhood/{state['pair']}"
        out["explorer_pair"] = f"{ex}/address/{state['pair']}"
    out["website"] = cfg("WEBSITE")
    out["x"] = f"https://x.com/{cfg('X_HANDLE')}"
    return out


# ------------------------------------------------------------------------------------
# steps
# ------------------------------------------------------------------------------------
def step_check(w3, acct, state):
    """Read-only preflight. Dies on any failed check."""
    chain_id = w3.eth.chain_id
    if chain_id != int(cfg("CHAIN_ID")):
        die(f"connected to chain {chain_id}, expected {cfg('CHAIN_ID')}")
    for label, a in (("router", addr("ROUTER")), ("factory", addr("FACTORY")), ("WETH", addr("WETH"))):
        if len(w3.eth.get_code(a)) == 0:
            die(f"no contract code at {label} {a}")
    router = w3.eth.contract(address=addr("ROUTER"), abi=ROUTER_ABI)
    if router.functions.WETH().call().lower() != cfg("WETH").lower():
        die("router.WETH() does not match CONFIG['WETH']")
    if router.functions.factory().call().lower() != cfg("FACTORY").lower():
        die("router.factory() does not match CONFIG['FACTORY']")
    pct = int(cfg("LIQUIDITY_TOKEN_PCT"))
    if pct < 1 or pct > 100:
        die("LIQUIDITY_TOKEN_PCT must be 1..100")
    liq_eth = Web3.to_wei(Decimal(str(cfg("LIQUIDITY_ETH"))), "ether")
    if liq_eth <= 0:
        die("LIQUIDITY_ETH must be > 0")
    bal = w3.eth.get_balance(acct.address)
    gas_price = w3.eth.gas_price
    gas_budget = int(gas_price * 6_000_000 * 3)  # factory + token + pair creation, x3 margin
    need = (0 if state.get("pair") else liq_eth) + gas_budget
    if bal < need:
        die(f"wallet {acct.address} has {fmt_eth(bal)}, needs about {fmt_eth(need)} "
            f"(liquidity {fmt_eth(liq_eth)} + gas headroom {fmt_eth(gas_budget)})")
    price = Decimal(liq_eth) / Decimal(pool_tokens_wei())
    fdv = price * Decimal(supply_wei()) / Decimal(10**18)
    usd = eth_usd(w3)

    log(f"chain            {chain_id} at block {w3.eth.block_number}  (rpc ok, router/factory/WETH verified)")
    log(f"wallet           {acct.address}  balance {fmt_eth(bal)}")
    log(f"token            {cfg('TOKEN_NAME')} ({cfg('TOKEN_SYMBOL')}), supply {fmt_tok(supply_wei())}, 18 decimals")
    log(f"pool             {fmt_tok(pool_tokens_wei())} ({pct}% of supply) + {fmt_eth(liq_eth)}")
    if pct < 100:
        log(f"stays in wallet  {fmt_tok(supply_wei() - pool_tokens_wei())} ({100 - pct}%)")
    log(f"opening price    {price:.12f} ETH per {cfg('TOKEN_SYMBOL')}")
    log(f"opening FDV      {fdv:.4f} ETH" + (f"  (~${fdv * usd:,.0f} at ${usd:,.0f}/ETH)" if usd else ""))
    log(f"LP tokens        {'burned to ' + DEAD if cfg('BURN_LP') else 'kept in launch wallet'}")
    prefix, suffix = vanity_pattern()
    if (prefix or suffix) and "salt" not in state:
        tries, eta = vanity_estimate()
        log(f"vanity address   0x{prefix}...{suffix}  ({tries:,} tries, about {eta / 60:.1f} min on {mp.cpu_count()} cores)")
        if eta > int(cfg("VANITY_MAX_SECONDS")):
            die(f"the vanity pattern needs about {eta / 60:.0f} min but VANITY_MAX_SECONDS is {cfg('VANITY_MAX_SECONDS')}; "
                f"shorten the pattern or raise the limit")
    elif "salt" in state:
        log(f"vanity address   already found: {state['predicted_token']}")
    else:
        log("vanity address   none")
    log(f"gas price        {Decimal(gas_price) / Decimal(GWEI):.4f} gwei, headroom reserved {fmt_eth(gas_budget)}")
    done = [k for k in ("factory", "token", "pair") if state.get(k)]
    log(f"state file       {cfg('STATE_FILE')}: " + (", ".join(f"{k} done" for k in done) if done else "fresh launch"))
    return {"liq_eth": liq_eth}


def step_deploy(w3, acct, state):
    if state.get("token"):
        log(f"deploy: token already at {state['token']}, skipping")
        return state
    if not state.get("factory"):
        log("deploy: Create2Factory")
        c = w3.eth.contract(abi=ARTIFACTS["Create2Factory"]["abi"], bytecode=ARTIFACTS["Create2Factory"]["bytecode"])
        rcpt = send(w3, acct, None, c.constructor().data_in_transaction, 0, "factory deploy")
        state.update({"factory": rcpt["contractAddress"], "factory_tx": rcpt["transactionHash"].hex()})
        save_state(state)
    factory = contract(w3, "Create2Factory", state["factory"])
    if factory.functions.owner().call().lower() != acct.address.lower():
        die(f"Create2Factory {state['factory']} is not owned by {acct.address}")

    code = init_code(acct.address)
    code_hash = keccak(code)
    if "salt" not in state:
        salt = grind_salt(state["factory"], code_hash, int(cfg("VANITY_MAX_SECONDS")))
        state.update({"salt": salt, "predicted_token": create2_address(state["factory"], salt.to_bytes(32, "big"), code_hash)})
        save_state(state)
    salt_bytes = int(state["salt"]).to_bytes(32, "big")
    predicted = state["predicted_token"]
    if factory.functions.computeAddress(salt_bytes, code_hash).call().lower() != predicted.lower():
        die("local CREATE2 prediction disagrees with the factory contract (did CONFIG change after the salt was found? "
            "delete 'salt' from the state file)")
    if len(w3.eth.get_code(predicted)) != 0:
        die(f"something already lives at {predicted}; delete 'salt' from the state file to grind a new one")

    log(f"deploy: {cfg('TOKEN_SYMBOL')} via CREATE2 -> {predicted}")
    rcpt = send(w3, acct, factory.address, calldata(factory.functions.deploy(salt_bytes, code)), 0, "token deploy", gas_mult=1.4)
    ev = factory.events.Deployed().process_receipt(rcpt, errors=DISCARD)
    if not ev or ev[0]["args"]["addr"].lower() != predicted.lower():
        die("token deployed to an unexpected address")
    token = contract(w3, "NotAFruitFly", predicted)
    assert token.functions.totalSupply().call() == supply_wei()
    assert token.functions.balanceOf(acct.address).call() == supply_wei()
    state.update({"token": predicted, "token_tx": rcpt["transactionHash"].hex(), "token_block": rcpt["blockNumber"]})
    save_state(state)
    log(f"  {cfg('TOKEN_SYMBOL')} is live at {predicted}, {fmt_tok(supply_wei())} in the launch wallet")
    return state


def step_pool(w3, acct, state, liq_eth):
    if not state.get("token"):
        die("no token yet - run deploy first")
    if state.get("pair"):
        log(f"pool: already created at {state['pair']}, skipping")
        return state
    token = contract(w3, "NotAFruitFly", state["token"])
    router = w3.eth.contract(address=addr("ROUTER"), abi=ROUTER_ABI)
    factory = w3.eth.contract(address=addr("FACTORY"), abi=FACTORY_ABI)
    amount = pool_tokens_wei()
    have = token.functions.balanceOf(acct.address).call()
    if have < amount:
        die(f"launch wallet holds {fmt_tok(have)}, pool needs {fmt_tok(amount)}")
    if token.functions.allowance(acct.address, router.address).call() < amount:
        send(w3, acct, token.address, calldata(token.functions.approve(router.address, amount)), 0, "approve")
    to = Web3.to_checksum_address(DEAD) if cfg("BURN_LP") else acct.address
    log(f"pool: addLiquidityETH {fmt_tok(amount)} + {fmt_eth(liq_eth)}, LP -> {to}")
    rcpt = send(w3, acct, router.address, calldata(router.functions.addLiquidityETH(
        token.address, amount, amount, liq_eth, to, chain_now(w3) + 20 * 60)), liq_eth, "addLiquidityETH", gas_mult=1.4)
    pair = factory.functions.getPair(token.address, addr("WETH")).call()
    if int(pair, 16) == 0:
        die("liquidity tx confirmed but no pair found")
    p = w3.eth.contract(address=pair, abi=PAIR_ABI)
    lp_total = p.functions.totalSupply().call()
    lp_dead = p.functions.balanceOf(Web3.to_checksum_address(DEAD)).call()
    state.update({"pair": pair, "liquidity_tx": rcpt["transactionHash"].hex(), "lp_total": lp_total, "lp_burned": lp_dead})
    save_state(state)
    log(f"  pair {pair}  LP burned {lp_dead:,} of {lp_total:,} ({MINIMUM_LIQUIDITY} wei locked in the pair by Uniswap itself)")
    return state


def step_verify(w3, state):
    """Submit flattened source to Blockscout, then wait for the result. Safe to re-run."""
    import requests  # installed with web3

    ex = cfg("EXPLORER").rstrip("/")
    jobs = [(n, state[k]) for n, k in (("NotAFruitFly", "token"), ("Create2Factory", "factory")) if state.get(k)]
    if not jobs:
        die("nothing to verify yet")

    def is_verified(a):
        try:
            return bool(requests.get(f"{ex}/api/v2/smart-contracts/{a}", timeout=30).json().get("is_verified"))
        except Exception:  # noqa: BLE001
            return False

    for name, a in jobs:
        art = ARTIFACTS[name]
        if is_verified(a):
            log(f"verify: {name} {a} already verified")
            continue
        body = {"compiler_version": art["compiler"], "license_type": "mit", "source_code": art["source"],
                "is_optimization_enabled": True, "optimization_runs": str(art["optimizer_runs"]),
                "evm_version": art["evm_version"], "contract_name": name, "autodetect_constructor_args": True}
        ok = False
        for attempt in range(1, 6):  # the explorer may need a moment to index a brand-new contract
            try:
                r = requests.post(f"{ex}/api/v2/smart-contracts/{a}/verification/via/flattened-code", json=body, timeout=60)
                log(f"verify: {name} {a} attempt {attempt} -> HTTP {r.status_code} {r.text[:160]}")
                if r.status_code == 200:
                    ok = True
                    break
            except Exception as e:  # noqa: BLE001
                log(f"verify: {name} attempt {attempt} failed: {e}")
                if attempt == 1:
                    break
            time.sleep(10)
        if ok:
            for _ in range(12):
                time.sleep(5)
                if is_verified(a):
                    log(f"  {name} verified: {ex}/address/{a}?tab=contract")
                    break
            else:
                log(f"  {name}: submitted, not confirmed yet - check {ex}/address/{a}?tab=contract")
        else:
            log(f"  manual fallback: {ex}/address/{a}/contract-verification -> Solidity (flattened), "
                f"compiler {art['compiler']}, optimization on, {art['optimizer_runs']} runs, evm {art['evm_version']}, "
                f"license MIT, paste {name}.sol, autodetect constructor args")


def step_status(w3, state):
    log("=" * 78)
    log(f"{cfg('TOKEN_NAME')} (${cfg('TOKEN_SYMBOL')}) on Robinhood Chain {cfg('CHAIN_ID')}   {cfg('WEBSITE')}   @{cfg('X_HANDLE')}")
    log("=" * 78)
    if not state.get("token"):
        log("token            not deployed yet")
        return
    token = contract(w3, "NotAFruitFly", state["token"])
    log(f"contract (CA)    {state['token']}")
    log(f"supply           {fmt_tok(token.functions.totalSupply().call())}")
    if state.get("wallet"):
        log(f"launch wallet    holds {fmt_tok(token.functions.balanceOf(Web3.to_checksum_address(state['wallet'])).call())}")
    if state.get("pair"):
        p = w3.eth.contract(address=Web3.to_checksum_address(state["pair"]), abi=PAIR_ABI)
        r0, r1, _ = p.functions.getReserves().call()
        tok_r, eth_r = (r0, r1) if p.functions.token0().call().lower() == state["token"].lower() else (r1, r0)
        lp_total = p.functions.totalSupply().call()
        lp_dead = p.functions.balanceOf(Web3.to_checksum_address(DEAD)).call()
        price = Decimal(eth_r) / Decimal(tok_r) if tok_r else Decimal(0)
        fdv = price * Decimal(token.functions.totalSupply().call()) / Decimal(10**18)
        usd = eth_usd(w3)
        log(f"pair             {state['pair']}")
        log(f"reserves         {fmt_tok(tok_r)} / {fmt_eth(eth_r)}")
        log(f"price            {price:.12f} ETH per {cfg('TOKEN_SYMBOL')}")
        log(f"FDV              {fdv:.4f} ETH" + (f"  (~${fdv * usd:,.0f})" if usd else ""))
        log(f"LP burned        {(Decimal(lp_dead) * 100 / Decimal(lp_total)) if lp_total else 0:.4f}%")
    else:
        log("pool             not created yet")
    for k, v in links(state).items():
        log(f"{k:<16} {v}")


# ------------------------------------------------------------------------------------
# main
# ------------------------------------------------------------------------------------
def main(argv=None, w3=None, acct=None):
    ap = argparse.ArgumentParser(description="Not a fruit fly launcher")
    ap.add_argument("cmd", nargs="?", default="launch", choices=["launch", "check", "verify", "status"])
    ap.add_argument("--yes", action="store_true", help="skip the LAUNCH confirmation")
    ap.add_argument("--dry-run", action="store_true", help="stop before the first signature")
    a = ap.parse_args(argv)

    load_dotenv()
    w3 = w3 or connect()
    state = load_state()
    if a.cmd == "status":
        step_status(w3, state)
        return state
    if a.cmd == "verify":
        step_verify(w3, state)
        return state

    acct = acct or get_account()
    state.setdefault("wallet", acct.address)
    if state["wallet"].lower() != acct.address.lower():
        die(f"state file was started with wallet {state['wallet']}, current key is {acct.address}")

    log("-" * 78)
    plan = step_check(w3, acct, state)
    log("-" * 78)
    if a.cmd == "check" or a.dry_run:
        log("check passed, nothing sent")
        return state
    if not a.yes:
        log("\nThis sends real transactions on Robinhood Chain and burns the LP forever.")
        if input("Type LAUNCH to continue: ").strip() != "LAUNCH":
            die("not confirmed")
    state = step_deploy(w3, acct, state)
    state = step_pool(w3, acct, state, plan["liq_eth"])
    step_verify(w3, state)
    log("")
    step_status(w3, state)
    log(f"\nAll done. Details saved to {cfg('STATE_FILE')}.")
    return state


if __name__ == "__main__":
    main()
