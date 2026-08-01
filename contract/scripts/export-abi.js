// Copie l'ABI compilée de SignalSubscription vers bot/src/blockchain/abi/.
//
// LEGACY / DORMANT : écrit par et pour l'ancien bot Node.js (`bot/`), qui a
// été supprimé (remplacé par `workers/main-worker`). Le worker actuel calcule
// ses sélecteurs de fonction "à la main" dans `blockchain/abi.ts` et ne
// consomme aucun fichier ABI généré -- ce script n'est donc appelé par rien
// dans l'architecture actuelle (V2 100% off-chain, contrat dormant). Conservé
// tel quel au cas où le répertoire `bot/` ou un usage similaire renaîtrait.

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
