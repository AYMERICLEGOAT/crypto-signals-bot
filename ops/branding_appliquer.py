#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Applique l'identité Telegram : titres, descriptions, photos de profil.

CE QUE L'API BOT PERMET, ET CE QU'ELLE NE PERMET PAS — vérifié, pas supposé :

  setChatTitle / setChatDescription / setChatPhoto  ->  OK sur un canal où le
      bot est administrateur avec `can_change_info`. C'est le cas des deux
      canaux du projet.
  setMyName / setMyDescription / setMyShortDescription  ->  OK, le bot peut
      changer son propre nom et ses textes.
  PHOTO DE PROFIL DU BOT  ->  IMPOSSIBLE par l'API. Seul BotFather peut la
      poser, à la main. Le fichier est produit quand même, prêt à être envoyé.
  CRÉER UN CANAL  ->  IMPOSSIBLE par l'API. Un bot ne peut pas créer de canal ;
      il faut un compte utilisateur.

LES TEXTES SONT ICI, EN VERSIONNÉ, et pas seulement dans Telegram. Une
description de canal est une promesse commerciale : elle doit pouvoir être
relue, comparée au produit réel et corrigée quand le produit change — comme
n'importe quelle autre affirmation publique de ce projet
(voir OPS_REGISTRES.md, registre 2).

Usage : python ops/branding_appliquer.py [--essai]
"""

from __future__ import annotations

import io
import json
import mimetypes
import os
import sys
import time
import urllib.request
import uuid

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANDING = os.path.join(os.path.dirname(os.path.abspath(__file__)), "branding")

# Limites Telegram, vérifiées côté API : dépasser fait échouer l'appel entier.
MAX_TITRE = 128
MAX_DESCRIPTION_CANAL = 255
MAX_DESCRIPTION_BOT = 512
MAX_DESCRIPTION_COURTE = 120


CANAUX = {
    "public": {
        "chat_id": "-1004450068761",
        "titre": "Signaux Crypto Gratuits 📊",
        # POURQUOI CE TITRE PLUTÔT QUE LA MARQUE. Ce canal a un seul rôle :
        # faire venir des inconnus. La recherche Telegram classe sur les mots
        # du titre, et « signaux crypto gratuits » est exactement ce qu'un
        # francophone tape. Mettre « ProSignaux » devant échangerait la seule
        # chose qui amène du monde contre un nom qui ne dit encore rien à
        # personne. La marque vit dans le handle, présent dans chaque message.
        "description": (
            "Signaux crypto gratuits, publiés en clair.\n"
            "Chaque signal est republié ici à sa clôture — gagnant OU perdant, sans exception.\n"
            "Stratégie automatique, mesurée et chiffrée, réserves comprises.\n"
            "Essai VIP 3 jours 👉 @ProVIPSignals_bot"
        ),
        # ÉCART ASSUMÉ AVEC LA DEMANDE INITIALE. Le texte proposé disait
        # « validé sur 6 ans de backtests ». Six ans est exact pour la famille
        # directionnelle (août 2020 – août 2026), mais le SEUL moteur qui
        # tourne aujourd'hui est mesuré sur 730 jours. Annoncer six ans pendant
        # qu'un moteur de deux ans produit les signaux, c'est le genre de
        # demi-vérité que ce projet passe son temps à retirer. La formule
        # retenue dit ce qui est vrai sans rien perdre en force — et elle met
        # devant la seule chose que la concurrence ne fait pas : publier les
        # pertes.
        "photo": os.path.join(BRANDING, "public.png"),
    },
    "vip": {
        "chat_id": "-1003935938125",
        "titre": "ProSignaux VIP 🔒",
        "description": (
            "Canal privé des abonnés ProSignaux.\n"
            "Signaux complets en temps réel, briefing quotidien du portefeuille, "
            "et chaque clôture annoncée ici avant le canal gratuit.\n"
            "L'accès se ferme à l'expiration de l'abonnement."
        ),
        "photo": os.path.join(BRANDING, "vip.png"),
    },
}

BOT = {
    "name": "ProSignaux Bot 🤖",
    "short_description": "Bot de signaux crypto transparents. Essai gratuit 3 jours.",
    # La description longue s'affiche sur l'écran VIDE, avant le premier
    # /start : c'est le seul texte qu'un visiteur lit avant de décider. Elle
    # dit donc ce qui se passe ensuite, et ce que le produit refuse de faire.
    "description": (
        "Signaux crypto automatiques, envoyés dès leur émission avec entrée, stop loss et objectifs.\n\n"
        "Ce qui distingue ce bot : chaque signal est republié sur le canal gratuit à sa clôture, "
        "gagnant ou perdant. Les chiffres publiés portent leur fenêtre de mesure et leurs réserves. "
        "Aucun résultat n'est retiré après coup.\n\n"
        "Essai gratuit de 3 jours, sans carte bancaire. Appuie sur Démarrer."
    ),
}


def charger_token() -> str:
    chemin = os.path.join(RACINE, "workers", "main-worker", ".dev.vars")
    for ligne in io.open(chemin, encoding="utf-8", errors="replace").read().splitlines():
        if ligne.startswith("TELEGRAM_BOT_TOKEN="):
            return ligne.split("=", 1)[1].strip()
    raise SystemExit("TELEGRAM_BOT_TOKEN introuvable")


TOKEN = charger_token()


def api(methode: str, charge: dict, essais: int = 3) -> dict:
    for i in range(essais):
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{TOKEN}/{methode}",
                data=json.dumps(charge).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return json.loads(e.read().decode())
        except Exception as err:
            if i == essais - 1:
                return {"ok": False, "description": f"reseau : {err}"}
            time.sleep(3)
    return {"ok": False}


def api_photo(chat_id: str, chemin: str, essais: int = 3) -> dict:
    """
    setChatPhoto exige un envoi multipart. Construit à la main : ajouter une
    dépendance HTTP pour un unique appel serait payer cher un confort.
    """
    frontiere = uuid.uuid4().hex
    nom = os.path.basename(chemin)
    type_mime = mimetypes.guess_type(nom)[0] or "image/png"
    contenu = open(chemin, "rb").read()

    corps = b""
    for cle, valeur in (("chat_id", str(chat_id)),):
        corps += f"--{frontiere}\r\nContent-Disposition: form-data; name=\"{cle}\"\r\n\r\n{valeur}\r\n".encode()
    corps += (
        f"--{frontiere}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"{nom}\"\r\n"
        f"Content-Type: {type_mime}\r\n\r\n"
    ).encode()
    corps += contenu + f"\r\n--{frontiere}--\r\n".encode()

    for i in range(essais):
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{TOKEN}/setChatPhoto",
                data=corps,
                headers={"Content-Type": f"multipart/form-data; boundary={frontiere}"},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return json.loads(e.read().decode())
        except Exception as err:
            if i == essais - 1:
                return {"ok": False, "description": f"reseau : {err}"}
            time.sleep(3)
    return {"ok": False}


def verifier_longueurs() -> list[str]:
    """Une limite dépassée fait échouer l'appel ENTIER : on le voit avant, pas après."""
    problemes = []
    for nom, c in CANAUX.items():
        if len(c["titre"]) > MAX_TITRE:
            problemes.append(f"{nom} : titre {len(c['titre'])} > {MAX_TITRE}")
        if len(c["description"]) > MAX_DESCRIPTION_CANAL:
            problemes.append(f"{nom} : description {len(c['description'])} > {MAX_DESCRIPTION_CANAL}")
    if len(BOT["description"]) > MAX_DESCRIPTION_BOT:
        problemes.append(f"bot : description {len(BOT['description'])} > {MAX_DESCRIPTION_BOT}")
    if len(BOT["short_description"]) > MAX_DESCRIPTION_COURTE:
        problemes.append(f"bot : description courte {len(BOT['short_description'])} > {MAX_DESCRIPTION_COURTE}")
    return problemes


def main() -> int:
    essai = "--essai" in sys.argv

    problemes = verifier_longueurs()
    for nom, c in CANAUX.items():
        print(f"[{nom}] titre {len(c['titre'])}/{MAX_TITRE}, description {len(c['description'])}/{MAX_DESCRIPTION_CANAL}")
    print(f"[bot] nom {len(BOT['name'])}, courte {len(BOT['short_description'])}/{MAX_DESCRIPTION_COURTE}, "
          f"longue {len(BOT['description'])}/{MAX_DESCRIPTION_BOT}")
    if problemes:
        for p in problemes:
            print("LIMITE DEPASSEE :", p)
        return 1
    if essai:
        print("\n[essai] longueurs valides, rien n'a ete envoye.")
        return 0

    print()
    for nom, c in CANAUX.items():
        for methode, charge in (
            ("setChatTitle", {"chat_id": c["chat_id"], "title": c["titre"]}),
            ("setChatDescription", {"chat_id": c["chat_id"], "description": c["description"]}),
        ):
            r = api(methode, charge)
            print(f"{nom:<8} {methode:<20} -> {'OK' if r.get('ok') else 'ECHEC : ' + str(r.get('description'))}")
        if os.path.exists(c["photo"]):
            r = api_photo(c["chat_id"], c["photo"])
            print(f"{nom:<8} {'setChatPhoto':<20} -> {'OK' if r.get('ok') else 'ECHEC : ' + str(r.get('description'))}")
        else:
            print(f"{nom:<8} setChatPhoto         -> fichier absent : {c['photo']}")

    print()
    for methode, cle in (("setMyName", "name"),
                         ("setMyShortDescription", "short_description"),
                         ("setMyDescription", "description")):
        r = api(methode, {cle: BOT[cle]})
        print(f"{'bot':<8} {methode:<20} -> {'OK' if r.get('ok') else 'ECHEC : ' + str(r.get('description'))}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
