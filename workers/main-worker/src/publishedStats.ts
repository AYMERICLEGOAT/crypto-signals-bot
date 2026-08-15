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
export const FENETRE_MOMENTUM_4H = "août 2024 – août 2026 (730 jours, bougies 4 h)";

/**
 * Signaux effectivement reçus par jour, après l'arbitre.
 *
 * `favorable` = 2,85 directionnels mesurés + 1,15 carry.
 * `defavorable` = 1,00 momentum 4H + 1,15 carry (les trois moteurs
 * directionnels sont coupés par le filtre de tendance, par construction).
 * Le momentum est passé de 2 à 1 signal par jour le 14/08/2026 : à top 2, tout
 * son avantage venait d'UN SEUL trade sur deux ans (voir config.M4H_TOP_N).
 */
export const DEBIT = {
  favorable: "4,0",
  // LE REGIME BAISSIER PRODUIT DESORMAIS PLUS QUE LE REGIME PORTEUR, et ce
  // n'est pas une anomalie de calcul : c'est le sens du moteur Faiblesse 4H.
  //
  // Il ne travaille QUE quand le filtre est ferme, et il y produit 1,97 signal
  // par jour a lui seul (mesure du 15/08/2026). Avec le momentum (1,00) et le
  // carry (1,15), le creux historique du produit — 2,2 signaux par jour —
  // devient son sommet.
  //
  // C'est la reponse au vrai probleme commercial : une fermeture de filtre peut
  // durer 381 jours, et l'abonne payait pendant ce temps pour un service
  // presque muet.
  defavorable: "4,1",
  moyenne: "4,0",
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
 * plafonner à une place par jour (config.M4H_TOP_N, ramené de 2 à 1 le 14/08/2026).
 */
/**
 * REMESURÉ LE 14/08/2026 APRÈS PASSAGE À TOP 1 (backtest_momentum4h_temoin.py).
 *
 * Les chiffres précédents décrivaient la variante top 2, qui n'est plus celle
 * qui tourne. Publier +0,805 % aujourd'hui décrirait une stratégie que le
 * produit n'exécute plus — la forme de fausseté la plus difficile à repérer,
 * puisque le chiffre a été vrai.
 *
 * Mesure : 730 jours de bougies 4 h, 38 paires, régime défavorable seul, frais
 * comptés, entrées non chevauchantes, 82 trades. Fenêtre plus courte que
 * l'ancienne (qui portait sur 1 100 jours) : c'est dit dans FENETRE_MOMENTUM_4H
 * plutôt que masqué.
 *
 * LE TAUX DE RÉUSSITE EST BAS ET LA MÉDIANE EST NÉGATIVE, et il faut le dire :
 * 43,9 % de trades gagnants, médiane -1,18 %. Ce moteur gagne par quelques
 * gros gains, pas par la fréquence. Un abonné qui enchaîne six pertes n'est PAS
 * en train d'assister à une panne — c'est le régime normal de cette stratégie,
 * et ne pas l'avoir prévenu est la meilleure façon de le perdre au pire moment.
 */
export const MOMENTUM_4H = {
  esperanceParSignal: "+1,86 %",
  jours: 3,
  esperanceParJour: "0,62 %",
  reussite: "43,9 %",
  /** Rapport avec le carry sur la même unité. Entier : l'arrondi joue en notre défaveur. */
  facteurContreCarry: 20,
  anneesPositives: "5 trimestres sur 6",
  /** Ce qu'un tirage au sort donne dans le MÊME régime, mêmes frais, mêmes dates. */
  temoinAleatoire: "-0,70 %",
  medianeNegative: true,
} as const;

/** Détail par moteur, pour les textes qui expliquent d'où vient le débit. */
export const DEBIT_PAR_MOTEUR = {
  relative_strength: "2,17",
  cassure_canal: "0,55",
  expansion_volatilite: "0,13",
  carry_funding: "1,15",
  momentum_4h: "1,00",
  faiblesse_4h: "1,97",
} as const;

/**
 * LE CARRY N'ARRIVE PAS EN FLUX, IL ARRIVE EN SALVES — et l'omettre rendait le
 * chiffre ci-dessus vrai en moyenne et faux dans le vécu.
 *
 * Relevé du 15/08/2026 : les 10 signaux de carry jamais émis l'ont TOUS été le
 * 06/08 à 06:00. Aucun depuis, et aucun avant le 25/08, date à laquelle la
 * première position de 21 jours se libère. Sur la période, 10 ÷ 8,5 jours fait
 * bien 1,18 par jour — mais personne ne vit une moyenne. L'abonné a reçu dix
 * signaux un matin, puis trois semaines de silence.
 *
 * La cause n'est pas un plafond de places (40 disponibles, 10 occupées) : ce
 * sont les mêmes trois ou quatre noms qui dominent le classement chaque jour,
 * déjà en position, et rien de nouveau ne franchit la barre.
 *
 * Un abonné qui lit « 1,15 par jour » et ne voit rien pendant trois semaines
 * conclut que le service est en panne. Le dire d'avance coûte une phrase ; le
 * laisser découvrir coûte un abonnement.
 */
export const CARRY_EN_SALVES =
  "Le carry n'arrive pas au compte-gouttes : il part par salves de plusieurs positions le même jour, " +
  "puis se tait jusqu'à ce que les précédentes arrivent à échéance (21 jours). Sur la durée la moyenne " +
  "tient, mais une semaine sans carry est normale.";
