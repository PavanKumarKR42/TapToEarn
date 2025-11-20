/**
 *Submitted for verification at basescan.org on 2025-11-19
*/

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

contract SimpleTapToEarn {

    address public owner;
    IERC20 public token;

    constructor(address _token) {
        owner = msg.sender;
        token = IERC20(_token);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // Owner deposits tokens into contract
    function deposit(uint256 amount) external onlyOwner {
        require(token.transferFrom(owner, address(this), amount), "deposit failed");
    }

    // Owner withdraws unused tokens
    function withdraw(uint256 amount) external onlyOwner {
        require(token.transfer(owner, amount), "withdraw failed");
    }

    // User claims token rewards
    // FRONTEND sends final tap count (unsafe as you requested)
    function claim(uint256 taps) external {
        require(taps > 0, "no taps");

        // Convert taps => full ERC20 tokens (18 decimals)
        uint256 reward = taps * 1e18; // 1 tap = 1 token

        require(token.balanceOf(address(this)) >= reward, "not enough tokens");

        require(token.transfer(msg.sender, reward), "transfer failed");
    }
}