"""
Moteur Force Relative : le premier moteur du projet reposant sur un avantage mesuré.

Contexte, parce qu'il faut s'en souvenir dans six mois. Les moteurs existants
(Haute Confiance, Squeeze) reposent sur des règles techniques absolues —
croisement d'EMA confirmé par un RSI BAS, compression de bandes — évaluées
paire par paire en intrajournalier. Environ 35 variantes de cette famille ont
été testées ; aucune n'a survécu au protocole de validation, et le test des
unités de temps a montré pourquoi : le signal se dégradait quand le bruit
diminuait, signature d'une absence de pouvoir prédictif.

Ce moteur est différent sur quatre points, et chacun compte :

  1. Le signal est RELATIF, pas absolu. La question n'est pas « BTC va-t-il
     monter » mais « parmi les 40 paires, lesquelles sont les plus fortes ».
  2. Le sens est INVERSÉ par rapport aux autres moteurs. Ils achètent le RSI
     bas ; celui-ci achète le RSI haut. Sur 6 ans, l'écart entre les deux sens
     est de +69,6 points par an, positif sur 18 combinaisons de paramètres
     sur 18, et il tient sur l'univers restreint aux paires déjà cotées avant
     2020 — donc non choisies en connaissant leur avenir. Le résultat est
     cohérent avec Fieberg, Liedtke, Poddig, Walker & Zaremba (JFQA, 2024),
     qui mesurent sur 3 245 cryptos un quintile RSI haut à +3,52 %/semaine
     contre +0,00 % pour le quintile bas.
  3. Un FILTRE DE TENDANCE ABSOLUE conditionne tout. Sans lui, la stratégie
     perd en marché baissier : -1,6 % en 2022, -2,2 % en 2026. Avec BTC au
     dessus de sa moyenne 200 jours, ces années n'émettent tout simplement
     AUCUN signal. Le filtre ne rend pas les mauvaises années moins mauvaises,
     il les fait disparaître. C'est la brique « momentum absolu » d'Antonacci
     (2014), une règle antérieure et extérieure au projet — pas un paramètre
     retenu parce qu'il embellissait la courbe.
  4. La sortie est TEMPORELLE. Le stop existe uniquement en protection
     catastrophe : mesuré sur 6 ans, un stop à 1 x ATR coûte 0,7 point
     d'espérance par trade, un objectif serré à 3 x ATR en coûte 2,4 — les
     gains venant de rares très gros mouvements, les couper tôt revient à
     couper la stratégie. D'où un stop à 4 x ATR (5 % des sorties seulement)
     et des objectifs volontairement lointains.

Ce qui est mesuré, et qu'il ne faut pas embellir. Simulation de portefeuille
composée, univers non contaminé, entrée décalée d'un jour, 0,10 % de frais :
+83,3 %/an sur 6 ans, drawdown maximal -63 %, aucune année perdante, 2,6 à 4,3
signaux par semaine, 48,9 % de trades gagnants. Pour un abonné entrant à une
date au hasard : médiane +5,0 % à six mois, 53 % d'entrées gagnantes, pire cas
-61,7 %. Ce n'est pas un produit qui enrichit, c'est un produit qui limite la
casse — c'est ce qui doit être annoncé, et rien de plus.

Une honnêteté supplémentaire, qui doit rester dans le code. Un classement par
simple rendement passé fait aussi bien qu'un classement par RSI (+1,57 % contre
+1,70 % d'espérance). Le RSI n'est pas l'ingrédient magique : c'est une manière
de mesurer le momentum parmi d'autres. Et sur univers filtré, prendre TOUTES
les paires au lieu des 5 meilleures rapporte encore +2,24 % par signal, ce qui
signifie que le filtre de tendance fait la majeure partie du travail et que le
classement n'ajoute qu'environ 1,1 point. Ne jamais raconter l'inverse.

LE POINT LE PLUS IMPORTANT, ET LE PLUS FACILE À CACHER. L'espérance de +3,22 %
par signal est une MOYENNE, et la distribution est extrêmement asymétrique :

    moyenne  +3,22 %      médiane  -0,69 %
    déciles : 10 % à -14,8 | 25 % à -8,0 | 50 % à -0,7 | 75 % à +8,4 | 90 % à +22,4
    les 5 % meilleurs signaux apportent 113 % du gain total
    sans eux, l'espérance tombe à -0,42 %

Autrement dit : le signal MÉDIAN perd de l'argent, et toute la rentabilité vient
d'une petite minorité de très gros gagnants. La conséquence est directe et non
négociable pour l'abonné — il faut prendre TOUS les signaux, mécaniquement. En
choisir quelques-uns, si évident que paraisse le tri, revient statistiquement à
ne garder que la partie perdante de la distribution. C'est la chose la plus
importante à dire à un abonné, et c'est aussi celle qu'un vendeur aurait le plus
envie de taire.

Ce que cela implique aussi pour ce module : ne jamais introduire de filtre
supplémentaire « de bon sens » qui écarterait des signaux sans avoir été mesuré.
Écarter les signaux qui semblent mauvais, c'est exactement le mécanisme qui
détruit l'avantage.

Modules de validation correspondants, à relire avant toute modification :
backtest_rsi_inverse, backtest_rsi_long, backtest_rsi_attaque,
backtest_rsi_production, backtest_dual_momentum, backtest_final_portefeuille,
backtest_stop_impact.
"""

import logging
from datetime import datetime, timezone

import pandas as pd

import config

logger = logging.getLogger(__name__)

ENGINE_NAME = "relative_strength"


def compute_rsi(closes: pd.Series, period: int) -> pd.Series:
    """RSI de Wilder sur une série de clôtures journalières."""
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def compute_atr(df: pd.DataFrame, period: int = 14) -> float | None:
    """ATR de Wilder sur bougies journalières, dernière valeur uniquement."""
    if df is None or len(df) < period + 1:
        return None
    prev_close = df["close"].shift(1)
    true_range = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    value = atr.iloc[-1]
    return None if pd.isna(value) or value <= 0 else float(value)


def is_market_in_uptrend(btc_daily: pd.DataFrame) -> bool | None:
    """
    Filtre de tendance absolue : BTC au-dessus de sa moyenne mobile longue.

    Retourne None si l'historique est insuffisant pour trancher. Ce cas est
    traité comme un refus par l'appelant : en l'absence d'information sur le
    régime de marché, on n'émet rien. Une stratégie de suivi de tendance qui
    tourne à l'aveugle pendant un marché baissier est exactement ce que ce
    filtre existe pour empêcher.
    """
    if btc_daily is None or len(btc_daily) < config.RS_TREND_MA_PERIOD:
        return None
    closes = btc_daily["close"]
    ma = closes.rolling(config.RS_TREND_MA_PERIOD).mean().iloc[-1]
    if pd.isna(ma):
        return None
    return bool(closes.iloc[-1] > ma)


def rank_pairs(daily_by_pair: dict) -> list:
    """
    Classe les paires par force relative décroissante.

    Une paire dont l'historique est trop court pour un RSI fiable est écartée
    plutôt que classée par défaut : la faire figurer en bas du classement
    serait une information inventée.
    """
    scores = {}
    for pair, df in daily_by_pair.items():
        if df is None or len(df) < config.RS_RSI_PERIOD + 5:
            continue
        rsi = compute_rsi(df["close"], config.RS_RSI_PERIOD)
        value = rsi.iloc[-1]
        if pd.isna(value):
            continue
        scores[pair] = float(value)
    return sorted(scores.items(), key=lambda kv: -kv[1])


def build_signal(pair: str, entry_price: float, atr_value: float, rsi_value: float,
                 rank: int, timestamp=None) -> dict:
    """
    Construit le signal avec la géométrie MESURÉE, pas supposée.

    Les multiples proviennent de backtest_stop_impact : sur 6 ans, un stop à
    4 x ATR laisse 95 % des positions aller à leur terme et rend +2,74 % par
    trade, contre +2,05 % à 1 x ATR. Les objectifs à 4 / 8 / 12 x ATR ne
    déclenchent que 2 % des sorties — ils servent à jalonner la progression
    pour l'abonné, pas à piloter la clôture, qui reste temporelle.
    """
    stop_loss = entry_price - config.RS_SL_ATR_MULT * atr_value
    tp1 = entry_price + config.RS_TP1_ATR_MULT * atr_value
    tp2 = entry_price + config.RS_TP2_ATR_MULT * atr_value
    tp3 = entry_price + config.RS_TP3_ATR_MULT * atr_value

    return {
        "pair": pair,
        "type": "BUY",
        "entry_price": round(entry_price, 8),
        "stop_loss": round(max(stop_loss, entry_price * 0.05), 8),
        "take_profit": round(tp2, 8),
        "tp1_price": round(tp1, 8),
        "tp2_price": round(tp2, 8),
        "tp3_price": round(tp3, 8),
        "created_at": (timestamp or datetime.now(timezone.utc)).isoformat(),
        "engine": ENGINE_NAME,
        # Métadonnées propres à ce moteur, utiles au message envoyé aux abonnés
        # comme au suivi de performance. La sortie prévue est une DURÉE, pas un
        # prix : c'est la caractéristique de la stratégie validée.
        "rs_rank": rank,
        "rs_rsi": round(rsi_value, 1),
        "rs_hold_days": config.RS_HOLD_DAYS,
    }


def detect_relative_strength_signals(daily_by_pair: dict, btc_daily: pd.DataFrame,
                                     already_open: set = None, timestamp=None) -> list:
    """
    Point d'entrée du moteur. Retourne la liste des signaux à émettre.

    `daily_by_pair` associe chaque paire à ses bougies journalières closes
    (colonnes open/high/low/close). `already_open` contient les paires déjà en
    position, qui ne redéclenchent pas de signal tant qu'elles sont détenues —
    le backtest ne compte que les ENTRÉES réelles, et compter autrement
    gonflerait artificiellement le nombre de signaux annoncé.
    """
    already_open = already_open or set()

    uptrend = is_market_in_uptrend(btc_daily)
    if uptrend is None:
        logger.warning(
            "[%s] Historique BTC insuffisant pour évaluer la tendance (%d jours requis) : "
            "aucun signal émis par prudence.", ENGINE_NAME, config.RS_TREND_MA_PERIOD,
        )
        return []
    if not uptrend:
        logger.info(
            "[%s] Marché sous sa moyenne %d jours : aucun signal. C'est le comportement "
            "attendu — sur 6 ans, ce filtre a mis 2022 et 2026 entièrement hors marché.",
            ENGINE_NAME, config.RS_TREND_MA_PERIOD,
        )
        return []

    ranked = rank_pairs(daily_by_pair)
    if len(ranked) < config.RS_MIN_RANKED_PAIRS:
        logger.warning(
            "[%s] Seulement %d paires classables (%d requises) : classement non fiable, "
            "aucun signal.", ENGINE_NAME, len(ranked), config.RS_MIN_RANKED_PAIRS,
        )
        return []

    signals = []
    for position, (pair, rsi_value) in enumerate(ranked[: config.RS_TOP_N], start=1):
        if pair in already_open:
            continue
        df = daily_by_pair[pair]
        atr_value = compute_atr(df)
        entry_price = float(df["close"].iloc[-1])
        if atr_value is None or entry_price <= 0:
            logger.warning("[%s] %s : ATR ou prix indisponible, paire ignorée.", ENGINE_NAME, pair)
            continue
        signals.append(build_signal(pair, entry_price, atr_value, rsi_value, position, timestamp))

    if signals:
        logger.info(
            "[%s] %d signal(aux) : %s. Marché haussier confirmé, classement sur %d paires.",
            ENGINE_NAME, len(signals),
            ", ".join(f"{s['pair']} (#{s['rs_rank']}, RSI {s['rs_rsi']})" for s in signals),
            len(ranked),
        )
    return signals
