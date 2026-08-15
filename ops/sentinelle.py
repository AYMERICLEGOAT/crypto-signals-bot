#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LA SENTINELLE — le plancher sous la routine quotidienne.

POURQUOI ELLE EXISTE.

La routine (OPS_ROUTINE_PROMPT.md) est un agent : elle raisonne, croise des
traces, trouve ce que personne n'a pensé à chercher. C'est irremplaçable, et
c'est exactement ce qui la rend fragile. Elle est morte trois fois de suite,
pour trois raisons différentes, sans que rien ne prenne le relais :

  03/08  limite de dépense mensuelle atteinte
  10/08  session OAuth expirée — sept jours de silence, découverts par hasard
  13/08  la même, à 15:32 : « Failed to authenticate »

À quoi s'ajoutent deux fragilités structurelles : elle tourne sur le PC du
propriétaire (éteint la nuit, éteint en vacances) et par une tâche planifiée
Windows qui échoue en une seconde en écrivant deux lignes dans un journal que
personne ne lit.

Pendant ces sept jours d'aveuglement, la production a accumulé : aucun paiement
USDT détectable, aucun signal livré en message privé, huit tâches mortes sur la
limite de sous-requêtes, une clôture perdue pour toujours, et un canal public
publiant chaque jour un chiffre qui le contredisait.

CE QUE CETTE SENTINELLE EST, ET N'EST PAS.

Elle ne raisonne pas. Elle exécute mécaniquement le registre des observables
(OPS_REGISTRES.md, registre 1) : pour chaque capacité du produit, la trace
qu'elle doit laisser, et ce que son absence signifie. Elle ne trouvera jamais un
défaut nouveau — c'est le travail de la routine.

Mais elle a la seule qualité que la routine n'a pas : elle marche toujours.
Aucun modèle, aucune authentification, aucun PC. Trois dépendances Python et une
clé Supabase, dans GitHub Actions, gratuitement.

LE SILENCE EST UNE INFORMATION, À CONDITION D'ÊTRE PROUVÉ.

Un contrôle vert n'envoie rien — sinon la sentinelle devient elle-même le bruit
qu'elle combat. Mais elle écrit un battement de cœur à chaque passage, et elle
VÉRIFIE LE SIEN : si le précédent date de plus de 36 heures, elle le dit dans
son rapport. Sans ça, « aucune alerte » et « plus personne ne surveille » se
ressemblent — et c'est précisément la confusion qui a coûté les sept jours.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID = os.environ.get("ADMIN_TELEGRAM_ID", "")

MAINTENANT = datetime.now(timezone.utc)


@dataclass
class Constat:
    """Un contrôle qui a échoué. `quoi_faire` n'est pas optionnel : une alerte sans action est du bruit."""

    titre: str
    detail: str
    quoi_faire: str


def rest(chemin: str, params: dict | None = None) -> list:
    """GET PostgREST. Lève en cas d'échec : une sentinelle aveugle doit crier, pas rendre une liste vide."""
    url = f"{SUPABASE_URL}/rest/v1/{chemin}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def ecrire_battement() -> None:
    corps = json.dumps({"job_name": "sentinelle", "last_run_at": MAINTENANT.isoformat(), "alerted": False}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/system_heartbeats?on_conflict=job_name",
        data=corps,
        method="POST",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
    )
    urllib.request.urlopen(req, timeout=30).read()


def heures_depuis(iso: str | None) -> float:
    if not iso:
        return 1e9
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (MAINTENANT - t).total_seconds() / 3600


def depuis_dernier_passage(hb: dict, plafond_jours: int) -> str:
    """
    Borne basse des contrôles d'ÉVÉNEMENTS.

    Un événement passé — une clôture incohérente, une publication nocturne —
    n'a pas à être resignalé chaque jour jusqu'à ce qu'il sorte de la fenêtre.
    Il l'a été une fois, il a été traité ou non, et le répéter à l'identique
    apprend à ignorer la sentinelle. On ne regarde donc que ce qui est arrivé
    DEPUIS le passage précédent, avec un plafond pour le tout premier run.

    Les contrôles d'ÉTAT (pool vide, battement périmé, paiement en attente) ne
    passent PAS par ici : un état anormal doit se répéter tant qu'il dure.
    """
    plancher = MAINTENANT - timedelta(days=plafond_jours)
    precedent = hb.get("sentinelle")
    if precedent:
        t = datetime.fromisoformat(precedent.replace("Z", "+00:00"))
        # Une marge d'une heure évite de rater un événement inséré pendant que
        # le passage précédent tournait.
        t -= timedelta(hours=1)
        if t > plancher:
            return t.isoformat()
    return plancher.isoformat()


def battements() -> dict:
    return {h["job_name"]: h["last_run_at"] for h in rest("system_heartbeats", {"select": "job_name,last_run_at"})}


# --------------------------------------------------------------------------
# LES CONTRÔLES. Chacun correspond à une panne RÉELLEMENT survenue : c'est le
# critère d'admission. Un contrôle inventé « au cas où » produit du bruit,
# jamais une trouvaille.
# --------------------------------------------------------------------------


def c_generation(hb: dict) -> list[Constat]:
    """Le cycle de génération tourne toutes les 30 minutes."""
    h = heures_depuis(hb.get("signals"))
    if h > 3:
        return [
            Constat(
                "Le générateur de signaux ne tourne plus",
                f"Dernier passage il y a {h:.1f} h (attendu : toutes les 30 min).",
                "Vérifier le workflow « Signaux crypto » sur GitHub Actions. Aucun signal n'est produit pendant ce temps.",
            )
        ]
    return []


def c_moteurs(hb: dict) -> list[Constat]:
    """Chaque moteur laisse un battement quotidien, même quand il décide de se taire."""
    constats = []
    for moteur in ("relative_strength", "carry_funding", "momentum_4h"):
        h = heures_depuis(hb.get(moteur))
        if h > 30:
            constats.append(
                Constat(
                    f"Le moteur {moteur} n'a pas tourné depuis {h:.0f} h",
                    "Le battement est écrit MÊME quand le moteur choisit de ne rien émettre. "
                    "Son absence ne veut donc pas dire « marché calme » : elle veut dire que le passage n'a pas eu lieu.",
                    "Lire le journal du dernier run de signals.yml pour ce moteur.",
                )
            )
    return constats


def c_livraison() -> list[Constat]:
    """
    Un signal marqué envoyé et reçu par personne.

    C'est LA panne du 10/08 : la légende de photo dépassait la limite de 1024
    caractères, Telegram refusait, l'erreur était attrapée par destinataire, et
    le signal passait quand même à `sent = true`. Les abonnés payants ne
    recevaient rien, en silence.
    """
    actifs = rest("users", {"select": "telegram_id", "expiration": f"gt.{MAINTENANT.isoformat()}", "limit": "1"})
    if not actifs:
        return []  # sans abonné actif, zéro livraison est le résultat correct

    depuis = (MAINTENANT - timedelta(hours=24)).isoformat()
    signaux = rest("signals", {"select": "id,pair,created_at", "sent": "eq.true", "created_at": f"gte.{depuis}"})
    muets = []
    for s in signaux:
        if heures_depuis(s["created_at"]) < 1:
            continue  # trop récent, la livraison peut être en cours
        livraisons = rest("signal_deliveries", {"select": "id", "signal_id": f"eq.{s['id']}", "limit": "1"})
        if not livraisons:
            muets.append(f"#{s['id']} {s['pair']}")
    if muets:
        return [
            Constat(
                "Signaux marqués envoyés, reçus par PERSONNE",
                f"{len(muets)} signal(aux) sans aucune livraison alors qu'un abonné actif existe : {', '.join(muets)}.",
                "C'est la panne la plus grave du produit : l'abonné paie et ne reçoit rien. "
                "Vérifier les journaux du Worker (wrangler tail) au moment de l'émission.",
            )
        ]
    return []


def c_clotures_publiees() -> list[Constat]:
    """
    Une clôture qui n'est jamais republiée sur le canal public.

    Le canal gratuit promet, dans sa description et dans chaque teaser, que
    TOUT signal y est republié à sa clôture. La clôture #26 a été perdue pour
    toujours le 10/08 parce qu'un refus d'espacement valait suppression.
    """
    depuis = (MAINTENANT - timedelta(days=4)).isoformat()
    clos = rest(
        "signals",
        {"select": "id,pair,evaluated_at", "outcome": "not.is.null", "sent_to_channel": "is.true", "evaluated_at": f"gte.{depuis}"},
    )
    posts = rest("channel_posts", {"select": "reference", "canal": "eq.public", "categorie": "eq.resultat", "sent_at": f"gte.{depuis}", "limit": "200"})
    publiees = {p["reference"] for p in posts if p.get("reference")}
    manquantes = [
        f"#{s['id']} {s['pair']}"
        for s in clos
        if f"cloture:{s['id']}" not in publiees and heures_depuis(s["evaluated_at"]) > 12
    ]
    if manquantes:
        return [
            Constat(
                "Clôtures jamais republiées sur le canal public",
                f"{', '.join(manquantes)} — clôturées il y a plus de 12 h, absentes de channel_posts.",
                "Le rattrapage (republierCloturesManquees) devrait les reprendre. S'il ne le fait pas, "
                "le canal gratuit ment sur sa promesse centrale : vérifier trackSignalOutcomes.",
            )
        ]
    return []


def c_verdicts_coherents(hb: dict) -> list[Constat]:
    """
    Une étiquette qui contredit son propre chiffre.

    Publié le 12/08 sur le canal public : « ❌ Signal clôturé — perdant / ACHAT
    TAO/USDT — sortie à 204.35 (+0.3%) ». Ce contrôle existe pour que ce genre
    de contradiction ne puisse plus jamais rester une semaine sans être vue.
    """
    depuis = depuis_dernier_passage(hb, 7)
    clos = rest(
        "signals",
        {
            "select": "id,pair,type,entry_price,outcome,outcome_price,close_reason,tp1_price,tp1_hit_at",
            "outcome": "not.is.null",
            "evaluated_at": f"gte.{depuis}",
        },
    )
    incoherents = []
    for s in clos:
        if s.get("outcome_price") is None:
            continue
        entree, sortie = float(s["entry_price"]), float(s["outcome_price"])
        pnl = (sortie - entree) / entree * 100 if s["type"] == "BUY" else (entree - sortie) / entree * 100
        if s["outcome"] == "LOSS" and pnl > 0.05:
            incoherents.append(f"#{s['id']} {s['pair']} : « perdant » alors que le trade rend {pnl:+.2f} %")
        if s["outcome"] == "WIN" and pnl < -0.05 and not s.get("tp1_hit_at"):
            incoherents.append(f"#{s['id']} {s['pair']} : « gagnant » alors que le trade perd {pnl:+.2f} % sans TP1")
        # « Objectif atteint » alors que la sortie est du mauvais côté de TP1.
        if s.get("close_reason") == "tp_hit" and s.get("tp1_price"):
            tp1 = float(s["tp1_price"])
            rate = sortie < tp1 if s["type"] == "BUY" else sortie > tp1
            if rate:
                incoherents.append(f"#{s['id']} {s['pair']} : motif « objectif atteint » mais sortie {sortie} hors de TP1 {tp1}")
    if incoherents:
        return [
            Constat(
                "Le relevé publié se contredit",
                "\n".join(f"• {i}" for i in incoherents),
                "Ces lignes sont publiées telles quelles sur le canal public et comptées dans les "
                "statistiques du site. Corriger trackSignalOutcomes AVANT la prochaine clôture.",
            )
        ]
    return []


"""
Volume quotidien en dessous duquel un marché n'est plus exécutable.

CALIBRÉ SUR LE DÉGÂT RÉEL, pas sur une intuition. Le premier seuil était à
5 M$ et a immédiatement signalé VET/USDT à 2,9 M$ — or un abonné qui engage
quelques centaines d'euros représente là 0,02 % du volume quotidien : il
exécute sans rien déplacer. C'était une fausse alerte, c'est-à-dire exactement
le bruit que cette sentinelle existe pour éviter.

Les vrais marchés morts trouvés le 14/08 étaient trois ordres de grandeur plus
bas : EOS à 6 007 $ et MKR à 76 648 $. Un million sépare proprement
« intradable » de « simplement mince », et laisse VET tranquille.
"""
SEUIL_VOLUME_MORT_USD = 1_000_000


def univers_tradable() -> set[str]:
    """
    Les paires que le générateur PEUT signaler, lues dans signals/config.py.

    La sentinelle tourne dans le dépôt (GitHub Actions le clone) : la source de
    vérité est donc à portée de lecture, et il serait absurde d'en tenir une
    copie qui divergerait. Le fichier est lu au texte plutôt qu'importé —
    importer config.py exécuterait son chargement d'environnement et ses
    dépendances, dont la sentinelle n'a aucun besoin.

    En cas d'échec de lecture, on rend un ensemble vide : le contrôle se
    rabattra sur les seules positions ouvertes. Mieux vaut surveiller moins que
    faire échouer la sentinelle entière sur un détail de chemin.
    """
    import re

    chemin = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "signals", "config.py")
    try:
        texte = open(chemin, encoding="utf-8").read()
    except OSError:
        return set()
    bloc = re.search(r"^PAIRS = \{(.*?)^\}", texte, re.S | re.M)
    if not bloc:
        return set()
    return {p for p, _ in re.findall(r'"([A-Z0-9]+/USDT)":\s*"([a-z0-9-]+)"', bloc.group(1))}


def c_liquidite_univers() -> list[Constat]:
    """
    Une paire de l'univers est-elle devenue intradable ?

    Trouvé le 14/08/2026 en remontant une position bloquée : MKR/USDT n'avait
    plus que 76 648 $ de volume sur 24 h et EOS/USDT 6 007 $, contre une
    MÉDIANE d'univers à 49 millions. Quatre ordres de grandeur en dessous.

    MKR avait par ailleurs été délisté par Coinbase, Kraken, Bybit et OKX —
    quatre plateformes vérifiées une à une. Ce qui l'a fait remonter, c'est sa
    position qui ne pouvait plus se clôturer faute de source de prix.

    Mais la panne de prix n'était que le SYMPTÔME. Le vrai défaut était de
    signaler ces paires : un abonné à qui l'on annonce un achat sur un marché à
    6 000 $ de volume quotidien ne peut pas exécuter le trade — il n'y a pas de
    contrepartie, et sa propre taille déplacerait le prix. Le signal était
    injouable avant même d'être juste ou faux.

    La liste `config.PAIRS` n'avait jamais été revalidée depuis sa
    constitution. Une paire peut mourir et y rester indéfiniment ; ce contrôle
    est le seul endroit du système qui s'en apercevra.
    """
    # ON NE REGARDE QUE CE QUI PEUT ENCORE ÊTRE SIGNALÉ.
    #
    # La première version prenait aussi les paires signalées dans les 14 jours
    # écoulés. MKR a donc continué d'être alertée toutes les six heures APRÈS
    # avoir été retirée de config.PAIRS et sa position fermée — quatre alertes
    # identiques et sans action possible en une journée, relevées le 15/08.
    #
    # C'est exactement le défaut que cette sentinelle existe pour éviter : une
    # alerte non actionnable, répétée, apprend à ignorer toutes les alertes.
    # Elle se l'était infligée à elle-même.
    #
    # La question utile n'est pas « avons-nous signalé une paire morte » mais
    # « POUVONS-NOUS encore en signaler une ». La réponse vit dans
    # signals/config.py, que ce script peut lire : il tourne dans le dépôt.
    univers = univers_tradable()
    ouverts = rest("signals", {"select": "pair", "outcome": "is.null", "limit": "100"})
    paires = sorted(univers | {s["pair"] for s in ouverts if s.get("pair")})
    if not paires:
        return []

    # CoinGecko n'est interrogé qu'avec les paires réellement utilisées : la
    # sentinelle n'a pas à connaître l'univers Python, qu'elle ne peut pas lire.
    ids = {
        "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "BNB": "binancecoin", "XRP": "ripple",
        "ADA": "cardano", "DOGE": "dogecoin", "AVAX": "avalanche-2", "DOT": "polkadot", "LINK": "chainlink",
        "POL": "polygon-ecosystem-token", "LTC": "litecoin", "SHIB": "shiba-inu", "UNI": "uniswap",
        "ATOM": "cosmos", "NEAR": "near", "APT": "aptos", "ARB": "arbitrum", "OP": "optimism", "SUI": "sui",
        "FET": "fetch-ai", "PEPE": "pepe", "RENDER": "render-token", "INJ": "injective-protocol",
        "TIA": "celestia", "TAO": "bittensor", "STX": "blockstack", "FIL": "filecoin", "VET": "vechain",
        "ALGO": "algorand", "ICP": "internet-computer", "ETC": "ethereum-classic", "HBAR": "hedera-hashgraph",
        "XLM": "stellar", "AAVE": "aave", "MKR": "maker", "GRT": "the-graph", "SAND": "the-sandbox",
        "EOS": "eos", "CHZ": "chiliz",
    }
    connues = {p: ids[p.split("/")[0]] for p in paires if p.split("/")[0] in ids}
    if not connues:
        return []

    url = (
        "https://api.coingecko.com/api/v3/simple/price?ids="
        + urllib.parse.quote(",".join(sorted(set(connues.values()))))
        + "&vs_currencies=usd&include_24hr_vol=true"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "crypto-signals-bot"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())

    morts = []
    for paire, cg in connues.items():
        volume = (data.get(cg) or {}).get("usd_24h_vol")
        if volume is not None and volume < SEUIL_VOLUME_MORT_USD:
            morts.append(f"{paire} ({volume:,.0f} $/24 h)".replace(",", " "))
    if morts:
        return [
            Constat(
                "Des paires signalées sont devenues intradables",
                "\n".join(f"• {m}" for m in morts),
                f"Sous {SEUIL_VOLUME_MORT_USD:,} $ de volume quotidien, un abonné ne peut pas exécuter le trade : "
                "il n'y a pas de contrepartie et sa propre taille déplacerait le prix. "
                "Retirer ces paires de signals/config.py::PAIRS.".replace(",", " "),
            )
        ]
    return []


def c_positions_bloquees() -> list[Constat]:
    """
    Une position qui a dépassé son échéance sans se fermer.

    C'est la trace commune de toute une famille de pannes, et elle a été
    trouvée DEUX FOIS le 14/08/2026 :

      - ICP, TAO et POL n'avaient plus aucune source de prix, parce que Kraken
        les cote en USD et que le client ne demandait que la cotation USDT ;
      - les DIX carrys ouverts ne pouvaient pas se clôturer, parce que Binance
        bloque les IP d'hébergeur sur son API futures et que le seul repli
        prévu était un miroir du même service.

    Dans les deux cas le journal disait poliment « clôture reportée au prochain
    cycle », indéfiniment, et rien ne remontait. Ce contrôle ne dépend d'aucune
    cause particulière : il regarde le seul fait qui compte — la position est
    restée ouverte au-delà de la durée annoncée à l'abonné.
    """
    seuil = (MAINTENANT - timedelta(hours=12)).isoformat()
    bloquees = rest(
        "signals",
        {
            "select": "id,pair,engine,hold_until",
            "outcome": "is.null",
            "hold_until": f"lt.{seuil}",
            "limit": "50",
        },
    )
    if not bloquees:
        return []
    detail = ", ".join(f"#{s['id']} {s['pair']} ({s.get('engine') or '?'})" for s in bloquees[:12])
    return [
        Constat(
            "Des positions ont dépassé leur échéance sans se clôturer",
            f"{len(bloquees)} position(s) ouverte(s) plus de 12 h après la date annoncée : {detail}.",
            "Presque toujours une source de prix ou de financement muette. Lire les journaux du Worker "
            "(wrangler tail) : le message « Aucune source de prix disponible » ou « financement "
            "indisponible » nomme la paire en cause. L'abonné, lui, attend une sortie qui ne vient pas.",
        )
    ]


def c_paiements() -> list[Constat]:
    """L'argent : le scan avance, le pool d'adresses n'est pas vide, rien ne reste en attente."""
    constats = []

    etat = rest("chain_state", {"select": "key,value", "key": "eq.last_processed_block_usdt_transfers"})
    if not etat:
        constats.append(
            Constat(
                "Le scan des paiements USDT n'a aucune position enregistrée",
                "chain_state.last_processed_block_usdt_transfers est absent.",
                "Aucun paiement USDT ne peut être détecté. C'est le moyen de paiement que /subscribe recommande.",
            )
        )

    libres = rest("litecoin_address_pool", {"select": "address", "used": "eq.false", "limit": "5"})
    if len(libres) < 3:
        constats.append(
            Constat(
                "Le pool d'adresses Litecoin est presque vide",
                f"{len(libres)} adresse(s) libre(s).",
                "Réapprovisionner avant qu'un paiement Litecoin ne trouve plus d'adresse à attribuer.",
            )
        )

    seuil = (MAINTENANT - timedelta(hours=48)).isoformat()
    vieux = rest("pending_payments", {"select": "id,method,created_at", "status": "eq.pending", "created_at": f"lt.{seuil}"})
    if vieux:
        constats.append(
            Constat(
                "Des paiements sont en attente depuis plus de 48 h",
                f"{len(vieux)} commande(s) : {', '.join(str(p['id']) for p in vieux[:10])}.",
                "Soit la personne n'a jamais payé (à purger), soit elle a payé sans être détectée — "
                "et dans ce second cas elle attend son accès depuis deux jours.",
            )
        )
    return constats


def c_heures_calmes(hb: dict) -> list[Constat]:
    """
    Aucune publication de canal entre 23 h et 7 h UTC.

    Le canal public a publié des clôtures à 04:25, 04:50 et 04:30 heure de
    Paris les 12 et 13/08 : ce chemin ne consultait pas les heures calmes.
    """
    depuis = depuis_dernier_passage(hb, 2)
    posts = rest("channel_posts", {"select": "canal,categorie,reference,sent_at", "sent_at": f"gte.{depuis}", "limit": "200"})
    nuit = []
    for p in posts:
        heure = datetime.fromisoformat(p["sent_at"].replace("Z", "+00:00")).astimezone(timezone.utc).hour
        if heure >= 23 or heure < 7:
            nuit.append(f"{p['canal']}/{p['categorie']} ({p.get('reference') or '—'}) à {heure:02d} h UTC")
    if nuit:
        return [
            Constat(
                "Publication pendant les heures calmes",
                "\n".join(f"• {n}" for n in nuit),
                "Un canal qui notifie en pleine nuit se fait couper les notifications, puis quitter. "
                "Identifier le diffuseur qui ne consulte pas isQuietHours().",
            )
        ]
    return []


def c_doublons(hb: dict) -> list[Constat]:
    """Deux publications portant la même référence : le même message envoyé deux fois."""
    depuis = (MAINTENANT - timedelta(days=3)).isoformat()
    posts = rest("channel_posts", {"select": "canal,reference,sent_at", "sent_at": f"gte.{depuis}", "limit": "300"})

    # LA JOURNÉE FAIT PARTIE DE LA CLÉ, et l'oublier rendait ce contrôle faux.
    #
    # Sa première version comptait les références sur trois jours et signalait
    # « public/pedagogie x 3, vip/briefing x 3, public/digest x 3 ». Ce ne sont
    # pas des doublons : ce sont les rendez-vous QUOTIDIENS du produit, qui
    # portent volontairement la même référence chaque jour. La sentinelle
    # aurait donc crié tous les jours sur le fonctionnement normal — le plus
    # sûr moyen de se faire ignorer le jour où elle a raison.
    #
    # Un vrai doublon, c'est le même message deux fois DANS LA MÊME JOURNÉE.
    vus: dict[tuple, int] = {}
    for p in posts:
        if not p.get("reference"):
            continue
        jour = p["sent_at"][:10]
        cle = (p["canal"], p["reference"], jour)
        vus[cle] = vus.get(cle, 0) + 1
    doublons = [f"{c}/{r} le {j} × {n}" for (c, r, j), n in vus.items() if n > 1]
    if doublons:
        return [
            Constat(
                "Le même message a été publié plusieurs fois",
                "\n".join(f"• {d}" for d in doublons),
                "Le garde-fou d'unicité de channelBudget n'a pas joué. Vérifier enregistrerEnvoi.",
            )
        ]
    return []


def c_cycle_de_vie() -> list[Constat]:
    """Un abonnement expiré doit RÉELLEMENT fermer l'accès au canal VIP."""
    seuil = (MAINTENANT - timedelta(hours=48)).isoformat()
    expires = rest("users", {"select": "telegram_id,expiration,vip_removed", "expiration": f"lt.{seuil}", "vip_removed": "is.false", "limit": "20"})
    # vip_until renseigné signifie que l'accès VIP avait été accordé ; sans lui,
    # il n'y a rien à retirer et le drapeau à faux est normal.
    concernes = [u for u in expires if u.get("expiration")]
    if concernes:
        return [
            Constat(
                "Des accès VIP n'ont pas été retirés après expiration",
                f"{len(concernes)} compte(s) expiré(s) depuis plus de 48 h avec vip_removed = false.",
                "Vérifier revokeExpiredVip. Un accès payant qui ne se ferme jamais rend l'abonnement facultatif.",
            )
        ]
    return []


def c_canaux_vivants(hb: dict) -> list[Constat]:
    """Les rendez-vous quotidiens des deux canaux."""
    constats = []
    for job, libelle in (("vip_briefing", "briefing VIP"), ("selectivity_digest", "bilan de sélectivité")):
        h = heures_depuis(hb.get(job))
        if h > 30:
            constats.append(
                Constat(
                    f"Le {libelle} n'est pas parti depuis {h:.0f} h",
                    "Attendu une fois par jour.",
                    "Le canal concerné est muet. Vérifier la tâche correspondante dans la chaîne */15 du Worker.",
                )
            )
    return constats


def c_ma_propre_fraicheur(hb: dict) -> list[Constat]:
    """
    La sentinelle se surveille elle-même.

    Sans ça, « aucune alerte » et « plus personne ne surveille » se ressemblent
    — la confusion exacte qui a coûté sept jours de silence en août.
    """
    h = heures_depuis(hb.get("sentinelle"))
    if 36 < h < 1e8:
        return [
            Constat(
                "La sentinelle elle-même a manqué des passages",
                f"Passage précédent il y a {h:.0f} h (attendu : quotidien).",
                "Vérifier le workflow sentinelle.yml. Pendant cette absence, aucun des contrôles ci-dessus n'a eu lieu.",
            )
        ]
    return []


def envoyer(constats: list[Constat], essais: int = 4) -> None:
    entete = f"🛡️ *Sentinelle — {len(constats)} anomalie(s)*\n_{MAINTENANT.strftime('%d/%m/%Y %H:%M')} UTC_"
    blocs = [f"*{c.titre}*\n{c.detail}\n➡️ {c.quoi_faire}" for c in constats]
    texte = entete + "\n\n" + "\n\n".join(blocs)
    # Markdown legacy : un seul caractère de mise en forme non apparié fait
    # REJETER tout le message. Les détails viennent de la base et peuvent
    # contenir n'importe quoi, on envoie donc en texte brut.
    corps = json.dumps({"chat_id": ADMIN_ID, "text": texte.replace("*", "").replace("_", "")}).encode()
    # Une sentinelle dont l'alerte se perd sur un hoquet reseau ne sert a rien :
    # c'est le SEUL message qu'elle produit de toute la journee.
    derniere = None
    for tentative in range(essais):
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                data=corps,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=30).read()
            return
        except Exception as err:  # noqa: BLE001
            derniere = err
            if tentative < essais - 1:
                import time

                time.sleep(2 * (tentative + 1))
    raise RuntimeError(f"Alerte non delivree apres {essais} tentatives : {derniere}")


def main() -> int:
    if not (SUPABASE_URL and SUPABASE_KEY and BOT_TOKEN and ADMIN_ID):
        print("Configuration incomplète : SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_ID requis.")
        return 1

    hb = battements()
    constats: list[Constat] = []

    # Chaque contrôle est isolé : l'échec de l'un ne doit pas emporter les
    # autres. Un contrôle qui casse devient lui-même un constat — sans quoi la
    # sentinelle se tairait sur une panne qu'elle n'a pas su regarder.
    controles = [
        ("génération", lambda: c_generation(hb)),
        ("moteurs", lambda: c_moteurs(hb)),
        ("livraison", c_livraison),
        ("clôtures publiées", c_clotures_publiees),
        ("cohérence des verdicts", lambda: c_verdicts_coherents(hb)),
        ("positions bloquees", c_positions_bloquees),
        ("liquidite de l univers", c_liquidite_univers),
        ("paiements", c_paiements),
        ("heures calmes", lambda: c_heures_calmes(hb)),
        ("doublons", lambda: c_doublons(hb)),
        ("cycle de vie", c_cycle_de_vie),
        ("canaux vivants", lambda: c_canaux_vivants(hb)),
        ("fraîcheur de la sentinelle", lambda: c_ma_propre_fraicheur(hb)),
    ]

    for nom, fn in controles:
        try:
            trouves = fn()
            print(f"[{nom}] {len(trouves)} anomalie(s)")
            constats.extend(trouves)
        except Exception as err:  # noqa: BLE001 — on veut vraiment tout attraper
            print(f"[{nom}] ERREUR : {err}")
            constats.append(
                Constat(
                    f"Le contrôle « {nom} » n'a pas pu s'exécuter",
                    str(err)[:300],
                    "Une capacité n'est donc PAS surveillée en ce moment. Corriger ops/sentinelle.py.",
                )
            )

    try:
        ecrire_battement()
    except Exception as err:  # noqa: BLE001
        print(f"[battement] ERREUR : {err}")

    if constats:
        # Le rapport est TOUJOURS écrit sur la sortie standard, envoi ou pas :
        # le journal du run GitHub Actions doit suffire à comprendre, sans
        # avoir à rouvrir Telegram.
        for c in constats:
            print(f"\n--- {c.titre}\n{c.detail}\n-> {c.quoi_faire}")
        if "--essai" in sys.argv:
            print(f"\n[essai] {len(constats)} anomalie(s) — aucun message envoyé.")
            return 0
        envoyer(constats)
        print(f"\n{len(constats)} anomalie(s) signalée(s) à l'administrateur.")
    else:
        print("\nTout est vert. Aucun message envoyé — le battement de cœur en est la preuve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
