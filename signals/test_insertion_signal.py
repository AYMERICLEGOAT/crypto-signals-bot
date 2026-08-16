"""
Un signal détecté ne doit JAMAIS être perdu à l'écriture.

CE QUI S'EST PASSÉ LE 16/08/2026, premier passage du moteur Faiblesse 4H :

    [ERROR] Échec de l'insertion du signal dans Supabase: {'pair': 'FET/USDT',
            'type': 'SELL', ..., 'f4h_rang': 1, 'f4h_heures': 72}
    postgrest.exceptions.APIError: Could not find the 'f4h_heures' column of
            'signals' in the schema cache

Les DEUX ventes du moteur — les seules qu'il ait jamais produites — ont été
refusées par la base. Pas à cause du moteur : à cause d'une liste d'EXCEPTIONS
codée en dur dans main.py, qui retirait les métadonnées connues (candle_ts_ms,
rs_rank, carry_rank, m4h_rang…) et ignorait forcément celles d'un moteur écrit
après elle.

Un signal est l'événement le plus rare et le plus précieux du cycle. Le perdre
à l'écriture est la pire issue possible, et une liste d'exceptions garantit que
ça se reproduira au prochain moteur.

Le tri se fait désormais contre le SCHÉMA RÉEL, à la frontière de la base. Ce
fichier vérifie les deux directions : rien d'inconnu ne passe, et rien de
légitime n'est jeté.

Usage : python test_insertion_signal.py
"""

import storage

echecs = []


def verifier(condition, libelle):
    print(("  OK   " if condition else "  ECHEC ") + libelle)
    if not condition:
        echecs.append(libelle)


def filtre(signal):
    """Reproduit exactement le tri de storage.insert_signal, sans toucher au réseau."""
    return {k: v for k, v in signal.items() if k in storage.COLONNES_SIGNALS}


print("=" * 60)
print("INSERTION D'UN SIGNAL")
print("=" * 60)

# Le signal EXACT qui a été refusé en production, métadonnées comprises.
vente = {
    "pair": "FET/USDT", "type": "SELL", "entry_price": 0.1244,
    "stop_loss": 0.13348479, "take_profit": 0.10623042,
    "tp1_price": 0.11531521, "tp2_price": 0.10623042, "tp3_price": 0.09714563,
    "created_at": "2026-08-16T08:42:10+00:00", "engine": "faiblesse_4h",
    "hold_until": "2026-08-19T08:42:10+00:00",
    "chart_url": "https://exemple.test/fet.png",
    "f4h_rang": 1, "f4h_heures": 72,
}

print("\n--- Le cas qui a casse la production ---")
propre = filtre(vente)
verifier("f4h_rang" not in propre and "f4h_heures" not in propre,
         "les metadonnees f4h_* sont ecartees")
verifier(propre["type"] == "SELL", "le type SELL est conserve")
verifier(propre["engine"] == "faiblesse_4h", "le moteur est conserve")
verifier(propre["chart_url"] == vente["chart_url"], "le graphique est conserve")

print("\n--- Toutes les familles de metadonnees connues ---")
# Chacune vient d'un moteur different : si une seule passait, l'insertion
# entiere echouerait de nouveau.
metadonnees = {
    "candle_ts_ms": 1, "rs_rank": 2, "rs_rsi": 3, "rs_hold_days": 4,
    "carry_rate_per_day": 5, "carry_rank": 6, "carry_source": "x",
    "m4h_rang": 7, "m4h_heures": 8, "f4h_rang": 9, "f4h_heures": 10,
}
avec = filtre({**vente, **metadonnees})
verifier(all(k not in avec for k in metadonnees),
         "aucune metadonnee connue ne franchit le filtre")

print("\n--- La propriete qui compte pour l'AVENIR ---")
# C'est tout l'objet du correctif : un moteur ecrit demain, avec des cles que
# personne n'a prevues, ne doit pas pouvoir casser l'insertion.
inconnues = {"xyz_rang": 1, "futur_moteur_detail": "abc", "z9_truc": None}
verifier(all(k not in filtre({**vente, **inconnues}) for k in inconnues),
         "une metadonnee JAMAIS VUE est ecartee elle aussi")

print("\n--- Rien de legitime n'est jete ---")
# L'erreur symetrique serait pire : ecarter une vraie colonne ferait perdre
# l'information en silence, sans meme une erreur d'insertion.
complet = {
    "pair": "BTC/USDT", "type": "BUY", "entry_price": 1.0, "stop_loss": 0.9,
    "take_profit": 1.2, "created_at": "x", "chart_url": "u", "engine": "e",
    "tp1_price": 1.1, "tp2_price": 1.2, "tp3_price": 1.3, "hold_until": "y",
    "confidence_score": 70, "carry_expected_pct": 0.5,
}
garde = filtre(complet)
manquantes = sorted(set(complet) - set(garde))
verifier(not manquantes, "toutes les vraies colonnes passent (%s)" % (manquantes or "aucune perdue"))

print("\n--- La liste blanche decrit bien la table ---")
for obligatoire in ("pair", "type", "entry_price", "engine", "sent", "outcome", "hold_until"):
    verifier(obligatoire in storage.COLONNES_SIGNALS, f"la colonne {obligatoire} est connue")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} verification(s) en echec :")
    for e in echecs:
        print("  -", e)
    raise SystemExit(1)
print("Toutes les verifications passent.")
