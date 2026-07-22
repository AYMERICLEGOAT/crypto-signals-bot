"""
Génère sitemap.xml et robots.txt à partir de la liste des pages déjà
publiées (voir data/pages_manifest.json, tenu à jour par main.py).
"""

from config import SITE_BASE_URL


def build_sitemap(pages):
    """
    `pages` : liste de dicts {"path": "/signaux/2026-07-21.html", "lastmod": "2026-07-21"}.
    La page d'accueil ("/") doit être incluse par l'appelant si souhaité.
    """
    urls = "\n".join(
        f"""  <url>
    <loc>{SITE_BASE_URL}{p["path"]}</loc>
    <lastmod>{p["lastmod"]}</lastmod>
    <changefreq>daily</changefreq>
  </url>"""
        for p in pages
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}
</urlset>
"""


def build_robots_txt():
    return f"User-agent: *\nAllow: /\nSitemap: {SITE_BASE_URL}/sitemap.xml\n"
