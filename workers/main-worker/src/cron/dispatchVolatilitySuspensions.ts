/**
 * Bloc 11.3 : relaie sur le canal public gratuit les suspensions de signal
 * décidées par signals/main.py (ATR intraday > VOLATILITY_SUSPENSION_ATR_PCT
 * du prix -- marché trop erratique pour que des stop/target fixés à l'avance
 * restent pertinents). Même pattern que dispatchMomentumAlerts.ts.
 */

import { Env, dbConfig } from "../env";
import { getUnsentVolatilitySuspensions, markVolatilitySuspensionSent, VolatilitySuspensionRecord } from "../db/volatilitySuspensions";
import { sendMessage } from "../telegram";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { isQuietHours } from "../utils/quietHours";

function formatSuspensionMessage(event: VolatilitySuspensionRecord): string {
  const pct = (event.atr_pct * 100).toFixed(1);
  return [
    `⏸️ *Signaux suspendus — ${event.pair}*`,
    `Volatilité anormale détectée (${pct}% du prix sur la dernière bougie) : par prudence, aucun signal n'est émis sur cette paire ce cycle.`,
  ].join("\n");
}

export async function dispatchVolatilitySuspensions(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getUnsentVolatilitySuspensions(db);

  // UN SEUL ÉVÉNEMENT PAR PASSAGE, ET SEULEMENT SI LE CANAL PEUT PARLER.
  //
  // Cette boucle envoyait autant de messages qu'il y avait d'événements en
  // attente, d'affilée, sans passer par le régulateur. Une secousse de marché
  // suspend plusieurs paires en même temps : cinq suspensions produisaient donc
  // cinq messages en quelques secondes sur le canal public. C'est précisément
  // la rafale que channelBudget existe pour empêcher.
  //
  // Le reste attend le cycle suivant : ces événements ne sont pas des signaux à
  // jouer, ils ne perdent rien à sortir quelques minutes plus tard. Ils ne sont
  // marqués comme envoyés qu'après un envoi réussi, donc rien n'est perdu.
  for (const event of due) {
    const verdict = await peutPublier(db, "public", "quotidien");
    if (!verdict.autorise) return;

    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatSuspensionMessage(event), { markdown: true });
      await markVolatilitySuspensionSent(db, event.id);
      await enregistrerEnvoi(db, "public", "quotidien", `suspension:${event.id}`);
    } catch (err) {
      console.error(`[volatility-suspensions] Échec de diffusion pour l'événement #${event.id}:`, err);
    }
    return;
  }
}
