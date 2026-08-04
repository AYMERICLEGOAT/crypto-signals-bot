# Quatre familles de signaux — 4 août 2026

Objectif posé : **2 à 6 signaux par jour, tous les jours**, avec une qualité que
les abonnés ressentent. Ce document dit ce qui est atteint, ce qui ne l'est pas,
et pourquoi.

---

## 1. Pourquoi une seule stratégie ne peut pas y arriver

C'est arithmétique. Avec 40 paires tenues 7 jours, le plafond absolu est de
5,7 entrées par jour **en prenant l'univers entier** — c'est-à-dire en ne
sélectionnant plus rien. La qualité s'effondre bien avant : de +3,33 %
d'espérance à top 5 jusqu'à +1,74 % à top 20.

La réponse est un **portefeuille de familles décorrélées**. Chacune apporte
0,3 à 1,1 signal par jour ; ensemble elles atteignent le compte, et la
diversification améliore la courbe au lieu de la dégrader.

---

## 2. Ce qui a été testé, et ce qui a survécu

Protocole identique pour tout : 2020-2026, entrée décalée d'un jour, frais
réels, walk-forward annuel, et **témoin aléatoire** — une famille qui ne bat pas
un tirage au sort à contraintes égales ne vaut rien, quelle que soit son
espérance affichée.

| famille | signaux/j | réussite | moyenne | permutation | verdict |
|---|---|---|---|---|---|
| Force relative (momentum transversal) | 1,14 | 47,7 % | +3,22 % | — | **retenue** |
| Cassure de canal 50 j (achat) | 0,45 | 48,8 % | +4,67 % | **p = 0,000** | **retenue** |
| Expansion de volatilité | 0,16 | 46,6 % | +2,59 % | **p = 0,017** | **retenue** |
| **Carry de financement** | 0,32 | **86,1 %** | +1,04 % | **p = 0,000** | **retenue** |
| Cassure de canal (vente) | 0,43 | 49,0 % | −0,68 % | p = 0,583 | rejetée |
| Rebond de capitulation | 0,16 | 51,0 % | +0,41 % | p = 0,650 | rejetée |
| Momentum transversal à la vente | 6,3/sem | 50,3 % | −0,88 % | p = 1,000 | rejetée |

### Les cassures à plusieurs horizons ne sont PAS des familles séparées

20, 50 et 100 jours corrèlent entre elles à **0,60-0,81**. Ce sont des variantes
d'un même signal. Elles augmentent le compte mais pas la diversification, et il
ne faut pas les présenter comme indépendantes.

Le carry, lui, est à **−0,01 / +0,02** avec toutes les autres. C'est de la vraie
décorrélation.

---

## 3. Le carry de financement : la découverte de cette session

**Principe.** On détient le spot et on vend le perpétuel pour le même montant.
Les deux jambes s'annulent : la position ne gagne ni ne perd quand le prix
bouge. Le rendement vient uniquement du **taux de financement**, versé toutes
les 8 heures entre acheteurs et vendeurs de perpétuels. Il est positif 74,2 %
des jours — les acheteurs à levier étant plus nombreux, c'est le vendeur qui
encaisse.

**Pourquoi c'est important ici.** C'est la **seule** famille positive dans les
deux régimes de marché :

| | marché favorable | marché défavorable |
|---|---|---|
| top 5 / 30 j | +1,620 % — 94,8 % gagnants | **+0,382 % — 80,7 %** |
| top 10 / 30 j | +1,549 % — 93,3 % | **+0,312 % — 75,5 %** |
| top 20 / 14 j | +0,620 % — 81,4 % | −0,080 % — 44,0 % |

**Sept années positives sur sept**, y compris 2022 et 2026 qui ont tué tout le
reste. Le financement passé prédit le futur (corrélation **+0,687** à 7 jours),
donc la sélection sur données passées fonctionne réellement.

**Profil de risque sain** sur l'univers de 38 paires : pire position **−2,25 %**,
et le pire 1 % ne pèse que 1 % du gain total. Ce n'est pas « ramasser des pièces
devant un rouleau compresseur ».

**Ce n'est pas sans risque**, et aucune communication ne devra le prétendre :
liquidation de la jambe vendeuse si la marge est insuffisante, écart de prix
entre spot et perpétuel, risque de plateforme.

---

## 4. Le système complet, mesuré

| | signaux/jour | réussite | moyenne |
|---|---|---|---|
| **Marché favorable** (57 % du temps) | **3,25** | **52,7 %** | **+3,52 %** |
| Marché défavorable (43 %) | 0,31 | 75,5 % | +0,31 % |

53 % des jours ont au moins un signal ; les jours actifs en ont **3 en médiane**,
et 81 % d'entre eux en ont au moins 2.

La réussite passe de 47,7 % (force relative seule) à **52,7 %**, et l'espérance
de +3,22 % à **+3,52 %**. La diversification améliore les deux.

**Année par année :**

| année | signaux/j | réussite | moyenne |
|---|---|---|---|
| 2020 | 2,19 | 56,2 % | +5,24 % |
| 2021 | 2,43 | 56,9 % | +8,36 % |
| 2022 | 0,36 | 74,6 % | +0,22 % |
| 2023 | 2,89 | 58,3 % | +2,56 % |
| 2024 | 2,88 | 52,8 % | +3,38 % |
| 2025 | 2,40 | 44,3 % | **−0,99 %** |
| 2026 | 0,28 | 55,0 % | +0,01 % |

2025 reste négative : le filtre était ouvert mais le momentum n'a pas payé.
Aucune année n'est catastrophique, ce qui est nouveau.

---

## 5. L'objectif est-il atteint ?

**Oui pendant 57 % du temps** : 3,25 signaux/jour, dans la fourchette demandée,
avec une qualité améliorée.

**Non pendant les 43 % restants** : 0,31/jour. Sept façons de produire des
signaux en marché baissier ont été testées et six réfutées au témoin aléatoire.
Seul le carry survit, et il ne donne qu'un tiers de signal par jour sur
l'univers sûr.

### La piste qui doublerait le baissier, et pourquoi elle n'est pas livrée

Élargir l'univers du carry de 38 à 118 perpétuels fait passer le baissier de
0,31 à **0,69 signal/jour** à top 15 / 21 jours, avec 78,8 % de gagnants.

Mais la pire position passe de **−2,25 % à −68 %**. Sur une position vendue
comme neutre au marché, c'est inacceptable pour des abonnés particuliers.
Plafonner le financement d'entrée à 0,10 %/jour ramène le pire cas à −25 % —
mieux, mais toujours pas livrable.

**Ce qui manque pour la débloquer** : un stop sur le financement cumulé payé
(fermer la position si elle coûte plus de X %), qui bornerait mécaniquement la
perte. C'est simple à opérer — une vérification quotidienne — mais ça n'a pas
été mesuré, et rien ne part en production sans mesure.

---

## 6. Ce qu'il ne faut pas dire aux abonnés

- Le carry n'est **pas sans risque** : liquidation, écart spot/perpétuel,
  plateforme.
- Les cassures 20/50/100 jours ne sont **pas trois familles indépendantes**.
- Le système ne produit **rien ou presque** 43 % du temps.
- 2025 a été négative malgré le filtre ouvert.
- Le signal médian des familles directionnelles **perd** de l'argent : la
  rentabilité vient d'une minorité de gros gagnants, donc il faut prendre
  **tous** les signaux. Le carry est l'exception — sa médiane est positive
  (+0,49 %), ce qui en fait le seul dont chaque signal est individuellement
  satisfaisant.

---

## 7. Modules

| module | rôle |
|---|---|
| `backtest_familles.py` | les quatre familles au même protocole, témoin aléatoire |
| `backtest_carry_funding.py` | le financement est-il positif, prévisible, rentable |
| `backtest_carry_frontiere.py` | carry par régime, frontière quantité/qualité, pire cas |
| `backtest_carry_univers.py` | élargissement à 118 perpétuels |
| `backtest_portefeuille_final.py` | assemblage, comptage réel, corrélations |
