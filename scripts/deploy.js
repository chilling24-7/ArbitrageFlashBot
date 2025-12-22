// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("Deploying Arbitrage contract...");

  const sRouter = process.env.SUSHI_ROUTER;
  const uRouter = process.env.UNI_ROUTER;

  if (!sRouter || !uRouter) {
    throw new Error("Router addresses missing in .env");
  }

  const Arbitrage = await ethers.getContractFactory("Arbitrage");

  // deploy contract — deploy() in Ethers v6 already waits for mining
  const arbitrageContract = await Arbitrage.deploy(sRouter, uRouter);

  console.log("Arbitrage contract deployed at:", arbitrageContract.target); // use `target` instead of `address`
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
