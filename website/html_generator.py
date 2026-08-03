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

# Refonte du 03/08/2026 : le moteur « RSI bas » a été désactivé et remplacé par
# le moteur Force Relative (voir signals/relative_strength.py et
# DECOUVERTE_FORCE_RELATIVE_2026-08-03.md). Tous les textes décrivant la
# stratégie ci-dessous ont été réécrits en conséquence. Chaque chiffre qu'ils
# contiennent provient d'une mesure sur 6 ans (2020-2026) — aucun n'est arrondi
# à l'avantage, aucun n'est repris d'un autre moteur.
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
        # Les jours sans signal ne sont pas un cas dégradé : le filtre de
        # tendance est fermé 41 % du temps. La description doit donc rester
        # juste ET compréhensible avec zéro signal, sinon les moteurs de
        # recherche indexent « 0 signaux » sans la moindre explication.
        "meta_description": lambda n, pairs, date_str: (
            f"Analyse gratuite de {n} signaux crypto ({pairs}) du {date_str} : les paires les plus fortes "
            f"d'un classement quotidien de 40 cryptos, conservées 7 jours. Résultats réels inclus."
            if n
            else f"Aucun signal crypto publié le {date_str} : le moteur n'émet rien tant que le Bitcoin est "
            f"sous sa moyenne mobile 200 jours. Pourquoi ce silence, et combien de temps il peut durer."
        ),
        "h1": lambda date_str: f"Signaux crypto gratuits — {date_str}",
        "subtitle": "Classement quotidien de 40 paires par force relative : les 12 plus fortes, conservées 7 jours. "
        "Aucun signal tant que le Bitcoin est sous sa moyenne mobile 200 jours. Mis à jour chaque jour.",
        "signals_heading": lambda n: f"🔎 Les {n} derniers signaux",
        "signals_note": "Chaque signal est l'une des 12 paires les plus fortes du classement du jour. La position "
        "est conservée 7 jours : la sortie est temporelle, pas sur objectif de prix. Le stop à 4x l'ATR est une "
        "protection contre l'accident (il ne se déclenche que dans 5 % des cas) et les objectifs à 4x, 8x et 12x "
        "l'ATR sont des jalons de suivi.",
        "buy_label": "ACHAT",
        "sell_label": "VENTE",
        "entry": "Entrée",
        "stop_loss": "Stop loss",
        "take_profit": "Take profit",
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
        # vécus à la stratégie décrite plus haut. Ce sont deux moteurs
        # différents : les mélanger serait exactement la faute du
        # « 61,2 % de réussite ».
        "perf_engine_note": "Ces résultats peuvent inclure des signaux émis par le moteur précédent, désactivé "
        "le 3 août 2026. Ils ne décrivent donc pas la stratégie Force Relative présentée plus haut, qui n'a pas "
        "encore d'historique en direct.",
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
        "À trois mois, la médiane tombe à 0,0 %, 43 % des entrées sont gagnantes et le pire cas est -49,0 %. "
        "Ce n'est pas un produit qui enrichit vite : c'est un produit qui limite la casse, et il peut faire mal.",
        "backtest_how_heading": "Ce que fait le moteur",
        "backtest_how": "Chaque jour, les 40 paires suivies sont classées par force relative — leur momentum, "
        "mesuré sur des données journalières. Les 12 plus fortes sont achetées et conservées 7 jours. La sortie "
        "est temporelle : on ne revend pas sur objectif de prix. Le stop est volontairement large, à 4x l'ATR, "
        "car c'est une protection contre l'accident : il ne se déclenche que dans 5 % des cas.",
        "backtest_tiles": (
            ("8,0", "signaux par semaine, filtre ouvert"),
            ("47,7 %", "de signaux gagnants"),
            ("+3,22 %", "espérance par signal, net de frais"),
            ("+16,88 %", "gagnant moyen, contre -9,24 % pour un perdant"),
        ),
        "backtest_filter_heading": "Pourquoi le canal se tait parfois pendant des mois",
        "backtest_filter": "Aucun signal n'est émis quand le Bitcoin est sous sa moyenne mobile 200 jours. Ce "
        "filtre est fermé 41 % du temps et sa plus longue fermeture a duré 381 jours. Sans lui, la stratégie "
        "n'est positive que 4 années sur 7 ; avec lui, elle n'a aucune année perdante sur 6 ans. En 2022 et en "
        "2026, elle n'a tout simplement rien émis — pendant que détenir les mêmes cryptos coûtait -70,9 %, puis "
        "-39,4 %.",
        "backtest_honesty_heading": "Ce qu'il faut savoir avant de s'abonner",
        "backtest_honesty": (
            "Le portefeuille composé affiche +83,3 % par an sur ces 6 ans, avec une chute maximale de -62,9 % "
            "et aucune année perdante. <b>Ce n'est pas ce que gagnera un abonné</b> : ce chiffre suppose "
            "d'avoir traversé les six années entières, dès le premier jour.",
            "Il n'y a pas d'ingrédient secret : c'est du momentum, rien de plus. Un simple classement par "
            "rendement passé fait aussi bien.",
            "C'est le filtre de tendance qui fait la majeure partie du travail. Le classement des paires "
            "n'ajoute qu'environ 1,1 point.",
            "Ce moteur a été mis en service le 3 août 2026 : ces chiffres sont mesurés sur l'historique, ils "
            "n'ont pas encore été vécus en direct.",
        ),
        "backtest_detail": "Mesuré sur 6 ans (2020-2026), en données journalières, net de 0,10 % de frais "
        "aller-retour, avec une entrée décalée d'un jour après le signal, sur un univers de paires non "
        "contaminé par le biais du survivant.",
        "backtest_note": "⚠️ Une performance passée ne préjuge pas des performances futures. Ces chiffres "
        "proviennent de simulations sur données historiques : ils ne sont ni une promesse, ni une garantie de "
        "gain. Le trading de cryptoactifs peut faire perdre tout ou partie du capital engagé.",
        # Bloc affiché les jours sans signal. Il est écrit avec le même soin
        # qu'une page de vente parce que c'est le moment exact où l'abonné se
        # demande à quoi il paie — et parce que c'est vrai : ces jours-là sont
        # ceux où la stratégie lui rend le plus service.
        "filter_heading": "🔇 Aucun signal aujourd'hui — et c'est voulu",
        "filter_lead": "Ce silence n'est pas une panne. Le moteur n'achète rien tant que le Bitcoin évolue sous "
        "sa moyenne mobile 200 jours : tant que ce niveau n'est pas repassé, il n'y a rien à publier ici, et "
        "rien ne sera inventé pour remplir la page.",
        "filter_tiles": (
            ("41 %", "du temps sans aucun signal"),
            ("381 j", "la plus longue fermeture (28/12/2021 → 13/01/2023)"),
            ("25 j", "durée médiane d'une fermeture d'au moins une semaine"),
            ("11", "fermetures d'au moins une semaine en 6 ans"),
        ),
        "filter_duration_heading": "Combien de temps ça peut durer",
        "filter_duration": "Sur les 6 dernières années, ce filtre a été fermé 41 % du temps. La plus longue "
        "fermeture a duré 381 jours, soit 12,7 mois, du 28/12/2021 au 13/01/2023. Les autres fermetures longues "
        "ont duré 273 jours (commencée le 03/11/2025), 80 jours, 47 jours et 29 jours. Un abonnement peut donc "
        "traverser plusieurs mois d'affilée sans le moindre signal : c'est à prévoir, pas une anomalie.",
        "filter_why_heading": "Pourquoi ne rien envoyer vaut mieux",
        "filter_why": "Sans ce filtre, la stratégie n'est positive que 4 années sur 7. Avec lui, elle n'a aucune "
        "année perdante sur 6 ans. En 2022 et en 2026, elle n'a tout simplement rien émis — pendant que détenir "
        "les mêmes cryptos coûtait -70,9 %, puis -39,4 %. Ne rien envoyer est exactement ce qui a évité ces "
        "deux années-là.",
        "filter_resume_heading": "Ce qui se passe ensuite",
        "filter_resume": "Quand le Bitcoin repasse au-dessus de sa moyenne 200 jours, le moteur redémarre seul, "
        "au rythme mesuré d'environ 8,0 signaux par semaine tant que le filtre reste ouvert. Il n'y a rien à "
        "surveiller ni à réactiver : cette page et le canal reprennent automatiquement.",
        "filter_measured": "Chiffres mesurés sur 2020-2026, arrêtés au 3 août 2026 — jour de la mise en service "
        "de ce moteur, où le Bitcoin cotait 10,7 % sous sa moyenne mobile 200 jours.",
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
        "meta_description": lambda n, pairs, date_str: (
            f"Free analysis of {n} crypto signals ({pairs}) for {date_str}: the strongest pairs from a daily "
            f"ranking of 40 cryptos, held for 7 days. Real track record included."
            if n
            else f"No crypto signal published on {date_str}: the engine stays silent while Bitcoin trades below "
            f"its 200-day moving average. Why the silence, and how long it can last."
        ),
        "h1": lambda date_str: f"Free Crypto Signals — {date_str}",
        "subtitle": "Daily ranking of 40 pairs by relative strength: the 12 strongest, held for 7 days. "
        "No signal while Bitcoin trades below its 200-day moving average. Updated daily.",
        "signals_heading": lambda n: f"🔎 Latest {n} signals",
        "signals_note": "Each signal is one of the 12 strongest pairs in today's ranking. The position is held "
        "for 7 days: the exit is time-based, not price-target based. The 4x ATR stop is disaster protection "
        "(it only triggers in 5% of cases) and the 4x, 8x and 12x ATR targets are tracking milestones.",
        "buy_label": "BUY",
        "sell_label": "SELL",
        "entry": "Entry",
        "stop_loss": "Stop loss",
        "take_profit": "Take profit",
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
        "perf_engine_note": "These results may include signals produced by the previous engine, switched off on "
        "3 August 2026. They therefore do not describe the Relative Strength strategy above, which has no live "
        "track record yet.",
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
        "filter_lead": "This silence is not a failure. The engine buys nothing while Bitcoin trades below its "
        "200-day moving average: until that level is reclaimed there is nothing to publish here, and nothing "
        "will be invented to fill the page.",
        "filter_tiles": (
            ("41%", "of the time with no signal at all"),
            ("381 d", "longest closure (28/12/2021 → 13/01/2023)"),
            ("25 d", "median length of a closure of at least one week"),
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

_STYLE = """
  /* Refonte visuelle du 02/08/2026. L'ancienne feuille était fonctionnelle
     mais neutre : fond blanc, texte noir, un seul accent violet. Dans un
     secteur où la première impression décide en quelques secondes, un site
     qui ressemble à une page de documentation ne donne pas envie d'essayer.

     Parti pris : sombre par défaut (attendu dans l'univers crypto/trading),
     accents bleu et or, hiérarchie typographique nette. Tout est en CSS pur
     — aucune police externe, aucun script : le site reste instantané et
     fonctionne sans JavaScript. */
  :root {
    --bg: #0b0e14;
    --bg-soft: #131822;
    --bg-card: #171d29;
    --border: #252d3d;
    --text: #e6ebf4;
    --text-dim: #98a2b8;
    --accent: #4f8cff;
    --accent-soft: #1e3a6b;
    --gold: #f0b429;
    --win: #22c55e;
    --loss: #ef4444;
    --radius: 14px;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    max-width: 860px; margin: 0 auto; padding: 28px 18px 72px;
    line-height: 1.65; font-size: 16px;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); }

  /* Apparition douce au défilement, sans JavaScript : l'animation se
     déclenche au chargement, décalée par section. Respecte
     prefers-reduced-motion. */
  header, section, .cta, .backtest { animation: fade-up .5s ease-out both; }
  section:nth-of-type(2) { animation-delay: .06s; }
  section:nth-of-type(3) { animation-delay: .12s; }
  section:nth-of-type(4) { animation-delay: .18s; }
  @keyframes fade-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
    html { scroll-behavior: auto; }
  }

  h1 {
    font-size: clamp(1.9rem, 5vw, 2.6rem); line-height: 1.15; margin: 0 0 10px;
    letter-spacing: -0.02em; font-weight: 800;
    background: linear-gradient(120deg, var(--text) 30%, var(--accent));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h2 {
    font-size: 1.3rem; margin-top: 2.8rem; padding-bottom: 8px; font-weight: 700;
    border-bottom: 1px solid var(--border); letter-spacing: -0.01em;
  }
  .subtitle { color: var(--text-dim); margin-top: 0; font-size: 1.05rem; }
  .lang-switch { text-align: right; font-size: 0.85rem; color: var(--text-dim); }

  .signal-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 18px 20px; margin: 16px 0;
    transition: border-color .2s, transform .2s;
  }
  .signal-card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .signal-card.buy { border-left: 4px solid var(--win); }
  .signal-card.sell { border-left: 4px solid var(--loss); }
  .signal-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  .signal-pair { font-weight: 700; font-size: 1.15rem; }
  .badge { padding: 3px 12px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; color: #08111f; }
  .badge.buy { background: var(--win); }
  .badge.sell { background: var(--loss); color: #fff; }
  .prices { display: flex; gap: 22px; margin: 14px 0; flex-wrap: wrap; font-size: 0.86rem; color: var(--text-dim); }
  .prices span b { display: block; font-size: 1.05rem; color: var(--text); font-variant-numeric: tabular-nums; }
  .signal-chart { max-width: 100%; border-radius: 10px; margin: 12px 0; border: 1px solid var(--border); }

  .cta {
    background: linear-gradient(135deg, var(--accent-soft), #0f2547);
    border: 1px solid var(--accent); color: var(--text);
    padding: 30px 24px; border-radius: var(--radius); text-align: center; margin: 3rem 0;
  }
  .cta a {
    display: inline-block; margin-top: 10px; padding: 13px 30px;
    background: var(--accent); color: #06101f; font-weight: 800;
    border-radius: 999px; text-decoration: none; font-size: 1.05rem;
    transition: transform .15s, box-shadow .15s;
  }
  .cta a:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(79,140,255,.35); }

  .backtest { background: var(--bg-soft); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px; margin: 2rem 0; }
  .backtest h2 { margin-top: 0; border-bottom: none; }
  .backtest-stat { font-size: 1.5rem; font-weight: 800; color: var(--gold); margin: 6px 0; letter-spacing: -0.01em; }
  .backtest ul { padding-left: 1.15rem; margin: 8px 0 0; }
  .backtest li { margin: 8px 0; }
  .backtest-detail { font-size: 0.88rem; color: var(--text-dim); }
  /* L'encadré d'avertissement était écrit en couleurs claires en dur
     (#fffbeb sur #b45309), hérité du thème blanc : un rectangle blanc au
     milieu d'une page sombre. Mêmes rôles visuels, variables du thème. */
  .backtest-caveat {
    font-size: 0.88rem; color: var(--text-dim); background: var(--bg-card);
    border-left: 3px solid var(--gold); border-radius: 8px;
    padding: 11px 13px; margin: 14px 0 0;
  }
  .sub-heading { font-weight: 700; color: var(--text); margin: 22px 0 4px; letter-spacing: -0.01em; }
  .signals-note { font-size: 0.9rem; color: var(--text-dim); margin-top: 4px; }

  /* Bloc des jours sans signal (filtre de tendance fermé). Ces jours-là
     représentent 41 % du temps : l'explication doit être aussi visible qu'un
     signal, pas reléguée en note de bas de page. L'or (--gold) est déjà la
     couleur des chiffres qui comptent — aucune teinte nouvelle. */
  .filter-closed {
    background: var(--bg-soft); border: 1px solid var(--border);
    border-left: 4px solid var(--gold); border-radius: var(--radius);
    padding: 24px; margin: 2rem 0;
  }
  .filter-closed h2 { margin-top: 0; border-bottom: none; color: var(--gold); }
  .filter-closed .lead { font-size: 1.08rem; }
  .filter-closed .measured { font-size: 0.85rem; color: var(--text-dim); }
  .filter-closed .note {
    font-size: 0.9rem; color: var(--text-dim);
    border-top: 1px solid var(--border); padding-top: 14px; margin-bottom: 0;
  }

  .perf-stats { display: flex; gap: 14px; flex-wrap: wrap; margin: 18px 0; }
  .perf-stat {
    flex: 1 1 120px; text-align: center; background: var(--bg-card);
    border: 1px solid var(--border); border-radius: 12px; padding: 16px 10px;
    font-size: .82rem; color: var(--text-dim);
  }
  .perf-stat b { display: block; font-size: 1.7rem; color: var(--text); font-variant-numeric: tabular-nums; }

  table.recent { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 14px; }
  table.recent th { text-align: left; padding: 9px 10px; color: var(--text-dim); font-weight: 600; border-bottom: 1px solid var(--border); }
  table.recent td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
  .outcome-win { color: var(--win); font-weight: 700; }
  .outcome-loss { color: var(--loss); font-weight: 700; }

  .disclaimer { font-size: 0.82rem; color: var(--text-dim); margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 14px; }
  footer { margin-top: 2rem; font-size: 0.85rem; color: var(--text-dim); }
  footer a { color: var(--text-dim); }

  @media (max-width: 600px) {
    body { padding: 20px 14px 56px; }
    .prices { gap: 14px; }
    .perf-stat b { font-size: 1.45rem; }
  }
"""


def _signal_card_html(signal, s, lang):
    side = signal["type"]
    css_class = "buy" if side == "BUY" else "sell"
    label = s["buy_label"] if side == "BUY" else s["sell_label"]
    analysis = html.escape(generate_analysis(signal, lang))
    pair = html.escape(signal["pair"])
    chart_html = (
        f'<img class="signal-chart" src="{html.escape(signal["chart_url"])}" alt="{pair} chart" loading="lazy">'
        if signal.get("chart_url")
        else ""
    )

    return f"""
    <article class="signal-card {css_class}">
      <div class="signal-header">
        <span class="signal-pair">{pair}</span>
        <span class="badge {css_class}">{label}</span>
      </div>
      <div class="prices">
        <span>{s["entry"]}<b>{format_price(signal["entry_price"])}</b></span>
        <span>{s["stop_loss"]}<b>{format_price(signal["stop_loss"])}</b></span>
        <span>{s["take_profit"]}<b>{format_price(signal["take_profit"])}</b></span>
      </div>
      {chart_html}
      <p>{analysis}</p>
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
                      backtest_stats=None, resolved_signals=None, reviews=None):
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
    description = s["meta_description"](len(signals), pairs_list, date_str)
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"

    # Deux états possibles, et le second n'est pas un cas dégradé : soit des
    # signaux du jour, soit l'explication du filtre de tendance fermé.
    if signals:
        cards_html = "".join(_signal_card_html(sig, s, lang) for sig in signals)
        signals_html = f"""
    <section>
      <h2>{s["signals_heading"](len(signals))}</h2>
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
</head>
<body>
  {lang_switch_html}
  <header>
    <h1>{s["h1"](date_str)}</h1>
    <p class="subtitle">{s["subtitle"]}</p>
  </header>

  {backtest_html}

  {signals_html}

  {performance_html}

  {paper_html}

  {testimonials_html}

  <div class="cta">
    <p>{s["cta_text"]}</p>
    <a href="{TELEGRAM_URL}">{s["cta_link"](TELEGRAM_BOT_USERNAME)}</a>
    <p><a href="{TELEGRAM_CHANNEL_URL}">{s["journal_link"]}</a></p>
  </div>

  <p class="disclaimer">{s["disclaimer"]}</p>

  <footer>
    <p>{s["footer"](footer_ts)} — <a href="/privacy.html">{s["privacy_link"]}</a> — <a href="/terms.html">{s["terms_link"]}</a> — <a href="/transparency.html">{s["transparency_link"]}</a> — <a href="/guides/">{s["guides_link"]}</a> — <a href="/comment-ca-marche.html">{s["how_link"]}</a> — <a href="/faq.html">FAQ</a> — <a href="/glossaire.html">{s["glossary_link"]}</a> — <a href="/a-propos.html">{s["about_link"]}</a> — <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""
