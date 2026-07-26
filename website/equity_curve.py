"""
Bloc 11.1 : "portefeuille fictif" (paper trading) public -- courbe de
gain/perte cumulée si l'on avait suivi CHAQUE signal généré (pas seulement
ceux envoyés à des abonnés), en pourcentage.

Pas de nouvelle table `paper_trades` : la table `signals` (voir
workers/main-worker/src/cron/trackSignalOutcomes.ts, qui clôture déjà
CHAQUE signal généré, envoyé ou non, toutes les 5 minutes) contient déjà
l'intégralité des données nécessaires. Dupliquer cette logique dans une
table séparée aurait recréé exactement le problème corrigé à l'Audit#5
(deux systèmes qui suivent la même chose sans se coordonner).

Simplification assumée et affichée : chaque trade engage une part FIXE
(POSITION_SIZE_PCT) du capital fictif de départ, de façon non composée
(somme simple, pas de réinvestissement des gains) -- un choix volontairement
prudent et lisible plutôt qu'un calcul de sizing réaliste avec positions
concurrentes, qui donnerait une fausse impression de précision.
"""

import html

POSITION_SIZE_PCT = 0.10  # 10% du capital fictif par trade


def _pnl_pct(signal: dict) -> float:
    entry = float(signal["entry_price"])
    exit_price = float(signal["outcome_price"])
    if signal["type"] == "BUY":
        return (exit_price - entry) / entry
    return (entry - exit_price) / entry


def compute_equity_curve(signals: list) -> list:
    """Retourne la liste des valeurs cumulées du portefeuille fictif (départ à 100), une par trade résolu."""
    cumulative = 100.0
    curve = [cumulative]
    for signal in signals:
        if signal.get("outcome_price") is None:
            continue
        cumulative += _pnl_pct(signal) * POSITION_SIZE_PCT * 100
        curve.append(cumulative)
    return curve


def _curve_svg(curve: list, width: int = 640, height: int = 200) -> str:
    if len(curve) < 2:
        return ""
    lo, hi = min(curve), max(curve)
    span = (hi - lo) or 1
    pad = 10

    def x(i):
        return pad + (i / (len(curve) - 1)) * (width - 2 * pad)

    def y(v):
        return height - pad - ((v - lo) / span) * (height - 2 * pad)

    points = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(curve))
    final = curve[-1]
    color = "#16a34a" if final >= 100 else "#dc2626"
    baseline_y = y(100) if lo <= 100 <= hi else None
    baseline = (
        f'<line x1="{pad}" y1="{baseline_y:.1f}" x2="{width - pad}" y2="{baseline_y:.1f}" '
        f'stroke="#d1d5db" stroke-width="1" stroke-dasharray="4,4"/>'
        if baseline_y is not None else ""
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-label="Courbe du portefeuille fictif, de 100 à {final:.1f}">'
        f'{baseline}'
        f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="2.5" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'</svg>'
    )


def build_live_performance_section(signals: list, strings: dict) -> str:
    """
    `signals` : résultat de supabase_client.get_all_resolved_signals()
    (trié du plus ancien au plus récent). `strings` : sous-dict de langue
    (voir html_generator._STRINGS) avec les clés paper_* (voir ci-dessous).
    Retourne "" si moins de 2 trades résolus (rien d'exploitable à montrer).
    """
    if len(signals) < 2:
        return ""

    curve = compute_equity_curve(signals)
    final = curve[-1]
    change_pct = final - 100
    sign = "+" if change_pct >= 0 else ""
    color = "#16a34a" if change_pct >= 0 else "#dc2626"

    return f"""
    <section class="paper-trading">
      <h2>{strings["paper_heading"]}</h2>
      <p>{strings["paper_detail"](len(signals) - 1, POSITION_SIZE_PCT * 100)}</p>
      {_curve_svg(curve)}
      <p class="paper-result" style="color:{color};font-weight:700;">{sign}{change_pct:.1f}%</p>
      <p style="font-size:0.82rem;color:#777;">{strings["paper_note"]}</p>
    </section>"""
