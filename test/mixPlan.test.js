// The mix's arithmetic (public/js/mixPlan.js): the crossfader's law, the
// tempo between two songs, deck B's chain, and what a session says of itself.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bakeLevel, deckSummary, fadeAt, filledSlots, meterOf, mixBpm, nextFilled, sameScale, scaleLabel,
  startSlot, tempoRelation, xfadeGains,
} from "../public/js/mixPlan.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test("blend: the ends are exact and the power is constant across the travel", () => {
  assert.deepEqual(xfadeGains(0), { a: 1, b: 0 });
  assert.deepEqual(xfadeGains(1), { a: 0, b: 1 });
  for (let x = 0; x <= 1.0001; x += 0.05) {
    const g = xfadeGains(x);
    near(g.a * g.a + g.b * g.b, 1, 1e-9);
  }
  const mid = xfadeGains(0.5);
  near(mid.a, Math.SQRT1_2, 1e-9);
  near(mid.b, Math.SQRT1_2, 1e-9);
});

test("blend: each deck only ever falls as the fader moves away from it", () => {
  let last = xfadeGains(0);
  for (let x = 0.02; x <= 1.0001; x += 0.02) {
    const g = xfadeGains(x);
    assert.ok(g.a <= last.a + 1e-12 && g.b >= last.b - 1e-12);
    last = g;
  }
});

test("cut: both decks full across the middle, each cut at its far end", () => {
  assert.deepEqual(xfadeGains(0, "cut"), { a: 1, b: 0 });
  assert.deepEqual(xfadeGains(1, "cut"), { a: 0, b: 1 });
  for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const g = xfadeGains(x, "cut");
    near(g.a, 1, 1e-9);
    near(g.b, 1, 1e-9);
  }
  near(xfadeGains(0.05, "cut").b, 0.5, 1e-9);
  near(xfadeGains(0.95, "cut").a, 0.5, 1e-9);
});

test("the crossfader reads anything out of range as its nearest end", () => {
  assert.deepEqual(xfadeGains(-3), { a: 1, b: 0 });
  assert.deepEqual(xfadeGains(7), { a: 0, b: 1 });
  assert.deepEqual(xfadeGains(NaN), { a: 1, b: 0 });
});

test("the tempo sits between the two songs, linearly", () => {
  assert.equal(mixBpm(120, 130, 0), 120);
  assert.equal(mixBpm(120, 130, 1), 130);
  assert.equal(mixBpm(120, 130, 0.5), 125);
  assert.equal(mixBpm(140, 100, 0.25), 130);
  assert.equal(mixBpm(120, 0, 1), 120);        // deck B with no tempo is deck A's
  assert.equal(mixBpm(0, 128, 0), 128);
});

test("two tempos: the same, a half / double pair, or apart by a percentage", () => {
  assert.equal(tempoRelation(120, 120).kind, "same");
  assert.equal(tempoRelation(87, 174).kind, "double");
  assert.equal(tempoRelation(174, 87).kind, "half");
  assert.deepEqual(tempoRelation(120, 126), { kind: "apart", pct: 5 });
});

test("an automatic fade starts where the fader is, arrives where it was sent, and eases", () => {
  assert.equal(fadeAt(0.2, 1, 0, 64), 0.2);
  assert.equal(fadeAt(0.2, 1, 64, 64), 1);
  near(fadeAt(0, 1, 32, 64), 0.5);
  assert.ok(fadeAt(0, 1, 8, 64) < 8 / 64);       // slow away
  assert.ok(fadeAt(0, 1, 56, 64) > 56 / 64);     // slow in
  assert.equal(fadeAt(0, 1, 5, 0), 1);           // no length: there already
  let last = -1;
  for (let i = 0; i <= 64; i++) { const v = fadeAt(0, 1, i, 64); assert.ok(v >= last); last = v; }
});

const pat = (...on) => ({ steps: Array.from({ length: 16 }, (_, i) => (on.includes(i) ? 1 : 0)) });
const track = (slots, extra = {}) => ({ engineKey: "plaits:0", patterns: Array.from({ length: 32 }, (_, i) => (slots.includes(i) ? pat(0, 4) : pat())), ...extra });

test("a deck's filled slots come from its tracks, and a bus has none", () => {
  const f = filledSlots([track([0, 3]), track([5]), track([9], { engineKey: "bus" })]);
  assert.deepEqual(f.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), [0, 3, 5]);
  assert.equal(filledSlots([]).some(Boolean), false);
  assert.equal(filledSlots(null).length, 32);
});

test("deck B's chain goes to the next filled slot and wraps", () => {
  const f = filledSlots([track([1, 4, 7])]);
  assert.equal(nextFilled(f, 1), 4);
  assert.equal(nextFilled(f, 4), 7);
  assert.equal(nextFilled(f, 7), 1);
  assert.equal(nextFilled(f, 20), 1);
  assert.equal(nextFilled(filledSlots([track([6])]), 6), 6);
  assert.equal(nextFilled(filledSlots([]), 0), -1);
});

test("a deck starts on the slot the song was saved on, when it has notes", () => {
  assert.equal(startSlot({ activePattern: 3, tracks: [track([0, 3])] }), 3);
  assert.equal(startSlot({ activePattern: 2, tracks: [track([5, 9])] }), 5);
  assert.equal(startSlot({ activePattern: 2, tracks: [track([])] }), 2);
  assert.equal(startSlot({ tracks: [track([0])] }), 0);
});

test("a scale's label, and whether two snap notes the same way", () => {
  assert.equal(scaleLabel({ active: true, root: 6, mode: "minor" }), "F# minor");
  assert.equal(scaleLabel({ active: false, root: 6, mode: "minor" }), "");
  assert.equal(sameScale({ active: false, root: 0, mode: "minor" }, { active: false, root: 5, mode: "major" }), true);
  assert.equal(sameScale({ active: true, root: 0, mode: "minor" }, { active: true, root: 12, mode: "minor" }), true);
  assert.equal(sameScale({ active: true, root: 0, mode: "minor" }, { active: true, root: 0, mode: "major" }), false);
  assert.equal(sameScale({ active: true, root: 0, mode: "minor" }, { active: false, root: 0, mode: "minor" }), false);
  assert.equal(sameScale(null, undefined), true);
});

test("a session's meter is its slot's, else pattern 1's, else 4/4", () => {
  assert.deepEqual(meterOf({ patternMeters: [{ num: 7, den: 8 }, { num: 3, den: 4 }] }, 1), { num: 3, den: 4 });
  assert.deepEqual(meterOf({ patternMeters: [{ num: 7, den: 8 }] }, 5), { num: 7, den: 8 });
  assert.deepEqual(meterOf({}), { num: 4, den: 4 });
});

test("the summary a deck's header reads", () => {
  const s = deckSummary({
    bpm: 128, activePattern: 1, scale: { active: true, root: 9, mode: "minor" },
    patternMeters: [{ num: 4, den: 4 }, { num: 7, den: 8 }],
    tracks: [track([0, 1]), track([1]), track([], { engineKey: "bus" })],
  });
  assert.equal(s.bpm, 128);
  assert.equal(s.key, "A minor");
  assert.deepEqual(s.meter, { num: 7, den: 8 });
  assert.equal(s.tracks, 2);
  assert.equal(s.patterns, 2);
  assert.equal(deckSummary({}).bpm, 120);
  assert.equal(deckSummary(null).tracks, 0);
});

test("keeping both decks folds the crossfader into the bus faders", () => {
  assert.equal(bakeLevel(1, Math.SQRT1_2), 0.71);
  assert.equal(bakeLevel(0.8, 1), 0.8);
  assert.equal(bakeLevel(0.8, 0), 0);
  assert.equal(bakeLevel(1, 3), 1);
});
