const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SamajhSoulbound to Polygon Amoy with relayer:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("SamajhSoulbound");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("SamajhSoulbound deployed at:", address);

  const artifact = await hre.artifacts.readArtifact("SamajhSoulbound");
  const outPath = path.resolve(__dirname, "../../backend/src/contracts/SamajhSoulbound.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: "polygon-amoy",
        chainId: 80002,
        address,
        abi: artifact.abi,
      },
      null,
      2
    )
  );
  console.log("Saved contract address + ABI to:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
