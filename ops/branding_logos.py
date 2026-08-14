#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Les marques des canaux Telegram, dessinées plutôt que collées.

POURQUOI DESSINER PLUTÔT QUE POSER UN EMOJI.

La demande initiale était « un carré noir avec un emoji centré ». C'est déjà
mieux que l'avatar par défaut, mais un emoji système reste un emoji système :
il s'affiche différemment sur Android, iOS et Windows, il porte le style de
l'OS et pas celui du produit, et sur un marché saturé d'arnaques il signale
exactement ce qu'on veut éviter — que personne n'a pris le temps.

CE QUE LA CONTRAINTE D'AFFICHAGE IMPOSE, et qui décide de tout le reste :

  1. Telegram RECADRE EN CERCLE. Un carré perd ses quatre coins ; tout ce qui
     compte doit tenir dans le cercle inscrit, avec de la marge.
  2. La taille utile réelle est ~50 px dans une liste de discussions, pas 512.
     Un dessin fin disparaît. Les traits sont donc épais et le sujet occupe la
     moitié du diamètre.
  3. Le fond sombre de Telegram est très courant : un fond noir PLAT se fond
     dans l'interface et l'avatar semble vide. Un léger dégradé radial suffit
     à le décoller, sans attirer l'œil.

LE SYSTÈME, plutôt que trois images sans rapport : même fond, même anneau, même
géométrie, et une COULEUR par palier. Les canaux se reconnaissent d'un coup
d'œil comme appartenant au même produit, et se distinguent entre eux sans lire
le nom — ce qui est précisément le travail d'un avatar de 50 pixels.

Le rendu se fait à 4x puis est réduit : c'est ce qui donne des bords nets sans
dépendre d'un moteur antialiasé.

Usage : python ops/branding_logos.py
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

TAILLE = 512
SURECHANTILLON = 4
S = TAILLE * SURECHANTILLON

SORTIE = os.path.join(os.path.dirname(__file__), "branding")

# Fond commun. Presque noir, jamais noir pur : le noir pur (#000) est le seul
# ton qui se confond avec le thème sombre de Telegram.
FOND_CENTRE = (28, 29, 34)
FOND_BORD = (10, 10, 12)


def fond_radial(accent: tuple[int, int, int]) -> Image.Image:
    """
    Disque sombre avec un dégagement radial et un anneau d'accent.

    L'anneau est le seul élément décoratif : il fait la famille, il donne la
    couleur du palier, et il survit à la réduction à 50 px là où un détail
    intérieur ne survivrait pas.
    """
    img = Image.new("RGB", (S, S), FOND_BORD)
    d = ImageDraw.Draw(img)

    # Dégradé radial « à la main » : des disques concentrics du plus grand au
    # plus petit. Grossier en théorie, invisible après réduction.
    etapes = 120
    for i in range(etapes, 0, -1):
        t = i / etapes
        r = int(S * 0.62 * t)
        couleur = tuple(
            int(FOND_BORD[c] + (FOND_CENTRE[c] - FOND_BORD[c]) * (1 - t) ** 1.6)
            for c in range(3)
        )
        d.ellipse([S // 2 - r, S // 2 - r, S // 2 + r, S // 2 + r], fill=couleur)

    # Anneau d'accent, discret : posé juste à l'intérieur du bord du cercle de
    # recadrage, il borde l'avatar sans jamais toucher le sujet.
    marge = int(S * 0.045)
    epaisseur = int(S * 0.018)
    d.ellipse(
        [marge, marge, S - marge, S - marge],
        outline=accent,
        width=epaisseur,
    )
    return img


def marque_barres(d: ImageDraw.ImageDraw, accent: tuple[int, int, int]) -> None:
    """
    Trois barres ascendantes : la mesure, qui est l'argument du produit.

    Pas de flèche, pas de courbe qui monte : ces deux signes-là promettent un
    gain. Des barres ne promettent rien, elles montrent qu'on compte — ce qui
    est exactement ce que ce canal fait, pertes comprises.
    """
    # DIMENSIONNÉ POUR 50 PIXELS, pas pour 512. À la taille réelle d'une liste
    # de discussions, une marque qui occupe 40 % du cercle devient un point
    # gris. Le groupe de barres en occupe donc près de 60.
    largeur = int(S * 0.135)
    ecart = int(S * 0.055)
    hauteurs = [int(S * 0.24), int(S * 0.36), int(S * 0.48)]
    total = 3 * largeur + 2 * ecart
    x = (S - total) // 2
    bas = int(S * 0.735)
    rayon = largeur // 2

    for i, h in enumerate(hauteurs):
        gauche = x + i * (largeur + ecart)
        # La barre la plus haute porte l'accent plein ; les deux autres sont
        # atténuées. Le premier réglage descendait à 0,45 : la barre la plus
        # basse disparaissait purement et simplement à 50 px, et la marque se
        # lisait « deux barres ». L'écart est resserré pour que la hiérarchie
        # reste visible sans qu'aucune barre ne se perde.
        opacite = [0.62, 0.80, 1.0][i]
        couleur = tuple(int(c * opacite + 255 * 0.05) for c in accent)
        d.rounded_rectangle([gauche, bas - h, gauche + largeur, bas], radius=rayon, fill=couleur)


def marque_cadenas(d: ImageDraw.ImageDraw, accent: tuple[int, int, int]) -> None:
    """
    Un cadenas FERMÉ. L'anse est un arc épais, le corps un rectangle arrondi.

    Le sens compte : ce canal est privé et le reste. Un cadenas ouvert, ou
    entrouvert, dirait le contraire de ce qui est vendu.
    """
    cx = S // 2
    largeur_corps = int(S * 0.44)
    hauteur_corps = int(S * 0.32)
    haut_corps = int(S * 0.475)
    d.rounded_rectangle(
        [cx - largeur_corps // 2, haut_corps, cx + largeur_corps // 2, haut_corps + hauteur_corps],
        radius=int(S * 0.055),
        fill=accent,
    )

    # Anse : un demi-anneau épais, dessiné comme un arc pour rester net.
    rayon_anse = int(S * 0.145)
    epaisseur = int(S * 0.062)
    haut_anse = haut_corps - rayon_anse - int(S * 0.005)
    d.arc(
        [cx - rayon_anse, haut_anse, cx + rayon_anse, haut_anse + 2 * rayon_anse],
        start=180, end=360, fill=accent, width=epaisseur,
    )
    # Les deux montants qui rejoignent le corps. Bords DROITS et arrêt net sur
    # le corps : la première version utilisait des rectangles arrondis qui
    # dépassaient en petites bosses sur les épaules du cadenas.
    for signe in (-1, 1):
        x = cx + signe * rayon_anse
        d.rectangle(
            [x - epaisseur // 2, haut_anse + rayon_anse, x + epaisseur // 2, haut_corps + int(S * 0.02)],
            fill=accent,
        )

    # Trou de serrure, évidé dans le fond : c'est ce détail qui fait lire
    # « cadenas » plutôt que « valise » à petite taille.
    r = int(S * 0.052)
    cy = haut_corps + int(hauteur_corps * 0.38)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FOND_CENTRE)
    d.rounded_rectangle(
        [cx - int(r * 0.55), cy, cx + int(r * 0.55), cy + int(S * 0.075)],
        radius=int(r * 0.55), fill=FOND_CENTRE,
    )


def marque_journal(d: ImageDraw.ImageDraw, accent: tuple[int, int, int]) -> None:
    """
    Un carnet ouvert, avec ses lignes. Le relevé public tenu au jour le jour.
    """
    largeur = int(S * 0.50)
    hauteur = int(S * 0.39)
    gauche = (S - largeur) // 2
    haut = (S - hauteur) // 2 + int(S * 0.02)
    d.rounded_rectangle([gauche, haut, gauche + largeur, haut + hauteur], radius=int(S * 0.035), fill=accent)
    # Reliure centrale, évidée.
    d.rectangle([S // 2 - int(S * 0.012), haut, S // 2 + int(S * 0.012), haut + hauteur], fill=FOND_CENTRE)
    # Lignes d'écriture, de part et d'autre.
    for cote in (-1, 1):
        for i in range(3):
            y = haut + int(hauteur * (0.28 + i * 0.20))
            x1 = S // 2 + cote * int(S * 0.045)
            x2 = S // 2 + cote * int(largeur * 0.44)
            d.rounded_rectangle(
                [min(x1, x2), y, max(x1, x2), y + int(S * 0.018)],
                radius=int(S * 0.009), fill=FOND_CENTRE,
            )


def fond_bicolore(accent_anneau, accent_marque):
    """
    Variante du fond : l'anneau et la marque n'ont pas la même couleur.

    Sert au bot, qui doit rester de la MÊME famille que le canal gratuit — même
    marque, même géométrie — tout en s'en distinguant dans une liste de
    discussions où les deux apparaissent l'un au-dessus de l'autre. Changer la
    seule couleur de l'anneau suffit : c'est l'élément le plus visible à 50 px,
    et c'est celui qui ne porte aucun sens propre.
    """
    return fond_radial(accent_anneau), accent_marque


MARQUES = {
    # Canal gratuit : vert. C'est la couleur de l'ouvert, du disponible.
    "public": (marque_barres, (31, 217, 123)),
    # Canal payant : or. Sans surcharge, sans brillance — juste la distinction.
    "vip": (marque_cadenas, (232, 180, 74)),
    # Journal : ardoise claire. Neutre par nature, c'est un relevé.
    "journal": (marque_journal, (176, 190, 205)),
}

# Le bot porte la marque MAÎTRE : mêmes barres que le canal gratuit, mais
# anneau platine. C'est la source, les canaux en sont les diffusions.
BOT_ANNEAU = (232, 236, 242)


def generer(nom: str) -> str:
    dessin, accent = MARQUES[nom]
    img = fond_radial(accent)
    d = ImageDraw.Draw(img)
    dessin(d, accent)
    img = img.resize((TAILLE, TAILLE), Image.LANCZOS)
    os.makedirs(SORTIE, exist_ok=True)
    chemin = os.path.join(SORTIE, f"{nom}.png")
    img.save(chemin, "PNG", optimize=True)
    return chemin


def generer_bot() -> str:
    """
    L'avatar du bot NE PEUT PAS être posé par l'API Telegram — seul BotFather
    le permet, à la main. Le fichier est produit quand même : sans lui, la
    seule surface où un visiteur arrive garderait l'avatar par défaut.
    """
    img, accent = fond_bicolore(BOT_ANNEAU, MARQUES["public"][1])
    d = ImageDraw.Draw(img)
    marque_barres(d, accent)
    img = img.resize((TAILLE, TAILLE), Image.LANCZOS)
    os.makedirs(SORTIE, exist_ok=True)
    chemin = os.path.join(SORTIE, "bot.png")
    img.save(chemin, "PNG", optimize=True)
    return chemin


if __name__ == "__main__":
    for nom in MARQUES:
        print(generer(nom))
    print(generer_bot())
