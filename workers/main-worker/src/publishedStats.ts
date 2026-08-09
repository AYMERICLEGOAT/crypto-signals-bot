/**
 * Les chiffres de débit publiés, en un seul endroit.
 *
 * POURQUOI CE MODULE EXISTE. Le produit annonçait « 4,35 signaux par jour en
 * marché favorable, 1,15 en défavorable, 2,99 en moyenne » dans /help,
 * /subscribe, /trial, /demo, /marche, /status, le site et les CGV — une
 * vingtaine de copies manuelles du même nombre.
 *
 * Ces chiffres avaient été mesurés quand DEUX moteurs émettaient : la force
 * relative et le carry (c'est écrit dans carry_engine.py, « avec la force
 * relative, le canal passe à 4,35 »). Il y en a cinq aujourd'hui. Personne ne
 * pouvait s'en apercevoir : ajouter un moteur ne casse aucun test et ne touche
 * aucun de ces textes.
 *
 * Une valeur recopiée vingt fois finit toujours par décrire un produit qui
 * n'existe plus. Les textes lisent maintenant ce module.
 *
 * D'OÙ VIENNENT LES NOUVEAUX CHIFFRES. De signals/mesure_debit_signaux.py et
 * signals/mesure_debit_4h.py, qui rejouent les détecteurs de PRODUCTION sur
 * l'historique, plafond de l'arbitre et détention des positions compris. La
 * détention est ce qui décide du résultat : sans elle, la force relative
 * reproposerait ses douze premières paires chaque jour et on mesurerait le
 * plafond au lieu du débit.
 *
 * L'ÉCART VA DANS LES DEUX SENS, et c'est le second qui compte.
 *
 *   Marché favorable   4,35 annoncé  ->  4,00 mesuré. Le produit promettait
 *                      un peu plus qu'il ne délivre.
 *
 *   Marché défavorable 1,15 annoncé  ->  3,15 mesuré. Le produit annonçait un
 *                      quasi-silence là où il délivre trois signaux par jour.
 *                      Le momentum 4H, ajouté après cette mesure, ne travaille
 *                      QUE dans ce régime — et c'est précisément la période où
 *                      un abonné doute et se désabonne.
 */

/** Fenêtres de mesure, à citer quand un texte avance un de ces chiffres. */
export const FENETRE_DIRECTIONNELS = "août 2020 – août 2026";
export const FENETRE_MOMENTUM_4H = "septembre 2023 – août 2026";

/**
 * Signaux effectivement reçus par jour, après l'arbitre.
 *
 * `favorable` = 2,85 directionnels mesurés + 1,15 carry.
 * `defavorable` = 2,00 momentum 4H mesurés + 1,15 carry (les trois moteurs
 * directionnels sont coupés par le filtre de tendance, par construction).
 */
export const DEBIT = {
  favorable: "4,0",
  defavorable: "3,1",
  moyenne: "3,6",
} as const;

/**
 * Part du temps où le filtre de tendance est fermé. Mesuré à 42,5 % sur la
 * fenêtre ci-dessus ; « 41 % » circulait auparavant, mesuré sur une fenêtre
 * plus courte. L'écart n'est pas une correction de fond, mais deux chiffres
 * pour la même chose finissent par se contredire dans deux textes voisins.
 */
export const PART_FILTRE_FERME = "42 %";

/**
 * Part des jours comportant au moins un signal. « 80 % » datait de l'époque à
 * deux moteurs. Mesuré aujourd'hui : 93,5 % des jours favorables comportent au
 * moins un directionnel, et 100 % des jours défavorables comportent au moins
 * un momentum 4H — le carry s'ajoutant aux deux.
 *
 * On publie 93 %, la borne basse des deux, plutôt qu'un « quasiment tous les
 * jours » invérifiable.
 */
export const PART_JOURS_AVEC_SIGNAL = "93 %";

/**
 * Maximum absolu de signaux en une journée.
 *
 * Les textes annonçaient « jamais plus de 5 par jour au total ». C'est le
 * plafond des seuls moteurs directionnels et du momentum 4H
 * (config.QUOTA_SIGNAUX_MAX). Les carrys sont ajoutés APRÈS ce plafond, sans
 * avoir concouru — ils ne prennent aucun risque de marché et ont leur propre
 * borne (config.CARRY_MAX_NEW_PER_DAY = 3).
 *
 * Le vrai maximum est donc 5 + 3. Un abonné qui reçoit sept signaux un jour de
 * forte activité aurait lu ici qu'on ne dépasse jamais cinq.
 */
export const MAX_PAR_JOUR = 8;

/**
 * LE MOMENTUM 4H, DÉCRIT PAR SES CHIFFRES ET NON PAR DES EXCUSES.
 *
 * Ce moteur était présenté dans huit textes différents par sa faiblesse :
 * « en observation, mesuré positif trois années sur quatre, EN RECUL SUR LA
 * DERNIÈRE ». C'est vrai, et ça reste écrit là où ça compte — au pied de chaque
 * signal et dans la FAQ. Mais en faire le titre partout revenait à saborder le
 * seul moteur qui produise réellement en marché défavorable.
 *
 * Ce qui n'était écrit NULLE PART, alors que c'est mesuré et vérifiable dans
 * signal_arbiter.PROFILS : ramené à l'unité commune du projet — l'espérance par
 * jour de capital immobilisé — le momentum 4H rend 0,268 %/jour, contre
 * 0,027 %/jour pour le carry de financement. Soit DIX FOIS plus, alors que le
 * carry est présenté partout comme « de très loin le meilleur argument du
 * produit ».
 *
 * Les deux affirmations sont vraies et ne se contredisent pas : le carry gagne
 * 84 % de ses positions mais immobilise 21 jours pour 0,572 %, le momentum en
 * gagne 48 % mais rend 0,805 % en 3 jours. Taire la seconde n'était pas de la
 * prudence, c'était une omission qui coûtait des abonnés.
 *
 * « En observation » reste, et garde un sens précis : son historique commence
 * en septembre 2023, contre août 2020 pour les autres. C'est cette
 * incertitude-là — moins de recul, pas un mauvais résultat — qui justifie de le
 * plafonner à deux places par jour (config.QUOTA_OBSERVATION_MAX).
 */
export const MOMENTUM_4H = {
  esperanceParSignal: "+0,805 %",
  jours: 3,
  esperanceParJour: "0,268 %",
  reussite: "48,3 %",
  /** Rapport avec le carry sur la même unité. Entier : l'arrondi joue en notre défaveur. */
  facteurContreCarry: 9,
  anneesPositives: "3 années sur 4",
} as const;

/** Détail par moteur, pour les textes qui expliquent d'où vient le débit. */
export const DEBIT_PAR_MOTEUR = {
  relative_strength: "2,17",
  cassure_canal: "0,55",
  expansion_volatilite: "0,13",
  carry_funding: "1,15",
  momentum_4h: "2,00",
} as const;
