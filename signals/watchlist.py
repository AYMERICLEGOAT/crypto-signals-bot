"""
La liste du jour : ce qui est proche de déclencher, publié tous les jours.

Le problème que ça résout. La force relative est coupée
quand le Bitcoin passe sous sa moyenne 200 jours, soit 41 % du temps. Pendant
ces périodes — la période actuelle dure depuis novembre 2025 — le canal ne
publie presque rien, et un abonné qui paie a l'impression d'un service mort.
La tentation évidente est de baisser les seuils pour « remplir ». Elle a été
écartée : diffuser des positions qu'on sait perdantes est la seule chose que ce
projet s'interdit.

La réponse retenue est d'une autre nature. Un canal de signaux n'a pas à ne
publier QUE des ordres d'achat. Ce qui manque à l'abonné pendant une période
creuse, ce n'est pas un trade de plus, c'est de savoir OÙ REGARDER quand ça
repartira. Cette liste le lui dit, chaque jour, sans rien inventer :

  - où en est la condition d'entrée du marché, et ce qu'il manque pour la
    rouvrir ;
  - quelles paires sont les plus proches de déclencher un signal, et à quelle
    distance exactement ;
  - quelles opportunités de carry approchent de la barre de qualité.

Aucun avantage statistique nouveau n'est requis : tout est dérivé des moteurs
existants. Ce n'est pas une recommandation d'achat, et le texte le dit
explicitement à chaque envoi — c'est une mise en attente.

Écrit pour être lisible par quelqu'un qui débute ET utile à quelqu'un qui sait.
Le débutant a besoin qu'on lui dise ce que ça veut dire et quoi faire (rien,
aujourd'hui) ; celui qui sait veut les chiffres. Les deux sont dans le même
message, dans cet ordre : la conclusion d'abord, les chiffres ensuite.
"""

import logging
from datetime import datetime, timezone

import requests

import config

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot"

# Nombre de paires listées. Cinq est un compromis : assez pour que l'abonné ait
# de quoi surveiller, assez peu pour que le message se lise d'un coup d'œil sur
# un téléphone. Au-delà de sept ou huit lignes, une liste cesse d'être lue.
NB_PAIRES_LISTEES = 5

# Fenêtre du plus haut servant de référence de proximité : la même que la
# famille « cassure de canal » (voir backtest_familles.famille_cassure_haut),
# pour que la distance annoncée corresponde exactement au déclencheur réel.
FENETRE_CASSURE = 50


def _pct(valeur: float, decimales: int = 1) -> str:
    """
    Pourcentage au format français, avec son signe.
    À n'utiliser que là où le sens de variation n'est pas déjà porté par le
    texte : « -8,5 % SOUS sa moyenne » dirait deux fois la même chose, et se
    lit mal. Dans ce cas, employer _ampleur.
    """
    signe = "+" if valeur > 0 else ""
    return f"{signe}{valeur:.{decimales}f}".replace(".", ",") + " %"


def _ampleur(valeur: float, decimales: int = 1) -> str:
    """Valeur absolue en pourcentage, sans signe : le texte porte déjà le sens."""
    return f"{abs(valeur):.{decimales}f}".replace(".", ",") + " %"


def etat_du_marche(btc_daily) -> dict | None:
    """
    Où en est la condition d'entrée, et ce qu'il manque pour la rouvrir.

    C'est l'information la plus importante du message : tant que cette porte
    est fermée, la force relative ne peut pas produire, et
    l'abonné a le droit de savoir de combien on en est loin plutôt que de
    constater un silence sans explication.
    """
    if btc_daily is None or len(btc_daily) < config.RS_TREND_MA_PERIOD:
        return None
    closes = btc_daily["close"]
    moyenne = closes.rolling(config.RS_TREND_MA_PERIOD).mean().iloc[-1]
    prix = closes.iloc[-1]
    if moyenne is None or moyenne != moyenne or moyenne <= 0:  # NaN
        return None
    ecart = (prix / moyenne - 1) * 100
    return {"ouvert": bool(prix > moyenne), "ecart_pct": ecart, "prix": float(prix), "moyenne": float(moyenne)}


def proximite_cassure(daily_by_pair: dict) -> list:
    """
    Distance de chaque paire à son plus haut `FENETRE_CASSURE` jours, en
    pourcentage. Une distance de 2 % signifie qu'il manque 2 % de hausse pour
    que la cassure se produise.

    Les paires DÉJÀ au-dessus de leur plus haut sont exclues : ce ne sont plus
    des candidates, ce sont des signaux — et si le marché était ouvert, elles
    auraient déjà été émises par le moteur.
    """
    lignes = []
    for pair, df in daily_by_pair.items():
        if df is None or len(df) < FENETRE_CASSURE + 2:
            continue
        plus_haut = df["high"].iloc[-(FENETRE_CASSURE + 1):-1].max()
        prix = df["close"].iloc[-1]
        if plus_haut is None or plus_haut != plus_haut or plus_haut <= 0 or prix <= 0:
            continue
        manque = (plus_haut / prix - 1) * 100
        if manque <= 0:
            continue  # déjà cassé : c'est un signal, pas une candidate
        lignes.append({"pair": pair, "manque_pct": manque, "prix": float(prix), "seuil": float(plus_haut)})
    return sorted(lignes, key=lambda x: x["manque_pct"])


def construire_message(marche: dict | None, proches: list, carrys: list) -> str:
    """
    Le message tel qu'il part sur le canal.

    Trois principes de rédaction, tenus dans cet ordre :
      1. La conclusion d'abord. Un abonné doit savoir en une ligne s'il a
         quelque chose à faire aujourd'hui. La réponse est presque toujours
         non, et le dire franchement vaut mieux que le laisser deviner.
      2. Le pourquoi ensuite, en français simple, pour celui qui débute.
      3. Les chiffres à la fin, pour celui qui sait.

    Aucun `parse_mode` n'est utilisé à l'envoi (voir publier) : les noms de
    paires et les pourcentages ne contiennent rien qui doive être échappé, et
    un seul caractère mal placé ferait échouer le message entier côté Telegram.
    """
    jour = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    lignes = [f"📋 LA LISTE DU JOUR — {jour}", ""]

    # --- 1. La conclusion, en une ligne ---
    #
    # Cette ligne a longtemps dit « Rien à acheter aujourd'hui » en marché
    # fermé. C'était vrai quand seule la force relative
    # existaient ; ça ne l'est plus depuis que le momentum 4 h travaille
    # PRÉCISÉMENT dans ce régime. Le message aurait annoncé le matin qu'il n'y
    # avait rien à acheter, et le canal aurait publié deux achats l'après-midi.
    if marche and not marche["ouvert"]:
        lignes.append(
            "La force relative est à l'arrêt aujourd'hui. "
            "Trois moteurs continuent : le carry, le momentum 4H, et la faiblesse 4H — "
            "les deux derniers ne travaillent QUE dans ce régime."
        )
    elif marche and marche["ouvert"]:
        lignes.append("Le marché est favorable : les signaux d'achat sont actifs.")
    else:
        lignes.append("État du marché indéterminé aujourd'hui (données indisponibles).")
    lignes.append("")

    # --- 2. La porte d'entrée ---
    if marche:
        if marche["ouvert"]:
            lignes.append(
                f"🟢 CONDITION D'ENTRÉE : ouverte\n"
                f"Le Bitcoin est {_ampleur(marche['ecart_pct'])} au-dessus de sa moyenne 200 jours. "
                f"Tant qu'il y reste, la force relative travaille."
            )
        else:
            manque = abs(marche["ecart_pct"])
            lignes.append(
                f"🔴 CONDITION D'ENTRÉE : fermée\n"
                f"Le Bitcoin est {_ampleur(marche['ecart_pct'])} sous sa moyenne 200 jours. "
                f"Il lui faut regagner {_ampleur(manque)} pour rouvrir.\n"
                f"C'est cette règle qui a évité -70,9 % en 2022 et -39,4 % en 2026 : "
                f"quand elle est fermée, la force relative ne prend rien."
            )
        lignes.append("")

    # --- 3. Les plus proches ---
    if proches:
        lignes.append("🎯 LES PLUS PROCHES DE DÉCLENCHER")
        lignes.append(
            "Ces paires n'ont PAS de signal. Elles sont seulement les plus près "
            f"de casser leur plus haut de {FENETRE_CASSURE} jours, qui est le déclencheur."
        )
        lignes.append("")
        for i, x in enumerate(proches[:NB_PAIRES_LISTEES], start=1):
            lignes.append(f"{i}. {x['pair']} — il manque {_ampleur(x['manque_pct'])}")
        lignes.append("")

    # --- 4. Le carry ---
    if carrys:
        pluriel = "s" if len(carrys) > 1 else ""
        lignes.append(f"💵 CARRY — {len(carrys)} opportunité{pluriel} au-dessus de la barre")
        for x in carrys[:3]:
            lignes.append(f"• {x['pair']} — {_ampleur(x['par_an'], 0)} par an")
        lignes.append("Position neutre au marché, le prix n'entre pas en jeu. Détail : /carry")
        lignes.append("")
    else:
        lignes.append(
            "💵 CARRY — aucune opportunité au-dessus de la barre aujourd'hui.\n"
            "Le financement des perpétuels est trop faible pour couvrir les frais. "
            "On n'ouvre rien plutôt que d'ouvrir pour rien."
        )
        lignes.append("")

    # --- 5. Le momentum 4H, quand c'est son régime ---
    #
    # Annoncé le matin pour que ses signaux de l'après-midi ne surprennent
    # personne, et annoncé pour ce qu'il est. Un abonné qui découvre par
    # lui-même qu'un moteur est incertain ne fait plus confiance au reste.
    if marche and not marche["ouvert"]:
        lignes.append("🧪 MOMENTUM 4H — actif aujourd'hui, et c'est son seul créneau")
        lignes.append(
            "Il classe les 38 paires entre elles sur des bougies de 4 heures et achète LA plus "
            "forte, tenue 3 jours. Un signal par jour au maximum."
        )
        # LA JAMBE VENDEUSE, annoncée le matin comme les autres.
        #
        # Elle est nouvelle et elle change la nature de ce que reçoit l'abonné :
        # une vente à découvert demande un compte à terme et peut perdre sans
        # borne. La découvrir sans préavis, dans un message de signal, serait le
        # plus mauvais moment pour l'apprendre.
        lignes.append("")
        lignes.append("🔻 FAIBLESSE 4H — le miroir, actif dans le même créneau")
        lignes.append(
            "Même classement, sens inverse : il VEND À DÉCOUVERT les deux plus faibles, tenues "
            "3 jours. C'est le seul moteur qui a la baisse du marché pour lui au lieu de contre lui. "
            "Mesuré à 58,8 % de trades gagnants, contre 43,9 % pour la jambe acheteuse."
        )
        lignes.append(
            "⚠️ Une vente se joue sur un perpétuel, pas au comptant : il faut un compte à terme, "
            "et une vente peut perdre sans limite si le prix monte. Chaque signal le rappelle avant "
            "ses niveaux, et tu peux l'ignorer sans rien perdre du reste."
        )
        lignes.append(
            # REMESURÉ LE 14/08/2026 (voir ETUDE_MOMENTUM_4H_2026-08-14.md). Ce
            # paragraphe partait CHAQUE MATIN sur le canal public en annonçant
            # « les deux plus fortes », « deux signaux par jour » et « positif
            # trois années sur quatre » — trois affirmations devenues fausses le
            # jour où le moteur est passé à une seule position. Un texte
            # quotidien est le plus dangereux à laisser périmer : il republie
            # l'erreur tous les jours.
            "Ce moteur est EN OBSERVATION : positif 5 trimestres sur 6, mais seulement 43,9 % de "
            "trades gagnants — il vit de quelques gros gains, pas de la fréquence. À dimensionner "
            "plus petit que les autres."
        )
        lignes.append("")

    # --- 6. Quoi faire ---
    lignes.append("Ce message n'est pas un conseil d'achat : c'est une mise en attente.")
    lignes.append("Les vrais signaux arrivent séparément, avec entrée, stop et objectifs.")
    lignes.append("")
    lignes.append("⚠️ Pas un conseil financier — risque de perte en capital.")
    return "\n".join(lignes)


def publier(message: str) -> bool:
    """
    Envoie la liste sur le canal public.

    Envoyé sans `parse_mode`, comme tous les longs textes de ce projet : un
    seul caractère mal placé ferait échouer le message ENTIER côté Telegram, et
    ce message n'a besoin d'aucune mise en forme pour être lisible.
    """
    if not config.TELEGRAM_BOT_TOKEN or not config.TELEGRAM_CHANNEL_ID:
        logger.warning("Liste du jour non publiée : TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID absent.")
        return False
    try:
        resp = requests.post(
            f"{TELEGRAM_API_BASE}{config.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": config.TELEGRAM_CHANNEL_ID,
                "text": message,
                "disable_web_page_preview": True,
            },
            timeout=20,
        )
        if not resp.ok:
            logger.error("Échec de publication de la liste du jour : %s %s", resp.status_code, resp.text[:300])
            return False
        logger.info("Liste du jour publiée sur le canal (%d caractères).", len(message))
        return True
    except Exception:
        logger.exception("Échec de l'envoi de la liste du jour.")
        return False
