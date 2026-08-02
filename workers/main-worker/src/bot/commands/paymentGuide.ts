import { Env } from "../../env";
import { sendMessage } from "../../telegram";

/**
 * Guide de paiement détaillé (/guide_paiement, ou bouton depuis /subscribe).
 *
 * Raison d'être : la table pending_payments est VIDE depuis le début du
 * projet — pas un seul paiement tenté. Le tunnel se réduisait à « Choisis
 * ton moyen de paiement » face à trois cryptomonnaies. Pour un public
 * francophone dont une partie n'a jamais fait de transaction crypto, ce
 * n'est pas un choix, c'est un mur.
 *
 * Ce guide décrit le parcours réel, plateforme par plateforme, avec les
 * pièges concrets qui font échouer un premier paiement crypto : le mauvais
 * réseau (l'erreur la plus fréquente et la plus coûteuse, les fonds sont
 * perdus), le montant net après frais de retrait, et le délai de
 * confirmation.
 *
 * Envoyé SANS markdown : le texte contient des parenthèses, des tirets, des
 * signes ~ et des slashs de commandes — autant de caractères qui ont déjà
 * fait tomber des messages Markdown sur ce projet. Le gain de mise en forme
 * ne vaut pas le risque d'un message non délivré.
 */
export async function handlePaymentGuideCommand(env: Env, telegramId: number): Promise<void> {
  const text = [
    "💳 GUIDE DE PAIEMENT COMPLET",
    "",
    "▸ EN 3 ÉTAPES",
    "",
    "1. Tu choisis ta cryptomonnaie dans /subscribe",
    "2. Je te donne une adresse et le montant exact à envoyer",
    "3. Tu envoies depuis ton exchange ou ton wallet",
    "",
    "Ton accès s'active tout seul en 2 à 5 minutes après confirmation.",
    "Aucune action de ta part, aucun justificatif à envoyer.",
    "",
    "──────────────",
    "",
    "▸ LE PLUS SIMPLE : USDT SUR POLYGON",
    "",
    "Frais de réseau : environ 0,01 $. C'est le moins cher et le plus rapide.",
    "Disponible sur Binance, Coinbase, Kraken, Bybit, OKX, Crypto.com…",
    "",
    "Depuis un exchange :",
    "  1. Achète des USDT (ou utilise ceux que tu as)",
    "  2. Va dans « Retirer » / « Withdraw »",
    "  3. Choisis USDT",
    "  4. ⚠️ RÉSEAU : sélectionne « Polygon » (parfois écrit MATIC ou POL)",
    "  5. Colle l'adresse que je t'aurai donnée",
    "  6. Montant : celui que je t'indique, exactement",
    "",
    "⚠️ L'ERREUR À NE PAS FAIRE",
    "Envoyer sur le mauvais réseau (Ethereum, BSC, Tron…) au lieu de Polygon.",
    "Les fonds sont alors perdus, et personne ne peut les récupérer — ni moi,",
    "ni ton exchange. Vérifie ce champ deux fois avant de valider.",
    "",
    "⚠️ ATTENTION AUX FRAIS DE RETRAIT",
    "Certains exchanges prélèvent des frais SUR le montant envoyé. Si tu",
    "demandes un retrait de 19 USDT, il peut n'en arriver que 18. Vérifie le",
    "montant NET affiché avant de confirmer, et ajuste si besoin.",
    "",
    "──────────────",
    "",
    "▸ LES AUTRES OPTIONS",
    "",
    "Litecoin (LTC) — frais faibles, confirmation en quelques minutes.",
    "Je te fournis une adresse dédiée, rien d'autre à faire.",
    "",
    "Monero (XMR) — pour ceux qui privilégient la confidentialité.",
    "Confirmation plus lente (10 confirmations requises, ~20 minutes).",
    "",
    "──────────────",
    "",
    "▸ CE QUI EST GARANTI",
    "",
    "✅ Aucun prélèvement automatique. L'abonnement s'arrête tout seul à",
    "   échéance : il n'y a rien à résilier, jamais.",
    "✅ Aucune donnée bancaire demandée (nous n'en recevons aucune).",
    "✅ Tu peux vérifier l'état de ton paiement à tout moment avec",
    "   /check_payment",
    "",
    "▸ PAS ENCORE DISPONIBLE",
    "",
    "❌ Carte bancaire, PayPal, virement. C'est une limite réelle du service",
    "   aujourd'hui, et nous préférons l'annoncer ici plutôt que te le faire",
    "   découvrir au moment de payer.",
    "",
    "──────────────",
    "",
    "Un problème pendant le paiement ? Réponds simplement à ce message,",
    "l'administrateur le verra. Et /check_payment te donne à tout moment",
    "l'état exact de ta transaction.",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, text);
}
