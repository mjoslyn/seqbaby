// The arithmetic of a mix between two songs (mix.js, mixView.js): what the
// crossfader does to each deck, where the tempo sits between the two songs,
// which pattern deck B's chain goes to next, and what a loaded song says about
// itself. No imports, so `node --test` runs it (test/mixPlan.test.js).

export const XFADE_CURVES = ["blend", "smooth", "linear", "full", "dip", "cut"];
/** What each shape is for, in a line (the select's tooltip and the status line). */
export const XFADE_CURVE_TIPS = {
  blend: "equal power: the level holds across the travel, both sides at -3dB in the middle",
  smooth: "equal power, eased: slow off each end and quick through the middle",
  linear: "straight lines: both at half in the middle, so the level dips there (right for two copies of one song)",
  full: "each side stays full until the middle and only then falls: both at full in the middle",
  dip: "each side is nearly gone by the middle: a breath between the two songs",
  cut: "both full across the middle, each cut at its far end: a swap on the beat",
};
export const FADE_BARS = [1, 2, 4, 8, 16];

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/**
 * Each deck's gain for a crossfader at `x` (0 all deck A, 1 all deck B).
 *   blend  equal power: the two songs are not correlated, so their powers add
 *          and cos / sin keeps the sum's level put across the travel (both
 *          at -3dB in the middle). The ends are exact: 1 and 0.
 *   cut    both decks full across the middle, each cut over the last tenth of
 *          the travel at its far end: for a swap on the beat, not a blend.
 *   smooth blend's cos / sin over an eased travel (smoothstep), so the fader
 *          does little near either end and most of its work in the middle.
 *   linear 1 - x and x: the sum of two COPIES holds, two songs dip 3dB.
 *   full   each side full on its own half and falling (cos) across the other:
 *          both full in the middle, for a mix that should not thin.
 *   dip    (1 - x)^2 and x^2: both a quarter in the middle, a gap between.
 * Every shape is exactly 1 / 0 at its ends and never rises on the way out.
 * @param {number} x @param {string} [curve]
 * @returns {{a: number, b: number}}
 */
export function xfadeGains(x, curve = "blend") {
  const q = clamp01(x);
  if (curve === "cut") {
    const edge = 0.1;
    return { a: clamp01((1 - q) / edge), b: clamp01(q / edge) };
  }
  if (q <= 0) return { a: 1, b: 0 };
  if (q >= 1) return { a: 0, b: 1 };
  if (curve === "linear") return { a: 1 - q, b: q };
  if (curve === "dip") return { a: (1 - q) * (1 - q), b: q * q };
  if (curve === "full") {
    return {
      a: q <= 0.5 ? 1 : Math.cos((q - 0.5) * Math.PI),
      b: q >= 0.5 ? 1 : Math.sin(q * Math.PI),
    };
  }
  const e = curve === "smooth" ? q * q * (3 - 2 * q) : q;
  return { a: Math.cos((e * Math.PI) / 2), b: Math.sin((e * Math.PI) / 2) };
}

/**
 * The tempo `x` of the way from deck A's to deck B's. Linear in bpm, as a
 * pitch fader is. A missing tempo on either side is the other's.
 */
export function mixBpm(a, b, x) {
  const from = Number(a) > 0 ? Number(a) : Number(b) > 0 ? Number(b) : 120;
  const to = Number(b) > 0 ? Number(b) : from;
  return from + (to - from) * clamp01(x);
}

/**
 * How two tempos sit against each other: "same", "half" / "double" (the beat
 * already lines up, so the mix can stay at one tempo) or "apart" with the
 * percentage the faster one is ahead.
 * @returns {{kind: string, pct: number}}
 */
export function tempoRelation(a, b) {
  if (!(a > 0) || !(b > 0)) return { kind: "same", pct: 0 };
  const r = b / a;
  if (Math.abs(r - 1) < 0.002) return { kind: "same", pct: 0 };
  if (Math.abs(r - 2) < 0.02) return { kind: "double", pct: 0 };
  if (Math.abs(r - 0.5) < 0.005) return { kind: "half", pct: 0 };
  return { kind: "apart", pct: Math.round(Math.abs(r - 1) * 1000) / 10 };
}

/**
 * Where an automatic fade has got to: from `from` to `to` over `steps` steps,
 * `done` of them gone. Eased at both ends (smoothstep) so it neither starts
 * nor arrives with a lurch.
 */
export function fadeAt(from, to, done, steps) {
  const p = steps > 0 ? clamp01(done / steps) : 1;
  const e = p * p * (3 - 2 * p);
  return from + (to - from) * e;
}

/** Whether any step of a serialized or live pattern is on. */
export function patternHasNotes(p) {
  const s = p?.steps;
  if (!s) return false;
  for (let i = 0; i < s.length; i++) if (s[i]) return true;
  return false;
}

/**
 * Which of a deck's 32 slots hold notes, from its tracks (live or serialized).
 * @param {Array<{patterns?: any[], engineKey?: string}>} tracks
 * @returns {boolean[]}
 */
export function filledSlots(tracks, count = 32) {
  const out = new Array(count).fill(false);
  for (const t of tracks || []) {
    if (t?.engineKey === "bus") continue;
    for (let i = 0; i < count; i++) if (!out[i] && patternHasNotes(t.patterns?.[i])) out[i] = true;
  }
  return out;
}

/** The next filled slot after `from`, wrapping; `from` itself when it is the only one; -1 when none. */
export function nextFilled(filled, from) {
  const n = filled.length;
  for (let off = 1; off <= n; off++) {
    const i = (((from + off) % n) + n) % n;
    if (filled[i]) return i;
  }
  return -1;
}

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** A scale as a short label ("F# minor"), or "" when it is off. */
export function scaleLabel(scale) {
  if (!scale?.active) return "";
  const pc = ((Number(scale.root) | 0) % 12 + 12) % 12;
  return `${NOTE[pc]} ${scale.mode || ""}`.trim();
}

/** Whether two scales snap notes the same way (both off counts as the same). */
export function sameScale(a, b) {
  const on = (s) => !!s?.active;
  if (!on(a) && !on(b)) return true;
  if (on(a) !== on(b)) return false;
  return (((a.root | 0) % 12) + 12) % 12 === (((b.root | 0) % 12) + 12) % 12 && a.mode === b.mode;
}

/** A session's meter for pattern `slot`: its own, else pattern 1's, else 4/4. */
export function meterOf(session, slot = 0) {
  const m = session?.patternMeters?.[slot] || session?.patternMeters?.[0];
  const num = Number(m?.num) > 0 ? Number(m.num) : 4;
  const den = Number(m?.den) > 0 ? Number(m.den) : 4;
  return { num, den };
}

/**
 * What a session says about itself, for the deck's header: tempo, key, the
 * meter of the pattern it was saved on, how many tracks play notes and which
 * slots hold any.
 */
export function deckSummary(session) {
  const tracks = Array.isArray(session?.tracks) ? session.tracks : [];
  const filled = filledSlots(tracks);
  const slot = Number.isInteger(session?.activePattern) ? session.activePattern : 0;
  return {
    bpm: Number(session?.bpm) > 0 ? Number(session.bpm) : 120,
    key: scaleLabel(session?.scale),
    meter: meterOf(session, slot),
    tracks: tracks.filter((t) => t?.engineKey !== "bus").length,
    patterns: filled.filter(Boolean).length,
    filled,
  };
}

/**
 * The slot a deck starts on: the one the song was saved on when it has notes,
 * else its first filled slot, else that slot anyway.
 */
export function startSlot(session) {
  const filled = filledSlots(session?.tracks);
  const slot = Number.isInteger(session?.activePattern) ? Math.max(0, Math.min(31, session.activePattern)) : 0;
  if (filled[slot]) return slot;
  const first = filled.indexOf(true);
  return first >= 0 ? first : slot;
}

/**
 * A bus fader's value with the crossfader's gain folded into it, for keeping
 * both decks as one song: the crossfader goes away and the level must not move.
 */
export function bakeLevel(vol, gain) {
  return Math.round(clamp01((Number(vol) || 0) * Math.max(0, Number(gain) || 0)) * 100) / 100;
}
