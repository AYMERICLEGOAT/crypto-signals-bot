"""
Point d'entrée du générateur de contenu SEO.
À exécuter une fois par jour (planificateur de tâches, cron, ou manuellement) :

    python main.py

Étapes : évalue les résultats des signaux passés -> récupère les derniers
signaux -> génère les pages HTML (français + anglais) + sitemap + robots.txt
-> pousse le tout sur GitHub (Cloudflare Pages redéploie automatiquement).
"""

import json
import os
from datetime import datetime, timezone

from config import NUM_SIGNALS_TO_DISPLAY, DATA_DIR, PAGES_MANIFEST_PATH, OUTPUT_DIR, SITE_BASE_URL
import supabase_client
import outcome_evaluator
from html_generator import build_daily_page
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

    print("1/6 — Évaluation des résultats des signaux passés...")
    outcome_evaluator.resolve_pending_signals()

    print("2/6 — Récupération des derniers signaux...")
    signals = supabase_client.get_recent_signals(limit=NUM_SIGNALS_TO_DISPLAY)
    if not signals:
        print("Aucun signal en base pour le moment, rien à publier.")
        return

    print("3/6 — Calcul des statistiques de performance...")
    performance = outcome_evaluator.compute_performance_stats()
    backtest_stats = supabase_client.get_active_backtest_stats()

    print("4/6 — Génération des pages HTML (français + anglais)...")
    fr_archive_path = f"/signaux/{today_str}.html"
    en_archive_path = f"/en/signals/{today_str}.html"
    fr_home_path = "/"
    en_home_path = "/en/"
    home_files = {"index.html", "en/index.html"}

    pages = [
        ("index.html", fr_home_path, en_home_path, "fr"),
        (f"signaux/{today_str}.html", fr_archive_path, en_archive_path, "fr"),
        ("en/index.html", en_home_path, fr_home_path, "en"),
        (f"en/signals/{today_str}.html", en_archive_path, fr_archive_path, "en"),
    ]
    files_to_publish = []
    for relative_path, canonical_path, alternate_path, lang in pages:
        content = build_daily_page(
            signals, performance, today, canonical_path, lang=lang, alternate_path=alternate_path,
            backtest_stats=backtest_stats if relative_path in home_files else None,
        )
        files_to_publish.append((relative_path, content))

    print("5/6 — Mise à jour du sitemap et de robots.txt...")
    manifest = _load_manifest()
    for path in (fr_archive_path, en_archive_path):
        if not any(p["path"] == path for p in manifest):
            manifest.append({"path": path, "lastmod": today_str})
    _save_manifest(manifest)

    sitemap_pages = [
        {"path": "/", "lastmod": today_str},
        {"path": "/en/", "lastmod": today_str},
    ] + manifest
    sitemap_xml = build_sitemap(sitemap_pages)
    robots_txt = build_robots_txt()

    files_to_publish += [("sitemap.xml", sitemap_xml), ("robots.txt", robots_txt)]

    for relative_path, content in files_to_publish:
        _write_local_copy(relative_path, content)

    print("6/6 — Publication sur GitHub...")
    commit_message = f"Contenu SEO du {today_str}"
    github_publisher.publish_files(
        [(path, content, commit_message) for path, content in files_to_publish]
    )

    print(f"\nTerminé. Cloudflare Pages va redéployer automatiquement le site ({SITE_BASE_URL}).")


if __name__ == "__main__":
    main()
