/**
 * Diffuse les signaux déjà envoyés aux abonnés vers le canal Telegram public
 * gratuit, avec un délai — c'est le canal "vitrine" qui sert à attirer des
 * membres vers l'abonnement payant (temps réel + VIP).
 *
 * Le délai (30 min) est volontairement supérieur à celui du palier
 * Standard/Découverte (15 min, voir cron/dispatchStandardTier.ts,
 * SNIPER_DELAY_MINUTES) : même les plans payants les moins chers gardent une
 * longueur d'avance sur le canal gratuit.
 */

import { Env, dbConfig } from "../env";
import { getSignalsDueForPublicChannel, markSentToChannel, SignalRecord } from "../db/signals";
import { sendMessage, sendPhoto } from "../telegram";
import { buildSignalMessage, buildCarryShortMessage, buildCarryDetailKeyboard, buildPublicTeaserMessage } from "../signalFormat";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow } from "../supabaseRest";
import { isQuietHours } from "../utils/quietHours";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";

const CHANNEL_DELAY_MINUTES = 30;

/**
 * Limite Telegram d'une legende de photo. Un message normal accepte 4096
 * caracteres, une legende seulement 1024 : c'est cet ecart qui faisait
 * disparaitre l'echantillon hebdomadaire.
 */
const LEGENDE_MAX = 1024;

/**
 * Le délai annoncé est CALCULÉ, pas écrit en dur (02/08/2026). Depuis
 * l'instauration des heures calmes, un signal détecté à 3 h du matin n'est
 * publié ici qu'après 7 h : annoncer « différé de 30 min » serait alors
 * faux de plusieurs heures, sur le canal même où l'on met en avant la
 * transparence. Un abonné qui compare l'horodatage à la mention aurait
 * raison de douter du reste.
 */
function formatDelayNote(signal: SignalRecord): string {
  const minutes = Math.max(
    CHANNEL_DELAY_MINUTES,
    Math.round((Date.now() - new Date(signal.created_at).getTime()) / 60000)
  );
  // PAS DE PARENTHÈSES ICI : l'appelant enveloppe déjà cette note dans les
  // siennes, ce qui produisait « (signal différé de 15 h (détecté cette nuit,
  // publié à la réouverture du canal)) » — deux niveaux imbriqués sur la ligne
  // de titre du signal. Un tiret porte la même information sans l'empiler.
  return minutes < 90
    ? `signal différé de ${minutes} min`
    : `signal différé de ${Math.round(minutes / 60)} h — détecté cette nuit, publié à la réouverture du canal`;
}

/**
 * UN signal complet par semaine sur le canal gratuit, niveaux compris.
 *
 * Sans lui, le canal public ne montrerait que des annonces sans niveaux et des
 * résultats passés. Un visiteur méfiant — et il a raison de l'être dans ce
 * secteur — peut soupçonner un relevé arrangé après coup. Un signal entier,
 * publié AVANT de connaître son issue, est la seule chose qui lève ce doute :
 * il est vérifiable en direct par n'importe qui.
 *
 * Un par semaine, pas plus : c'est assez pour prouver le mécanisme, trop peu
 * pour remplacer l'abonnement. Le premier signal de la semaine est choisi, pas
 * le meilleur — choisir le meilleur serait précisément le biais de sélection
 * qu'on prétend écarter.
 */
const JOB_ECHANTILLON = "signal_complet_public";

async function echantillonHebdoDu(db: ReturnType<typeof dbConfig>): Promise<boolean> {
  const dernier = await getHeartbeat(db, JOB_ECHANTILLON).catch(() => null);
  if (!dernier) return true;
  const jours = (Date.now() - new Date(dernier.last_run_at).getTime()) / 86_400_000;
  return jours >= 7;
}

function formatPublicChannelMessage(signal: SignalRecord, botUsername: string): string {
  return buildSignalMessage(signal, { delayNote: formatDelayNote(signal), ctaUsername: botUsername });
}

export async function dispatchPublicChannel(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getSignalsDueForPublicChannel(db, CHANNEL_DELAY_MINUTES);

  // Les carrys partent GROUPES, les signaux directionnels un par un.
  //
  // Un carry s'ouvre par lots : le moteur remplit ses places libres, ce qui
  // donne couramment deux ou trois positions le meme jour, et davantage au
  // demarrage. Publies separement, ils produisent une rafale de messages quasi
  // identiques — c'est exactement ce qui est arrive le 04/08/2026, quatre
  // messages a la meme minute repetant chacun les memes 1 200 caracteres
  // d'explication. Vu du canal, c'etait du spam.
  //
  // Les signaux directionnels, eux, restent individuels : chacun porte ses
  // propres niveaux d'entree, de stop et d'objectifs, et il n'y a rien a
  // factoriser entre eux.
  const carrys = due.filter((s) => s.type === "CARRY");
  const directionnels = due.filter((s) => s.type !== "CARRY");

  for (const signal of directionnels) {
    // Un signal n'est jamais retenu par le plafond quotidien (voir
    // channelBudget.ts) — mais il RESPECTE l'espacement, qui étale les rafales
    // sans en perdre aucune. Un signal reporté de vingt minutes reste jouable :
    // sa sortie est à trois jours au plus court.
    const verdict = await peutPublier(db, "public", "signal");
    if (!verdict.autorise) break;

    // Un seul signal complet par semaine (voir echantillonHebdoDu). Les autres
    // partent en annonce sans niveaux : c'est ce qui distingue le canal gratuit
    // de l'abonnement, et le relevé public reste entier puisque tout est
    // republié à la clôture.
    const complet = await echantillonHebdoDu(db);
    const text = complet
      ? `🎁 *Signal offert de la semaine — le format complet*\n\n${formatPublicChannelMessage(signal, env.TELEGRAM_BOT_USERNAME)}`
      : buildPublicTeaserMessage(signal, {
          botUsername: env.TELEGRAM_BOT_USERNAME,
          delayNote: formatDelayNote(signal),
        });

    try {
      // Le graphique n'accompagne QUE le signal complet : sur une annonce sans
      // niveaux, il donnerait à lire ce que le texte vient de réserver.
      //
      // UNE LÉGENDE TELEGRAM EST LIMITÉE À 1024 CARACTÈRES, un message à 4096.
      // Un signal complet en fait ~1400 : envoyé en légende de photo, il était
      // rejeté par un 400 « message caption is too long », attrapé plus bas et
      // journalisé — donc l'échantillon offert de la semaine, le poste le plus
      // précieux du canal gratuit, disparaissait EN SILENCE dès que le signal
      // portait un graphique. Les signaux sans graphique passaient par
      // sendMessage et sortaient normalement, ce qui rendait la panne
      // intermittente et donc invisible.
      //
      // On envoie alors la photo avec une légende courte, puis le texte entier
      // en message séparé : les deux arrivent, dans l'ordre, et rien n'est
      // tronqué.
      if (complet && signal.chart_url) {
        if (text.length <= LEGENDE_MAX) {
          await sendPhoto(env.TELEGRAM_BOT_TOKEN, channelId, signal.chart_url, { caption: text, markdown: true });
        } else {
          await sendPhoto(env.TELEGRAM_BOT_TOKEN, channelId, signal.chart_url, {
            caption: `📈 ${signal.pair} — le détail complet juste en dessous.`,
          });
          await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, text, { markdown: true });
        }
      } else {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, text, { markdown: true });
      }
      await markSentToChannel(db, signal.id);
      await enregistrerEnvoi(db, "public", "signal", `signal:${signal.id}`);
      if (complet) {
        await upsertRow(
          db,
          "system_heartbeats",
          { job_name: JOB_ECHANTILLON, last_run_at: new Date().toISOString() },
          "job_name"
        ).catch((err) => console.error("[public-channel] Marquage de l'échantillon hebdo impossible :", err));
      }
    } catch (err) {
      console.error(`[public-channel] Échec de diffusion pour le signal #${signal.id}:`, err);
    }
  }

  if (carrys.length > 0) {
    // Forme COURTE sur le canal public : quatre chiffres et un bouton. La forme
    // longue reste celle des abonnés (dispatchSignals) et de /carry — dans un
    // canal, le bloc pédagogique de 1 200 caractères répété à chaque lot se
    // lisait comme du spam, et c'en était.
    const verdictCarry = await peutPublier(db, "public", "signal");
    if (!verdictCarry.autorise) return;

    const text = buildCarryShortMessage(carrys, { delayNote: formatDelayNote(carrys[0]) });
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, text, {
        markdown: true,
        keyboard: buildCarryDetailKeyboard(env.TELEGRAM_BOT_USERNAME),
      });
      // Chaque carry du lot est marque individuellement : si l'envoi echoue,
      // aucun ne l'est et le lot entier repassera au cycle suivant, plutot que
      // de disparaitre a moitie.
      for (const signal of carrys) {
        await markSentToChannel(db, signal.id);
      }
      await enregistrerEnvoi(db, "public", "signal", `carrys:${carrys.length}`);
    } catch (err) {
      console.error(`[public-channel] Échec de diffusion du lot de ${carrys.length} carry(s):`, err);
    }
  }
}
