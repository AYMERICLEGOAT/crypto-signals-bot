"""
Génération de paragraphes d'analyse (FR + EN), à partir de templates
simples. Les templates décrivent fidèlement la logique réelle de la
stratégie du module signals/ (croisement EMA9/EMA21 confirmé par le RSI) —
c'est une description vraie de la manière dont CHAQUE signal BUY/SELL de ce
système est généré, pas une donnée inventée. Seuls les prix (entrée, stop
loss, take profit) affichés sont les valeurs réelles stockées en base ;
aucune valeur d'indicateur (RSI, EMA) n'est fabriquée ici puisqu'elle n'est
pas conservée en base.
"""

import random
from datetime import datetime

_BUY_TEMPLATES_FR = [
    "Le signal ACHAT sur {pair} a été déclenché par un croisement haussier : le prix est "
    "repassé au-dessus de sa moyenne mobile exponentielle à 21 périodes pendant que le RSI "
    "sortait de la zone de survente, une configuration technique classique de retournement à "
    "court terme. Entrée autour de {entry}, avec un stop loss à {sl} ({sl_pct}) et un objectif de "
    "take profit à {tp} ({tp_pct}).",
    "Sur {pair}, l'EMA rapide (9 périodes) a franchi à la hausse l'EMA lente (21 périodes) au "
    "moment même où le RSI indiquait une sortie de zone de survente, ce qui a déclenché ce "
    "signal ACHAT. Le prix d'entrée se situe vers {entry}, avec un stop loss à {sl} et un take "
    "profit visé à {tp}.",
    "{pair} vient de valider un croisement EMA9/EMA21 haussier avec confirmation du RSI (sortie "
    "de survente), ce qui correspond aux critères du signal ACHAT généré ici : entrée proche de "
    "{entry}, protection (stop loss) à {sl}, objectif (take profit) à {tp}.",
]

_SELL_TEMPLATES_FR = [
    "Le signal VENTE sur {pair} a été déclenché par un croisement baissier : le prix est "
    "repassé sous sa moyenne mobile exponentielle à 21 périodes alors que le RSI sortait de la "
    "zone de surachat, signalant un possible retournement baissier à court terme. Entrée autour "
    "de {entry}, stop loss à {sl} ({sl_pct}), take profit à {tp} ({tp_pct}).",
    "Sur {pair}, l'EMA rapide (9 périodes) est repassée sous l'EMA lente (21 périodes) pendant "
    "que le RSI indiquait une sortie de zone de surachat, déclenchant ce signal VENTE. Entrée "
    "proche de {entry}, stop loss à {sl}, take profit visé à {tp}.",
    "{pair} a validé un croisement EMA9/EMA21 baissier avec confirmation du RSI (sortie de "
    "surachat), correspondant aux critères du signal VENTE : entrée proche de {entry}, "
    "protection à {sl}, objectif à {tp}.",
]

_BUY_TEMPLATES_EN = [
    "The BUY signal on {pair} was triggered by a bullish crossover: price moved back above its "
    "21-period exponential moving average while the RSI was exiting oversold territory, a "
    "classic short-term reversal setup. Entry around {entry}, with a stop loss at {sl} ({sl_pct}) "
    "and a take profit target at {tp} ({tp_pct}).",
    "On {pair}, the fast EMA (9 periods) crossed above the slow EMA (21 periods) right as the "
    "RSI was leaving oversold territory, triggering this BUY signal. Entry price sits near "
    "{entry}, with a stop loss at {sl} and a take profit target at {tp}.",
    "{pair} just confirmed a bullish EMA9/EMA21 crossover with RSI confirmation (exiting "
    "oversold), matching the criteria for this BUY signal: entry near {entry}, stop loss at "
    "{sl}, take profit target at {tp}.",
]

_SELL_TEMPLATES_EN = [
    "The SELL signal on {pair} was triggered by a bearish crossover: price moved back below its "
    "21-period exponential moving average while the RSI was exiting overbought territory, "
    "signaling a possible short-term reversal. Entry around {entry}, stop loss at {sl} ({sl_pct}), "
    "take profit at {tp} ({tp_pct}).",
    "On {pair}, the fast EMA (9 periods) crossed below the slow EMA (21 periods) while the RSI "
    "was leaving overbought territory, triggering this SELL signal. Entry near {entry}, stop "
    "loss at {sl}, take profit target at {tp}.",
    "{pair} confirmed a bearish EMA9/EMA21 crossover with RSI confirmation (exiting overbought), "
    "matching the criteria for this SELL signal: entry near {entry}, stop loss at {sl}, take "
    "profit target at {tp}.",
]

_TEMPLATES = {
    "fr": {"BUY": _BUY_TEMPLATES_FR, "SELL": _SELL_TEMPLATES_FR},
    "en": {"BUY": _BUY_TEMPLATES_EN, "SELL": _SELL_TEMPLATES_EN},
}


def format_price(value):
    value = float(value)
    if value >= 1:
        return f"{value:,.2f}".replace(",", " ")
    return f"{value:.6f}"


def format_level_pct(entry, level):
    """Écart réel entre l'entrée et un niveau (stop/take profit), en %.

    Remplace un ancien "(-2%)"/"(+4%)" codé en dur qui datait des stops fixes
    d'origine : depuis le passage aux stops dynamiques ATR (Multi-TP), l'écart
    réel varie par signal et pouvait être 5x plus petit que le chiffre annoncé
    à côté des mêmes prix — trivialement vérifiable par n'importe quel lecteur.
    """
    entry = float(entry)
    pct = (float(level) - entry) / entry * 100
    return f"{pct:+.1f}%"


_CARRY_ANALYSE = {
    "fr": (
        "Position neutre au marché sur {pair} : achat au comptant et vente à découvert du "
        "contrat perpétuel, pour le même montant. Les deux jambes s'annulent, la direction du "
        "prix n'entre donc pas dans le résultat. Le rendement vient du financement versé par "
        "les acheteurs de perpétuels aux vendeurs, toutes les 8 heures. Clôture prévue sur une "
        "durée, jamais sur un niveau de prix."
    ),
    "en": (
        "Market-neutral position on {pair}: spot purchase plus a short on the perpetual "
        "contract, same size. The two legs cancel out, so price direction does not affect the "
        "outcome. The return comes from the funding rate paid by perpetual buyers to sellers "
        "every 8 hours. The position closes on a fixed duration, never on a price level."
    ),
}


# Analyses propres aux moteurs transversaux. Les gabarits BUY/SELL décrivent un
# croisement d'EMA et une sortie de survente — c'est l'ancien moteur horaire, et
# CE N'EST PAS ce qui a produit ces signaux-là. Les laisser s'appliquer publiait
# sur un site indexé le récit détaillé d'une mécanique qui n'a jamais eu lieu.
_ANALYSE_PAR_MOTEUR = {
    "relative_strength": {
        "fr": (
            "Sur {pair}, ce signal ne vient pas d'un croisement d'indicateurs mais d'un "
            "classement : la stratégie compare toutes les cryptos suivies entre elles et achète "
            "les plus fortes du moment, en pariant sur la continuation de leur avance. {pair} "
            "figurait parmi elles. Entrée vers {entry}, stop loss à {sl} ({sl_pct}), objectif "
            "principal à {tp} ({tp_pct}). La sortie est prévue au bout de {jours} jours, "
            "atteinte ou non — c'est la durée sur laquelle la stratégie a été validée."
        ),
        "en": (
            "On {pair}, this signal comes from a ranking rather than an indicator crossover: the "
            "strategy compares every tracked crypto against the others and buys the strongest of "
            "the moment, betting their lead continues. {pair} was among them. Entry near {entry}, "
            "stop loss at {sl} ({sl_pct}), main target at {tp} ({tp_pct}). The position closes "
            "after {jours} days whether or not the target is reached — that is the holding period "
            "the strategy was validated on."
        ),
    },
    "momentum_4h": {
        "fr": (
            "Sur {pair}, même principe de classement que la force relative, mais mesuré sur des "
            "bougies de 4 heures : {pair} figurait en tête des cryptos les plus fortes du moment. "
            "Ce moteur ne se déclenche que lorsque le marché est baissier, le créneau où les "
            "autres stratégies du système restent silencieuses. Entrée vers {entry}, stop loss à "
            "{sl} ({sl_pct}), objectif principal à {tp} ({tp_pct}), sortie prévue au bout de "
            "{jours} jours. Ce moteur est en observation : son avantage est mesuré positif sur "
            "trois années sur quatre, mais en recul sur la dernière."
        ),
        "en": (
            "On {pair}, the same ranking principle as relative strength, measured on 4-hour "
            "candles: {pair} ranked among the strongest cryptos of the moment. This engine only "
            "fires while the market is bearish — the window where the system's other strategies "
            "stay silent. Entry near {entry}, stop loss at {sl} ({sl_pct}), main target at {tp} "
            "({tp_pct}), exit after {jours} days. This engine is under observation: its edge "
            "measures positive in three years out of four, but declining in the most recent one."
        ),
    },
}


def _jours_de_detention(signal):
    """Durée prévue, en jours, quand le signal porte son échéance."""
    debut, fin = signal.get("created_at"), signal.get("hold_until")
    if not debut or not fin:
        return None
    try:
        d = datetime.fromisoformat(str(debut).replace("Z", "+00:00"))
        f = datetime.fromisoformat(str(fin).replace("Z", "+00:00"))
    except ValueError:
        return None
    jours = round((f - d).total_seconds() / 86400)
    return jours if jours >= 1 else None


def generate_analysis(signal, lang="fr"):
    """Un paragraphe d'analyse (fr/en), cohérent avec le type ET le moteur du signal."""
    # Un carry n'a ni sens directionnel ni objectif de prix : les gabarits
    # BUY/SELL, qui parlent de cassure et de niveau à atteindre, décriraient
    # une position qui n'existe pas. Sans cette branche, la génération du site
    # échoue purement et simplement sur un KeyError dès qu'un carry est publié.
    if str(signal.get("type", "")).upper() == "CARRY":
        return _CARRY_ANALYSE.get(lang, _CARRY_ANALYSE["fr"]).format(pair=signal["pair"])

    # Un moteur transversal décrit par un gabarit d'EMA raconterait une analyse
    # technique qui n'a pas eu lieu. On ne bascule que si la durée est connue :
    # sans elle, la phrase de sortie temporelle serait tout aussi inventée.
    par_moteur = _ANALYSE_PAR_MOTEUR.get(signal.get("engine") or "")
    jours = _jours_de_detention(signal)
    if par_moteur and jours:
        return par_moteur.get(lang, par_moteur["fr"]).format(
            pair=signal["pair"],
            entry=format_price(signal["entry_price"]),
            sl=format_price(signal["stop_loss"]),
            tp=format_price(signal["take_profit"]),
            sl_pct=format_level_pct(signal["entry_price"], signal["stop_loss"]),
            tp_pct=format_level_pct(signal["entry_price"], signal["take_profit"]),
            jours=jours,
        )

    templates = _TEMPLATES[lang][signal["type"]]
    template = random.choice(templates)
    return template.format(
        pair=signal["pair"],
        entry=format_price(signal["entry_price"]),
        sl=format_price(signal["stop_loss"]),
        tp=format_price(signal["take_profit"]),
        sl_pct=format_level_pct(signal["entry_price"], signal["stop_loss"]),
        tp_pct=format_level_pct(signal["entry_price"], signal["take_profit"]),
    )
