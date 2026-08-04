import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { buildCarryExplanation } from "../../signalFormat";

/**
 * /carry — l'explication complète du carry de financement.
 *
 * Pourquoi cette commande existe. L'explication faisait auparavant partie de
 * CHAQUE signal de carry. Quatre positions ouvertes la même minute, c'étaient
 * donc quatre fois les mêmes 1 200 caractères : vu du canal, ça ressemblait à
 * du spam, et c'en était. Le signal ne porte plus que ce qui lui est propre —
 * la paire, le prix, le rendement, l'échéance — et renvoie ici pour le reste.
 *
 * Ce texte va plus loin que le bloc envoyé avec les signaux : il répond aux
 * questions concrètes qu'un débutant se pose avant d'ouvrir sa première
 * position à deux jambes, et que personne ne peut deviner seul.
 *
 * Envoyé en Markdown legacy, comme buildCarryExplanation. Aucun tiret bas nu
 * dans le texte : un seul casserait le message entier côté Telegram.
 */
export async function handleCarryCommand(env: Env, telegramId: number): Promise<void> {
  const message = [
    buildCarryExplanation(),
    "",
    "━━━━━━━━━━━━━━━",
    "",
    "*Concrètement, comment j'ouvre une position ?*",
    "",
    "1. Sur ta plateforme, achète le montant indiqué au comptant. Par exemple 100 € de la crypto.",
    "2. Sur la partie « futures » ou « perpétuels » de la même plateforme, ouvre une vente à découvert du MÊME montant sur la MÊME crypto.",
    "3. Ne mets pas de levier au-delà de 1x sur la jambe vendeuse. Le levier n'augmente pas le rendement du carry, il augmente seulement le risque de liquidation.",
    "4. Au bout des 21 jours, ferme les deux en même temps.",
    "",
    "*Pourquoi le rendement est annoncé par an ?*",
    "",
    "Parce que c'est la seule unité qui permet de comparer. Une position rapporte typiquement entre 0,4 et 1 % sur ses 21 jours — dit comme ça, ça paraît dérisoire. Ramené à l'année, ça donne entre 7 et 19 %, sans exposition à la direction du prix. Les deux chiffres sont vrais, et les deux sont affichés dans chaque signal.",
    "",
    "*Quel montant y mettre ?*",
    "",
    "C'est toi qui décides, et nous ne donnons aucun conseil personnalisé. Une seule remarque technique : garde toujours de la marge disponible sur la jambe vendeuse. Si le prix monte fortement, cette jambe est en perte — compensée par ta position au comptant, mais la plateforme peut la liquider avant que tu aies eu le temps de réagir. C'est le principal risque réel de cette stratégie.",
    "",
    "*Et si le financement s'inverse ?*",
    "",
    "Ça arrive : lors d'un mouvement violent, ce sont les vendeurs qui paient. Nous surveillons chaque position, et si le financement cumulé descend sous un seuil, tu reçois un message pour fermer avant l'échéance. Sur 6 ans, ça concerne 1,7 % des positions.",
    "",
    "*Ce que ça ne fait pas.*",
    "",
    "Ça ne te rend pas riche vite. C'est un rendement régulier et modeste, pris avec peu de risque directionnel. Si tu cherches à doubler ton capital, ce n'est pas le bon outil — et les autres familles de signaux ne le sont pas davantage.",
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, message, { markdown: true });
}
