/**
 * What plays on a step, and which of the three things gets to say so.
 *
 * A track's rhythm comes from one of:
 *
 *   - **the written pattern** — the steps in the grid, which is the default and
 *     what every other module assumes;
 *   - **the euclid ring** in live mode (euclid.js), which replaces the step mask
 *     and leaves the pitch to the pattern;
 *   - **the chance generator** in live mode (chance.js), which replaces the step
 *     mask *and* the pitch, because throwing dice for the rhythm and reading the
 *     melody off the grid would be two unrelated parts stacked on each other.
 *
 * This module exists to hold two things the generators must not each hold their
 * own copy of. The first is that dispatch: transport.js and stepGrid.js both ask
 * exactly this one question, and neither should know how many generators there
 * are. The second is the **exclusivity** — a track has one rhythm source, and
 * two generators both answering would mean whichever ran last wins, which is the
 * same trap the mod/automation pairing avoids (see paramTargets.js). Switching
 * one on switches the other off, in one place, so neither generator has to
 * import the other.
 */

import { euclidGateAt, refreshEuclidUI } from "./euclid.js";
import { chanceGateAt, refreshChanceUI } from "./chance.js";


/** @typedef {import("./types.js").Track} Track */

/**
 * Which generator is driving this track's rhythm, if any.
 * @param {Track} t @returns {"euclid"|"chance"|null}
 */
export function liveGeneratorOf(t) {
  if (t?.euclid?.on) return "euclid";
  if (t?.chance?.on) return "chance";
  return null;
}

/**
 * Put a track's rhythm in one generator's hands, or back in the pattern's.
 * Switching one on switches the other off — and refreshes the one it turned off,
 * because its panel's live checkbox and its button's live marking are now lying.
 * @param {Track} t @param {"euclid"|"chance"|null} which
 */
export function setLiveGenerator(t, which) {
  const wasEuclid = !!t.euclid?.on;
  const wasChance = !!t.chance?.on;
  if (t.euclid) t.euclid.on = which === "euclid";
  if (t.chance) t.chance.on = which === "chance";
  if (wasEuclid !== !!t.euclid?.on) refreshEuclidUI(t);
  if (wasChance !== !!t.chance?.on) refreshChanceUI(t);
}

/**
 * What a step plays — the one question the transport and the step grid both ask.
 * Null means silence.
 *
 * `note` and `ratchet` come back only from a generator that decides them; when
 * they are absent the caller reads the pattern, which is what keeps a written
 * track and a euclid track on exactly the same code path.
 * @param {Track} t @param {number} idx
 * @returns {{span: number, vel: number, note?: number, ratchet?: number}|null}
 */
export function stepGateAt(t, idx) {
  const gen = liveGeneratorOf(t);
  if (gen === "euclid") return euclidGateAt(t, idx);
  if (gen === "chance") return chanceGateAt(t, idx);
  return t.steps[idx]
    ? { span: Math.max(1, t.lengths[idx] || 1), vel: t.velocities[idx] ?? 0.5 }
    : null;
}
