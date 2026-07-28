"""
Point d'entrée du générateur de contenu SEO.
À exécuter une fois par jour (planificateur de tâches, cron, ou manuellement) :

    python main.py

Étapes : évalue les résultats des signaux passés -> récupère les derniers
signaux -> génère les pages HTML (français + anglais) + archives du backtest
+ sitemap + robots.txt -> pousse le tout sur GitHub (Cloudflare Pages
redéploie automatiquement).

Le site n'est JAMAIS vide : tant qu'aucun signal réel n'existe, la page
d'accueil et les archives du backtest (données réelles, jamais inventées)
tiennent lieu de contenu, et sitemap.xml/robots.txt sont toujours publiés
(un sitemap absent pénaliserait le référencement pendant toute cette période).
"""

import json
import os
from datetime import datetime, timezone

from config import NUM_SIGNALS_TO_DISPLAY, DATA_DIR, PAGES_MANIFEST_PATH, OUTPUT_DIR, SITE_BASE_URL, TELEGRAM_BOT_USERNAME
import supabase_client
import outcome_evaluator
from html_generator import build_daily_page
from archives_generator import build_archives_page, build_waiting_homepage
from transparency_generator import build_transparency_page
from sitemap_generator import build_sitemap, build_robots_txt
import github_publisher


def _load_manifest():
    if os.path.exists(PAGES_MANIFEST_PATH):
        with open(PAGES_MANIFEST_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save_manifest(manifest):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PAGES_MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def _write_local_copy(relative_path, content):
    """Conserve aussi une copie locale (pratique pour prévisualiser avant publication)."""
    local_path = os.path.join(OUTPUT_DIR, relative_path)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    today = datetime.now(timezone.utc).date()
    today_str = today.isoformat()

    # Audit#5 : la résolution des issues de signaux (outcome_evaluator) a été
    # retirée d'ici — c'est désormais le rôle exclusif du Worker Cloudflare
    # (trackSignalOutcomes.ts, toutes les 5 min), pour éviter que les deux
    # systèmes se marchent dessus sur les mêmes colonnes Supabase. Ce module
    # ne fait plus que LIRE les résultats déjà connus (compute_performance_stats).

    print("1/7 — Récupération des derniers signaux et du backtest...")
    signals = supabase_client.get_recent_signals(limit=NUM_SIGNALS_TO_DISPLAY)
    backtest_stats = supabase_client.get_active_backtest_stats()
    backtest_trades = supabase_client.get_backtest_trades()
    resolved_signals = supabase_client.get_all_resolved_signals()  # Bloc 11.1 (portefeuille fictif) + 13.3 (transparence)
    reviews = supabase_client.get_recent_reviews()  # Étape 3 (preuve sociale) : avis réels /review, sinon [] (exemples fictifs affichés à la place)

    print("2/7 — Génération des archives du backtest...")
    files_to_publish = [("archives.html", build_archives_page(backtest_trades, backtest_stats))]

    print("3/7 — Génération de la page de transparence (Audit#20 + Bloc 13.3)...")
    daily_stats_history = supabase_client.get_daily_stats_history()
    files_to_publish.append(("transparency.html", build_transparency_page(daily_stats_history, resolved_signals=resolved_signals)))

    fr_home_path = "/"
    en_home_path = "/en/"

    if signals:
        print("4/7 — Signaux réels trouvés : génération des pages du jour (français + anglais)...")
        performance = outcome_evaluator.compute_performance_stats()
        fr_archive_path = f"/signaux/{today_str}.html"
        en_archive_path = f"/en/signals/{today_str}.html"
        home_files = {"index.html", "en/index.html"}

        pages = [
            ("index.html", fr_home_path, en_home_path, "fr"),
            (f"signaux/{today_str}.html", fr_archive_path, en_archive_path, "fr"),
            ("en/index.html", en_home_path, fr_home_path, "en"),
            (f"en/signals/{today_str}.html", en_archive_path, fr_archive_path, "en"),
        ]
        for relative_path, canonical_path, alternate_path, lang in pages:
            content = build_daily_page(
                signals, performance, today, canonical_path, lang=lang, alternate_path=alternate_path,
                backtest_stats=backtest_stats if relative_path in home_files else None,
                resolved_signals=resolved_signals,
                reviews=reviews,
            )
            files_to_publish.append((relative_path, content))

        manifest = _load_manifest()
        for path in (fr_archive_path, en_archive_path):
            if not any(p["path"] == path for p in manifest):
                manifest.append({"path": path, "lastmod": today_str})
        _save_manifest(manifest)
    else:
        print("4/7 — Aucun signal réel pour le moment : page d'accueil basée sur les archives du backtest.")
        files_to_publish.append(("index.html", build_waiting_homepage(backtest_stats, TELEGRAM_BOT_USERNAME)))
        manifest = _load_manifest()

    print("5/7 — Mise à jour du sitemap et de robots.txt (toujours publiés, même sans signal)...")
    # Audit#10 : /en/index.html n'est généré que si `signals` est non vide (branche
    # ci-dessus) — l'annoncer dans le sitemap avant qu'il existe créait une entrée
    # cassée (404) pour les moteurs de recherche tant qu'aucun signal réel n'existe.
    sitemap_pages = [
        {"path": "/", "lastmod": today_str},
        {"path": "/privacy.html", "lastmod": today_str},
        {"path": "/terms.html", "lastmod": today_str},
        {"path": "/archives.html", "lastmod": today_str},
        {"path": "/transparency.html", "lastmod": today_str},
    ]
    if signals:
        sitemap_pages.append({"path": "/en/", "lastmod": today_str})
    sitemap_pages += manifest
    files_to_publish += [
        ("sitemap.xml", build_sitemap(sitemap_pages)),
        ("robots.txt", build_robots_txt()),
    ]

    print("6/7 — Écriture des copies locales...")
    for relative_path, content in files_to_publish:
        _write_local_copy(relative_path, content)

    print("7/7 — Publication sur GitHub...")
    commit_message = f"Contenu SEO du {today_str}"
    github_publisher.publish_files(
        [(path, content, commit_message) for path, content in files_to_publish]
    )

    print(f"\nTerminé. Cloudflare Pages va redéployer automatiquement le site ({SITE_BASE_URL}).")


if __name__ == "__main__":
    main()
