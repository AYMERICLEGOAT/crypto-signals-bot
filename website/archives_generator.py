"""
Page d'accueil du site, et page « Archives du backtest ».

La page d'accueil (build_waiting_homepage) est celle que voit réellement un
visiteur tant qu'aucun signal n'a été poussé en base — c'est-à-dire, en
pratique, la vitrine du produit. Elle a été réécrite le 04/08/2026 pour trois
raisons :

  1. Elle décrivait UNE famille de signaux (la force relative) alors que le
     moteur en diffuse QUATRE depuis ce jour-là, dont le carry de financement
     — la seule qui produise quand le marché baisse, et de très loin le
     meilleur argument du produit. Il n'apparaissait nulle part.
  2. Elle était en thème clair inline, alors que tout le reste du site est en
     thème sombre (html_generator._STYLE). Un visiteur qui cliquait sur
     « Comment ça marche » changeait de site. La feuille commune est désormais
     importée ici aussi : une seule identité visuelle, une seule maintenance.
  3. Elle affichait quatre faux témoignages, signalés comme fictifs. Dans un
     projet dont le positionnement EST l'honnêteté, inventer des clients est
     contre-productif même en le disant : ils sont remplacés par des preuves
     réellement vérifiables (code source public, canal public, transparence).

La page « Archives » montre des trades issus de la simulation, avec leurs
VRAIES dates historiques (bougies Binance réelles). Ce ne sont PAS des signaux
réellement envoyés à des abonnés — la page le dit explicitement, à plusieurs
endroits, pour ne jamais laisser croire à un historique de signaux réels.
"""

import html
from datetime import datetime, timezone

from config import PAIRS, SITE_NAME, SITE_BASE_URL, TELEGRAM_BOT_USERNAME, TELEGRAM_CHANNEL_URL
from html_generator import _STYLE
from social_meta import social_tags

BACKTEST_WINDOW_DAYS = 730  # doit rester synchronisé avec signals/config.py (BACKTEST_DAYS)
_BACKTEST_WINDOW_MONTHS = round(BACKTEST_WINDOW_DAYS / 30)

# Audit#4 : doit rester synchronisé avec signals/backtest.py (MIN_SIGNIFICANT_TRADES).
# En dessous de ce seuil, un taux de réussite (même 0% ou 100%) n'est pas fiable
# statistiquement — l'afficher tel quel serait trompeur (positif comme négatif).
MIN_SIGNIFICANT_TRADES = 15

# --- État du marché affiché en page d'accueil ------------------------------
#
# Ces deux valeurs sont saisies À LA MAIN et volontairement DATÉES dans le
# texte, comme FILTER_STATE_DATE dans pages_generator.py. Le site est régénéré
# tous les jours, mais pas ces constantes : un « aujourd'hui, le filtre est
# fermé » écrit au présent deviendrait faux sans que personne s'en aperçoive.
# Daté, le pire qui puisse arriver est une information vieille de quelques
# jours — jamais une information fausse. À mettre à jour à chaque changement
# d'état du filtre de tendance.
MARKET_STATE_DATE = "4 août 2026"
# Positions de carry ouvertes à cette date. Sert de preuve de vie : c'est la
# seule chose sur cette page qui montre que le moteur tourne vraiment
# aujourd'hui. Le canal public (lien juste à côté) en donne la version vivante.
OPEN_CARRIES = ["ZRO", "XMR", "SKY", "LDO"]


def _backtest_stat_html(win_rate_pct, trade_count):
    if trade_count < MIN_SIGNIFICANT_TRADES:
        return (
            f'<p class="archive-stats">Échantillon encore trop petit pour être significatif '
            f'({trade_count} trades sur {_BACKTEST_WINDOW_MONTHS} mois) — taux de réussite non affiché '
            f"tant que le seuil de {MIN_SIGNIFICANT_TRADES} trades n'est pas atteint.</p>"
        )
    # Audit du 01/08/2026 : ne jamais afficher un taux de réussite seul (voir
    # website/html_generator.py, même correctif). Un taux de réussite élevé
    # avec un ratio gain/perte défavorable n'est pas rentable -- présenter le
    # taux nu comme argument de vente serait trompeur.
    return (
        f'<p class="archive-stats">{win_rate_pct:.1f}% des trades atteignent leur premier objectif '
        f"({trade_count} trades simulés, backtest {_BACKTEST_WINDOW_MONTHS} mois, in-sample). "
        f"⚠️ Un taux de réussite élevé ne signifie pas rentable : sur cette période, gains et pertes "
        f"se compensent quasiment. Aucune performance n'est promise.</p>"
    )

_OUTCOME_LABEL = {"WIN": "Take profit atteint ✅", "LOSS": "Stop loss touché ❌", "TIMEOUT": "Clôturé (délai)"}
# Couleurs prises dans les variables du thème plutôt qu'en dur : ces valeurs
# servent à la fois dans un attribut style= et dans un attribut SVG, et var()
# est résolu dans les deux cas puisque le SVG est inline dans le document.
# Écrites en dur (#16a34a sur fond blanc), elles étaient illisibles depuis le
# passage du site en thème sombre.
_OUTCOME_COLOR = {"WIN": "var(--win)", "LOSS": "var(--loss)", "TIMEOUT": "var(--text-dim)"}


def _format_price(value):
    value = float(value)
    return f"{value:,.2f}".replace(",", " ") if value >= 1 else f"{value:.6f}"


def _trade_svg(trade):
    """Sparkline très simple entrée -> sortie. Illustratif, pas un vrai graphique intrabar."""
    entry = float(trade["entry_price"])
    exit_price = float(trade["exit_price"])
    color = _OUTCOME_COLOR.get(trade["outcome"], "var(--text-dim)")

    lo, hi = sorted([entry, exit_price])
    span = (hi - lo) or (entry * 0.001) or 1
    def y(p):
        return 35 - ((p - lo) / span) * 25

    y_entry, y_exit = y(entry), y(exit_price)
    return (
        f'<svg viewBox="0 0 100 40" width="100" height="40" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="Illustration schématique entrée vers sortie">'
        f'<line x1="10" y1="{y_entry:.1f}" x2="90" y2="{y_exit:.1f}" stroke="{color}" stroke-width="3" stroke-linecap="round"/>'
        f'<circle cx="10" cy="{y_entry:.1f}" r="3.5" fill="var(--accent)"/>'
        f'<circle cx="90" cy="{y_exit:.1f}" r="3.5" fill="{color}"/>'
        f'</svg>'
    )


def _trade_row_html(trade):
    pair = html.escape(trade["pair"])
    side_label = "ACHAT" if trade["side"] == "BUY" else "VENTE"
    outcome_label = _OUTCOME_LABEL.get(trade["outcome"], trade["outcome"])
    outcome_color = _OUTCOME_COLOR.get(trade["outcome"], "var(--text-dim)")
    entered = datetime.fromisoformat(trade["entered_at"].replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M UTC")
    pnl_pct = float(trade["pnl_pct"]) * 100

    return f"""
    <div class="archive-row">
      <div class="archive-svg">{_trade_svg(trade)}</div>
      <div class="archive-info">
        <div class="archive-header">
          <span class="archive-pair">{pair}</span>
          <span class="archive-side">{side_label}</span>
          <span class="archive-outcome" style="color:{outcome_color};">{outcome_label}</span>
        </div>
        <div class="archive-detail">
          Entrée {_format_price(trade["entry_price"])} → Sortie {_format_price(trade["exit_price"])}
          ({pnl_pct:+.1f}%) — {entered}
        </div>
      </div>
    </div>"""


# --- Feuille de style propre à la page d'accueil ---------------------------
#
# S'ajoute à html_generator._STYLE (importée, jamais modifiée : un autre agent
# y travaille) et ne redéfinit rien de ce qu'elle contient déjà — .cta,
# .disclaimer, table.recent, footer et la typographie viennent de là.
#
# Contrainte de conception : cette page est lue au téléphone. Toutes les
# grilles sont donc en `repeat(auto-fit, minmax(...))` et non en nombre fixe de
# colonnes, les tailles de chiffres sont en clamp() pour ne jamais déborder de
# leur carte, les zones cliquables font au moins 48 px de haut, et tout ce qui
# pourrait dépasser en largeur (tableau, liste de paires) est soit dans un
# conteneur défilant, soit en retour à la ligne forcé.
_HOME_EXTRA = """
  body { overflow-wrap: anywhere; }

  .status-pill {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--bg-soft); border: 1px solid var(--border);
    color: var(--text-dim); font-size: .82rem; font-weight: 600;
    padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;
  }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--win); box-shadow: 0 0 0 3px rgba(34,197,94,.18);
  }

  .lead { font-size: clamp(1.02rem, 3.6vw, 1.18rem); color: var(--text); margin: 0 0 6px; }
  .lead-sub { color: var(--text-dim); margin-top: 0; }

  /* Bouton principal. Répété deux fois sur la page (haut et bas) mais c'est
     TOUJOURS la même action : ouvrir le bot. Un seul appel à l'action. */
  .hero-cta { margin: 26px 0 10px; }
  .btn-main {
    display: block; width: 100%; text-align: center;
    padding: 17px 24px; min-height: 54px;
    background: var(--accent); color: #06101f;
    font-weight: 800; font-size: 1.06rem; text-decoration: none;
    border-radius: 999px; transition: transform .15s, box-shadow .15s;
  }
  .btn-main:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(79,140,255,.32); }
  .btn-note { font-size: .86rem; color: var(--text-dim); text-align: center; margin: 10px 0 0; }
  /* Même taille de note, mais alignée sur le texte courant : sert de précision
     sous un paragraphe, pas de légende sous un bouton. */
  .note-left { font-size: .86rem; color: var(--text-dim); margin: 10px 0 0; }
  @media (min-width: 560px) {
    .btn-main { display: inline-block; width: auto; min-width: 320px; }
    .hero-cta, .btn-note { text-align: center; }
  }

  section > h3 { font-size: 1.08rem; margin: 2.2rem 0 6px; letter-spacing: -.01em; }
  code {
    background: var(--bg-soft); border: 1px solid var(--border);
    padding: 1px 6px; border-radius: 4px; font-size: .9em;
  }

  /* Chiffres mesurés. minmax(148px,1fr) donne deux colonnes sur un écran de
     360 px et quatre sur un écran large, sans media query. */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 12px; margin: 20px 0; }
  .kpi {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 12px; text-align: center;
  }
  .kpi b {
    display: block; font-size: clamp(1.3rem, 6vw, 1.8rem); line-height: 1.1;
    color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -.02em;
  }
  .kpi b.gold { color: var(--gold); }
  .kpi span { display: block; margin-top: 7px; font-size: .82rem; color: var(--text-dim); }

  /* Le carry de financement : la section la plus importante de la page. */
  .carry {
    background: var(--bg-soft); border: 1px solid var(--border);
    border-left: 4px solid var(--gold); border-radius: var(--radius);
    padding: 24px 20px; margin: 2.4rem 0;
  }
  .carry h2 { margin-top: 0; border-bottom: none; color: var(--gold); }
  .legs { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 18px 0; }
  .leg { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .leg b { display: block; color: var(--text); margin-bottom: 4px; }
  .leg span { font-size: .9rem; color: var(--text-dim); }
  .leg-result {
    background: var(--bg-card); border: 1px dashed var(--accent);
    border-radius: 12px; padding: 14px 16px; margin: 0 0 18px; color: var(--text-dim);
  }

  .family-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(228px, 1fr)); gap: 14px; margin: 20px 0; }
  .family {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 18px;
  }
  .family h3 { margin: 0 0 6px; font-size: 1.02rem; }
  .family p { margin: 0; font-size: .92rem; color: var(--text-dim); }
  .family .tag {
    display: inline-block; margin-top: 10px; font-size: .74rem; font-weight: 700;
    letter-spacing: .04em; text-transform: uppercase;
    padding: 3px 9px; border-radius: 999px;
    background: var(--accent-soft); color: var(--text);
  }
  .family .tag.gold { background: rgba(240,180,41,.16); color: var(--gold); }

  /* Rouge : réservé à ce qui coûte de l'argent si on ne le lit pas. */
  .risk {
    background: var(--bg-soft); border-left: 3px solid var(--loss);
    border-radius: 8px; padding: 16px 18px; margin: 22px 0;
  }
  .risk p { margin: 0 0 10px; }
  .risk p:last-child { margin-bottom: 0; }

  .steps-pay { list-style: none; padding: 0; margin: 18px 0; counter-reset: pay; }
  .steps-pay li {
    position: relative; padding: 0 0 0 46px; margin: 0 0 16px;
    color: var(--text-dim); min-height: 32px;
  }
  .steps-pay li::before {
    counter-increment: pay; content: counter(pay);
    position: absolute; left: 0; top: 0;
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--accent); color: #06101f;
    font-weight: 800; font-size: .95rem;
    display: flex; align-items: center; justify-content: center;
  }
  .steps-pay b { color: var(--text); }

  .proof { list-style: none; padding: 0; margin: 18px 0; }
  .proof li {
    border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 12px;
    background: var(--bg-card); color: var(--text-dim); font-size: .94rem;
  }
  .proof b { display: block; color: var(--text); margin-bottom: 3px; }

  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-top: 14px; }
  .table-wrap table.recent { min-width: 460px; }

  .pairs { font-size: .88rem; color: var(--text-dim); }
  .price-line { font-size: 1.02rem; }
  .price-line b { color: var(--gold); }
"""

_ARCHIVES_EXTRA = """
  .honesty-banner {
    background: var(--bg-soft); border: 1px solid var(--border);
    border-left: 4px solid var(--gold); border-radius: var(--radius);
    padding: 16px 18px; font-size: .93rem; margin: 18px 0; color: var(--text-dim);
  }
  .archive-stats { font-size: 1.05rem; font-weight: 700; color: var(--gold); }
  .next-signal { font-size: .92rem; color: var(--text-dim); }
  .archive-row {
    display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 12px 14px; margin: 10px 0;
  }
  .archive-svg { flex: 0 0 auto; }
  .archive-info { flex: 1 1 220px; min-width: 0; }
  .archive-header { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .archive-pair { font-weight: 700; }
  .archive-side { font-size: .85rem; color: var(--text-dim); }
  .archive-outcome { font-size: .9rem; font-weight: 600; }
  .archive-detail { font-size: .85rem; color: var(--text-dim); margin-top: 2px; overflow-wrap: anywhere; }
"""


# Les trois moteurs diffusés. Le momentum 4 heures depuis le
# 07/08/2026. Décrits ici plutôt qu'en dur dans le HTML pour que la page
# d'accueil et le balisage schema.org ne puissent pas diverger — c'est exactement
# ce qui avait laissé la page décrire un moteur qui n'était plus diffusé.
FAMILIES = [
    ("Force relative",
     "Les 40 paires suivies sont classées chaque jour par momentum. Les 12 plus fortes sont "
     "achetées et tenues 7 jours, puis clôturées sur le temps — pas sur un prix.",
     "Directionnel"),
    ("Cassure de canal",
     "Achat quand le prix franchit son plus haut des 50 derniers jours. On n'anticipe pas la "
     "sortie du range, on attend qu'elle ait lieu.",
     "Directionnel"),
    ("Expansion de volatilité",
     "Après une longue phase de compression, le réveil de la volatilité déclenche l'entrée. "
     "C'est le plus rare des trois moteurs.",
     "Directionnel"),
    ("Carry de financement",
     "Position neutre au marché en deux jambes : achat au comptant + vente du perpétuel. "
     "Le prix n'entre pas dans l'équation ; le gain vient du financement encaissé.",
     "Neutre au marché"),
    ("Momentum 4 heures",
     "Le seul moteur qui ne travaille QUE lorsque le marché baisse : il occupe le créneau où "
     "les trois moteurs directionnels se taisent. Même classement que la force relative, mais "
     "sur des bougies de 4 heures, limité aux deux plus fortes et tenu 3 jours. Positif trois "
     "années sur quatre, en recul sur la dernière : il est publié en le disant.",
     "En observation"),
]


def _families_html():
    cards = "\n".join(
        f"""      <article class="family">
        <h3>{html.escape(name)}</h3>
        <p>{html.escape(desc)}</p>
        <span class="tag{' gold' if tag in ('Neutre au marché', 'En observation') else ''}">{html.escape(tag)}</span>
      </article>"""
        for name, desc, tag in FAMILIES
    )
    return f"""    <div class="family-grid">
{cards}
    </div>"""


def build_waiting_homepage(backtest_stats, telegram_bot_username):
    """
    Page d'accueil servie tant qu'aucun signal réel n'est enregistré en base.
    C'est en pratique LA page que voit un premier visiteur.

    `backtest_stats` (ligne active de strategy_params) n'est volontairement pas
    utilisé ici : son taux de réussite vient du backtest de l'ANCIEN moteur
    (achat sur RSI bas), désactivé le 03/08/2026 après avoir été mesuré comme
    la jambe perdante. L'afficher décrirait une stratégie qui n'est plus
    diffusée — c'est exactement le mécanisme qui a laissé un « 61,2 % de
    réussite » faux sur ce site pendant des mois. Le paramètre est conservé
    dans la signature parce que main.py l'appelle ainsi.
    """
    canonical_url = f"{SITE_BASE_URL}/"
    title = f"{SITE_NAME} — signaux crypto automatisés sur Telegram"
    description = (
        "Quatre familles de signaux crypto envoyées automatiquement sur Telegram, dont le carry "
        "de financement : une position neutre au marché à 84,2 % de positions gagnantes. "
        "2,99 signaux par jour en moyenne mesurée. Essai gratuit de 3 jours, sans moyen de paiement."
    )

    bot = html.escape(telegram_bot_username)
    carries = ", ".join(OPEN_CARRIES)
    # Liste dérivée de config.PAIRS plutôt que recopiée : la version écrite à la
    # main était restée à 28 paires alors que le moteur en analyse 40.
    pairs_line = ", ".join(pair.split("/")[0] for pair in PAIRS)

    # Précision au jour (pas à la minute) : voir Audit#11, github_publisher.py
    # compare le contenu généré à l'octet près pour éviter un commit à chaque
    # exécution horaire sans rien de nouveau -- un timestamp à la minute ici
    # rendrait cette comparaison inutile (le contenu différerait toujours).
    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
{social_tags(title, description, canonical_url)}
  <style>{_STYLE}{_HOME_EXTRA}</style>
</head>
<body>
  <header>
    <span class="status-pill"><span class="status-dot"></span>Bot en ligne — 4 familles de signaux</span>
    <h1>Des signaux crypto complets, envoyés automatiquement</h1>
    <p class="lead">Tu reçois sur Telegram la paire, le sens, le prix d'entrée, le stop et les objectifs
       — tout est fixé <b>avant</b> l'ouverture de la position, et jamais retouché après coup.</p>
    <p class="lead-sub">Quatre familles de signaux, validées sur 6 ans de données face à un témoin
       aléatoire. Aucune intervention humaine, aucune promesse de gain.</p>

    <div class="hero-cta">
      <a class="btn-main" href="https://t.me/{bot}">Ouvrir le bot Telegram →</a>
      <p class="btn-note">Essai gratuit de 3 jours. Aucun moyen de paiement, aucun email demandé.</p>
    </div>
  </header>

  <section>
    <h2>Où en est le marché aujourd'hui</h2>
    <p>Au {MARKET_STATE_DATE}, le Bitcoin est <b>sous</b> sa moyenne mobile 200 jours. Les trois
       familles directionnelles sont donc à l'arrêt&nbsp;: elles n'ont pas le droit d'acheter dans
       ces conditions, et c'est la règle qui les protège.</p>
    <p>Le carry de financement, lui, continue. Quatre positions sont ouvertes à cette date&nbsp;:
       <b>{html.escape(carries)}</b>. C'est le seul de nos quatre moteurs qui produise quand le
       marché baisse — d'où la section suivante.</p>
    <p class="note-left">Chaque ouverture et chaque clôture est publiée sur le
       <a href="{TELEGRAM_CHANNEL_URL}">canal public</a>, en direct et sans tri. Tape
       <code>/marche</code> sur le bot pour l'état du filtre à la seconde près.</p>
  </section>

  <div class="carry">
    <h2>Le carry de financement, expliqué simplement</h2>
    <p class="lead">C'est la partie du produit dont nous sommes le plus fiers, et la plus facile à
       comprendre&nbsp;: <b>le prix ne compte pas.</b></p>

    <div class="legs">
      <div class="leg">
        <b>Jambe 1 — tu achètes au comptant</b>
        <span>100 € de la crypto choisie, détenue normalement.</span>
      </div>
      <div class="leg">
        <b>Jambe 2 — tu vends le perpétuel</b>
        <span>100 € du même actif, à découvert, sur le contrat perpétuel.</span>
      </div>
    </div>

    <p class="leg-result">Si le prix monte, la jambe 1 gagne exactement ce que la jambe 2 perd. S'il
       baisse, l'inverse. Les deux s'annulent&nbsp;: <b>la position ne dépend plus du marché.</b></p>

    <p>Reste alors une seule chose. Toutes les 8 heures, les acheteurs de contrats perpétuels versent
       un <b>financement</b> aux vendeurs. Comme il y a structurellement plus d'acheteurs à levier que
       de vendeurs, ce financement est le plus souvent positif — et le vendeur l'encaisse. Nous
       sommes vendeurs. La position est tenue 21 jours, le temps d'accumuler ce financement.</p>

    <div class="kpis">
      <div class="kpi"><b class="gold">84,2 %</b><span>de positions gagnantes</span></div>
      <div class="kpi"><b>+0,572 %</b><span>net par position, frais déduits</span></div>
      <div class="kpi"><b>6 / 7</b><span>années positives</span></div>
      <div class="kpi"><b>1,15</b><span>signal/jour même en marché baissier</span></div>
    </div>
    <p class="note-left">La septième année, 2022, sort à -0,046 % par position
       — plate, pas perdante. C'est l'année où détenir simplement des cryptos a été catastrophique.</p>

    <div class="risk">
      <p><b>Ce n'est pas « sans risque », et nous ne l'écrirons jamais.</b> La jambe vendeuse est une
         position à marge&nbsp;: si la marge devient insuffisante, elle peut être liquidée, et la
         couverture disparaît. S'ajoute le risque de plateforme — tes fonds sont chez un exchange.</p>
      <p>Le financement peut aussi <b>s'inverser</b> lors d'un emballement du marché&nbsp;: ce sont
         alors les vendeurs qui paient. Un stop ferme les deux jambes dès que la position a coûté
         1,5 %, mais une seule journée à financement extrême peut passer devant ce stop&nbsp;:
         <b>-19,86 % sur une position</b> reste le pire cas mesuré. Il faut le savoir avant d'entrer.</p>
    </div>
  </div>

  <section>
    <h2>Les trois moteurs</h2>
    <p>Elles ne se ressemblent pas, et c'est le but&nbsp;: quand l'une s'arrête, les autres peuvent
       continuer. Les trois premières achètent — elles sont donc coupées quand le Bitcoin passe sous
       sa moyenne 200 jours. La quatrième ne dépend pas de la direction du marché.</p>
{_families_html()}
    <p>Sur les familles directionnelles, le stop est large (4 x ATR)&nbsp;: il n'est là que contre
       l'accident. Les objectifs (4, 8 et 12 x ATR) jalonnent la progression mais ne pilotent pas la
       clôture — c'est le temps qui clôture.</p>
  </section>

  <section>
    <h2>Les chiffres, tels qu'ils ont été mesurés</h2>
    <p>Backtest sur 6 ans, entrée décalée d'un jour, frais réels déduits, et chaque famille confrontée
       à un témoin aléatoire&nbsp;: une famille qui ne bat pas un tirage au sort à contraintes égales
       est jetée. Trois l'ont été.</p>

    <div class="kpis">
      <div class="kpi"><b>4,35</b><span>signaux/jour en marché favorable</span></div>
      <div class="kpi"><b>1,15</b><span>signaux/jour en marché défavorable</span></div>
      <div class="kpi"><b class="gold">2,99</b><span>signaux/jour en moyenne</span></div>
      <div class="kpi"><b>80 %</b><span>des jours ont au moins un signal</span></div>
    </div>

    <h3>Ce qu'un abonné peut réellement attendre</h3>
    <p>Le chiffre honnête n'est pas un rendement annuel de backtest — personne n'entre au premier jour
       d'un backtest. Le chiffre honnête est celui-ci&nbsp;: si tu commences à suivre les signaux à une
       date tirée au hasard dans ces 6 ans, voici où tu en es six mois plus tard.</p>
    <div class="table-wrap">
      <table class="recent">
        <thead><tr><th>Après 6 mois</th><th>Résultat médian</th><th>Entrées gagnantes</th><th>Pire cas mesuré</th></tr></thead>
        <tbody>
          <tr><td>Entrée à une date au hasard</td><td>+5,0 %</td><td>53 %</td><td class="outcome-loss">-61,7 %</td></tr>
        </tbody>
      </table>
    </div>
    <p>Une entrée sur deux est gagnante, la médiane est légèrement positive, et dans le pire cas mesuré
       on perd plus de la moitié du capital engagé. C'est une stratégie qui demande de la durée et de la
       tolérance à la perte. Si cette ligne te fait reculer, elle a fait son travail.</p>

    <div class="risk">
      <p><b>Il faut prendre TOUS les signaux directionnels.</b> Ces familles réussissent environ une
         fois sur deux, et le signal <b>médian perd 0,69 %</b>. La rentabilité vient d'une minorité de
         très gros gagnants.</p>
      <p>Autrement dit&nbsp;: en trier quelques-uns « au feeling » revient statistiquement à ne garder
         que la partie perdante. Le carry est l'exception — chaque position y est individuellement
         satisfaisante — mais sur les trois autres familles, choisir, c'est perdre.</p>
    </div>
  </section>

  <section>
    <h2>Les silences, dits avant le paiement</h2>
    <p>Le filtre de tendance a été fermé <b>41 % du temps</b> sur les 6 dernières années, avec une
       fermeture record de <b>381 jours</b> d'affilée, du 28/12/2021 au 13/01/2023. Pendant ces
       périodes, la force relative n'émet rien du tout.</p>
    <p>Depuis l'ajout du carry, ces périodes ne sont plus vides&nbsp;: il reste 1,15 signal par jour en
       moyenne mesurée. Mais un jour sur cinq n'a toujours aucun signal, et <b>l'abonnement court au
       calendrier</b> — il n'est ni suspendu, ni prolongé pendant les jours creux. Les
       <a href="/terms.html">conditions générales</a> l'écrivent noir sur blanc, avant l'achat.</p>
    <p>Pourquoi assumer ce filtre&nbsp;? Parce que c'est lui qui empêche les familles directionnelles
       d'acheter pendant les grandes baisses. Ne rien envoyer est une décision, pas une panne.</p>
  </section>

  <section>
    <h2>Le paiement se fait en crypto. Voilà comment.</h2>
    <p>Pas de carte bancaire&nbsp;: nous ne collectons aucune donnée bancaire, aucun nom, aucun email.
       C'est un choix assumé, et c'est aussi la principale difficulté du parcours si tu n'as jamais
       payé en crypto. Alors autant l'expliquer en entier.</p>
    <p class="price-line"><b>D'abord, tu ne paies rien&nbsp;:</b> l'essai de 3 jours ne demande aucun
       moyen de paiement. Tu vois les vrais signaux avant de décider quoi que ce soit.</p>
    <ol class="steps-pay">
      <li><b>Tu choisis ta formule</b> avec <code>/subscribe</code> sur le bot&nbsp;: 5 USDT pour
          14 jours (offre de lancement) ou 19 USDT pour 30 jours.</li>
      <li><b>Tu choisis ta crypto</b>&nbsp;: USDT sur le réseau Polygon (quelques centimes de frais de
          réseau), Litecoin, ou Monero.</li>
      <li><b>Le bot affiche un montant et une adresse à toi.</b> Tu envoies depuis l'endroit où tu as
          déjà des cryptos — ton exchange ou ton wallet. Vérifie l'adresse <b>et</b> le réseau&nbsp;:
          un envoi blockchain est irréversible, personne ne peut l'annuler.</li>
      <li><b>L'accès s'ouvre tout seul</b> en quelques minutes, dès que la transaction est confirmée.
          Aucune action de ta part, aucun renouvellement automatique, aucun prélèvement&nbsp;: le bot
          ne mémorise aucun moyen de paiement.</li>
    </ol>
    <p class="note-left">Si tu n'as jamais fait de retrait crypto, écris-le au
       bot avant de payer&nbsp;: mieux vaut poser la question que de se tromper de réseau.</p>
  </section>

  <section>
    <h2>Ce que tu peux vérifier toi-même</h2>
    <p>Ce projet est jeune et n'a pas d'avis clients à afficher. Plutôt que d'inventer des témoignages
       — la norme du secteur —, voici ce qui est réellement vérifiable, tout de suite&nbsp;:</p>
    <ul class="proof">
      <li><b>Le code source est public</b>
        La stratégie, les backtests, et jusqu'aux analyses qui ont conclu que le moteur précédent était
        perdant et l'ont fait désactiver&nbsp;:
        <a href="https://github.com/AYMERICLEGOAT/crypto-signals-bot" rel="noopener">le dépôt GitHub</a>.</li>
      <li><b>Le journal de trading est public</b>
        Chaque position ouverte et chaque clôture, gains comme pertes, sur le
        <a href="{TELEGRAM_CHANNEL_URL}">canal Telegram public</a> — sans tri, sans rattrapage.</li>
      <li><b>Les résultats réels sont publiés</b>
        La page <a href="/transparency.html">Transparence</a> affiche ce que le service a vraiment
        produit, y compris quand c'est modeste ou négatif.</li>
      <li><b>Les règles sont écrites avant l'achat</b>
        Les périodes creuses, l'absence de remboursement et l'absence de garantie sont dans les
        <a href="/terms.html">conditions générales</a>, pas dans une note de bas de page.</li>
    </ul>
  </section>

  <div class="cta">
    <p><b>Juge sur pièces, sans rien payer</b></p>
    <p>3 jours d'essai gratuit. Aucun moyen de paiement, aucun email.
       Vérifie d'abord l'état du marché avec <code>/marche</code>.</p>
    <a href="https://t.me/{bot}">Ouvrir le bot Telegram →</a>
  </div>

  <section>
    <h2>Pour aller plus loin</h2>
    <p><a href="/comment-ca-marche.html">Comment ça marche</a> détaille les trois moteurs étape par
       étape. <a href="/a-propos.html">À propos</a> raconte d'où vient ce projet et ce qu'il ne fait
       pas. <a href="/glossaire.html">Le glossaire</a> et les <a href="/guides/">guides</a> expliquent
       les termes employés dans un signal.</p>
    <p class="pairs"><b>Les 40 paires suivies par les familles directionnelles&nbsp;:</b>
       {html.escape(pairs_line)} — toutes en /USDT. Le carry, lui, travaille sur les perpétuels les
       plus échangés qui disposent aussi d'une paire au comptant.</p>
  </section>

  <p class="disclaimer">Ceci n'est pas un conseil en investissement et ne constitue pas une
     recommandation personnalisée. Le trading de cryptoactifs comporte un risque de perte en capital,
     pouvant aller jusqu'à la perte totale des sommes engagées. Les performances passées, backtestées
     ou réelles, ne préjugent en rien des performances futures. Aucun gain n'est promis.</p>

  <footer>
    <p>Page générée automatiquement le {footer_ts}. —
       <a href="/privacy.html">Confidentialité</a> —
       <a href="/terms.html">Conditions générales</a> —
       <a href="/transparency.html">Transparence</a> —
       <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""


def build_archives_page(trades, backtest_stats, canonical_path="/archives.html"):
    """
    `trades` : liste de lignes backtest_trades (peut être vide).
    `backtest_stats` : ligne active de strategy_params, ou None.
    """
    canonical_url = f"{SITE_BASE_URL}{canonical_path}"
    title = f"Archives du backtest — exemples de trades — {SITE_NAME}"
    description = (
        "Exemples de trades issus du backtest de la stratégie (données historiques réelles Binance), "
        "avec leurs résultats détaillés. Ce ne sont pas des signaux envoyés à des abonnés."
    )

    if backtest_stats:
        win_rate_pct = float(backtest_stats["win_rate"]) * 100
        trade_count = int(backtest_stats["trade_count"])
        avg_days = BACKTEST_WINDOW_DAYS / trade_count if trade_count else None
        if avg_days is None:
            next_signal_line = ""
        elif avg_days < 1:
            next_signal_line = f"<p class=\"next-signal\">📡 Fréquence historique : environ un signal toutes les {avg_days * 24:.0f} heures (moyenne sur le backtest).</p>"
        else:
            next_signal_line = f"<p class=\"next-signal\">📡 Fréquence historique : environ un signal tous les {avg_days:.1f} jours (moyenne sur le backtest, pas une garantie de timing).</p>"
        stats_line = _backtest_stat_html(win_rate_pct, trade_count)
    else:
        stats_line = ""
        next_signal_line = ""

    if trades:
        rows_html = "".join(_trade_row_html(t) for t in trades)
    else:
        rows_html = "<p>Aucun exemple de trade enregistré pour le moment — reviens après le prochain backtest.</p>"

    # Précision au jour (pas à la minute) : voir Audit#11, github_publisher.py
    # compare le contenu généré à l'octet près pour éviter un commit à chaque
    # exécution horaire sans rien de nouveau -- un timestamp à la minute ici
    # rendrait cette comparaison inutile (le contenu différerait toujours).
    footer_ts = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{canonical_url}">
{social_tags(title, description, canonical_url)}
  <style>{_STYLE}{_ARCHIVES_EXTRA}</style>
</head>
<body>
  <header>
    <h1>Archives du backtest</h1>
    <p class="subtitle">Exemples de trades issus de la simulation de la stratégie</p>
  </header>

  <div class="honesty-banner">
    ⚠️ <strong>Important</strong> : les trades ci-dessous proviennent d'un <strong>backtest</strong>
    (simulation sur des données historiques réelles Binance) — ce ne sont <strong>pas</strong> des
    signaux réellement envoyés à des abonnés. Les dates sont les vraies dates des bougies utilisées
    dans la simulation. Tape <code>/demo</code> sur le bot Telegram pour voir le format d'un
    signal, ou <code>/trial</code> pour recevoir de vrais signaux en direct.
  </div>

  {stats_line}
  {next_signal_line}

  <section>
    {rows_html}
  </section>

  <div class="cta">
    <p><b>Voir les vrais signaux, en direct</b></p>
    <p>3 jours d'essai gratuit, aucun moyen de paiement demandé.</p>
    <a href="https://t.me/{html.escape(TELEGRAM_BOT_USERNAME)}">Ouvrir le bot Telegram →</a>
  </div>

  <p class="disclaimer">Performance passée (et a fortiori issue d'un backtest optimisé in-sample) ne garantit pas les performances futures. Contenu éducatif, pas un conseil en investissement.</p>

  <footer>
    <p>Page générée automatiquement le {footer_ts}. — <a href="/">Accueil</a> — <a href="/privacy.html">Politique de confidentialité</a> — <a href="/terms.html">Conditions générales</a> — <a href="/transparency.html">Transparence</a> — <a href="/mentions-legales.html">Mentions légales</a></p>
  </footer>
</body>
</html>"""
