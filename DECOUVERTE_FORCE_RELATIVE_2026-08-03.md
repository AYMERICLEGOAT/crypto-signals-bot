# Le premier avantage mesuré du projet — 3 août 2026

Après ~35 pistes testées et réfutées, une famille de stratégies passe enfin
l'intégralité du protocole de validation. Ce document consigne ce qui a été
trouvé, comment ça a été vérifié, et surtout ce qu'il ne faut **pas** en dire.

---

## 1. Pourquoi tous les tests précédents étaient inconcluants

Tous les backtests du projet tournaient sur **730 jours**, non pas parce que
c'était la donnée disponible mais parce que `DAYS = 730` était écrit en dur
dans `backtest_cross_momentum.py`.

Avec un rééquilibrage hebdomadaire, 730 jours ne font que **104 observations**,
et **52** une fois coupées en deux pour le hors échantillon. À ce niveau, un
avantage réel de 1 %/semaine et du bruit pur sont mathématiquement
indiscernables. Les tests ne réfutaient rien : ils manquaient de puissance, et
ce silence était lu comme un rejet.

`fetch_long_history.py` descend maintenant jusqu'à 2017. À partir d'août 2020,
au moins 20 paires cotent simultanément — **2 184 jours, ~312 observations**,
couvrant le bull 2021, l'effondrement 2022 (Terra, FTX), la reprise 2023 et le
cycle 2024-2026. Plusieurs régimes complets au lieu d'une fenêtre étroite.

---

## 2. La découverte : le signe était inversé

Origine documentaire : **Fieberg, Liedtke, Poddig, Walker & Zaremba**, *Journal
of Financial and Quantitative Analysis*, 2024 — 3 245 cryptomonnaies, avril
2015 à mai 2022, quintiles rebalancés chaque semaine :

| quintile RSI(14) | rendement hebdomadaire |
|---|---|
| bas | +0,00 % |
| haut | **+3,52 %** |

La production achète sur **RSI < 40**, c'est-à-dire précisément le quintile
bas. Vérification sur nos propres données, 6 ans, net de frais :

| mesure | résultat |
|---|---|
| Écart HAUT − BAS | **positif sur 18/18** combinaisons, +92,5 pt/an |
| Version neutre au marché | **18/18 positives**, +37,8 %/an, Sharpe ≈ 1,0 |
| Hors échantillon strict (sélection 2020-2023 → test 2024-2026) | **18/18 positives**, +18,5 %/an |

---

## 3. Les trois attaques qu'il a fallu passer

Ce résultat étant de loin le meilleur du projet, il méritait la plus grande
méfiance. `backtest_rsi_attaque.py` :

| attaque | question | résultat |
|---|---|---|
| **Le bêta** | est-ce juste « acheter le marché » ? | l'équipondéré acheté-conservé rend +31,3 %/an ; le côté HAUT le bat **18/18** |
| **La simultanéité** | le signal est lu sur la clôture où l'on entre | entrée repoussée d'un jour entier : **18/18 encore positives** |
| **Le biais d'univers** | les 40 paires sont les survivantes d'aujourd'hui | restreint aux 18 paires cotées avant 2020 : écart positif **18/18**, +69,6 pt/an |

**Concentration temporelle** : 17 trimestres positifs sur 23. Le meilleur
(2021T1) ne pèse que 20 % des gains ; sans lui, +8,0 % par trimestre en
moyenne. Ce n'est pas un accident isolé.

---

## 4. Le filtre de tendance, sans lequel rien ne tient

Le classement seul n'est positif que **4 années sur 7** : il gagne en marché
haussier et perd en baissier — dont maintenant.

Le remède est **antérieur et extérieur au projet** : le *dual momentum*
d'Antonacci (2014), qui combine momentum relatif (quel actif) et momentum
absolu (faut-il être investi du tout). Ce n'est pas un paramètre retenu parce
qu'il embellissait la courbe.

| filtre | signaux/sem | réussite | espérance/signal | années positives |
|---|---|---|---|---|
| aucun | 6,2 | 47,8 % | +1,70 % | 4/7 |
| **BTC > MM200** | 3,5 | 49,7 % | **+3,33 %** | **4/5** — *zéro signal en 2022 et 2026* |

Le filtre ne rend pas les mauvaises années moins mauvaises : **il les fait
disparaître**.

---

## 5. La géométrie : le stop serré détruit l'avantage

`backtest_stop_impact.py`, sur 6 ans, mèches intrajour simulées :

| stop | réussite | espérance | sorties sur stop |
|---|---|---|---|
| 1,0 × ATR | 36,7 % | +2,05 % | 56 % |
| 2,0 × ATR | 46,6 % | +2,23 % | 27 % |
| **4,0 × ATR** | **48,9 %** | **+2,74 %** | **5 %** |
| 6,0 × ATR | 49,3 % | +3,02 % | 1 % |

Et l'objectif coûte encore plus cher : stop 2× / objectif 3× tombe à
**+0,38 %**, soit **87 % de l'avantage détruit**. Les gains viennent de rares
très gros mouvements ; les couper tôt revient à couper la stratégie.

Or la production tournait avec **SL à 1,2 × ATR et TP1 à 1,3 × ATR** — presque
exactement la pire configuration possible pour ce type de signal.

---

## 6. Le résultat, sans embellissement

Simulation de portefeuille **réellement composée** (`backtest_final_portefeuille.py`),
univers non contaminé, entrée décalée d'un jour, 0,10 % de frais :

| | capital final | CAGR | drawdown max | rend./risque |
|---|---|---|---|---|
| Acheter et ne rien faire | — | — | −79,8 % | — |
| Force relative, sans filtre | x12,2 | +52,9 %/an | −90,0 % | 0,52 |
| **Force relative + filtre MM200** | **x35,5** | **+83,3 %/an** | **−62,9 %** | **1,04** |

**Année par année** — la stratégie ne bat l'achat-conservation que 4 années
sur 7. Sa vraie valeur est ailleurs : **aucune année perdante en 6 ans**, là où
détenir a coûté −70,9 % (2022), −51,4 % (2025) et −39,4 % (2026).

---

## 6 bis. Trois questions tranchées après l'activation

### Combien de positions ? Top 12, mesuré sur l'univers de production

Les mesures d'établissement portaient sur 18 paires, où « top 5 » sélectionnait
28 % de l'univers. Sur les 40 paires de production, le même 5 n'en sélectionne
que 12,5 % — ni la même sélectivité, ni la même quantité.

| top | détention | signaux/sem | réussite | espérance | années + |
|---|---|---|---|---|---|
| 5 | 7 j | 3,5 | 49,7 % | +3,33 % | 4/5 |
| **12** | **7 j** | **8,0** | **47,7 %** | **+3,22 %** | **4/5** |
| 15 | 7 j | 9,5 | 47,7 % | +2,76 % | 4/5 |
| 20 | 5 j | 15,3 | 47,4 % | +1,74 % | 4/5 |

Toutes restent à 4/5 années positives : la qualité se dégrade progressivement,
pas brutalement. Top 12 multiplie les signaux par 2,3 pour 0,11 point.

### Peut-on émettre pendant les 41 % de fermeture ? Non — testé et réfuté

L'hypothèse symétrique était séduisante : si acheter les plus fortes marche,
vendre à découvert les plus faibles pendant un marché baissier devrait marcher
aussi. `backtest_faiblesse_baissier.py` :

| variante | signaux/sem | réussite | espérance | années + |
|---|---|---|---|---|
| VENTE des plus faibles, filtre fermé | 6,3 | 50,3 % | **−0,88 %** | 2/6 |
| ACHAT des plus fortes, filtre fermé *(contrôle)* | 6,4 | 44,7 % | **−0,03 %** | 4/6 |
| ACHAT des plus fortes, filtre ouvert *(référence)* | 8,3 | 48,0 % | **+2,83 %** | 4/5 |

Permutation : **40 tirages au hasard sur 40 font mieux que la sélection par
faiblesse, p = 1,000**. Pire que le hasard, et insensible au coût du short comme
à la largeur du stop.

Le contrôle est le plus instructif : la même sélection qui rapporte +2,83 %
filtre ouvert ne rapporte plus rien filtre fermé. **Le filtre capture une vraie
différence de régime.** Il n'existe pas de moyen défendable de remplir ces 41 %.

### Élargir l'univers ? Thèse soutenue, mais non validable sur 6 ans

Prendre la même fraction d'un univers plus large augmente la quantité sans
diluer la sélectivité. Sur 2023-2026, où l'univers large existe réellement :
24 → 45 paires à sélectivité constante double les signaux (5,5 → 10,9/sem) sans
dégrader la qualité (+1,11 % → +1,07 %).

Mais c'est **invalidable sur 6 ans** : parmi les 120 paires les plus liquides
aujourd'hui, seules 24 étaient cotées en août 2020. Élargir reviendrait à
sélectionner l'univers sur le volume d'aujourd'hui, soit un look-ahead massif.
Piste conservée, non appliquée.

---

## 6 ter. La distribution, ou pourquoi il faut prendre TOUS les signaux

C'est le fait le plus important du dossier, et le plus facile à taire.

| | production (40 paires) | univers propre (18) |
|---|---|---|
| moyenne | +3,22 % | +2,24 % |
| **médiane** | **−0,69 %** | **−0,94 %** |
| les 5 % meilleurs signaux | **113 % du gain total** | 136 % |
| espérance sans eux | **−0,42 %** | −0,86 % |

Déciles : 10 % à −14,8 | 25 % à −8,0 | 50 % à −0,7 | 75 % à +8,4 | 90 % à +22,4.

**Le signal médian perd de l'argent.** Toute la rentabilité vient d'une petite
minorité de très gros gagnants. Conséquence directe et non négociable : l'abonné
doit prendre **tous** les signaux, mécaniquement. En choisir quelques-uns — si
évident que paraisse le tri — revient statistiquement à ne garder que la partie
perdante de la distribution.

Corollaire pour le code : ne jamais ajouter de filtre « de bon sens » non mesuré
au moteur. Écarter les signaux qui semblent mauvais est exactement le mécanisme
qui détruit l'avantage.

---

## 7. Ce qu'il ne faut PAS dire

Quatre honnêtetés qui doivent rester attachées à cette stratégie. Les oublier
reproduirait exactement le mécanisme du « 61,2 % de réussite » affiché à tort
sur le site pendant des mois.

1. **Le RSI n'est pas l'ingrédient magique.** Un simple classement par
   rendement passé fait aussi bien (+1,57 % contre +1,70 % d'espérance). Le RSI
   est une manière de mesurer le momentum parmi d'autres.

2. **Le filtre fait la majeure partie du travail.** Sur univers filtré, prendre
   *toutes* les paires au lieu des 5 meilleures rapporte encore +2,24 % par
   signal. Le classement n'ajoute qu'environ **1,1 point**.

3. **Le chiffre à annoncer n'est pas le CAGR.** Pour un abonné entrant à une
   date au hasard : **médiane +5,0 % à six mois, 53 % d'entrées gagnantes,
   pire cas −61,7 %**. Ce n'est pas un produit qui enrichit, c'est un produit
   qui limite la casse.

4. **Les variantes à 14 jours affichant x700 à x1820 sont un artefact** de
   composition sur quelques gagnants à +400 %. Elles ne sont pas retenues et ne
   doivent jamais être citées.

---

## 8. État actuel en production

Le moteur `relative_strength.py` est câblé dans `main.py`, tourne une fois par
jour à 01 h UTC, et a été testé en direct contre l'API Binance le 3 août 2026 :

- 40/40 paires récupérées ;
- **BTC à 10,7 % SOUS sa MM200** → filtre fermé → **0 signal émis**, ce qui est
  le comportement correct ;
- tête du classement : UNI (RSI 62,4), ADA (59,3), SHIB (57,1) ;
- **queue du classement — ce que la production achète actuellement** : CHZ
  (27,9), ATOM (30,2), GRT (32,1).

### Conséquence commerciale à trancher

Le nouveau moteur restera **silencieux tant que BTC n'aura pas repassé sa
MM200**. Pour un canal payant, c'est un problème de produit qui ne peut pas
être résolu par du code : soit le canal assume des périodes sans signal en
l'expliquant (c'est défendable et même vendeur : *« on ne trade pas dans un
marché baissier »*), soit il continue à diffuser les moteurs existants.

Réserve importante : les moteurs existants opèrent en **1 h**, pas en
journalier transversal. Le fait que le sens « RSI bas » perde à l'horizon
journalier transversal **ne prouve pas formellement** qu'ils perdent aussi à
leur propre horizon. Ce test-là reste à faire.

---

## 9. Modules de validation

À relire avant toute modification des constantes `RS_*` de `config.py` :

| module | ce qu'il établit |
|---|---|
| `fetch_long_history.py` | historique 2017-2026, couverture par paire |
| `backtest_rsi_inverse.py` | première comparaison des deux sens, permutation |
| `backtest_rsi_neutral.py` | version neutre au marché, réfutée sur 24 mois seuls |
| `backtest_rsi_long.py` | les deux sens sur 6 ans, walk-forward annuel |
| `backtest_rsi_attaque.py` | bêta, simultanéité, biais d'univers, concentration |
| `backtest_rsi_production.py` | mesure signal par signal, contrôle momentum |
| `backtest_dual_momentum.py` | filtres de tendance comparés |
| `backtest_final_portefeuille.py` | courbe composée réelle, expérience abonné |
| `backtest_stop_impact.py` | coût exact du stop et de l'objectif |
| `test_relative_strength.py` | vérifications du moteur, dont **le sens** |
