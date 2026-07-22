// Déploie SignalSubscription sur le réseau choisi (--network polygon ou --network amoy).
// Le contrat n'a pas de paramètres de constructeur : l'adresse du token USDT et
// l'adresse OWNER sont hardcodées dans le contrat lui-même (voir SignalSubscription.sol).

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Déploiement depuis: ${deployer.address}`);
  console.log(`Réseau: ${hre.network.name}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Solde du déployeur: ${hre.ethers.formatEther(balance)} MATIC/POL`);
  if (balance === 0n) {
    throw new Error(
      "Le wallet de déploiement n'a pas de MATIC/POL pour payer le gas. " +
      "Utilise un faucet (testnet) ou approvisionne le wallet (mainnet)."
    );
  }

  const Factory = await hre.ethers.getContractFactory("SignalSubscription");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`SignalSubscription déployé à l'adresse: ${address}`);

  // Sauvegarde l'adresse déployée pour référence (utilisée par export-abi.js et le bot).
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const deploymentFile = path.join(deploymentsDir, `${hre.network.name}.json`);
  fs.writeFileSync(
    deploymentFile,
    JSON.stringify({ network: hre.network.name, address, deployer: deployer.address, deployedAt: new Date().toISOString() }, null, 2)
  );
  console.log(`Adresse sauvegardée dans ${deploymentFile}`);

  console.log("\nProchaines étapes :");
  console.log(`  1. Copier "${address}" dans bot/.env sous CONTRACT_ADDRESS`);
  console.log("  2. Lancer `node scripts/export-abi.js` pour copier l'ABI vers bot/src/blockchain/abi/");
  console.log("  3. (Optionnel) Vérifier le contrat: npx hardhat verify --network " + hre.network.name + " " + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
