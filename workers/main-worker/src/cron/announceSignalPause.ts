import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { selectRows, updateRows } from "../supabaseRest";
import { isQuietHours } from "../utils/quietHours";

interface SignalPauseRow {
  id: number;
  paused_at: string;
  resumes_at: string;
  reason: string;
  announced: boolean;
}

/**
 * Poste dans le canal public l'avertissement de pause anti-corrélation
 * (voir signals/correlation_guard.py), une seule fois par pause déclenchée
 * (gate via announced=false).
 */
export async function announceSignalPause(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  const rows = await selectRows<SignalPauseRow>(db, "signal_pause", {
    announced: "eq.false",
    order: "paused_at.desc",
    limit: "1",
  });
  const pause = rows[0];
  if (!pause) return;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.TELEGRAM_CHANNEL_ID),
    "⚠️ *Pause de sécurité — mouvement de marché corrélé détecté*\n\n" +
      "Plusieurs paires ont signalé la même direction en très peu de temps — un signe de mouvement de " +
      "marché systémique (tout corrélé), pas un avantage de la stratégie. Par précaution, la génération " +
      "de nouveaux signaux est suspendue pour 24h.\n\n" +
      "Ceci n'est pas un dysfonctionnement : c'est un garde-fou volontaire pour éviter de multiplier les " +
      "signaux dans un contexte de marché peu fiable statistiquement.",
    { markdown: true }
  );

  await updateRows(db, "signal_pause", { id: `eq.${pause.id}` }, { announced: true });
}
