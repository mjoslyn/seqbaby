import assert from "node:assert/strict";
import test from "node:test";

import {
  applySessionPatch, diffSession, diffValue, patchValue,
} from "../public/js/jamSync.js";

// jamSync.js is the wire half of a jam: what one studio tells the others
// after an edit. What is pinned here is what a jam promises — a peer's copy
// ends up exactly the sender's, a knob turn costs a few hundred bytes and not
// the sample payloads, two people editing different tracks at once both land,
// and a patch that would land on the wrong track is refused rather than
// applied.

/** A session-shaped blob, the same shape as serializeSet's output. */
const session = (over = {}) => ({
  _version: 3,
  bpm: 110,
  swing: 0,
  scale: { active: false, root: 0, mode: "minor" },
  activePattern: 0,
  patternMeters: [{ num: 4, den: 4 }, { num: 4, den: 4 }],
  macroPads: [],
  tracks: [
    {
      name: "kick", engineKey: "dm:808-kick",
      params: { vol: 0.8, harm: 0.5 },
      fxConfig: { delay: { wet: 0, time: 0.25 }, reverb: { wet: 0.1, decay: 2 } },
      uploadAudio: null,
      patterns: [
        { steps: [1, 0, 0, 0], notes: [36, null, null, null], automation: {} },
        { steps: [0, 0, 0, 0], notes: [null, null, null, null], automation: {} },
      ],
    },
    {
      name: "bass", engineKey: "dm:silverbox",
      params: { vol: 0.7, harm: 0.2 },
      fxConfig: { delay: { wet: 0, time: 0.25 }, reverb: { wet: 0, decay: 2 } },
      uploadAudio: "A".repeat(20_000),      // a sample payload, base64
      patterns: [
        { steps: [1, 0, 1, 0], notes: [36, null, 43, null], automation: {} },
        { steps: [0, 0, 0, 0], notes: [null, null, null, null], automation: { cutoff: { enabled: true, values: [0, 1, 0, 1] } } },
      ],
    },
  ],
  ...over,
});

const clone = (v) => structuredClone(v);
const stripView = ({ activePattern, ...rest }) => rest;

// ---- diffValue / patchValue ---------------------------------------------

test("a value patched with its own diff is the target", () => {
  const a = session();
  const b = clone(a);
  b.bpm = 128;
  b.tracks[0].params.harm = 0.9;
  b.tracks[1].patterns[0].steps[1] = 1;
  b.tracks[1].fxConfig.delay.wet = 0.4;
  delete b.tracks[0].fxConfig.reverb;
  b.tracks[1].patterns[1].automation.reson = { enabled: false, values: [] };
  const d = diffValue(a, b);
  assert.deepEqual(patchValue(a, d), b);
});

test("no difference is null, and the base is never touched", () => {
  const a = session();
  const before = clone(a);
  assert.equal(diffValue(a, clone(a)), null);
  const b = clone(a);
  b.tracks[0].params.vol = 0.1;
  patchValue(a, diffValue(a, b));
  assert.deepEqual(a, before);
});

test("the untouched subtrees of a patched value are shared with the base", () => {
  const a = session();
  const b = clone(a);
  b.tracks[0].params.vol = 0.1;
  const out = patchValue(a, diffValue(a, b));
  assert.equal(out.tracks[1], a.tracks[1]);                 // the other track: same object
  assert.equal(out.tracks[0].patterns, a.tracks[0].patterns); // same track, untouched part
  assert.notEqual(out.tracks[0].params, a.tracks[0].params);
});

// ---- diffSession / applySessionPatch ------------------------------------

test("a knob turn does not carry the sample", () => {
  const a = session();
  const b = clone(a);
  b.tracks[1].params.harm = 0.6;
  const patch = diffSession(a, b);
  const text = JSON.stringify(patch);
  assert.ok(text.length < 400, `patch is ${text.length} chars`);
  assert.ok(!text.includes("AAAAAAAA"));
  const r = applySessionPatch(a, patch);
  assert.equal(r.ok, true);
  assert.deepEqual(r.session, stripView(b));
});

test("which pattern you are looking at is not part of the song", () => {
  const a = session();
  const b = clone(a);
  b.activePattern = 5;
  assert.equal(diffSession(a, b), null);
});

test("two peers editing different tracks both land, in either order", () => {
  const base = session();
  const fromA = clone(base); fromA.tracks[0].params.vol = 0.3;           // A turns the kick down
  const fromB = clone(base); fromB.tracks[1].patterns[0].steps[3] = 1;   // B adds a bass hit
  const pa = diffSession(base, fromA);
  const pb = diffSession(base, fromB);

  // A receives B's patch over its own state; B receives A's over its own.
  const atA = applySessionPatch(fromA, pb);
  const atB = applySessionPatch(fromB, pa);
  assert.equal(atA.ok, true);
  assert.equal(atB.ok, true);
  assert.deepEqual(atA.session, atB.session);
  assert.equal(atA.session.tracks[0].params.vol, 0.3);
  assert.equal(atA.session.tracks[1].patterns[0].steps[3], 1);
});

test("a track added or removed sends the track list whole", () => {
  const a = session();
  const b = clone(a);
  b.tracks.push({ name: "hat", engineKey: "dm:909-chat", params: {}, fxConfig: {}, uploadAudio: null, patterns: [] });
  const patch = diffSession(a, b);
  assert.equal(patch.from, 2);
  assert.equal(patch.n, 3);
  assert.ok(patch.d.obj.tracks.set, "whole list");
  const r = applySessionPatch(a, patch);
  assert.equal(r.ok, true);
  assert.equal(r.session.tracks.length, 3);
});

test("a patch written against a different track count is refused", () => {
  const base = session();
  const edited = clone(base); edited.tracks[1].params.vol = 0.2;
  const patch = diffSession(base, edited);
  const shorter = clone(base); shorter.tracks.pop();
  const r = applySessionPatch(shorter, patch);
  assert.equal(r.ok, false);
  assert.match(r.reason, /track count/);
});

test("a patch that would land on a different track is refused", () => {
  const base = session();
  const edited = clone(base); edited.tracks[1].params.vol = 0.2;
  const patch = diffSession(base, edited);
  assert.deepEqual(patch.keys, { 1: ["dm:silverbox", "bass"] });
  // Same count, but the other peer swapped a track out in the meantime.
  const swapped = clone(base);
  swapped.tracks[1] = { ...swapped.tracks[1], name: "lead", engineKey: "plaits:0" };
  const r = applySessionPatch(swapped, patch);
  assert.equal(r.ok, false);
  assert.match(r.reason, /track 2/);
});

test("a rename is an edit to the track, not a refusal", () => {
  const base = session();
  const renamed = clone(base); renamed.tracks[1].name = "acid";
  const patch = diffSession(base, renamed);
  const r = applySessionPatch(clone(base), patch);
  assert.equal(r.ok, true);
  assert.equal(r.session.tracks[1].name, "acid");
});

test("a patch from another format version is refused", () => {
  const r = applySessionPatch(session(), { v: 99, from: 2, n: 2, keys: {}, d: null });
  assert.equal(r.ok, false);
});
