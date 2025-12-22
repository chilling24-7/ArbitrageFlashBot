require("./helpers/server");
require("dotenv").config();

const ethers = require("ethers");
const Big = require("big.js");
const colors = require("colors");

const config = require("./config.json");
const {
  getTokenAndContract,
  getPairContract,
  getReserves,
} = require("./helpers/helpers");

const {
  provider,
  uFactory,
  sFactory,
  uRouter,
  sRouter,
  arbitrage,
} = require("./helpers/initialization");

// ─────────────────────────────────────────
// ENV
// ─────────────────────────────────────────
const arbFor = process.env.ARB_FOR; // WETH
const arbAgainst = process.env.ARB_AGAINST; // SHIB
const gasLimit = 500000;
const cooldownMs = 15000; // 15 seconds cooldown

let uPair, sPair;
let tradeAmount;
let isExecuting = false;
let lastBlock = 0;
let lastTradeTime = 0;
let firstTradeDone = false;

// Track first event per pair
let skippedFirstEvent = { Uniswap: false, Sushiswap: false };
// Cooldown counter
let cooldownSkipCounter = { Uniswap: 0, Sushiswap: 0 };

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────
async function main() {
  const { token0Contract, token1Contract, token0, token1 } =
    await getTokenAndContract(arbFor, arbAgainst, provider);

  uPair = await getPairContract(uFactory, token0.address, token1.address, provider);
  sPair = await getPairContract(sFactory, token0.address, token1.address, provider);

  console.log("Uniswap Pair:", await uPair.getAddress());
  console.log("Sushiswap Pair:", await sPair.getAddress());

  lastBlock = await provider.getBlockNumber();
  console.log(`Starting from block: ${lastBlock}\n`);
  console.log("Waiting for swaps...\n");

  const handler = async (exchange, event) => {
    if (!skippedFirstEvent[exchange]) {
      skippedFirstEvent[exchange] = true;
      console.log(`Skipping first event at startup from ${exchange}...`);
      return;
    }

    const eventBlock = event.blockNumber || lastBlock + 1;

    if (isExecuting) return;

    const now = Date.now();
    if (firstTradeDone && now - lastTradeTime < cooldownMs) {
      cooldownSkipCounter[exchange]++;
      return;
    } else if (cooldownSkipCounter[exchange] > 0) {
      console.log(
        `Skipped ${cooldownSkipCounter[exchange]} trades for ${exchange} due to cooldown...`
      );
      cooldownSkipCounter[exchange] = 0;
    }

    if (eventBlock <= lastBlock) return;

    lastBlock = eventBlock;
    isExecuting = true;

    console.log(colors.yellow("═".repeat(90)));
    console.log(colors.yellow(`Swap detected on ${exchange}`));
    console.log(colors.yellow("═".repeat(90)));

    try {
      const direction = await determineDirection(token0, token1);
      if (!direction) {
        console.log("No arbitrage direction\n");
        isExecuting = false;
        return;
      }

      const profitable = await determineProfitability(direction, token0, token1);

      const timeStr = new Date().toLocaleTimeString();
      console.log(`Trade profit check at ${timeStr}`);

      if (!profitable) {
        console.log(colors.red("Trade not profitable.\n"));
        isExecuting = false;

        // Border after failed trade
        console.log(colors.yellow("═".repeat(90)));
        return;
      }

      if (config.PROJECT_SETTINGS.isDeployed) {
        await executeTrade(direction, token0Contract, token1Contract);
        lastTradeTime = Date.now();
        firstTradeDone = true;
        console.log(`\nTrade executed at ${timeStr}\n`);
      }

      const uRes = await getReserves(uPair);
      const sRes = await getReserves(sPair);
      console.log("Last block price history:");
      console.log(
        `Block ${eventBlock} | Time ${timeStr} | Uni: ${uRes[1].toString()} | Sushi: ${sRes[1].toString()}\n`
      );

      console.log(colors.yellow("═".repeat(90)));
    } catch (err) {
      console.error("Bot error:", err);
    }

    isExecuting = false;
  };

  uPair.on("Swap", (...args) => handler("Uniswap", args[args.length - 1]));
  sPair.on("Swap", (...args) => handler("Sushiswap", args[args.length - 1]));
}

// ─────────────────────────────────────────
// DIRECTION
// ─────────────────────────────────────────
async function determineDirection(token0, token1) {
  const uRes = await getReserves(uPair);
  const sRes = await getReserves(sPair);

  const uPrice = Big(uRes[1].toString()).div(uRes[0].toString());
  const sPrice = Big(sRes[1].toString()).div(sRes[0].toString());

  const pairName = `${token0.symbol}/${token1.symbol}`;
  console.log(`${colors.yellow("Uniswap price:")}   | ${pairName} = ${uPrice.toFixed(18)}`);
  console.log(`${colors.yellow("Sushiswap price")} | ${pairName} = ${sPrice.toFixed(18)}`);

  // Market spread percentage (absolute)
  const marketSpread = uPrice.minus(sPrice).div(sPrice).times(100).abs();
  const marketSpreadStr = colors.cyan(`${marketSpread.toFixed(6)}%`);
  console.log(`Price difference (market spread): ${marketSpreadStr}`);

  if (uPrice.gt(sPrice)) {
    console.log("Direction: Buy Sushi → Sell Uni\n");
    return [sRouter, uRouter, uPrice, sPrice];
  }

  if (sPrice.gt(uPrice)) {
    console.log("Direction: Buy Uni → Sell Sushi\n");
    return [uRouter, sRouter, uPrice, sPrice];
  }

  return null;
}

// ─────────────────────────────────────────
// PROFITABILITY
// ─────────────────────────────────────────
async function determineProfitability(routerPath, token0, token1) {
  const uRes = await getReserves(uPair);
  const sRes = await getReserves(sPair);

  const wethReserveUni = (await uPair.token0()) === token0.address ? uRes[0] : uRes[1];
  const wethReserveSushi = (await sPair.token0()) === token0.address ? sRes[0] : sRes[1];

  const minReserve = Big(wethReserveUni.toString()).lt(Big(wethReserveSushi.toString()))
    ? wethReserveUni
    : wethReserveSushi;

  tradeAmount = Big(minReserve.toString()).div(100000); // SAFE SIZE

  const buy = await routerPath[0].getAmountsOut(tradeAmount.toFixed(0), [token0.address, token1.address]);
  const sell = await routerPath[1].getAmountsOut(buy[1], [token1.address, token0.address]);

  const profitWeth = Big(sell[1].toString())
    .minus(tradeAmount)
    .div(Big(10).pow(token0.decimals));

  const profitWethFormatted = profitWeth.toFixed(6);
  const wethPrefix = "Profit (WETH): ";
  if (profitWeth.gt(0)) console.log(`${wethPrefix}${colors.green(`+${profitWethFormatted}`)}`);
  else console.log(`${wethPrefix}${colors.red(profitWethFormatted)}`);

  const profitUsdc = profitWeth.times(2000); // example WETH→USDC
  const profitUsdcFormatted = profitUsdc.toFixed(2);
  const usdcPrefix = "Profit (USDC): $";
  if (profitUsdc.gt(0)) console.log(`${usdcPrefix}${colors.green(`+${profitUsdcFormatted}`)}`);
  else console.log(`${usdcPrefix}${colors.red(profitUsdcFormatted)}`);

  const minProfitUsd = 5;
  if (profitUsdc.lt(minProfitUsd)) {
    console.log(colors.red(`Below MIN_PROFIT_USDC ($${minProfitUsd}), skipping trade`));
    return false;
  }

  console.log("Trade executed successfully.\n");
  return true;
}

// ─────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────
async function executeTrade(routerPath, token0Contract, token1Contract) {
  console.log("Executing arbitrage...\n");

  const startOnUniswap = (await routerPath[0].getAddress()) === (await uRouter.getAddress());
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const tx = await arbitrage.connect(signer).executeTrade(
    startOnUniswap,
    await token0Contract.getAddress(),
    await token1Contract.getAddress(),
    tradeAmount.toFixed(0),
    { gasLimit }
  );

  await tx.wait();
  console.log("✅ Trade completed\n");
}

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
main().catch(console.error);
