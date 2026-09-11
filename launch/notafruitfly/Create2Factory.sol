// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Create2Factory
/// @notice Minimal CREATE2 deployer so the token can land on a chosen (vanity) address.
///         Only the wallet that deployed the factory can use it.
contract Create2Factory {
    address public immutable owner;

    event Deployed(address indexed addr, bytes32 indexed salt);

    constructor() {
        owner = msg.sender;
    }

    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {
        require(msg.sender == owner, "not owner");
        assembly {
            addr := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(addr != address(0), "CREATE2 failed");
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
