import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersExpiredSince, markReengagementSent } from "../db/users";
import { getSignalsResolvedSince } from "../db/signals";
import { SignalRecord } from "../db/signals";

const DAYS_AFTER_EXPIRATION = 3;
// Bloc 9 : RELANCE50 remplace RELANCE20 — un seul code de rétention fort,
// partagé avec /cancel (Bloc 7) plutôt que deux offres différentes pour un
// même objectif ("revenir/rester"). RELANCE20 est désactivé côté promo_codes.
const PROMO_CODE = "RELANCE50";

/** Fenêtre du récapitulatif : couvre l'expiration (J-3) plus quelques jours avant. */
const RECAP_LOOKBACK_DAYS = 10;

function pctChange(signal: SignalRecord): number | null {
  const entry = Number(signal.entry_price);
  const exit = Number(signal.outcome_price);
  if (!entry || !exit) return null;
  return signal.type === "BUY" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
}

/**
 * Récapitulatif HONNÊTE de ce qui s'est passé depuis le départ de
 * l'utilisateur : les signaux réellement clôturés, gagnants ET perdants.
 *
 * Motif (audit du 01/08/2026) : l'ancienne relance disait seulement
 * « ça fait quelques jours qu'on ne t'a plus envoyé de signaux, reviens
 * avec -50% ». Aucune raison concrète de revenir, aucune preuve, rien qui
 * distingue ce message des dizaines de relances promotionnelles que tout le
 * monde ignore. Montrer ce qui s'est réellement produit est à la fois plus
 * convaincant et cohérent avec la promesse de transparence du service.
 *
 * Les pertes sont incluses délibérément. Un récapitulatif qui ne montrerait
 * que les gains serait de la communication déguisée en preuve — exactement
 * ce que ce projet reproche aux autres services de signaux.
 */
function buildRecap(signals: SignalRecord[]): string | null {
  const closed = signals.filter((s) => s.outcome && s.outcome_price);
  if (closed.length === 0) return null;

  const lines = closed.slice(0, 5).map((s) => {
    const pct = pctChange(s);
    const pctText = pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
    const icon = s.outcome === "WIN" ? "✅" : s.outcome === "LOSS" ? "❌" : "⌛";
    return `${icon} ${s.pair} ${s.type === "BUY" ? "achat" : "vente"}${pctText}`;
  });

  const wins = closed.filter((s) => s.outcome === "WIN").length;
  const losses = closed.filter((s) => s.outcome === "LOSS").length;
  const more = closed.length > 5 ? `\n… et ${closed.length - 5} autre(s).` : "";

  return (
    `Voilà ce qui s'est clôturé depuis :\n\n${lines.join("\n")}${more}\n\n` +
    `Bilan sur la période : ${wins} gagnant(s), ${losses} perdant(s). ` +
    "On publie les deux, toujours."
  );
}

/**
 * 3 jours après expiration, propose le code RELANCE50 (-50%, voir
 * promo_codes) pour inciter au réabonnement. Greffé sur le cron existant :
 * le gate vient de reengagement_sent (jamais renvoyé deux fois), remis à
 * zéro par activateSubscription() si l'utilisateur se réabonne.
 */
export async function sendReengagementOffers(env: Env): Promise<void> {
  const db = dbConfig(env);
  const expiredUsers = await getUsersExpiredSince(db, DAYS_AFTER_EXPIRATION);
  if (expiredUsers.length === 0) return;

  // Une seule lecture pour tous les destinataires (le récapitulatif est le
  // même pour tout le monde), plutôt qu'une requête par utilisateur.
  const since = new Date(Date.now() - RECAP_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  let recap: string | null = null;
  try {
    recap = buildRecap(await getSignalsResolvedSince(db, since));
  } catch (err) {
    // Le récapitulatif est un bonus : son échec ne doit pas empêcher la
    // relance elle-même de partir.
    console.error("[reengagement] Récapitulatif indisponible, relance envoyée sans:", err);
  }

  for (const user of expiredUsers) {
    const body = recap
      ? `👋 Ton accès s'est terminé il y a quelques jours.\n\n${recap}\n\n`
      : "👋 Ça fait quelques jours qu'on ne t'a plus envoyé de signaux.\n\n";

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      user.telegram_id,
      body +
        `Si tu veux reprendre : *-50%* avec le code \`${PROMO_CODE}\`\n\n` +
        `1️⃣ Envoie /code ${PROMO_CODE}\n` +
        "2️⃣ Puis /subscribe\n\n" +
        "_Sans prélèvement automatique — ça s'arrête tout seul à échéance._",
      { markdown: true }
    );
    await markReengagementSent(db, user.telegram_id);
  }
}
