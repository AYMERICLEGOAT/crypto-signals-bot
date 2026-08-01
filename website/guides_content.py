"""
Contenu des guides pédagogiques (acquisition organique).

Pourquoi ce module existe (audit du 01/08/2026) : le site faisait 744 mots
en page d'accueil et 7 pages de signaux archivées. Dans une niche aussi
concurrentielle que le trading crypto, ça ne se référence pas — et
l'acquisition est justement LE problème du projet (1 seul vrai utilisateur,
0 paiement). Twitter et Reddit demandent des clés API absentes ; le contenu,
lui, ne dépend de personne et se cumule dans le temps.

Choix éditorial assumé : ces guides n'ont AUCUNE promesse de gain. Ils
positionnent le service sur ce qui est réellement démontrable — la
discipline et la transparence — plutôt que sur une rentabilité que les
mesures ne soutiennent pas (voir signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md).
Un contenu honnête et utile se référence durablement ; une promesse creuse
attire un trafic qui ne convertit pas et se retourne en avis négatifs.

Chaque guide vise une intention de recherche réelle et reprend le fond des
30 posts pédagogiques déjà diffusés sur le canal (voir educational_posts en
base), développé au format article.
"""

# slug, titre (balise <title>), h1, meta description, mots-clés visés, corps HTML.
# Le corps utilise <h2>/<p>/<ul> uniquement : le style est appliqué par le
# gabarit (voir guides_generator.py), pas en ligne.
GUIDES = [
    {
        "slug": "comment-lire-un-signal-crypto",
        "title": "Comment lire un signal de trading crypto (guide complet)",
        "h1": "Comment lire un signal de trading crypto",
        "description": "Entrée, stop loss, take profit, TP1/TP2/TP3 : ce que chaque ligne d'un signal crypto veut dire, et comment l'utiliser sans se tromper.",
        "keywords": "signal crypto, lire un signal trading, stop loss take profit, TP1 TP2 TP3",
        "body": """
<p>Un signal de trading, c'est une proposition de transaction décrite à l'avance : à quel prix entrer, à quel prix sortir si ça se passe mal, et à quel prix prendre ses gains si ça se passe bien. Rien de plus. Ce n'est ni une prédiction, ni une garantie.</p>

<h2>Les quatre informations indispensables</h2>
<p>Un signal exploitable contient toujours ces quatre éléments. S'il en manque un, il est inutilisable — vous ne pourriez pas savoir quand sortir.</p>
<ul>
  <li><b>La paire</b> — l'actif concerné, par exemple BTC/USDT. Le premier terme est ce que vous achetez ou vendez, le second ce avec quoi vous le payez.</li>
  <li><b>Le sens</b> — ACHAT (vous pariez sur la hausse) ou VENTE (vous pariez sur la baisse).</li>
  <li><b>Le prix d'entrée</b> — le niveau auquel la position est censée être ouverte.</li>
  <li><b>Le stop loss</b> — le niveau auquel vous coupez la perte. C'est l'information la plus importante des quatre.</li>
</ul>

<h2>Pourquoi le stop loss compte plus que l'objectif</h2>
<p>C'est contre-intuitif : la plupart des débutants regardent d'abord le take profit, parce que c'est le chiffre agréable. Or c'est le stop loss qui détermine si vous serez encore là dans six mois.</p>
<p>La raison est arithmétique. Une perte de 50 % demande un gain de 100 % pour revenir à l'équilibre. Une perte de 20 % ne demande que 25 %. Plus vous laissez courir une perte, plus la remontée devient improbable — pas parce que le marché vous en veut, mais parce que les pourcentages ne sont pas symétriques.</p>
<p>Un signal sans stop loss n'est donc pas un signal « plus ambitieux ». C'est un signal incomplet.</p>

<h2>Ce que signifient TP1, TP2 et TP3</h2>
<p>Beaucoup de signaux modernes proposent plusieurs objectifs au lieu d'un seul. L'idée : sortir la position par tranches plutôt qu'en une fois.</p>
<ul>
  <li><b>TP1</b> — le premier objectif, le plus proche. Souvent utilisé pour sécuriser une partie de la position et remonter le stop au prix d'entrée. À partir de là, le trade ne peut plus finir perdant.</li>
  <li><b>TP2</b> — l'objectif principal, plus ambitieux, atteint moins souvent.</li>
  <li><b>TP3</b> — le « runner » : la fraction laissée courir au cas où le mouvement se prolonge. Atteint rarement, mais c'est lui qui compense les trades perdants.</li>
</ul>
<p>Le passage au break-even après TP1 est le mécanisme central : il transforme un trade risqué en trade sans risque. C'est ce qui permet d'encaisser plusieurs échecs d'affilée sans dommage.</p>

<h2>Le piège du taux de réussite</h2>
<p>« 70 % de réussite » sonne excellent. Ça ne veut pourtant rien dire tout seul.</p>
<p>Imaginez une stratégie qui gagne 7 fois sur 10, mais dont les gains font 1 € et les pertes 3 €. Sur 10 trades : +7 € de gains, −9 € de pertes. Résultat : perdante, avec 70 % de réussite.</p>
<p>Ce qui compte est le produit des deux : le taux de réussite <i>et</i> le rapport entre la taille moyenne des gains et celle des pertes. Une stratégie qui gagne 4 fois sur 10 mais dont les gains sont trois fois plus gros que les pertes est largement gagnante.</p>
<p>Méfiez-vous donc de tout service qui met en avant un taux de réussite sans jamais mentionner ce rapport. C'est l'indicateur le plus facile à afficher, et le plus facile à rendre flatteur.</p>

<h2>Comment utiliser un signal concrètement</h2>
<ol>
  <li>Vérifiez que le prix actuel n'est pas déjà loin du prix d'entrée. Si le mouvement a déjà eu lieu, le rapport risque/rendement n'est plus celui annoncé.</li>
  <li>Placez le stop loss <b>avant</b> d'ouvrir la position, pas après. Décider d'un stop quand on est déjà en perte, c'est décider sous le coup de l'émotion.</li>
  <li>Calculez votre taille de position à partir du stop, pas d'un montant fixe (voir notre guide sur la gestion du risque).</li>
  <li>Ne déplacez jamais le stop plus loin. C'est l'erreur qui transforme une perte maîtrisée en perte illimitée.</li>
</ol>
""",
    },
    {
        "slug": "gestion-du-risque-crypto",
        "title": "Gestion du risque en crypto : la seule chose qui vous garde en vie",
        "h1": "Gestion du risque en trading crypto",
        "description": "Taille de position, risque par trade, ratio risque/rendement : les règles qui déterminent si vous survivez, expliquées avec les calculs.",
        "keywords": "gestion du risque crypto, taille de position, money management, ratio risque rendement",
        "body": """
<p>La plupart des débutants cherchent la bonne stratégie. Les traders qui durent ont d'abord réglé une autre question : combien perdre quand ils ont tort. C'est ce paramètre, bien plus que la qualité des signaux, qui décide de la survie d'un compte.</p>

<h2>La règle du 1-2 % par position</h2>
<p>Ne jamais risquer plus de 1 à 2 % de son capital total sur une seule position. « Risquer » signifie ici : ce que vous perdez si le stop loss est touché — pas le montant investi.</p>
<p>Pourquoi ce chiffre ? Parce que les séries de pertes arrivent, y compris avec une bonne stratégie. Avec un taux de réussite de 50 %, une série de 7 pertes consécutives survient régulièrement sur quelques centaines de trades. À 2 % de risque, cela coûte environ 13 % du capital : désagréable, récupérable. À 20 % de risque par position, le compte est effacé.</p>

<h2>Calculer sa taille de position</h2>
<p>La taille ne se choisit pas au feeling. Elle se déduit de trois nombres :</p>
<ul>
  <li>votre capital total ;</li>
  <li>le pourcentage que vous acceptez de perdre sur ce trade (1-2 %) ;</li>
  <li>la distance entre votre prix d'entrée et votre stop loss, en pourcentage.</li>
</ul>
<p><b>Taille = (capital × risque accepté) ÷ distance au stop</b></p>
<p>Exemple : 5 000 € de capital, 2 % de risque accepté (soit 100 €), un stop placé 4 % sous l'entrée. Taille = 100 ÷ 0,04 = <b>2 500 €</b> de position. Si le stop est touché, vous perdez 4 % de 2 500 €, soit exactement les 100 € prévus.</p>
<p>Conséquence importante : plus le stop est éloigné, plus la position doit être <i>petite</i>. Un stop large ne veut pas dire un risque plus grand — à condition d'ajuster la taille.</p>

<h2>Le ratio risque/rendement</h2>
<p>Il compare ce que vous risquez à ce que vous visez. Un ratio de 1:2 signifie viser deux fois plus de gain que de perte potentielle.</p>
<p>Ce ratio détermine le taux de réussite dont vous avez besoin pour être rentable :</p>
<ul>
  <li>ratio 1:1 → il faut gagner plus de 50 % du temps ;</li>
  <li>ratio 1:2 → 34 % suffisent ;</li>
  <li>ratio 1:3 → 25 % suffisent.</li>
</ul>
<p>C'est pour cette raison qu'une stratégie qui « se trompe » les trois quarts du temps peut être solidement gagnante. Et pourquoi une stratégie qui a raison 7 fois sur 10 peut ruiner un compte.</p>

<h2>Les trois erreurs qui coûtent le plus cher</h2>
<ul>
  <li><b>Déplacer son stop</b> quand le prix s'en approche, « pour laisser une chance au trade ». Vous transformez une perte définie en perte inconnue.</li>
  <li><b>Augmenter la taille après une perte</b> pour « se refaire ». C'est le revenge trading : il amplifie les pertes bien plus qu'il ne les répare.</li>
  <li><b>Changer de stratégie après chaque échec.</b> Une stratégie s'évalue sur des dizaines de trades. Sur un seul résultat, vous n'observez que du hasard.</li>
</ul>

<h2>Le journal de trading</h2>
<p>Notez pour chaque position : pourquoi vous êtes entré, pourquoi vous êtes sorti, et ce que vous ressentiez. Après trente lignes, vos biais deviennent visibles — et ils sont presque toujours différents de ce que vous imaginiez. Aucun indicateur ne vous apprendra autant sur vos résultats que ce simple carnet.</p>
""",
    },
    {
        "slug": "rsi-et-moyennes-mobiles-expliques",
        "title": "RSI et moyennes mobiles : ce qu'ils disent vraiment (et ce qu'ils ne disent pas)",
        "h1": "RSI et moyennes mobiles, expliqués simplement",
        "description": "Comment fonctionnent le RSI et les moyennes mobiles EMA, ce qu'ils mesurent réellement, et les pièges classiques d'interprétation.",
        "keywords": "RSI crypto, EMA moyenne mobile, indicateur technique, surachat survente",
        "body": """
<p>Le RSI et les moyennes mobiles sont les deux indicateurs les plus utilisés en analyse technique. Ils sont aussi les plus mal interprétés. Voici ce qu'ils mesurent réellement.</p>

<h2>La moyenne mobile exponentielle (EMA)</h2>
<p>Une moyenne mobile lisse le prix pour rendre la tendance lisible. La version exponentielle (EMA) donne plus de poids aux prix récents qu'aux anciens : elle réagit donc plus vite aux changements de direction qu'une moyenne simple.</p>
<p>Ce gain de réactivité a un coût : elle produit aussi davantage de faux signaux. Il n'existe pas de réglage qui soit à la fois rapide et fiable — c'est un arbitrage, pas un problème à résoudre.</p>
<p>Le croisement de deux EMA (une courte, une longue) est le signal le plus répandu : quand la courte passe au-dessus de la longue, on parle de configuration haussière. Attention toutefois : <b>un croisement confirme une tendance, il ne la prédit pas</b>. Au moment où il se produit, le prix a généralement déjà bougé.</p>

<h2>Le RSI</h2>
<p>Le RSI (Relative Strength Index) mesure la vitesse et l'amplitude des variations récentes, sur une échelle de 0 à 100. En dessous de 30, on parle de « survente » ; au-dessus de 70, de « surachat ».</p>
<p>Le malentendu le plus fréquent tient dans ces deux mots. « Survendu » ne signifie pas « va remonter ». Un actif peut rester survendu pendant des semaines en pleine tendance baissière, et ruiner tous ceux qui ont acheté « parce que le RSI était bas ».</p>
<p>Le RSI mesure un momentum passé. Il ne contient aucune information sur l'avenir.</p>

<h2>Les bandes de Bollinger</h2>
<p>Elles encadrent une moyenne mobile par deux bandes calculées sur l'écart-type du prix. Leur écartement mesure la volatilité du moment : bandes larges, marché agité ; bandes resserrées, marché calme.</p>
<p>Le resserrement extrême — le « squeeze » — précède souvent un mouvement marqué. Mais il ne dit rien de sa <i>direction</i>. C'est une information sur l'amplitude à venir, pas sur le sens.</p>

<h2>Pourquoi combiner plusieurs indicateurs</h2>
<p>Chaque indicateur produit des faux signaux. En exiger deux simultanément — par exemple un croisement de moyennes confirmé par un RSI en zone extrême — réduit nettement leur nombre.</p>
<p>Cela ne les élimine jamais. Et au-delà de trois ou quatre conditions, on tombe dans le travers inverse : la stratégie ne se déclenche presque plus, et les rares signaux restants correspondent surtout aux particularités des données passées. C'est le surapprentissage.</p>

<h2>Le choix du timeframe change tout</h2>
<p>Un signal en bougies horaires et un signal en bougies 5 minutes n'ont pas la même fiabilité statistique. Plus l'unité de temps est courte, plus le bruit domine le signal.</p>
<p>Un même actif peut d'ailleurs sembler haussier en journalier et baissier en horaire au même instant. Ce n'est pas une contradiction : ce sont deux échelles différentes. S'en tenir à une unité de référence évite l'essentiel de la confusion.</p>

<h2>Ce qu'aucun indicateur ne fera jamais</h2>
<p>Prédire l'avenir. Un indicateur décrit une probabilité fondée sur des schémas passés, rien de plus. C'est pourquoi la gestion du risque compte au moins autant que la qualité du signal : elle, elle fonctionne quelle que soit la fiabilité de la prédiction.</p>
""",
    },
    {
        "slug": "backtest-et-surapprentissage",
        "title": "Backtest : comment savoir si une stratégie tient vraiment la route",
        "h1": "Backtest et surapprentissage : lire les chiffres correctement",
        "description": "Ce qu'un backtest prouve, ce qu'il ne prouve pas, et comment repérer les chiffres de performance gonflés dans une offre de signaux.",
        "keywords": "backtest crypto, surapprentissage overfitting, performance stratégie trading, walk-forward",
        "body": """
<p>Un backtest simule une stratégie sur des données passées pour estimer ce qu'elle aurait rapporté. C'est un outil indispensable — et le plus facile à truquer, souvent sans même le vouloir.</p>

<h2>Le surapprentissage, en une phrase</h2>
<p>C'est le fait d'ajuster une stratégie jusqu'à ce qu'elle colle parfaitement aux données passées, au point de perdre toute capacité à réagir correctement à des données nouvelles.</p>
<p>Le symptôme est paradoxal : <b>une stratégie trop parfaite en backtest est un signal d'alerte, pas de confiance</b>. Avec assez de paramètres et assez d'essais, on finit toujours par trouver une combinaison qui aurait magnifiquement fonctionné dans le passé. Elle ne fonctionnera pas demain, parce qu'elle a mémorisé du hasard.</p>

<h2>« In-sample » et « out-of-sample »</h2>
<p>Un test est dit <i>in-sample</i> quand il est effectué sur les mêmes données qui ont servi à choisir les paramètres. Ses résultats sont, par construction, optimistes.</p>
<p>Le test qui compte est <i>out-of-sample</i> : on choisit les réglages sur une période, puis on les évalue sur une période différente, jamais utilisée pour les choisir. Si la performance s'effondre, la stratégie ne contenait pas d'avantage réel.</p>
<p>La version robuste s'appelle le <b>walk-forward</b> : découper l'historique en plusieurs tranches successives et vérifier que l'avantage tient sur <i>chacune</i>. Un avantage qui n'apparaît que sur une tranche est un artefact de période, pas un edge.</p>

<h2>L'erreur de régime</h2>
<p>Un exemple concret, très courant. Sur une période où le marché a globalement baissé, une stratégie qui vend à découvert affichera d'excellents résultats. On en conclut qu'elle a un avantage sur les ventes. Mais elle n'a fait que suivre la direction du marché — et elle s'effondrera dès la première phase haussière.</p>
<p>C'est pourquoi tout test sérieux doit couvrir <b>plusieurs régimes de marché</b> : hausse marquée, baisse marquée, phases plates. Douze mois d'historique ne suffisent souvent pas : ils peuvent ne contenir qu'un seul régime.</p>

<h2>Ce qu'un backtest ne capture jamais</h2>
<ul>
  <li><b>Les frais et le slippage</b> — sur une stratégie à haute fréquence, ils peuvent à eux seuls transformer un résultat positif en résultat négatif.</li>
  <li><b>La liquidité réelle</b> — passer un ordre important déplace le prix, ce que la simulation ignore.</li>
  <li><b>Le facteur humain</b> — un backtest ne renonce jamais après six pertes consécutives. Vous, si.</li>
  <li><b>Le drawdown vécu</b> — voir « chute maximale : 45 % » sur un graphique n'a rien à voir avec traverser ces 45 % en temps réel.</li>
</ul>

<h2>Les questions à poser à un fournisseur de signaux</h2>
<p>Si un service met en avant sa performance, ces quatre questions permettent de trier très vite :</p>
<ol>
  <li>Le taux de réussite est-il donné <b>avec</b> le rapport gains moyens / pertes moyennes ? Sans lui, il ne veut rien dire.</li>
  <li>Le test est-il in-sample ou out-of-sample ? La réponse est rarement affichée spontanément.</li>
  <li>Quelle est la chute maximale (drawdown) ? Une performance flatteuse avec 80 % de drawdown est intenable en pratique.</li>
  <li>Les <b>résultats réels</b> sont-ils publiés, pertes comprises — ou seulement le backtest ?</li>
</ol>
<p>Un service qui ne publie que ses gains ne publie pas ses résultats : il publie sa communication.</p>
""",
    },
    {
        "slug": "erreurs-debutant-trading-crypto",
        "title": "Les 8 erreurs qui ruinent les débutants en trading crypto",
        "h1": "Les 8 erreurs qui ruinent les débutants",
        "description": "FOMO, revenge trading, stop déplacé, levier excessif : les erreurs les plus coûteuses en trading crypto, et comment s'en protéger.",
        "keywords": "erreurs trading crypto, FOMO, revenge trading, débutant crypto, psychologie trading",
        "body": """
<p>Les pertes des débutants viennent rarement d'une mauvaise analyse. Elles viennent presque toujours des mêmes réflexes, qui se répètent d'une personne à l'autre avec une régularité frappante.</p>

<h2>1. Entrer après une forte hausse (le FOMO)</h2>
<p>La peur de rater l'opportunité pousse à acheter précisément au moment où le mouvement est déjà consommé — donc là où le risque est maximal et le potentiel restant minimal. Des règles écrites <b>à l'avance</b> sont la seule protection efficace : dans l'instant, l'émotion gagne toujours contre le raisonnement.</p>

<h2>2. Trader sans stop loss</h2>
<p>« Je surveillerai » ne fonctionne pas. Le marché bouge la nuit, pendant vos réunions, quand votre connexion tombe. Un stop loss n'est pas un aveu de doute : c'est ce qui rend la perte maximale connue à l'avance.</p>

<h2>3. Déplacer son stop pour éviter la perte</h2>
<p>Le prix approche du stop, on l'éloigne « juste un peu ». C'est l'erreur la plus coûteuse de la liste, parce qu'elle convertit une perte définie et supportable en perte potentiellement illimitée. Un stop déplacé une fois le sera une deuxième.</p>

<h2>4. Le revenge trading</h2>
<p>Après une perte, l'envie de se refaire immédiatement, avec une position plus grosse. C'est la séquence qui vide le plus de comptes. La perte suivante étant plus grande, elle appelle une réaction encore plus forte. Une règle simple et efficace : après deux pertes consécutives, on s'arrête pour la journée.</p>

<h2>5. Un levier disproportionné</h2>
<p>Le levier multiplie les gains et les pertes exactement de la même façon. À levier 20, un mouvement de 5 % contre vous liquide la position. En crypto, un mouvement de 5 % en une heure n'a rien d'exceptionnel. Le levier ne rend pas une stratégie meilleure : il raccourcit simplement le temps qui vous sépare du résultat, bon ou mauvais.</p>

<h2>6. Changer de stratégie après chaque perte</h2>
<p>Une stratégie s'évalue sur des dizaines de trades. Sur trois résultats, vous n'observez que du bruit. Changer en permanence garantit de ne jamais laisser à aucune approche le temps de produire ses statistiques — et de collectionner à chaque fois les mauvaises séries de départ.</p>

<h2>7. Tout miser sur une seule position</h2>
<p>Même avec une conviction forte. Aucun trade n'est certain, et « celui-ci est différent » est précisément ce que l'on pense avant chaque perte importante. Répartir n'est pas un manque d'ambition : c'est ce qui vous laisse encore du capital pour la prochaine occasion.</p>

<h2>8. Confondre activité et performance</h2>
<p>Passer vingt trades par jour n'améliore pas les résultats — cela multiplie surtout les frais et la fatigue décisionnelle. Si votre approche a une espérance positive, elle la produira sur un nombre raisonnable de positions. Si elle a une espérance négative, en prendre davantage ne fait qu'accélérer les pertes.</p>

<h2>Le point commun</h2>
<p>Ces huit erreurs ont la même racine : décider dans l'instant plutôt qu'appliquer une règle définie à froid. C'est précisément à cela que servent des niveaux d'entrée, de stop et d'objectif fixés <b>avant</b> l'ouverture de la position. Non pas parce qu'ils prédisent le marché, mais parce qu'ils vous protègent de vous-même au moment où vous en avez le plus besoin.</p>
""",
    },
]
