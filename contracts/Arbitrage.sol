// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.18;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract Arbitrage is IFlashLoanRecipient, ReentrancyGuard, Pausable {
    IVault private constant vault =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    event LogError(string message);
    event FlashLoanExecuted(address token, uint256 amount);
    event SwapExecuted(address fromToken, address toToken, uint256 amountIn, uint256 amountOut);

    IUniswapV2Router02 public immutable sRouter;
    IUniswapV2Router02 public immutable uRouter;
    address public owner;

    mapping(address => bool) public whitelistedAddresses;


    constructor(address _sRouter, address _uRouter) {
        sRouter = IUniswapV2Router02(_sRouter); // Sushiswap
        uRouter = IUniswapV2Router02(_uRouter); // Uniswap
        owner = msg.sender;
    }

    modifier onlyOwner() {
    require(msg.sender == owner, "Not authorized");
    _;
    }

    function pause() external onlyOwner {
    _pause();  // Pauses all operations
    }

    function unpause() external onlyOwner {
        _unpause();  // Unpauses all operations
    }

    function addToWhitelist(address _address) external onlyOwner {
    whitelistedAddresses[_address] = true;
    }

    function removeFromWhitelist(address _address) external onlyOwner {
        whitelistedAddresses[_address] = false;
    }

    modifier onlyWhitelisted() {
    require(msg.sender == owner || whitelistedAddresses[msg.sender], "Not authorized");
    _;
    }

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
    (bool success, bytes memory data) = address(token).call(
        abi.encodeWithSelector(token.transfer.selector, to, amount)
    );
    require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    event ApprovalSuccess(address token, address spender, uint256 amount);

    function safeApprove(IERC20 token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Approve failed");
        emit ApprovalSuccess(address(token), spender, amount);
    }

    function executeTrade(
        bool _startOnUniswap,
        address _token0,
        address _token1,
        uint256 _flashAmount
    ) external nonReentrant onlyWhitelisted whenNotPaused {
        emit LogError("Start trade");
        bytes memory data = abi.encode(_startOnUniswap, _token0, _token1);

        // Token to flash loan, by default we are flash loaning 1 token.
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(_token0);

        // Flash loan amount.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _flashAmount;

        vault.flashLoan(this, tokens, amounts, data);
        emit LogError("Trade executed successfully");
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(vault));

        // Decode user data
        (bool startOnUniswap, address token0, address token1) = abi.decode(
            userData,
            (bool, address, address)
        );

        uint256 startingBalance = IERC20(token0).balanceOf(address(this));

        uint256 flashAmount = amounts[0];
        emit FlashLoanExecuted( token0, flashAmount);

        // Use the money here!
        address[] memory path = new address[](2);

        path[0] = token0;
        path[1] = token1;

        if (startOnUniswap) {
            _swapOnUniswap(path, flashAmount, 0);

            path[0] = token1;
            path[1] = token0;

            _swapOnSushiswap(
                path,
                IERC20(token1).balanceOf(address(this)),
                flashAmount
            );
        } else {
            _swapOnSushiswap(path, flashAmount, 0);

            path[0] = token1;
            path[1] = token0;

            _swapOnUniswap(
                path,
                IERC20(token1).balanceOf(address(this)),
                flashAmount
            );
        }

        uint256 finalBalance = IERC20(token0).balanceOf(address(this));
        require(finalBalance >= flashAmount, "Insufficient token0 to repay flash loan");

        uint256 profit = finalBalance - flashAmount;
        require(profit > 0, "No profit from arbitrage");

        safeTransfer(IERC20(token0), address(vault), flashAmount); // repay flash loan
        safeTransfer(IERC20(token0), owner, profit);
    }

    // -- INTERNAL FUNCTIONS -- //

    function _swapOnUniswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve router to spend token
        safeApprove(IERC20(_path[0]), address(uRouter), _amountIn);

        // Execute swap
        uRouter.swapExactTokensForTokens(
            _amountIn,
            _amountOut,
            _path,
            address(this),
            block.timestamp + 1200
        );
    }

    function _swapOnSushiswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve router to spend token
        safeApprove(IERC20(_path[0]), address(sRouter), _amountIn);

        // Execute swap
        sRouter.swapExactTokensForTokens(
            _amountIn,
            _amountOut,
            _path,
            address(this),
            (block.timestamp + 1200)
        );
    }
}
