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

## Recherche d'un vrai edge : trois pistes testées, trois échecs

Après le correctif de géométrie, recherche d'une amélioration de fond. La
démarche : décomposer d'abord où l'argent se perd (`backtest_decompose.py`)
plutôt que d'essayer un nouvel indicateur au hasard — les explorations
d'indicateurs d'entrée (#111-#137 : ML, Hurst, GARCH, cointégration, order
book, funding rate…) n'avaient quasiment rien donné.

### Piste 1 — Filtrer par paire : sans intérêt

Une seule paire (ETH/USDT) est perdante sur les deux semestres, et
l'exclure ne change presque rien (+0,1281% → +0,1345%). Les pertes sont
réparties, pas concentrées.

### Piste 2 — Ne garder que les VENTES : artefact de régime

La décomposition sur 12 mois semblait spectaculaire :

| | Semestre 1 | Semestre 2 |
|---|---|---|
| BUY (n≈500) | −0,0005% | −0,1016% |
| SELL (n≈396) | +0,2846% | +0,2044% |

Tout l'edge venait des ventes. Tentation forte de couper les achats.
Test décisif sur 24 mois découpés en 4 périodes, avec la tendance BTC en
regard (`backtest_direction_regime.py`) :

| Période | BTC | BUY | SELL | Tous |
|---|---|---|---|---|
| 1 | **+63,8%** | −0,037% | **−0,417%** | **−0,276%** |
| 2 | +9,6% | +0,006% | +0,260% | +0,151% |
| 3 | −27,3% | −0,007% | +0,251% | +0,111% |
| 4 | −25,0% | −0,060% | +0,216% | +0,059% |

En marché fortement haussier, les ventes perdent −0,417% — le pire chiffre
du tableau. L'« avantage des ventes » ne disait rien d'autre que « le
marché a baissé pendant la période testée ». Couper les achats aurait
explosé au prochain marché haussier. **Non appliqué.**

### Piste 3 — Filtre de régime de marché : ne tient pas

Le tableau ci-dessus suggérait pourtant quelque chose de causal : la
stratégie est un RETOUR À LA MOYENNE (RSI extrême + croisement EMA), et le
retour à la moyenne se fait écraser en tendance forte. Hypothèse : couper
quand BTC part fort à la hausse.

Testé avec la tendance BTC 14 jours glissants, causale, sur les 1 635
trades des 24 mois (`backtest_market_regime.py`). Aucun seuil de coupure ne
rend l'espérance positive sur les quatre périodes — au mieux, la période 1
passe de −0,316% à −0,228%. Et les tranches de tendance ne montrent aucune
structure monotone : les extrêmes perdent des DEUX côtés (BTC < −15% :
−0,60% ; BTC > +30% : −0,56%), le milieu est plat. C'est du bruit, pas un
régime capturable par cet indicateur. **Non appliqué.**

## Le chiffre qu'il faut regarder en face

**Sur 24 mois, avec la géométrie corrigée, l'espérance globale est de
−0,0191% par trade. Négative.**

Le +0,031% mesuré plus haut portait sur 12 mois : c'était lui-même une
fenêtre favorable. Trois des quatre derniers semestres sont positifs
(+0,211%, +0,049%, +0,035%), mais le semestre fortement haussier est à
−0,316% et efface le reste.

Ce n'est pas un défaut de réglage : c'est un mode d'échec structurel du
retour à la moyenne en tendance forte, qui reviendra au prochain marché
haussier. Aucune des trois pistes ci-dessus ne le neutralise.

Conclusion honnête : **cette approche EMA/RSI est au mieux marginale.**
Après ~30 pistes explorées (#111-#137 puis celles-ci), les données ne
soutiennent pas l'existence d'un edge robuste exploitable avec les seules
données publiques gratuites dont dispose le projet. Le correctif de
géométrie et le correctif de rattrapage restent des gains réels — le
premier sur la qualité, le second sur le volume livré — mais ils
n'inventent pas un avantage qui n'existe pas.

Ce que cela implique concrètement :

1. Ne pas promettre de performance aux abonnés. La page transparence et le
   journal public existent déjà : c'est la bonne posture, il faut s'y tenir.
2. `edge_guard.py` (livré) suspendra automatiquement la diffusion si
   l'espérance réalisée devient nettement négative sur ≥30 trades clôturés.
   C'est le filet de sécurité qui manquait.
3. La valeur défendable du service est la discipline et la transparence
   (niveaux définis à l'avance, suivi public des résultats, gestion du
   risque), pas un rendement supérieur au marché.
4. Un edge réel demanderait vraisemblablement des données que le projet n'a
   pas (flux d'ordres, taux d'emprunt, IV) — plusieurs de ces pistes ont
   déjà été bloquées faute de clé API (#126, #127, #131, #132, #133).

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
