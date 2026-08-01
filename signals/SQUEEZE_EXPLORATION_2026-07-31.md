# Exploration bornée du moteur Squeeze — 31/07 au 01/08/2026

## Contexte

Le moteur "⚡ Squeeze Volatilité 15M" (`squeeze_engine.py`) est câblé dans
`main.py` mais désactivé en production (`ENABLE_SQUEEZE_ENGINE = False`)
depuis un backtest antérieur montrant une espérance négative à haute
fréquence (13 662 trades/12 mois, 37,4/jour, win rate TP1 58,0%, drawdown
98,7%). Cette exploration visait à trouver un filtre structurel (pas un
simple resserrage du seuil de compression, déjà écarté) qui retire les faux
départs responsables de cette espérance négative, sans perdre l'intérêt de
fréquence du moteur.

Chiffre précis de référence (recalculé via `expectancy_of`, moyenne réelle
des `pnl_pct` réalisés, plus fiable que l'estimation grossière win-rate ×
ratio gain/perte utilisée dans le commentaire historique de `config.py`) :
**espérance de base = -0,0278 %/trade**, drawdown 98,7 %.

## Méthode

1. Filtres structurels ajoutés en config, tous neutres par défaut (aucun
   changement de comportement en production) : confirmation sur bougie
   suivante, marge de cassure minimale (fraction d'ATR), régime ADX
   (mode `hc` = rejette seulement les contre-tendances fortes, mode
   `strict` = exige tendance forte ET alignée), alignement EMA HTF, volume
   multiplicateur ajustable. Implémentés à l'identique dans
   `squeeze_engine.detect_squeeze_signal` (live) et
   `backtest_squeeze._squeeze_entry_sides` (simulation vectorisée numpy —
   remplace l'ancienne boucle `.iloc` bougie par bougie, ~40x plus rapide,
   permet des dizaines d'itérations en quelques minutes au lieu d'heures).
2. Round 1 (filtres seuls et combinés, géométrie SL/TP inchangée) : aucune
   variante ne dépasse le seuil zéro. Meilleure : confirmation + ADX mode
   `hc` + HTF EMA200(≈EMA50 1h) → -0,0150 %/trade, drawdown 77,5 % (contre
   -0,0278 % / 98,7 % de base). Direction correcte, insuffisant seul.
3. Round 2 (ajustement de la géométrie SL/TP par-dessus les meilleurs
   filtres — TP1 plus proche pour sécuriser le gain plus vite, SL plus
   large pour absorber le bruit 15m au lieu de sortir sur une mèche) :

| Variante | Trades/j | Win rate TP1 | Espérance/trade | Drawdown |
|---|---|---|---|---|
| Base (aucun filtre) | 37,4 | 58,0% | -0,0278% | 98,7% |
| ADX strict + TP1=0,6×ATR + SL=2,2×ATR | 11,7 | 77,4% | -0,0035% | 40,2% |
| **ADX strict + TP1=0,5×ATR + SL=2,5×ATR** | **11,7** | **82,2%** | **+0,0033%** | **41,4%** |
| Confirmation+ADX hc+HTF200 + TP1=0,5+SL=2,5 | 16,7 | 82,0% | -0,0078% | 60,1% |
| Géométrie seule (TP1=0,5+SL=2,5), aucun filtre directionnel | 37,8 | 81,7% | -0,0063% | 88,3% |

La seule variante qui franchit les trois critères demandés (win rate > 55 %,
drawdown < 45 %, espérance positive) est **ADX strict + TP1=0,5×ATR +
SL=2,5×ATR** : `SQUEEZE_ADX_FILTER_MODE="strict"`, `SQUEEZE_ADX_THRESHOLD=25`,
`SQUEEZE_TP1_MULTIPLIER=0.5`, `SQUEEZE_SL_MULTIPLIER=2.5` (TP2/TP3/poids
inchangés).

## Pourquoi ce n'est PAS activé en production malgré ces chiffres

L'espérance trouvée (+0,0033 %/trade) est positive mais minuscule, et
**instable au voisinage immédiat des paramètres** : la variante presque
identique avec SL=2,2×ATR au lieu de 2,5×ATR (TP1 identique à 0,6 au lieu de
0,5) retombe à -0,0035 %, négative. Un résultat qui bascule de signe pour un
réglage de stop à ±0,3×ATR près, testé sur une seule fenêtre historique de
12 mois, est le signe caractéristique d'un ajustement qui colle aux
particularités de cette période précise (surapprentissage) plutôt que d'un
edge réel et répétable. Le drawdown (41,4 %) est lui aussi tout juste sous
la barre des 45 %, sans marge de sécurité.

La discipline déjà appliquée ailleurs dans ce projet (voir le commentaire
historique de `config.py` sur ce même moteur, et la méthodologie
walk-forward utilisée pour valider les moteurs Haute Confiance et Squeeze
initiaux, tâche #149) est de ne jamais activer un moteur sur la seule foi
d'un backtest in-sample optimisé sur la période qui sert aussi à le juger.//
Avant toute activation, il faudrait au minimum :

1. **Validation walk-forward** : optimiser les paramètres sur les 6-8
   premiers mois, valider sur les 4-6 derniers mois non vus pendant le
   réglage (au lieu d'optimiser et juger sur les mêmes 12 mois).
2. **Test de sensibilité** : vérifier que l'espérance reste positive sur
   une grille de paramètres voisins (±20 % sur chaque multiplicateur), pas
   seulement au point optimal trouvé.
3. Idéalement, un second univers de paires ou une période distincte pour
   confirmer que l'edge n'est pas propre aux 12 derniers mois de ce marché
   précis.

## État laissé dans le code

- `config.py`, `squeeze_engine.py`, `backtest_squeeze.py` : tous les
  nouveaux paramètres de filtrage restent à leur valeur neutre par défaut
  (`ENABLE_SQUEEZE_ENGINE` reste `False`, `SQUEEZE_TP1_MULTIPLIER` reste
  `1.0`, `SQUEEZE_SL_MULTIPLIER` reste `1.5`, etc.) — **aucun changement de
  comportement en production**. Seule l'infrastructure de filtrage/mesure
  (détection identique live/backtest, `expectancy_of`, simulation
  vectorisée numpy) est conservée, pour que la prochaine itération n'ait pas
  à repartir de zéro.
- La combinaison prometteuse ci-dessus (ADX strict + TP1=0,5× + SL=2,5×) est
  documentée ici mais **non appliquée** à `config.py` — elle doit d'abord
  passer la validation walk-forward avant toute activation.
