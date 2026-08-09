import { SupabaseConfig, selectRows } from "../supabaseRest";

/**
 * Le débit RÉELLEMENT observé, lu en base — pas la moyenne historique.
 *
 * POURQUOI CE MODULE EXISTE. publishedStats.ts annonce 3,1 signaux par jour en
 * marché défavorable. Le chiffre est honnête : c'est une moyenne mesurée sur
 * six ans (2,00 de momentum 4H + 1,15 de carry). Mais il est présenté partout
 * comme un débit courant, et sur les trois derniers jours le produit en a
 * délivré 2,0 — le carry ne trouvant rien tant que le financement reste calme.
 *
 * L'écart n'est pas un bug : le carry n'ouvre une position que si
 * taux × 21 jours − 0,20 % de frais dépasse 0,55 %, soit environ 0,036 % par
 * jour. Sur un marché de financement plat, il refuse tout, et il a raison. Mais
 * un abonné qui a lu « 3,1 par jour » et qui en reçoit 2 conclut que le produit
 * est cassé ou que le vendeur a menti. Aucune des deux n'est vraie, et aucune
 * ne se rattrape après coup.
 *
 * La réponse de ce projet à ce genre d'écart a toujours été la même : publier
 * le chiffre mesuré plutôt que de l'expliquer. Une moyenne sur six ans reste
 * utile pour décider d'acheter ; le débit des quinze derniers jours est ce qui
 * dit si ça tourne EN CE MOMENT. Les deux ensemble ne se contredisent pas, ils
 * répondent à deux questions différentes.
 */

/** Fenêtre d'observation. Assez longue pour absorber un jour creux, assez
 *  courte pour décrire le régime actuel et non celui du mois dernier. */
export const JOURS_OBSERVES = 14;

export interface DebitReel {
  /** Signaux émis sur la fenêtre, tous moteurs confondus. */
  total: number;
  /** Moyenne par jour, arrondie au dixième. */
  parJour: number;
  /** Jours de la fenêtre ayant reçu au moins un signal. */
  joursAvecSignal: number;
  /** Moteurs ayant réellement produit, du plus prolifique au moins. */
  moteurs: { engine: string; nb: number }[];
}

interface LigneSignal {
  created_at: string;
  engine: string | null;
}

/**
 * Retourne null si la lecture échoue. L'appelant DOIT alors se taire plutôt
 * que d'afficher zéro : « 0 signal par jour » sur une panne de base ferait
 * fuir un abonné pour une raison entièrement fausse.
 */
export async function lireDebitReel(db: SupabaseConfig): Promise<DebitReel | null> {
  const depuis = new Date(Date.now() - JOURS_OBSERVES * 86_400_000).toISOString();

  let lignes: LigneSignal[];
  try {
    lignes = await selectRows<LigneSignal>(db, "signals", {
      created_at: `gte.${depuis}`,
      select: "created_at,engine",
      limit: "1000",
    });
  } catch (err) {
    console.error("[debit] Lecture du débit réel impossible :", err);
    return null;
  }

  const parMoteur = new Map<string, number>();
  const jours = new Set<string>();
  for (const l of lignes) {
    const moteur = l.engine ?? "inconnu";
    parMoteur.set(moteur, (parMoteur.get(moteur) ?? 0) + 1);
    jours.add(l.created_at.slice(0, 10));
  }

  return {
    total: lignes.length,
    parJour: Math.round((lignes.length / JOURS_OBSERVES) * 10) / 10,
    joursAvecSignal: jours.size,
    moteurs: [...parMoteur.entries()]
      .map(([engine, nb]) => ({ engine, nb }))
      .sort((a, b) => b.nb - a.nb),
  };
}

const NOMS_MOTEURS: Record<string, string> = {
  relative_strength: "force relative",
  cassure_canal: "cassure de canal",
  expansion_volatilite: "expansion de volatilité",
  carry_funding: "carry de financement",
  momentum_4h: "momentum 4H",
};

export function nomMoteur(engine: string): string {
  return NOMS_MOTEURS[engine] ?? engine;
}

/**
 * Une ou deux lignes prêtes à afficher. Volontairement sans emphase : c'est un
 * relevé, pas un argument de vente.
 */
export function formaterDebitReel(d: DebitReel): string {
  if (d.total === 0) {
    return (
      `📊 Sur les ${JOURS_OBSERVES} derniers jours : aucun signal émis.\n` +
      "Les moteurs directionnels sont coupés par le filtre de tendance, et le carry ne trouve " +
      "rien tant que le financement reste trop bas pour couvrir ses frais. C'est le fonctionnement " +
      "prévu, pas une panne — mais autant que tu le saches plutôt que de le deviner."
    );
  }

  const detail = d.moteurs.map((m) => `${nomMoteur(m.engine)} ${m.nb}`).join(", ");
  return (
    `📊 Sur les ${JOURS_OBSERVES} derniers jours : ${d.total} signal(aux), soit ${String(d.parJour).replace(".", ",")} par jour ` +
    `(${detail}).\n` +
    "C'est le débit réellement mesuré sur la période, pas la moyenne historique — les deux peuvent " +
    "différer sensiblement selon le régime de marché."
  );
}
