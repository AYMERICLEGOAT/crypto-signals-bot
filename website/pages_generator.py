"""
Pages de fond du site : « Comment ça marche », « À propos », glossaire, CGV.

Ces pages répondent chacune à un moment précis du parcours d'un visiteur :

  - Comment ça marche : « concrètement, il se passe quoi si je m'inscris ? »
    C'est la question qui bloque juste avant l'essai.
  - À propos : « qui est derrière, et pourquoi je leur ferais confiance ? »
    Dans un secteur saturé d'arnaques, l'absence totale d'histoire est en
    soi un signal négatif.
  - Glossaire : cible les recherches de débutants (« c'est quoi un stop
    loss », « ATR trading ») qui amènent exactement le public visé, et sert
    de maillage interne vers les guides.
  - CGV : les conditions de vente. Générées ici depuis le 03/08/2026 (elles
    étaient auparavant un fichier HTML écrit à la main dans public/, donc
    jamais mis à jour quand la stratégie changeait) — c'est le document que
    l'abonné est censé lire AVANT de payer, il ne peut pas décrire un moteur
    qui n'existe plus.

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
  /* Bloc rouge, réservé à ce qui coûte de l'argent à l'abonné s'il ne le lit
     pas — aujourd'hui la clause des périodes sans aucun signal. Une clause
     décisive noyée dans le corps du texte est une clause cachée. */
  .warn { background: var(--bg-soft); border-left: 3px solid var(--loss);
          border-radius: 8px; padding: 16px 18px; margin: 22px 0; }
  .warn p { margin: 0 0 10px; }
  .warn p:last-child { margin-bottom: 0; }
  code { background: var(--bg-soft); border: 1px solid var(--border);
         padding: 1px 6px; border-radius: 4px; font-size: .9em; }
  /* Les deux jambes du carry de financement. Grille auto-fit plutôt que deux
     colonnes fixes : sur un téléphone les jambes se posent l'une sous l'autre
     sans media query, et le schéma reste lisible. */
  .legs { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px; margin: 18px 0; }
  .leg { background: var(--bg-card); border: 1px solid var(--border);
         border-radius: 12px; padding: 14px 16px; }
  .leg b { display: block; color: var(--text); margin-bottom: 4px; }
  .leg span { font-size: .9rem; color: var(--text-dim); }
  .leg-result { background: var(--bg-card); border: 1px dashed var(--accent);
                border-radius: 12px; padding: 14px 16px; margin: 0 0 18px; color: var(--text-dim); }
  /* Un tableau ne doit jamais élargir la page : il défile dans son conteneur. */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .table-wrap table.recent { min-width: 460px; }
  body { overflow-wrap: anywhere; }
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


# État du marché affiché sur le site. Volontairement DATÉ plutôt qu'écrit au
# présent (« aujourd'hui le filtre est fermé ») : ces pages sont régénérées
# tous les jours mais cette valeur, elle, est saisie à la main. Un
# « aujourd'hui » figé deviendrait faux dès le lendemain — exactement le type
# de chiffre périmé affiché comme actuel que ce projet s'interdit.
# À mettre à jour à chaque changement d'état du filtre.
#
# L'écart chiffré entre le Bitcoin et sa moyenne 200 jours a été retiré le
# 04/08/2026 : c'était la seule valeur du site que personne ne pouvait
# vérifier ni recalculer, et elle vieillissait de plusieurs points par jour.
# L'état binaire (au-dessus / en dessous) suffit à ce que le lecteur doit
# comprendre, et <code>/marche</code> en donne la version vivante.
FILTER_STATE_DATE = "4 août 2026"

# Les quatre familles diffusées depuis le 04/08/2026. Avant cette date le
# moteur n'en diffusait qu'une (la force relative), et cette page ne décrivait
# donc plus le produit réellement vendu. Elles servent aussi de source unique
# au balisage schema.org/HowTo plus bas : une seule liste, pas de divergence
# possible entre ce qui est affiché et ce qui est déclaré aux moteurs.
STEPS = [
    ("Quatre familles tournent en parallèle, pas une seule",
     "Trois d'entre elles achètent (elles parient sur la hausse) et une est neutre au marché. "
     "Elles ont été validées sur 6 ans face à un témoin aléatoire : une famille qui ne bat pas un "
     "tirage au sort à contraintes égales est jetée, quelle que soit son espérance affichée. "
     "Trois candidates l'ont été."),
    ("Le filtre de tendance décide si les familles directionnelles ont le droit d'acheter",
     "Une seule question avant tout le reste : le Bitcoin est-il au-dessus de sa moyenne mobile "
     "200 jours ? S'il est en dessous, les trois familles acheteuses se taisent, quelles que soient "
     "les opportunités apparentes. Sur les 6 dernières années mesurées, ce filtre a été fermé 41 % "
     "du temps, et sa plus longue fermeture a duré 381 jours d'affilée."),
    ("Famille 1 — Force relative : acheter ce qui monte déjà",
     "Une fois par jour, sur des clôtures journalières, les 40 paires suivies sont classées de la "
     "plus forte à la plus faible selon leur progression récente. Les 12 premières sont achetées et "
     "tenues 7 jours, puis clôturées sur le temps. C'est du momentum, rien de plus : aucun "
     "indicateur secret."),
    ("Famille 2 — Cassure de canal : acheter la sortie de range",
     "Quand le prix franchit son plus haut des 50 derniers jours, la position s'ouvre. On "
     "n'anticipe pas la cassure, on attend qu'elle ait eu lieu — c'est toute la différence."),
    ("Famille 3 — Expansion de volatilité : entrer quand le marché se réveille",
     "Après une longue phase de compression, où l'amplitude des mouvements s'est resserrée, le "
     "retour de la volatilité déclenche l'entrée. C'est la plus rare des quatre familles."),
    ("Famille 4 — Carry de financement : gagner sans dépendre du prix",
     "Deux jambes de même montant : achat au comptant, et vente à découvert du contrat perpétuel. "
     "Les deux s'annulent, donc le prix n'entre pas dans l'équation. Le gain vient du financement "
     "que les acheteurs de perpétuels versent aux vendeurs toutes les 8 heures. C'est la seule "
     "famille qui produise quand le marché baisse."),
    ("Tu reçois le signal complet sur Telegram",
     "Paire, sens, prix d'entrée, stop loss et objectifs — tous définis AVANT l'ouverture, jamais "
     "ajustés après coup. Sur les familles directionnelles, le stop est large (4 x ATR) : il n'est "
     "là que contre l'accident, et les objectifs (4, 8 et 12 x ATR) jalonnent la progression sans "
     "piloter la clôture."),
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
    <p class="subtitle">Quatre familles de signaux, dont une qui ne dépend pas du prix.
       Étape par étape, et avec les chiffres tels qu'ils ont été mesurés.</p>
  </header>

  <section>
{steps_html}
  </section>

  <section>
    <h2>Le carry de financement, en détail</h2>
    <p>C'est la famille la plus récente, la plus régulière, et de loin la plus facile à comprendre.
       Elle repose sur une idée simple&nbsp;: <b>faire en sorte que le prix ne compte plus.</b></p>

    <div class="legs">
      <div class="leg">
        <b>Jambe 1 — achat au comptant</b>
        <span>On détient réellement la crypto, pour un montant donné.</span>
      </div>
      <div class="leg">
        <b>Jambe 2 — vente du perpétuel</b>
        <span>On vend à découvert le contrat perpétuel du même actif, pour le même montant.</span>
      </div>
    </div>

    <p class="leg-result">Si le prix monte, la jambe 1 gagne exactement ce que la jambe 2 perd. S'il
       baisse, l'inverse. Les deux s'annulent&nbsp;: la position est <b>neutre au marché</b>.</p>

    <p>Il reste alors une seule source de résultat. Sur un contrat perpétuel, un
       <b>financement</b> est échangé toutes les 8 heures entre acheteurs et vendeurs. Comme les
       acheteurs à levier sont structurellement plus nombreux, ce financement est le plus souvent
       versé <i>aux</i> vendeurs. Nous sommes vendeurs&nbsp;: nous l'encaissons. La position est
       tenue 21 jours, le temps que ce financement s'accumule et couvre largement les frais.</p>

    <div class="perf-stats">
      <div class="perf-stat"><b>84,2 %</b> de positions gagnantes</div>
      <div class="perf-stat"><b>+0,572 %</b> net par position</div>
      <div class="perf-stat"><b>6 / 7</b> années positives</div>
    </div>
    <p>La septième année, 2022, ressort à -0,046 % par position&nbsp;: plate, pas perdante. C'est
       précisément l'année où les stratégies acheteuses ont été balayées. C'est aussi pour cela que
       le carry n'est <b>pas</b> coupé par le filtre de tendance&nbsp;: il ne parie pas sur la
       hausse, donc rien ne justifie de l'arrêter quand le marché baisse.</p>

    <div class="warn">
      <p><b>Le carry n'est pas « sans risque », et nous ne l'écrirons jamais.</b> La jambe vendeuse
         est une position à marge&nbsp;: si la marge devient insuffisante, elle peut être liquidée,
         et la couverture disparaît au pire moment. S'y ajoute le risque de plateforme — les fonds
         sont déposés chez un exchange.</p>
      <p>Le financement peut aussi <b>s'inverser</b> lors d'un emballement du marché&nbsp;: ce sont
         alors les vendeurs qui paient, parfois plusieurs jours de suite. Un stop ferme les deux
         jambes dès que la position a coûté 1,5 %, mais une seule journée à financement extrême peut
         passer devant ce stop&nbsp;: <b>-19,86 % sur une position</b> reste le pire cas mesuré.</p>
    </div>
  </section>

  <section>
    <h2>Le filtre de tendance, en détail</h2>
    <p>C'est la pièce centrale des trois familles acheteuses, et celle qui déplaît le plus&nbsp;:
       <b>41 % du temps, elles n'émettent rien du tout.</b> Pas parce qu'elles sont en panne, mais
       parce que le Bitcoin est sous sa moyenne mobile 200 jours et qu'elles ont interdiction
       d'acheter dans ces conditions.</p>
    <p>Ces arrêts peuvent être très longs. Le plus long mesuré sur 6 ans a duré <b>381 jours
       consécutifs</b>, du 28/12/2021 au 13/01/2023. Un abonné présent sur toute cette période
       n'aurait reçu, pendant plus d'un an, aucun signal directionnel.</p>
    <div class="warn">
      <p><b>Au {FILTER_STATE_DATE}, le filtre est fermé&nbsp;:</b> le Bitcoin est sous sa moyenne
         200 jours. Les trois familles acheteuses sont donc à l'arrêt, et personne ne sait quand
         elles reprendront. Tape <code>/marche</code> sur le bot pour l'état en direct.</p>
      <p>Le carry, lui, continue&nbsp;: en marché défavorable, le service produit encore
         <b>1,15 signal par jour</b> en moyenne mesurée. Mais si tu cherches un service qui envoie
         plusieurs signaux tous les jours quoi qu'il arrive, ce n'est pas celui-ci.</p>
    </div>
    <p>Pourquoi accepter ce filtre&nbsp;? Parce qu'acheter du momentum pendant une baisse générale
       est exactement la façon la plus rapide de perdre du capital. Ne rien envoyer est une
       décision, pas un incident. On préfère un abonné qui trouve le canal calme à un abonné qui
       perd de l'argent pour avoir reçu du contenu.</p>
  </section>

  <section>
    <h2>Pas d'indicateur magique</h2>
    <p>Le classement de la force relative est construit à partir du RSI, mais un simple tri par
       rendement passé fait aussi bien&nbsp;: c'est du momentum, point. Aucune des quatre familles
       ne repose sur un indicateur propriétaire ou sur une recette cachée&nbsp;; toutes sont des
       mécaniques connues, appliquées sans exception et sans état d'âme.</p>
    <p>Ce qui fait la différence n'est pas l'indicateur, c'est la discipline&nbsp;: des niveaux
       fixés avant l'ouverture, jamais retouchés, et l'obligation de se taire quand la règle le dit.
       Toute présentation qui vend un indicateur comme l'ingrédient secret devrait être lue avec
       méfiance, y compris la nôtre.</p>
  </section>

  <section>
    <h2>Ce que disent les mesures</h2>
    <p>Backtest sur 6 ans, univers non contaminé par le biais du survivant, entrée décalée d'un
       jour, frais réels déduits, et chaque famille confrontée à un témoin aléatoire.</p>
    <div class="perf-stats">
      <div class="perf-stat"><b>4,35</b> signaux/jour en marché favorable</div>
      <div class="perf-stat"><b>1,15</b> signaux/jour en marché défavorable</div>
      <div class="perf-stat"><b>2,99</b> signaux/jour en moyenne</div>
      <div class="perf-stat"><b>80 %</b> des jours ont au moins un signal</div>
    </div>
    <p>Autrement dit&nbsp;: environ un jour sur cinq n'a aucun signal, et le débit dépend fortement
       du régime de marché. Ces chiffres décrivent une fréquence mesurée sur le passé, pas une
       cadence garantie pour la durée d'un abonnement.</p>

    <h2>Il faut prendre tous les signaux directionnels</h2>
    <p>Les trois familles acheteuses réussissent environ une fois sur deux, et le signal
       <b>médian perd 0,69 %</b>. Leur rentabilité ne vient pas d'une majorité de petits gains&nbsp;:
       elle vient d'une <b>minorité de très gros gagnants</b>.</p>
    <div class="warn">
      <p>Conséquence directe, et elle est capitale&nbsp;: en trier quelques-uns « au feeling »
         revient statistiquement à ne garder que la partie perdante. Si tu ne comptes suivre que les
         signaux qui t'inspirent, cette stratégie ne fonctionnera pas pour toi.</p>
      <p>Le carry est l'exception&nbsp;: chaque position y est individuellement satisfaisante. Mais
         sur les trois autres familles, choisir, c'est perdre.</p>
    </div>
  </section>

  <section>
    <h2>Ce qu'un abonné peut réellement attendre</h2>
    <p>Le chiffre honnête n'est pas un rendement annuel de backtest&nbsp;: personne n'entre au
       premier jour d'un backtest. Le chiffre honnête est celui-ci — si tu commences à suivre les
       signaux à une date tirée au hasard dans ces 6 ans, voici où tu en es six mois plus tard.</p>
    <div class="table-wrap">
      <table class="recent">
        <thead><tr><th>Après…</th><th>Résultat médian</th><th>Entrées gagnantes</th><th>Pire cas mesuré</th></tr></thead>
        <tbody>
          <tr><td>6 mois</td><td>+5,0 %</td><td>53 %</td><td class="outcome-loss">-61,7 %</td></tr>
        </tbody>
      </table>
    </div>
    <p>Un peu plus d'une entrée sur deux est gagnante, la médiane est légèrement positive, et dans le
       pire cas mesuré on perd plus de la moitié du capital engagé.</p>
    <div class="note">
      Autrement dit&nbsp;: c'est une stratégie qui demande de la durée et de la tolérance à la
      perte. Les résultats passés, backtestés ou réels, ne préjugent en rien de l'avenir, et rien
      ici n'est garanti.
    </div>
  </section>

  <section>
    <h2>Ce que le service ne fait pas</h2>
    <p>Il ne passe aucun ordre à ta place et n'a jamais accès à tes fonds ni à ton exchange.
       Tu restes seul décisionnaire de chaque position — y compris sur le carry, qui demande
       d'ouvrir soi-même les deux jambes.</p>
    <p>Il ne te dit pas quoi faire de ton argent&nbsp;: ce sont des signaux informatifs, pas un
       conseil en investissement personnalisé. Il ne promet aucun gain, et il ne cherche pas à
       occuper le canal quand la stratégie dit de ne rien faire.</p>
    <p>Le moteur d'origine, qui achetait au contraire les paires au RSI bas, a été désactivé le
       3 août 2026 après qu'une mesure sur 6 ans l'a désigné comme la jambe perdante. Nous
       l'écrivons ici plutôt que de réécrire discrètement cette page comme si de rien n'était.</p>
  </section>

  <div class="cta">
    <p><b>Teste sans payer</b></p>
    <p>Essai gratuit de 3 jours, aucun moyen de paiement demandé.
       Vérifie d'abord l'état du marché avec <code>/marche</code>.</p>
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
        "Comment ça marche — force relative et filtre de tendance",
        "Le fonctionnement réel du bot : classement des 40 paires par force relative, achat des 12 plus fortes, sortie après 7 jours, et aucun signal quand le Bitcoin est sous sa moyenne 200 jours (41 % du temps).",
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
    <p>Tout est automatisé : une fois par jour, après la clôture journalière, le moteur classe
       40 paires par force relative et retient les 12 premières ; la diffusion et le suivi des
       positions sont gérés par un service qui ne dort jamais. Aucune intervention humaine ne
       décide d'un signal — et aucune n'en force un quand le filtre de tendance est fermé.</p>
    <p>Le code source est intégralement public sur
       <a href="https://github.com/AYMERICLEGOAT/crypto-signals-bot" rel="noopener">GitHub</a> :
       la stratégie, les backtests, et jusqu'aux analyses qui ont conclu que le moteur précédent
       était perdant et l'ont fait désactiver. Tu peux vérifier toi-même ce qui est fait, plutôt
       que nous croire sur parole.</p>
  </section>

  <section>
    <h2>Ce qui a changé le 3 août 2026</h2>
    <p>Le moteur d'origine achetait les paires dont le RSI était bas — la logique classique du
       « c'est tombé, ça va remonter ». Mesuré sur 6 ans et 18 paires non contaminées par le biais
       du survivant, c'est la jambe <b>perdante</b> : de -24,9 % à +16,9 % par an selon les
       réglages, majoritairement négative. Continuer à le diffuser à des abonnés payants n'était
       pas défendable. Il a été désactivé.</p>
    <p>Le moteur actuel fait l'inverse : il achète ce qui monte déjà. Il classe les 40 paires par
       force relative, garde les 12 plus fortes, les tient 7 jours puis sort sur le temps.
       Le détail complet est sur la page
       <a href="/comment-ca-marche.html">Comment ça marche</a>.</p>
    <p>Et surtout, il ne fait rien quand le Bitcoin est sous sa moyenne mobile 200 jours — soit
       41 % du temps sur les 6 dernières années, avec une fermeture record de 381 jours
       consécutifs. C'est ce filtre qui fait la majeure partie du travail : le classement par force
       relative, lui, n'apporte qu'environ 1,1 point. Nous préférons le dire que laisser croire à
       un indicateur miracle.</p>
  </section>

  <section>
    <h2>Où en est le projet, honnêtement</h2>
    <p>Le service est jeune et le nombre d'abonnés est faible. Nous ne gonflons aucun chiffre :
       la page <a href="/transparency.html">Transparence</a> affiche les résultats réels, même
       quand ils sont modestes ou négatifs.</p>
    <p>Le nouveau moteur n'a, à ce jour, <b>aucun historique en direct</b> : tout ce que nous
       publions à son sujet vient d'un backtest sur 6 ans. Ce backtest n'a aucune année perdante,
       mais un abonné entrant à une date au hasard obtient, six mois plus tard, une médiane de
       +5,0 % — et, dans le pire cas mesuré, -61,7 %. C'est cette fourchette-là qui décrit une
       expérience réelle, pas un rendement annuel.</p>
    <p>Au {FILTER_STATE_DATE}, le filtre est fermé et le canal n'émet rien. Un service commercial
       ordinaire cacherait cette période. Nous l'affichons, parce qu'elle fait partie de la
       stratégie.</p>
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
        "Pourquoi ce bot de signaux crypto existe, pourquoi son moteur a été remplacé le 3 août 2026, et où en est réellement le projet — sans chiffres gonflés.",
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


# Date affichée en tête des CGV. À changer à chaque modification de fond du
# texte — pas à chaque régénération quotidienne, sinon la date ne veut plus
# rien dire et l'abonné ne peut plus savoir ce qui a bougé depuis sa lecture.
TERMS_LAST_UPDATE = "2026-08-03"


def build_terms():
    """
    Conditions générales de vente et d'utilisation.

    Générées depuis le 03/08/2026 (avant : public/terms.html, écrit à la main).
    Le déclencheur est la section 2 ci-dessous : le moteur Force Relative
    n'émet aucun signal quand le Bitcoin est sous sa moyenne 200 jours, soit
    41 % du temps, une fois pendant 381 jours d'affilée. Vendre un abonnement
    de 30 jours sans avoir écrit noir sur blanc qu'il peut ne rien contenir
    serait une omission trompeuse (art. L121-3 du code de la consommation) —
    et, plus simplement, une façon de prendre l'argent de quelqu'un qui n'a pas
    compris ce qu'il achetait.
    """
    body = f"""  <p class="breadcrumb"><a href="/">Accueil</a> › Conditions générales</p>
  <header>
    <h1>Conditions générales de vente et d'utilisation</h1>
    <p class="subtitle">Dernière mise à jour : {TERMS_LAST_UPDATE}</p>
  </header>

  <p>Ces conditions régissent l'accès et l'utilisation du bot Telegram
     @{TELEGRAM_BOT_USERNAME} et de ce site. En utilisant le canal gratuit, en démarrant un essai
     ou en payant un abonnement, tu acceptes les termes ci-dessous.</p>

  <section>
    <h2>1. Objet du service</h2>
    <p>Le service diffuse, de façon automatisée, des signaux d'analyse technique crypto sur
       40 paires USDT, ainsi qu'un canal public gratuit à diffusion différée. La stratégie classe
       chaque jour ces 40 paires par force relative (momentum) sur données journalières, retient
       les 12 plus fortes, et clôture chaque position au bout de 7 jours. Un stop large
       (4 x ATR) protège contre l'accident&nbsp;; les objectifs affichés jalonnent la progression
       mais ne déclenchent pas la clôture.</p>
    <p>Ce contenu est <strong>éducatif et informatif</strong>&nbsp;: il ne constitue en aucun cas un
       conseil en investissement, une recommandation personnalisée, ni une incitation à acheter ou
       vendre un actif. Tu décides seul de tes positions. Le trading de cryptoactifs comporte un
       risque de perte en capital, pouvant aller jusqu'à la perte totale des sommes engagées.</p>
  </section>

  <section>
    <h2>2. Périodes sans aucun signal — à lire avant de payer</h2>
    <p><strong>Ce service peut ne diffuser aucun signal pendant des périodes prolongées, y compris
       pendant la totalité d'un abonnement payé.</strong></p>
    <p>La stratégie n'émet aucun signal tant que le Bitcoin est sous sa moyenne mobile 200 jours.
       Sur les 6 dernières années mesurées, cette condition d'arrêt a été remplie <strong>41 % du
       temps</strong>. Il y a eu 11 périodes d'arrêt d'au moins une semaine, de durée médiane
       25 jours, dont une de <strong>381 jours consécutifs</strong> (12,7 mois, du 28/12/2021 au
       13/01/2023).</p>
    <div class="warn">
      <p><b>L'abonnement court pendant ces périodes.</b> La durée achetée (14 ou 30 jours) s'écoule
         au calendrier. Elle n'est ni suspendue, ni prolongée, ni remboursée, même si aucun signal
         n'est émis du premier au dernier jour. Il est donc parfaitement possible de payer un
         abonnement de 30 jours et de ne recevoir aucun signal.</p>
      <p><b>Ce n'est pas une panne, c'est le comportement voulu de la stratégie.</b> Sans cette
         règle d'arrêt, la stratégie n'est positive que 4 années sur 7&nbsp;; avec elle, elle n'a
         aucune année perdante sur les 6 années mesurées. En 2022 et en 2026 elle n'a rien émis,
         pendant que détenir ces mêmes cryptos coûtait -70,9 % puis -39,4 %. Ne rien envoyer est
         la protection, pas le défaut.</p>
      <p><b>Tu en es informé avant tout paiement.</b> Au {FILTER_STATE_DATE}, cette condition
         d'arrêt est active&nbsp;: le Bitcoin est sous sa moyenne 200 jours, et les trois familles
         directionnelles sont à l'arrêt. Le carry de financement, lui, continue de produire —
         c'est la seule famille qui fonctionne dans ce régime. Personne ne peut prévoir la date de
         reprise des trois autres&nbsp;: n'achète pas d'abonnement en pariant sur une échéance.</p>
    </div>
    <p>L'état de cette condition (active ou non) est annoncé sur le canal et expliqué en détail sur
       la page <a href="/comment-ca-marche.html">Comment ça marche</a>. Une interruption due à un
       incident technique (section 9) est une chose différente et sera signalée comme telle.</p>
  </section>

  <section>
    <h2>3. Accès et capacité à contracter</h2>
    <p>Le canal public gratuit et l'essai gratuit sont accessibles à toute personne disposant d'un
       compte Telegram. Les offres payantes (section 4) impliquent un paiement irréversible et
       supposent donc la capacité juridique de contracter au sens de la loi applicable&nbsp;; un
       mineur souhaitant y souscrire doit obtenir au préalable l'accord de son représentant légal.
       Nous ne demandons ni ne vérifions de justificatif d'identité (voir
       <a href="/privacy.html">politique de confidentialité</a>)&nbsp;: c'est à l'utilisateur de
       respecter cette condition.</p>
  </section>

  <section>
    <h2>4. Offres et tarifs</h2>
    <table class="recent">
      <thead><tr><th>Offre</th><th>Durée</th><th>Prix</th></tr></thead>
      <tbody>
        <tr><td>Essai gratuit (<code>/trial</code>)</td><td>3 jours</td><td>Gratuit — une fois par wallet</td></tr>
        <tr><td>Découverte</td><td>14 jours</td><td>5 USDT — offre de lancement, quantité limitée, une fois par wallet</td></tr>
        <tr><td>Standard</td><td>30 jours</td><td>19 USDT</td></tr>
        <tr><td>Pro</td><td>30 jours</td><td>39 USDT (accès prioritaire aux signaux) — temporairement masqué dans <code>/subscribe</code></td></tr>
      </tbody>
    </table>
    <p>Les prix sont fixés en USDT (stablecoin indexé sur le dollar américain)&nbsp;; les paiements
       en Monero (XMR) ou Litecoin (LTC) sont convertis au montant équivalent au moment de
       l'émission de la facture. Ces tarifs peuvent évoluer&nbsp;: la commande <code>/subscribe</code>
       affiche toujours les prix en vigueur au moment de l'achat, parmi les offres qui y sont
       visibles.</p>
  </section>

  <section>
    <h2>5. Paiement</h2>
    <p>Les paiements se font exclusivement en cryptoactifs (USDT sur le réseau Polygon, Monero ou
       Litecoin), directement depuis ton propre wallet vers l'adresse fournie par le bot — nous ne
       stockons ni ne manipulons jamais tes fonds ni tes clés privées. Une transaction blockchain
       est <strong>irréversible</strong> par construction&nbsp;: il est de ta responsabilité de
       vérifier l'adresse, le montant et le réseau avant d'envoyer les fonds. Un envoi vers une
       mauvaise adresse ou un mauvais réseau ne peut pas être annulé ni récupéré par nos soins.</p>
  </section>

  <section>
    <h2>6. Absence de droit de rétractation</h2>
    <p>L'abonnement est un contenu numérique dont l'exécution démarre immédiatement dès
       confirmation du paiement sur la blockchain (activation automatique de l'accès), à ta demande
       expresse. Conformément aux exceptions prévues pour la fourniture immédiate de contenu
       numérique non fourni sur support matériel, tu reconnais renoncer à ton droit de rétractation
       à compter de cette activation. Aucun remboursement n'est possible une fois le paiement
       confirmé — y compris en cas d'erreur d'envoi de ta part (section 5) et y compris si aucun
       signal n'est émis pendant la période souscrite (section 2).</p>
  </section>

  <section>
    <h2>7. Durée, non-reconduction et résiliation</h2>
    <p>Les abonnements ne se renouvellent <strong>jamais automatiquement</strong>&nbsp;: à
       l'expiration, l'accès aux signaux payants s'arrête et il faut repasser par
       <code>/subscribe</code> pour se réabonner. Des rappels sont envoyés avant l'expiration
       (48 h, 24 h, 2 h), sans jamais déclencher de prélèvement automatique — aucun moyen de
       paiement n'est d'ailleurs mémorisé par le bot. Tu peux arrêter les relances à tout moment
       avec <code>/cancel</code>&nbsp;; ton accès déjà payé reste valable jusqu'à sa date
       d'expiration normale.</p>
  </section>

  <section>
    <h2>8. Absence de garantie de résultat</h2>
    <p>Les signaux reposent sur une stratégie testée sur données historiques (voir
       <a href="/comment-ca-marche.html">Comment ça marche</a> et
       <a href="/transparency.html">Transparence</a>). Les résultats passés — qu'ils viennent du
       backtest ou du suivi réel — ne préjugent en rien des performances futures. Aucun taux de
       réussite, aucun rendement, aucun nombre de signaux ne sont garantis, ni pour la durée de
       l'abonnement ni au-delà.</p>
    <p>La stratégie actuelle a remplacé la précédente le 3 août 2026, celle-ci ayant été mesurée
       comme perdante. Nous nous réservons le droit d'ajuster ou de remplacer la stratégie
       (paramètres, paires suivies, moteur) sans préavis&nbsp;; tout changement de fond est publié
       sur le site et sur le canal.</p>
  </section>

  <section>
    <h2>9. Responsabilité</h2>
    <p>Le service est fourni « en l'état ». Nous ne pouvons être tenus responsables&nbsp;: des
       pertes financières résultant de décisions de trading prises à partir des signaux, d'une
       interruption temporaire du service (maintenance, panne d'un fournisseur tiers — Telegram,
       Cloudflare, Supabase, fournisseurs de données de marché — ou congestion d'un réseau
       blockchain), ou d'un envoi de fonds vers une mauvaise adresse par l'utilisateur. Le code
       source de ce projet est
       <a href="https://github.com/AYMERICLEGOAT/crypto-signals-bot" rel="noopener">public sur
       GitHub</a> — tu peux l'auditer toi-même avant de payer.</p>
  </section>

  <section>
    <h2>10. Résiliation par l'éditeur</h2>
    <p>Nous nous réservons le droit de suspendre l'accès d'un compte en cas d'abus manifeste
       (contournement des limites anti-abus par wallet, tentative de perturbation du service),
       sans obligation de remboursement du temps d'abonnement restant dans ce cas.</p>
  </section>

  <section>
    <h2>11. Droit applicable</h2>
    <p>Ces conditions sont régies par le droit français. Tout litige sera, à défaut de résolution
       amiable via le bot, soumis aux tribunaux compétents.</p>
  </section>

  <div class="cta">
    <p><b>Une question sur ces conditions ?</b></p>
    <p>Pose-la avant de payer, pas après.</p>
    <a href="https://t.me/{TELEGRAM_BOT_USERNAME}">Écrire à @{TELEGRAM_BOT_USERNAME} →</a>
  </div>
"""
    return _shell(
        "Conditions générales de vente et d'utilisation",
        "Conditions d'accès, tarifs, paiement et résiliation. Contient la clause des périodes sans aucun signal : le service n'émet rien quand le Bitcoin est sous sa moyenne 200 jours, historiquement 41 % du temps.",
        "/terms.html", body,
    )


def build_all_pages():
    """[(chemin relatif, contenu)] pour publication."""
    return [
        ("comment-ca-marche.html", build_how_it_works()),
        ("a-propos.html", build_about()),
        ("glossaire.html", build_glossary()),
        ("terms.html", build_terms()),
    ]


def sitemap_entries(lastmod):
    # /terms.html n'est volontairement PAS listé ici : main.py le déclare déjà
    # dans sa liste de pages fixes (sitemap_pages), et les deux listes sont
    # concaténées telles quelles — l'ajouter ici produirait deux <loc>
    # identiques dans sitemap.xml. La page reste donc bien référencée.
    return [
        {"path": "/comment-ca-marche", "lastmod": lastmod},
        {"path": "/a-propos", "lastmod": lastmod},
        {"path": "/glossaire", "lastmod": lastmod},
    ]
