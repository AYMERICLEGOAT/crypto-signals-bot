# Pourquoi il n'y avait presque aucun signal — diagnostic du 01/08/2026

## Le symptôme

2 signaux seulement depuis le 26 juillet (6 jours), alors que la stratégie
en production est censée en produire ~2,5 par jour.

## La cause : les signaux étaient perdus, pas absents

En rejouant 7 jours de vraies bougies horaires dans le `detect_signal` exact
de la production (40 paires) :

| Étape de l'entonnoir | Compte |
|---|---|
| Bougies évaluées | 6 384 |
| Croisements EMA | 924 |
| … confirmés par le RSI | 37 |
| … rejetés par le filtre ADX | 27 |
| **Signaux que la stratégie aurait dû produire** | **10 (1,43/jour)** |
| Signaux réellement émis en production | **0** |

La stratégie fonctionnait. C'est la plomberie qui perdait tout.

`detect_signal()` n'examinait **que la dernière bougie close**. Or les
déclenchements planifiés de GitHub Actions sont « best effort » : mesuré sur
l'historique réel des exécutions, le cron horaire ne partait qu'environ
**12 fois par jour au lieu de 24** (relevé : 02:15, 03:42, 06:37, 09:12 —
jusqu'à 3h d'écart). Chaque bougie jamais évaluée emportait définitivement
ses croisements : aucun rattrapage n'était possible au cycle suivant.

Mesure sur données réelles (300 bougies × 39 paires, cron simulé toutes les
3 bougies) : **25 signaux réels, 6 seulement étaient vus — 24 %.**

## Le correctif

1. `strategy.detect_signals_with_catchup()` balaie les 6 dernières bougies
   closes à chaque cycle. Un cycle manqué est rattrapé au suivant.
2. `strategy.is_still_actionable()` : un signal rattrapé n'est diffusé que
   s'il est **encore prenable** au prix courant (stop non franchi, TP1 non
   atteint, moins de 35 % du chemin vers TP1 parcouru). Sans ce garde-fou,
   on annoncerait une entrée que le marché a déjà quittée.
3. `storage.pairs_signalled_since()` : anti-doublon, une requête par cycle.
4. `signals.yml` passe de 1 h à 30 min : deux chances par bougie horaire.

Propriété vérifiée (`test_catchup.py`, 1 600 comparaisons sur données
réelles) : **aucun regard vers le futur**. Évaluer la bougie k du DataFrame
complet donne exactement le même résultat qu'évaluer la dernière bougie du
DataFrame tronqué à k. Le rattrapage ne « découvre » donc rien qui n'aurait
pas été détectable à l'heure.

## Ce qui a été refusé, et pourquoi

Le filtre RSI élimine 96 % des croisements (924 → 37). Tentation évidente :
l'assouplir pour multiplier les signaux. Testé sur 12 mois / 39 paires :

| Variante | Signaux/j | Win rate | Espérance/trade | Drawdown |
|---|---|---|---|---|
| **A0 production (fenêtre 1, seuils 40/60)** | 2,48 | 60,3 % | **+0,0099 %** | 56,5 % |
| A1 fenêtre 2 | 6,30 | 58,4 % | −0,0473 % | 91,7 % |
| A2 fenêtre 3 | 8,79 | 59,8 % | −0,0065 % | 85,3 % |
| A3 fenêtre 4 | 10,26 | 60,1 % | −0,0003 % | 90,3 % |
| A4 fenêtre 6 | 11,98 | 59,9 % | −0,0073 % | 94,9 % |
| B2 fenêtre 1 + seuils 45/55 | 10,81 | 60,9 % | +0,0103 % | 86,5 % |
| B1 fenêtre 3 + seuils 45/55 | 15,09 | 61,3 % | +0,0326 % | 87,9 % |

B1 paraissait excellent : 6× plus de signaux, meilleur win rate, espérance
triplée. **Validation walk-forward sur deux moitiés indépendantes de 6 mois :**

| Variante | Moitié 1 (espérance) | Moitié 2 (espérance) |
|---|---|---|
| A0 production | +0,0653 % | **−0,0290 %** |
| B2 | +0,0418 % | −0,0201 % |
| B1 | +0,0830 % | −0,0073 % |

B1 bat la production sur les deux moitiés — critère de stabilité rempli.
Mais en agrégeant (signaux/jour × espérance), sur la moitié **récente** :

- A0 production : 2,55/j × −0,0290 % = **−0,074 %/jour**
- B1 : 15,95/j × −0,0073 % = **−0,116 %/jour**
- B2 : 11,38/j × −0,0201 % = **−0,229 %/jour**

B1 perd **plus** que la production actuelle en régime défavorable, malgré une
meilleure espérance par trade, parce qu'il prend 6× plus de positions. Et son
drawdown double (87,9 % contre 45,0 %). Ce n'est pas un edge supérieur :
c'est un **amplificateur de régime** (+1,17 %/jour en moitié 1, −0,12 %/jour
en moitié 2).

**Décision : les seuils RSI restent inchangés.** Même raisonnement que pour
le moteur Squeeze (voir `SQUEEZE_EXPLORATION_2026-07-31.md`) — multiplier les
trades sur une espérance qui n'est pas solidement positive accélère les
pertes au lieu de les compenser.

## Le point qui demande une décision produit

Le walk-forward révèle autre chose, indépendant de tout ce qui précède :
**l'espérance de la stratégie en production est passée de +0,065 % à
−0,029 % par trade entre les deux semestres.** L'edge s'est érodé sur les
6 derniers mois, sur toutes les variantes testées sans exception.

Ce n'est pas un bug et le correctif de rattrapage ne le change pas : il fait
correctement circuler les signaux que la stratégie produit. Mais cela veut
dire que la fréquence n'est pas le vrai sujet — la robustesse de l'edge l'est.
Pistes à instruire avant d'en promettre davantage aux abonnés :

1. Re-valider la stratégie sur une fenêtre glissante et suspendre
   automatiquement si l'espérance mesurée passe durablement sous zéro.
2. Publier la performance réelle observée plutôt que celle du backtest
   (la page transparence existe déjà pour ça).
3. Considérer que 2-3 signaux/jour de qualité vérifiée vaut mieux que 15
   signaux/jour dont l'espérance dépend du régime de marché.
