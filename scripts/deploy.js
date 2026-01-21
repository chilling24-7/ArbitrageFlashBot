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

  let gasOverrides = {};

  // If we are deploying on localhost, we should use a higher gas price to avoid issues
  if (network === "localhost") {
    const highGasPrice = ethers.parseUnits("100", "gwei"); // Use high gas price for localhost (100 Gwei)
    gasOverrides = {
      maxFeePerGas: highGasPrice,  // Set maxFeePerGas
      maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"), // Set maxPriorityFeePerGas (e.g., 2 Gwei)
    };
  } else {
    // For mainnet or testnets, use the latest baseFeePerGas and priorityFeePerGas
    const latestBlock = await ethers.provider.getBlock("latest");
    const baseFeePerGas = latestBlock.baseFeePerGas;
    const priorityFeePerGas = ethers.parseUnits("2", "gwei"); // Reasonable priority fee (2 Gwei)

    const maxFeePerGas = baseFeePerGas.add(ethers.parseUnits("10", "gwei")); // Buffer for maxFeePerGas

    gasOverrides = {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFeePerGas,
    };
  }

  // Deploy the contract with gasOverrides and constructor parameters
  const arbitrageContract = await Arbitrage.deploy(sRouter, uRouter, gasOverrides);

  console.log("Arbitrage contract deployed at:", arbitrageContract.target);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
