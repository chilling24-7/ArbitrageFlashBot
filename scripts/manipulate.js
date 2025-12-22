require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

// -- HELPERS --
const {
  getTokenAndContract,
  getPairContract,
  calculatePrice,
} = require("../helpers/helpers");
const { provider, uFactory, uRouter, sFactory, sRouter } = require("../helpers/initialization.js");

// -- CONFIG --
const V2_FACTORY_TO_USE = uFactory;
const V2_ROUTER_TO_USE = uRouter;

const UNLOCKED_ACCOUNT = "0xdEAD000000000000000042069420694206942069"; // SHIB account to impersonate
const AMOUNT = "40500000000000"; // Amount in tokens (string), converted to wei

async function main() {
  try {
    console.log("Fetching token contracts...");

    // Fetch token contracts
    const {
      token0Contract,
      token1Contract,
      token0: ARB_AGAINST,
      token1: ARB_FOR,
    } = await getTokenAndContract(process.env.ARB_AGAINST, process.env.ARB_FOR, provider);

    const pair = await getPairContract(V2_FACTORY_TO_USE, ARB_AGAINST.address, ARB_FOR.address, provider);
    const usdc = await getTokenAndContract(process.env.USDC, process.env.USDC, provider);

    console.log(`Fetching prices before swap...`);
    // Fetch prices before
    const priceBefore = await calculatePrice(pair);
    const priceBeforeUSDC = await calculatePrice(await getPairContract(V2_FACTORY_TO_USE, usdc.token0.address, ARB_AGAINST.address, provider));

    // Determine swap direction automatically
    const startOnUniswap = priceBefore < 1; // if price < 1, WETH -> SHIB; else SHIB -> WETH
    console.log(`Auto-detected swap direction: ${startOnUniswap ? "WETH → SHIB" : "SHIB → WETH"}\n`);

    console.log(`Price Before: 1 ${ARB_AGAINST.symbol} = ${priceBefore} ${ARB_FOR.symbol}`);
    console.log(`Reserves Before:`);
    const [reserve0Before, reserve1Before] = await pair.getReserves();
    console.log(`${ARB_AGAINST.symbol}: ${reserve0Before}, ${ARB_FOR.symbol}: ${reserve1Before}`);
    console.log(`Price Before (USDC/WETH): 1 ${usdc.token0.symbol} = ${priceBeforeUSDC} WETH\n`);

    // Impersonate unlocked account
    console.log(`Impersonating account ${UNLOCKED_ACCOUNT}...`);
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [UNLOCKED_ACCOUNT],
    });
    const signer = await ethers.getSigner(UNLOCKED_ACCOUNT);
    console.log(`Using signer: ${signer.address}\n`);

    await manipulatePrice([ARB_AGAINST, ARB_FOR], [token0Contract, token1Contract], startOnUniswap, AMOUNT);

    // Fetch prices after
    const priceAfter = await calculatePrice(pair);
    console.log(`\nPrice After: 1 ${ARB_AGAINST.symbol} = ${priceAfter} ${ARB_FOR.symbol}`);
  } catch (error) {
    console.error("Error in main function:", error);
    process.exitCode = 1;
  }
}

async function manipulatePrice(_path, _tokenContracts, startOnUniswap, amountStr) {
  const [token0Contract, token1Contract] = _tokenContracts;

  // BigNumber-safe amount using decimals
  const decimals = startOnUniswap ? await token0Contract.decimals() : await token1Contract.decimals();
  const amount = ethers.parseUnits(amountStr, decimals);

  // Debugging the amount to ensure it's being parsed correctly
  console.log(`Amount to be used in swap (converted to units): ${amount.toString()}`);

  // Check current allowance before approving
  console.log(`Checking allowance before approval...`);
  const allowance = await (startOnUniswap ? token0Contract : token1Contract).allowance(UNLOCKED_ACCOUNT, V2_ROUTER_TO_USE.getAddress());
  
  // Log the type and value of the allowance
  console.log(`Allowance returned: ${allowance.toString()}`);
  console.log(`Allowance type: ${typeof allowance}`);

  // If allowance is undefined or null, log and throw error
  if (allowance === undefined || allowance === null) {
    console.error("Allowance is undefined or null. Check the token contract and router address.");
    throw new Error("Allowance is undefined or null.");
  }

  // Convert allowance to BigInt if it's a 'bigint' and compare
  if (typeof allowance === "bigint") {
    console.log(`Allowance is a BigInt. Proceeding with comparison.`);
    if (allowance < amount) {
      console.log(`Insufficient allowance, approving ${amountStr} tokens...`);
      // Approve the token for router
      const approvalToken = startOnUniswap ? token0Contract : token1Contract;
      console.log(`Approving tokens for router...`);
      const approveTx = await approvalToken.connect(await ethers.getSigner(UNLOCKED_ACCOUNT)).approve(V2_ROUTER_TO_USE.getAddress(), amount, { gasLimit: 50000 });
      console.log(`Approval successful with tx hash: ${approveTx.hash}`);
      await approveTx.wait();
      console.log(`Approval confirmed.`);
    }
  } else {
    console.error("Allowance is not a BigInt or a valid BigNumber.");
    throw new Error("Allowance is not a BigInt or a valid BigNumber.");
  }

  // Check allowance after approval
  const newAllowance = await (startOnUniswap ? token0Contract : token1Contract).allowance(UNLOCKED_ACCOUNT, V2_ROUTER_TO_USE.getAddress());
  console.log(`Allowance after approval: ${newAllowance.toString()}`);

  // Check the balance of the tokens to ensure we have enough for the swap
  const balance = await (startOnUniswap ? token0Contract : token1Contract).balanceOf(UNLOCKED_ACCOUNT);
  console.log(`Balance of ${startOnUniswap ? token0Contract.symbol() : token1Contract.symbol()} before swap: ${balance.toString()}`);

  // Await the balance value before comparison
  const availableBalance = await balance;

  console.log(`Available Balance after awaiting: ${availableBalance.toString()}`);

  // Debug the token decimals again, making sure we are comparing in the right format
  const tokenDecimals = startOnUniswap ? await token0Contract.decimals() : await token1Contract.decimals();
  console.log(`Token decimals: ${tokenDecimals}`);

  // Scale the balance properly (no decimals should remain after formatting)
  const formattedBalance = ethers.formatUnits(availableBalance, tokenDecimals);
  console.log(`Formatted Balance: ${formattedBalance}`);

  // Compare balance and amount after proper scaling
  const scaledAmount = ethers.parseUnits(amountStr, tokenDecimals);
  const scaledBalance = ethers.parseUnits(formattedBalance, tokenDecimals);

  console.log(`Scaled Amount: ${scaledAmount.toString()}`);
  console.log(`Scaled Balance: ${scaledBalance.toString()}`);

  // If balance is less than the amount, log an error and throw
  if (scaledBalance < scaledAmount) {
    console.error(`Insufficient balance for swap. Required: ${scaledAmount.toString()}, Available: ${scaledBalance.toString()}`);
    throw new Error("Insufficient balance for swap.");
  }

  // Only addresses go into router
  const path = startOnUniswap
    ? [_path[0].address, _path[1].address]
    : [_path[1].address, _path[0].address];

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log(`Beginning swap: ${startOnUniswap ? `${_path[0].symbol} → ${_path[1].symbol}` : `${_path[1].symbol} → ${_path[0].symbol}`}\n`);

  // Execute swap
  try {
    const swapTx = await V2_ROUTER_TO_USE.connect(await ethers.getSigner(UNLOCKED_ACCOUNT)).swapExactTokensForTokens(
      scaledAmount,
      0,
      path,
      UNLOCKED_ACCOUNT,
      deadline,
      { gasLimit: 125000 }
    );
    console.log(`Swap complete! Tx hash: ${swapTx.hash}`);
    await swapTx.wait();
    console.log(`Swap confirmed.`);
  } catch (error) {
    console.error(`Error during swap:`, error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
