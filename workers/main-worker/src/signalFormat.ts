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

export const SUGGESTED_RISK_PCT = 2;

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

const ENGINE_BADGE: Record<string, string> = {
  high_confidence: "🎯 Haute Confiance",
  squeeze_15m: "⚡ Squeeze 15M",
  relative_strength: "📈 Force Relative",
  carry_funding: "💵 Carry de Financement",
  momentum_4h: "🧪 Momentum 4H (en observation)",
};

function engineBadge(engine?: string | null): string {
  return ENGINE_BADGE[engine ?? "high_confidence"] ?? ENGINE_BADGE.high_confidence;
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
  return `${arrow} Signal Haute Confiance : la tendance vient de basculer ${direction} (EMA + RSI + ADX alignés).`;
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

/** Avertissement réservé aux moteurs dont l'avantage n'est pas encore établi. */
function buildObservationLine(engine?: string | null): string | null {
  if (engine !== "momentum_4h") return null;
  return (
    "🧪 *Moteur en observation.* Mesuré positif 3 années sur 4, mais en recul sur la dernière : " +
    "on le publie en le disant, avec un volume réduit, et il s'arrête tout seul si les résultats réels le démentent. " +
    "À dimensionner plus petit que les autres."
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
    `${fr(positionPct, 0)} % de ton capital alloué à ce trade${capNote} (${SUGGESTED_RISK_PCT} % ÷ ${fr(riskPct, 1)} %).`
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
  const ratioLabel = (level: number) => (slDist > 0 ? ` (ratio 1:${(Math.abs(level - signal.entry_price) / slDist).toFixed(1)})` : "");

  const lines = [`🛑 Stop-Loss : ${stopLoss} (${pct(-Math.abs(pctOf(stopLoss)))})`];
  if (signal.tp1_price != null) {
    lines.push(
      `🥇 TP1 : ${signal.tp1_price} (${pct(pctOf(signal.tp1_price))}${ratioLabel(signal.tp1_price)}) — Sécurisation rapide + passage automatique au Break-Even`
    );
  }
  if (signal.tp2_price != null) {
    lines.push(`🥈 TP2 : ${signal.tp2_price} (${pct(pctOf(signal.tp2_price))}${ratioLabel(signal.tp2_price)}) — Objectif principal`);
  }
  if (signal.tp3_price != null) {
    lines.push(`🥉 TP3 : ${signal.tp3_price} (${pct(pctOf(signal.tp3_price))}${ratioLabel(signal.tp3_price)}) — Runner`);
  }
  return lines;
}

function buildTrailingStopLine(signal: SignalLike, stopLoss: number): string {
  const risk = Math.abs(signal.entry_price - stopLoss);
  const firstTrailPrice = signal.type === "BUY" ? signal.entry_price + risk : signal.entry_price - risk;
  return (
    `🔒 Trailing stop activé : dès que le prix atteint ${firstTrailPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ` +
    `(+1R), tu recevras un message pour remonter ton stop au point mort (${signal.entry_price}). Purement indicatif.`
  );
}

export function buildSignalMessage(
  signal: SignalLike,
  opts: { trailingEnabled?: boolean; delayNote?: string; ctaUsername?: string } = {}
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
    "",
    `💵 Zone d'entrée : ${signal.entry_price}`,
    ...(isMultiTp
      ? buildMultiTpLines(signal, stopLoss)
      : [`🎯 Take profit : ${takeProfit} (${pct(rewardPct)})`, `🛑 Stop loss : ${stopLoss} (${pct(-riskPct)})`]),
    "",
    buildHoldLine(signal),
    riskSizingLine,
    buildObservationLine(signal.engine),
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
    `💵 Prix de référence : ${signal.entry_price}`,
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
    if (attendu == null) return `• ${nom}rendement non chiffré · réf. ${s.entry_price}`;
    const parAn = annualisePct(attendu, joursDeDetention(s));
    return `• ${nom}*${pct(parAn)} par an* · ${pct2(attendu)} sur ${joursDeDetention(s)} j · réf. ${s.entry_price}`;
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
    return `• *${s.pair}* — ${rendement} · référence ${s.entry_price}`;
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
