"""
Page FAQ du site, avec balisage schema.org/FAQPage.

Deux raisons d'exister :

  1. SEO — le balisage FAQPage permet à Google d'afficher les questions
     directement dans les résultats de recherche (extraits enrichis). C'est
     l'un des rares gains de visibilité encore accessibles sans budget, et
     il capte des requêtes à forte intention d'achat (« est-ce que les
     signaux crypto sont une arnaque », « combien coûte un service de
     signaux »).
  2. Conversion — dans un secteur saturé d'arnaques, la méfiance est le
     premier obstacle, bien avant le prix. Un visiteur qui arrive du moteur
     de recherche ne va pas ouvrir Telegram pour poser sa question : il
     ferme l'onglet.

Le contenu répond aux OBJECTIONS, pas aux questions confortables — même
parti pris que la commande /faq du bot, avec laquelle il reste aligné.
"""

import html
import json

from config import SITE_BASE_URL, TELEGRAM_BOT_USERNAME
from html_generator import _STYLE
from html_generator import GOOGLE_SITE_VERIFICATION
from social_meta import social_tags

_EXTRA = """
  details {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; margin: 12px 0; padding: 0 18px;
    transition: border-color .2s;
  }
  details[open] { border-color: var(--accent); }
  summary {
    cursor: pointer; padding: 16px 0; font-weight: 700; font-size: 1.02rem;
    list-style: none; display: flex; justify-content: space-between; gap: 12px;
  }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; color: var(--accent); font-size: 1.4rem; line-height: 1; }
  details[open] summary::after { content: "−"; }
  details > *:not(summary) { color: var(--text-dim); margin-bottom: 16px; }
  details ul { padding-left: 1.2rem; }
  .breadcrumb { font-size: .85rem; color: var(--text-dim); margin-bottom: 10px; }
"""

# (question, réponse HTML, réponse en texte brut pour le JSON-LD)
FAQ = [
    (
        "Est-ce que je vais gagner de l'argent ?",
        "<p><b>Nous ne le promettons pas, et personne ne devrait vous le promettre.</b> "
        "Notre stratégie est testée sur 24 mois de données réelles, et sur cette période les gains "
        "et les pertes se compensent quasiment — elle n'a pas démontré de rentabilité. Nous "
        "publions ce résultat plutôt que de le cacher.</p>"
        "<p>Ce que le service apporte concrètement : des niveaux d'entrée, de stop loss et "
        "d'objectifs définis <i>à l'avance</i>, un suivi automatique jusqu'à la clôture, et la "
        "publication de <b>tous</b> les résultats. C'est un cadre de discipline, pas une machine "
        "à gains.</p>",
        "Nous ne le promettons pas. Sur 24 mois de données réelles, gains et pertes se compensent "
        "quasiment : la stratégie n'a pas démontré de rentabilité, et nous publions ce résultat. "
        "Le service apporte des niveaux définis à l'avance, un suivi automatique et la publication "
        "de tous les résultats — un cadre de discipline, pas une machine à gains.",
    ),
    (
        "Comment savoir que ce n'est pas une arnaque ?",
        "<p>Trois vérifications possibles sans nous croire sur parole :</p><ul>"
        "<li><b>Le code est public.</b> L'intégralité du projet est sur "
        "<a href=\"https://github.com/AYMERICLEGOAT/crypto-signals-bot\" rel=\"noopener\">GitHub</a> : "
        "la stratégie, les backtests, et jusqu'aux analyses qui concluent que l'avantage n'est pas "
        "démontré.</li>"
        "<li><b>Les résultats sont publiés en entier</b>, pertes comprises, sur le canal public et "
        "la page <a href=\"/transparency.html\">Transparence</a>. Un service qui ne publie que ses "
        "gains ne publie pas ses résultats : il publie sa communication.</li>"
        "<li><b>Essai gratuit de 3 jours</b>, sans moyen de paiement demandé.</li></ul>",
        "Trois vérifications : le code est intégralement public sur GitHub, y compris les analyses "
        "qui concluent que l'avantage n'est pas démontré ; tous les résultats sont publiés, pertes "
        "comprises ; et l'essai de 3 jours ne demande aucun moyen de paiement.",
    ),
    (
        "Pourquoi le taux de réussite affiché ne suffit-il pas ?",
        "<p>Parce qu'un taux de réussite seul ne dit rien de la rentabilité.</p>"
        "<p>Prenons une stratégie qui gagne 7 fois sur 10, avec des gains de 1 € et des pertes de "
        "3 €. Sur 10 trades : +7 € contre −9 €. Elle est <b>perdante</b>, avec 70 % de réussite.</p>"
        "<p>Ce qui compte est le produit du taux de réussite <i>et</i> du rapport entre gains et "
        "pertes moyens. Méfiez-vous de tout service qui met en avant un pourcentage sans jamais "
        "mentionner l'autre moitié de l'équation.</p>",
        "Un taux de réussite seul ne dit rien de la rentabilité. Une stratégie qui gagne 7 fois sur "
        "10 avec des gains de 1 EUR et des pertes de 3 EUR fait +7 contre -9 sur 10 trades : elle "
        "est perdante avec 70% de réussite. Ce qui compte est le taux ET le rapport entre gains et "
        "pertes moyens.",
    ),
    (
        "Combien ça coûte et comment payer ?",
        "<p>L'abonnement Standard est à 19 USDT pour 30 jours. Une offre Découverte à 5 USDT pour "
        "14 jours est proposée en nombre limité.</p>"
        "<p>Le paiement se fait en cryptomonnaie : USDT (réseau Polygon), Litecoin ou Monero. Nous "
        "n'acceptons pas encore la carte bancaire — c'est une limite assumée, et nous préférons le "
        "dire ici plutôt que vous le faire découvrir au moment de payer.</p>"
        "<p>Aucun prélèvement automatique : l'abonnement s'arrête tout seul à échéance. Il n'y a "
        "rien à résilier.</p>",
        "Standard : 19 USDT pour 30 jours. Découverte : 5 USDT pour 14 jours, en nombre limité. "
        "Paiement en cryptomonnaie uniquement (USDT sur Polygon, Litecoin ou Monero) : pas encore "
        "de carte bancaire. Aucun prélèvement automatique, l'abonnement s'arrête seul à échéance.",
    ),
    (
        "Combien de signaux par jour ?",
        "<p>Environ 2 à 3 par jour en moyenne, mais ce nombre <b>n'est pas garanti</b> : la "
        "stratégie se déclenche selon les conditions de marché, pas selon un quota.</p>"
        "<p>Certains jours n'en produisent aucun. C'est normal et voulu — forcer des signaux pour "
        "tenir une promesse de fréquence reviendrait à dégrader délibérément leur qualité. Les "
        "journées sans signal sont annoncées, pas passées sous silence.</p>",
        "Environ 2 à 3 par jour en moyenne, sans garantie : la stratégie se déclenche selon le "
        "marché, pas selon un quota. Certains jours n'en produisent aucun, et ces journées sont "
        "annoncées plutôt que passées sous silence.",
    ),
    (
        "Faut-il de l'expérience pour suivre les signaux ?",
        "<p>Non pour lire un signal — chacun indique l'entrée, le stop loss et les objectifs. Mais "
        "oui pour l'utiliser correctement : savoir calculer une taille de position à partir de son "
        "stop est indispensable, sinon un seul trade peut coûter une part disproportionnée du "
        "capital.</p>"
        "<p>Nos <a href=\"/guides/\">guides gratuits</a> couvrent exactement ce point. Commencez "
        "par la gestion du risque avant de suivre le moindre signal.</p>",
        "Non pour lire un signal, oui pour l'utiliser correctement : savoir calculer une taille de "
        "position à partir de son stop est indispensable. Nos guides gratuits couvrent ce point.",
    ),
    (
        "Que se passe-t-il après l'ouverture d'un signal ?",
        "<p>Le suivi est automatique jusqu'à la clôture. Vous êtes notifié à chaque étape : premier "
        "objectif atteint (le stop remonte alors au prix d'entrée, la position ne peut plus finir "
        "perdante), objectifs suivants, ou stop loss touché.</p>"
        "<p>Un signal qui n'atteint ni son objectif ni son stop est clôturé automatiquement au bout "
        "de 10 jours.</p>",
        "Le suivi est automatique jusqu'à la clôture, avec notification à chaque étape : premier "
        "objectif atteint (le stop remonte au prix d'entrée, la position ne peut plus finir "
        "perdante), objectifs suivants, ou stop touché. Clôture automatique après 10 jours sans "
        "issue.",
    ),
    (
        "Est-ce un conseil en investissement ?",
        "<p>Non. Les signaux sont une information générale, diffusée à l'identique à tous les "
        "abonnés. Ils ne tiennent compte ni de votre situation financière, ni de vos objectifs, ni "
        "de votre tolérance au risque — c'est précisément ce qui distingue une information d'un "
        "conseil personnalisé.</p>"
        "<p>Aucune décision d'investissement ne devrait être prise sur cette seule base. Le trading "
        "de cryptoactifs comporte un risque de perte en capital, y compris de la totalité des "
        "sommes engagées.</p>",
        "Non. Les signaux sont une information générale diffusée à l'identique à tous les abonnés, "
        "sans tenir compte de votre situation, vos objectifs ni votre tolérance au risque. Le "
        "trading de cryptoactifs comporte un risque de perte en capital.",
    ),
    (
        "Comment arrêter et supprimer mes données ?",
        "<p>Il n'y a rien à résilier : sans prélèvement automatique, l'abonnement s'arrête seul à "
        "échéance. La commande <code>/cancel</code> stoppe en plus les relances, tout en conservant "
        "l'accès déjà payé jusqu'à sa date de fin.</p>"
        "<p>Pour effacer vos données personnelles, <code>/delete_my_data</code> le fait "
        "immédiatement. Le message de confirmation indique précisément ce qui est supprimé et ce "
        "qui est conservé pour des obligations légales.</p>",
        "Rien à résilier : l'abonnement s'arrête seul à échéance. /cancel stoppe en plus les "
        "relances. /delete_my_data efface les données personnelles immédiatement, en détaillant ce "
        "qui est conservé pour obligations légales.",
    ),
]


def build_faq_page():
    canonical = f"{SITE_BASE_URL}/faq"
    items = "\n".join(
        f"""    <details>
      <summary>{html.escape(q)}</summary>
      {a_html}
    </details>"""
        for q, a_html, _ in FAQ
    )
    jsonld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": a_text}}
            for q, _, a_text in FAQ
        ],
    }
    description = (
        "Est-ce rentable ? Est-ce une arnaque ? Combien ça coûte ? Les réponses franches aux "
        "questions qu'on nous pose vraiment sur nos signaux crypto — y compris quand elles "
        "desservent notre argumentaire."
    )
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  {GOOGLE_SITE_VERIFICATION}
  <meta charset="UTF-8">
  <title>FAQ — les questions qu'on nous pose vraiment</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
{social_tags("FAQ — les questions qu'on nous pose vraiment", description, canonical)}
  <script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
  <style>{_STYLE}{_EXTRA}</style>
</head>
<body>
  <p class="breadcrumb"><a href="/">Accueil</a> › FAQ</p>
  <header>
    <h1>Questions fréquentes</h1>
    <p class="subtitle">Les vraies questions, avec des réponses franches — y compris quand elles
       ne nous arrangent pas.</p>
  </header>

  <section>
{items}
  </section>

  <div class="cta">
    <p><b>Une question qui n'est pas ici ?</b></p>
    <p>Pose-la directement au bot, il répond aussi via la commande /faq.</p>
    <a href="https://t.me/{TELEGRAM_BOT_USERNAME}">Ouvrir le bot Telegram →</a>
  </div>

  <p class="disclaimer">Rien sur cette page ne constitue un conseil en investissement. Le trading
     de cryptoactifs comporte un risque de perte en capital, y compris totale.</p>
  <footer>
    <p><a href="/">← Accueil</a> — <a href="/guides/">Guides</a> —
       <a href="/comment-ca-marche.html">Comment ça marche</a> —
       <a href="/transparency.html">Transparence</a></p>
  </footer>
</body>
</html>
"""
