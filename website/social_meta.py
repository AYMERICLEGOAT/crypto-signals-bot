"""
Balises sociales (Open Graph + Twitter Card) partagées par toutes les pages.

Sans elles, un lien partagé sur Telegram, X, Discord, WhatsApp ou LinkedIn
s'affiche en simple URL nue : pas de titre, pas de description, pas
d'aperçu. Or le partage est justement le seul canal d'acquisition qui ne
dépend d'aucune clé API — c'est le moment où il ne faut surtout pas perdre
le clic.

Fonction unique plutôt que des balises recopiées page par page : elles
avaient divergé (la page d'accueil avait og:title, les guides aussi mais
sans twitter:card, les pages transparence et archives n'en avaient aucune).
"""

import html

from config import SITE_NAME


def social_tags(title: str, description: str, canonical_url: str, kind: str = "website") -> str:
    """
    `kind` : "website" pour les pages de navigation, "article" pour un guide
    ou une page de contenu — les réseaux s'en servent pour choisir le format
    d'aperçu.
    """
    t = html.escape(title)
    d = html.escape(description)
    return f"""  <meta property="og:type" content="{kind}">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{d}">
  <meta property="og:url" content="{canonical_url}">
  <meta property="og:site_name" content="{html.escape(SITE_NAME)}">
  <meta property="og:locale" content="fr_FR">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{t}">
  <meta name="twitter:description" content="{d}">
  <meta name="theme-color" content="#0b0e14">"""
