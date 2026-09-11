// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Not a fruit fly ($NOTAFRUITFLY)
/// @notice Fixed-supply ERC-20. No owner. No mint. No tax. No blacklist. No pause. No proxy.
///         The whole supply is minted once, in the constructor, to the launch wallet.
///         After that the contract has no privileged functions of any kind.
contract NotAFruitFly {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address to_) {
        require(to_ != address(0), "NOTAFRUITFLY: zero recipient");
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[to_] = supply_;
        emit Transfer(address(0), to_, supply_);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "NOTAFRUITFLY: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "NOTAFRUITFLY: zero address");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "NOTAFRUITFLY: balance");
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
