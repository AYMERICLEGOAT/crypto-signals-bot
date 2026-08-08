"""
Les chiffres de débit publiés sur le site, en un seul endroit.

Même motif que workers/main-worker/src/publishedStats.ts, dont ce module est
le pendant Python : les deux doivent dire la même chose, et un chiffre recopié
à la main dans vingt gabarits HTML finit toujours par décrire un produit qui
n'existe plus.

CE QUI A ÉTÉ CORRIGÉ LE 08/08/2026. Le site annonçait « 4,35 signaux par jour
en marché favorable, 1,15 en défavorable, 2,99 en moyenne ». Ces chiffres
avaient été mesurés quand DEUX moteurs émettaient — la force relative et le
carry. Il y en a cinq. La cassure de canal et l'expansion de volatilité ont été
mises en service après cette mesure, et le momentum 4H travaille exactement
dans le régime que le site décrivait comme presque vide.

Mesures : signals/mesure_debit_signaux.py (moteurs directionnels, plafond de
l'arbitre et détention des positions simulés, août 2020 – août 2026) et
signals/mesure_debit_4h.py (momentum 4H, septembre 2023 – août 2026).
"""

# Signaux effectivement reçus par jour, après l'arbitre.
#   favorable   = 2,85 directionnels mesurés + 1,15 carry
#   defavorable = 2,00 momentum 4H mesurés + 1,15 carry
DEBIT_FAVORABLE = "4,0"
DEBIT_DEFAVORABLE = "3,1"
DEBIT_MOYEN = "3,6"

# Part du temps où le filtre de tendance est fermé. Mesuré à 42,5 % ; « 41 % »
# circulait auparavant, mesuré sur une fenêtre plus courte.
PART_FILTRE_FERME = "42 %"

# Part des jours comportant au moins un signal. « 80 % » datait de l'époque à
# deux moteurs. Mesuré : 93,5 % des jours favorables, 100 % des défavorables.
# On publie la borne basse.
PART_JOURS_AVEC_SIGNAL = "93 %"

# Maximum absolu en une journée : 5 directionnels (QUOTA_SIGNAUX_MAX) plus 3
# carrys (CARRY_MAX_NEW_PER_DAY), qui sont ajoutés APRÈS le plafond sans avoir
# concouru. Le site annonçait « jamais plus de 5 ».
MAX_PAR_JOUR = 8

# Détail par moteur, pour les pages qui expliquent d'où vient le débit.
DEBIT_PAR_MOTEUR = {
    "relative_strength": "2,17",
    "cassure_canal": "0,55",
    "expansion_volatilite": "0,13",
    "carry_funding": "1,15",
    "momentum_4h": "2,00",
}
