const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying TiketiNFT to network: ${network.name}`);
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  // The minter (relayer) wallet — defaults to the deployer unless MINTER_ADDRESS
  // is set separately in .env. This is the address the backend will call
  // mintTicket/markUsed from, and the address royalties are routed to.
  const minterAddress = process.env.MINTER_ADDRESS || deployer.address;
  console.log(`Minter address: ${minterAddress}`);

  const TiketiNFT = await ethers.getContractFactory("TiketiNFT");
  const nft = await TiketiNFT.deploy(minterAddress);
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  const tx = nft.deploymentTransaction();

  console.log("\n=== Deployment complete ===");
  console.log(`Contract address: ${address}`);
  console.log(`Deployment tx hash: ${tx.hash}`);
  console.log(`Network: ${network.name}`);
  console.log("\nSet this in the backend's .env:");
  console.log(`NFT_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
