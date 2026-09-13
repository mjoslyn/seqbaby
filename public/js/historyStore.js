// ---- the undo stack, and the structural sharing that pays for it ---------
//
// Undo here is a stack of whole-session snapshots, not a log of inverse
// commands. The app has ~1063 live range inputs wired in a hundred places, a
// dozen generators that rewrite a whole part at once, and three modulation
// systems writing the same parameters from different schedules — a command log
// over that surface would need an inverse per call site, and the first one
// anybody forgot would corrupt the stack silently. A snapshot cannot be
// forgotten: `serializeSet` already has to know every field in the session,
// because a save that missed one would lose it.
//
// The obvious objection to snapshots is memory. A session is 32 patterns a
// track across ~21 per-step lanes, so a full copy is tens of thousands of
// numbers, and a hundred of them would be hundreds of megabytes. That is what
// `shareStructure` is for: every new snapshot is walked against the one before
// it and each subtree that did not change is replaced by the OLD one's
// reference. Toggling a step then costs one pattern object; the other 191 in a
// six-track session are the same objects the previous entry holds. Memory
// becomes proportional to what actually changed rather than to the stack depth.
//
// That walk earns its keep twice over, because the answer "nothing was shared"
// is also the answer to "did anything change at all" — so the same pass decides
// whether an interaction is worth an entry. And it makes the RESTORE cheap:
// after sharing, two adjacent snapshots are `===` everywhere they agree, so the
// diff that history.js applies to the live engine can skip a track, a pattern
// or a whole sound with one pointer comparison.
//
// No imports, deliberately — the same reasoning as sessionFormat.js and
// chanceGen.js. Everything here is a pure function over plain objects, so
// `node --test` can exercise it outside a browser (test/history.test.js), which
// for the one feature whose whole job is to not lose your work is worth having.
// What a snapshot IS, and how one is put back onto the live engine, is the
// other half: history.js.

/** How many states the stack holds before the oldest is dropped. */
export const HISTORY_LIMIT = 100;

/** Two edits to the same control this close together are one entry (ms). */
export const COALESCE_MS = 1200;

/**
 * Order-independent deep compare with a reference fast path. The fast path is
 * the point: after `shareStructure` has run, everything two snapshots agree on
 * is literally the same object, so this answers in one comparison.
 */
export function sameTree(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameTree(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameTree(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Fold `next` onto `prev`: every subtree of `next` that is deep-equal to the
 * matching subtree of `prev` is replaced, in place, by `prev`'s object. The
 * return is `prev` itself when the two are equal all the way down, which is how
 * a caller asks "did anything change" — `shareStructure(last, fresh) === last`.
 *
 * `next` is mutated and must therefore be freshly built and owned by the caller
 * (it is: serializeSet builds a new object every time). `prev` is never
 * touched, so the snapshots already in the stack are safe.
 *
 * @template T @param {T} prev @param {T} next @returns {T}
 */
export function shareStructure(prev, next) {
  if (prev === next) return prev;
  if (prev == null || next == null) return Object.is(prev, next) ? prev : next;
  if (typeof prev !== "object" || typeof next !== "object") {
    return Object.is(prev, next) ? prev : next;
  }
  const pArr = Array.isArray(prev), nArr = Array.isArray(next);
  if (pArr !== nArr) return next;

  if (nArr) {
    let identical = prev.length === next.length;
    for (let i = 0; i < next.length; i++) {
      const merged = shareStructure(i < prev.length ? prev[i] : undefined, next[i]);
      next[i] = merged;
      if (identical && merged !== prev[i]) identical = false;
    }
    return identical ? prev : next;
  }

  const nKeys = Object.keys(next);
  let identical = Object.keys(prev).length === nKeys.length;
  for (const k of nKeys) {
    const has = Object.prototype.hasOwnProperty.call(prev, k);
    const merged = shareStructure(has ? prev[k] : undefined, next[k]);
    next[k] = merged;
    if (identical && (!has || merged !== prev[k])) identical = false;
  }
  return identical ? prev : next;
}

/**
 * @typedef {Object} HistoryEntry
 * @property {any} snap    the session snapshot this state is
 * @property {string} label what produced it, for the button's tooltip
 * @property {any} key     coalescing key (the control element, or null)
 * @property {number} at   when it was recorded
 */

/**
 * A cursor into a list of states. `index` is the state the engine is currently
 * in, so undo steps back and redo steps forward — the ordinary arrangement, and
 * the reason recording an edit after an undo has to drop the states in front of
 * the cursor first.
 */
export class HistoryStack {
  constructor({ limit = HISTORY_LIMIT, coalesceMs = COALESCE_MS } = {}) {
    this.limit = Math.max(2, limit);
    this.coalesceMs = coalesceMs;
    /** @type {HistoryEntry[]} */
    this.entries = [];
    this.index = -1;
  }

  /** Start over from `snap` — the state an undo can never go behind. */
  baseline(snap, label = "") {
    this.entries = [{ snap, label, key: null, at: 0 }];
    this.index = 0;
    return snap;
  }

  /** The state the engine is in, as far as the stack knows. */
  get current() { return this.index >= 0 ? this.entries[this.index].snap : null; }

  get size() { return this.entries.length; }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.entries.length - 1; }
  /** What an undo would take back; what a redo would put again. */
  undoLabel() { return this.canUndo() ? this.entries[this.index].label : ""; }
  redoLabel() { return this.canRedo() ? this.entries[this.index + 1].label : ""; }

  /**
   * Offer a fresh snapshot. It is folded onto the current state first, so an
   * interaction that changed nothing (opening a panel, a knob dragged back to
   * where it started) costs one walk and no entry.
   *
   * Coalescing: a second edit to the SAME control within `coalesceMs` replaces
   * the entry rather than stacking on it, so dragging a knob in three goes is
   * one undo rather than three. Never into the baseline — that one is the floor.
   *
   * @param {any} snap freshly built, and owned by this stack from here on
   * @param {{label?: string, key?: any, now?: number}} [opts]
   * @returns {{status: "unchanged"|"pushed"|"coalesced", snap: any}}
   */
  record(snap, { label = "", key = null, now = Date.now() } = {}) {
    if (this.index < 0) return { status: "pushed", snap: this.baseline(snap, label) };
    const merged = shareStructure(this.current, snap);
    if (merged === this.current) return { status: "unchanged", snap: merged };

    // Anything ahead of the cursor was a future that this edit has just
    // replaced. (Dropped before the coalesce check: an edit made after an undo
    // is a new branch, never a continuation of the entry it is standing on.)
    const hadFuture = this.canRedo();
    if (hadFuture) this.entries.length = this.index + 1;

    const top = this.entries[this.index];
    if (!hadFuture && this.index > 0 && key != null && key === top.key
        && now - top.at < this.coalesceMs) {
      top.snap = merged;
      top.at = now;
      if (label) top.label = label;
      return { status: "coalesced", snap: merged };
    }

    this.entries.push({ snap: merged, label, key, at: now });
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return { status: "pushed", snap: merged };
  }

  /**
   * Step back one state. The label handed back names the edit being UNDONE
   * (the one that produced the state we are leaving), which is what a status
   * line wants to say.
   * @returns {{snap: any, label: string}|null}
   */
  undo() {
    if (!this.canUndo()) return null;
    const label = this.entries[this.index].label;
    this.index--;
    return { snap: this.entries[this.index].snap, label };
  }

  /** Step forward one state; the label names the edit being put back. */
  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    const e = this.entries[this.index];
    return { snap: e.snap, label: e.label };
  }
}
