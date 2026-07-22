"""
Génère un graphique PNG (prix + EMA9/21 + niveaux entrée/SL/TP) pour un
signal, à joindre aux notifications Telegram/Discord. Backend 'Agg' :
aucun affichage requis, adapté à une exécution en tâche de fond/serveur.
"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from config import CHART_LOOKBACK_POINTS


def generate_chart(df, signal: dict, output_path: str) -> str:
    """
    df : DataFrame enrichi par indicators.compute_all_indicators() (colonnes
    price, ema_fast, ema_slow au minimum).
    signal : dict avec pair, type, entry_price, stop_loss, take_profit.
    Retourne output_path (fichier PNG écrit sur disque).
    """
    recent = df.tail(CHART_LOOKBACK_POINTS).reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=110)
    ax.plot(recent.index, recent["price"], label="Prix", color="#374151", linewidth=1.3)
    if "ema_fast" in recent:
        ax.plot(recent.index, recent["ema_fast"], label="EMA 9", color="#2563eb", linewidth=1)
    if "ema_slow" in recent:
        ax.plot(recent.index, recent["ema_slow"], label="EMA 21", color="#f59e0b", linewidth=1)

    entry = float(signal["entry_price"])
    stop_loss = float(signal["stop_loss"])
    take_profit = float(signal["take_profit"])

    ax.axhline(entry, color="#6b7280", linestyle="--", linewidth=1, label="Entrée")
    ax.axhline(take_profit, color="#16a34a", linestyle="--", linewidth=1, label="Take profit")
    ax.axhline(stop_loss, color="#dc2626", linestyle="--", linewidth=1, label="Stop loss")

    side = "ACHAT" if signal["type"] == "BUY" else "VENTE"
    ax.set_title(f"{signal['pair']} — Signal {side}", fontsize=12, fontweight="bold")
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    ax.set_xticks([])
    ax.grid(alpha=0.25)
    fig.tight_layout()

    fig.savefig(output_path, format="png")
    plt.close(fig)
    return output_path
