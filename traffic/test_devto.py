# -*- coding: utf-8 -*-
"""
Ce qui doit être vrai du publieur Dev.to avant qu'il touche une API publique.

Le risque n'est pas qu'il plante : c'est qu'il republie. Un fil qui repost les
mêmes textes est exactement ce que les plateformes appellent du spam, et c'est
ce qui fait fermer un compte — en emportant le levier d'acquisition avec lui.

Aucun de ces tests n'appelle Dev.to.
"""

import sys
import types

import pytest

import devto_publisher
from devto_articles import ARTICLES, SITE, CTA


# --- Le catalogue lui-même ---------------------------------------------------

def test_aucun_slug_en_double():
    # Deux articles de même slug rendraient l'historique inutilisable : le
    # second serait considéré comme déjà publié et ne sortirait jamais.
    slugs = [a["slug"] for a in ARTICLES]
    assert len(slugs) == len(set(slugs))


@pytest.mark.parametrize("article", ARTICLES, ids=[a["slug"] for a in ARTICLES])
def test_chaque_article_a_une_url_canonique_vers_le_site(article):
    # Sans canonical_url, l'article concurrence le site sur ses propres
    # mots-clés au lieu de le renforcer — l'inverse de l'objectif.
    assert article["canonical_url"].startswith(SITE)


@pytest.mark.parametrize("article", ARTICLES, ids=[a["slug"] for a in ARTICLES])
def test_chaque_article_porte_l_appel_a_l_action(article):
    assert CTA.strip()[:40] in article["body"]


@pytest.mark.parametrize("article", ARTICLES, ids=[a["slug"] for a in ARTICLES])
def test_pas_plus_de_quatre_tags(article):
    # Dev.to en refuse davantage : l'article entier serait rejeté.
    assert 1 <= len(article["tags"]) <= 4


@pytest.mark.parametrize("article", ARTICLES, ids=[a["slug"] for a in ARTICLES])
def test_aucune_promesse_de_gain(article):
    # Le projet s'interdit ces formulations partout ailleurs ; un article
    # public ne fait pas exception, et c'est aussi ce qui garde le compte
    # ouvert sur la plateforme.
    interdits = ["gain garanti", "sans risque", "argent facile", "devenez riche", "profit garanti"]
    corps = article["body"].lower()
    for mot in interdits:
        assert mot not in corps, f"formulation interdite : {mot}"


# --- La sélection ------------------------------------------------------------

def _stub_historique(monkeypatch, slugs):
    monkeypatch.setattr(
        devto_publisher.supabase_client,
        "get_posted_content",
        lambda plateforme, limit=500: [{"target": s} for s in slugs],
    )


def test_le_premier_passage_prend_le_premier_article(monkeypatch):
    _stub_historique(monkeypatch, [])
    assert devto_publisher.choisir_article()["slug"] == ARTICLES[0]["slug"]


def test_un_article_deja_publie_n_est_jamais_repris(monkeypatch):
    _stub_historique(monkeypatch, [ARTICLES[0]["slug"]])
    assert devto_publisher.choisir_article()["slug"] == ARTICLES[1]["slug"]


def test_catalogue_epuise_ne_republie_RIEN(monkeypatch):
    # Le comportement qui fait fermer un compte. Il doit s'arrêter, pas boucler.
    _stub_historique(monkeypatch, [a["slug"] for a in ARTICLES])
    assert devto_publisher.choisir_article() is None


def test_historique_illisible_annule_la_publication(monkeypatch):
    # Publier sans savoir ce qui est déjà sorti risque un doublon PUBLIC.
    # Ne rien faire est ici strictement préférable à réessayer.
    def explose(plateforme, limit=500):
        raise RuntimeError("Supabase injoignable")

    monkeypatch.setattr(devto_publisher.supabase_client, "get_posted_content", explose)
    with pytest.raises(RuntimeError):
        devto_publisher.choisir_article()


# --- Les refus ---------------------------------------------------------------

def test_sans_cle_api_on_refuse_de_publier(monkeypatch):
    monkeypatch.setattr(devto_publisher, "DEVTO_API_KEY", "")
    with pytest.raises(RuntimeError, match="DEVTO_API_KEY"):
        devto_publisher.publier(ARTICLES[0])


def test_sans_url_canonique_on_refuse_de_publier(monkeypatch):
    monkeypatch.setattr(devto_publisher, "DEVTO_API_KEY", "cle-de-test")
    article = dict(ARTICLES[0], canonical_url="")
    with pytest.raises(RuntimeError, match="canonical_url"):
        devto_publisher.publier(article)
