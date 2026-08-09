"""
Le publieur Discord plantait sur les signaux de carry.

Les runs des 5, 6 et 7 aout 2026 ont echoue, et ce sont exactement les trois
jours ou le moteur de carry a produit. La cause : format_price(None) sur des
colonnes stop_loss / take_profit vides, qui le sont TOUJOURS pour un carry
puisque sa sortie est une date et non un prix.

Le canal Discord est l'un des rares canaux d'acquisition encore ouverts a ce
projet (Twitter et Reddit sont fermes). Le voir tomber precisement pendant les
periodes de marche defavorable — celles ou le carry est le seul moteur a
produire — revient a le perdre au moment ou il sert le plus.
"""

import pytest

from content_templates import format_discord_embed


CARRY = {
    "id": 1,
    "pair": "HMSTR/USDT",
    "type": "CARRY",
    "entry_price": "0.0001977",
    "stop_loss": None,
    "take_profit": None,
    "chart_url": None,
}

DIRECTIONNEL = {
    "id": 2,
    "pair": "TAO/USDT",
    "type": "BUY",
    "entry_price": "203.7",
    "stop_loss": "190.38934024",
    "take_profit": "230.32131952",
    "chart_url": None,
}


def _embed(signal):
    return format_discord_embed(signal)["embeds"][0]


def test_un_carry_ne_fait_plus_planter_la_publication():
    """Le bug d'origine : une exception, donc aucune publication du tout."""
    embed = _embed(CARRY)
    assert embed["title"]


def test_un_carry_n_est_jamais_annonce_comme_une_vente():
    # _side_label teste `type == "BUY"` : sans traitement dedie, un CARRY
    # tombait dans la branche VENTE. Presenter au public une position neutre
    # au marche comme un pari baissier est faux.
    embed = _embed(CARRY)
    assert "VENTE" not in embed["title"]
    assert "ACHAT" not in embed["title"]
    valeurs = " ".join(c["value"] for c in embed["fields"])
    assert "neutre" in valeurs


def test_un_carry_n_affiche_ni_stop_ni_objectif():
    # Les afficher supposerait des valeurs qui n'existent pas, et laisserait
    # croire a une gestion en prix alors que la sortie est temporelle.
    noms = [c["name"] for c in _embed(CARRY)["fields"]]
    assert "Stop loss" not in noms
    assert "Take profit" not in noms


def test_un_carry_n_est_ni_vert_ni_rouge():
    # Le vert et le rouge annoncent une direction. Un carry n'en a pas.
    couleur = _embed(CARRY)["color"]
    assert couleur not in (0x16A34A, 0xDC2626)


@pytest.mark.parametrize(
    "type_signal, attendu, couleur",
    [("BUY", "ACHAT", 0x16A34A), ("SELL", "VENTE", 0xDC2626)],
)
def test_les_signaux_directionnels_sont_inchanges(type_signal, attendu, couleur):
    """Non-regression : le correctif ne devait toucher que la branche carry."""
    embed = _embed(dict(DIRECTIONNEL, type=type_signal))
    assert attendu in embed["title"]
    assert embed["color"] == couleur
    noms = [c["name"] for c in embed["fields"]]
    assert noms == ["Entrée", "Stop loss", "Take profit"]
