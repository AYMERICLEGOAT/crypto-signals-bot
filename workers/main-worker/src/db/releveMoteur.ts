import { SupabaseConfig, selectRows } from "../supabaseRest";
import { pnlEffectif, SignalSide } from "../signalMath";

/**
 * LE RELEVÉ RÉEL D'UN MOTEUR, pour le publier À CÔTÉ de sa promesse.
 *
 * Chaque signal du momentum 4H porte cette phrase : « +0,805 % par signal sur
 * 3 jours mesurés ». C'est vrai — c'est la mesure du backtest sur 1 100 jours.
 * Mais le relevé RÉEL de ce moteur depuis sa mise en service, au 14/08/2026,
 * dit autre chose : 10 clôtures, 3 gagnants, −0,07 % par trade.
 *
 * Dix trades ne démontrent rien. Le garde-fou d'espérance
 * (signals/edge_guard.py) exige trente clôtures avant de couper quoi que ce
 * soit, et il a raison : sur un avantage à 60 % de réussite, dix pertes
 * d'affilée sont banales.
 *
 * Mais publier la promesse SANS le relevé, c'est laisser le lecteur croire que
 * le chiffre annoncé est ce que le produit a livré. Le projet s'interdit de
 * mentir sur les performances ; taire un chiffre défavorable qu'on possède est
 * la forme la plus facile de ce mensonge — celle qui ne demande aucun effort et
 * ne laisse aucune trace.
 *
 * Les deux chiffres partent donc ensemble, avec leur taille d'échantillon, et
 * sans commentaire qui adoucisse. Le lecteur décide.
 */

export interface ReleveMoteur {
  /** Nombre de clôtures observées. En dessous de MIN_CLOTURES, on ne publie rien. */
  clotures: number;
  /** Espérance réalisée par signal, sorties partielles comprises. */
  moyennePct: number;
  gagnants: number;
}

/**
 * En dessous de ce nombre, la moyenne n'est pas une information : c'est du
 * bruit qui se lirait comme un jugement. On préfère ne rien dire que dire
 * n'importe quoi — dans les deux sens.
 */
export const MIN_CLOTURES = 8;

interface LigneCloture {
  type: SignalSide;
  entry_price: number;
  outcome: string | null;
  outcome_price: number | null;
  tp1_price: number | null;
  tp2_price: number | null;
  tp1_hit_at: string | null;
  tp2_hit_at: string | null;
}

/**
 * @param engine nom du moteur en base (ex. "momentum_4h")
 */
export async function getReleveMoteur(db: SupabaseConfig, engine: string): Promise<ReleveMoteur | null> {
  let lignes: LigneCloture[];
  try {
    lignes = await selectRows<LigneCloture>(db, "signals", {
      engine: `eq.${engine}`,
      outcome: "not.is.null",
      select: "type,entry_price,outcome,outcome_price,tp1_price,tp2_price,tp1_hit_at,tp2_hit_at",
      order: "evaluated_at.desc",
      limit: "100",
    });
  } catch (err) {
    // Un relevé indisponible ne doit jamais empêcher un signal de partir : le
    // message se publie alors sans cette ligne, exactement comme avant.
    console.error(`[releve] Lecture du relevé réel de ${engine} impossible :`, err);
    return null;
  }

  const exploitables = lignes.filter((l) => l.outcome_price !== null);
  if (exploitables.length < MIN_CLOTURES) return null;

  const total = exploitables.reduce((somme, l) => somme + pnlEffectif(l, l.outcome_price), 0);
  return {
    clotures: exploitables.length,
    moyennePct: total / exploitables.length,
    gagnants: exploitables.filter((l) => l.outcome === "WIN").length,
  };
}
