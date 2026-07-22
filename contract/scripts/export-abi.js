// Copie l'ABI compilée de SignalSubscription vers bot/src/blockchain/abi/,
// pour que le bot Telegram reste toujours synchronisé avec l'interface
// réelle du contrat (à relancer après chaque `hardhat compile`).

const fs = require("fs");
const path = require("path");

const ARTIFACT_PATH = path.join(
  __dirname, "..", "artifacts", "contracts", "SignalSubscription.sol", "SignalSubscription.json"
);
const BOT_ABI_DIR = path.join(__dirname, "..", "..", "bot", "src", "blockchain", "abi");
const BOT_ABI_PATH = path.join(BOT_ABI_DIR, "SignalSubscription.json");

if (!fs.existsSync(ARTIFACT_PATH)) {
  console.error(`Artefact introuvable: ${ARTIFACT_PATH}`);
  console.error("Lance d'abord `npm run compile` dans le dossier contract/.");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));

fs.mkdirSync(BOT_ABI_DIR, { recursive: true });
fs.writeFileSync(BOT_ABI_PATH, JSON.stringify(artifact.abi, null, 2));

console.log(`ABI exportée vers ${BOT_ABI_PATH}`);
