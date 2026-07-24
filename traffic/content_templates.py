"""
Génération du contenu par plateforme, à partir de templates simples.
Même principe que le module website/ : les templates décrivent la logique
réelle de la stratégie (croisement EMA9/EMA21 confirmé par le RSI) qui a
produit CHAQUE signal BUY/SELL du module signals/ — pas de valeur
d'indicateur inventée, pas de promesse de gain, pas de fausse preuve sociale.
"""

import random

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


# --- Twitter ---

_TWEET_HOOKS = [
    "Nouveau signal détecté sur {pair}",
    "{pair} vient de valider un croisement EMA9/21",
    "Signal {side} repéré sur {pair}",
]


def format_tweet(signal):
    """
    Reste sous 280 caractères. Aucune promesse de gain, juste les niveaux.
    Pas de lien direct ici : Twitter/X pénalise la portée des tweets qui
    sortent l'utilisateur de la plateforme. Le lien part en réponse
    (voir format_tweet_reply), technique standard et non trompeuse — le
    contenu du tweet reste honnête, seul l'emplacement du lien change.
    """
    hook = random.choice(_TWEET_HOOKS).format(pair=signal["pair"], side=_side_label(signal))
    text = (
        f"{_emoji(signal)} {hook}\n"
        f"{_side_label(signal)} | Entrée {format_price(signal['entry_price'])} | "
        f"SL {format_price(signal['stop_loss'])} | TP {format_price(signal['take_profit'])}\n\n"
        f"#Crypto #Trading"
    )
    if len(text) > 280:
        # Repli compact si la paire/les prix rendent le texte trop long.
        text = f"{_emoji(signal)} Signal {_side_label(signal)} {signal['pair']} — entrée {format_price(signal['entry_price'])}"
    return text


def format_tweet_reply(signal):
    """Réponse au tweet principal, contenant le seul lien (canal Telegram gratuit)."""
    return f"👇 Signaux gratuits (15 min de délai) : {TELEGRAM_CHANNEL_URL}"


# --- Reddit ---

_REDDIT_TITLES = [
    "Analyse technique : croisement EMA9/21 détecté sur {pair}",
    "{pair} — signal {side} basé sur EMA9/21 + RSI",
    "Étude de cas : configuration technique {side} sur {pair}",
]

_REDDIT_BODY_TEMPLATE = """**Configuration technique observée sur {pair}**

- Type de signal : **{side}**
- Prix d'entrée (approximatif) : {entry}
- Stop loss : {sl}
- Take profit : {tp}

**Logique** : ce signal a été généré par un croisement de l'EMA à 9 périodes
{croisement} l'EMA à 21 périodes, combiné à un RSI {rsi_zone}. C'est une
configuration technique classique de retournement à court terme sur les
marchés crypto, à confirmer avec ta propre analyse (volume, structure de
marché, contexte macro).

*Transparence : je fais partie de l'équipe qui gère le canal Telegram
gratuit diffusant ces signaux avec 15 minutes de délai ({telegram_url}). Je
le précise pour être clair sur mon affiliation, conformément aux règles de
ce subreddit sur l'auto-promotion.*

{disclaimer}
"""


def format_reddit_post(signal):
    """Retourne (titre, corps). Ton 'analyse', avec disclosure de l'affiliation (attendue par la plupart des subreddits)."""
    side = _side_label(signal)
    title = random.choice(_REDDIT_TITLES).format(pair=signal["pair"], side=side)

    is_buy = signal["type"] == "BUY"
    body = _REDDIT_BODY_TEMPLATE.format(
        pair=signal["pair"],
        side=side,
        entry=format_price(signal["entry_price"]),
        sl=format_price(signal["stop_loss"]),
        tp=format_price(signal["take_profit"]),
        croisement="au-dessus de" if is_buy else "en dessous de",
        rsi_zone="sortant de la zone de survente" if is_buy else "sortant de la zone de surachat",
        telegram_url=TELEGRAM_CHANNEL_URL,
        disclaimer=DISCLAIMER_SHORT,
    )
    return title, body


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
