"""
Génération des pages de guides pédagogiques (voir guides_content.py pour le
contenu et le raisonnement éditorial).

Ces pages visent l'acquisition organique : elles répondent à des intentions
de recherche réelles, se cumulent dans le temps, et ne dépendent d'aucune
clé API — contrairement à Twitter et Reddit, à l'arrêt faute
d'identifiants. Elles réutilisent le gabarit et le style du reste du site
(html_generator._STYLE) pour rester cohérentes visuellement.

Balisage : chaque page porte un JSON-LD schema.org/Article et un fil
d'Ariane, et renvoie vers les autres guides (maillage interne) — deux
éléments qui pèsent réellement dans l'indexation et qui manquaient
totalement au site.
"""

import html
import json

from config import SITE_BASE_URL, TELEGRAM_BOT_USERNAME
from guides_content import GUIDES
from html_generator import _STYLE

GUIDES_DIR = "guides"

_EXTRA_STYLE = """
  .guide-body h2 { font-size: 1.2rem; margin-top: 2.2rem; }
  .guide-body p { margin: 0.9rem 0; }
  .guide-body ul, .guide-body ol { padding-left: 1.3rem; }
  .guide-body li { margin: 8px 0; }
  .breadcrumb { font-size: 0.85rem; color: #666; margin-bottom: 8px; }
  .breadcrumb a { color: #4338ca; }
  .guide-cta { background: linear-gradient(135deg, #6366f1, #4338ca); color: white;
               padding: 20px; border-radius: 12px; margin: 2.5rem 0 1.5rem; }
  .guide-cta a { color: white; font-weight: 700; }
  .guide-cta p { margin: 6px 0; }
  .related { border-top: 1px solid #e5e5ef; margin-top: 2.5rem; padding-top: 1rem; }
  .related li { margin: 10px 0; }
  .guide-disclaimer { font-size: 0.85rem; color: #777; border-top: 1px solid #e5e5ef;
                      margin-top: 2rem; padding-top: 12px; }
"""


def guide_path(slug):
    return f"/{GUIDES_DIR}/{slug}.html"


def _article_jsonld(guide, canonical):
    """schema.org/Article — aide les moteurs à comprendre qu'il s'agit d'un
    contenu éditorial et non d'une page commerciale."""
    return json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": guide["h1"],
            "description": guide["description"],
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
            "inLanguage": "fr",
            "isAccessibleForFree": True,
        },
        ensure_ascii=False,
    )


def _related_html(current_slug):
    others = [g for g in GUIDES if g["slug"] != current_slug]
    items = "\n".join(
        f'      <li><a href="{guide_path(g["slug"])}">{html.escape(g["h1"])}</a></li>'
        for g in others
    )
    return f"""
    <nav class="related">
      <h2>Autres guides</h2>
      <ul>
{items}
      </ul>
    </nav>"""


def build_guide_page(guide):
    canonical = f"{SITE_BASE_URL}{guide_path(guide['slug'])}"
    bot_url = f"https://t.me/{TELEGRAM_BOT_USERNAME}"

    # Le CTA ne promet aucune performance : le service est présenté sur ce
    # qui est réellement démontrable (niveaux définis à l'avance, résultats
    # publiés intégralement). Voir signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md.
    cta = f"""
    <div class="guide-cta">
      <p><b>Envie de voir ces principes appliqués concrètement ?</b></p>
      <p>Notre bot Telegram publie ses signaux avec entrée, stop loss et objectifs
         définis à l'avance — et publie <b>tous</b> les résultats, gains comme pertes.</p>
      <p><a href="{bot_url}">Voir le bot sur Telegram →</a></p>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(guide["title"])}</title>
  <meta name="description" content="{html.escape(guide["description"])}">
  <meta name="keywords" content="{html.escape(guide["keywords"])}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{html.escape(guide["title"])}">
  <meta property="og:description" content="{html.escape(guide["description"])}">
  <meta property="og:url" content="{canonical}">
  <script type="application/ld+json">{_article_jsonld(guide, canonical)}</script>
  <style>{_STYLE}{_EXTRA_STYLE}</style>
</head>
<body>
  <p class="breadcrumb"><a href="/">Accueil</a> › <a href="/{GUIDES_DIR}/">Guides</a> › {html.escape(guide["h1"])}</p>
  <header>
    <h1>{html.escape(guide["h1"])}</h1>
    <p class="subtitle">{html.escape(guide["description"])}</p>
  </header>

  <article class="guide-body">
{guide["body"]}
  </article>

  {cta}
  {_related_html(guide["slug"])}

  <p class="guide-disclaimer">
    Contenu pédagogique. Rien sur cette page ne constitue un conseil en investissement.
    Le trading de cryptoactifs comporte un risque de perte en capital.
    Les performances passées ne préjugent pas des performances futures.
  </p>
  <footer>
    <p><a href="/">← Retour à l'accueil</a> — <a href="/transparency.html">Transparence</a>
       — <a href="/terms.html">Conditions générales</a></p>
  </footer>
</body>
</html>
"""


def build_guides_index():
    """Page d'atterrissage listant tous les guides (cible aussi les
    recherches génériques du type « guide trading crypto débutant »)."""
    canonical = f"{SITE_BASE_URL}/{GUIDES_DIR}/"
    cards = "\n".join(
        f"""    <li>
      <a href="{guide_path(g["slug"])}"><b>{html.escape(g["h1"])}</b></a>
      <p style="margin:4px 0 0;color:#666;font-size:0.92rem;">{html.escape(g["description"])}</p>
    </li>"""
        for g in GUIDES
    )
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Guides trading crypto : comprendre avant de trader</title>
  <meta name="description" content="Guides pédagogiques gratuits sur le trading crypto : lire un signal, gérer son risque, comprendre le RSI et les moyennes mobiles, repérer un backtest truqué.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Guides trading crypto">
  <meta property="og:url" content="{canonical}">
  <style>{_STYLE}{_EXTRA_STYLE}</style>
</head>
<body>
  <p class="breadcrumb"><a href="/">Accueil</a> › Guides</p>
  <header>
    <h1>Guides trading crypto</h1>
    <p class="subtitle">Ce qu'il faut comprendre avant de suivre le moindre signal. Gratuit, sans inscription.</p>
  </header>

  <ul class="guide-body" style="list-style:none;padding-left:0;">
{cards}
  </ul>

  <p class="guide-disclaimer">
    Contenu pédagogique. Rien sur ce site ne constitue un conseil en investissement.
    Le trading de cryptoactifs comporte un risque de perte en capital.
  </p>
  <footer>
    <p><a href="/">← Retour à l'accueil</a></p>
  </footer>
</body>
</html>
"""


def build_all_guide_files():
    """[(chemin relatif, contenu)] pour publication — index + une page par guide."""
    files = [(f"{GUIDES_DIR}/index.html", build_guides_index())]
    files += [(f"{GUIDES_DIR}/{g['slug']}.html", build_guide_page(g)) for g in GUIDES]
    return files


def sitemap_entries(lastmod):
    """Entrées sitemap correspondantes (index + guides)."""
    pages = [{"path": f"/{GUIDES_DIR}/", "lastmod": lastmod}]
    pages += [{"path": guide_path(g["slug"]), "lastmod": lastmod} for g in GUIDES]
    return pages
