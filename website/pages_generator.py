"""
Pages de fond du site : « Comment ça marche », « À propos », glossaire.

Ces trois pages manquaient. Elles répondent chacune à un moment précis du
parcours d'un visiteur :

  - Comment ça marche : « concrètement, il se passe quoi si je m'inscris ? »
    C'est la question qui bloque juste avant l'essai.
  - À propos : « qui est derrière, et pourquoi je leur ferais confiance ? »
    Dans un secteur saturé d'arnaques, l'absence totale d'histoire est en
    soi un signal négatif.
  - Glossaire : cible les recherches de débutants (« c'est quoi un stop
    loss », « ATR trading ») qui amènent exactement le public visé, et sert
    de maillage interne vers les guides.

Aucune de ces pages ne promet de performance : elles décrivent le
fonctionnement et l'état réel du projet, y compris ses limites.
"""

import html
import json

from config import SITE_BASE_URL, TELEGRAM_BOT_USERNAME
from html_generator import _STYLE
from social_meta import social_tags

_EXTRA = """
  .step { display: flex; gap: 16px; margin: 22px 0; align-items: flex-start; }
  .step-num {
    flex: 0 0 38px; height: 38px; border-radius: 50%;
    background: var(--accent); color: #06101f; font-weight: 800;
    display: flex; align-items: center; justify-content: center; font-size: 1.05rem;
  }
  .step-body h3 { margin: 4px 0 6px; font-size: 1.08rem; }
  .step-body p { margin: 0; color: var(--text-dim); }
  .breadcrumb { font-size: .85rem; color: var(--text-dim); margin-bottom: 10px; }
  .glossary dt { font-weight: 700; margin-top: 18px; color: var(--accent); }
  .glossary dd { margin: 4px 0 0; color: var(--text-dim); }
  .note { background: var(--bg-soft); border-left: 3px solid var(--gold);
          border-radius: 8px; padding: 14px 16px; margin: 20px 0; color: var(--text-dim); }
"""


def _shell(title, description, path, body, kind="website", jsonld=None):
    canonical = f"{SITE_BASE_URL}{path}"
    ld = f'\n  <script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ""
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
{social_tags(title, description, canonical, kind)}{ld}
  <style>{_STYLE}{_EXTRA}</style>
</head>
<body>
{body}
  <footer>
    <p><a href="/">← Accueil</a> — <a href="/guides/">Guides</a> —
       <a href="/transparency.html">Transparence</a> — <a href="/terms.html">CGV</a></p>
  </footer>
</body>
</html>
"""


STEPS = [
    ("La stratégie surveille le marché",
     "40 paires crypto sont analysées en continu sur des bougies horaires. Le moteur cherche "
     "un croisement de moyennes mobiles confirmé par le RSI, filtré par le régime de marché (ADX)."),
    ("Un signal n'est émis que si tout concorde",
     "La plupart des configurations sont écartées. C'est voulu : un signal forcé pour faire du "
     "volume n'a aucune valeur. Certaines journées ne produisent aucun signal, et c'est annoncé."),
    ("Tu reçois le signal complet sur Telegram",
     "Paire, sens, prix d'entrée, stop loss et trois objectifs — tous définis AVANT l'ouverture, "
     "jamais ajustés après coup."),
    ("Le suivi est automatique jusqu'à la clôture",
     "Premier objectif atteint : le stop remonte au prix d'entrée, la position ne peut plus finir "
     "perdante. Tu es notifié à chaque étape, y compris si le stop est touché."),
    ("Tout est publié, gains comme pertes",
     "Chaque résultat apparaît sur le canal public et la page Transparence. Un service qui ne "
     "publie que ses gains ne publie pas ses résultats."),
]


def build_how_it_works():
    steps_html = "\n".join(
        f'''    <div class="step">
      <div class="step-num">{i}</div>
      <div class="step-body"><h3>{html.escape(t)}</h3><p>{html.escape(d)}</p></div>
    </div>'''
        for i, (t, d) in enumerate(STEPS, 1)
    )
    body = f"""  <p class="breadcrumb"><a href="/">Accueil</a> › Comment ça marche</p>
  <header>
    <h1>Comment ça marche</h1>
    <p class="subtitle">Du signal détecté à la position clôturée, étape par étape.</p>
  </header>

  <section>
{steps_html}
  </section>

  <section>
    <h2>Ce que le service ne fait pas</h2>
    <p>Il ne passe aucun ordre à ta place et n'a jamais accès à tes fonds ni à ton exchange.
       Tu restes seul décisionnaire de chaque position.</p>
    <p>Il ne promet aucune performance. Sur les 24 derniers mois de données simulées, les gains
       et les pertes se compensent quasiment&nbsp;: la stratégie n'a pas démontré de rentabilité,
       et nous publions ce résultat plutôt que de le cacher.</p>
    <div class="note">
      Ce qui est réellement démontrable&nbsp;: des niveaux définis à l'avance, une sécurisation
      automatique au premier objectif, et la publication intégrale des résultats. C'est un cadre
      de discipline, pas une machine à gains.
    </div>
  </section>

  <div class="cta">
    <p><b>Teste sans payer</b></p>
    <p>Essai gratuit de 3 jours, aucun moyen de paiement demandé.</p>
    <a href="https://t.me/{TELEGRAM_BOT_USERNAME}">Ouvrir le bot Telegram →</a>
  </div>
"""
    jsonld = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": "Comment fonctionne le bot de signaux crypto",
        "step": [{"@type": "HowToStep", "position": i, "name": t, "text": d}
                 for i, (t, d) in enumerate(STEPS, 1)],
    }
    return _shell(
        "Comment ça marche — du signal à la clôture",
        "Le fonctionnement complet du bot de signaux crypto : détection, émission, suivi automatique jusqu'à la clôture, publication de tous les résultats.",
        "/comment-ca-marche", body, jsonld=jsonld,
    )


def build_about():
    body = f"""  <p class="breadcrumb"><a href="/">Accueil</a> › À propos</p>
  <header>
    <h1>À propos</h1>
    <p class="subtitle">Ce qu'est ce projet, et ce qu'il n'est pas.</p>
  </header>

  <section>
    <h2>L'origine</h2>
    <p>Ce projet est né d'un constat simple : la plupart des services de signaux crypto affichent
       un taux de réussite flatteur et ne publient jamais leurs pertes. Impossible, dans ces
       conditions, de savoir si l'offre vaut quelque chose.</p>
    <p>L'idée de départ tenait en une phrase : construire l'inverse. Une stratégie entièrement
       automatisée, des niveaux fixés avant l'ouverture de chaque position, et la publication de
       <b>tous</b> les résultats — y compris quand ils sont mauvais.</p>
  </section>

  <section>
    <h2>Comment c'est construit</h2>
    <p>Tout est automatisé : la détection tourne toutes les 30 minutes sur des données de marché
       réelles, la diffusion et le suivi des positions sont gérés par un service qui ne dort
       jamais. Aucune intervention humaine ne décide d'un signal.</p>
    <p>Le code source est intégralement public sur
       <a href="https://github.com/AYMERICLEGOAT/crypto-signals-bot" rel="noopener">GitHub</a> :
       la stratégie, les backtests, et jusqu'aux analyses qui concluent que l'avantage n'est pas
       démontré. Tu peux vérifier toi-même ce qui est fait, plutôt que nous croire sur parole.</p>
  </section>

  <section>
    <h2>Où en est le projet, honnêtement</h2>
    <p>Le service est jeune et le nombre d'abonnés est faible. Nous ne gonflons aucun chiffre :
       la page <a href="/transparency.html">Transparence</a> affiche les résultats réels, même
       quand ils sont modestes ou négatifs.</p>
    <p>La mesure la plus récente, sur 24 mois de données, montre que gains et pertes se
       compensent quasiment. Nous aurions pu ne publier que la période favorable. Nous préférons
       afficher l'ensemble et laisser chacun juger.</p>
    <div class="note">
      Ce n'est pas un conseil en investissement. Le trading de cryptoactifs comporte un risque de
      perte en capital, y compris de la totalité des sommes engagées.
    </div>
  </section>

  <div class="cta">
    <p><b>Juge sur pièces</b></p>
    <p>3 jours d'essai gratuit, sans moyen de paiement.</p>
    <a href="https://t.me/{TELEGRAM_BOT_USERNAME}">Ouvrir le bot Telegram →</a>
  </div>
"""
    return _shell(
        "À propos — l'histoire et les limites du projet",
        "Pourquoi ce bot de signaux crypto existe, comment il est construit, et où en est réellement le projet — sans chiffres gonflés.",
        "/a-propos", body,
    )


# 50 termes, choisis pour couvrir ce qu'un débutant rencontre réellement dans
# un signal ou sur un exchange — pas un lexique académique.
GLOSSARY = [
    ("ATR", "Average True Range. Mesure l'amplitude moyenne des mouvements récents. Sert à placer stop loss et objectifs proportionnellement à la volatilité de l'actif plutôt qu'en pourcentage fixe."),
    ("Airdrop", "Distribution gratuite de jetons à des utilisateurs, souvent pour faire connaître un projet."),
    ("Altcoin", "Toute cryptomonnaie autre que le Bitcoin."),
    ("Backtest", "Simulation d'une stratégie sur des données passées. Utile pour valider une logique, mais ne garantit jamais le même résultat en conditions réelles."),
    ("Bandes de Bollinger", "Deux bandes encadrant une moyenne mobile, calculées sur l'écart-type du prix. Leur écartement mesure la volatilité du moment."),
    ("Break-even", "Point mort. Remonter son stop au prix d'entrée met la position à break-even : elle ne peut plus finir perdante."),
    ("Bull / Bear market", "Marché haussier / marché baissier, sur une tendance longue."),
    ("Capitalisation", "Prix d'un actif multiplié par le nombre d'unités en circulation."),
    ("CEX", "Centralized Exchange. Plateforme d'échange gérée par une société (Binance, Coinbase, Kraken)."),
    ("Cold wallet", "Portefeuille dont les clés sont stockées hors ligne, à l'abri du piratage à distance."),
    ("DCA", "Dollar-Cost Averaging. Investir un montant fixe à intervalles réguliers pour lisser le prix d'achat moyen."),
    ("DeFi", "Finance décentralisée : services financiers (prêts, échanges) sans intermédiaire bancaire."),
    ("DEX", "Decentralized Exchange. Plateforme d'échange fonctionnant par smart contracts, sans société centrale."),
    ("Drawdown", "Pire chute observée depuis un sommet d'équité. Un drawdown de 40 % signifie que le capital a perdu 40 % avant de remonter."),
    ("EMA", "Exponential Moving Average. Moyenne mobile donnant plus de poids aux prix récents, donc plus réactive qu'une moyenne simple."),
    ("Espérance", "Gain moyen attendu par trade, tenant compte du taux de réussite ET de la taille des gains et des pertes. L'indicateur qui décide vraiment de la rentabilité."),
    ("Exchange", "Plateforme permettant d'acheter, vendre et échanger des cryptomonnaies."),
    ("Fear & Greed Index", "Indice de sentiment de marché de 0 à 100, de la peur extrême à l'avidité extrême."),
    ("FOMO", "Fear Of Missing Out. Peur de rater une opportunité, qui pousse à entrer après une forte hausse — souvent trop tard."),
    ("Fork", "Bifurcation d'une blockchain créant une nouvelle version du protocole."),
    ("Frais de retrait", "Montant prélevé par un exchange lors d'un envoi vers l'extérieur. Attention : souvent déduit DU montant envoyé."),
    ("Funding rate", "Taux périodique échangé entre acheteurs et vendeurs sur les contrats perpétuels."),
    ("Gas", "Frais payés pour exécuter une transaction ou un smart contract sur une blockchain."),
    ("Halving", "Division par deux de la récompense des mineurs Bitcoin, environ tous les 4 ans."),
    ("HODL", "Née d'une faute de frappe en 2013, l'expression désigne le fait de conserver malgré la volatilité."),
    ("Levier", "Multiplicateur de position. Amplifie les gains ET les pertes dans les mêmes proportions."),
    ("Liquidation", "Fermeture forcée d'une position à effet de levier quand la perte atteint la marge déposée."),
    ("Liquidité", "Capacité à acheter ou vendre sans faire bouger le prix. Faible liquidité = fort slippage."),
    ("Long / Short", "Parier sur la hausse (long) ou sur la baisse (short) d'un actif."),
    ("MACD", "Indicateur de convergence/divergence de moyennes mobiles, utilisé pour lire le momentum."),
    ("Momentum", "Vitesse et force d'un mouvement de prix, indépendamment de sa direction."),
    ("Moyenne mobile", "Moyenne des prix sur une période glissante, qui lisse le bruit pour rendre la tendance lisible."),
    ("Multi-TP", "Sortie par tranches sur plusieurs objectifs (TP1, TP2, TP3) plutôt qu'en une seule fois."),
    ("NFA", "Not Financial Advice. Mention signalant que le contenu n'est pas un conseil en investissement."),
    ("Order book", "Carnet d'ordres : l'ensemble des ordres d'achat et de vente en attente sur un marché."),
    ("Overfitting", "Surapprentissage : ajuster une stratégie aux données passées au point qu'elle échoue sur des données nouvelles."),
    ("Paire", "Deux actifs échangés l'un contre l'autre, par exemple BTC/USDT."),
    ("Polygon", "Réseau compatible Ethereum aux frais très faibles, souvent utilisé pour transférer des USDT."),
    ("Ratio risque/rendement", "Rapport entre la perte potentielle (jusqu'au stop) et le gain visé (jusqu'à l'objectif). Un ratio 1:2 vise deux fois plus de gain que de risque."),
    ("Résistance", "Niveau de prix où l'offre a historiquement freiné une hausse."),
    ("RSI", "Relative Strength Index. Mesure la vitesse et l'ampleur des variations, de 0 à 100. Sous 30 : « survendu ». Au-dessus de 70 : « suracheté »."),
    ("Seed phrase", "Phrase de 12 ou 24 mots permettant de restaurer un portefeuille. À ne jamais communiquer."),
    ("Slippage", "Écart entre le prix attendu et le prix réellement obtenu à l'exécution."),
    ("Smart contract", "Programme s'exécutant automatiquement sur une blockchain."),
    ("Stablecoin", "Cryptomonnaie visant une valeur stable, généralement indexée sur le dollar (USDT, USDC)."),
    ("Stop loss", "Ordre clôturant automatiquement une position perdante à un niveau fixé à l'avance. L'information la plus importante d'un signal."),
    ("Support", "Niveau de prix où la demande a historiquement freiné une baisse."),
    ("Take profit", "Ordre clôturant automatiquement une position gagnante à un niveau fixé à l'avance."),
    ("Taille de position", "Montant engagé sur un trade. Se calcule à partir du capital, du risque accepté et de la distance au stop — jamais au hasard."),
    ("Timeframe", "Unité de temps d'une bougie (5 min, 1 h, 1 jour). Plus elle est courte, plus le bruit domine."),
    ("Volatilité", "Amplitude des variations de prix. Mesure une ampleur, pas une direction."),
    ("Wallet", "Portefeuille crypto. Ne stocke pas les pièces mais les clés qui prouvent qu'on les possède."),
    ("Whale", "« Baleine » : détenteur d'une quantité assez importante pour influencer le marché."),
]


def build_glossary():
    terms = "\n".join(
        f"    <dt id=\"{html.escape(t.lower().replace(' ', '-').replace('/', '-'))}\">{html.escape(t)}</dt>\n"
        f"    <dd>{html.escape(d)}</dd>"
        for t, d in sorted(GLOSSARY, key=lambda x: x[0].lower())
    )
    body = f"""  <p class="breadcrumb"><a href="/">Accueil</a> › Glossaire</p>
  <header>
    <h1>Glossaire du trading crypto</h1>
    <p class="subtitle">{len(GLOSSARY)} termes expliqués simplement, sans jargon inutile.</p>
  </header>

  <section>
    <dl class="glossary">
{terms}
    </dl>
  </section>

  <div class="cta">
    <p><b>Passer de la théorie à la pratique</b></p>
    <p>Nos <a href="/guides/">guides gratuits</a> détaillent la gestion du risque et la lecture d'un signal.</p>
    <a href="https://t.me/{TELEGRAM_BOT_USERNAME}">Ouvrir le bot Telegram →</a>
  </div>

  <p class="disclaimer">Contenu pédagogique. Rien sur cette page ne constitue un conseil en
     investissement. Le trading de cryptoactifs comporte un risque de perte en capital.</p>
"""
    jsonld = {
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        "name": "Glossaire du trading crypto",
        "hasDefinedTerm": [{"@type": "DefinedTerm", "name": t, "description": d} for t, d in GLOSSARY],
    }
    return _shell(
        f"Glossaire du trading crypto — {len(GLOSSARY)} termes expliqués",
        "ATR, RSI, stop loss, drawdown, espérance, slippage… Les termes du trading crypto expliqués simplement, pour comprendre un signal avant de le suivre.",
        "/glossaire", body, jsonld=jsonld,
    )


def build_all_pages():
    """[(chemin relatif, contenu)] pour publication."""
    return [
        ("comment-ca-marche.html", build_how_it_works()),
        ("a-propos.html", build_about()),
        ("glossaire.html", build_glossary()),
    ]


def sitemap_entries(lastmod):
    return [
        {"path": "/comment-ca-marche", "lastmod": lastmod},
        {"path": "/a-propos", "lastmod": lastmod},
        {"path": "/glossaire", "lastmod": lastmod},
    ]
