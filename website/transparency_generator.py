"""
Page de transparence publique (Audit#20) : historique quotidien de
croissance et de performance réelle, construit à partir de `daily_stats`
(voir workers/main-worker/src/db/dailyStats.ts, un instantané par jour).

Volontairement absent de cette page : le chiffre d'affaires
(total_revenue_usdt). C'est une donnée business interne, pas un engagement
de transparence habituel pour ce type de service, et get_daily_stats_history()
ne la sélectionne même pas côté requête (voir supabase_client.py).
"""

import html
from datetime import datetime, timezone

from config import SITE_NAME, SITE_BASE_URL
from equity_curve import build_distribution_svg
# Meme feuille que le reste du site. Cette page avait sa propre CSS en
# theme CLAIR : un visiteur qui cliquait sur "Transparence" depuis l'accueil
# sombre atterrissait sur une page blanche, ce qui se lit comme une erreur
# de site avant de se lire comme une autre page.
from theme import STYLE as _STYLE
from html_generator import GOOGLE_SITE_VERIFICATION

MIN_DAYS_FOR_PAGE = 3
_CLOSE_REASON_LABEL = {"tp_hit": "Take profit ✅", "sl_hit": "Stop loss ❌", "expired": "Expiré ⌛"}


def _signal_row_html(signal):
    date_str = signal["evaluated_at"][:10] if signal.get("evaluated_at") else "?"
    outcome_label = _CLOSE_REASON_LABEL.get(signal.get("close_reason"), signal.get("outcome") or "?")
    return f"""
    <tr>
      <td>{html.escape(date_str)}</td>
      <td>{html.escape(signal["pair"])}</td>
      <td>{"ACHAT" if signal["type"] == "BUY" else "VENTE"}</td>
      <td>{outcome_label}</td>
    </tr>"""


def _all_signals_section_html(resolved_signals):
    """Bloc 13.3 : TOUS les signaux réels résolus, triés du plus récent au plus ancien, avec leur résultat."""
    if not resolved_signals:
        return ""
    ordered = list(reversed(resolved_signals))  # get_all_resolved_signals trie du plus ancien au plus récent
    rows_html = "".join(_signal_row_html(s) for s in ordered)
    distribution = build_distribution_svg(resolved_signals)
    distribution_html = (
        f'<h3>Distribution des résultats réels</h3>{distribution}' if distribution else ""
    )
    return f"""
    <section>
      <h2>Tous les signaux réels envoyés</h2>
      <p>{len(resolved_signals)} signal(aux) réel(s) résolu(s) au total (ce ne sont pas des exemples de
      backtest — voir <a href="/archives.html">les archives du backtest</a> pour ceux-là).</p>
      {distribution_html}
      <table>
        <thead><tr><th>Date</th><th>Paire</th><th>Type</th><th>Résultat</th></tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
    </section>"""


def _row_html(row):
    date_str = row["stat_date"]
    winrate = row.get("winrate_rolling_30d")
    winrate_str = f"{float(winrate) * 100:.1f}%" if winrate is not None else "n/a"
    return f"""
    <tr>
      <td>{html.escape(date_str)}</td>
      <td>{row["total_users"]}</td>
      <td>{row["active_trials"]}</td>
      <td>{row["paying_subscribers"]}</td>
      <td>{winrate_str}</td>
    </tr>"""


def build_transparency_page(history, canonical_path="/transparency.html", resolved_signals=None):
    """
    `history` : lignes daily_stats (voir supabase_client.get_daily_stats_history),
    du plus récent au plus ancien. Peut être vide ou très courte, notamment
    juste après le lancement — dans ce cas la page le dit honnêtement plutôt
    que d'afficher un historique tronqué qui prêterait à confusion.
    `resolved_signals` : voir supabase_client.get_all_resolved_signals() -- Bloc 13.3.
    """
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"
    title = f"Transparence — croissance et performance réelle — {SITE_NAME}"
    description = (
        "Historique quotidien, public et non retouché, du nombre d'utilisateurs, "
        "d'essais actifs, d'abonnés payants et du taux de réussite réel des signaux."
    )

    if len(history) >= MIN_DAYS_FOR_PAGE:
        latest = history[0]
        latest_winrate = latest.get("winrate_rolling_30d")
        latest_winrate_str = f"{float(latest_winrate) * 100:.1f}%" if latest_winrate is not None else "n/a (pas assez de signaux résolus sur 30 jours)"
        summary_html = f"""
        <div class="stats-grid">
          <div class="stat-box"><b>{latest["total_users"]}</b>Utilisateurs au total</div>
          <div class="stat-box"><b>{latest["active_trials"]}</b>Essais actifs</div>
          <div class="stat-box"><b>{latest["paying_subscribers"]}</b>Abonnés payants actifs</div>
          <div class="stat-box"><b>{latest_winrate_str}</b>Taux de réussite (30j glissant)</div>
        </div>
        <p class="asof">Instantané du {html.escape(latest["stat_date"])}, mis à jour une fois par jour.</p>
        <table>
          <thead><tr><th>Date</th><th>Utilisateurs</th><th>Essais actifs</th><th>Abonnés payants</th><th>Réussite (30j)</th></tr></thead>
          <tbody>{"".join(_row_html(r) for r in history)}</tbody>
        </table>"""
    else:
        summary_html = (
            "<p>Le service vient de démarrer : pas encore assez de jours d'historique pour "
            "publier une évolution significative (un instantané est archivé chaque jour). "
            "Reviens bientôt.</p>"
        )

    all_signals_html = _all_signals_section_html(resolved_signals or [])
    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y à %H:%M UTC")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  {GOOGLE_SITE_VERIFICATION}
  <meta charset="UTF-8">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>{_STYLE}</style>
</head>
<body>
  <header>
    <h1>Transparence</h1>
    <p class="subtitle">Historique public de croissance et de performance réelle — aucun chiffre retouché ni inventé.</p>
  </header>

  {summary_html}

  {all_signals_html}

  <p class="disclaimer">Le taux de réussite (30 jours glissants) porte sur les signaux réellement envoyés aux abonnés,
  déterminé automatiquement (prix courant comparé au stop loss / take profit) — voir la section performance de
  la <a href="/">page d'accueil</a> pour le détail. Performance passée, pas une garantie pour l'avenir.</p>

  <footer>Page générée automatiquement le {footer_ts}. <a href="/privacy.html">Politique de confidentialité</a> — <a href="/terms.html">Conditions générales</a> — <a href="/mentions-legales.html">Mentions légales</a></footer>
</body>
</html>"""
