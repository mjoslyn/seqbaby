/**
 * Whether a written step fires this time round: its probability and its trig
 * condition. No imports, for chanceGen.js's reasons: the transport, the step
 * editor, the song builder and `node --test` all read this one answer.
 *
 * A step carries two things beside its note (state.js's emptyPattern):
 *
 *   probs[i]  0..1, 1 the default: how often the step plays
 *   conds[i]  "" (always) or one of
 *     "a:b"     the a-th of every b passes of the pattern (1:2 plays the first
 *               pass, skips the second; 4:4 plays every fourth, a turnaround)
 *     "fill"    only while the fill button is held
 *     "!fill"   only while it is not (the part the fill replaces)
 *     "first"   only the first pass after the pattern starts
 *     "!first"  every pass but that one
 *
 * The condition is asked first and the dice only for a step it lets through.
 *
 * The dice are a hash of (seed, step, pass), the chance generator's bargain: a
 * step at 50% differs pass to pass, and the same song from the same start
 * plays the same way, so a bounce is a render and two screens in a jam (same
 * track order, same start tick) agree without sharing anything.
 */

/** The conditions the step editor offers, in its order. Any a:b with 1 <= a <= b <= 8 is valid. */
export const TRIG_CONDS = [
  "", "fill", "!fill", "first", "!first",
  "1:2", "2:2",
  "1:3", "2:3", "3:3",
  "1:4", "2:4", "3:4", "4:4",
  "1:8", "5:8", "8:8",
];

/** What the step editor calls each. */
export function trigCondLabel(c) {
  if (!c) return "always";
  if (c === "fill") return "fill only";
  if (c === "!fill") return "not in a fill";
  if (c === "first") return "first pass only";
  if (c === "!first") return "not the first pass";
  const r = parseRatio(c);
  return r ? `pass ${r.a} of ${r.b}` : String(c);
}

function parseRatio(c) {
  const m = /^([1-8]):([1-8])$/.exec(String(c));
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return a <= b ? { a, b } : null;
}

/** A condition as stored: a valid one as is, anything else "" (always). */
export function normalizeCond(c) {
  if (c == null || c === "") return "";
  const s = String(c).trim();
  if (s === "fill" || s === "!fill" || s === "first" || s === "!first") return s;
  return parseRatio(s) ? s : "";
}

/** Whether a string names a condition (the song builder's check). */
export function isTrigCond(c) {
  return typeof c === "string" && normalizeCond(c) === c;
}

/** A probability as stored: 0..1, anything unreadable 1. */
export function normalizeProb(p) {
  const n = Number(p);
  if (p == null || !Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

// Murmur3's finalizer: every input bit reaches every output bit, so the low
// bits of (step, pass) do not line up into a pattern of their own.
function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The dice for one (seed, step, pass): 0..1, uniform, the same every time. */
export function trigRoll(seed, step, pass) {
  let h = mix32((seed | 0) ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul((step | 0) + 1, 0x27d4eb2d));
  h = mix32(h ^ Math.imul((pass | 0) + 1, 0x165667b1));
  return h / 4294967296;
}

/**
 * Whether the condition alone lets a step through.
 * @param {string} cond @param {number} pass  passes of the pattern since it started, from 0
 * @param {boolean} fill  whether the fill button is down
 */
export function condPasses(cond, pass, fill) {
  if (!cond) return true;
  if (cond === "fill") return !!fill;
  if (cond === "!fill") return !fill;
  if (cond === "first") return pass === 0;
  if (cond === "!first") return pass !== 0;
  const r = parseRatio(cond);
  if (!r) return true;                       // unreadable: play it
  const p = ((pass % r.b) + r.b) % r.b;
  return p === r.a - 1;
}

/**
 * Whether a step fires.
 * @param {{prob?: number, cond?: string, pass?: number, fill?: boolean, seed?: number, step?: number}} o
 */
export function stepFires({ prob = 1, cond = "", pass = 0, fill = false, seed = 0, step = 0 } = {}) {
  if (!condPasses(cond, pass, fill)) return false;
  const p = normalizeProb(prob);
  if (p >= 1) return true;
  if (p <= 0) return false;
  return trigRoll(seed, step, pass) < p;
}

/** Whether a step has anything on it that can withhold it (for the grid's mark). */
export function hasTrig(prob, cond) {
  return normalizeProb(prob) < 1 || !!normalizeCond(cond);
}

/** A short mark for a step's cell: "50%", "1:2", "F", "!F", "1st". */
export function trigMark(prob, cond) {
  const c = normalizeCond(cond);
  const p = normalizeProb(prob);
  const parts = [];
  if (c) parts.push(c === "fill" ? "F" : c === "!fill" ? "!F" : c === "first" ? "1st" : c === "!first" ? "!1st" : c);
  if (p < 1) parts.push(`${Math.round(p * 100)}%`);
  return parts.join(" ");
}
