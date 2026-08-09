# -*- coding: utf-8 -*-
"""
Publication hebdomadaire d'un article sur Dev.to.

CE QUE CE MODULE FAIT, ET CE QU'IL REFUSE DE FAIRE.

Il publie UN article par passage, choisi parmi ceux qui n'ont jamais été
publiés, et il enregistre la publication dans `posted_content` pour ne jamais
recommencer. Quand le catalogue est épuisé, il s'arrête proprement au lieu de
republier en boucle — un fil qui repost les mêmes textes est exactement ce que
les plateformes appellent du spam, et c'est ce qui fait fermer un compte.

`canonical_url` est OBLIGATOIRE sur chaque article, et le module refuse de
publier sans. C'est ce qui indique à Google que l'original est sur le site du
projet : sans cette balise, chaque article ferait concurrence au site sur ses
propres mots-clés au lieu de le renforcer, et le levier se retournerait contre
son objectif.

ÉCHOUER BRUYAMMENT. Une clé révoquée, un compte suspendu ou une API qui répond
401/403 lève une exception et fait échouer le workflow. Le module Discord de ce
projet avait le défaut inverse — « vert mais n'a rien fait » — et personne ne
s'en apercevait pendant des semaines.

Usage : python devto_publisher.py
"""

import json
import logging
import os
import sys
import urllib.error
import urllib.request

import supabase_client
from devto_articles import ARTICLES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

PLATEFORME = "devto"
API = "https://dev.to/api/articles"
DEVTO_API_KEY = os.getenv("DEVTO_API_KEY", "").strip()

# Dev.to limite les publications par créneau. Une par passage, un passage par
# semaine : on reste très en dessous, et la cadence ressemble à celle d'un
# humain qui écrit plutôt qu'à celle d'un script.
MAX_TAGS = 4


def _deja_publies():
    """Slugs déjà publiés, lus depuis posted_content (colonne `target`)."""
    try:
        lignes = supabase_client.get_posted_content(PLATEFORME, limit=500)
    except Exception:
        logger.exception("Lecture de l'historique impossible — publication ANNULÉE.")
        # Publier sans savoir ce qui est déjà sorti risque un doublon public.
        # Ne rien faire est ici strictement préférable.
        raise
    return {l.get("target") for l in lignes if l.get("target")}


def choisir_article():
    publies = _deja_publies()
    restants = [a for a in ARTICLES if a["slug"] not in publies]
    if not restants:
        logger.info(
            "Catalogue épuisé : %d article(s) déjà publié(s), aucun nouveau. "
            "Rien n'est republié — ajoute un article dans devto_articles.py.",
            len(publies),
        )
        return None
    return restants[0]


def publier(article):
    if not DEVTO_API_KEY:
        raise RuntimeError("DEVTO_API_KEY manquante : impossible de publier.")

    # Sans URL canonique, l'article ferait concurrence au site au lieu de le
    # renforcer. C'est la raison d'être du levier : on refuse plutôt que de
    # publier une version dégradée.
    if not article.get("canonical_url"):
        raise RuntimeError(f"Article {article['slug']} sans canonical_url : publication refusée.")

    charge = {
        "article": {
            "title": article["title"],
            "body_markdown": article["body"],
            "published": True,
            "tags": article["tags"][:MAX_TAGS],
            "canonical_url": article["canonical_url"],
        }
    }
    requete = urllib.request.Request(
        API,
        data=json.dumps(charge).encode("utf-8"),
        headers={
            "api-key": DEVTO_API_KEY,
            "Content-Type": "application/json",
            "User-Agent": "crypto-signals-bot/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(requete, timeout=30) as reponse:
            corps = json.load(reponse)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:500]
        # 401/403 = clé révoquée ou compte suspendu. 422 = article refusé.
        # Les trois sont définitifs : les taire produirait un workflow vert qui
        # ne publie plus rien pendant des mois.
        raise RuntimeError(f"Dev.to a répondu {err.code} : {detail}") from err

    url = corps.get("url", "")
    logger.info("Publié : %s -> %s", article["slug"], url)
    return url


def main():
    article = choisir_article()
    if article is None:
        return 0

    url = publier(article)

    # Enregistré APRÈS la publication réussie : en cas d'échec, l'article
    # reste candidat au prochain passage plutôt que d'être perdu.
    try:
        supabase_client.record_posted(PLATEFORME, None, target=article["slug"])
    except Exception:
        logger.exception(
            "Article publié (%s) mais enregistrement impossible. "
            "Il sera republié au prochain passage — À CORRIGER À LA MAIN.",
            url,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
