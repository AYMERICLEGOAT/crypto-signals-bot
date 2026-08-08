"""
Génération du contenu par plateforme, à partir de templates simples.
Même principe que le module website/ : les templates décrivent la logique
réelle de la stratégie (croisement EMA9/EMA21 confirmé par le RSI) qui a
produit CHAQUE signal BUY/SELL du module signals/ — pas de valeur
d'indicateur inventée, pas de promesse de gain, pas de fausse preuve sociale.
"""

from config import TELEGRAM_CHANNEL_URL, TELEGRAM_BOT_USERNAME

DISCLAIMER_SHORT = "Contenu éducatif, pas un conseil en investissement. NFA/DYOR."


def format_price(value):
    value = float(value)
    if value >= 1:
        return f"{value:,.2f}".replace(",", " ")
    return f"{value:.6f}"


def _side_label(signal):
    return "ACHAT" if signal["type"] == "BUY" else "VENTE"


def _emoji(signal):
    return "🟢" if signal["type"] == "BUY" else "🔴"


# --- Discord ---

def format_discord_embed(signal):
    """Payload d'embed pour l'API REST Discord (POST /channels/{id}/messages)."""
    side = _side_label(signal)
    color = 0x16A34A if signal["type"] == "BUY" else 0xDC2626

    embed = {
        "title": f"{_emoji(signal)} Signal {side} — {signal['pair']}",
        "color": color,
        "fields": [
            {"name": "Entrée", "value": format_price(signal["entry_price"]), "inline": True},
            {"name": "Stop loss", "value": format_price(signal["stop_loss"]), "inline": True},
            {"name": "Take profit", "value": format_price(signal["take_profit"]), "inline": True},
        ],
        "footer": {"text": DISCLAIMER_SHORT},
    }

    # Graphique généré par le module signals/ et hébergé sur Supabase Storage
    # (colonne chart_url) — Discord affiche une image à partir d'une simple URL,
    # pas besoin de télécharger/réuploader le fichier ici.
    chart_url = signal.get("chart_url")
    if chart_url:
        embed["image"] = {"url": chart_url}

    return {
        "content": f"📡 Nouveau signal du jour — rejoins {TELEGRAM_CHANNEL_URL} pour les recevoir en temps réel.",
        "embeds": [embed],
    }
