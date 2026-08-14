# Le momentum 4H bat-il un tirage au sort ?

**14/08/2026** — `signals/backtest_momentum4h_temoin.py`

## Pourquoi cette étude

Le momentum 4H est le **seul** moteur directionnel actif : le filtre de tendance
est fermé depuis novembre 2025, ce qui coupe la force relative, la cassure de
canal et l'expansion de volatilité. Il porte donc à lui seul tout le
directionnel que reçoit un abonné.

Deux faits ont motivé la mesure :

1. Son relevé **réel** en base : 10 clôtures, 3 gagnantes, **−0,07 % par
   trade** — contre **+0,805 %** publiés sur chaque signal.
2. Ce projet possède le protocole qui tranche ce genre de question, et il a un
   antécédent gênant : le **témoin aléatoire** a réfuté le momentum transversal
   journalier avec **p = 0,885**, alors qu'il paraissait excellent sur 17
   combinaisons de paramètres sur 18.

Le momentum 4H **est** un momentum transversal. Il a été livré « en
observation » sans que ce témoin lui soit jamais appliqué.

## Protocole

730 jours de bougies 4 h, 40 paires, **régime défavorable uniquement** (58,7 %
de la période), frais aller-retour comptés, entrées non chevauchantes. Trois
règles comparées à protocole strictement identique :

- **production** — acheter les N plus FORTES au RSI 42 ;
- **inversée** — acheter les N plus FAIBLES (thèse de Fieberg, Liedtke, Poddig,
  Walker & Zaremba, *JFQA* 2024 : renversement de court terme en crypto) ;
- **témoin aléatoire** — mêmes dates, même nombre de positions, même durée,
  mêmes frais, paires tirées au sort. 300 tirages.

## Résultat 1 — le moteur a un avantage réel

| Règle | Trades | Espérance | p (témoin) |
|---|---|---|---|
| Production (plus fortes) | 153 | **+0,444 %** | **0,007** |
| Inversée (plus faibles) | 196 | −1,169 % | 0,950 |
| Témoin aléatoire | — | −0,648 % | — |

Le témoin est le chiffre décisif : **un panier de deux cryptos tiré au sort perd
0,65 % sur trois jours dans ce régime.** Le marché baisse — c'est la définition
du régime. Le moteur, lui, gagne. L'avantage n'est pas « +0,44 % », c'est
**+1,09 points contre le hasard**.

La thèse du renversement est **réfutée** : à l'envers, la stratégie fait moins
bien que le hasard (p = 0,950).

## Résultat 2 — le réglage livré était le mauvais

Balayage de 100 combinaisons (RSI 21→84, détention 1→7 jours, top 1→5) :

| Positions | Espérance moyenne de région | Combinaisons positives |
|---|---|---|
| **top 1** | **+0,061 %** | 64 % |
| top 2 | −0,242 % | 48 % |
| top 3 | −0,398 % | 32 % |
| top 5 | −0,624 % | 4 % |

La dégradation est **monotone** : signature d'un avantage réel concentré en tête
de classement, pas d'un point de chance dans une grille. La durée de 3 jours est
confirmée comme la meilleure (+0,420 % de moyenne de région).

## Résultat 3 — le test qui tranche : la fragilité

| | Espérance | p | Trimestres positifs | **Sans le meilleur trade** |
|---|---|---|---|---|
| **top 1** | **+1,862 %** | **0,0000** | 5 / 6 | **+0,896 %** |
| top 2 | +0,444 % | 0,0067 | 4 / 6 | **−0,081 %** |

**Tout l'avantage de top 2 venait d'UN SEUL trade à +80 % sur deux ans.**
Retirez-le, la stratégie ne bat plus rien. Top 1 y survit largement et reste
très au-dessus du témoin.

Aucun des 300 tirages aléatoires n'égale top 1.

## Décision

`M4H_TOP_N` passe de **2 à 1**.

**Ce que ça coûte** : moitié moins de signaux, un par jour au lieu de deux.

**Ce que ça rapporte** : espérance multipliée par quatre, meilleure stabilité
trimestrielle, et surtout un avantage qui ne repose plus sur un coup de chance.
L'avantage **total par jour** augmente quand même (1 × 1,862 contre 2 × 0,444) :
la quantité perdue était de la quantité qui coûtait de l'argent.

Effet secondaire bienvenu : le canal envoie moitié moins de messages.

## Ce qui est maintenant publié, et qui ne l'était pas

Le taux de réussite est de **43,9 %** et la **médiane est négative** (−1,18 %).
Ce moteur vit de quelques gros gains, pas de la fréquence.

Ce chiffre existait dans les statistiques, mais jamais dans le message que
l'abonné lit **au moment d'engager de l'argent**. Un abonné qui enchaîne six
pertes croit assister à une panne, alors qu'il assiste au régime normal de la
stratégie — et il se désabonne exactement au pire moment. La ligne de réserve du
signal le dit désormais explicitement.

Tous les textes qui annonçaient « deux places par jour » ou « les deux plus
fortes » ont été alignés : `/faq`, `/marche`, `/status`, `publishedStats.ts`,
et les trois générateurs du site.

## Ce que cette étude ne dit pas

- **730 jours, un seul régime.** L'ancienne mesure portait sur 1 100 jours ;
  cette fenêtre est plus courte, et c'est écrit dans `FENETRE_MOMENTUM_4H`.
- **82 trades** pour top 1. C'est peu. Le garde-fou d'espérance réalisée
  (`edge_guard.py`, 30 clôtures minimum) reste le juge de dernier ressort sur
  les données de production.
- **Aucun nouveau moteur n'a été trouvé.** Sept façons de produire des signaux
  en marché baissier avaient déjà été testées et six réfutées au témoin
  aléatoire ; cette étude ajoute la réfutation de la huitième (la règle
  inversée). Le gain vient de mieux régler ce qui existe, pas d'ajouter.
