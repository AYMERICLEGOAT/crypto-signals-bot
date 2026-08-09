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
    """
    Payload d'embed pour l'API REST Discord (POST /channels/{id}/messages).

    LE CAS CARRY, QUI FAISAIT PLANTER CE MODULE. Un signal de carry de
    financement a `type = "CARRY"`, et ses colonnes stop_loss et take_profit
    valent NULL : ses deux jambes s'annulent, la sortie est une DATE, pas un
    prix. format_price(None) levait donc une exception et le workflow Discord
    echouait — verifie sur les runs des 5, 6 et 7 aout 2026, exactement les
    trois jours ou le carry a produit.

    Deux erreurs plus discretes accompagnaient la premiere, et elles auraient
    survecu a un simple garde-fou sur None : `_side_label` et `_emoji` testent
    `type == "BUY"`, donc un carry etait annonce « VENTE » et colore en rouge.
    Presenter au public une position neutre au marche comme un pari baissier
    est faux, et c'est le genre d'erreur qui coute la credibilite d'un canal
    d'acquisition bien plus cher qu'une journee sans publication.
    """
    est_carry = signal.get("type") == "CARRY"

    if est_carry:
        titre = f"🔁 Carry de financement — {signal['pair']}"
        color = 0x2563EB  # bleu : ni haussier ni baissier, c'est tout l'interet
        champs = [
            {"name": "Entrée", "value": format_price(signal["entry_price"]), "inline": True},
            {"name": "Sortie", "value": "à date, pas à prix", "inline": True},
            {"name": "Direction", "value": "neutre au marché", "inline": True},
        ]
    else:
        titre = f"{_emoji(signal)} Signal {_side_label(signal)} — {signal['pair']}"
        color = 0x16A34A if signal["type"] == "BUY" else 0xDC2626
        champs = [
            {"name": "Entrée", "value": format_price(signal["entry_price"]), "inline": True},
            {"name": "Stop loss", "value": format_price(signal["stop_loss"]), "inline": True},
            {"name": "Take profit", "value": format_price(signal["take_profit"]), "inline": True},
        ]

    embed = {
        "title": titre,
        "color": color,
        "fields": champs,
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
