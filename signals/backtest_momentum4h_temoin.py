"""
Le momentum 4H bat-il un tirage au sort ? Et faut-il l'inverser ?

POURQUOI CE MODULE EXISTE.

Le momentum 4H est le seul moteur directionnel actif aujourd'hui : le filtre de
tendance est fermé depuis novembre 2025, ce qui coupe la force relative, la
cassure de canal et l'expansion de volatilité. Il porte donc, à lui seul, tout
ce que l'abonné reçoit en directionnel.

Son relevé RÉEL, mesuré en base le 14/08/2026 : 10 clôtures, 3 gagnantes,
-0,07 % par trade. Sa promesse publiée sur chaque signal : +0,805 %. Dix trades
ne prouvent rien — mais ils suffisent à poser la question sérieusement.

Or ce projet possède déjà le protocole qui tranche ce genre de question, et il
a un antécédent gênant : le TÉMOIN ALÉATOIRE a réfuté le momentum transversal
journalier avec p = 0,885, alors qu'il paraissait excellent sur 17 combinaisons
de paramètres sur 18. Le momentum 4H est un momentum transversal. Il a été
livré « en observation » sans que ce témoin lui soit appliqué.

CE QUE CE MODULE MESURE, à protocole strictement identique pour les trois :

  1. LA RÈGLE DE PRODUCTION  — classer les 40 paires par RSI 42 sur bougies de
     4 h, acheter les 2 plus FORTES, tenir 18 bougies (3 jours), uniquement
     quand le Bitcoin est sous sa moyenne 200 jours ;
  2. LA RÈGLE INVERSÉE       — acheter les 2 plus FAIBLES. Fieberg, Liedtke,
     Poddig, Walker & Zaremba (Journal of Financial and Quantitative Analysis,
     2024) mesurent sur 3 245 cryptomonnaies un renversement de court terme
     là où les actions montrent de la continuation. Si la thèse tient, le
     moteur actuel serait à l'envers ;
  3. LE TÉMOIN ALÉATOIRE     — mêmes dates, même nombre de positions, même
     durée, mêmes frais, paires tirées au sort.

Sans le témoin, un résultat positif ne veut rien dire : sur un marché qui monte,
n'importe quel panier de deux cryptos gagne. C'est exactement le piège dans
lequel le momentum transversal journalier était tombé.

FRAIS COMPTÉS dans les trois cas, à l'identique.

Usage : python backtest_momentum4h_temoin.py
"""

import io
import json
import os
import random

import pandas as pd

import config

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "tf_cache")
BOUGIES_PAR_JOUR = 6

# Paramètres EXACTS de la production (config.py). On mesure la stratégie
# livrée, pas une variante flatteuse.
RSI_PERIODE = config.M4H_RSI_PERIOD          # 42 bougies = 7 jours
HOLD_BOUGIES = config.M4H_HOLD_BOUGIES       # 18 bougies = 3 jours
TOP_N = config.M4H_TOP_N                     # 2 positions
MA_BOUGIES = config.RS_TREND_MA_PERIOD * BOUGIES_PAR_JOUR  # 200 jours

# Aller-retour, deux jambes. Même hypothèse que les autres modules du projet.
FRAIS_ALLER_RETOUR_PCT = 0.20

N_PERMUTATIONS = 300


def charger_4h() -> pd.DataFrame:
    """Clôtures 4 h des 40 paires de l'univers, alignées sur un index commun."""
    series = {}
    for pair in config.PAIRS:
        symbole = pair.replace("/", "")
        chemin = os.path.join(CACHE_DIR, f"{symbole}_4h_730d.json")
        if not os.path.exists(chemin):
            continue
        bougies = json.load(io.open(chemin, encoding="utf-8"))
        if len(bougies) < MA_BOUGIES:
            continue
        df = pd.DataFrame(bougies, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["ts"] = pd.to_datetime(df["ts_ms"], unit="ms")
        series[pair] = df.set_index("ts")["close"].astype(float)
    return pd.DataFrame(series).sort_index()


def rsi_wilder(series: pd.Series, periode: int) -> pd.Series:
    """RSI de Wilder — même calcul que momentum_4h.compute_rsi."""
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / periode, adjust=False).mean()
    perte = (-delta.clip(upper=0)).ewm(alpha=1 / periode, adjust=False).mean()
    rs = gain / perte.replace(0, pd.NA)
    return 100 - 100 / (1 + rs)


def dates_defavorables(prix: pd.DataFrame) -> pd.Series:
    """
    Le régime d'activité du moteur : Bitcoin SOUS sa moyenne 200 jours.

    C'est la seule condition dans laquelle l'avantage a été mesuré, et donc la
    seule fenêtre dans laquelle il est honnête de l'évaluer.
    """
    btc = prix["BTC/USDT"]
    return btc < btc.rolling(MA_BOUGIES).mean()


def simuler(prix: pd.DataFrame, rsi: pd.DataFrame, defavorable: pd.Series, sens: str) -> list:
    """
    Rejoue la règle sur tout l'historique et rend la liste des rendements nets.

    `sens` vaut "fort" (règle de production) ou "faible" (règle inversée).
    Une seule entrée par pas de HOLD_BOUGIES : on ne superpose pas les
    positions, ce qui rendrait les rendements dépendants entre eux et
    fausserait toute comparaison au témoin.
    """
    rendements = []
    index = prix.index
    debut = max(MA_BOUGIES, RSI_PERIODE + 5)

    for i in range(debut, len(index) - HOLD_BOUGIES, HOLD_BOUGIES):
        if not bool(defavorable.iloc[i]):
            continue
        classement = rsi.iloc[i].dropna()
        if len(classement) < config.M4H_MIN_RANKED_PAIRS:
            continue
        ordonne = classement.sort_values(ascending=(sens == "faible"))
        retenues = list(ordonne.index[:TOP_N])

        entree = prix.iloc[i]
        sortie = prix.iloc[i + HOLD_BOUGIES]
        for paire in retenues:
            if pd.isna(entree[paire]) or pd.isna(sortie[paire]):
                continue
            brut = (sortie[paire] - entree[paire]) / entree[paire] * 100
            rendements.append(brut - FRAIS_ALLER_RETOUR_PCT)
    return rendements


def simuler_aleatoire(prix: pd.DataFrame, rsi: pd.DataFrame, defavorable: pd.Series, graine: int) -> list:
    """
    Le témoin. Mêmes dates, même nombre de positions, même durée, mêmes frais —
    seule la SÉLECTION change. Si le classement par RSI n'apporte rien, la
    règle de production doit être indiscernable de ce tirage.
    """
    rng = random.Random(graine)
    rendements = []
    index = prix.index
    debut = max(MA_BOUGIES, RSI_PERIODE + 5)

    for i in range(debut, len(index) - HOLD_BOUGIES, HOLD_BOUGIES):
        if not bool(defavorable.iloc[i]):
            continue
        classement = rsi.iloc[i].dropna()
        if len(classement) < config.M4H_MIN_RANKED_PAIRS:
            continue
        entree = prix.iloc[i]
        sortie = prix.iloc[i + HOLD_BOUGIES]
        eligibles = [p for p in classement.index if not pd.isna(entree[p]) and not pd.isna(sortie[p])]
        if len(eligibles) < TOP_N:
            continue
        for paire in rng.sample(eligibles, TOP_N):
            brut = (sortie[paire] - entree[paire]) / entree[paire] * 100
            rendements.append(brut - FRAIS_ALLER_RETOUR_PCT)
    return rendements


def resume(nom: str, rendements: list) -> float:
    if not rendements:
        print(f"{nom:<28} aucun trade")
        return 0.0
    serie = pd.Series(rendements)
    moyenne = serie.mean()
    print(
        f"{nom:<28} {len(serie):>4} trades | esperance {moyenne:+6.3f} % | "
        f"reussite {(serie > 0).mean() * 100:5.1f} % | pire {serie.min():+7.2f} % | "
        f"meilleur {serie.max():+7.2f} %"
    )
    return moyenne


def main() -> None:
    print("Chargement des bougies 4 h...", flush=True)
    prix = charger_4h()
    if prix.empty or "BTC/USDT" not in prix.columns:
        print("Cache insuffisant : lancer d'abord un module qui remplit data/tf_cache.")
        return

    print(f"{prix.shape[1]} paires, {prix.shape[0]} bougies "
          f"({prix.index[0]:%Y-%m-%d} -> {prix.index[-1]:%Y-%m-%d})\n")

    rsi = pd.DataFrame({c: rsi_wilder(prix[c], RSI_PERIODE) for c in prix.columns})
    defavorable = dates_defavorables(prix)
    part = defavorable.iloc[MA_BOUGIES:].mean() * 100
    print(f"Regime defavorable (BTC sous sa MM200) : {part:.1f} % de la periode\n")

    fort = simuler(prix, rsi, defavorable, "fort")
    faible = simuler(prix, rsi, defavorable, "faible")

    print("--- Les deux sens de la regle ---")
    esp_fort = resume("Production (plus FORTS)", fort)
    esp_faible = resume("Inverse (plus FAIBLES)", faible)

    print("\n--- Temoin aleatoire ---")
    temoins = []
    for graine in range(N_PERMUTATIONS):
        r = simuler_aleatoire(prix, rsi, defavorable, graine)
        if r:
            temoins.append(sum(r) / len(r))
    if not temoins:
        print("Temoin impossible.")
        return

    t = pd.Series(temoins)
    print(f"{N_PERMUTATIONS} tirages | esperance moyenne {t.mean():+6.3f} % | "
          f"ecart-type {t.std():.3f} | 5e centile {t.quantile(0.05):+6.3f} | "
          f"95e centile {t.quantile(0.95):+6.3f}")

    print("\n--- Verdict ---")
    for nom, esp in (("Production (plus FORTS)", esp_fort), ("Inverse (plus FAIBLES)", esp_faible)):
        p = float((t >= esp).mean())
        # p est la part des tirages au sort qui font AUSSI BIEN OU MIEUX. Une
        # valeur elevee signifie que la regle n'apporte rien qu'un tirage au
        # sort ne donnerait.
        verdict = "AUCUN AVANTAGE demontre" if p > 0.10 else "avantage compatible avec les donnees"
        print(f"{nom:<28} p = {p:.3f}  ->  {verdict}")

    print(
        "\nRappel de methode : le temoin aleatoire a deja refute le momentum transversal\n"
        "journalier de ce projet (p = 0,885) alors qu'il paraissait excellent sur 17\n"
        "combinaisons de parametres sur 18. Un resultat positif sans lui ne vaut rien."
    )


# ---------------------------------------------------------------------------
# ÉTUDE 2 — LA ROBUSTESSE, sans laquelle le premier résultat ne vaut rien.
#
# Un avantage réel ne dépend pas d'un réglage fin : c'est le critère que ce
# projet s'est donné et qui a fait tomber le momentum transversal journalier.
# Si +0,444 % n'existe qu'à RSI 42 / top 2 / 18 bougies, c'est un point de
# chance dans une grille, pas une stratégie.
#
# On balaie donc la région autour des réglages de production et on regarde la
# MOYENNE de la région, pas son meilleur point.
# ---------------------------------------------------------------------------


def balayage(prix, defavorable):
    periodes = [21, 28, 42, 56, 84]      # 3,5 / 4,7 / 7 / 9,3 / 14 jours
    holds = [6, 12, 18, 30, 42]          # 1 / 2 / 3 / 5 / 7 jours
    tops = [1, 2, 3, 5]

    resultats = []
    for periode in periodes:
        rsi = pd.DataFrame({c: rsi_wilder(prix[c], periode) for c in prix.columns})
        for hold in holds:
            for top in tops:
                global HOLD_BOUGIES, TOP_N, RSI_PERIODE
                HOLD_BOUGIES, TOP_N, RSI_PERIODE = hold, top, periode
                r = simuler(prix, rsi, defavorable, "fort")
                if len(r) >= 30:
                    resultats.append((periode, hold, top, len(r), sum(r) / len(r)))
    return resultats


def etude_robustesse():
    prix = charger_4h()
    rsi42 = pd.DataFrame({c: rsi_wilder(prix[c], 42) for c in prix.columns})
    defavorable = dates_defavorables(prix)

    print("\n\n=== ETUDE 2 : ROBUSTESSE DE LA REGION ===\n")
    res = balayage(prix, defavorable)
    if not res:
        print("Pas assez de trades.")
        return

    df = pd.DataFrame(res, columns=["rsi", "hold", "top", "trades", "esperance"])
    positives = (df["esperance"] > 0).sum()
    print(f"{len(df)} combinaisons testees | {positives} positives "
          f"({positives / len(df) * 100:.0f} %) | moyenne de la region {df['esperance'].mean():+.3f} %")
    print(f"Rappel : le temoin aleatoire donne -0,648 % dans le meme regime.\n")

    print("Par nombre de positions (moyenne sur tous les autres reglages) :")
    for top, g in df.groupby("top"):
        print(f"  top {top} : {g['esperance'].mean():+6.3f} %  ({(g['esperance'] > 0).mean() * 100:3.0f} % positives, {int(g['trades'].mean())} trades moyens)")

    print("\nPar duree de detention :")
    for hold, g in df.groupby("hold"):
        print(f"  {hold:>2} bougies ({hold // 6} j) : {g['esperance'].mean():+6.3f} %  ({(g['esperance'] > 0).mean() * 100:3.0f} % positives)")

    print("\nPar periode de RSI :")
    for periode, g in df.groupby("rsi"):
        print(f"  RSI {periode:>2} : {g['esperance'].mean():+6.3f} %  ({(g['esperance'] > 0).mean() * 100:3.0f} % positives)")

    print("\nLes 8 meilleures combinaisons :")
    for _, r in df.sort_values("esperance", ascending=False).head(8).iterrows():
        marque = "  <- PRODUCTION" if (r["rsi"], r["hold"], r["top"]) == (42, 18, 2) else ""
        print(f"  RSI {int(r['rsi']):>2} / {int(r['hold']):>2} bougies / top {int(r['top'])} : "
              f"{r['esperance']:+6.3f} % sur {int(r['trades'])} trades{marque}")

    prod = df[(df["rsi"] == 42) & (df["hold"] == 18) & (df["top"] == 2)]
    if not prod.empty:
        rang = (df["esperance"] > prod["esperance"].iloc[0]).sum() + 1
        print(f"\nLa production est {rang}e sur {len(df)} combinaisons.")


if __name__ == "__main__":
    etude_robustesse()
