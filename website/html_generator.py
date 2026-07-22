"""
Génère la page HTML complète (titre, meta description, contenu structuré,
section performance, appel à l'action) à partir des signaux du jour et des
statistiques de performance réelles. Disponible en français et en anglais
(paramètre `lang`), avec balises hreflang reliant les deux versions.
"""

import html
from datetime import datetime

from config import SITE_NAME, SITE_BASE_URL, TELEGRAM_BOT_USERNAME
from content_templates import generate_analysis, format_price

TELEGRAM_URL = f"https://t.me/{TELEGRAM_BOT_USERNAME}"

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
        "cta_text": "📡 Reçois ces signaux en temps réel, dès qu'ils sont détectés :",
        "cta_link": lambda username: f"Rejoindre @{username} sur Telegram",
        "disclaimer": "⚠️ Ce contenu est fourni à titre informatif et pédagogique, il ne constitue pas "
        "un conseil en investissement. Le trading de cryptoactifs comporte un risque de perte en "
        "capital. Les performances passées ne préjugent pas des performances futures.",
        "footer": lambda ts: f"Page générée automatiquement le {ts}.",
        "lang_switch": "English version",
        "date_format": "%d/%m/%Y",
        "footer_date_format": "%d/%m/%Y à %H:%M",
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
        "cta_text": "📡 Get these signals in real time, the moment they're detected:",
        "cta_link": lambda username: f"Join @{username} on Telegram",
        "disclaimer": "⚠️ This content is provided for informational and educational purposes only, "
        "it does not constitute investment advice. Trading cryptoassets carries a risk of capital "
        "loss. Past performance does not guarantee future results.",
        "footer": lambda ts: f"Page automatically generated on {ts}.",
        "lang_switch": "Version française",
        "date_format": "%m/%d/%Y",
        "footer_date_format": "%m/%d/%Y at %H:%M",
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
        body = f"""
        <div class="perf-stats">
          <div class="perf-stat"><b>{stats["total"]}</b>{s["perf_closed"]}</div>
          <div class="perf-stat"><b>{win_rate}%</b>{s["perf_winrate"]}</div>
          <div class="perf-stat"><b>{stats["wins"]}</b>{s["perf_wins"]}</div>
          <div class="perf-stat"><b>{stats["losses"]}</b>{s["perf_losses"]}</div>
        </div>
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


def build_daily_page(signals, performance_stats, page_date, canonical_path, lang="fr", alternate_path=None):
    """
    Construit la page HTML complète pour une date donnée, dans la langue `lang` ("fr"/"en").
    `alternate_path` : chemin de la page équivalente dans l'autre langue (pour hreflang + lien de bascule).
    """
    s = _STRINGS[lang]
    date_str = page_date.strftime(s["date_format"])
    pairs_list = ", ".join(html.escape(sig["pair"]) for sig in signals)
    title = s["page_title"](date_str)
    description = s["meta_description"](len(signals), pairs_list, date_str)
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"

    cards_html = "".join(_signal_card_html(sig, s, lang) for sig in signals)
    performance_html = _performance_section_html(performance_stats, s)

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

  <section>
    <h2>{s["signals_heading"](len(signals))}</h2>
    {cards_html}
  </section>

  {performance_html}

  <div class="cta">
    <p>{s["cta_text"]}</p>
    <a href="{TELEGRAM_URL}">{s["cta_link"](TELEGRAM_BOT_USERNAME)}</a>
  </div>

  <p class="disclaimer">{s["disclaimer"]}</p>

  <footer>
    <p>{s["footer"](footer_ts)}</p>
  </footer>
</body>
</html>"""
