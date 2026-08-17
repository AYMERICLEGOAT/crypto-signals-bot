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
import { sendMessage, sendPhotoWithText } from "../telegram";
import { buildSignalMessage, buildCarryShortMessage, buildCarryDetailKeyboard, buildPublicTeaserMessage } from "../signalFormat";
import { getReleveMoteur } from "../db/releveMoteur";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow } from "../supabaseRest";
import { isQuietHours, QUIET_START_UTC, QUIET_END_UTC } from "../utils/quietHours";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";

const CHANNEL_DELAY_MINUTES = 30;

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
  // « DÉTECTÉ CETTE NUIT » ÉTAIT VRAI, ET NE L'EST PLUS.
  //
  // Cette phrase partait dès que le report dépassait 90 minutes. Elle avait du
  // sens quand les signaux naissaient à 3 h du matin (RS_RUN_HOUR_UTC valait
  // 1). Le passage quotidien a été déplacé à 8 h UTC le 14/08 : le 17/08, le
  // canal public a donc annoncé « signal différé de 2 h — détecté cette nuit »
  // pour APT/USDT, détecté à 10 h 56 du MATIN.
  //
  // Un report de deux heures n'est pas une nuit : c'est l'espacement entre
  // deux publications. La note lit maintenant l'heure RÉELLE de détection au
  // lieu de la déduire d'une durée — un signal né pendant les heures calmes le
  // dira, les autres diront simplement leur retard.
  const heureDetection = new Date(signal.created_at).getUTCHours();
  const detecteLaNuit = heureDetection >= QUIET_START_UTC || heureDetection < QUIET_END_UTC;

  if (minutes < 90) return `signal différé de ${minutes} min`;
  const heures = Math.round(minutes / 60);
  return detecteLaNuit
    ? `signal différé de ${heures} h — détecté cette nuit, publié à la réouverture du canal`
    : `signal différé de ${heures} h`;
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

/**
 * LE CANAL GRATUIT VOYAIT LA PROMESSE SANS LE RELEVÉ.
 *
 * L'échantillon hebdomadaire publie le signal COMPLET, y compris la ligne
 * « Momentum 4H — +1,86 % par signal ». Le message envoyé à l'abonné porte en
 * plus le relevé réel du moteur depuis sa mise en service — le 17/08/2026,
 * « -0,39 % sur 16 clôtures ». Le canal public, lui, ne recevait que le premier
 * des deux.
 *
 * C'est exactement l'inverse de ce qu'il faut : la surface d'ACQUISITION est
 * celle où un chiffre flatteur non contredit fait le plus de dégâts, parce que
 * c'est là que quelqu'un décide de payer. L'abonné, lui, a déjà payé.
 *
 * Le relevé est donc lu et transmis ici aussi. Une lecture par publication
 * hebdomadaire : le coût est négligeable et la cohérence, totale.
 */
async function formatPublicChannelMessage(
  db: ReturnType<typeof dbConfig>,
  signal: SignalRecord,
  botUsername: string
): Promise<string> {
  const releveReel = signal.engine === "momentum_4h" ? await getReleveMoteur(db, "momentum_4h") : null;
  return buildSignalMessage(signal, {
    delayNote: formatDelayNote(signal),
    ctaUsername: botUsername,
    releveReel,
  });
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
      ? `🎁 *Signal offert de la semaine — le format complet*\n\n${await formatPublicChannelMessage(db, signal, env.TELEGRAM_BOT_USERNAME)}`
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
        await sendPhotoWithText(env.TELEGRAM_BOT_TOKEN, channelId, signal.chart_url, text, {
          markdown: true,
          legendeCourte: `📈 ${signal.pair} — le détail complet juste en dessous.`,
        });
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
