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

  // Ensure router addresses are in the .env file
  const sRouter = process.env.SUSHI_ROUTER;
  const uRouter = process.env.UNI_ROUTER;

  if (!sRouter || !uRouter) {
    throw new Error("Router addresses missing in .env");
  }

  const Arbitrage = await ethers.getContractFactory("Arbitrage");

  // Get the network the script is running on
  const network = hre.network.name;

  // Set gas fee parameters for different networks (or use Hardhat's auto settings for localhost)
  let gasOverrides = {};
  
  if (network !== "localhost") {
    // For mainnet or testnets, fetch the current base fee and set gas params
    const latestBlock = await ethers.provider.getBlock("latest");
    const baseFeePerGas = latestBlock.baseFeePerGas;

    // Optionally, you could fetch the priority fee for current network congestion
    const priorityFeePerGas = ethers.utils.parseUnits("2", "gwei"); // Set a reasonable priority fee (2 gwei)

    // Set maxFeePerGas (must be higher than baseFeePerGas)
    const maxFeePerGas = baseFeePerGas.add(ethers.utils.parseUnits("10", "gwei")); // Add some buffer (10 gwei)

    gasOverrides = {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFeePerGas,
    };
  }

  // Deploy the contract with overrides for gas fees (if necessary)
  const arbitrageContract = await Arbitrage.deploy(sRouter, uRouter, gasOverrides);

  console.log("Arbitrage contract deployed at:", arbitrageContract.target);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
