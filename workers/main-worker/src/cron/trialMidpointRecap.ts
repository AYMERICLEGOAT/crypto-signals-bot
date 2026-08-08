/**
 * Le point de mi-essai : montrer ce qui a RÉELLEMENT été reçu.
 *
 * CE QU'IL REMPLACE. Vingt-quatre heures après l'inscription, la séquence de
 * bienvenue envoyait : « Ça fait un jour que tu as rejoint le bot. Une question
 * sur le fonctionnement ? /help est toujours là. » C'est le message le plus
 * faible du produit, au moment le plus important : à mi-essai, quelqu'un décide
 * s'il va payer, et on lui parlait de documentation.
 *
 * Ce que ce module envoie à la place dépend de ce qui s'est passé, et il y a
 * DEUX cas — le second étant le plus probable.
 *
 *   1. DES SIGNAUX ONT ÉTÉ REÇUS. On les liste, avec leur état réel. C'est de
 *      la réciprocité au sens strict : on ne promet rien, on rappelle ce qui a
 *      déjà été donné. Les perdants sont montrés aussi ; les cacher ici, alors
 *      que la personne les a vus arriver, détruirait la seule chose que ce
 *      produit vend.
 *
 *   2. AUCUN SIGNAL N'A ÉTÉ REÇU. C'est parfaitement possible : le filtre de
 *      tendance est fermé 41 % du temps, et trois jours peuvent tomber dans un
 *      creux. Le taire serait pire que tout — la personne l'a remarqué, et un
 *      message enthousiaste qui l'ignore confirme qu'on ne la lit pas. On dit
 *      donc pourquoi, avec le chiffre, et on prolonge l'essai de trois jours.
 *
 * LA PROLONGATION N'EST PAS UNE ASTUCE COMMERCIALE. Un essai de trois jours qui
 * tombe dans un silence de marché n'a rien démontré, ni dans un sens ni dans
 * l'autre : facturer ensuite quelqu'un sur cette base reviendrait à lui vendre
 * un produit qu'il n'a pas pu juger. Trois jours de plus lui donnent une chance
 * de voir quelque chose ; s'il ne voit toujours rien, il aura appris ce qu'est
 * réellement ce service, et c'est une information honnête.
 */

import { Env, dbConfig } from "../env";
import { sendMessage, InlineKeyboard } from "../telegram";
import { selectRows, updateRows } from "../supabaseRest";
import { getUserSignalHistory } from "../db/history";
import { activateSubscription } from "../db/users";
import { getTrendFilterState } from "../market/trendFilter";
import { addDays } from "../utils/date";
import { computePnlPct } from "../signalMath";
import { PART_FILTRE_FERME } from "../publishedStats";

/** Heures écoulées depuis le début de l'essai avant d'envoyer le point. */
const HEURES_AVANT_RECAP = 24;

/** Jours offerts quand l'essai n'a rien pu montrer. Voir l'en-tête. */
const JOURS_PROLONGATION = 3;

const MAX_PAR_PASSAGE = 20;

interface Essai {
  telegram_id: number;
  expiration: string | null;
  plan: number | null;
}

export async function sendTrialMidpointRecap(env: Env): Promise<void> {
  const db = dbConfig(env);

  // Les essais actifs dont le point n'a pas encore été envoyé. Le plan 0 est
  // l'essai gratuit ; on ne touche à aucun abonné payant.
  let essais: Essai[];
  try {
    essais = await selectRows<Essai>(db, "users", {
      plan: "eq.0",
      trial_recap_sent: "eq.false",
      cancelled: "eq.false",
      expiration: `gt.${new Date().toISOString()}`,
      select: "telegram_id,expiration,plan",
      limit: String(MAX_PAR_PASSAGE),
    });
  } catch (err) {
    console.error("[essai] Lecture des essais en cours impossible :", err);
    return;
  }

  for (const essai of essais) {
    if (!essai.expiration) continue;

    // L'essai dure 3 jours : le point se fait quand il en reste moins de deux.
    // Calculer depuis l'expiration plutôt que depuis un champ de début évite
    // d'ajouter une colonne pour une information déjà présente.
    const heuresRestantes = (new Date(essai.expiration).getTime() - Date.now()) / 3_600_000;
    if (heuresRestantes > 72 - HEURES_AVANT_RECAP) continue;

    const recus = await getUserSignalHistory(db, essai.telegram_id, 10).catch(() => []);
    const signaux = recus.map((d) => d.signals).filter(Boolean);

    const texte = signaux.length > 0
      ? construireAvecSignaux(signaux)
      : await construireSansSignal(env, db, essai);

    const clavier: InlineKeyboard = [
      [{ text: "⭐ Mensuel — 19 USDT / 30 j", callback_data: "plan:1" }],
      [{ text: "🎯 Trimestriel — 45 USDT / 90 j", callback_data: "plan:2" }],
    ];

    await sendMessage(env.TELEGRAM_BOT_TOKEN, essai.telegram_id, texte, {
      markdown: true,
      keyboard: signaux.length > 0 ? clavier : undefined,
    }).catch((err) => console.error(`[essai] Envoi impossible à ${essai.telegram_id}:`, err));

    await updateRows(db, "users", { telegram_id: `eq.${essai.telegram_id}` }, { trial_recap_sent: true }).catch((err) =>
      console.error(`[essai] Marquage impossible pour ${essai.telegram_id}:`, err)
    );
  }
}

function construireAvecSignaux(signaux: any[]): string {
  const lignes = signaux.slice(0, 6).map((s) => {
    const ouvert = s.outcome === null;
    if (ouvert) return `⏳ ${s.pair} — en cours`;
    const pct = s.outcome_price ? computePnlPct(s.type, Number(s.entry_price), Number(s.outcome_price)) : null;
    const icone = s.outcome === "WIN" ? "✅" : "❌";
    const chiffre = pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)} %)`;
    return `${icone} ${s.pair}${chiffre}`;
  });

  const ouverts = signaux.filter((s) => s.outcome === null).length;
  const clotures = signaux.length - ouverts;

  return [
    `📬 *Ton essai, à mi-parcours*\n`,
    `Tu as reçu ${signaux.length} signal(aux) depuis hier :`,
    "",
    ...lignes,
    "",
    clotures > 0
      ? "_Les perdants sont là aussi : c'est le produit tel qu'il est. La rentabilité vient d'une " +
        "minorité de gros gagnants, ce qui suppose de les prendre tous._"
      : "_Aucun n'est encore clôturé : la sortie est temporelle, entre 3 et 21 jours selon le moteur._",
    "",
    ouverts > 0
      ? `⚠️ ${ouverts} position(s) sont encore ouvertes. À la fin de ton essai, tu cesseras d'en recevoir le suivi — ` +
        "y compris les messages de clôture."
      : "",
    "Il te reste environ 48 h d'essai. Ensuite, l'accès s'arrête tout seul.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Le cas le plus probable, et celui qu'il ne faut surtout pas maquiller.
 */
async function construireSansSignal(env: Env, db: ReturnType<typeof dbConfig>, essai: Essai): Promise<string> {
  const trend = await getTrendFilterState().catch(() => null);

  // Prolongation immédiate : un essai qui n'a rien montré n'a rien prouvé, et
  // facturer sur cette base reviendrait à vendre un produit que la personne
  // n'a pas pu juger.
  const nouvelleFin = addDays(new Date(essai.expiration as string), JOURS_PROLONGATION);
  await activateSubscription(db, essai.telegram_id, 0, nouvelleFin).catch((err) =>
    console.error(`[essai] Prolongation impossible pour ${essai.telegram_id}:`, err)
  );
  // activateSubscription remet trial_recap_sent à false — il est conçu pour une
  // NOUVELLE période. Ici, l'essai est seulement prolongé : sans cette remise à
  // true, le point de mi-parcours repartirait à chaque passage du cron, et la
  // prolongation avec lui. C'est le seul appelant pour lequel la remise à zéro
  // est nuisible, d'où la correction ici plutôt que dans activateSubscription.
  await updateRows(db, "users", { telegram_id: `eq.${essai.telegram_id}` }, { trial_recap_sent: true }).catch(
    (err) => console.error(`[essai] Verrou du récapitulatif impossible pour ${essai.telegram_id}:`, err)
  );

  const raison =
    trend?.isClosed === true
      ? `Le Bitcoin est actuellement ${Math.abs(trend.gapPct).toFixed(1).replace(".", ",")} % sous sa moyenne 200 jours. ` +
        "Les trois moteurs directionnels sont donc à l'arrêt — c'est la règle, pas une panne."
      : "Les moteurs n'ont trouvé aucune configuration qui remplisse leurs conditions. Ça arrive.";

  return [
    "🤔 *Ton essai, à mi-parcours — et tu n'as rien reçu*",
    "",
    "Autant le dire franchement plutôt que d'attendre que tu le remarques.",
    "",
    raison,
    "",
    `Sur six ans, ce silence occupe ${PART_FILTRE_FERME} du temps, avec un record de 381 jours d'affilée. C'est ce qui ` +
      "évite les années à -70 % : sans cette règle, la stratégie n'est positive que 4 années sur 7 ; avec " +
      "elle, aucune année perdante sur 6.",
    "",
    `🎁 *Ton essai est prolongé de ${JOURS_PROLONGATION} jours*, automatiquement, jusqu'au ` +
      `${nouvelleFin.toLocaleDateString("fr-FR")}.`,
    "",
    "Trois jours dans un creux ne démontrent rien, ni dans un sens ni dans l'autre — te faire payer " +
      "sur cette base n'aurait aucun sens. Rien à faire de ton côté.",
    "",
    "En attendant : /marche recalcule l'état du marché en direct, et /demo montre la forme exacte des signaux.",
  ].join("\n");
}
