/**
 * The arrangement: a track's timeline of pattern blocks across bars.
 *
 * A block is `{ slot, start, bars }` — which of the track's 32 patterns plays,
 * the ruler bar it starts on (0-based) and how many bars it holds. A track's
 * arrangement is a list of them, kept sorted by `start` and never overlapping:
 * at any bar a track plays one pattern or nothing. Where chain mode walks the
 * slots in numeric order with every track on the same slot, the arrangement
 * lets each track have its own sequence, with gaps, which is what the
 * arrangement VIEW draws and what `patternMode === "arrange"` plays.
 *
 * No imports, for `chanceGen.js`'s reasons: constants.js sits at the top of the
 * module graph, and every other engine module touches the DOM or Tone at import
 * time. Everything here is arithmetic over plain arrays, so `node --test`
 * exercises it (`test/arrangement.test.js`) and `songBuilder.js` validates an
 * agent's blocks through the same functions the studio's editor uses.
 *
 * The ruler's bar is slot 0's meter (see meter.js `transportMeter`): a block on
 * a slot with a customized meter still loops its own length, only its edges
 * fall on the ruler.
 *
 * Every function returns a NEW array and leaves its argument alone — the lists
 * live in the session, where history.js's structural sharing compares them.
 */

export const PATTERN_SLOTS = 32;

/** @typedef {{ slot: number, start: number, bars: number }} Block */

/**
 * Why a block is not one, or null when it is. The message names the field, so
 * the song builder can hand it straight back to an agent.
 * @param {any} b
 * @returns {string|null}
 */
export function checkBlock(b) {
  if (!b || typeof b !== "object") return "a block is { slot, start, bars }";
  const { slot, start, bars } = b;
  if (!Number.isInteger(slot) || slot < 0 || slot >= PATTERN_SLOTS) return `slot must be an integer 0..${PATTERN_SLOTS - 1}, got ${slot}`;
  if (!Number.isInteger(start) || start < 0) return `start must be a bar number from 0, got ${start}`;
  if (!Number.isInteger(bars) || bars < 1) return `bars must be at least 1, got ${bars}`;
  return null;
}

const copy = (b) => ({ slot: b.slot, start: b.start, bars: b.bars });
const end = (b) => b.start + b.bars;
const byStart = (a, b) => a.start - b.start;

/**
 * Take the bars `[from, from + n)` out of every block, splitting one that
 * spans the range. What is left is sorted and still non-overlapping.
 * @param {Block[]} blocks @param {number} from @param {number} n
 */
export function cutRange(blocks, from, n) {
  const to = from + n;
  const out = [];
  for (const b of blocks) {
    const e = end(b);
    if (e <= from || b.start >= to) { out.push(copy(b)); continue; }
    if (b.start < from) out.push({ slot: b.slot, start: b.start, bars: from - b.start });
    if (e > to) out.push({ slot: b.slot, start: to, bars: e - to });
  }
  return out.sort(byStart);
}

/**
 * Put a block down. Whatever it lands on is cut away under it (a block dropped
 * across another splits it), so the result never overlaps.
 * @param {Block[]} blocks @param {Block} b
 */
export function placeBlock(blocks, b) {
  const out = cutRange(blocks, b.start, b.bars);
  out.push(copy(b));
  return out.sort(byStart);
}

/**
 * Anything into a valid arrangement. Not an array is none; a block that fails
 * `checkBlock` is dropped; the rest are placed in order, so the later of two
 * overlapping blocks wins — the rule an editor's drag has too.
 * @param {any} raw
 * @returns {Block[]}
 */
export function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  let out = [];
  for (const b of raw) {
    if (checkBlock(b)) continue;
    out = placeBlock(out, b);
  }
  return out;
}

/** @param {Block[]} blocks @param {number} i */
export function removeBlock(blocks, i) {
  return blocks.filter((_, k) => k !== i).map(copy);
}

/** Move block `i` so it starts on `start`; what it lands on is cut away. */
export function moveBlock(blocks, i, start) {
  const b = blocks[i];
  if (!b) return blocks.map(copy);
  return placeBlock(removeBlock(blocks, i), { slot: b.slot, start: Math.max(0, Math.round(start)), bars: b.bars });
}

/** Give block `i` a new length (at least one bar); what it grows over is cut. */
export function resizeBlock(blocks, i, bars) {
  const b = blocks[i];
  if (!b) return blocks.map(copy);
  return placeBlock(removeBlock(blocks, i), { slot: b.slot, start: b.start, bars: Math.max(1, Math.round(bars)) });
}

/** Change which pattern block `i` plays. */
export function setBlockSlot(blocks, i, slot) {
  return blocks.map((b, k) => (k === i ? { slot, start: b.start, bars: b.bars } : copy(b)));
}

/**
 * The block playing on `bar`, or null for a gap.
 * @param {Block[]} blocks @param {number} bar
 * @returns {Block|null}
 */
export function blockAt(blocks, bar) {
  for (const b of blocks) {
    if (b.start > bar) break;          // sorted: nothing later can cover it
    if (bar < end(b)) return b;
  }
  return null;
}

/** The bar after the last block, 0 for none. */
export function blocksEnd(blocks) {
  let e = 0;
  for (const b of blocks) e = Math.max(e, end(b));
  return e;
}

/**
 * How long the arrangement is: the end of the last block on any track, never
 * less than one bar (the transport takes the position modulo this).
 * @param {{ arrangement?: Block[] }[]} tracks
 */
export function arrangementBars(tracks) {
  let e = 0;
  for (const t of tracks) e = Math.max(e, blocksEnd(t?.arrangement || []));
  return Math.max(1, e);
}

/**
 * A loop section on the ruler, `{start, end}` in bars with `end` exclusive,
 * tidied: whole bars, `start` at least 0, at least one bar long. Anything that
 * is not a range is null (no loop).
 * @param {any} raw
 * @returns {{start: number, end: number}|null}
 */
export function normalizeLoop(raw) {
  if (!raw || !Number.isFinite(raw.start) || !Number.isFinite(raw.end)) return null;
  const a = Math.max(0, Math.round(Math.min(raw.start, raw.end)));
  const b = Math.max(0, Math.round(Math.max(raw.start, raw.end)));
  return { start: a, end: Math.max(a + 1, b) };
}

/**
 * The ruler bar after `bar`: the arrangement wraps at its end (`len` bars);
 * with a loop on, the playhead lives inside it, so a bar outside the loop
 * (the loop was drawn or switched on mid-play) goes to the loop's start.
 * @param {number} bar @param {number} len @param {{start: number, end: number}|null} [loop]
 */
export function nextArrangeBar(bar, len, loop = null) {
  const next = bar + 1;
  if (loop) return next >= loop.start && next < loop.end ? next : loop.start;
  return next >= Math.max(1, len) ? 0 : next;
}

/**
 * Recording: what track played on `bar`. A slot extends the block before it
 * when that block ends on this bar and plays the same slot — a clip left
 * running for eight bars is one eight-bar block, not eight — and otherwise
 * starts a block. `null` (the track was stopped or muted) leaves the bar
 * empty. Whatever the bar held before is replaced: recording over an
 * arrangement rewrites the bars it passes and leaves the rest.
 * @param {Block[]} blocks @param {number} bar @param {number|null} slot
 */
export function writeBar(blocks, bar, slot) {
  const out = cutRange(blocks, bar, 1);
  if (slot == null) return out;
  const prev = out.find((b) => end(b) === bar && b.slot === slot);
  if (prev) prev.bars += 1;
  else { out.push({ slot, start: bar, bars: 1 }); out.sort(byStart); }
  return out;
}

/**
 * After the pattern bar moves a slot (`movePattern`), every block names its
 * pattern by the new number. `order[newIdx] === oldIdx`, the permutation
 * patternBar.js builds, so a slot's new index is `order.indexOf(slot)`. A
 * block whose slot is gone (not in `order`) is dropped.
 * @param {Block[]} blocks @param {number[]} order
 */
export function remapSlots(blocks, order) {
  const out = [];
  for (const b of blocks) {
    const slot = order.indexOf(b.slot);
    if (slot >= 0) out.push({ slot, start: b.start, bars: b.bars });
  }
  return out.sort(byStart);
}

/**
 * Chain mode as blocks: the non-empty slots in order, each for its repeat
 * count, end to end. What every track gets when the arrangement is started
 * from the chain.
 * @param {number[]} repeats  patternRepeats, by slot
 * @param {number[]} slots    the slots the chain plays, in order
 */
export function chainToBlocks(repeats, slots) {
  const out = [];
  let start = 0;
  for (const slot of slots) {
    const bars = Math.max(1, Math.round(Number(repeats?.[slot]) || 1));
    out.push({ slot, start, bars });
    start += bars;
  }
  return out;
}

/**
 * The arrangement read back as text, for `get_song` and the status line:
 * `1-4 p1, 5-8 rest, 9-16 p3` (bars and patterns numbered from 1, as the
 * pattern bar and the ruler number them).
 * @param {Block[]} blocks
 */
export function describeBlocks(blocks) {
  if (!blocks.length) return "empty";
  const parts = [];
  let bar = 0;
  for (const b of blocks) {
    if (b.start > bar) parts.push(`${bar + 1}-${b.start} rest`);
    parts.push(`${b.start + 1}-${end(b)} p${b.slot + 1}`);
    bar = end(b);
  }
  return parts.join(", ");
}
