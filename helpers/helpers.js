const { ethers } = require("hardhat");
const Big = require("big.js");

// ABIs
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const IERC20 = require("@openzeppelin/contracts/build/contracts/ERC20.json");
const IUniswapV2Factory = require("@uniswap/v2-core/build/IUniswapV2Factory.json");
const IUniswapV2Router02 = require("@uniswap/v2-periphery/build/IUniswapV2Router02.json");

/**
 * Get ERC-20 token contracts and metadata
 */
async function getTokenAndContract(token0Address, token1Address, signerOrProvider) {
  if (!token0Address || !token1Address) throw new Error("Token address missing!");

  const token0Contract = new ethers.Contract(token0Address, IERC20.abi, signerOrProvider);
  const token1Contract = new ethers.Contract(token1Address, IERC20.abi, signerOrProvider);

  const token0 = {
    address: token0Address,
    decimals: Number(await token0Contract.decimals()),
    symbol: await token0Contract.symbol(),
    name: await token0Contract.name()
  };

  const token1 = {
    address: token1Address,
    decimals: Number(await token1Contract.decimals()),
    symbol: await token1Contract.symbol(),
    name: await token1Contract.name()
  };

  return { token0Contract, token1Contract, token0, token1 };
}

/**
 * Get pair address from factory
 */
async function getPairAddress(factoryContract, token0, token1) {
  const pairAddress = await factoryContract.getPair(token0, token1);
  if (!pairAddress || pairAddress === ethers.ZeroAddress) {
    throw new Error("Pair does not exist!");
  }
  return pairAddress;
}

/**
 * Get pair contract
 */
async function getPairContract(factoryContract, token0, token1, signerOrProvider) {
  const pairAddress = await getPairAddress(factoryContract, token0, token1);
  return new ethers.Contract(pairAddress, IUniswapV2Pair.abi, signerOrProvider);
}

/**
 * Get reserves
 */
async function getReserves(pairContract) {
  const reserves = await pairContract.getReserves();
  if (reserves.reserve0 !== undefined && reserves.reserve1 !== undefined) {
    return [BigInt(reserves.reserve0.toString()), BigInt(reserves.reserve1.toString())];
  } else if (Array.isArray(reserves)) {
    return [BigInt(reserves[0].toString()), BigInt(reserves[1].toString())];
  } else {
    throw new Error("Cannot read reserves from pair contract");
  }
}

/**
 * Approve a router to spend a token
 * @param {Contract} tokenContract - ERC20 token contract
 * @param {string} routerAddress - Router address to approve
 * @param {Signer} signer - Ethers signer
 * @param {BigInt | string} amount - Amount to approve (optional, default MaxUint256)
 */
async function approveToken(tokenContract, routerAddress, signer, amount) {
  const approveAmount = amount ? BigInt(amount.toString()) : ethers.MaxUint256;
  const tx = await tokenContract.connect(signer).approve(routerAddress, approveAmount);
  await tx.wait();
  console.log(`Approved router ${routerAddress} to spend ${tokenContract.address}`);
  return tx;
}

/**
 * Approve multiple routers for a token
 */
async function approveTokenForRouters(tokenContract, routers, signer) {
  for (const router of routers) {
    await approveToken(tokenContract, router, signer);
  }
}


/**
 * Calculate price (token1 per token0)
 */
async function calculatePrice(pairContract, token0Decimals = 18, token1Decimals = 18) {
  const [reserve0, reserve1] = await getReserves(pairContract);
  const price = Big(reserve1.toString())
    .div(Big(10).pow(token1Decimals))
    .div(Big(reserve0.toString()).div(Big(10).pow(token0Decimals)));
  return price;
}

/**
 * Simulate swap arbitrage (BigInt amounts)
 */

async function simulate(amountIn, routerPath, token0, token1) {
  // amountIn MUST be bigint
  const amountInBigInt = BigInt(amountIn.toString());

  // Router expects bigint in ethers v6
  const amountsOut1 = await routerPath[0].getAmountsOut(
    amountInBigInt,
    [token0.address, token1.address]
  );

  const amountsOut2 = await routerPath[1].getAmountsOut(
    amountsOut1[1],
    [token1.address, token0.address]
  );

  return {
    amountIn: amountInBigInt,
    amountOut: BigInt(amountsOut2[1].toString())
  };
}

module.exports = {
  getTokenAndContract,
  getPairAddress,
  getPairContract,
  getReserves,
  calculatePrice,
  simulate,
  IUniswapV2Factory,
  IUniswapV2Router02,
  approveToken,
  approveTokenForRouters
};


