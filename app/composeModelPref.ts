// The model an account on COMPOSE_MODEL_PICKERS has picked, shared by the two
// panels that offer the menu: compose and groove. One choice, remembered per
// browser, so picking in either is picking in both. The route checks the
// account and the model again; this is only what to ask for.
import { COMPOSE_MODELS } from "@/lib/composeModels.js";

const STORE = "seqbaby.composeModel.v1";
export const MODEL_EVENT = "seqbaby:composemodel";

/** The remembered pick, or the fallback when there is none (or it is not on
 *  the menu this visitor gets: `allowed`, every model when left out). */
export function readModelPref(fallback: string, allowed?: string[]): string {
  try {
    const saved = window.localStorage.getItem(STORE);
    const ok = allowed ? allowed : COMPOSE_MODELS.map((m) => m.id);
    if (saved && ok.includes(saved)) return saved;
  } catch {
    /* blocked storage: the fallback stands */
  }
  return fallback;
}

/** Remember a pick and tell the other panel. */
export function writeModelPref(id: string) {
  try {
    window.localStorage.setItem(STORE, id);
  } catch {
    /* blocked storage: it holds for this page */
  }
  window.dispatchEvent(new CustomEvent(MODEL_EVENT, { detail: { model: id } }));
}
