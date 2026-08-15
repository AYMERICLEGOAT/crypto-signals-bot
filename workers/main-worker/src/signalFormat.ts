/**
 * UX — format de signal unifié (contexte simple, risque conseillé 2%, émojis).
 * Utilisé par cron/dispatchSignals.ts, cron/dispatchStandardTier.ts,
 * cron/dispatchPublicChannel.ts et bot/commands/demo.ts : un seul endroit à
 * faire évoluer, plutôt que 4 copies qui divergent avec le temps.
 *
 * Le trailing stop (voir signalMath.ts::computeTrailingStop) est purement
 * indicatif et n'apparaît que pour les destinataires ayant activé la
 * préférence (paramètre `trailingEnabled`) — jamais sur le canal public, qui
 * n'a pas de destinataire individuel à qui s'adresser.
 */

import { SignalSide } from "./signalMath";
import { InlineKeyboard } from "./telegram";
import { MOMENTUM_4H } from "./publishedStats";

export const SUGGESTED_RISK_PCT = 2;

/** Le relevé réel d'un moteur, injecté par l'appelant (voir db/releveMoteur.ts). */
export interface ReleveReel {
  clotures: number;
  moyennePct: number;
  gagnants: number;
}

export interface SignalLike {
  type: SignalSide;
  pair: string;
  entry_price: number;
  // Nuls uniquement pour un CARRY, qui n'a ni stop ni objectif (voir
  // buildCarryMessage). Tous les moteurs directionnels les renseignent.
  stop_loss: number | null;
  take_profit: number | null;
  created_at: string;
  confidence_score?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp3_price?: number | null;
  /** Moteur d'origine (voir signals/squeeze_engine.py) -- absent ou "high_confidence" pour les signaux du moteur historique EMA/RSI 1h. */
  engine?: string | null;
  /** Carry uniquement : financement net attendu sur la durée de détention, frais déduits. */
  carry_expected_pct?: number | null;
  /**
   * Date de clôture prévue. La sortie est TEMPORELLE : elle survient à cette
   * date même si ni l'objectif ni le stop n'ont été touchés. Renseignée par le
   * carry (21 jours), la force relative (7 jours) et le momentum 4 h (3 jours)
   * — chacun avec la durée sur laquelle il a été validé.
   */
  hold_until?: string | null;
}

export const ENGINE_BADGE: Record<string, string> = {
  // « 🎯 Haute Confiance » désignait l'ancien moteur EMA/RSI, désactivé le
  // 03/08/2026 après avoir été mesuré comme la jambe PERDANTE de la stratégie.
  // Dix signaux portent encore cette valeur en base (26/07 – 03/08). Réafficher
  // « Haute Confiance » à leur sujet, dans /history par exemple, reviendrait à
  // republier aujourd'hui une affirmation de qualité sur le moteur que ce
  // projet a lui-même désavoué.
  high_confidence: "📕 Moteur retiré",
  squeeze_15m: "⚡ Squeeze 15M",
  relative_strength: "📈 Force Relative",
  carry_funding: "💵 Carry de Financement",
  // « (en observation) » retiré du TITRE, pas du message : buildObservationLine
  // publie trois lignes plus bas la mesure complète, réserve comprise. Le
  // qualificatif collé au nom transformait chaque signal en mise en garde avant
  // que le lecteur ait vu un seul chiffre — alors que ce moteur rend neuf fois
  // le carry par jour de capital.
  momentum_4h: "🧪 Momentum 4H",
  faiblesse_4h: "🔻 Faiblesse 4H",
  cassure_canal: "🚀 Cassure de Canal",
  expansion_volatilite: "🌋 Expansion de Volatilité",
};

/**
 * Le repli est NEUTRE, et ça compte.
 *
 * Il renvoyait « 🎯 Haute Confiance » pour tout moteur absent de la table. Ce
 * n'est pas un repli : c'est une affirmation de qualité, apposée précisément
 * sur le signal dont on ne sait rien. La cassure de canal et l'expansion de
 * volatilité ont été branchées APRÈS ce formatage — pendant l'intervalle,
 * n'importe quel moteur nouveau aurait été publié comme « haute confiance »
 * sans que personne l'ait décidé, et sans que rien ne casse.
 */
const BADGE_INCONNU = "📊 Signal";

function engineBadge(engine?: string | null): string {
  // Un signal sans moteur est le cas « on ne sait pas » par excellence : il
  // reçoit donc le badge neutre, comme un moteur inconnu.
  return ENGINE_BADGE[engine ?? ""] ?? BADGE_INCONNU;
}

/**
 * Pourcentage au format francais : virgule decimale et espace insecable avant
 * le signe, comme partout ailleurs dans les textes du produit.
 *
 * Ecrit auparavant a l'anglaise ("+15.8%"), ce qui donnait des messages ou
 * "+15.8%" et "84,2 %" se cotoyaient a deux lignes d'ecart. Un detail, mais
 * exactement le genre de detail qui fait amateur sur une page de vente.
 */
function pct(value: number): string {
  const signe = value >= 0 ? "+" : "";
  return `${signe}${value.toFixed(1).replace(".", ",")} %`;
}

/**
 * Un PRIX, arrondi à ce qu'un humain peut réellement saisir.
 *
 * Les niveaux affichés sortaient en flottant brut : sur ICP/USDT, un actif à
 * 2,20 $, le canal a publié « Stop-Loss : 2.06437058 » et « TP1 :
 * 2.33562942 ». Personne ne passe un ordre à huit décimales. Sur un produit
 * dont l'argument central est la rigueur de la mesure, c'est le détail qui le
 * fait passer pour amateur — et il touche la ligne la plus lue du message.
 *
 * La précision suit l'ordre de grandeur, parce que l'univers va du BTC à
 * 65 000 $ au HMSTR à 0,0001977 $ : deux décimales fixes rendraient le second
 * illisible, huit rendent le premier ridicule.
 *
 * LE POINT DÉCIMAL EST CONSERVÉ, contrairement aux pourcentages qui utilisent
 * la virgule française partout ailleurs. Ces nombres sont faits pour être
 * recopiés dans une plateforme d'échange, qui attend un point : une virgule
 * obligerait à convertir à la main, au moment précis où une erreur de saisie
 * coûte de l'argent.
 */
export function prix(valeur: number | string): string {
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return String(valeur);
  const abs = Math.abs(n);
  const decimales = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  const texte = n.toFixed(decimales);
  // Retrait des zéros inutiles, uniquement s'il y a une partie décimale :
  // sans ce garde-fou, "100" deviendrait "1".
  return texte.includes(".") ? texte.replace(/0+$/, "").replace(/\.$/, "") : texte;
}

/** Libellé FR pour un côté de signal — à utiliser partout au lieu du "BUY"/"SELL" brut, qui fuitait en anglais dans plusieurs messages de suivi. */
export function typeLabel(type: SignalSide): string {
  if (type === "CARRY") return "CARRY";
  return type === "BUY" ? "ACHAT" : "VENTE";
}

function buildContext(type: SignalSide, engine?: string | null): string {
  const arrow = type === "BUY" ? "📈" : "📉";
  const direction = type === "BUY" ? "haussière" : "baissière";
  if (engine === "squeeze_15m") {
    return `${arrow} Signal Squeeze 15M : cassure ${direction} après une phase de compression de volatilité, confirmée par le volume.`;
  }
  // La force relative n'a rien d'un croisement d'indicateurs : elle achète les
  // cryptos les plus fortes du moment, mesurées les unes CONTRE les autres. Le
  // message décrivait l'ancien moteur EMA/RSI, ce qui ne correspondait plus à
  // ce que l'abonné recevait réellement.
  if (engine === "relative_strength") {
    return `${arrow} Force Relative : cette crypto fait partie des plus fortes du marché en ce moment, comparée à toutes les autres. La stratégie mise sur la continuation de cette avance.`;
  }
  if (engine === "momentum_4h") {
    return `${arrow} Momentum 4H : même principe, mesuré sur des bougies de 4 heures. Ce moteur ne se déclenche QUE quand le marché est baissier — le créneau où les autres se taisent.`;
  }
  if (engine === "faiblesse_4h") {
    return (
      "🔻 Faiblesse 4H : le miroir du momentum. Là où celui-ci achète les plus fortes, celui-ci VEND À DÉCOUVERT " +
      "les deux plus faibles du classement. Il ne travaille que quand le marché baisse — c'est le seul moteur du " +
      "produit qui a la tendance du marché POUR lui au lieu de contre lui."
    );
  }
  if (engine === "cassure_canal") {
    return `${arrow} Cassure de Canal : le prix vient de franchir son plus haut des 50 derniers jours. On n'anticipe pas la cassure, on attend qu'elle ait eu lieu — c'est toute la différence.`;
  }
  if (engine === "expansion_volatilite") {
    return `${arrow} Expansion de Volatilité : après une longue phase de calme, l'amplitude des mouvements se réveille à la hausse. C'est le plus rare des signaux du système.`;
  }
  // LE REPLI NE DÉCRIT PLUS UNE STRATÉGIE QUE LE PROJET A MESURÉE PERDANTE.
  //
  // Il annonçait « Signal Haute Confiance : la tendance vient de basculer,
  // EMA + RSI + ADX alignés ». C'est l'ancien moteur, désactivé le 03/08/2026
  // après avoir été mesuré comme la jambe PERDANTE de la stratégie. Tout
  // signal d'un moteur non répertorié — c'est-à-dire tout moteur ajouté sans
  // passer ici, ce qui s'est produit deux fois — était donc expliqué à
  // l'abonné comme provenant de cette stratégie-là.
  //
  // Le repli dit maintenant ce qu'on sait réellement, c'est-à-dire rien de
  // plus que la direction. `direction` reste utilisé : c'est la seule
  // information dont ce chemin dispose avec certitude.
  return `${arrow} Position ${direction} — les niveaux et la date de sortie sont ci-dessous.`;
}

/**
 * Durée de détention prévue, quand le signal en porte une.
 *
 * Sans cette ligne, l'abonné n'a aucun moyen de savoir que la sortie est
 * TEMPORELLE : il voit un stop et trois objectifs, et en déduit logiquement
 * qu'il attend l'un ou l'autre. Or ce sont deux des trois moteurs qui ferment à
 * l'échéance quoi qu'il arrive — les objectifs ne déclenchent que 2 % des
 * sorties. Taire la durée, c'est laisser croire à une stratégie qu'on ne joue
 * pas.
 */
function buildHoldLine(signal: SignalLike): string | null {
  if (!signal.hold_until) return null;
  const jours = Math.round(
    (new Date(signal.hold_until).getTime() - new Date(signal.created_at).getTime()) / 86400000
  );
  if (!Number.isFinite(jours) || jours < 1) return null;
  return `⏳ Durée prévue : ${jours} jours. Ce signal se ferme à l'échéance même si aucun objectif n'est atteint — la sortie au temps fait partie de la stratégie.`;
}

/**
 * La mesure complète du moteur, au pied de son signal.
 *
 * C'EST ICI QUE L'AVERTISSEMENT DOIT VIVRE, et nulle part ailleurs. Il était
 * répété comme titre dans huit textes — /start, /help, /trial, /subscribe,
 * /status, /marche, /demo — au point que le seul moteur produisant en marché
 * défavorable était présenté partout par sa faiblesse. Un prospect lisait cinq
 * fois « en recul » avant d'avoir vu un seul chiffre.
 *
 * Le fait omis, pourtant mesuré : 0,268 % par jour de capital immobilisé, soit
 * environ neuf fois le carry (0,027 %/jour). Les deux sont vrais — le carry
 * gagne 84 % de ses positions mais bloque 21 jours, le momentum en gagne 48 %
 * et rend en 3 jours. Taire le second n'était pas prudent, c'était incomplet.
 *
 * La réserve reste, entière, à l'endroit où quelqu'un décide de prendre CE
 * trade : historique plus court, dernière année en recul, volume plafonné.
 * Personne ne peut engager d'argent sans l'avoir lue.
 */
/**
 * LE RELEVÉ RÉEL SE PUBLIE À CÔTÉ DE LA PROMESSE.
 *
 * La ligne annonçait « +0,805 % par signal sur 3 jours mesurés » et se
 * terminait par « il s'arrête tout seul si les résultats réels démentent la
 * mesure ». Les deux affirmations sont vraies. Mais le relevé réel de ce
 * moteur, au 14/08/2026, dit −0,07 % par trade sur 10 clôtures, et ce chiffre
 * n'apparaissait nulle part.
 *
 * Taire un chiffre défavorable qu'on possède est la forme la plus facile du
 * mensonge sur les performances : elle ne demande aucun effort et ne laisse
 * aucune trace. Sur un produit dont l'argument central est la rigueur de la
 * mesure, c'est aussi la plus coûteuse le jour où quelqu'un recompte.
 *
 * Dix trades ne démontrent rien, et la phrase le dit. Ce n'est pas une
 * précaution rhétorique : le garde-fou d'espérance exige trente clôtures avant
 * de couper, parce qu'en dessous la moyenne est du bruit.
 */
function ligneReleveReel(releve?: ReleveReel | null): string | null {
  if (!releve) return null;
  const moyenne = `${releve.moyennePct >= 0 ? "+" : ""}${releve.moyennePct.toFixed(2).replace(".", ",")} %`;
  const verdict =
    releve.moyennePct >= 0
      ? "au-dessus de zéro, mais l'échantillon reste trop petit pour confirmer la mesure historique."
      : "en dessous de la mesure historique. L'échantillon est trop petit pour conclure, et c'est le chiffre vrai.";
  return `📒 Relevé RÉEL de ce moteur depuis sa mise en service : ${moyenne} par signal sur ${releve.clotures} clôtures (${releve.gagnants} gagnantes) — ${verdict}`;
}

/**
 * LE PROFIL DE GAIN EST DIT, parce que c'est lui qui fait partir les abonnés.
 *
 * Ce moteur gagne 43,9 % de ses trades et sa médiane est NÉGATIVE (-1,18 %) :
 * il vit de quelques gros gains, pas de la fréquence. Un abonné qui enchaîne
 * six pertes croit assister à une panne, alors qu'il assiste au régime normal
 * de la stratégie — et il se désabonne précisément au moment où il ne faut pas.
 *
 * Le taux de réussite figurait déjà dans les statistiques publiées, mais jamais
 * dans le message que l'abonné lit au moment d'engager de l'argent. Une donnée
 * exacte rangée là où personne ne la voit ne protège personne.
 */
function buildObservationLine(engine?: string | null): string | null {
  if (engine !== "momentum_4h") return null;
  return (
    `🧪 *Momentum 4H* — ${MOMENTUM_4H.esperanceParSignal} par signal sur ${MOMENTUM_4H.jours} jours mesurés, soit ` +
    `${MOMENTUM_4H.esperanceParJour} par jour de capital. Dans le même régime et aux mêmes dates, un tirage au ` +
    `sort donne ${MOMENTUM_4H.temoinAleatoire} : c'est cet écart-là qui est l'avantage, pas le chiffre brut. ` +
    `Positif ${MOMENTUM_4H.anneesPositives}.\n` +
    `⚠️ Profil à connaître AVANT d'engager : seulement ${MOMENTUM_4H.reussite} des trades sont gagnants et la ` +
    "moitié perdent plus de 1 %. Ce moteur vit de quelques gros gains, pas de la fréquence — enchaîner plusieurs " +
    "pertes est son régime NORMAL, pas une panne. Il ne prend qu'une place par jour, avec un dimensionnement plus " +
    "petit que les autres moteurs, et il s'arrête tout seul si les résultats réels démentent la mesure."
  );
}

/**
 * CE QU'UNE VENTE À DÉCOUVERT EXIGE, dit AVANT les niveaux.
 *
 * Ce produit n'avait jamais émis autre chose que des achats. Un abonné qui
 * reçoit « VENTE » pour la première fois doit savoir trois choses, et aucune
 * n'est optionnelle :
 *
 *   1. Il lui faut un compte à terme (perpétuels). C'est UNE jambe avec un
 *      stop — bien plus accessible que le carry qui en demande deux — mais ce
 *      n'est pas du spot, et une partie des abonnés ne le fera pas.
 *   2. Une vente peut théoriquement perdre SANS BORNE : le prix peut monter
 *      indéfiniment, alors qu'un achat ne peut pas descendre sous zéro. Le
 *      stop n'est pas un confort, c'est la condition.
 *   3. Un squeeze franchit un stop en une seule bougie. Le pire trade de la
 *      mesure a perdu 31,7 % — davantage que la largeur du stop.
 *
 * Ces trois points passent AVANT le chiffre de performance, pas après. Un
 * avertissement placé sous une espérance de +1,10 % ne se lit pas.
 */
function buildVenteADecouvertLine(engine?: string | null): string | null {
  if (engine !== "faiblesse_4h") return null;
  return (
    "🔻 *VENTE À DÉCOUVERT — à lire avant d'engager.* Ce signal se joue sur un perpétuel, pas au comptant : " +
    "il te faut un compte à terme. Contrairement à un achat, une vente peut perdre SANS LIMITE si le prix " +
    "monte — le stop loss n'est pas une option ici, c'est la condition pour prendre ce trade. Un rachat " +
    "forcé (squeeze) peut franchir le stop en une seule bougie : la pire position mesurée a perdu 31,7 %, " +
    "soit davantage que la largeur du stop. Si tu n'es pas à l'aise avec ça, ignore ce signal — les signaux " +
    "d'achat continuent d'arriver normalement."
  );
}

function buildRiskSizingLine(entryPrice: number, stopLoss: number): string | null {
  const riskPct = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
  if (riskPct <= 0) return null;
  const positionPct = Math.min(100, (SUGGESTED_RISK_PCT / riskPct) * 100);
  const capNote = (SUGGESTED_RISK_PCT / riskPct) * 100 > 100 ? " (mise maximale recommandée)" : "";
  // Format français comme partout ailleurs : cette ligne côtoyait "-10,0 %"
  // deux lignes plus haut en écrivant "10.0%".
  const fr = (v: number, dec: number) => v.toFixed(dec).replace(".", ",");
  return (
    `💰 Risque conseillé : ${SUGGESTED_RISK_PCT} % de ton capital max sur ce trade. ` +
    `Avec un stop à ${fr(riskPct, 1)} % de l'entrée, cela correspond à une position d'environ ` +
    `${fr(positionPct, 0)} % de ton capital TOTAL${capNote} (${SUGGESTED_RISK_PCT} % ÷ ${fr(riskPct, 1)} %).` +
    // CE CALCUL NE VOIT QU'UN SEUL TRADE, ET C'EST DANGEREUX SANS CETTE PHRASE.
    //
    // Le 13/08/2026, le message SOL/USDT annonçait « une position d'environ
    // 44 % de ton capital TOTAL » — arithmétiquement juste : 2 % de risque
    // divisés par un stop à 4,5 %. Mais six positions étaient ouvertes le même
    // jour, dont plusieurs à stop serré. Un lecteur qui applique la formule à
    // chacune se retrouve à plus de 200 % de son capital engagé, c'est-à-dire
    // à emprunter pour suivre un signal présenté comme prudent.
    //
    // La formule est correcte par trade et fausse par portefeuille. Elle
    // n'était accompagnée d'aucune borne — et c'est le seul chiffre du message
    // qui peut, à lui seul, ruiner quelqu'un.
    "\n📐 Ce calcul porte sur CE trade isolément. Plusieurs positions peuvent être ouvertes en même temps : " +
    "la somme de toutes tes positions ne doit jamais dépasser ton capital, et le total du risque pris " +
    `(${SUGGESTED_RISK_PCT} % par trade) reste à diviser entre elles.`
  );
}

/**
 * Mission "grille d'excellence" — gestion Multi-TP avec sécurisation
 * Break-Even (voir signals/config.py::ENABLE_MULTI_TP_EXITS). Le ratio
 * risque/rendement affiché est calculé dynamiquement à partir des prix
 * réels du signal (distance TPn / distance stop) plutôt qu'affiché en dur :
 * les deux moteurs (Haute Confiance et Squeeze 15M, voir
 * signals/squeeze_engine.py) utilisent des multiplicateurs ATR différents,
 * un texte fixe aurait été faux pour l'un des deux.
 */
function buildMultiTpLines(signal: SignalLike, stopLoss: number): string[] {
  const pctOf = (level: number) =>
    signal.type === "BUY" ? ((level - signal.entry_price) / signal.entry_price) * 100 : ((signal.entry_price - level) / signal.entry_price) * 100;
  const slDist = Math.abs(signal.entry_price - stopLoss);
  // « ratio 1:1.0 » melait un point decimal anglais a un texte qui ecrit
  // « +6,2 % » deux caracteres plus loin. Un ratio entier s'ecrit sans
  // decimale du tout.
  const ratioLabel = (level: number) => {
    if (slDist <= 0) return "";
    const r = Math.abs(level - signal.entry_price) / slDist;
    const texte = Number.isInteger(Math.round(r * 10) / 10) ? String(Math.round(r)) : r.toFixed(1).replace(".", ",");
    return ` (ratio 1:${texte})`;
  };

  const lines = [`🛑 Stop-Loss : ${prix(stopLoss)} (${pct(-Math.abs(pctOf(stopLoss)))})`];
  if (signal.tp1_price != null) {
    lines.push(
      `🥇 TP1 : ${prix(signal.tp1_price)} (${pct(pctOf(signal.tp1_price))}${ratioLabel(signal.tp1_price)}) — Sécurisation rapide + passage automatique au Break-Even`
    );
  }
  if (signal.tp2_price != null) {
    lines.push(`🥈 TP2 : ${prix(signal.tp2_price)} (${pct(pctOf(signal.tp2_price))}${ratioLabel(signal.tp2_price)}) — Objectif principal`);
  }
  if (signal.tp3_price != null) {
    lines.push(`🥉 TP3 : ${prix(signal.tp3_price)} (${pct(pctOf(signal.tp3_price))}${ratioLabel(signal.tp3_price)}) — Runner`);
  }
  return lines;
}

function buildTrailingStopLine(signal: SignalLike, stopLoss: number): string {
  const risk = Math.abs(signal.entry_price - stopLoss);
  const firstTrailPrice = signal.type === "BUY" ? signal.entry_price + risk : signal.entry_price - risk;
  return (
    `🔒 Trailing stop activé : dès que le prix atteint ${prix(firstTrailPrice)} ` +
    `(+1R), tu recevras un message pour remonter ton stop au point mort (${prix(signal.entry_price)}). Purement indicatif.`
  );
}

export function buildSignalMessage(
  signal: SignalLike,
  opts: { trailingEnabled?: boolean; delayNote?: string; ctaUsername?: string; releveReel?: ReleveReel | null } = {}
): string {
  // Un carry n'a ni stop ni objectif : tous les calculs de risque/rendement
  // ci-dessous porteraient sur des champs nuls et produiraient des NaN affichés
  // aux abonnés. Il a son propre message, qui explique les deux jambes.
  if (signal.type === "CARRY") {
    return buildCarryMessage(signal, opts);
  }

  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  const label = typeLabel(signal.type);

  // Passé la branche CARRY ci-dessus, stop et objectif sont nécessairement
  // renseignés : la base ne les autorise nuls que pour les carrys, et tous les
  // moteurs directionnels les fixent. Le repli à 0 n'existe que pour satisfaire
  // le typage — s'il apparaissait dans un message, ce serait le signe d'une
  // insertion anormale, visible immédiatement.
  const stopLoss = signal.stop_loss ?? 0;
  const takeProfit = signal.take_profit ?? 0;

  const rewardPct = signal.type === "BUY"
    ? ((takeProfit - signal.entry_price) / signal.entry_price) * 100
    : ((signal.entry_price - takeProfit) / signal.entry_price) * 100;
  const riskPct = signal.type === "BUY"
    ? ((signal.entry_price - stopLoss) / signal.entry_price) * 100
    : ((stopLoss - signal.entry_price) / signal.entry_price) * 100;

  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const riskSizingLine = buildRiskSizingLine(signal.entry_price, stopLoss);
  const isMultiTp = signal.tp1_price != null;

  const lines: Array<string | null> = [
    `${emoji} *${label} ${signal.pair}* — ${engineBadge(signal.engine)}${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    buildContext(signal.type, signal.engine),
    // L'avertissement de vente à découvert passe AVANT les niveaux et avant
    // tout chiffre de performance. Placé plus bas, il se lit après que le
    // lecteur a déjà décidé — c'est-à-dire jamais.
    buildVenteADecouvertLine(signal.engine),
    "",
    `💵 Zone d'entrée : ${prix(signal.entry_price)}`,
    ...(isMultiTp
      ? buildMultiTpLines(signal, stopLoss)
      : [`🎯 Take profit : ${prix(takeProfit)} (${pct(rewardPct)})`, `🛑 Stop loss : ${prix(stopLoss)} (${pct(-riskPct)})`]),
    "",
    buildHoldLine(signal),
    riskSizingLine,
    buildObservationLine(signal.engine),
    signal.engine === "momentum_4h" ? ligneReleveReel(opts.releveReel) : null,
    opts.trailingEnabled ? buildTrailingStopLine(signal, stopLoss) : null,
    signal.confidence_score != null ? `📊 Confiance : ${signal.confidence_score}/100 _(indicatif, pas une probabilité de gain)_` : null,
    `🕒 ${new Date(signal.created_at).toLocaleString("fr-FR")}`,
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ];

  if (escapedUsername) {
    lines.push("", `📡 Signaux en temps réel + alertes VIP : rejoins @${escapedUsername}`);
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}


/**
 * Message d'un carry de financement.
 *
 * Ce que l'abonné doit comprendre, et qui n'a aucun équivalent dans les autres
 * signaux : ce n'est PAS un pari sur le prix. Il ouvre deux positions de même
 * montant, en sens opposé, sur la même crypto. Si le prix monte, la jambe spot
 * gagne exactement ce que la jambe perpétuelle perd. Ce qu'il encaisse, c'est
 * le financement — ce taux versé toutes les 8 heures par les acheteurs de
 * perpétuels aux vendeurs.
 *
 * Trois honnêtetés obligatoires dans ce message, mesurées et non négociables :
 *   - le montant annoncé n'est PAS acquis. Sur 6 ans, seules 41 % des positions
 *     atteignent le financement annoncé à l'ouverture (corrélation annoncé /
 *     réalisé : +0,49). Le taux peut baisser, voire s'inverser.
 *   - ce n'est pas « sans risque » : la jambe vendeuse peut être liquidée si la
 *     marge devient insuffisante, et il reste un risque de plateforme.
 *   - la position se ferme sur une DURÉE. Aucun prix ne la déclenchera.
 *
 * Aucun `parse_mode` particulier n'est imposé ici : la fonction rend du Markdown
 * comme buildSignalMessage, et les noms de paires ne contiennent pas de tiret bas.
 */
export function annualisePct(pctSurPeriode: number, joursDeDetention: number): number {
  if (joursDeDetention <= 0) return 0;
  return (Math.pow(1 + pctSurPeriode / 100, 365 / joursDeDetention) - 1) * 100;
}

function joursDeDetention(signal: SignalLike): number {
  if (!signal.hold_until) return 21;
  const jours = Math.round(
    (new Date(signal.hold_until).getTime() - new Date(signal.created_at).getTime()) / 86400000
  );
  return Math.max(1, jours);
}

/**
 * Bloc pédagogique du carry, envoyé UNE SEULE FOIS par lot.
 *
 * Il faisait auparavant partie de chaque signal. Quatre carrys publiés la même
 * minute, c'étaient donc quatre fois les mêmes 1 200 caractères d'explication :
 * vu du canal, ça ressemblait à du spam — et c'en était.
 */
export function buildCarryExplanation(): string {
  return [
    "🔁 *Comment marche un carry*",
    "",
    "Tu ouvres DEUX positions de même montant sur la même crypto : achat au comptant, et vente à découvert du contrat perpétuel. Elles s'annulent — si le prix monte, l'une gagne ce que l'autre perd. La direction du marché ne t'affecte plus.",
    "",
    "Ce que tu encaisses, c'est le *financement* : un taux versé toutes les 8 heures par les acheteurs de perpétuels aux vendeurs. En étant vendeur, tu le reçois.",
    "",
    "*Trois choses à savoir avant d'ouvrir :*",
    "• Le rendement annoncé n'est pas acquis. Sur 6 ans, 41 % des positions ont atteint ou dépassé le montant annoncé à l'ouverture : le taux bouge, et peut s'inverser.",
    "• Ce n'est pas sans risque. Ta jambe vendeuse peut être liquidée si ta marge devient insuffisante — garde de la marge disponible. Une journée de financement extrême peut coûter jusqu'à -19,86 % sur une position.",
    "• Referme les DEUX jambes ensemble. N'en garder qu'une transforme une position neutre en pari directionnel.",
    "",
    "Mesuré sur 6 ans : 84,2 % de positions gagnantes, 6 années positives sur 7.",
  ].join("\n");
}

/**
 * Message d'un carry, forme COURTE.
 *
 * Le rendement est affiché ANNUALISÉ en premier, le montant sur la période
 * juste derrière. Les deux sont vrais ; le premier est celui qui permet de
 * décider.
 *
 * Pourquoi cette conversion est indispensable. Un carry rapporte typiquement
 * entre 0,4 et 1 % sur ses 21 jours. Affiché brut, « +0,43 % sur la période »
 * se lit comme dérisoire — pour une position qu'il faut ouvrir en deux jambes,
 * sur deux produits, avec de la marge à surveiller, personne ne se dérange. Le
 * retour du premier abonné l'a dit sans détour : « c'est pas ouf ». Or c'est
 * exactement le même chiffre que +7,7 % PAR AN sans exposition au prix, et
 * c'est la seule unité qui ait du sens pour un produit de rendement. Ce n'est
 * pas un embellissement : c'est la bonne unité pour la bonne chose.
 */
export function buildCarryMessage(
  signal: SignalLike,
  opts: { delayNote?: string; ctaUsername?: string; avecExplication?: boolean } = {}
): string {
  // Le tiret bas doit être échappé pour Telegram : un underscore nu dans un
  // message Markdown ouvre une mise en italique et casse le message ENTIER.
  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const jours = joursDeDetention(signal);
  const attendu = signal.carry_expected_pct;
  const parAn = attendu != null ? annualisePct(attendu, jours) : null;

  const lines: Array<string | null> = [
    `💵 *CARRY ${signal.pair}*${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    "Position neutre au marché : la direction du prix ne change rien au résultat.",
    "",
    `🟢 Achat au comptant de ${signal.pair}`,
    `🔴 Vente à découvert du perpétuel ${signal.pair}`,
    `💵 Prix de référence : ${prix(signal.entry_price)}`,
    parAn != null && attendu != null
      ? `📈 Rendement attendu : *${pct(parAn)} par an* (soit ${pct(attendu)} sur ${jours} jours, frais déduits)`
      : null,
    `⏳ Clôture prévue dans ${jours} jours — les deux jambes se ferment ensemble`,
  ];

  lines.push("", opts.avecExplication ? buildCarryExplanation() : "_Comment ça marche : /carry_");
  lines.push("", "⚠️ Pas un conseil financier — risque de perte en capital.");
  if (escapedUsername) {
    lines.push("", `📡 Signaux en temps réel : @${escapedUsername}`);
  }
  return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * Annonce d'un signal sur le canal PUBLIC : la preuve, pas le produit.
 *
 * POURQUOI CE FORMAT EXISTE, ET CE QU'IL CORRIGE.
 *
 * Le canal gratuit recevait jusqu'ici le message COMPLET — paire, entrée, stop,
 * trois objectifs, durée — trente minutes après les abonnés payants. Sur un
 * signal dont la sortie est à trois jours au plus court et vingt-et-un au plus
 * long, trente minutes ne valent rien : un lecteur du canal gratuit obtenait
 * cent pour cent de ce que l'abonné payait. Il n'existait donc aucune raison de
 * payer, et personne ne payait.
 *
 * Ce que le canal gratuit garde, et c'est beaucoup : il apprend qu'un signal
 * vient de partir, de quel moteur il vient, et il recevra à la clôture le
 * signal ENTIER avec son résultat — gagnant ou perdant, sans exception. Le
 * relevé public reste donc complet et vérifiable ; c'est seulement le moment où
 * il devient jouable qui se paie.
 *
 * Ce que ce format ne fait PAS, délibérément : il ne cache rien qui serait
 * ensuite dissimulé. Tout ce qui manque ici est publié quelques jours plus
 * tard, au même endroit. Un canal qui ne montrerait que ses gains serait une
 * arnaque ; un canal qui montre tout, mais après, est une démonstration.
 */
export function buildPublicTeaserMessage(
  signal: SignalLike,
  opts: { botUsername?: string; delayNote?: string } = {}
): string {
  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  const escapedUsername = opts.botUsername?.replace(/_/g, "\\_");
  const jours = signal.hold_until
    ? Math.round((new Date(signal.hold_until).getTime() - new Date(signal.created_at).getTime()) / 86400000)
    : null;

  const lines: Array<string | null> = [
    `${emoji} *Nouveau signal — ${signal.pair}*`,
    `${engineBadge(signal.engine)}${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    "",
    buildContext(signal.type, signal.engine),
    "",
    jours ? `⏳ Durée prévue : ${jours} jours` : null,
    "🔒 Entrée, stop et objectifs : réservés aux abonnés.",
    "",
    "📊 Ce signal sera republié ICI à sa clôture, en entier et avec son résultat — gagnant ou perdant. " +
      "Rien n'est retiré après coup : c'est comme ça que le relevé public se construit.",
  ];

  if (escapedUsername) {
    lines.push("", `🎁 Pour le recevoir avec ses niveaux, au moment où il part : @${escapedUsername} — essai gratuit de 3 jours.`);
  }
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Perte maximale mesurée sur une position de carry, sur 6 ans, stop de
 * financement actif (voir signals/backtest_carry_stop.py). Sans ce stop, la
 * pire position atteignait -66,70 %.
 *
 * Cette valeur n'a rien d'un détail à reléguer dans l'explication longue : un
 * message qui annonce un rendement sans jamais chiffrer la perte possible
 * demande au lecteur de croire qu'il n'y en a pas.
 */
const CARRY_PIRE_PERTE_PCT = -19.86;

/**
 * Message de carry pour le CANAL PUBLIC : quatre chiffres, un bouton.
 *
 * Pourquoi une deuxième forme alors qu'il en existait déjà une « courte ».
 * Celle-ci embarquait quand même le bloc pédagogique de 1 200 caractères, si
 * bien qu'un carry occupait la hauteur d'un écran entier de téléphone. Dans un
 * canal public, ce n'est pas un signal, c'est un mur — et le lecteur fait
 * défiler sans lire. Le retour du premier abonné était sans détour : « c'est un
 * peu du spam ».
 *
 * Ce qui reste ici est ce qui permet de DÉCIDER, et rien d'autre :
 *   - le rendement annualisé, seule unité qui ait du sens pour un produit de
 *     rendement (+0,43 % sur 21 jours se lit comme dérisoire ; c'est +7,7 %
 *     par an sans exposition au prix) ;
 *   - le gain attendu sur la période, parce que c'est le montant réellement
 *     encaissé, et qu'annualiser sans le rappeler serait de l'embellissement ;
 *   - la perte maximale mesurée, au même niveau de visibilité que le gain ;
 *   - la durée, parce que la sortie est temporelle et qu'aucun prix ne la
 *     déclenchera.
 *
 * Le reste — les deux jambes, le financement, les trois précautions — part dans
 * /carry, atteignable en un tapotement par le bouton.
 */
export function buildCarryShortMessage(
  signaux: SignalLike[],
  opts: { delayNote?: string } = {}
): string {
  if (signaux.length === 0) return "";
  const jours = joursDeDetention(signaux[0]);
  const note = opts.delayNote ? ` _(${opts.delayNote})_` : "";

  // Deux décimales sur le gain de période, contrairement au reste du produit.
  // Un carry rapporte typiquement entre 0,4 et 1 % : arrondi au dixième,
  // +0,61 % et +0,55 % s'affichent tous les deux « +0,6 % », et deux positions
  // dont les rendements annualisés diffèrent de trois points paraissent
  // identiques.
  const pct2 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")} %`;

  const ligne = (s: SignalLike, seul: boolean): string => {
    const nom = seul ? "" : `*${s.pair}* — `;
    const attendu = s.carry_expected_pct;
    if (attendu == null) return `• ${nom}rendement non chiffré · réf. ${prix(s.entry_price)}`;
    const parAn = annualisePct(attendu, joursDeDetention(s));
    return `• ${nom}*${pct(parAn)} par an* · ${pct2(attendu)} sur ${joursDeDetention(s)} j · réf. ${prix(s.entry_price)}`;
  };

  const seul = signaux.length === 1;
  const titre = seul
    ? `💵 *CARRY ${signaux[0].pair}*${note}`
    : `💵 *${signaux.length} carrys ouverts*${note}`;

  return [
    titre,
    "Rendement sans pari sur le prix : les deux jambes s'annulent.",
    "",
    ...signaux.map((s) => ligne(s, seul)),
    "",
    `⏳ Clôture dans ${jours} jours, les deux jambes ensemble`,
    `🛑 Pire position mesurée sur 6 ans : ${pct(CARRY_PIRE_PERTE_PCT)}`,
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ].join("\n");
}

/**
 * Bouton qui emmène du canal public jusqu'à l'explication complète.
 *
 * Un lien plutôt qu'un `callback_data` : le lecteur d'un canal public n'a
 * généralement jamais ouvert le bot, et un callback ne peut pas créer cette
 * conversation. Le lien la crée ET transmet la charge « carry », que le routeur
 * reconnaît (voir bot/router.ts).
 */
export function buildCarryDetailKeyboard(botUsername: string): InlineKeyboard {
  return [[{ text: "🔁 Comment marche un carry", url: `https://t.me/${botUsername}?start=carry` }]];
}

/**
 * Un LOT de carrys en un seul message.
 *
 * Quand plusieurs positions s'ouvrent le même jour — le cas normal au démarrage
 * ou après une période creuse — les envoyer séparément produit une rafale de
 * messages quasi identiques. Groupés, ils se lisent d'un coup d'œil et
 * l'explication n'apparaît qu'une fois.
 */
export function buildCarryBatchMessage(
  signaux: SignalLike[],
  opts: { delayNote?: string; ctaUsername?: string } = {}
): string {
  if (signaux.length === 0) return "";
  if (signaux.length === 1) {
    return buildCarryMessage(signaux[0], { ...opts, avecExplication: true });
  }

  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const jours = joursDeDetention(signaux[0]);
  const lignes = signaux.map((s) => {
    const attendu = s.carry_expected_pct;
    const rendement =
      attendu != null ? `${pct(annualisePct(attendu, joursDeDetention(s)))} par an` : "rendement inconnu";
    return `• *${s.pair}* — ${rendement} · référence ${prix(s.entry_price)}`;
  });

  const out: Array<string | null> = [
    `💵 *${signaux.length} carrys ouverts*${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    "Positions neutres au marché : la direction du prix ne change rien au résultat.",
    "",
    ...lignes,
    "",
    `Pour chacune : achat au comptant + vente à découvert du perpétuel, même montant. Clôture dans ${jours} jours, les deux jambes ensemble.`,
    "",
    buildCarryExplanation(),
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ];
  if (escapedUsername) {
    out.push("", `📡 Signaux en temps réel : @${escapedUsername}`);
  }
  return out.filter((l): l is string => l !== null).join("\n");
}
