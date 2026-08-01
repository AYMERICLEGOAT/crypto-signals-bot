"""
Référencement du canal public dans les annuaires Telegram (audit 8.4).

Contexte : le projet n'a qu'un seul vrai utilisateur, et deux de ses trois
canaux d'acquisition sont à l'arrêt faute de clés API. Les annuaires
Telegram sont le seul levier d'acquisition restant qui soit gratuit,
durable, et qui ne dépende d'aucun identifiant à obtenir — un canal
référencé y reste visible et remonte dans les recherches par thématique.

Ce module ne triche pas et n'automatise aucune soumission derrière un
CAPTCHA ou un formulaire authentifié : ce serait à la fois contraire aux
conditions d'utilisation de ces sites et voué à casser. Il fait deux choses
utiles et honnêtes :

  1. Vérifier que le canal est réellement prêt à être soumis (public,
     accessible, avec une description et un nombre d'abonnés visibles) —
     un canal soumis alors qu'il est vide ou mal décrit est simplement
     rejeté, ou pire, indexé sous une mauvaise description.
  2. Produire le dossier de soumission complet (titre, description courte
     et longue, catégories, mots-clés) et la liste des annuaires avec leur
     mode de soumission, pour que l'opération prenne quelques minutes au
     lieu d'une heure de rédaction.

Usage : python directory_submit.py
"""

import json
import os
import sys

import requests

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHANNEL = os.getenv("TELEGRAM_CHANNEL_USERNAME", "@ProSignauxPublic")
BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "ProVIPSignals_bot")
SITE_URL = os.getenv("SITE_BASE_URL", "https://crypto-signals-bot-site.signalytics.workers.dev")

# Annuaires réellement pertinents pour un canal crypto francophone.
# "mode" décrit honnêtement ce qui est possible : aucun n'accepte de
# soumission programmatique anonyme.
DIRECTORIES = [
    {
        "nom": "TGStat",
        "url": "https://tgstat.com/channel/add",
        "mode": "Formulaire web, compte requis",
        "note": "Le plus consulté. Indexe automatiquement beaucoup de canaux : "
                "vérifier d'abord si le canal y est déjà via la recherche.",
    },
    {
        "nom": "Telemetr.io",
        "url": "https://telemetr.io/en/add-channel",
        "mode": "Formulaire web",
        "note": "Bonne visibilité analytique, apprécié des annonceurs.",
    },
    {
        "nom": "Telegram Channels (tlgrm.eu)",
        "url": "https://tlgrm.eu/channels",
        "mode": "Formulaire web",
        "note": "Catalogue européen, catégorie Crypto/Finance.",
    },
    {
        "nom": "Telegramme.fr",
        "url": "https://telegramme.fr",
        "mode": "Formulaire web",
        "note": "Annuaire francophone — pertinent, le contenu est en français.",
    },
    {
        "nom": "Combot / Telegram Directory",
        "url": "https://combot.org/telegram/top/chats",
        "mode": "Indexation automatique",
        "note": "Aucune soumission : l'indexation vient de l'activité du canal.",
    },
]


def check_channel_ready() -> dict:
    """
    Vérifie via l'API Telegram que le canal est en état d'être soumis.
    Un canal sans description ou sans abonnés est rejeté par la plupart des
    annuaires — autant le savoir avant de remplir cinq formulaires.
    """
    if not BOT_TOKEN:
        return {"ok": False, "raison": "TELEGRAM_BOT_TOKEN absent de l'environnement."}
    try:
        chat = requests.get(
            f"https://api.telegram.org/bot{BOT_TOKEN}/getChat",
            params={"chat_id": CHANNEL}, timeout=15,
        ).json()
        if not chat.get("ok"):
            return {"ok": False, "raison": f"getChat a échoué : {chat.get('description')}"}
        info = chat["result"]

        count = requests.get(
            f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMemberCount",
            params={"chat_id": CHANNEL}, timeout=15,
        ).json()

        return {
            "ok": True,
            "titre": info.get("title", ""),
            "username": info.get("username", ""),
            "description": info.get("description", "") or "",
            "abonnes": count.get("result") if count.get("ok") else None,
        }
    except Exception as exc:
        return {"ok": False, "raison": f"Appel API impossible : {exc}"}


def submission_kit() -> dict:
    """Textes prêts à coller dans les formulaires. Aucune promesse de gain :
    la description doit être défendable si un annuaire la vérifie, et
    cohérente avec ce qu'annoncent le site et la commande /faq."""
    return {
        "titre": "Signaux Crypto Gratuits — analyse technique automatisée",
        "description_courte": (
            "Signaux crypto automatiques avec entrée, stop loss et objectifs définis à l'avance. "
            "Tous les résultats publiés, gains comme pertes."
        ),
        "description_longue": (
            "Canal public de signaux de trading crypto générés automatiquement par analyse "
            "technique (croisement EMA + RSI) sur 40 paires.\n\n"
            "Chaque signal indique le prix d'entrée, le stop loss et trois objectifs, définis "
            "AVANT l'ouverture de la position. Le suivi est automatique jusqu'à la clôture.\n\n"
            "Particularité : tous les résultats sont publiés, y compris les pertes. Le code du "
            "projet est public et les statistiques réelles sont consultables en ligne.\n\n"
            "Contenu quotidien gratuit : posts pédagogiques, indice Fear & Greed, anecdotes crypto.\n\n"
            "Ce canal ne constitue pas un conseil en investissement. Le trading de cryptoactifs "
            "comporte un risque de perte en capital."
        ),
        "categories": ["Cryptomonnaies", "Finance", "Trading", "Éducation"],
        "mots_cles": [
            "signaux crypto", "trading crypto", "analyse technique", "bitcoin",
            "ethereum", "crypto français", "stop loss", "take profit",
        ],
        "langue": "Français",
        "lien_canal": f"https://t.me/{CHANNEL.lstrip('@')}",
        "lien_bot": f"https://t.me/{BOT_USERNAME}",
        "site": SITE_URL,
    }


def main() -> int:
    print("=" * 66)
    print("RÉFÉRENCEMENT DU CANAL DANS LES ANNUAIRES TELEGRAM")
    print("=" * 66)

    state = check_channel_ready()
    print("\n[1] État du canal")
    if not state["ok"]:
        print(f"    ⚠️  {state['raison']}")
        print("    Le dossier ci-dessous reste utilisable, mais vérifie l'accès au canal.")
    else:
        print(f"    Titre       : {state['titre']}")
        print(f"    Username    : @{state['username']}")
        print(f"    Abonnés     : {state['abonnes']}")
        desc = state["description"]
        print(f"    Description : {'(VIDE)' if not desc else desc[:70]}")
        problems = []
        if not state["username"]:
            problems.append("le canal doit être PUBLIC (username obligatoire)")
        if not desc:
            problems.append("description vide — la plupart des annuaires refusent")
        if (state["abonnes"] or 0) < 10:
            problems.append(
                f"seulement {state['abonnes']} abonné(s) : plusieurs annuaires exigent un "
                "minimum (souvent 10 à 50). Soumettre trop tôt fait perdre la candidature."
            )
        if problems:
            print("\n    À corriger avant de soumettre :")
            for p in problems:
                print(f"      - {p}")
        else:
            print("    ✅ Prêt à être soumis.")

    kit = submission_kit()
    print("\n[2] Dossier de soumission (à copier-coller)")
    print(f"    Titre    : {kit['titre']}")
    print(f"    Courte   : {kit['description_courte']}")
    print(f"    Langue   : {kit['langue']}")
    print(f"    Liens    : {kit['lien_canal']} | {kit['lien_bot']} | {kit['site']}")
    print(f"    Catégories : {', '.join(kit['categories'])}")
    print(f"    Mots-clés  : {', '.join(kit['mots_cles'])}")
    print("\n    Description longue :")
    for line in kit["description_longue"].split("\n"):
        print(f"      {line}")

    print("\n[3] Où soumettre")
    for d in DIRECTORIES:
        print(f"    • {d['nom']:32s} {d['url']}")
        print(f"      {d['mode']} — {d['note']}")

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "directory_kit.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"canal": state, "dossier": kit, "annuaires": DIRECTORIES}, f,
                  ensure_ascii=False, indent=2)
    print(f"\n[4] Dossier complet écrit dans {out}")
    print("\nAucune soumission n'est automatisée : ces sites exigent un compte et")
    print("un formulaire. Les automatiser violerait leurs conditions d'utilisation")
    print("et casserait au premier changement de page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
