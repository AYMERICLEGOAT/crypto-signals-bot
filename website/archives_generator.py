"""
Page "Archives du backtest" : exemples de trades issus de la simulation
(signals/backtest.py), avec leurs VRAIES dates historiques (bougies Binance
réelles). Ce ne sont PAS des signaux réellement envoyés à des abonnés — la
page le dit explicitement, à plusieurs endroits, pour ne jamais laisser
croire à un historique de signaux réels.
"""

import html
from datetime import datetime, timezone

from config import SITE_NAME, SITE_BASE_URL, TELEGRAM_CHANNEL_URL
from testimonials import EXAMPLE_TESTIMONIALS

BACKTEST_WINDOW_DAYS = 730  # doit rester synchronisé avec signals/config.py (BACKTEST_DAYS)
_BACKTEST_WINDOW_MONTHS = round(BACKTEST_WINDOW_DAYS / 30)

# Audit#4 : doit rester synchronisé avec signals/backtest.py (MIN_SIGNIFICANT_TRADES).
# En dessous de ce seuil, un taux de réussite (même 0% ou 100%) n'est pas fiable
# statistiquement — l'afficher tel quel serait trompeur (positif comme négatif).
MIN_SIGNIFICANT_TRADES = 15


def _backtest_stat_html(win_rate_pct, trade_count):
    if trade_count < MIN_SIGNIFICANT_TRADES:
        return (
            f'<p class="archive-stats">Échantillon encore trop petit pour être significatif '
            f'({trade_count} trades sur {_BACKTEST_WINDOW_MONTHS} mois) — taux de réussite non affiché '
            f"tant que le seuil de {MIN_SIGNIFICANT_TRADES} trades n'est pas atteint.</p>"
        )
    return (
        f'<p class="archive-stats">{win_rate_pct:.1f}% de réussite sur {trade_count} trades '
        f"(backtest {_BACKTEST_WINDOW_MONTHS} mois, in-sample).</p>"
    )

_OUTCOME_LABEL = {"WIN": "Take profit atteint ✅", "LOSS": "Stop loss touché ❌", "TIMEOUT": "Clôturé (délai)"}
_OUTCOME_COLOR = {"WIN": "#16a34a", "LOSS": "#dc2626", "TIMEOUT": "#6b7280"}


def _format_price(value):
    value = float(value)
    return f"{value:,.2f}".replace(",", " ") if value >= 1 else f"{value:.6f}"


def _trade_svg(trade):
    """Sparkline très simple entrée -> sortie. Illustratif, pas un vrai graphique intrabar."""
    entry = float(trade["entry_price"])
    exit_price = float(trade["exit_price"])
    color = _OUTCOME_COLOR.get(trade["outcome"], "#6b7280")

    lo, hi = sorted([entry, exit_price])
    span = (hi - lo) or (entry * 0.001) or 1
    def y(p):
        return 35 - ((p - lo) / span) * 25

    y_entry, y_exit = y(entry), y(exit_price)
    return (
        f'<svg viewBox="0 0 100 40" width="100" height="40" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="Illustration schématique entrée vers sortie">'
        f'<line x1="10" y1="{y_entry:.1f}" x2="90" y2="{y_exit:.1f}" stroke="{color}" stroke-width="3" stroke-linecap="round"/>'
        f'<circle cx="10" cy="{y_entry:.1f}" r="3.5" fill="#6366f1"/>'
        f'<circle cx="90" cy="{y_exit:.1f}" r="3.5" fill="{color}"/>'
        f'</svg>'
    )


def _trade_row_html(trade):
    pair = html.escape(trade["pair"])
    side_label = "ACHAT" if trade["side"] == "BUY" else "VENTE"
    outcome_label = _OUTCOME_LABEL.get(trade["outcome"], trade["outcome"])
    outcome_color = _OUTCOME_COLOR.get(trade["outcome"], "#6b7280")
    entered = datetime.fromisoformat(trade["entered_at"].replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M UTC")
    pnl_pct = float(trade["pnl_pct"]) * 100

    return f"""
    <div class="archive-row">
      <div class="archive-svg">{_trade_svg(trade)}</div>
      <div class="archive-info">
        <div class="archive-header">
          <span class="archive-pair">{pair}</span>
          <span class="archive-side">{side_label}</span>
          <span class="archive-outcome" style="color:{outcome_color};">{outcome_label}</span>
        </div>
        <div class="archive-detail">
          Entrée {_format_price(trade["entry_price"])} → Sortie {_format_price(trade["exit_price"])}
          ({pnl_pct:+.1f}%) — {entered}
        </div>
      </div>
    </div>"""


def build_waiting_homepage(backtest_stats, telegram_bot_username):
    """
    Page d'accueil utilisée tant qu'aucun signal réel n'a encore été généré.
    Remplace l'ancienne page d'attente statique : celle-ci est régénérée à
    chaque exécution de main.py avec les vraies stats du backtest (jamais
    de contenu inventé), et pointe vers /archives.html et /demo sur le bot.
    """
    canonical_url = f"{SITE_BASE_URL}/"
    title = f"{SITE_NAME} — Analyses techniques automatisées sur Telegram"
    description = (
        "Signaux crypto générés automatiquement (croisement EMA9/21 + RSI) sur 40 paires, "
        "diffusés sur Telegram. Essai gratuit, sans engagement."
    )

    if backtest_stats:
        win_rate_pct = float(backtest_stats["win_rate"]) * 100
        trade_count = int(backtest_stats["trade_count"])
        stats_html = _backtest_stat_html(win_rate_pct, trade_count)
    else:
        stats_html = ""

    # Précision au jour (pas à la minute) : voir Audit#11, github_publisher.py
    # compare le contenu généré à l'octet près pour éviter un commit à chaque
    # exécution horaire sans rien de nouveau -- un timestamp à la minute ici
    # rendrait cette comparaison inutile (le contenu différerait toujours).
    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
  <style>
    :root {{ color-scheme: light dark; }}
    body {{ font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 780px;
           margin: 0 auto; padding: 2.5rem 1.25rem; line-height: 1.55; color: #1a1a2e; }}
    h1 {{ font-size: 1.9rem; margin-bottom: 0.25rem; }}
    .subtitle {{ color: #666; margin-top: 0; }}
    .cta {{ background: linear-gradient(135deg, #6366f1, #4338ca); color: white; padding: 24px;
           border-radius: 12px; text-align: center; margin: 2rem 0; }}
    .cta a {{ color: white; font-weight: 700; font-size: 1.1rem; text-decoration: underline; }}
    .archive-stats {{ font-size: 1.2rem; font-weight: 700; color: #4338ca; }}
    .pairs {{ color: #555; font-size: 0.92rem; }}
    .status {{ display: inline-block; background: #eef2ff; color: #4338ca; font-size: 0.8rem;
              font-weight: 600; padding: 3px 12px; border-radius: 999px; margin-bottom: 1rem; }}
    .disclaimer {{ font-size: 0.82rem; color: #777; margin-top: 3rem; border-top: 1px solid #e5e5ef; padding-top: 12px; }}
    footer {{ margin-top: 2rem; font-size: 0.85rem; color: #999; }}
    a {{ color: #4338ca; }}
  </style>
</head>
<body>
  <span class="status">🟢 Bot en ligne</span>
  <h1>Signaux Crypto Gratuits</h1>
  <p class="subtitle">Analyses techniques automatisées (EMA, RSI, Bandes de Bollinger) sur 40 paires, diffusées sur Telegram.</p>

  {stats_html}

  <p>Le bot de génération de signaux tourne en continu et surveille le marché 24h/24. Consulte les
  <a href="/archives.html">archives du backtest</a> pour voir des exemples de trades avec leurs vraies dates
  historiques, ou tape <code>/demo</code> sur le bot pour voir le format d'un signal.</p>

  <div class="cta">
    <p>Essayez gratuitement sur Telegram</p>
    <a href="https://t.me/{telegram_bot_username}">@{telegram_bot_username}</a>
    <p><a href="{TELEGRAM_CHANNEL_URL}">📖 Journal de trading public — chaque signal ouvert et clôturé, sans filtre</a></p>
  </div>

  <p class="pairs"><strong>Paires suivies :</strong> BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, DOT, LINK, POL, LTC, SHIB, UNI, ATOM, NEAR, APT, ARB, OP, SUI, FET, PEPE, RENDER, INJ, TIA, TAO, STX, FIL (toutes en /USDT).</p>

  <section class="testimonials">
    <h2>💬 Ce qu'ils en pensent</h2>
    {"".join(f'<blockquote><p>« {html.escape(t["quote"])} »</p><cite>— {html.escape(t["name"])}</cite></blockquote>' for t in EXAMPLE_TESTIMONIALS)}
    <p style="font-size:0.82rem;color:#777;">⚠️ Exemples fictifs illustrant le format des retours utilisateurs — pas de vrais témoignages.</p>
  </section>

  <p class="disclaimer">Ceci n'est pas un conseil financier. Le trading de cryptomonnaies comporte des risques de perte en capital. Les performances passées ne préjugent pas des résultats futurs.</p>

  <footer>Signaux Crypto Gratuits — mise à jour automatique dès la publication des premiers signaux réels. — <a href="/privacy.html">Politique de confidentialité</a> — <a href="/terms.html">Conditions générales</a> — <a href="/transparency.html">Transparence</a> — <a href="/mentions-legales.html">Mentions légales</a></footer>
</body>
</html>"""


def build_archives_page(trades, backtest_stats, canonical_path="/archives.html"):
    """
    `trades` : liste de lignes backtest_trades (peut être vide).
    `backtest_stats` : ligne active de strategy_params, ou None.
    """
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"
    title = f"Archives du backtest — exemples de trades — {SITE_NAME}"
    description = (
        "Exemples de trades issus du backtest de la stratégie (données historiques réelles Binance), "
        "avec leurs résultats détaillés. Ce ne sont pas des signaux envoyés à des abonnés."
    )

    if backtest_stats:
        win_rate_pct = float(backtest_stats["win_rate"]) * 100
        trade_count = int(backtest_stats["trade_count"])
        avg_days = BACKTEST_WINDOW_DAYS / trade_count if trade_count else None
        if avg_days is None:
            next_signal_line = ""
        elif avg_days < 1:
            next_signal_line = f"<p class=\"next-signal\">📡 Fréquence historique : environ un signal toutes les {avg_days * 24:.0f} heures (moyenne sur le backtest).</p>"
        else:
            next_signal_line = f"<p class=\"next-signal\">📡 Fréquence historique : environ un signal tous les {avg_days:.1f} jours (moyenne sur le backtest, pas une garantie de timing).</p>"
        stats_line = _backtest_stat_html(win_rate_pct, trade_count)
    else:
        stats_line = ""
        next_signal_line = ""

    if trades:
        rows_html = "".join(_trade_row_html(t) for t in trades)
    else:
        rows_html = "<p>Aucun exemple de trade enregistré pour le moment — reviens après le prochain backtest.</p>"

    # Précision au jour (pas à la minute) : voir Audit#11, github_publisher.py
    # compare le contenu généré à l'octet près pour éviter un commit à chaque
    # exécution horaire sans rien de nouveau -- un timestamp à la minute ici
    # rendrait cette comparaison inutile (le contenu différerait toujours).
    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {{ color-scheme: light dark; }}
    body {{ font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 780px;
           margin: 0 auto; padding: 24px 16px 64px; line-height: 1.55; color: #1a1a2e; }}
    h1 {{ font-size: 1.6rem; margin-bottom: 4px; }}
    .subtitle {{ color: #666; }}
    .honesty-banner {{ background: #fff7ed; border: 1px solid #fdba74; border-radius: 10px;
                       padding: 12px 16px; font-size: 0.9rem; margin: 16px 0; }}
    .archive-stats {{ font-size: 1.1rem; font-weight: 700; color: #4338ca; }}
    .next-signal {{ font-size: 0.92rem; color: #555; }}
    .archive-row {{ display: flex; gap: 14px; align-items: center; border: 1px solid #e5e5ef;
                    border-radius: 10px; padding: 12px 14px; margin: 10px 0; }}
    .archive-svg {{ flex-shrink: 0; }}
    .archive-header {{ display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }}
    .archive-pair {{ font-weight: 700; }}
    .archive-side {{ font-size: 0.85rem; color: #666; }}
    .archive-outcome {{ font-size: 0.9rem; font-weight: 600; }}
    .archive-detail {{ font-size: 0.85rem; color: #666; margin-top: 2px; }}
    .disclaimer {{ font-size: 0.82rem; color: #777; margin-top: 3rem; border-top: 1px solid #e5e5ef; padding-top: 12px; }}
    footer {{ margin-top: 2rem; font-size: 0.85rem; color: #999; }}
    a {{ color: #4338ca; }}
  </style>
</head>
<body>
  <header>
    <h1>Archives du backtest</h1>
    <p class="subtitle">Exemples de trades issus de la simulation de la stratégie</p>
  </header>

  <div class="honesty-banner">
    ⚠️ <strong>Important</strong> : les trades ci-dessous proviennent d'un <strong>backtest</strong>
    (simulation sur des données historiques réelles Binance) — ce ne sont <strong>pas</strong> des
    signaux réellement envoyés à des abonnés. Les dates sont les vraies dates des bougies utilisées
    dans la simulation. Tape <code>/demo</code> sur le bot Telegram pour voir le format d'un
    signal, ou <code>/trial</code> pour recevoir de vrais signaux en direct.
  </div>

  {stats_line}
  {next_signal_line}

  <section>
    {rows_html}
  </section>

  <p class="disclaimer">Performance passée (et a fortiori issue d'un backtest optimisé in-sample) ne garantit pas les performances futures. Contenu éducatif, pas un conseil en investissement.</p>

  <footer>
    <p>Page générée automatiquement le {footer_ts}. <a href="/privacy.html">Politique de confidentialité</a> — <a href="/terms.html">Conditions générales</a> — <a href="/transparency.html">Transparence</a> — <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""
