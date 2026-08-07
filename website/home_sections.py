"""
Les sections d'accueil qui doivent convaincre : hero, fonctionnement, FAQ, appel.

Ce qu'elles corrigent. La page d'accueil commençait par un titre daté
(« Signaux crypto gratuits — 7 août 2026 ») suivi d'un sous-titre technique
énumérant cinq moteurs. Un visiteur qui arrive de recherche ne sait, après cinq
secondes, ni ce qu'on lui propose, ni pourquoi il devrait le croire, ni quoi
faire — trois questions auxquelles une page d'accueil doit répondre avant tout
le reste. Le contenu était bon ; l'ordre dans lequel il arrivait ne l'était pas.

L'ordre retenu suit celui d'une conversation avec quelqu'un de méfiant :

    ce que c'est  ->  pourquoi le croire  ->  comment ça marche
                  ->  ce que ça a donné   ->  ce qu'en disent d'autres
                  ->  les objections      ->  l'essai

DEUX RÈGLES QUE CE MODULE S'IMPOSE.

Aucun chiffre inventé. Tous ceux qui apparaissent ici viennent des backtests du
projet et sont cités ailleurs à l'identique — un visiteur qui compare la page
d'accueil, /help dans le bot et la page de transparence doit trouver les mêmes.

L'objection avant l'argument. La section FAQ ouvre sur « une majorité de
signaux perdent », et le hero annonce le silence en marché baissier. Ce n'est
pas de la modestie : ce sont les deux choses qu'un abonné découvre de toute
façon en trois jours, et les découvrir APRÈS avoir payé est la première cause de
remboursement.
"""

import html

from config import TELEGRAM_BOT_USERNAME, TELEGRAM_CHANNEL_URL

TELEGRAM_URL = f"https://t.me/{TELEGRAM_BOT_USERNAME}"


# ---------------------------------------------------------------------------
# Textes
# ---------------------------------------------------------------------------
# Regroupés ici plutôt que dans _STRINGS : ce sont des blocs entiers de page,
# pas des étiquettes réutilisables, et les mêler aux libellés de signaux rendait
# les deux illisibles.

HERO = {
    "fr": {
        "titre_avant": "Des signaux crypto qui ",
        "titre_fort": "se taisent",
        "titre_apres": " quand il n'y a rien à acheter.",
        "sous_titre": (
            "Cinq moteurs mesurés sur six ans, chacun validé contre un tirage au hasard de même "
            "densité. Quand le marché ne se prête pas, le canal le dit au lieu d'inventer des "
            "trades. Gratuit sur Telegram, sans inscription."
        ),
        "cta": "🎁 Essayer 3 jours gratuitement",
        "cta_secondaire": "Voir un exemple de signal",
        "cta_note": "Aucune carte bancaire. Aucun prélèvement automatique. Rien à désinscrire.",
        "preuve": [
            ("6 ans", "de données réelles, pas de simulation"),
            ("84,2 %", "de carrys gagnants sur la période"),
            ("2 à 5", "signaux par jour au maximum"),
            ("0", "signal forcé pour faire du volume"),
        ],
        "etat_ouvert": "Marché favorable — les moteurs directionnels émettent",
        "etat_ferme": "Marché baissier — les moteurs directionnels se taisent, le carry et le momentum 4H prennent le relais",
        "etat_inconnu": "État du marché recalculé à chaque publication",
    },
    "en": {
        "titre_avant": "Crypto signals that ",
        "titre_fort": "go quiet",
        "titre_apres": " when there is nothing worth buying.",
        "sous_titre": (
            "Five engines measured over six years, each validated against a random draw of the same "
            "density. When the market does not cooperate, the channel says so instead of inventing "
            "trades. Free on Telegram, no signup."
        ),
        "cta": "🎁 Try 3 days free",
        "cta_secondaire": "See a sample signal",
        "cta_note": "No card. No recurring charge. Nothing to cancel.",
        "preuve": [
            ("6 years", "of real data, not a simulation"),
            ("84.2%", "winning carries over the period"),
            ("2 to 5", "signals per day, at most"),
            ("0", "signals forced to pad the volume"),
        ],
        "etat_ouvert": "Favourable market — directional engines are firing",
        "etat_ferme": "Bear market — directional engines are silent; carry and 4H momentum take over",
        "etat_inconnu": "Market state recomputed on every publication",
    },
}

ETAPES = {
    "fr": {
        "titre": "⚙️ Comment ça marche",
        "intro": (
            "Aucune intervention humaine, aucune opinion, aucun « analyste ». Un programme lit les "
            "cours, applique des règles fixées à l'avance, et publie — ou ne publie pas."
        ),
        "etapes": [
            ("Le marché est classé", "Chaque jour, 40 cryptos sont comparées les unes aux autres. Le programme ne cherche pas un motif secret : il regarde lesquelles sont réellement les plus fortes du moment."),
            ("Le régime est vérifié", "Si le Bitcoin clôture sous sa moyenne 200 jours, les moteurs qui achètent une hausse s'arrêtent. C'est le cas 41 % du temps, et c'est ce qui évite les années à -70 %."),
            ("Tu reçois le signal", "Entrée, stop, trois jalons, et la date de sortie. Sur Telegram, au moment où il est détecté. Chaque signal indique de quel moteur il vient."),
            ("Le résultat est publié", "Gagnant ou perdant, le signal est clôturé publiquement sur le canal et archivé sur ce site. Rien n'est retiré après coup."),
        ],
        "lien": "Voir le détail complet du fonctionnement",
    },
    "en": {
        "titre": "⚙️ How it works",
        "intro": (
            "No human involvement, no opinions, no “analyst”. A program reads prices, applies rules "
            "fixed in advance, and publishes — or does not."
        ),
        "etapes": [
            ("The market is ranked", "Every day, 40 cryptos are compared against each other. The program is not looking for a secret pattern: it checks which ones are genuinely strongest right now."),
            ("The regime is checked", "If Bitcoin closes below its 200-day average, the engines that buy strength stop. That happens 41% of the time, and it is what avoids the -70% years."),
            ("You get the signal", "Entry, stop, three milestones, and the exit date. On Telegram, the moment it is detected. Every signal names the engine it came from."),
            ("The outcome is published", "Win or lose, the signal is closed publicly on the channel and archived on this site. Nothing is removed afterwards."),
        ],
        "lien": "See the full breakdown",
    },
}

FAQ = {
    "fr": {
        "titre": "❓ Les questions qui fâchent",
        "intro": "Dans l'ordre où elles se posent vraiment, en commençant par celle qu'on préférerait éviter.",
        "questions": [
            (
                "Est-ce que la majorité des signaux sont gagnants ?",
                "<p>Non, et c'est mesuré : les moteurs directionnels réussissent environ une fois sur deux, "
                "et le signal <b>médian perd 0,69 %</b>. La rentabilité vient d'une minorité de gros gagnants.</p>"
                "<p>La conséquence est importante : il faut les prendre <b>tous</b>. En trier quelques-uns "
                "« qui ont l'air solides » revient statistiquement à ne garder que la partie perdante.</p>",
            ),
            (
                "Pourquoi je ne reçois rien pendant des semaines ?",
                "<p>Parce que le marché baisse. Les moteurs qui achètent une hausse sont coupés tant que le "
                "Bitcoin est sous sa moyenne 200 jours — 41 % du temps sur six ans, et jusqu'à "
                "<b>381 jours d'affilée</b> entre décembre 2021 et janvier 2023.</p>"
                "<p>Deux moteurs continuent pendant ce temps : le carry de financement, qui ne parie pas sur "
                "le prix, et le momentum 4H. La commande /marche recalcule cet état en direct, à la demande.</p>",
            ),
            (
                "C'est quoi exactement, un « carry » ?",
                "<p>Tu ouvres deux positions opposées de même montant sur la même crypto : un achat au comptant "
                "et une vente à découvert du contrat perpétuel. Elles s'annulent — si le prix monte, l'une gagne "
                "ce que l'autre perd. La direction du marché ne t'affecte plus.</p>"
                "<p>Ce que tu encaisses, c'est le <b>financement</b> : un taux versé toutes les 8 heures par les "
                "acheteurs de perpétuels aux vendeurs. Mesuré sur six ans : 84,2 % de positions gagnantes. "
                "Ce n'est pas sans risque pour autant — la jambe vendeuse peut être liquidée, et la pire "
                "position mesurée a perdu 19,86 %.</p>",
            ),
            (
                "Comment je sais que les chiffres ne sont pas embellis ?",
                "<p>Chaque signal est publié <b>avant</b> de connaître son résultat, et clôturé publiquement "
                "ensuite, gagnant ou perdant. L'historique complet est sur la page de transparence, y compris "
                "les pertes.</p>"
                "<p>Les backtests sont mesurés contre un témoin : un tirage au hasard de même densité. Une "
                "stratégie qui ne bat pas ce témoin est abandonnée — c'est arrivé à dix des douze approches "
                "testées.</p>",
            ),
            (
                "Il faut payer combien, et est-ce que je suis engagé ?",
                "<p>L'essai est de 3 jours, gratuit, sans carte bancaire. Ensuite l'abonnement se paie en "
                "crypto, à l'unité : <b>aucun prélèvement automatique</b>, aucune reconduction. Si tu ne "
                "renouvelles pas, l'accès s'arrête, et il n'y a rien à désinscrire.</p>",
            ),
        ],
        "lien": "Toutes les questions",
    },
    "en": {
        "titre": "❓ The awkward questions",
        "intro": "In the order they actually come up, starting with the one we would rather skip.",
        "questions": [
            (
                "Are most signals winners?",
                "<p>No, and it is measured: the directional engines are right about half the time, and the "
                "<b>median signal loses 0.69%</b>. Profitability comes from a minority of large winners.</p>"
                "<p>The consequence matters: you have to take them <b>all</b>. Cherry-picking the ones that "
                "“look solid” statistically means keeping only the losing half.</p>",
            ),
            (
                "Why do I get nothing for weeks?",
                "<p>Because the market is falling. The engines that buy strength are cut off while Bitcoin sits "
                "below its 200-day average — 41% of the time over six years, and up to <b>381 consecutive "
                "days</b> between December 2021 and January 2023.</p>"
                "<p>Two engines keep working meanwhile: funding carry, which does not bet on price, and 4H "
                "momentum. The /marche command recomputes that state live, on demand.</p>",
            ),
            (
                "What exactly is a “carry”?",
                "<p>You open two opposite positions of equal size on the same crypto: a spot buy and a short on "
                "the perpetual contract. They cancel out — if price rises, one gains what the other loses. "
                "Market direction no longer affects you.</p>"
                "<p>What you collect is the <b>funding rate</b>: paid every 8 hours by perpetual buyers to "
                "sellers. Measured over six years: 84.2% winning positions. It is not risk-free — the short leg "
                "can be liquidated, and the worst measured position lost 19.86%.</p>",
            ),
            (
                "How do I know the numbers are not dressed up?",
                "<p>Every signal is published <b>before</b> its outcome is known, then closed publicly, win or "
                "lose. The full history is on the transparency page, losses included.</p>"
                "<p>Backtests are measured against a control: a random draw of the same density. A strategy "
                "that does not beat that control is dropped — which happened to ten of the twelve approaches "
                "tested.</p>",
            ),
            (
                "What does it cost, and am I locked in?",
                "<p>The trial is 3 days, free, no card. After that the subscription is paid in crypto, one "
                "period at a time: <b>no recurring charge</b>, no auto-renewal. If you do not renew, access "
                "simply stops, and there is nothing to cancel.</p>",
            ),
        ],
        "lien": "All questions",
    },
}

APPEL = {
    "fr": {
        "titre": "Commence par les 3 jours gratuits",
        "texte": (
            "Tu verras le débit réel, la forme des signaux, et les jours sans rien. C'est exactement "
            "ce qu'un abonné voit — il n'y a pas de version « démo » différente du produit."
        ),
        "bouton": "🎁 Ouvrir le bot Telegram",
        "secondaire": "📖 Voir le canal public",
        "note": "Sans carte bancaire, sans engagement, sans prélèvement automatique.",
    },
    "en": {
        "titre": "Start with the 3 free days",
        "texte": (
            "You will see the real cadence, the shape of the signals, and the days with nothing. It is "
            "exactly what a subscriber sees — there is no separate “demo” version of the product."
        ),
        "bouton": "🎁 Open the Telegram bot",
        "secondaire": "📖 See the public channel",
        "note": "No card, no commitment, no recurring charge.",
    },
}


def _e(texte):
    return html.escape(str(texte))


def hero_html(lang="fr", filtre_ouvert=None, titre_specifique=None):
    """
    Le hero, avec la pastille d'état du marché.

    `filtre_ouvert` vaut True, False ou None (indéterminé). Le troisième cas
    n'est pas un oubli : les pages d'archives sont générées sans état de marché,
    et afficher « marché favorable » par défaut serait exactement l'approximation
    que le filtre existe pour éviter.

    `titre_specifique` remplace le titre principal sur les pages datées. Sans
    lui, les centaines de pages d'archives partageraient toutes le même <h1> —
    un moteur de recherche y voit alors des pages interchangeables et n'en
    indexe qu'une. La promesse produit descend d'un cran et reste lue.
    """
    t = HERO[lang if lang in HERO else "fr"]

    if filtre_ouvert is True:
        pastille = f'<span class="status-pill"><span class="status-dot"></span>{_e(t["etat_ouvert"])}</span>'
    elif filtre_ouvert is False:
        pastille = f'<span class="status-pill is-closed"><span class="status-dot"></span>{_e(t["etat_ferme"])}</span>'
    else:
        pastille = f'<span class="status-pill"><span class="status-dot"></span>{_e(t["etat_inconnu"])}</span>'

    preuve = "".join(
        f"<li><b>{_e(valeur)}</b><span>{_e(libelle)}</span></li>" for valeur, libelle in t["preuve"]
    )

    if titre_specifique:
        titre = f'<h1>{_e(titre_specifique)}</h1>'
        accroche = (
            f'<p class="hero-sub">{_e(t["titre_avant"])}<b>{_e(t["titre_fort"])}</b>'
            f'{_e(t["titre_apres"])} {_e(t["sous_titre"])}</p>'
        )
    else:
        titre = (
            f'<h1>{_e(t["titre_avant"])}<span class="hl">{_e(t["titre_fort"])}</span>'
            f'{_e(t["titre_apres"])}</h1>'
        )
        accroche = f'<p class="hero-sub">{_e(t["sous_titre"])}</p>'

    return f"""
  <header class="hero">
    {pastille}
    {titre}
    {accroche}
    <div class="actions">
      <a class="btn btn-primary" href="{TELEGRAM_URL}">{_e(t["cta"])}</a>
      <a class="btn btn-ghost" href="#signaux">{_e(t["cta_secondaire"])}</a>
    </div>
    <p class="btn-note">{_e(t["cta_note"])}</p>
    <ul class="proof">{preuve}</ul>
  </header>"""


def etapes_html(lang="fr"):
    t = ETAPES[lang if lang in ETAPES else "fr"]
    lien = "/comment-ca-marche.html"
    etapes = "".join(
        f"<li><h3>{_e(titre)}</h3><p>{_e(corps)}</p></li>" for titre, corps in t["etapes"]
    )
    return f"""
  <section id="fonctionnement">
    <h2>{_e(t["titre"])}</h2>
    <p class="lead">{_e(t["intro"])}</p>
    <ol class="steps">{etapes}</ol>
    <p style="margin-top:22px"><a href="{lien}">{_e(t["lien"])} →</a></p>
  </section>"""


def faq_html(lang="fr"):
    """
    FAQ d'accueil. Le premier bloc est ouvert par défaut, et c'est délibéré :
    c'est l'objection la plus lourde du produit (une majorité de signaux
    perdent), et la cacher derrière un clic reviendrait à la présenter comme un
    détail. Les autres sont repliés pour que la section reste lisible.
    """
    t = FAQ[lang if lang in FAQ else "fr"]
    blocs = "".join(
        f'<details class="qa"{" open" if i == 0 else ""}>'
        f"<summary>{_e(question)}</summary>"
        f'<div class="qa-body">{reponse}</div>'
        f"</details>"
        for i, (question, reponse) in enumerate(t["questions"])
    )
    return f"""
  <section id="faq">
    <h2>{_e(t["titre"])}</h2>
    <p class="lead">{_e(t["intro"])}</p>
    {blocs}
    <p style="margin-top:20px"><a href="/faq.html">{_e(t["lien"])} →</a></p>
  </section>"""


def appel_html(lang="fr"):
    t = APPEL[lang if lang in APPEL else "fr"]
    return f"""
  <div class="cta">
    <div class="cta-inner">
      <h2>{_e(t["titre"])}</h2>
      <p>{_e(t["texte"])}</p>
      <div class="actions">
        <a class="btn btn-primary" href="{TELEGRAM_URL}">{_e(t["bouton"])}</a>
        <a class="btn btn-ghost" href="{TELEGRAM_CHANNEL_URL}">{_e(t["secondaire"])}</a>
      </div>
      <p class="btn-note">{_e(t["note"])}</p>
    </div>
  </div>"""


def faq_schema_org(lang="fr"):
    """
    Balisage FAQPage : les questions apparaissent alors directement dans les
    résultats de recherche. C'est le seul endroit du site où le même texte est
    publié deux fois, et il doit le rester à l'identique — un balisage qui
    diverge du contenu visible est traité comme une tentative de manipulation.
    """
    import json
    import re

    t = FAQ[lang if lang in FAQ else "fr"]
    entrees = [
        {
            "@type": "Question",
            "name": question,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": re.sub(r"<[^>]+>", " ", reponse).replace("  ", " ").strip(),
            },
        }
        for question, reponse in t["questions"]
    ]
    donnees = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": entrees}
    return f'<script type="application/ld+json">{json.dumps(donnees, ensure_ascii=False)}</script>'
