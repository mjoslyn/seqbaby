import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryStack, sameTree, shareStructure,
} from "../public/js/historyStore.js";

// historyStore.js has no imports so that this file can run the real stack
// outside a browser. What is pinned here is what the feature promises: an undo
// gives you back exactly what you had, an interaction that changed nothing
// costs nothing, and a hundred entries of a session do not cost a hundred
// sessions' worth of memory.

/** A session-shaped blob, small enough to read but the same shape as the real
 *  one: globals at the top, tracks with patterns of per-step lanes below. */
const session = (over = {}) => ({
  _version: 7,
  bpm: 110,
  swing: 0,
  scale: { active: false, root: 0, mode: "minor" },
  macroPads: [],
  tracks: [
    {
      name: "kick", engineKey: "dm:808-kick",
      params: { vol: 0.8, harm: 0.5 },
      patterns: [
        { steps: [1, 0, 0, 0], notes: [36, null, null, null], automation: {} },
        { steps: [0, 0, 0, 0], notes: [null, null, null, null], automation: {} },
      ],
    },
    {
      name: "bass", engineKey: "dm:silverbox",
      params: { vol: 0.7, harm: 0.2 },
      patterns: [
        { steps: [1, 0, 1, 0], notes: [36, null, 43, null], automation: {} },
        { steps: [0, 0, 0, 0], notes: [null, null, null, null], automation: {} },
      ],
    },
  ],
  ...over,
});

const clone = (v) => structuredClone(v);

// ---- sameTree -----------------------------------------------------------

test("sameTree compares by value, and by reference when it can", () => {
  const a = session();
  assert.equal(sameTree(a, clone(a)), true);
  assert.equal(sameTree(a, a), true);

  const b = clone(a);
  b.tracks[1].patterns[0].steps[2] = 0;
  assert.equal(sameTree(a, b), false);

  // Key sets, not just values: a field appearing is a change.
  const c = clone(a);
  c.tracks[0].muted = false;
  assert.equal(sameTree(a, c), false);

  // Arrays and objects are not each other, and holes are not zeroes.
  assert.equal(sameTree([1, 2], { 0: 1, 1: 2 }), false);
  assert.equal(sameTree([1, 2], [1, 2, 3]), false);
  assert.equal(sameTree(null, undefined), false);
  assert.equal(sameTree(0, "0"), false);
});

// ---- shareStructure -----------------------------------------------------

test("an unchanged session folds onto the old one entirely", () => {
  const prev = session();
  const next = session();
  assert.notEqual(prev, next);                       // genuinely separate objects
  assert.equal(shareStructure(prev, next), prev);    // …and the fold says so
});

test("only what changed is a new object; everything else is shared", () => {
  const prev = session();
  const next = session();
  next.tracks[1].patterns[0].steps = [1, 1, 1, 0];

  const merged = shareStructure(prev, next);
  assert.notEqual(merged, prev, "the session changed");

  // The track that did not move is the SAME object as before — which is what
  // makes a hundred-deep history affordable, and what lets the restore skip a
  // whole track with one pointer comparison.
  assert.equal(merged.tracks[0], prev.tracks[0]);
  assert.equal(merged.scale, prev.scale);
  assert.equal(merged.macroPads, prev.macroPads);

  // Inside the track that did move, only the pattern that changed is new.
  assert.notEqual(merged.tracks[1], prev.tracks[1]);
  assert.equal(merged.tracks[1].params, prev.tracks[1].params);
  assert.equal(merged.tracks[1].patterns[1], prev.tracks[1].patterns[1]);
  assert.notEqual(merged.tracks[1].patterns[0], prev.tracks[1].patterns[0]);

  // And the values are the new ones, not the shared ones.
  assert.deepEqual(merged.tracks[1].patterns[0].steps, [1, 1, 1, 0]);
});

test("the fold never writes to the snapshot already on the stack", () => {
  const prev = session();
  const frozen = clone(prev);
  const next = session();
  next.bpm = 128;
  next.tracks[0].patterns[0].steps[1] = 1;
  shareStructure(prev, next);
  assert.deepEqual(prev, frozen);
});

test("a track added or removed folds without losing the ones that stayed", () => {
  const prev = session();
  const grown = session();
  grown.tracks.push({ name: "hat", engineKey: "dm:909-chat", params: {}, patterns: [] });
  const merged = shareStructure(prev, grown);
  assert.equal(merged.tracks.length, 3);
  assert.equal(merged.tracks[0], prev.tracks[0]);
  assert.equal(merged.tracks[1], prev.tracks[1]);

  const shrunk = session();
  shrunk.tracks.pop();
  const m2 = shareStructure(prev, shrunk);
  assert.equal(m2.tracks.length, 1);
  assert.equal(m2.tracks[0], prev.tracks[0]);
});

// ---- the stack ----------------------------------------------------------

test("an interaction that changed nothing is not an entry", () => {
  const stack = new HistoryStack();
  stack.baseline(session());
  const r = stack.record(session(), { label: "cutoff" });
  assert.equal(r.status, "unchanged");
  assert.equal(stack.size, 1);
  assert.equal(stack.canUndo(), false);
});

test("undo hands back exactly the state before the edit, and redo the one after", () => {
  const stack = new HistoryStack();
  const first = session();
  stack.baseline(first);

  const edited = session();
  edited.tracks[0].patterns[0].steps[2] = 1;
  stack.record(edited, { label: "step" });

  assert.equal(stack.canUndo(), true);
  assert.equal(stack.undoLabel(), "step");

  const back = stack.undo();
  assert.equal(back.label, "step", "the label names the edit being undone");
  assert.deepEqual(back.snap.tracks[0].patterns[0].steps, [1, 0, 0, 0]);
  assert.equal(stack.canUndo(), false);
  assert.equal(stack.canRedo(), true);

  const fwd = stack.redo();
  assert.deepEqual(fwd.snap.tracks[0].patterns[0].steps, [1, 0, 1, 0]);
  assert.equal(stack.canRedo(), false);
});

test("the baseline is the floor — undo can never go behind it", () => {
  const stack = new HistoryStack();
  stack.baseline(session());
  const e = session(); e.bpm = 120;
  stack.record(e, { label: "bpm" });
  assert.equal(stack.undo() != null, true);
  assert.equal(stack.undo(), null);
  assert.equal(stack.redo() != null, true);
  assert.equal(stack.redo(), null);
});

test("two edits to the same control in quick succession are one entry", () => {
  const stack = new HistoryStack();
  stack.baseline(session());
  const knob = { id: "cutoff" };                 // stands in for the DOM element

  const a = session(); a.tracks[0].params.harm = 0.6;
  stack.record(a, { label: "harm", key: knob, now: 1000 });
  const b = session(); b.tracks[0].params.harm = 0.9;
  const r = stack.record(b, { label: "harm", key: knob, now: 1500 });

  assert.equal(r.status, "coalesced");
  assert.equal(stack.size, 2);
  // One undo, and it goes behind the whole drag rather than to the middle of it.
  assert.equal(stack.undo().snap.tracks[0].params.harm, 0.5);
});

test("a pause, a different control, or an undo in between breaks the coalescing", () => {
  const late = new HistoryStack();
  late.baseline(session());
  const knob = {};
  const a = session(); a.tracks[0].params.harm = 0.6;
  late.record(a, { key: knob, now: 1000 });
  const b = session(); b.tracks[0].params.harm = 0.9;
  assert.equal(late.record(b, { key: knob, now: 9000 }).status, "pushed");

  const other = new HistoryStack();
  other.baseline(session());
  const c = session(); c.tracks[0].params.harm = 0.6;
  other.record(c, { key: {}, now: 1000 });
  const d = session(); d.tracks[0].params.vol = 0.4;
  assert.equal(other.record(d, { key: {}, now: 1100 }).status, "pushed");

  // An edit made after an undo is a new branch, never a continuation of the
  // entry the cursor happens to be standing on — even when it is the same
  // control, inside the window. Coalescing there would rewrite a state the user
  // has already stepped back to, and the redo in front of it would be a lie.
  const branched = new HistoryStack();
  branched.baseline(session());
  const e = session(); e.tracks[0].params.harm = 0.6;
  branched.record(e, { key: knob, now: 1000 });
  const f = session(); f.tracks[0].params.harm = 0.7;
  branched.record(f, { key: knob, now: 9000 });
  branched.undo();                               // standing on harm 0.6
  const g = session(); g.tracks[0].params.harm = 0.8;
  assert.equal(branched.record(g, { key: knob, now: 1400 }).status, "pushed");
  assert.equal(branched.size, 3);
  assert.equal(branched.undo().snap.tracks[0].params.harm, 0.6);
});

test("an edit after an undo drops the future that edit replaced", () => {
  const stack = new HistoryStack();
  stack.baseline(session());
  const a = session(); a.bpm = 120;
  stack.record(a, { label: "bpm" });
  const b = session(); b.bpm = 130;
  stack.record(b, { label: "bpm again" });

  stack.undo();                                  // standing on bpm 120
  assert.equal(stack.canRedo(), true);
  const c = session(); c.bpm = 140;
  stack.record(c, { label: "elsewhere" });

  assert.equal(stack.canRedo(), false, "130 was never played out");
  assert.equal(stack.size, 3);
  assert.equal(stack.undo().snap.bpm, 120);
});

test("the stack is capped, and drops from the oldest end", () => {
  const stack = new HistoryStack({ limit: 5 });
  stack.baseline(session());
  for (let i = 1; i <= 20; i++) {
    const s = session(); s.bpm = 100 + i;
    stack.record(s, { label: `bpm ${i}` });
  }
  assert.equal(stack.size, 5);
  assert.equal(stack.current.bpm, 120);
  // Five states means four steps back.
  let steps = 0;
  while (stack.undo()) steps++;
  assert.equal(steps, 4);
  assert.equal(stack.current.bpm, 116);
});

test("a deep history of small edits does not cost a session per entry", () => {
  // The claim structural sharing exists to make: after 200 single-step edits to
  // one pattern, every OTHER pattern in the session is still the one object the
  // baseline held. Counting distinct pattern objects is the direct measure.
  const stack = new HistoryStack({ limit: 500 });
  let cur = session();
  stack.baseline(cur);
  for (let i = 0; i < 200; i++) {
    const next = clone(cur);
    next.tracks[0].patterns[0].steps[i % 4] = i % 2;
    const r = stack.record(next, { label: "step", now: i * 5000 });
    cur = r.snap;
  }
  const objects = new Set();
  for (const e of stack.entries) {
    for (const t of e.snap.tracks) for (const p of t.patterns) objects.add(p);
  }
  // Only pattern 1 of track 1 ever moved: three of the four are shared by every
  // entry, and the fourth has at most one object per entry that changed it.
  assert.ok(objects.size <= 3 + stack.size,
    `expected sharing, got ${objects.size} distinct patterns across ${stack.size} entries`);
  assert.equal(stack.entries[0].snap.tracks[1].patterns[0],
               stack.entries.at(-1).snap.tracks[1].patterns[0]);
});
