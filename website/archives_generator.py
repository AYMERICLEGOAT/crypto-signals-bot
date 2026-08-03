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
    # Audit du 01/08/2026 : ne jamais afficher un taux de réussite seul (voir
    # website/html_generator.py, même correctif). 61% de réussite avec un ratio
    # gain/perte de 0,67 n'est pas rentable, et l'espérance mesurée sur ces
    # mêmes 24 mois est négative -- présenter le taux nu comme argument de
    # vente serait trompeur.
    return (
        f'<p class="archive-stats">{win_rate_pct:.1f}% des trades atteignent leur premier objectif '
        f"({trade_count} trades simulés, backtest {_BACKTEST_WINDOW_MONTHS} mois, in-sample). "
        f"⚠️ Un taux de réussite élevé ne signifie pas rentable : sur cette période, gains et pertes "
        f"se compensent quasiment. Aucune performance n'est promise.</p>"
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


def _relative_strength_stats_html():
    """
    Les chiffres du moteur réellement en service (voir signals/relative_strength.py
    et DECOUVERTE_FORCE_RELATIVE_2026-08-03.md), mesurés sur 6 ans nets de frais.

    La médiane figure à côté de la moyenne, et pas en petit. C'est le fait le
    plus important et le plus facile à taire : le signal médian perd 0,69 %,
    tandis que les 5 % de meilleurs signaux apportent la totalité du gain. Un
    visiteur qui ne lit que « +3,22 % en moyenne » se fait une idée fausse de ce
    qu'il va vivre.
    """
    return """
  <div class="engine-stats">
    <h2>Ce que mesurent 6 ans de données</h2>
    <ul>
      <li><strong>47,7 %</strong> de signaux gagnants — donc une majorité de perdants</li>
      <li>Gagnant moyen <strong>+16,88 %</strong>, perdant moyen <strong>-9,24 %</strong>, net de 0,10 % de frais</li>
      <li>Moyenne <strong>+3,22 %</strong> par signal — mais <strong>médiane -0,69 %</strong></li>
      <li><strong>8,0 signaux par semaine</strong> quand le marché est porteur, <strong>aucun</strong> sinon</li>
    </ul>
    <p class="engine-warn">La moyenne et la médiane disent des choses différentes, et les deux sont
      vraies&nbsp;: les 5&nbsp;% de meilleurs signaux apportent la totalité du gain. Sans eux,
      l'espérance tombe à -0,42 %. Autrement dit, il faut prendre <strong>tous</strong> les signaux&nbsp;;
      en trier quelques-uns revient statistiquement à ne garder que la partie perdante.</p>
    <p class="engine-note">Chiffres mesurés sur données historiques, arrêtés au 3 août 2026. Le moteur
      actuel a été mis en service ce jour-là&nbsp;: il n'a pas encore d'historique en direct.</p>
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
        "Signaux crypto générés automatiquement : 40 paires classées chaque jour par force "
        "relative, les 12 plus fortes conservées 7 jours. Aucun signal quand le marché est "
        "baissier. Essai gratuit, sans engagement."
    )

    # Le taux de réussite de `strategy_params` provient du backtest de l'ANCIEN
    # moteur (achat sur RSI bas), désactivé le 03/08/2026 après avoir été mesuré
    # comme la jambe perdante. L'afficher ici décrirait une stratégie qui n'est
    # plus diffusée — c'est exactement le mécanisme qui a laissé un « 61,2 % de
    # réussite » sur ce site pendant des mois. Il est donc remplacé par les
    # chiffres du moteur réellement en service, et par celui qui compte le plus
    # pour un visiteur : ce que vaut le signal MÉDIAN, pas la moyenne.
    stats_html = _relative_strength_stats_html()

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
    /* Encadré rouge réservé à ce qui coûte de l'argent si on ne le lit pas :
       ici, le fait que l'abonnement court pendant les périodes sans signal. */
    .filter-closed {{ border: 2px solid #dc2626; border-radius: 12px; padding: 18px 20px; margin: 2rem 0; }}
    .filter-closed h2 {{ margin-top: 0; font-size: 1.15rem; color: #dc2626; }}
    .engine-stats {{ background: #f8f9fc; border-radius: 12px; padding: 18px 20px; margin: 2rem 0; }}
    .engine-stats h2 {{ margin-top: 0; font-size: 1.15rem; }}
    .engine-stats li {{ margin-bottom: 6px; }}
    .engine-warn {{ border-left: 3px solid #dc2626; padding-left: 12px; margin-top: 14px; }}
    .engine-note {{ font-size: 0.85rem; color: #666; margin-bottom: 0; }}
    .disclaimer {{ font-size: 0.82rem; color: #777; margin-top: 3rem; border-top: 1px solid #e5e5ef; padding-top: 12px; }}
    footer {{ margin-top: 2rem; font-size: 0.85rem; color: #999; }}
    a {{ color: #4338ca; }}
  </style>
</head>
<body>
  <span class="status">🟢 Bot en ligne</span>
  <h1>Signaux Crypto Gratuits</h1>
  <p class="subtitle">Les 40 paires suivies sont classées chaque jour par force relative&nbsp;; les 12 plus fortes
  sont achetées et conservées 7 jours. Diffusion sur Telegram.</p>

  <div class="filter-closed">
    <h2>Aucun signal en ce moment — et c'est voulu</h2>
    <p>Le moteur ne publie rien tant que le Bitcoin est sous sa moyenne mobile 200 jours. Ce n'est pas
    une panne, c'est la règle centrale de la stratégie.</p>
    <p><strong>Ce silence est fréquent et il peut être long.</strong> Sur les 6 dernières années, ce filtre
    a été fermé <strong>41 % du temps</strong>. Il y a eu 11 fermetures d'au moins une semaine, d'une durée
    médiane de 25 jours — et la plus longue a duré <strong>381 jours</strong>, soit 12,7 mois, du 28 décembre
    2021 au 13 janvier 2023.</p>
    <p>Pourquoi l'assumer&nbsp;: sans ce filtre, la stratégie n'est positive que 4 années sur 7. Avec lui,
    elle n'a aucune année perdante sur la période — en 2022 et en 2026 elle n'a simplement rien émis,
    pendant que détenir les mêmes cryptos coûtait -70,9 % et -39,4 %.</p>
    <p class="engine-note">À lire avant de vous abonner&nbsp;: l'abonnement court au calendrier. Il est
    parfaitement possible de payer 30 jours et de ne recevoir aucun signal. Les
    <a href="/terms.html">conditions générales</a> le disent noir sur blanc.</p>
  </div>

  {stats_html}

  <p>Le classement est recalculé une fois par jour, après la clôture journalière. Tape <code>/marche</code>
  sur le bot pour connaître l'état du filtre en direct, <code>/demo</code> pour voir la forme exacte d'un
  signal, ou consulte <a href="/how-it-works.html">le fonctionnement détaillé</a>.</p>

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
