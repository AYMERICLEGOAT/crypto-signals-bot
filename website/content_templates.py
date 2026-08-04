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


def generate_analysis(signal, lang="fr"):
    """Un paragraphe d'analyse (fr/en), cohérent avec le type du signal."""
    # Un carry n'a ni sens directionnel ni objectif de prix : les gabarits
    # BUY/SELL, qui parlent de cassure et de niveau à atteindre, décriraient
    # une position qui n'existe pas. Sans cette branche, la génération du site
    # échoue purement et simplement sur un KeyError dès qu'un carry est publié.
    if str(signal.get("type", "")).upper() == "CARRY":
        return _CARRY_ANALYSE.get(lang, _CARRY_ANALYSE["fr"]).format(pair=signal["pair"])

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
