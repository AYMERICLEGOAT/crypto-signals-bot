# Contrat SignalSubscription (Polygon)

Contrat unique gérant les abonnements payés en USDT sur Polygon Mainnet.
Adresse USDT et adresse propriétaire sont **hardcodées** dans le contrat
(voir [`contracts/SignalSubscription.sol`](contracts/SignalSubscription.sol)) :

- USDT (PoS, Polygon) : `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- Propriétaire (OWNER) : `0x71367B5f4519700a63c2564b754cF959317E1f61`

## 1. Prérequis

- Node.js 18+
- Un wallet avec un peu de MATIC/POL pour payer le gas du déploiement (ce wallet n'a
  pas besoin d'être le wallet OWNER : n'importe quel wallet financé peut déployer).
- Pour tester d'abord sans risque : du MATIC de testnet Amoy gratuit via un faucet
  (ex. [faucet.polygon.technology](https://faucet.polygon.technology/)).

## 2. Installation

```bash
cd contract
npm install
cp .env.example .env
# Remplis DEPLOYER_PRIVATE_KEY dans .env avec la clé privée du wallet de déploiement.
```

⚠️ `.env` est ignoré par git (voir `.gitignore`). Ne partage jamais cette clé.

## 3. Compiler et tester

```bash
npm run compile
npm test
```

Les tests (`test/SignalSubscription.test.js`) tournent entièrement en local
(réseau Hardhat éphémère) : ils copient un ERC20 factice à l'adresse USDT réelle
via `hardhat_setCode` pour simuler des paiements sans dépendre du mainnet, et
utilisent l'impersonation de compte pour agir en tant qu'OWNER.

## 4. Déployer

**Recommandé : tester d'abord sur Amoy (testnet gratuit)**

```bash
npm run deploy:amoy
```

**Déploiement réel sur Polygon Mainnet** (coûte du MATIC/POL, action irréversible) :

```bash
npm run deploy:polygon
```

Le script affiche l'adresse déployée et l'écrit dans `deployments/<network>.json`.

## 5. Après déploiement

**Ce contrat est actuellement dormant : le bot (`workers/main-worker`) tourne
en V2 100% off-chain (essais gratuits et abonnements gérés côté Supabase,
paiements USDT confirmés par polling d'événements `Transfer` plutôt que par
appel au contrat) et ne l'appelle plus.** Il n'y a donc rien à brancher côté
bot après un déploiement classique. Le répertoire `bot/` (Node.js) référencé
dans d'anciennes versions de ce document a été supprimé, remplacé par
`workers/main-worker`.

Si ce contrat était un jour réactivé :

1. L'adresse déployée irait dans le binding `CONTRACT_ADDRESS` de
   `workers/main-worker` (voir son README, `wrangler.toml` `[vars]`).
2. Tout secret associé (ex. clé d'un wallet appelant le contrat) se poserait
   avec `wrangler secret put <NOM>` depuis `workers/main-worker/`, jamais dans
   un fichier `.env` — ce worker ne lit pas de `.env` en production.
3. (Optionnel mais recommandé) Vérifie le contrat sur Polygonscan pour que le code
   source soit visible publiquement — renforce la confiance des abonnés :
   ```bash
   npx hardhat verify --network polygon <ADRESSE_DEPLOYEE>
   ```
   Nécessite `POLYGONSCAN_API_KEY` dans `.env` (clé gratuite sur polygonscan.com).

## 6. Interface du contrat

| Fonction | Description |
|---|---|
| `subscribe(uint8 plan)` | Souscrit au plan 1 (10 USDT/30j) ou 2 (25 USDT/30j). Nécessite un `USDT.approve(contrat, montant)` préalable. Prolonge l'abonnement en cours si déjà actif. |
| `isActive(address user)` | `true` si l'abonnement (ou essai) de `user` n'est pas expiré. |
| `setTrial(address user)` | Réservé à OWNER. Accorde 3 jours d'essai, une seule fois par adresse, sans jamais raccourcir un abonnement payant plus long. |
| `withdraw(uint256 amount)` | Réservé à OWNER. Retire les USDT collectés par le contrat. |
| `expirations(address)` | Mapping public : timestamp d'expiration par adresse. |
| `trialUsed(address)` | Mapping public : indique si l'adresse a déjà utilisé son essai. |

Évènements : `Subscribed(user, plan, amount, newExpiration)`, `TrialActivated(user, newExpiration)`, `Withdrawn(to, amount)` — c'est sur `Subscribed` que le bot Telegram s'abonne pour confirmer automatiquement les paiements USDT.

## 7. Notes de sécurité

- Le contrat n'a pas de fonction d'upgrade : toute modification nécessite un
  nouveau déploiement et une migration des abonnés (adresse de contrat différente
  à communiquer au bot). C'est un choix délibéré de simplicité pour un contrat de
  cette taille — pas de proxy, pas de surface d'attaque supplémentaire.
- `withdraw()` envoie toujours les fonds vers l'adresse OWNER fixe, jamais vers
  un destinataire arbitraire — même une clé OWNER compromise ne peut pas rediriger
  les fonds ailleurs que vers cette adresse.
- `setTrial()` ne peut être appelée que par le wallet OWNER exact (toute autre
  clé échoue avec `caller is not the owner`). Ceci dit, en V2 le bot
  (`workers/main-worker`) n'appelle plus `setTrial()` du tout — les essais
  gratuits sont gérés 100% côté Supabase (voir son README) — donc cette
  fonction n'est actuellement invoquée par aucun code en production.
