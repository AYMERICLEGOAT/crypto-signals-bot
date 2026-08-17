"""
LA LISTE DU JOUR ÉTAIT LE SEUL MESSAGE DU PRODUIT INVISIBLE AU RÉGULATEUR.

`channelBudget.ts` décide de tout ce qui part sur un canal à partir d'une seule
table, `channel_posts` : le plafond quotidien (8 messages sur le canal public),
l'espacement minimal (20 minutes), et la définition de « le canal s'est-il
tu ? » dont dépend le rappel automatique.

La liste du jour est publiée depuis Python, pas depuis le Worker, et n'écrivait
rien dans cette table. Elle échappait donc aux trois règles à la fois. Le relevé
du 17/08/2026 montre le résultat : 10 messages sur un canal plafonné à 8, dont
un que le compteur ne voyait pas.

Le cas le plus net est le troisième. L'en-tête de `postChannelReminder.ts`
raconte le doublon du 12/08 — « LA LISTE DU JOUR » à 10 h 27, puis le même fait
redit à 23 h 30 — et annonce l'avoir corrigé en lisant `channel_posts`. La
correction couvrait bien les clôtures et les posts pédagogiques. Elle ne
couvrait pas la liste du jour, qui est pourtant l'exemple cité en premier.

Ces vérifications tournent sans réseau : elles remplacent le client Supabase et
l'appel Telegram par des doublures.
"""

import sys
import types
import unittest
from unittest import mock

import config
import storage
import watchlist


class ClientFactice:
    """Client Supabase minimal : retient ce qui est inséré, dans quelle table."""

    def __init__(self):
        self.inserts = []

    def table(self, nom):
        self._table = nom
        return self

    def insert(self, payload):
        self.inserts.append((self._table, payload))
        return self

    def execute(self):
        return types.SimpleNamespace(data=[])


class ReponseOk:
    ok = True
    status_code = 200
    text = ""


class ReponseRefus:
    ok = False
    status_code = 400
    text = "Bad Request: chat not found"


class ListeDuJourJournalisee(unittest.TestCase):
    def setUp(self):
        self.client = ClientFactice()
        self._patchs = [
            mock.patch.object(storage, "get_client", return_value=self.client),
            mock.patch.object(config, "TELEGRAM_BOT_TOKEN", "jeton-factice"),
            mock.patch.object(config, "TELEGRAM_CHANNEL_ID", "-100123"),
        ]
        for p in self._patchs:
            p.start()

    def tearDown(self):
        for p in self._patchs:
            p.stop()

    def test_une_publication_reussie_est_journalisee(self):
        """LE DÉFAUT EXACT : le message part, et le régulateur n'en sait rien."""
        with mock.patch.object(watchlist.requests, "post", return_value=ReponseOk()):
            self.assertTrue(watchlist.publier("LA LISTE DU JOUR\n\nRien aujourd'hui."))

        posts = [p for (table, p) in self.client.inserts if table == "channel_posts"]
        self.assertEqual(len(posts), 1, "la liste du jour n'a rien écrit dans channel_posts")
        self.assertEqual(posts[0]["canal"], "public")
        # `quotidien` est la catégorie que channelBudget.ts documente mot pour
        # mot comme « un rendez-vous quotidien attendu : liste du jour, état du
        # marché, briefing ».
        self.assertEqual(posts[0]["categorie"], "quotidien")
        self.assertEqual(posts[0]["priorite"], 40)
        self.assertEqual(posts[0]["reference"], "liste-du-jour")

    def test_un_refus_telegram_ne_journalise_rien(self):
        """
        Un message refusé ne doit pas consommer le quota du jour, sinon une
        panne Telegram passagère ferait taire le canal pour rien. C'est la même
        séparation envoi/journalisation que côté Worker.
        """
        with mock.patch.object(watchlist.requests, "post", return_value=ReponseRefus()):
            self.assertFalse(watchlist.publier("LA LISTE DU JOUR"))
        self.assertEqual([p for (t, p) in self.client.inserts if t == "channel_posts"], [])

    def test_la_journalisation_ne_peut_pas_faire_echouer_la_publication(self):
        """
        Le message est DÉJÀ parti quand on journalise. Une base injoignable à
        cet instant ne doit surtout pas transformer une publication réussie en
        échec signalé — ce serait échanger un défaut de comptage contre une
        fausse alerte.
        """
        with mock.patch.object(watchlist.requests, "post", return_value=ReponseOk()), mock.patch.object(
            storage, "get_client", side_effect=RuntimeError("Supabase injoignable")
        ):
            self.assertTrue(watchlist.publier("LA LISTE DU JOUR"))

    def test_les_priorites_suivent_celles_du_worker(self):
        """
        La table de priorités est recopiée de channelBudget.ts. Si les deux
        divergent, le classement du régulateur devient incohérent selon
        l'émetteur du message — un défaut qui ne se verrait nulle part.
        """
        self.assertEqual(
            storage._PRIORITE_CANAL,
            {"signal": 10, "resultat": 20, "quotidien": 40, "editorial": 70},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2, exit=not sys.flags.interactive)
