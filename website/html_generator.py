"""
Génère la page HTML complète (titre, meta description, contenu structuré,
section performance, appel à l'action) à partir des signaux du jour et des
statistiques de performance réelles. Disponible en français et en anglais
(paramètre `lang`), avec balises hreflang reliant les deux versions.
"""

import html
from datetime import datetime

from config import SITE_NAME, SITE_BASE_URL, TELEGRAM_BOT_USERNAME, TELEGRAM_CHANNEL_URL
from content_templates import generate_analysis, format_price
from equity_curve import build_live_performance_section
from testimonials import EXAMPLE_TESTIMONIALS, EXAMPLE_TESTIMONIALS_EN

TELEGRAM_URL = f"https://t.me/{TELEGRAM_BOT_USERNAME}"

# Refonte du 04/08/2026 : le moteur n'a plus une famille de signaux mais
# plusieurs (voir STRATEGIES_2026-08-04.md), toutes validées sur 6 ans avec
# témoin aléatoire — une famille qui ne bat pas un tirage au sort à contraintes
# égales est écartée :
#
#   1. Force relative      (signals/relative_strength.py)
#   2. Cassure de canal    — achat sur le plus haut 50 jours
#   3. Expansion de volatilité — réveil après compression
#   4. Carry de financement (signals/carry_engine.py)
#   5. Momentum 4 heures   (signals/momentum_4h.py), depuis le 07/08/2026
#
# Les trois premières sont DIRECTIONNELLES : elles achètent une hausse, et sont
# coupées quand le Bitcoin passe sous sa moyenne mobile 200 jours (41 % du
# temps). Les deux dernières produisent pendant ces périodes — le carry parce
# qu'il est neutre au marché, le momentum 4 heures parce qu'il ne travaille QUE
# dans ce régime-là. Toute la page en tient compte : un carry n'a NI stop loss
# NI take profit (ses deux jambes s'annulent, la sortie est une date), et
# « aucun signal aujourd'hui » ne peut plus être écrit quand l'un des deux sort.
#
# Le momentum 4 heures est présenté EN OBSERVATION partout où il apparaît :
# positif trois années sur quatre, mais en recul sur la dernière. Le taire
# reviendrait à faire porter à l'abonné la fraction incertaine du produit sans
# le lui dire.
#
# Les chiffres qui décrivaient l'ancien moteur à famille unique (8,0 signaux par
# semaine, 47,7 % de réussite, +3,22 % d'espérance, +83,3 % par an) ont tous été
# retirés : ils ne décrivent plus ce que fait le moteur. Ceux qui les remplacent
# proviennent de la mesure sur 6 ans du portefeuille des moteurs retenus —
# aucun n'est arrondi à l'avantage.
#
# Le seuil MIN_SIGNIFICANT_TRADES a disparu d'ici : la section backtest
# n'affiche plus le taux de réussite stocké en base, donc il n'y a plus
# d'échantillon variable à protéger (voir _backtest_section_html). Le seuil
# reste en vigueur là où il sert encore : signals/backtest.py et
# website/archives_generator.py.

_STRINGS = {
    "fr": {
        "html_lang": "fr",
        "page_title": lambda date_str: f"Signaux crypto du {date_str} — {SITE_NAME}",
        # Trois états possibles, et aucun n'est un cas dégradé : des signaux
        # d'achat, uniquement des carrys (le Bitcoin est sous sa moyenne 200
        # jours, les familles directionnelles se taisent), ou rien du tout. La
        # description doit rester juste dans les trois cas, sinon les moteurs de
        # recherche indexent « 0 signaux » sans la moindre explication.
        "meta_description": lambda n, n_carry, pairs, date_str: (
            f"Aucun signal crypto publié le {date_str} : la force relative est coupée tant que "
            f"le Bitcoin est sous sa moyenne mobile 200 jours, et le carry de financement n'a rien trouvé non plus. "
            f"Pourquoi ce silence, et combien de temps il peut durer."
            if not n
            else f"Analyse gratuite de {n} signaux crypto ({pairs}) du {date_str} : {n_carry} carry(s) de "
            f"financement, position neutre au marché dont le résultat ne dépend pas du prix. Les familles "
            f"directionnelles sont à l'arrêt aujourd'hui. Résultats réels inclus."
            if n_carry == n
            else f"Analyse gratuite de {n} signaux crypto ({pairs}) du {date_str}, issus de cinq moteurs "
            f"mesurés sur 6 ans : force relative, cassure de canal, expansion de volatilité, carry de "
            f"financement et momentum 4 heures. Résultats réels inclus."
        ),
        "h1": lambda date_str: f"Signaux crypto gratuits — {date_str}",
        "subtitle": "Cinq moteurs de signaux, chacun validé contre un témoin aléatoire : force relative, "
        "cassure de canal, expansion de volatilité, carry de financement et momentum 4 heures. Les deux "
        "derniers continuent de produire quand le marché baisse. Mis à jour chaque jour.",
        "signals_heading": lambda n: f"🔎 Les {n} derniers signaux",
        "signals_note": "Trois familles achètent une hausse : entrée, stop volontairement large à 4x l'ATR "
        "(une protection contre l'accident, pas un outil de gestion), jalons de suivi à 4x, 8x et 12x l'ATR, et "
        "sortie sur la durée — c'est la date qui ferme la position, pas un objectif de prix. La quatrième, le "
        "carry de financement, ne parie pas sur le prix du tout : elle ouvre deux jambes opposées et se ferme à "
        "une date. Elle n'a donc ni stop loss ni take profit, et c'est normal.",
        # Le point le plus important de la page, et celui qu'un abonné a le plus
        # spontanément envie d'ignorer. Il est mesuré : le signal directionnel
        # MÉDIAN perd 0,69 %, la rentabilité vient d'une minorité de gros
        # gagnants. Trier revient donc à jeter la partie qui paie et à garder
        # celle qui coûte. Le dire une seule fois en petit ne suffirait pas.
        "signals_all_heading": "⚖️ Prenez-les tous, ou aucun",
        "signals_all_note": "Les familles directionnelles réussissent environ une fois sur deux, et le signal "
        "médian perd 0,69 %. Ce n'est pas une contradiction : la rentabilité vient d'une minorité de gros "
        "gagnants, pas de la majorité des signaux. En choisir quelques-uns « qui ont l'air solides » revient "
        "statistiquement à ne garder que la partie perdante. Réduire la taille de chaque position est légitime ; "
        "n'en prendre qu'une partie ne l'est pas.",
        "buy_label": "ACHAT",
        "sell_label": "VENTE",
        "carry_label": "CARRY",
        "entry": "Entrée",
        "stop_loss": "Stop loss",
        "take_profit": "Take profit",
        # ---- Carry de financement : vocabulaire aligné mot pour mot sur le
        # message Telegram (workers/main-worker/src/signalFormat.ts,
        # buildCarryMessage). Un abonné qui lit la page puis reçoit le signal
        # doit reconnaître exactement la même chose.
        "carry_neutral": "Position neutre au marché : le prix peut monter ou baisser, ça ne change rien au "
        "résultat.",
        "carry_legs_heading": "Les deux jambes, à ouvrir en même temps et pour le même montant",
        "carry_leg_long": lambda pair: f"🟢 Achat au comptant (spot) de {pair}",
        "carry_leg_short": lambda pair: f"🔴 Vente à découvert du perpétuel {pair}",
        "carry_reference": "Prix de référence",
        "carry_expected": "Financement net attendu",
        "carry_expected_value": lambda pct: f"{pct:+.2f} %".replace(".", ","),
        "carry_close": "Clôture prévue",
        "carry_unknown": "—",
        "carry_how": "Les acheteurs de perpétuels versent un financement aux vendeurs toutes les 8 heures. En "
        "étant vendeur du perpétuel, on l'encaisse ; comme la position au comptant compense exactement la "
        "position perpétuelle, le prix n'entre pas dans l'équation. Les deux jambes se ferment ensemble à la date "
        "indiquée.",
        "carry_caveats_heading": "Ce qu'il faut savoir avant d'ouvrir",
        "carry_caveats": (
            "Le montant annoncé est une estimation à l'ouverture, pas un acquis : le taux de financement bouge "
            "pendant la détention et peut même s'inverser.",
            "Ce n'est pas « sans risque ». La jambe vendeuse peut être liquidée si la marge devient "
            "insuffisante, et il reste un risque de plateforme. Sur 6 ans, une journée de financement extrême a "
            "coûté -19,86 % sur une position.",
            "Il faut fermer les DEUX jambes en même temps : n'en garder qu'une transforme une position neutre "
            "en pari directionnel.",
        ),
        "perf_type_carry": "CARRY",
        "perf_heading": "📊 Performance réelle des signaux passés",
        "perf_pending": "Les premiers signaux sont en cours d'évaluation — reviens bientôt pour voir les premiers résultats réels.",
        "perf_closed": "signaux clôturés",
        "perf_winrate": "taux de réussite",
        "perf_wins": "gagnants",
        "perf_losses": "perdants",
        "perf_table_pair": "Paire",
        "perf_table_type": "Type",
        "perf_table_result": "Résultat",
        "perf_note": "Résultat déterminé automatiquement en comparant le prix courant de chaque "
        "signal à son stop loss et son take profit (pas une analyse tick par tick de l'historique intrabar).",
        # Sans cette précision, un visiteur attribue naturellement ces résultats
        # vécus à la stratégie décrite plus haut. Ce sont des moteurs
        # différents : les mélanger serait exactement la faute du
        # « 61,2 % de réussite ».
        "perf_engine_note": "Ces résultats peuvent inclure des signaux émis par des moteurs précédents, "
        "désactivés depuis. Ils ne décrivent donc pas les cinq moteurs présentés plus haut, qui n'ont pas "
        "encore d'historique en direct. Le résultat d'un carry, lui, ne se mesure pas sur un prix mais sur le "
        "financement encaissé, frais déduits.",
        "perf_secured": lambda count, pct: f"🔒 {count} ({pct:.0f}%) trades sécurisés (TP1 atteint, break-even ou mieux)",
        "paper_heading": "💼 Performance en direct (portefeuille fictif)",
        "paper_detail": lambda n, pct: (
            f"Si un portefeuille fictif avait engagé {pct:.0f}% de son capital sur chacun des "
            f"{n} derniers signaux résolus (envoyés ou non), voici son évolution cumulée :"
        ),
        "paper_drawdown": lambda dd: f"📉 Pire chute cumulée observée (drawdown max) : {dd:.1f}%",
        "paper_note": "⚠️ Simulation à titre illustratif (sizing fixe, sans réinvestissement des gains) — "
        "ne reflète pas un compte réel ni les frais/slippage. Pas un conseil en investissement.",
        "testimonials_heading": "💬 Ce qu'ils en pensent",
        "testimonials_disclaimer": "⚠️ Exemples fictifs illustrant le format des retours utilisateurs — pas de vrais témoignages.",
        "testimonials_real_disclaimer": "✅ Avis réels laissés via /review par des abonnés (anonymisés).",
        "review_up": "👍",
        "review_down": "👎",
        "backtest_heading": "🧪 La stratégie, mesurée sur 6 ans",
        # Audit du 01/08/2026, toujours en vigueur : un taux de réussite affiché
        # SEUL est la façon la plus trompeuse de présenter une stratégie — le
        # « 61,2 % de réussite » resté des mois sur ce site en est la preuve.
        # La règle tenue ici : le chiffre mis en avant est celui que vit un
        # abonné entrant à une date au hasard, JAMAIS le rendement annuel de la
        # stratégie, qui suppose d'avoir traversé les six années entières dès
        # le premier jour. Présenter ce rendement comme un gain d'abonné serait
        # une pratique commerciale trompeuse (art. L121-2 code de la
        # consommation).
        "backtest_lead": "Le chiffre qui compte n'est pas le rendement annuel de la stratégie, c'est ce qu'a "
        "vécu quelqu'un qui a commencé à une date tirée au hasard :",
        "backtest_stat": "Après six mois : +5,0 % en médiane",
        "backtest_subscriber": "53 % des entrées sont gagnantes à six mois, et le pire cas mesuré est -61,7 %. "
        "Ce n'est pas un produit qui enrichit vite : c'est un produit qui limite la casse, et il peut faire mal.",
        "backtest_how_heading": "Les cinq moteurs",
        "backtest_how": "Aucune n'a été retenue sur sa seule espérance : chacune a été confrontée à un témoin "
        "aléatoire, et une famille qui ne bat pas un tirage au sort à contraintes égales est écartée. Sept ont "
        "été testées, trois ont été rejetées.",
        "backtest_families": (
            ("Force relative",
             "Les 40 paires suivies sont classées par momentum sur données journalières. Les 12 plus fortes "
             "sont achetées et conservées 7 jours. La sortie est temporelle."),
            ("Cassure de canal",
             "Achat quand le prix franchit son plus haut des 50 derniers jours."),
            ("Expansion de volatilité",
             "Achat quand la volatilité se réveille après une phase de compression."),
            ("Carry de financement",
             "La seule qui ne parie pas sur le prix. Elle ouvre deux jambes de même montant — achat au "
             "comptant et vente à découvert du perpétuel — qui s'annulent quand le prix bouge. Le gain vient "
             "du financement versé toutes les 8 heures par les acheteurs de perpétuels aux vendeurs : 84,2 % "
             "de positions gagnantes, +0,572 % net par position, et 6 années positives sur 7 (la septième, "
             "2022, est à -0,046 %, donc plate). Elle produit dans les deux régimes de marché."),
            ("Momentum 4 heures — en observation",
             "Le seul moteur qui ne travaille QUE lorsque le marché baisse : il occupe exactement le créneau "
             "où la force relative se tait. Même principe de classement que la force relative, "
             "mais sur des bougies de 4 heures, et limité aux deux plus fortes du moment, tenues 3 jours. "
             "Il est présenté en observation parce que sa mesure est ambiguë : positive trois années sur "
             "quatre, mais en recul sur la dernière. Il est donc plafonné à deux signaux par jour, chacun "
             "étiqueté comme tel, et il s'arrête de lui-même si ses résultats réels démentent la mesure."),
        ),
        "backtest_tiles": (
            ("2,99", "signaux par jour en moyenne, sur 6 ans"),
            ("4,35", "par jour en marché favorable, 1,15 en marché défavorable"),
            ("80 %", "des jours ont au moins un signal"),
            ("84,2 %", "de positions gagnantes pour le carry de financement"),
        ),
        "backtest_filter_heading": "Pourquoi les signaux d'achat se taisent parfois pendant des mois",
        "backtest_filter": "La force relative est coupée quand le Bitcoin passe sous sa "
        "moyenne mobile 200 jours. Ce filtre est fermé 41 % du temps et sa plus longue fermeture a duré "
        "381 jours, du 28/12/2021 au 13/01/2023. Le carry, lui, n'est pas coupé : il est neutre au marché, donc "
        "une baisse ne le gêne pas. C'est ce qui fait passer le rythme de 0 à 1,15 signal par jour pendant ces "
        "périodes, contre 4,35 quand le filtre est ouvert.",
        "backtest_honesty_heading": "Ce qu'il faut savoir avant de s'abonner",
        "backtest_honesty": (
            "<b>Prenez tous les signaux, ou aucun.</b> Les familles directionnelles réussissent environ une "
            "fois sur deux et le signal médian perd 0,69 % : la rentabilité vient d'une minorité de gros "
            "gagnants. En trier quelques-uns revient statistiquement à ne garder que la partie perdante.",
            "Le rendement annuel d'un backtest n'est <b>pas</b> ce que gagnera un abonné : il suppose d'avoir "
            "traversé les six années entières, dès le premier jour, sans jamais rater un signal ni s'arrêter "
            "pendant la baisse. Le chiffre à regarder est celui de l'entrée à une date au hasard, ci-dessus.",
            "Le carry n'est pas « sans risque », et personne ne devrait vous le présenter ainsi : la jambe "
            "vendeuse peut être liquidée si la marge devient insuffisante, il reste un risque de plateforme, et "
            "une journée de financement extrême a coûté -19,86 % sur une position.",
            "Ces moteurs ont été mis en service le 4 août 2026 (le momentum 4 heures le 7 août) : les chiffres sont mesurés sur "
            "l'historique, ils n'ont pas encore été vécus en direct.",
        ),
        "backtest_detail": "Mesuré sur 6 ans (2020-2026), en données journalières, net de frais, avec une "
        "entrée décalée d'un jour après le signal, sur un univers de paires non contaminé par le biais du "
        "survivant, et un témoin aléatoire pour chaque famille.",
        "backtest_note": "⚠️ Une performance passée ne préjuge pas des performances futures. Ces chiffres "
        "proviennent de simulations sur données historiques : ils ne sont ni une promesse, ni une garantie de "
        "gain. Le trading de cryptoactifs peut faire perdre tout ou partie du capital engagé.",
        # Bloc affiché les jours sans signal d'achat. Il est écrit avec le même
        # soin qu'une page de vente parce que c'est le moment exact où l'abonné
        # se demande à quoi il paie — et parce que c'est vrai : ces jours-là
        # sont ceux où le filtre lui rend le plus service.
        #
        # DEUX variantes depuis le 04/08/2026, et la distinction n'est pas
        # cosmétique : écrire « aucun signal aujourd'hui » un jour où des carrys
        # sont sortis serait tout simplement faux, et ferait passer pour une
        # panne l'une des deux familles qui produisent en marché baissier.
        "filter_heading": "🔇 Aucun signal aujourd'hui — et c'est voulu",
        "filter_lead": "Ce silence n'est pas une panne. La force relative n'achète rien tant "
        "que le Bitcoin évolue sous sa moyenne mobile 200 jours. Les deux moteurs qui travaillent malgré ce "
        "filtre — le carry de financement, neutre au marché, et le momentum 4 heures, qui ne se déclenche que "
        "dans ce régime — n'ont rien trouvé non plus aujourd'hui : le premier n'ouvre une position que si le "
        "financement couvre ses frais, le second est plafonné à ses deux meilleurs rangs. Rien ne sera inventé "
        "pour remplir la page.",
        "filter_tiles": (
            ("41 %", "du temps sans signal directionnel, sur 6 ans"),
            ("381 j", "la plus longue fermeture (28/12/2021 → 13/01/2023)"),
            ("5", "signaux par jour au maximum, tous moteurs confondus"),
            ("84,2 %", "de positions gagnantes pour le carry"),
        ),
        "filter_duration_heading": "Combien de temps ça peut durer",
        "filter_duration": "Sur les 6 dernières années, ce filtre a été fermé 41 % du temps. La plus longue "
        "fermeture a duré 381 jours, du 28/12/2021 au 13/01/2023. Un abonnement peut donc traverser plusieurs "
        "mois d'affilée sans le moindre signal d'achat : c'est à prévoir, pas une anomalie. La différence "
        "depuis l'ajout du carry, c'est que ces périodes ne sont plus vides : elles produisent 1,15 signal par "
        "jour en moyenne, contre 4,35 quand le filtre est ouvert.",
        "filter_why_heading": "Pourquoi ne rien acheter vaut mieux",
        "filter_why": "Les familles directionnelles ne gagnent que si le marché monte. Les laisser tourner "
        "pendant une baisse, c'est acheter des hausses qui n'arrivent pas. Le filtre de tendance fait la majeure "
        "partie du travail de la stratégie : le couper pour avoir « quelque chose à publier » reviendrait à "
        "vendre du bruit. Nous préférons publier moins.",
        "filter_resume_heading": "Ce qui se passe ensuite",
        "filter_resume": "Quand le Bitcoin repasse au-dessus de sa moyenne 200 jours, la force relative "
        "directionnelles redémarrent seules, au rythme mesuré de 4,35 signaux par jour. Il n'y a rien à "
        "surveiller ni à réactiver : cette page et le canal reprennent automatiquement.",
        "filter_measured": "Chiffres mesurés sur 6 ans (2020-2026), en données journalières, net de frais, avec "
        "un témoin aléatoire pour chaque famille.",
        "filter_note": "Nous préférons ne rien publier plutôt que de vous faire perdre de l'argent en marché "
        "baissier. Les signaux publiés ici sont informatifs et ne constituent pas un conseil en investissement : "
        "vous seul décidez de vos positions.",
        "cta_text": "📡 Reçois ces signaux en temps réel, dès qu'ils sont détectés :",
        "cta_link": lambda username: f"Rejoindre @{username} sur Telegram",
        "journal_link": "📖 Journal de trading public — chaque signal ouvert et clôturé, gains comme pertes, sans filtre",
        "disclaimer": "⚠️ Ce contenu est fourni à titre informatif et pédagogique, il ne constitue pas "
        "un conseil en investissement. Le trading de cryptoactifs comporte un risque de perte en "
        "capital. Les performances passées ne préjugent pas des performances futures.",
        "footer": lambda ts: f"Page générée automatiquement le {ts}.",
        "privacy_link": "Politique de confidentialité",
        "terms_link": "Conditions générales",
        "transparency_link": "Transparence",
        "guides_link": "Guides",
        "how_link": "Comment ça marche",
        "glossary_link": "Glossaire",
        "about_link": "À propos",
        "lang_switch": "English version",
        "date_format": "%d/%m/%Y",
        "footer_date_format": "%d/%m/%Y",  # jour seul, voir Audit#11 (github_publisher.py compare le contenu à l'octet près)
    },
    "en": {
        "html_lang": "en",
        "page_title": lambda date_str: f"Crypto Signals for {date_str} — {SITE_NAME}",
        # Voir le commentaire de la version française ci-dessus.
        "meta_description": lambda n, n_carry, pairs, date_str: (
            f"No crypto signal published on {date_str}: the three directional families stay silent while "
            f"Bitcoin trades below its 200-day moving average, and the funding carry found nothing either. "
            f"Why the silence, and how long it can last."
            if not n
            else f"Free analysis of {n} crypto signals ({pairs}) for {date_str}: {n_carry} funding carry "
            f"position(s), market-neutral trades whose outcome does not depend on price. The directional "
            f"families are idle today. Real track record included."
            if n_carry == n
            else f"Free analysis of {n} crypto signals ({pairs}) for {date_str}, from five engines measured "
            f"over 6 years: relative strength, channel breakout, volatility expansion and funding carry. "
            f"Real track record included."
        ),
        "h1": lambda date_str: f"Free Crypto Signals — {date_str}",
        "subtitle": "Five signal engines, each validated against a random control: relative strength, channel "
        "breakout, volatility expansion, funding carry, and 4-hour momentum. The last two keep producing when "
        "the market falls. Updated daily.",
        "signals_heading": lambda n: f"🔎 Latest {n} signals",
        "signals_note": "Three families buy an uptrend: entry, a deliberately wide 4x ATR stop (disaster "
        "protection, not a management tool), tracking milestones at 4x, 8x and 12x ATR, and a time-based exit — "
        "the date closes the position, not a price target. The fourth one, the funding carry, does not bet on "
        "price at all: it opens two opposite legs and closes on a date. It therefore has no stop loss and no "
        "take profit, and that is normal.",
        # Voir le commentaire de la version française ci-dessus.
        "signals_all_heading": "⚖️ Take them all, or none",
        "signals_all_note": "The directional families win roughly one time out of two, and the median signal "
        "loses 0.69%. That is not a contradiction: profitability comes from a minority of large winners, not "
        "from the majority of signals. Cherry-picking the ones that \"look solid\" statistically amounts to "
        "keeping only the losing part. Reducing the size of every position is legitimate; taking only some of "
        "them is not.",
        "buy_label": "BUY",
        "sell_label": "SELL",
        "carry_label": "CARRY",
        "entry": "Entry",
        "stop_loss": "Stop loss",
        "take_profit": "Take profit",
        # Voir le commentaire de la version française ci-dessus.
        "carry_neutral": "Market-neutral position: price can go up or down, it makes no difference to the "
        "outcome.",
        "carry_legs_heading": "Both legs, opened at the same time and for the same amount",
        "carry_leg_long": lambda pair: f"🟢 Spot buy of {pair}",
        "carry_leg_short": lambda pair: f"🔴 Short sale of the {pair} perpetual",
        "carry_reference": "Reference price",
        "carry_expected": "Expected net funding",
        "carry_expected_value": lambda pct: f"{pct:+.2f}%",
        "carry_close": "Scheduled close",
        "carry_unknown": "—",
        "carry_how": "Perpetual buyers pay funding to sellers every 8 hours. By being short the perpetual you "
        "collect it; since the spot position exactly offsets the perpetual one, price does not enter the "
        "equation. Both legs are closed together on the date shown.",
        "carry_caveats_heading": "What you need to know before opening",
        "carry_caveats": (
            "The stated amount is an estimate at opening, not a given: the funding rate moves during the hold "
            "and can even flip.",
            "This is not \"risk-free\". The short leg can be liquidated if margin becomes insufficient, and "
            "platform risk remains. Over 6 years, one extreme funding day cost -19.86% on a position.",
            "Both legs must be closed at the same time: keeping only one turns a neutral position into a "
            "directional bet.",
        ),
        "perf_type_carry": "CARRY",
        "perf_heading": "📊 Real performance of past signals",
        "perf_pending": "The first signals are still being evaluated — check back soon for real results.",
        "perf_closed": "closed signals",
        "perf_winrate": "win rate",
        "perf_wins": "wins",
        "perf_losses": "losses",
        "perf_table_pair": "Pair",
        "perf_table_type": "Type",
        "perf_table_result": "Result",
        "perf_note": "Result determined automatically by comparing each signal's current price to "
        "its stop loss and take profit (not a tick-by-tick intrabar analysis).",
        # Voir le commentaire de la version française ci-dessus.
        "perf_engine_note": "These results may include signals produced by earlier engines, since switched off. "
        "They therefore do not describe the four families above, which have no live track record yet. A carry's "
        "outcome is not measured on a price but on the funding actually collected, net of fees.",
        "perf_secured": lambda count, pct: f"🔒 {count} ({pct:.0f}%) secured trades (TP1 reached, break-even or better)",
        "paper_heading": "💼 Live performance (paper portfolio)",
        "paper_detail": lambda n, pct: (
            f"If a paper portfolio had allocated {pct:.0f}% of its capital to each of the last "
            f"{n} resolved signals (sent or not), here is its cumulative track record:"
        ),
        "paper_drawdown": lambda dd: f"📉 Worst cumulative drop observed (max drawdown): {dd:.1f}%",
        "paper_note": "⚠️ Illustrative simulation (fixed position sizing, no compounding of gains) — "
        "does not reflect a real account or fees/slippage. Not investment advice.",
        "testimonials_heading": "💬 What people say",
        "testimonials_disclaimer": "⚠️ Fictional examples illustrating the format of user feedback — not real testimonials.",
        "testimonials_real_disclaimer": "✅ Real reviews left via /review by subscribers (anonymized).",
        "review_up": "👍",
        "review_down": "👎",
        "backtest_heading": "🧪 The strategy, measured over 6 years",
        # Voir le commentaire de la version française ci-dessus.
        "backtest_lead": "The number that matters is not the strategy's annual return, it is what someone who "
        "started on a randomly picked date actually lived through:",
        "backtest_stat": "After six months: +5.0% median",
        "backtest_subscriber": "53% of entries are profitable after six months, and the worst case measured is "
        "-61.7%. After three months the median drops to 0.0%, 43% of entries are profitable and the worst case "
        "is -49.0%. This is not a product that makes you rich fast: it limits the damage, and it can still hurt.",
        "backtest_how_heading": "What the engine does",
        "backtest_how": "Every day the 40 tracked pairs are ranked by relative strength — their momentum, "
        "measured on daily data. The 12 strongest are bought and held for 7 days. The exit is time-based: "
        "positions are not sold on a price target. The stop is deliberately wide, at 4x ATR, because it is "
        "disaster protection: it only triggers in 5% of cases.",
        "backtest_tiles": (
            ("8.0", "signals per week while the filter is open"),
            ("47.7%", "winning signals"),
            ("+3.22%", "expectancy per signal, net of fees"),
            ("+16.88%", "average winner, versus -9.24% for a loser"),
        ),
        "backtest_filter_heading": "Why the channel sometimes goes quiet for months",
        "backtest_filter": "No signal is issued while Bitcoin trades below its 200-day moving average. That "
        "filter is closed 41% of the time and its longest closure lasted 381 days. Without it the strategy is "
        "only positive in 4 years out of 7; with it, it has no losing year over 6 years. In 2022 and in 2026 it "
        "simply issued nothing — while holding the same cryptos cost -70.9%, then -39.4%.",
        "backtest_honesty_heading": "What you should know before subscribing",
        "backtest_honesty": (
            "The compounded portfolio shows +83.3% per year over those 6 years, with a maximum drop of -62.9% "
            "and no losing year. <b>This is not what a subscriber will earn</b>: that figure assumes going "
            "through all six years, from day one.",
            "There is no secret ingredient: this is momentum, nothing more. A plain ranking by past return "
            "does just as well.",
            "The trend filter does most of the work. Ranking the pairs only adds about 1.1 point.",
            "This engine went live on 3 August 2026: these figures are measured on historical data, they have "
            "not been lived through in real time yet.",
        ),
        "backtest_detail": "Measured over 6 years (2020-2026) on daily data, net of 0.10% round-trip fees, with "
        "entry delayed by one day after the signal, on a pair universe free of survivorship bias.",
        "backtest_note": "⚠️ Past performance does not guarantee future results. These figures come from "
        "simulations on historical data: they are neither a promise nor a guarantee of profit. Trading "
        "cryptoassets can cost you part or all of the capital committed.",
        # Voir le commentaire de la version française ci-dessus.
        "filter_heading": "🔇 No signal today — and that is on purpose",
        "filter_lead": "This silence is not a failure. The three directional families buy nothing while Bitcoin "
        "trades below its 200-day moving average. The two engines that keep working through that filter — the "
        "funding carry, which is market-neutral, and the 4-hour momentum, which only fires in this very regime "
        "— found nothing today either: the first opens a position only if funding covers its fees, the second "
        "is capped at its two highest-ranked pairs. Nothing will be invented to fill the page.",
        "filter_tiles": (
            ("41%", "of the time with no directional signal"),
            ("381 d", "longest closure (28/12/2021 → 13/01/2023)"),
            ("5", "signals per day at most, across every engine"),
            ("11", "closures of at least one week in 6 years"),
        ),
        "filter_duration_heading": "How long this can last",
        "filter_duration": "Over the last 6 years this filter has been closed 41% of the time. The longest "
        "closure lasted 381 days — 12.7 months, from 28/12/2021 to 13/01/2023. The other long closures lasted "
        "273 days (started on 03/11/2025), 80 days, 47 days and 29 days. A subscription can therefore go "
        "several months in a row without a single signal: expect it, it is not a malfunction.",
        "filter_why_heading": "Why sending nothing is better",
        "filter_why": "Without this filter the strategy is only positive in 4 years out of 7. With it, it has no "
        "losing year over 6 years. In 2022 and in 2026 it simply issued nothing — while holding the same cryptos "
        "cost -70.9%, then -39.4%. Sending nothing is precisely what avoided those two years.",
        "filter_resume_heading": "What happens next",
        "filter_resume": "Once Bitcoin closes back above its 200-day moving average the engine restarts on its "
        "own, at the measured pace of about 8.0 signals per week while the filter stays open. There is nothing "
        "to monitor and nothing to switch back on: this page and the channel resume automatically.",
        "filter_measured": "Figures measured over 2020-2026, as of 3 August 2026 — the day this engine went "
        "live, with Bitcoin trading 10.7% below its 200-day moving average.",
        "filter_note": "We would rather publish nothing than make you lose money in a bear market. The signals "
        "published here are informational and do not constitute investment advice: you alone decide on your "
        "positions.",
        "cta_text": "📡 Get these signals in real time, the moment they're detected:",
        "cta_link": lambda username: f"Join @{username} on Telegram",
        "journal_link": "📖 Public trading journal — every signal opened and closed, wins and losses, no filtering",
        "disclaimer": "⚠️ This content is provided for informational and educational purposes only, "
        "it does not constitute investment advice. Trading cryptoassets carries a risk of capital "
        "loss. Past performance does not guarantee future results.",
        "footer": lambda ts: f"Page automatically generated on {ts}.",
        "privacy_link": "Privacy Policy",
        "terms_link": "Terms of Service",
        "transparency_link": "Transparency",
        "guides_link": "Guides",
        "how_link": "How it works",
        "glossary_link": "Glossary",
        "about_link": "About",
        "lang_switch": "Version française",
        "date_format": "%m/%d/%Y",
        "footer_date_format": "%m/%d/%Y",
    },
}

# La feuille de style vit dans theme.py depuis la refonte : elle occupait
# 170 lignes au milieu de la logique de generation, et les cinq generateurs
# de pages l'importaient deja d'ici. Le reexport garde ces imports valides.
from theme import STYLE as _STYLE
import home_sections


def _signal_card_html(signal, s, lang):
    side = str(signal["type"]).upper()
    est_carry = side == "CARRY"
    css_class = "carry" if est_carry else ("buy" if side == "BUY" else "sell")
    label = s.get("carry_label", "CARRY") if est_carry else (s["buy_label"] if side == "BUY" else s["sell_label"])
    analysis = html.escape(generate_analysis(signal, lang))
    pair = html.escape(signal["pair"])
    chart_html = (
        f'<img class="signal-chart" src="{html.escape(signal["chart_url"])}" alt="{pair} chart" loading="lazy">'
        if signal.get("chart_url")
        else ""
    )

    # Un carry n'a NI stop NI objectif : afficher ces deux cases vides, ou pire
    # remplies d'un zéro, ferait croire à des niveaux de prix à surveiller sur
    # une position qui, par construction, n'en a aucun. Sa carte est donc bâtie
    # à part, avec le vocabulaire aligné mot pour mot sur le message Telegram
    # (workers/main-worker/src/signalFormat.ts) : un abonné qui lit la page puis
    # reçoit le signal doit reconnaître exactement la même chose.
    if est_carry:
        return _carry_card_html(signal, s, pair, label)

    prix_html = (
        f'<span>{s["entry"]}<b>{format_price(signal["entry_price"])}</b></span>'
        f'<span>{s["stop_loss"]}<b>{format_price(signal["stop_loss"])}</b></span>'
        f'<span>{s["take_profit"]}<b>{format_price(signal["take_profit"])}</b></span>'
    )

    return f"""
    <article class="signal-card {css_class}">
      <div class="signal-header">
        <span class="signal-pair">{pair}</span>
        <span class="badge {css_class}">{label}</span>
      </div>
      <div class="prices">{prix_html}</div>
      {chart_html}
      <p>{analysis}</p>
    </article>"""


def _annualise(pct_sur_periode, jours):
    """
    Rendement annualisé, identique à annualisePct côté Worker.

    C'est la seule unité qui permette de juger un carry. « +0,43 % sur la
    période » se lit comme dérisoire pour une position à deux jambes ; le même
    chiffre vaut +7,7 % par an sans exposition au prix. Les deux sont affichés,
    l'annualisé d'abord.
    """
    if not jours or jours <= 0:
        return None
    return ((1 + pct_sur_periode / 100) ** (365 / jours) - 1) * 100


def _carry_card_html(signal, s, pair, label):
    attendu = signal.get("carry_expected_pct")
    jours = None
    if signal.get("hold_until") and signal.get("created_at"):
        try:
            fin = datetime.fromisoformat(str(signal["hold_until"]).replace("Z", "+00:00"))
            debut = datetime.fromisoformat(str(signal["created_at"]).replace("Z", "+00:00"))
            jours = max(1, round((fin - debut).total_seconds() / 86400))
        except (ValueError, TypeError):
            jours = None

    if attendu is not None and jours:
        par_an = _annualise(float(attendu), jours)
        rendement = (
            f"{par_an:+.1f} %".replace(".", ",") + " par an"
            if par_an is not None
            else s["carry_unknown"]
        )
        detail = s["carry_expected_value"](float(attendu)) + f" sur {jours} jours"
    else:
        rendement, detail = s["carry_unknown"], ""

    caveats = "".join(f"<li>{html.escape(c)}</li>" for c in s["carry_caveats"])

    return f"""
    <article class="signal-card carry">
      <div class="signal-header">
        <span class="signal-pair">{pair}</span>
        <span class="badge carry">{label}</span>
      </div>
      <p class="carry-neutral">{html.escape(s["carry_neutral"])}</p>
      <p class="carry-legs-heading"><b>{html.escape(s["carry_legs_heading"])}</b></p>
      <ul class="carry-legs">
        <li>{html.escape(s["carry_leg_long"](signal["pair"]))}</li>
        <li>{html.escape(s["carry_leg_short"](signal["pair"]))}</li>
      </ul>
      <div class="prices">
        <span>{s["carry_reference"]}<b>{format_price(signal["entry_price"])}</b></span>
        <span>{s["carry_expected"]}<b>{rendement}</b></span>
        <span>{s["carry_close"]}<b>{f"{jours} jours" if jours else s["carry_unknown"]}</b></span>
      </div>
      {f'<p class="carry-detail">Soit {detail}, frais déduits.</p>' if detail else ""}
      <p>{html.escape(s["carry_how"])}</p>
      <p class="carry-caveats-heading"><b>{html.escape(s["carry_caveats_heading"])}</b></p>
      <ul class="carry-caveats">{caveats}</ul>
    </article>"""


def _performance_section_html(stats, s):
    if stats["total"] == 0:
        body = f"<p>{s['perf_pending']}</p>"
    else:
        win_rate = stats["win_rate"]
        rows = "".join(
            f"""<tr>
                  <td>{html.escape(row["pair"])}</td>
                  <td>{s["buy_label"] if row["type"] == "BUY" else s["sell_label"]}</td>
                  <td class="outcome-{'win' if row['outcome'] == 'WIN' else 'loss'}">{row["outcome"]}</td>
                </tr>"""
            for row in stats["recent"]
        )
        secured_html = (
            f'<p class="perf-secured">{s["perf_secured"](stats["secured_count"], stats["secured_pct"])}</p>'
            if stats.get("secured_pct") is not None else ""
        )
        body = f"""
        <div class="perf-stats">
          <div class="perf-stat"><b>{stats["total"]}</b>{s["perf_closed"]}</div>
          <div class="perf-stat"><b>{win_rate}%</b>{s["perf_winrate"]}</div>
          <div class="perf-stat"><b>{stats["wins"]}</b>{s["perf_wins"]}</div>
          <div class="perf-stat"><b>{stats["losses"]}</b>{s["perf_losses"]}</div>
        </div>
        {secured_html}
        <table class="recent">
          <thead><tr><th>{s["perf_table_pair"]}</th><th>{s["perf_table_type"]}</th><th>{s["perf_table_result"]}</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        <p style="font-size:0.85rem;color:#777;">{s["perf_note"]}</p>
        <p style="font-size:0.85rem;color:#777;">{s["perf_engine_note"]}</p>"""

    return f"""
    <section>
      <h2>{s["perf_heading"]}</h2>
      {body}
    </section>"""


def _testimonials_section_html(s, lang, reviews=None):
    """
    Étape 3 (preuve sociale) : si des avis réels avec commentaire existent
    (voir supabase_client.get_recent_reviews, table `reviews` alimentée par
    /review), on les affiche à la place des exemples fictifs -- jamais les
    deux mélangés, pour ne jamais laisser un vrai avis se noyer parmi des
    exemples ni l'inverse. Sans avis réel, on retombe sur EXEMPLE_TESTIMONIALS
    (voir testimonials.py), toujours explicitement étiqueté comme fictif.
    """
    if reviews:
        quotes_html = "".join(
            f'<blockquote><p>{s["review_up"] if r["rating"] == "up" else s["review_down"]} « {html.escape(r["comment"])} »</p></blockquote>'
            for r in reviews
        )
        disclaimer = s["testimonials_real_disclaimer"]
    else:
        examples = EXAMPLE_TESTIMONIALS if lang == "fr" else EXAMPLE_TESTIMONIALS_EN
        quote_mark = "«" if lang == "fr" else "“"
        quote_close = "»" if lang == "fr" else "”"
        quotes_html = "".join(
            f'<blockquote><p>{quote_mark} {html.escape(t["quote"])} {quote_close}</p><cite>— {html.escape(t["name"])}</cite></blockquote>'
            for t in examples
        )
        disclaimer = s["testimonials_disclaimer"]

    return f"""
    <section class="testimonials">
      <h2>{s["testimonials_heading"]}</h2>
      {quotes_html}
      <p style="font-size:0.82rem;color:#777;">{disclaimer}</p>
    </section>"""


def _backtest_section_html(backtest_stats, s):
    """
    Description de la stratégie Force Relative et de ses chiffres mesurés sur
    6 ans (2020-2026).

    `backtest_stats` (ligne active de strategy_params) ne sert plus qu'à
    décider si la section est affichée : main.py ne la transmet que pour les
    pages d'accueil, pas pour les archives. Ses champs win_rate/trade_count ne
    sont volontairement PLUS lus. Ils proviennent du backtest de l'ancien
    moteur horaire (croisement EMA + RSI bas), désactivé le 03/08/2026 : les
    afficher sous une description du moteur Force Relative lui attribuerait des
    résultats qui ne sont pas les siens — exactement le mécanisme qui a laissé
    un « 61,2 % de réussite » sur le site pendant des mois.
    """
    if not backtest_stats:
        return ""

    tiles_html = "".join(
        f'<div class="perf-stat"><b>{value}</b>{label}</div>'
        for value, label in s["backtest_tiles"]
    )
    honesty_html = "".join(f"<li>{item}</li>" for item in s["backtest_honesty"])

    return f"""
    <section class="backtest">
      <h2>{s["backtest_heading"]}</h2>
      <p>{s["backtest_lead"]}</p>
      <p class="backtest-stat">{s["backtest_stat"]}</p>
      <p>{s["backtest_subscriber"]}</p>
      <p class="sub-heading">{s["backtest_how_heading"]}</p>
      <p>{s["backtest_how"]}</p>
      <div class="perf-stats">{tiles_html}</div>
      <p class="sub-heading">{s["backtest_filter_heading"]}</p>
      <p>{s["backtest_filter"]}</p>
      <p class="sub-heading">{s["backtest_honesty_heading"]}</p>
      <ul>{honesty_html}</ul>
      <p class="backtest-detail">{s["backtest_detail"]}</p>
      <p class="backtest-caveat">{s["backtest_note"]}</p>
    </section>"""


def _no_signal_section_html(s):
    """
    Bloc affiché les jours SANS signal, c'est-à-dire quand le filtre de
    tendance est fermé (Bitcoin sous sa moyenne mobile 200 jours).

    Ces jours-là représentent 41 % du temps et peuvent s'enchaîner pendant des
    mois — 381 jours pour la plus longue fermeture mesurée. Les traiter comme
    un incident (page vide, ou pire, signal de remplissage) serait malhonnête
    et ferait fuir l'abonné au moment précis où le filtre lui rend le plus
    service. Le silence est donc expliqué avec le même soin qu'un signal : sa
    durée possible, y compris la pire mesurée, et la raison pour laquelle il
    est voulu.
    """
    tiles_html = "".join(
        f'<div class="perf-stat"><b>{value}</b>{label}</div>'
        for value, label in s["filter_tiles"]
    )

    return f"""
    <section class="filter-closed">
      <h2>{s["filter_heading"]}</h2>
      <p class="lead">{s["filter_lead"]}</p>
      <div class="perf-stats">{tiles_html}</div>
      <p class="sub-heading">{s["filter_duration_heading"]}</p>
      <p>{s["filter_duration"]}</p>
      <p class="sub-heading">{s["filter_why_heading"]}</p>
      <p>{s["filter_why"]}</p>
      <p class="sub-heading">{s["filter_resume_heading"]}</p>
      <p>{s["filter_resume"]}</p>
      <p class="measured">{s["filter_measured"]}</p>
      <p class="note">{s["filter_note"]}</p>
    </section>"""


def build_daily_page(signals, performance_stats, page_date, canonical_path, lang="fr", alternate_path=None,
                      backtest_stats=None, resolved_signals=None, reviews=None,
                      filtre_ouvert=None, est_accueil=False):
    """
    Construit la page HTML complète pour une date donnée, dans la langue `lang` ("fr"/"en").
    `alternate_path` : chemin de la page équivalente dans l'autre langue (pour hreflang + lien de bascule).
    `resolved_signals` : voir supabase_client.get_all_resolved_signals() -- portefeuille fictif (Bloc 11.1).
    `reviews` : voir supabase_client.get_recent_reviews() -- Étape 3, avis réels /review.

    `signals` peut être vide : depuis le 03/08/2026 le moteur ne publie rien
    tant que le Bitcoin est sous sa moyenne mobile 200 jours, ce qui arrive
    41 % du temps. La page reste alors complète et explique le silence
    (_no_signal_section_html) au lieu d'afficher une section de signaux vide.
    """
    s = _STRINGS[lang]
    date_str = page_date.strftime(s["date_format"])
    pairs_list = ", ".join(html.escape(sig["pair"]) for sig in signals)
    title = s["page_title"](date_str)
    # Le nombre de carrys est compté séparément : la description change selon
    # que la journée ne contient QUE des carrys — cas normal quand le filtre de
    # tendance est fermé — ou un mélange des moteurs. Annoncer
    # « 4 signaux » sans préciser que ce sont des positions neutres au marché
    # laisserait croire à quatre paris directionnels.
    n_carry = sum(1 for sig in signals if str(sig.get("type", "")).upper() == "CARRY")
    description = s["meta_description"](len(signals), n_carry, pairs_list, date_str)
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"

    # Sur l'accueil, le hero porte la promesse produit et le titre daté revient
    # au-dessus des signaux. Sur une page datée, le hero porte déjà ce titre :
    # le répéter en ferait deux, pour un seul bloc de contenu.
    titre_signaux = s["h1"](date_str) if est_accueil else s["signals_heading"](len(signals))

    # Deux états possibles, et le second n'est pas un cas dégradé : soit des
    # signaux du jour, soit l'explication du filtre de tendance fermé.
    if signals:
        cards_html = "".join(_signal_card_html(sig, s, lang) for sig in signals)
        # Une seule section, un seul titre. Le titre daté et « Les N derniers
        # signaux » se suivaient à trois centimètres d'écart, ce qui faisait
        # bafouiller la page : deux en-têtes pour un seul bloc de contenu.
        signals_html = f"""
    <section id="signaux">
      <h2>{titre_signaux}</h2>
      <p class="subtitle">{s["subtitle"]}</p>
      <p class="signals-note">{s["signals_note"]}</p>
      {cards_html}
    </section>"""
    else:
        signals_html = _no_signal_section_html(s)

    performance_html = _performance_section_html(performance_stats, s)
    paper_html = build_live_performance_section(resolved_signals or [], s)
    testimonials_html = _testimonials_section_html(s, lang, reviews=reviews)

    hreflang_tags = ""
    lang_switch_html = ""
    if alternate_path:
        other_lang = "en" if lang == "fr" else "fr"
        alternate_url = f"{SITE_BASE_URL}{alternate_path}"
        hreflang_tags = (
            f'<link rel="alternate" hreflang="{lang}" href="{canonical_url}">\n'
            f'  <link rel="alternate" hreflang="{other_lang}" href="{alternate_url}">\n'
            f'  <link rel="alternate" hreflang="x-default" href="{SITE_BASE_URL}/">'
        )
        lang_switch_html = f'<p class="lang-switch"><a href="{alternate_path}">{s["lang_switch"]}</a></p>'

    footer_ts = datetime.now().strftime(s["footer_date_format"])
    backtest_html = _backtest_section_html(backtest_stats, s)

    return f"""<!DOCTYPE html>
<html lang="{s["html_lang"]}">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
  {hreflang_tags}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{html.escape(title)}">
  <meta property="og:description" content="{html.escape(description)}">
  <meta property="og:url" content="{canonical_url}">
  <style>{_STYLE}</style>
  {home_sections.faq_schema_org(lang)}
</head>
<body>
  {lang_switch_html}

  {home_sections.hero_html(lang, filtre_ouvert=filtre_ouvert,
                           titre_specifique=None if est_accueil else s["h1"](date_str))}

  {home_sections.etapes_html(lang)}

  {signals_html}

  {performance_html}

  {backtest_html}

  {paper_html}

  {testimonials_html}

  {home_sections.faq_html(lang)}

  {home_sections.appel_html(lang)}

  <p class="disclaimer">{s["disclaimer"]}</p>

  <footer>
    <p>{s["footer"](footer_ts)} — <a href="/privacy.html">{s["privacy_link"]}</a> — <a href="/terms.html">{s["terms_link"]}</a> — <a href="/transparency.html">{s["transparency_link"]}</a> — <a href="/guides/">{s["guides_link"]}</a> — <a href="/comment-ca-marche.html">{s["how_link"]}</a> — <a href="/faq.html">FAQ</a> — <a href="/glossaire.html">{s["glossary_link"]}</a> — <a href="/a-propos.html">{s["about_link"]}</a> — <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""
