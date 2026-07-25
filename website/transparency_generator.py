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

MIN_DAYS_FOR_PAGE = 3


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


def build_transparency_page(history, canonical_path="/transparency.html"):
    """
    `history` : lignes daily_stats (voir supabase_client.get_daily_stats_history),
    du plus récent au plus ancien. Peut être vide ou très courte, notamment
    juste après le lancement — dans ce cas la page le dit honnêtement plutôt
    que d'afficher un historique tronqué qui prêterait à confusion.
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

    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y à %H:%M UTC")

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
    .stats-grid {{ display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0 8px; }}
    .stat-box {{ flex: 1 1 140px; border: 1px solid #e5e5ef; border-radius: 10px; padding: 12px 14px; }}
    .stat-box b {{ display: block; font-size: 1.3rem; color: #4338ca; }}
    .asof {{ font-size: 0.85rem; color: #777; margin-top: 0; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.9rem; }}
    th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e5ef; }}
    th {{ color: #4338ca; }}
    .disclaimer {{ font-size: 0.82rem; color: #777; margin-top: 2rem; border-top: 1px solid #e5e5ef; padding-top: 12px; }}
    footer {{ margin-top: 2rem; font-size: 0.85rem; color: #999; }}
    a {{ color: #4338ca; }}
  </style>
</head>
<body>
  <header>
    <h1>Transparence</h1>
    <p class="subtitle">Historique public de croissance et de performance réelle — aucun chiffre retouché ni inventé.</p>
  </header>

  {summary_html}

  <p class="disclaimer">Le taux de réussite (30 jours glissants) porte sur les signaux réellement envoyés aux abonnés,
  déterminé automatiquement (prix courant comparé au stop loss / take profit) — voir la section performance de
  la <a href="/">page d'accueil</a> pour le détail. Performance passée, pas une garantie pour l'avenir.</p>

  <footer>Page générée automatiquement le {footer_ts}. <a href="/privacy.html">Politique de confidentialité</a> — <a href="/terms.html">Conditions générales</a></footer>
</body>
</html>"""
