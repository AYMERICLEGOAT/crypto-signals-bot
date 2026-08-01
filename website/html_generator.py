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

# Audit#4 : doit rester synchronisé avec signals/backtest.py (MIN_SIGNIFICANT_TRADES).
# En dessous de ce seuil, un taux de réussite (même 0% ou 100%) n'est pas fiable
# statistiquement — l'afficher tel quel serait trompeur (positif comme négatif).
MIN_SIGNIFICANT_TRADES = 15

_STRINGS = {
    "fr": {
        "html_lang": "fr",
        "page_title": lambda date_str: f"Signaux crypto du {date_str} — {SITE_NAME}",
        "meta_description": lambda n, pairs, date_str: (
            f"Analyse gratuite de {n} signaux crypto ({pairs}) du {date_str}, générée "
            f"automatiquement (croisement EMA9/21 + RSI). Résultats réels des signaux précédents inclus."
        ),
        "h1": lambda date_str: f"Signaux crypto gratuits — {date_str}",
        "subtitle": "Analyse technique automatique (EMA 9/21 + RSI) sur les paires les plus tradées. "
        "Contenu généré et mis à jour chaque jour.",
        "signals_heading": lambda n: f"🔎 Les {n} derniers signaux",
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
        "backtest_heading": "🧪 Backtest de la stratégie",
        # Audit du 01/08/2026 : un taux de réussite affiché SEUL est la façon
        # la plus trompeuse de présenter une stratégie. 61% de réussite avec un
        # ratio gain/perte de 0,67 n'est PAS rentable (61 x 0,67 = 40,9 contre
        # 39 x 1,0 = 39,0, soit l'équilibre au cheveu près). Mesuré sur ces
        # mêmes 24 mois, l'espérance de la stratégie est négative
        # (-0,019%/trade, voir signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md).
        # Vendre un abonnement sur ce chiffre serait une pratique commerciale
        # trompeuse (art. L121-2 code de la consommation). Le taux reste
        # affiché — il est factuel — mais accompagné de ce qu'il faut pour ne
        # pas le confondre avec une promesse de gain.
        "backtest_stat": lambda win_rate, trades: (
            f"{win_rate:.1f}% des trades atteignent leur premier objectif ({trades} trades simulés sur 24 mois)"
        ),
        "backtest_winrate_caveat": (
            "⚠️ Un taux de réussite élevé ne signifie pas rentable : ce qui compte est le rapport entre "
            "ce que rapportent les trades gagnants et ce que coûtent les perdants. Sur cette période simulée, "
            "les deux se compensent quasiment — la stratégie n'a pas démontré de rentabilité. "
            "Aucune performance n'est promise."
        ),
        "backtest_insignificant": lambda trades, min_trades: (
            f"Échantillon encore trop petit pour être significatif ({trades} trades sur 24 mois) "
            f"— taux de réussite non affiché tant que le seuil de {min_trades} trades n'est pas atteint."
        ),
        "backtest_detail": "Simulé sur 40 paires, données horaires réelles Binance des 24 derniers mois.",
        "backtest_note": "⚠️ Résultat d'une optimisation \"in-sample\" (sur les données ayant servi à choisir "
        "les paramètres) : une performance passée ne garantit pas un résultat identique en conditions réelles. "
        "Ce backtest est mis à jour automatiquement à chaque nouvelle exécution.",
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
        "lang_switch": "English version",
        "date_format": "%d/%m/%Y",
        "footer_date_format": "%d/%m/%Y",  # jour seul, voir Audit#11 (github_publisher.py compare le contenu à l'octet près)
    },
    "en": {
        "html_lang": "en",
        "page_title": lambda date_str: f"Crypto Signals for {date_str} — {SITE_NAME}",
        "meta_description": lambda n, pairs, date_str: (
            f"Free analysis of {n} crypto signals ({pairs}) for {date_str}, automatically generated "
            f"(EMA9/21 crossover + RSI). Real track record of past signals included."
        ),
        "h1": lambda date_str: f"Free Crypto Signals — {date_str}",
        "subtitle": "Automated technical analysis (EMA 9/21 + RSI) on the most traded pairs. "
        "Content generated and updated daily.",
        "signals_heading": lambda n: f"🔎 Latest {n} signals",
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
        "backtest_heading": "🧪 Strategy backtest",
        # Voir le commentaire de la version française ci-dessus.
        "backtest_stat": lambda win_rate, trades: (
            f"{win_rate:.1f}% of trades reach their first target ({trades} simulated trades over 24 months)"
        ),
        "backtest_winrate_caveat": (
            "⚠️ A high win rate does not mean profitable: what matters is how much winners earn versus "
            "how much losers cost. Over this simulated period the two roughly cancel out — the strategy "
            "has not demonstrated profitability. No performance is promised."
        ),
        "backtest_insignificant": lambda trades, min_trades: (
            f"Sample still too small to be statistically significant ({trades} trades over 24 months) "
            f"— win rate hidden until the {min_trades}-trade threshold is reached."
        ),
        "backtest_detail": "Simulated on 28 pairs, real hourly Binance data from the last 24 months.",
        "backtest_note": "⚠️ Result of an \"in-sample\" optimization (using the same data that chose the "
        "parameters): past performance does not guarantee identical real-world results. This backtest is "
        "updated automatically on every new run.",
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
        "lang_switch": "Version française",
        "date_format": "%m/%d/%Y",
        "footer_date_format": "%m/%d/%Y",
    },
}

_STYLE = """
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 780px;
         margin: 0 auto; padding: 24px 16px 64px; line-height: 1.55; }
  h1 { font-size: 1.7rem; margin-bottom: 4px; }
  h2 { font-size: 1.25rem; margin-top: 2.5rem; border-bottom: 2px solid #6366f1; padding-bottom: 6px; }
  .subtitle { color: #666; margin-top: 0; }
  .lang-switch { text-align: right; font-size: 0.85rem; }
  .signal-card { border: 1px solid #d8d8e0; border-radius: 10px; padding: 16px 18px; margin: 16px 0; }
  .signal-card.buy { border-left: 5px solid #16a34a; }
  .signal-card.sell { border-left: 5px solid #dc2626; }
  .signal-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  .signal-pair { font-weight: 700; font-size: 1.1rem; }
  .badge { padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; color: white; }
  .badge.buy { background: #16a34a; }
  .badge.sell { background: #dc2626; }
  .prices { display: flex; gap: 18px; margin: 10px 0; flex-wrap: wrap; font-size: 0.92rem; }
  .prices span b { display: block; font-size: 1rem; }
  .signal-chart { max-width: 100%; border-radius: 8px; margin: 10px 0; }
  .cta { background: linear-gradient(135deg, #6366f1, #4338ca); color: white; padding: 24px;
         border-radius: 12px; text-align: center; margin: 2.5rem 0; }
  .cta a { color: white; font-weight: 700; font-size: 1.1rem; text-decoration: underline; }
  .backtest { background: #f5f5ff; border: 1px solid #e0e0f5; border-radius: 12px; padding: 18px 20px; margin: 1.5rem 0; }
  .backtest h2 { margin-top: 0; border-bottom: none; }
  .backtest-stat { font-size: 1.4rem; font-weight: 700; color: #4338ca; margin: 4px 0; }
  .perf-stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .perf-stat { text-align: center; }
  .perf-stat b { display: block; font-size: 1.6rem; }
  table.recent { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 12px; }
  table.recent th, table.recent td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e5ef; }
  .outcome-win { color: #16a34a; font-weight: 700; }
  .outcome-loss { color: #dc2626; font-weight: 700; }
  .disclaimer { font-size: 0.82rem; color: #777; margin-top: 3rem; border-top: 1px solid #e5e5ef; padding-top: 12px; }
  footer { margin-top: 2rem; font-size: 0.85rem; color: #999; }
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
        <p style="font-size:0.85rem;color:#777;">{s["perf_note"]}</p>"""

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
    backtest_stats : ligne active de la table strategy_params (win_rate en
    fraction 0-1, trade_count entier), ou None si aucun backtest n'a encore
    tourné — dans ce cas la section est simplement omise (jamais de chiffre
    inventé).
    """
    if not backtest_stats:
        return ""

    win_rate_pct = float(backtest_stats["win_rate"]) * 100
    trades = int(backtest_stats["trade_count"])
    significant = trades >= MIN_SIGNIFICANT_TRADES
    stat_text = (
        s["backtest_stat"](win_rate_pct, trades)
        if significant
        else s["backtest_insignificant"](trades, MIN_SIGNIFICANT_TRADES)
    )

    # L'avertissement n'accompagne le chiffre que lorsqu'un chiffre est
    # réellement affiché (sinon il n'y a rien à nuancer).
    caveat_html = (
        f'<p class="backtest-caveat" style="font-size:0.9rem;color:#b45309;'
        f'background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 12px;'
        f'border-radius:6px;margin:10px 0;">{s["backtest_winrate_caveat"]}</p>'
        if significant
        else ""
    )

    return f"""
    <section class="backtest">
      <h2>{s["backtest_heading"]}</h2>
      <p class="backtest-stat">{stat_text}</p>
      {caveat_html}
      <p>{s["backtest_detail"]}</p>
      <p style="font-size:0.85rem;color:#777;">{s["backtest_note"]}</p>
    </section>"""


def build_daily_page(signals, performance_stats, page_date, canonical_path, lang="fr", alternate_path=None,
                      backtest_stats=None, resolved_signals=None, reviews=None):
    """
    Construit la page HTML complète pour une date donnée, dans la langue `lang` ("fr"/"en").
    `alternate_path` : chemin de la page équivalente dans l'autre langue (pour hreflang + lien de bascule).
    `resolved_signals` : voir supabase_client.get_all_resolved_signals() -- portefeuille fictif (Bloc 11.1).
    `reviews` : voir supabase_client.get_recent_reviews() -- Étape 3, avis réels /review.
    """
    s = _STRINGS[lang]
    date_str = page_date.strftime(s["date_format"])
    pairs_list = ", ".join(html.escape(sig["pair"]) for sig in signals)
    title = s["page_title"](date_str)
    description = s["meta_description"](len(signals), pairs_list, date_str)
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"

    cards_html = "".join(_signal_card_html(sig, s, lang) for sig in signals)
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

  <section>
    <h2>{s["signals_heading"](len(signals))}</h2>
    {cards_html}
  </section>

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
    <p>{s["footer"](footer_ts)} — <a href="/privacy.html">{s["privacy_link"]}</a> — <a href="/terms.html">{s["terms_link"]}</a> — <a href="/transparency.html">{s["transparency_link"]}</a> — <a href="/guides/">{s["guides_link"]}</a> — <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""
