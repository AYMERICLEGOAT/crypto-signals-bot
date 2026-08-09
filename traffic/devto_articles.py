# -*- coding: utf-8 -*-
"""
Les articles publiés sur Dev.to, et la raison de chacun.

POURQUOI DEV.TO ET PAS AUTRE CHOSE. C'est la seule plateforme qui réunisse les
cinq conditions du projet : une API d'écriture gratuite, aucun KYC, un vrai fil
de découverte, une tolérance à l'auto-promotion quand le contenu est
substantiel, et le support de `canonical_url`. Ce dernier point est décisif :
sans lui, chaque article ferait concurrence au site sur les mêmes mots-clés au
lieu de le renforcer.

POURQUOI EN FRANÇAIS, alors que Dev.to est majoritairement anglophone. Un
lecteur anglais qui clique arrive sur un canal Telegram français : il ne peut
rien en faire, et il convertit à zéro. On échange de la portée contre de la
qualification. La valeur durable de ce levier n'est de toute façon pas le
trafic direct — c'est le lien retour vers un site hébergé sur un sous-domaine
workers.dev, dont l'autorité est proche de zéro.

CE QUE CES ARTICLES NE SONT PAS. Ce ne sont ni des signaux, ni des promesses de
gain, ni du contenu creux généré pour occuper un fil. Chacun raconte quelque
chose de vérifiable et d'utile à quelqu'un qui ne s'abonnera jamais — c'est la
seule forme de promotion qui ne se retourne pas contre son auteur, et c'est
aussi la seule qui passe les règles de la plateforme.

LES CHIFFRES VIENNENT DE published_stats.py. Aucun n'est saisi à la main ici :
c'est le module qui existe précisément parce qu'une valeur recopiée finit
toujours par décrire un produit qui n'existe plus.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "website"))

from published_stats import (  # noqa: E402
    DEBIT_FAVORABLE,
    DEBIT_DEFAVORABLE,
    DEBIT_MOYEN,
    PART_FILTRE_FERME,
    PART_JOURS_AVEC_SIGNAL,
)

SITE = "https://crypto-signals-bot-site.signalytics.workers.dev"
CANAL = "https://t.me/ProSignauxPublic"

# Appel à l'action, identique partout et volontairement discret : une ligne en
# fin d'article, jamais dans le corps. Un article dont le CTA interrompt la
# lecture est perçu comme une publicité déguisée — et il l'est.
CTA = (
    "\n\n---\n\n"
    "*Ce billet documente un projet réel : un bot de signaux crypto entièrement "
    "automatisé, dont le code, les backtests et les résultats — gagnants comme "
    f"perdants — sont publics. Le détail est sur [le site]({SITE}), et les signaux "
    f"sont publiés en clair sur [un canal Telegram ouvert]({CANAL}).*"
)


def _article(slug, titre, tags, corps, canonique):
    return {
        "slug": slug,
        "title": titre,
        "tags": tags,
        "body": corps.strip() + CTA,
        "canonical_url": f"{SITE}{canonique}",
    }


ARTICLES = [
    _article(
        "moteur-perdant-desactive",
        "J'ai mesuré ma propre stratégie de trading, elle perdait. Je l'ai supprimée.",
        ["python", "datascience", "backtesting", "opensource"],
        f"""
Pendant des mois, mon bot a publié des signaux issus d'un croisement de moyennes
mobiles EMA 9/21 filtré par le RSI. C'est la stratégie la plus enseignée du
trading amateur, et elle a l'avantage d'être facile à coder.

Puis je l'ai mesurée correctement, et c'était la mauvaise nouvelle.

## Ce qui a changé dans la mesure

Trois erreurs de méthode rendaient les résultats précédents inutilisables.

**Le biais du survivant.** Je backtestais sur les paires qui existent
*aujourd'hui*. Or les cryptos qui ont disparu entre-temps sont précisément
celles qui se sont effondrées. Mesurer une stratégie sur les seules survivantes
revient à demander aux gagnants d'un casino s'ils ont gagné. En restreignant à
18 paires non contaminées, la performance s'est effondrée.

**Le regard vers le futur.** Évaluer la bougie *k* d'un DataFrame complet ne
donne pas le même résultat qu'évaluer la dernière bougie d'un DataFrame tronqué
à *k*, si le moindre indicateur regarde en avant. La propriété à tester est
simple, et elle mérite son propre test automatisé :

```python
complet   = detect_signal(df, pair, at_index=k)
tronque   = detect_signal(df.iloc[:k + 1].reset_index(drop=True), pair)
assert (complet is None) == (tronque is None)
```

**L'absence de témoin.** Une stratégie positive sur 6 ans n'a rien démontré
tant qu'on ne l'a pas comparée à un tirage aléatoire *de même densité* — même
nombre de trades, mêmes durées de détention, mêmes paires. Sans ce témoin, on
mesure le marché, pas la stratégie.

## Le résultat

Entre -24,9 % et +16,9 % par an selon les réglages, majoritairement négatif.
La stratégie n'était pas neutre : c'était la jambe **perdante** du système.

Elle a été désactivée. Les dix signaux qu'elle avait déjà émis sont restés en
base, et l'étiquette affichée à leur sujet a été changée en « moteur retiré » —
parce que continuer à afficher « haute confiance » sur les signaux d'un moteur
qu'on vient de désavouer serait un mensonge rétroactif.

## Ce que j'en retiens

Un backtest positif est une hypothèse, pas une preuve. La question utile n'est
jamais « est-ce que ça gagne ? » mais « est-ce que ça gagne **plus que le
hasard, à contraintes égales** ? ». Les stratégies qui survivent à cette
question sont beaucoup moins nombreuses qu'on ne l'espère.

Le plus dur n'a pas été de coder le test. Ça a été d'accepter son résultat sur
du code que j'avais déjà mis en production.
""",
        "/a-propos.html",
    ),
    _article(
        "temoin-aleatoire-backtest",
        "Votre backtest bat-il vraiment le hasard ? Le test de permutation, en Python",
        ["python", "datascience", "statistics", "backtesting"],
        f"""
Un backtest qui rend +40 % sur six ans ne prouve rien. Le marché lui-même a
peut-être fait +200 % sur la période. La seule question qui compte est de savoir
si votre règle fait mieux qu'un tirage au sort soumis aux **mêmes contraintes**.

## Le témoin doit avoir la même densité

L'erreur classique est de comparer sa stratégie à « acheter et conserver ». Ce
n'est pas un témoin valable : elle n'a ni le même nombre de positions, ni les
mêmes durées, ni la même exposition.

Le bon témoin tire ses entrées **au hasard**, mais reproduit exactement le reste :

```python
def temoin_aleatoire(dates_possibles, n_signaux, jours_detention, rng):
    entrees = rng.choice(dates_possibles, size=n_signaux, replace=False)
    return [(d, d + jours_detention) for d in entrees]
```

On répète ce tirage 1 000 fois, on calcule l'espérance de chaque tirage, et on
regarde où tombe la stratégie réelle dans cette distribution.

## Lire le résultat

La p-valeur est la proportion de tirages aléatoires qui font aussi bien ou mieux
que la stratégie. Si 3 tirages sur 1 000 la battent, p = 0,003.

Sur mes deux moteurs directionnels retenus, la barre était fixée **avant** de
regarder : au moins 60 signaux, espérance positive, p < 0,05, et au moins
4 années positives. Un moteur qui échoue à un seul de ces critères est écarté,
même s'il « a l'air » bon.

Fixer la barre avant est ce qui distingue une mesure d'une justification.

## Le piège qui reste

Un test de permutation ne protège pas du surapprentissage. Si vous avez essayé
200 variantes de paramètres et gardé la meilleure, votre p-valeur est fausse :
avec 200 essais, obtenir p < 0,05 par pur hasard est presque certain.

La parade est la validation *walk-forward* : on optimise sur une fenêtre, on
teste sur la suivante, jamais vue, et on avance. Ce qui survit à ça a une chance
d'exister en dehors du tableur.

Le filtre le plus rentable de mon système n'est d'ailleurs pas une règle
d'entrée : c'est une règle d'abstention. Il coupe les moteurs directionnels
{PART_FILTRE_FERME} du temps. Sans lui, la stratégie n'est positive que 4 années
sur 7 ; avec lui, aucune année perdante sur 6 ans.
""",
        "/comment-ca-marche.html",
    ),
    _article(
        "bot-telegram-serverless-zero-euro",
        "Un bot Telegram en production pour 0 €/mois : Cloudflare Workers + Supabase + GitHub Actions",
        ["serverless", "cloudflare", "typescript", "webdev"],
        f"""
Le projet tourne depuis des mois sans serveur à administrer et sans facture.
Voici la répartition des rôles, et surtout les pièges rencontrés.

## Qui fait quoi

**Cloudflare Workers** porte le bot : webhook Telegram, ~30 tâches planifiées
sur deux crons (`*/5` et `*/15`), et le site statique. Le plan gratuit suffit
largement.

**Supabase** sert de base Postgres, interrogée via PostgREST.

**GitHub Actions** exécute les calculs lourds en Python — ceux qui demandent des
minutes de CPU et des dépendances que le runtime Workers n'a pas.

## Piège 1 : `not.eq` exclut aussi vos NULL

Le plus coûteux, parce qu'il est silencieux. En PostgREST :

```
GET /users?statut=not.eq.actif
```

ne retourne **pas** les lignes dont `statut` est NULL. C'est la sémantique SQL
correcte — toute comparaison avec NULL vaut NULL, donc pas vrai — mais ce n'est
pas ce qu'on lit. Le filtre a l'air de dire « tous ceux qui ne sont pas actifs ».

La parade : filtrer côté application quand la colonne est nullable, ou expliciter
`or=(statut.is.null,statut.neq.actif)`.

## Piège 2 : les tâches planifiées s'exécutent en séquence

Sur un Worker, toutes les tâches d'un même cron tournent dans **une seule
invocation**, l'une après l'autre. Trente tâches qui envoient chacune un message
produisent une rafale de trente messages en quelques secondes.

Il a fallu un régulateur : plafond quotidien par canal, espacement minimal entre
deux envois, et une priorité pour que l'essentiel passe avant l'accessoire.

## Piège 3 : le géoblocage depuis les runners

Les runners GitHub sont sur des IP américaines. Binance répond 451, Bybit
bloque aussi. Depuis Cloudflare, c'est 403. Il faut une chaîne de repli
explicite, et surtout une source **décentralisée** en dernier recours — c'est la
seule joignable de partout.

## Piège 4 : le Markdown historique de Telegram

Un seul `_` non échappé dans un message fait rejeter le message **entier**, avec
une erreur `can't parse entities`. Sur un nom d'utilisateur de bot contenant un
underscore, la panne est systématique et silencieuse.

Pour les longs textes, la solution la plus robuste reste de ne pas utiliser
`parse_mode` du tout.

## Ce que ça donne

{PART_JOURS_AVEC_SIGNAL} des jours produisent au moins un signal, avec un débit
mesuré de {DEBIT_FAVORABLE} par jour en marché porteur et {DEBIT_DEFAVORABLE}
quand il ne l'est pas — {DEBIT_MOYEN} en moyenne. Le tout sans une seule
intervention manuelle.
""",
        "/comment-ca-marche.html",
    ),
    _article(
        "carry-funding-explique",
        "Le carry de financement : gagner sans parier sur le prix",
        ["finance", "crypto", "python"],
        f"""
La plupart des stratégies crypto parient sur une direction. Celle-ci n'en prend
aucune, et c'est ce qui la rend intéressante à étudier.

## Le mécanisme

Sur un contrat perpétuel, il n'y a pas d'échéance. Pour que son prix reste
collé au comptant, les plateformes appliquent un **financement** : toutes les
huit heures, si le perpétuel cote au-dessus du comptant, les acheteurs paient
les vendeurs. Sinon l'inverse.

La position consiste à acheter au comptant et vendre à découvert le perpétuel,
pour le même montant. Les deux jambes s'annulent : que le prix monte ou
descende, la valeur ne bouge pas. Le gain vient uniquement du financement
encaissé.

## Ce que ça n'est pas

Ce n'est pas de l'argent gratuit, et trois risques sont bien réels.

**La liquidation de la jambe vendeuse** si la marge devient insuffisante. C'est
le risque principal, et il se matérialise précisément quand le marché s'emballe.

**Le risque de plateforme.** Les deux jambes vivent au même endroit.

**Le financement négatif extrême.** Sur mes mesures, la pire position a coûté
-19,86 % avec un stop de financement actif. Sans ce stop : -66,70 %.

## Ce que la mesure donne

Sur 6 ans, avec stop de financement : 84,2 % de positions gagnantes, +0,572 %
net par position sur 21 jours de détention, six années positives sur sept — la
septième, 2022, à -0,046 %, donc plate plutôt que perdante.

Ce taux de réussite élevé est trompeur si on le lit seul. Ramené à l'unité qui
permet de comparer des stratégies de durées différentes — l'espérance **par jour
de capital immobilisé** — le carry rend 0,027 %/jour. Un moteur directionnel qui
gagne une fois sur deux mais rend 0,805 % en 3 jours produit 0,268 %/jour, soit
dix fois plus.

Gagner souvent et gagner beaucoup sont deux choses différentes. C'est la leçon
la plus utile de cette stratégie, et elle vaut bien au-delà d'elle.

## Le filtre le plus important

Une paire dont le financement est *trop* élevé est écartée, pas privilégiée. Un
taux extrême signale une manie, et c'est exactement là que se logent les pertes
rares et énormes. Le plafond est fixé à 0,15 %/jour.
""",
        "/glossaire.html",
    ),
    _article(
        "ne-rien-faire-42-pourcent-du-temps",
        "La règle la plus rentable de mon système : ne rien faire 42 % du temps",
        ["datascience", "finance", "python"],
        f"""
Quand j'ai mesuré la contribution de chaque composant de ma stratégie, le
résultat m'a surpris : ce n'est pas la règle d'entrée qui rapporte le plus.
C'est la règle d'abstention.

## La règle

Si le Bitcoin clôture sous sa moyenne mobile 200 jours, les moteurs qui achètent
une hausse sont **coupés**. Aucun signal directionnel, quelle que soit la qualité
apparente des configurations.

C'est tout. Une ligne de condition.

## Ce qu'elle coûte, ce qu'elle rapporte

Ce filtre est fermé {PART_FILTRE_FERME} du temps sur 6 ans, avec un record de
381 jours consécutifs — du 28/12/2021 au 13/01/2023. Plus d'un an sans le cœur
du produit.

Le gain : sans ce filtre, la stratégie n'est positive que 4 années sur 7. Avec
lui, elle n'a **aucune année perdante** sur 6 ans.

Le classement par force relative, qui est la partie « intelligente » du système
et celle qui m'a demandé le plus de travail, n'apporte qu'environ 1,1 point.

## Pourquoi c'est difficile à tenir

Un filtre fermé pendant 381 jours, c'est 381 jours à se demander s'il est cassé.
Il n'y a aucun retour positif pendant cette période : on ne voit pas les pertes
qu'on évite, on voit seulement le silence.

Sur un produit qui a des utilisateurs, c'est encore plus dur : le silence se lit
comme une panne. La seule réponse honnête que j'aie trouvée est de le dire
d'avance, de le chiffrer, et de laisser vérifier l'état du filtre à tout moment.

## La généralisation

La plupart des efforts d'optimisation portent sur « quoi acheter ». Beaucoup
moins sur « quand ne rien acheter ». Dans mon cas, le second a produit
l'essentiel du résultat, pour une fraction du code.

Ça vaut la peine de tester la version de votre stratégie qui s'abstient dans un
régime donné, avant d'ajouter un indicateur de plus.
""",
        "/comment-ca-marche.html",
    ),
    _article(
        "esperance-par-jour-comparer-strategies",
        "Comparer deux stratégies de durées différentes : l'espérance par jour de capital",
        ["datascience", "finance", "statistics"],
        f"""
J'avais cinq moteurs de signaux, chacun avec sa durée de détention : 3 jours,
7 jours, 21 jours. Quand il a fallu décider lequel prioriser un jour où
plusieurs se déclenchent, je me suis aperçu que je ne savais pas les comparer.

## Le piège

Voici trois moteurs, avec leur espérance par signal :

| Moteur | Espérance | Détention |
|---|---|---|
| Expansion de volatilité | +4,99 % | 7 jours |
| Carry de financement | +0,57 % | 21 jours |
| Momentum 4H | +0,81 % | 3 jours |

Classés par espérance brute, le carry arrive dernier de très loin. C'est faux,
mais surtout ça ne veut rien dire : ces trois chiffres ne mesurent pas la même
chose.

## L'unité commune

Le capital engagé sur une position ne peut pas l'être ailleurs. La ressource
rare n'est donc pas le signal, c'est le **jour de capital immobilisé**.

```python
def esperance_par_jour(profil):
    return profil["esperance_pct"] / profil["jours"]
```

Le classement devient :

| Moteur | Par jour |
|---|---|
| Expansion de volatilité | 0,713 % |
| Cassure de canal | 0,665 % |
| Force relative | 0,325 % |
| Momentum 4H | 0,268 % |
| Carry de financement | 0,027 % |

Le carry reste dernier, mais l'écart réel est de 26×, pas de 9×. Et le
momentum 4H, que je classais mentalement en dernier parce que son espérance
brute est faible, rend en réalité **dix fois** le carry.

## La nuance qui reste

Cette unité ne dit pas tout. Le carry est neutre au marché : il n'expose à
aucune direction de prix, et continue de produire quand tout le reste est à
l'arrêt. Il ne consomme donc pas la même ressource que les paris directionnels,
et il ne devrait pas concourir dans le même quota.

C'est ce que fait mon arbitre : les moteurs neutres échappent au quota
directionnel. Une bonne unité de comparaison ne remplace pas la compréhension
de ce qu'on compare — elle empêche seulement de se tromper d'ordre de grandeur.
""",
        "/comment-ca-marche.html",
    ),
]


def article_par_slug(slug):
    for a in ARTICLES:
        if a["slug"] == slug:
            return a
    return None
