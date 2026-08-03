"""
Persistance des signaux générés dans Supabase (PostgreSQL gratuit).
Utilise le client officiel `supabase-py` (simple appel REST, pas besoin
de compiler de driver PostgreSQL natif).
"""

import logging
from datetime import datetime, timedelta, timezone

from supabase import create_client, Client

import config
from config import SUPABASE_URL, SUPABASE_KEY, SUPABASE_STORAGE_BUCKET

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_KEY manquants. Renseigne le fichier .env "
                "(voir .env.example)."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def insert_signal(signal: dict) -> bool:
    """
    Insère un signal dans la table `signals`. `sent` démarre à False.
    Retourne False sur échec (clé invalide, RLS, quota, schéma changé...)
    au lieu de seulement journaliser -- avant ce correctif, un signal
    détecté (l'événement le plus rare et le plus précieux du cycle) pouvait
    disparaître silencieusement à l'écriture : heartbeat vert, aucune
    alerte, symptôme identique au "3 jours sans signal" du 29/07 (commit
    c067484) mais côté écriture plutôt que lecture de données. L'appelant
    (main.py) alerte l'admin immédiatement si ceci retourne False.
    """
    payload = {**signal, "sent": False}
    try:
        get_client().table("signals").insert(payload).execute()
        logger.info("Signal enregistré: %s %s @ %s", signal["pair"], signal["type"], signal["entry_price"])
        return True
    except Exception:
        logger.exception("Échec de l'insertion du signal dans Supabase: %s", signal)
        return False


def pairs_signalled_since(hours: int) -> set:
    """
    Paires ayant déjà reçu un signal dans les `hours` dernières heures.
    Anti-doublon de la fenêtre de rattrapage (voir
    config.SIGNAL_CATCHUP_CANDLES) : sans ce garde-fou, chaque cycle
    réémettrait les mêmes croisements tant qu'ils restent dans la fenêtre
    balayée. Une seule requête par cycle plutôt qu'une par paire.

    En cas d'échec, retourne un ensemble VIDE : ce sens de dégradation est
    délibéré côté "on laisse passer" plutôt que "on bloque tout" — un doublon
    occasionnel est gênant, un blocage total de la génération le serait
    beaucoup plus (même logique que count_open_at_risk_trades ci-dessous).
    """
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        resp = (
            get_client()
            .table("signals")
            .select("pair")
            .gte("created_at", since)
            .execute()
        )
        return {row["pair"] for row in (resp.data or [])}
    except Exception:
        logger.exception("Échec de la lecture des signaux récents (anti-doublon), traité comme aucun.")
        return set()


def pairs_signalled_by_engine(engine: str, hours: int) -> set:
    """
    Paires signalées par un moteur donné dans les `hours` dernières heures.

    Sert au moteur Force Relative (relative_strength.py), où anti-doublon et
    « position déjà ouverte » sont le même mécanisme : la stratégie validée
    détient chaque paire RS_HOLD_DAYS jours et ne compte que les ENTRÉES
    réelles. Le filtrage par moteur est indispensable — une paire signalée par
    le moteur Haute Confiance ne doit pas empêcher le moteur Force Relative de
    l'inclure dans son classement, les deux stratégies étant indépendantes.

    Même sens de dégradation que pairs_signalled_since : en cas d'échec on
    retourne un ensemble VIDE, donc « rien n'est ouvert ». Ici ce choix est
    moins anodin, puisqu'il peut produire un doublon de signal ; il reste
    préférable à un blocage total, et le verrou de portefeuille en aval
    (config.MAX_ACTIVE_TRADES) plafonne les dégâts.
    """
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        resp = (
            get_client()
            .table("signals")
            .select("pair")
            .eq("engine", engine)
            .gte("created_at", since)
            .execute()
        )
        return {row["pair"] for row in (resp.data or [])}
    except Exception:
        logger.exception(
            "Échec de la lecture des signaux récents du moteur %s, traité comme aucun. "
            "Un doublon est possible ce cycle.", engine,
        )
        return set()


def count_open_at_risk_trades() -> int:
    """
    Verrou de portefeuille (voir config.MAX_ACTIVE_TRADES) : nombre de
    signaux encore ouverts ET pas encore sécurisés à TP1 (outcome NULL,
    breakeven_active=false). Un signal qui a atteint TP1 ne compte plus
    comme "à risque" — il ne peut plus finir perdant (voir
    workers/main-worker/src/cron/trackSignalOutcomes.ts, même règle côté
    Worker). Retourne 0 en cas d'échec (dégradation prudente : mieux vaut
    sous-compter et risquer un slot en trop qu'empêcher toute génération de
    signal si Supabase est temporairement indisponible).
    """
    try:
        resp = (
            get_client()
            .table("signals")
            .select("id", count="exact")
            .is_("outcome", "null")
            .eq("breakeven_active", False)
            .execute()
        )
        return resp.count or 0
    except Exception:
        logger.exception("Échec du comptage des positions à risque (verrou de portefeuille), traité comme 0.")
        return 0


def insert_volatility_suspensions(events: list) -> None:
    """
    Bloc 11.3 : enregistre les suspensions de signal pour volatilité
    anormale (ATR > VOLATILITY_SUSPENSION_ATR_PCT du prix). Échec non
    bloquant, comme insert_momentum_alerts.
    """
    if not events:
        return
    payload = [{**event, "sent_to_channel": False} for event in events]
    try:
        get_client().table("volatility_suspensions").insert(payload).execute()
        logger.info("%d suspension(s) pour volatilité enregistrée(s).", len(payload))
    except Exception:
        logger.exception("Échec de l'enregistrement des suspensions de volatilité dans Supabase: %s", payload)


def insert_momentum_alerts(alerts: list) -> None:
    """
    Insère les Alertes Momentum (Bloc 3) détectées ce cycle. Échec non
    bloquant (comme insert_signal) : une alerte momentum manquante ne doit
    jamais faire échouer la génération des vrais signaux.
    """
    if not alerts:
        return
    payload = [{**alert, "sent_to_channel": False} for alert in alerts]
    try:
        get_client().table("momentum_alerts").insert(payload).execute()
        logger.info("%d alerte(s) momentum enregistrée(s).", len(payload))
    except Exception:
        logger.exception("Échec de l'insertion des alertes momentum dans Supabase: %s", payload)


def record_source_health(pairs_with_data: int, total_pairs: int) -> tuple[int, bool]:
    """
    Suivi des pannes totales de source de données (Binance+CoinGecko+
    Coinbase+Kraken tous en échec pour TOUTES les paires le même cycle) --
    distinct de record_heartbeat ci-dessous, qui se rafraîchit même quand 0
    paire n'a de donnée (le job Python se termine "avec succès" au sens
    process, même sans aucune donnée récupérée : 0 signal est un état
    normal et fréquent, mais 0 paire avec donnée signale une vraie panne).

    Retourne (cycles consécutifs en panne totale après mise à jour, si
    l'appelant doit alerter MAINTENANT). Le deuxième élément n'est True
    qu'une seule fois par panne (dès que le seuil est franchi), pas à
    chaque cycle en panne tant qu'elle continue -- comme
    system_heartbeats.alerted pour l'alerte "job pas relancé depuis 3h"
    (voir workers/main-worker/src/cron/monitorSignalsHeartbeat.ts), remis à
    False dès qu'une paire a de nouveau une donnée. Échec Supabase traité
    comme (0, False) : dégradation prudente, mieux vaut manquer une alerte
    que planter le job pour un problème de suivi secondaire.
    """
    if pairs_with_data > 0:
        try:
            get_client().table("system_heartbeats").update(
                {"consecutive_source_failures": 0, "source_outage_alerted": False}
            ).eq("job_name", "signals").execute()
        except Exception:
            logger.exception("Échec de la réinitialisation du compteur de pannes de source.")
        return 0, False

    logger.warning("Panne totale des sources de données ce cycle (0/%d paires avec donnée).", total_pairs)
    try:
        row = (
            get_client().table("system_heartbeats")
            .select("consecutive_source_failures,source_outage_alerted")
            .eq("job_name", "signals")
            .execute()
        )
        current = row.data[0]["consecutive_source_failures"] if row.data else 0
        already_alerted = bool(row.data[0]["source_outage_alerted"]) if row.data else False
    except Exception:
        logger.exception("Échec de lecture du compteur de pannes de source, traité comme 0.")
        current, already_alerted = 0, False

    new_count = current + 1
    should_alert = new_count >= config.DATA_OUTAGE_ALERT_THRESHOLD_CYCLES and not already_alerted
    try:
        update = {"consecutive_source_failures": new_count}
        if should_alert:
            update["source_outage_alerted"] = True
        get_client().table("system_heartbeats").update(update).eq("job_name", "signals").execute()
    except Exception:
        logger.exception("Échec de la mise à jour du compteur de pannes de source.")
    return new_count, should_alert


def daily_job_already_ran_today(job_name: str, hour_utc: int) -> bool:
    """
    Ce job quotidien a-t-il déjà tourné depuis l'heure cible d'aujourd'hui ?

    Pourquoi ce détour plutôt qu'une simple fenêtre horaire. Le moteur Force
    Relative ne doit tourner qu'une fois par jour, après la clôture. La première
    version le déclenchait quand l'horloge était entre RS_RUN_HOUR_UTC h 00 et
    h 15. C'était fragile au point d'être faux : le workflow GitHub Actions est
    planifié toutes les 30 minutes mais ses déclenchements sont régulièrement
    retardés de 10 à 20 minutes — l'en-tête de .github/workflows/signals.yml le
    documente déjà. Un retard de plus de 15 minutes faisait rater la fenêtre, et
    le suivant tombait à h 30, hors fenêtre lui aussi : la journée entière
    passait sans le moindre signal, silencieusement.

    Ici on ne demande plus « quelle heure est-il » mais « est-ce déjà fait ».
    Le premier passage à partir de l'heure cible déclenche le moteur, quel que
    soit le retard, et les suivants sont ignorés.

    En cas d'échec de lecture, retourne True — donc on ne tourne PAS. Ce sens
    de dégradation est l'inverse des autres fonctions de ce module, et c'est
    délibéré : ne pas émettre coûte une journée de signaux, tandis qu'émettre en
    boucle sur une base injoignable enverrait le même signal à répétition aux
    abonnés.
    """
    now = datetime.now(timezone.utc)
    if now.hour < hour_utc:
        return True  # trop tôt dans la journée, l'heure cible n'est pas atteinte
    cible = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    try:
        resp = (
            get_client().table("system_heartbeats")
            .select("last_run_at")
            .eq("job_name", job_name)
            .execute()
        )
        if not resp.data or not resp.data[0].get("last_run_at"):
            return False
        dernier = datetime.fromisoformat(resp.data[0]["last_run_at"].replace("Z", "+00:00"))
        return dernier >= cible
    except Exception:
        logger.exception(
            "Échec de lecture du dernier passage de %s : le moteur ne tourne pas ce cycle "
            "(mieux vaut une journée sans signal qu'une répétition envoyée aux abonnés).",
            job_name,
        )
        return True


def record_heartbeat(job_name: str) -> None:
    """
    Bloc 8 — surveillance de fraîcheur GitHub Actions : marque que ce job a
    tourné jusqu'au bout avec succès. Le Worker (cron/monitorSignalsHeartbeat.ts)
    alerte l'administrateur si ce timestamp devient trop vieux (le workflow
    GitHub Actions horaire a dû s'arrêter silencieusement). `alerted` est
    remis à False à chaque heartbeat réussi, pour permettre une nouvelle
    alerte si une panne future survient après une reprise.
    """
    try:
        get_client().table("system_heartbeats").upsert(
            {"job_name": job_name, "last_run_at": _now_iso(), "alerted": False}, on_conflict="job_name"
        ).execute()
    except Exception:
        logger.exception("Échec de l'enregistrement du heartbeat pour %s.", job_name)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def upload_chart(local_path: str, remote_filename: str) -> str | None:
    """
    Envoie le PNG généré par chart_generator.py vers Supabase Storage et
    retourne son URL publique (ou None en cas d'échec — un signal sans
    graphique reste utile, mieux vaut ne pas bloquer l'insertion pour ça).
    Le bucket (SUPABASE_STORAGE_BUCKET, "signal-charts" par défaut) doit
    exister et être public — à créer une fois via le Dashboard Supabase
    (voir README).
    """
    try:
        with open(local_path, "rb") as f:
            data = f.read()
        bucket = get_client().storage.from_(SUPABASE_STORAGE_BUCKET)
        bucket.upload(remote_filename, data, {"content-type": "image/png", "upsert": "true"})
        return bucket.get_public_url(remote_filename)
    except Exception:
        logger.exception("Échec de l'envoi du graphique %s vers Supabase Storage.", remote_filename)
        return None
