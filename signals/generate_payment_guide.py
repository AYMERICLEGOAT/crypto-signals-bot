"""
Génère une image explicative "comment payer en USDT/Litecoin" et l'envoie
sur Supabase Storage (bucket signal-charts, déjà public). Script à exécuter
une fois manuellement (ou à chaque fois qu'on veut retoucher le visuel) —
pas une tâche récurrente, contrairement aux autres scripts de signals/.

Nom de fichier fixe (payment-guide.png) + upsert : relancer ce script
remplace l'image existante sans changer son URL publique, donc pas besoin
de retoucher wrangler.toml après une mise à jour visuelle.
"""

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

from storage import get_client
from config import SUPABASE_STORAGE_BUCKET

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "data", "payment-guide.png")
REMOTE_FILENAME = "payment-guide.png"

STEPS = [
    ("1", "Choisis ton plan", "Plan 1 ou Plan 2 via /subscribe"),
    ("2", "Choisis ta crypto", "USDT (Polygon), Litecoin ou Monero"),
    ("3", "Envoie le montant exact", "À l'adresse unique fournie par le bot\n— jamais une adresse trouvée ailleurs"),
    ("4", "Patiente ~5 minutes", "Détection automatique sur la blockchain,\naucune action supplémentaire requise"),
    ("5", "Abonnement activé", "Tu reçois une confirmation\net les signaux automatiquement"),
]

BG = "#0f0f1a"
CARD = "#1a1a2e"
ACCENT_FROM = "#6366f1"
ACCENT_TO = "#4338ca"
TEXT_MAIN = "#f5f5fa"
TEXT_SUB = "#a1a1b5"


def generate() -> str:
    fig, ax = plt.subplots(figsize=(7, 9), dpi=150)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, len(STEPS) * 2 + 1.5)
    ax.axis("off")

    ax.text(5, len(STEPS) * 2 + 0.9, "Comment payer ton abonnement", ha="center",
             fontsize=18, fontweight="bold", color=TEXT_MAIN)
    ax.text(5, len(STEPS) * 2 + 0.3, "Signaux Crypto Gratuits", ha="center",
             fontsize=11, color=TEXT_SUB)

    for i, (num, title, subtitle) in enumerate(STEPS):
        y = (len(STEPS) - i - 1) * 2 + 0.8

        card = FancyBboxPatch((0.6, y - 0.65), 8.8, 1.5, boxstyle="round,pad=0.02,rounding_size=0.15",
                               linewidth=0, facecolor=CARD)
        ax.add_patch(card)

        circle = plt.Circle((1.6, y + 0.1), 0.42, color=ACCENT_FROM, zorder=3)
        ax.add_patch(circle)
        ax.text(1.6, y + 0.1, num, ha="center", va="center", fontsize=15,
                 fontweight="bold", color="white", zorder=4)

        ax.text(2.5, y + 0.35, title, fontsize=13, fontweight="bold", color=TEXT_MAIN, va="center")
        ax.text(2.5, y - 0.15, subtitle, fontsize=9.5, color=TEXT_SUB, va="center", linespacing=1.4)

    ax.text(5, -0.5, "⚠️ Envoie toujours le montant EXACT à l'adresse fournie par le bot pour ce paiement précis.",
             ha="center", fontsize=8.5, color="#f59e0b", wrap=True)

    fig.tight_layout()
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    fig.savefig(OUTPUT_PATH, format="png", facecolor=BG)
    plt.close(fig)
    return OUTPUT_PATH


def upload(local_path: str) -> str:
    with open(local_path, "rb") as f:
        data = f.read()
    bucket = get_client().storage.from_(SUPABASE_STORAGE_BUCKET)
    bucket.upload(REMOTE_FILENAME, data, {"content-type": "image/png", "upsert": "true"})
    return bucket.get_public_url(REMOTE_FILENAME)


if __name__ == "__main__":
    path = generate()
    url = upload(path)
    print(f"Image générée : {path}")
    print(f"URL publique  : {url}")
