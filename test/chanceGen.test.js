import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANCE_DEFAULTS, CHANCE_MOD_KEYS, CHANCE_MOD_RANGE, CHANCE_NOTE_VALUES,
  buildChancePlan, chanceCandidates, chanceFromUnit, chanceToUnit, chanceWindow,
  cloneChance, normalizeChance,
} from "../public/js/chanceGen.js";

// The chance generator is the one part of this app whose output is *random*, and
// a random generator you cannot assert on is one you cannot tell from a broken
// one. That is why chanceGen.js has no imports: everything here runs the real
// generator, outside a browser, and pins the properties the panel promises.

/** A config with the defaults, overridden. */
const cfg = (over = {}) => normalizeChance({ ...CHANCE_DEFAULTS, ...over }, 16);
/** Every note the plan places, in window order. */
const notesOf = (plan) => plan.filter(Boolean);
/** Total steps the notes hold. Rests are not notes, so this only equals the
 *  window's length when `rest` is 0. */
const spanTotal = (plan) => plan.reduce((n, h) => n + (h ? h.span : 0), 0);

/**
 * The invariant the transport depends on, whatever the odds: notes are laid end
 * to end, so no two overlap and none runs past the window's seam. An overlap
 * would have the transport start a note over one still sounding and the grid
 * draw two cells in one slot.
 */
function assertLaidEndToEnd(plan, where) {
  const win = plan.length;
  for (let i = 0; i < win; i++) {
    const h = plan[i];
    if (!h) continue;
    assert.ok(h.span >= 1, `${where}: note at ${i} has span ${h.span}`);
    assert.ok(i + h.span <= win, `${where}: note at ${i} runs past step ${win}`);
    for (let k = 1; k < h.span; k++) {
      assert.equal(plan[i + k], null, `${where}: note at ${i + k} overlaps the one at ${i}`);
    }
  }
}

const NV = Object.fromEntries(CHANCE_NOTE_VALUES.map((v, i) => [v.label, i]));

test("the note-value ladder is the machine's eight, longest first", () => {
  assert.deepEqual(CHANCE_NOTE_VALUES.map(v => v.label),
    ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/32"]);
  // Ordered by the value each one sounds, which is span / hits — that ordering is
  // what makes "variation left = longer" mean anything.
  const sounded = CHANCE_NOTE_VALUES.map(v => v.span / v.hits);
  for (let i = 1; i < sounded.length; i++) {
    assert.ok(sounded[i] < sounded[i - 1],
      `${CHANCE_NOTE_VALUES[i].label} should sound shorter than ${CHANCE_NOTE_VALUES[i - 1].label}`);
  }
  // The triplets are three notes across a power-of-two span, which is what a
  // triplet is and the only way a sixteenth grid can hold one.
  assert.deepEqual(CHANCE_NOTE_VALUES[NV["1/4T"]], { label: "1/4T", span: 8, hits: 3 });
  assert.deepEqual(CHANCE_NOTE_VALUES[NV["1/8T"]], { label: "1/8T", span: 4, hits: 3 });
  assert.deepEqual(CHANCE_NOTE_VALUES[NV["1/32"]], { label: "1/32", span: 1, hits: 2 });
});

test("note value alone sets a plain grid — no randomness in it at all", () => {
  for (const label of ["1/1", "1/2", "1/4", "1/8", "1/16"]) {
    const c = cfg({ note: NV[label] });
    const plan = buildChancePlan(c);
    const span = CHANCE_NOTE_VALUES[NV[label]].span;
    assert.equal(notesOf(plan).length, Math.floor(16 / span), `${label} note count`);
    for (const h of notesOf(plan)) assert.equal(h.span, span, `${label} note span`);
    // Every step is accounted for: nothing overlaps and nothing is left over.
    assert.equal(spanTotal(plan), 16, `${label} covers the window exactly`);
    assertLaidEndToEnd(plan, label);
  }
});

test("a throw is held: the same seed and settings give the same part", () => {
  const c = cfg({ var: 0.6, rest: 0.3, leg: 0.2, rseed: 12345, mseed: 999 });
  assert.deepEqual(buildChancePlan(c), buildChancePlan(c));
});

test("a new throw gives a different part", () => {
  const base = cfg({ var: 0.6, rest: 0.3, rseed: 1 });
  let differs = 0;
  for (let seed = 2; seed < 30; seed++) {
    const other = buildChancePlan({ ...base, rseed: seed });
    if (JSON.stringify(other) !== JSON.stringify(buildChancePlan(base))) differs++;
  }
  // Not every seed need differ (a short window has few outcomes), but almost all
  // must, or the dice are not dice.
  assert.ok(differs > 24, `only ${differs} of 28 throws differed`);
});

test("realtime mode re-throws every pass; dice mode does not", () => {
  const held = cfg({ var: 0.6, rest: 0.3 });
  assert.deepEqual(buildChancePlan(held, { rpass: 0 }), buildChancePlan(held, { rpass: 7 }));
  const free = cfg({ var: 0.6, rest: 0.3, rfree: true });
  const passes = new Set(
    Array.from({ length: 12 }, (_, p) => JSON.stringify(buildChancePlan(free, { rpass: p }))));
  assert.ok(passes.size > 8, `only ${passes.size} distinct parts over 12 passes`);
});

test("the two sections' dice are independent", () => {
  const a = cfg({ rseed: 7, mseed: 7, var: 0.5 });
  const b = { ...a, mseed: 8 };
  const pa = buildChancePlan(a), pb = buildChancePlan(b);
  // A new melody throw keeps the rhythm exactly.
  assert.deepEqual(pa.map(h => h && h.span), pb.map(h => h && h.span));
  assert.notDeepEqual(pa.map(h => h && h.note), pb.map(h => h && h.note));
});

test("rest thins the part out, and at 1 there is nothing left", () => {
  const at = (rest) => notesOf(buildChancePlan(cfg({ note: NV["1/16"], rest }))).length;
  assert.equal(at(0), 16);
  assert.equal(at(1), 0);
  // Monotone on average rather than per step, so compare the ends of the range.
  assert.ok(at(0.75) < at(0.25), `${at(0.75)} notes at 0.75 vs ${at(0.25)} at 0.25`);
});

test("turning rest up only removes notes — it does not reshuffle the melody", () => {
  // Each decision has its own hash stream keyed by step, which is what makes a
  // part survive being tuned. On the machine one stream drives everything and
  // touching a knob rearranges the lot.
  const quiet = buildChancePlan(cfg({ note: NV["1/16"], rest: 0 }));
  const thin = buildChancePlan(cfg({ note: NV["1/16"], rest: 0.5 }));
  for (let i = 0; i < 16; i++) {
    if (thin[i]) assert.equal(thin[i].note, quiet[i].note, `step ${i} changed pitch`);
  }
  assert.ok(notesOf(thin).length < 16, "rest 0.5 should have dropped something");
});

test("legato at 1 leaves a single note holding the whole window", () => {
  const plan = buildChancePlan(cfg({ note: NV["1/16"], leg: 1 }));
  const notes = notesOf(plan);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].span, 16);
  assert.equal(plan[0].span, 16, "and it is the first slot that holds it");
});

test("legato ties rather than gates, so it never changes the total span", () => {
  for (const leg of [0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(spanTotal(buildChancePlan(cfg({ note: NV["1/8"], leg }))), 16,
      `legato ${leg} still covers the window`);
  }
});

test("variation off means the base value only, either side of zero", () => {
  const plan = buildChancePlan(cfg({ note: NV["1/8"], var: 0 }));
  for (const h of notesOf(plan)) assert.equal(h.span, 2);
});

test("variation left brings in longer values, right shorter ones", () => {
  const spans = (v) => notesOf(buildChancePlan(cfg({ note: NV["1/8"], var: v }))).map(h => h.span);
  const longer = spans(-1), shorter = spans(1);
  assert.ok(longer.some(s => s > 2), `nothing longer than 1/8 in ${longer}`);
  assert.ok(!longer.some(s => s < 2), `something shorter crept in: ${longer}`);
  assert.ok(shorter.some(s => s < 2), `nothing shorter than 1/8 in ${shorter}`);
  assert.ok(!shorter.some(s => s > 2), `something longer crept in: ${shorter}`);
});

test("triplets and 1/32s are out of variation's reach until switched on", () => {
  // Over a spread of throws, not one: whether a given throw happens to place a
  // triplet where it fits whole is the dice's business (a cut one is demoted to
  // a plain note — see the ratchet test below), so what is asserted is that the
  // family becomes reachable, not that any particular throw reaches it.
  const hitsOver = (over) => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      for (const h of notesOf(buildChancePlan(cfg({ note: NV["1/8"], var: 1, rseed: seed, ...over })))) {
        seen.add(h.hits);
      }
    }
    return seen;
  };
  assert.deepEqual([...hitsOver({})], [1], "no ratcheted values by default");
  assert.deepEqual([...hitsOver({ trips: true, var: -1 })].sort(), [1, 3],
    "triplets, and only triplets, once allowed");
  assert.deepEqual([...hitsOver({ x32: true })].sort(), [1, 2],
    "1/32s, and only 1/32s, once allowed");
});

test("the base note value is unrestricted by those two switches", () => {
  // The manual is explicit: switching the triplets off restricts variation, not
  // the knob.
  for (const label of ["1/4T", "1/8T", "1/32"]) {
    const plan = buildChancePlan(cfg({ note: NV[label], trips: false, x32: false }));
    const v = CHANCE_NOTE_VALUES[NV[label]];
    assert.equal(notesOf(plan)[0].hits, v.hits, `${label} base value survives`);
  }
});

test("no note crosses the window's seam", () => {
  for (const note of [NV["1/1"], NV["1/2"], NV["1/4"]]) {
    for (const win of [3, 5, 7, 16]) {
      const c = normalizeChance({ ...CHANCE_DEFAULTS, note, last: win - 1, var: 0.8 }, 16);
      const plan = buildChancePlan(c);
      assert.equal(plan.length, win);
      assertLaidEndToEnd(plan, `note ${note} in a ${win}-step window`);
      assert.equal(spanTotal(plan), win);
    }
  }
});

test("a note value cut to fit the window loses its ratchet with its length", () => {
  // The triplets and the 1/32s are a span AND a number of strikes inside it. A
  // 1/4T squeezed from eight steps into six would play three notes across a
  // dotted quarter — a wrong note value wearing a triplet's name. Cut, it is a
  // plain note of whatever room was left.
  for (const win of [1, 2, 3, 5, 6, 7, 9, 11, 13]) {
    for (const note of [NV["1/1"], NV["1/2"], NV["1/4T"], NV["1/8T"], NV["1/32"]]) {
      const c = normalizeChance({ ...CHANCE_DEFAULTS, note, last: win - 1 }, 16);
      const plan = buildChancePlan(c);
      assertLaidEndToEnd(plan, `${CHANCE_NOTE_VALUES[note].label} in ${win} steps`);
      for (let i = 0; i < win; i++) {
        const h = plan[i];
        if (!h) continue;
        const full = CHANCE_NOTE_VALUES[note];
        assert.equal(h.hits, h.span === full.span ? full.hits : 1,
          `${full.label} at ${i} of ${win}: span ${h.span} with ${h.hits} hits`);
      }
    }
  }
  // And the same under variation, which is where the cut actually turns up.
  for (let seed = 1; seed <= 60; seed++) {
    const c = normalizeChance(
      { ...CHANCE_DEFAULTS, note: NV["1/4"], var: 0.8, trips: true, x32: true, rseed: seed }, 16);
    for (const h of notesOf(buildChancePlan(c))) {
      const known = CHANCE_NOTE_VALUES.find(v => v.span === h.span && v.hits === h.hits);
      assert.ok(h.hits === 1 || known,
        `span ${h.span} × ${h.hits} hits is not a note value the ladder has`);
    }
  }
});

test("only semitones that are raised AND in range can be played", () => {
  // One fader up: that pitch class, in every octave of the range.
  const c = cfg({ pcs: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], lo: 48, hi: 72 });
  const cand = chanceCandidates(c);
  assert.deepEqual(cand.notes, [55, 67]);          // G3 and G4
  for (const h of notesOf(buildChancePlan(c))) assert.ok(cand.notes.includes(h.note));
});

test("a single raised fader is certain wherever it sits", () => {
  const low = cfg({ pcs: [0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0] });
  const high = cfg({ pcs: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] });
  const pcsOf = (c) => new Set(notesOf(buildChancePlan(c)).map(h => h.note % 12));
  assert.deepEqual([...pcsOf(low)], [4]);
  assert.deepEqual([...pcsOf(high)], [4]);
});

test("a raised fader outside the range contributes nothing", () => {
  // C♯ only, over a range that contains no C♯ at all.
  const c = cfg({ pcs: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], lo: 50, hi: 52 });
  assert.equal(chanceCandidates(c).total, 0);
  // And the generator does not fall silent — the rhythm is still there, so it
  // plays the bottom of the range and the panel says why.
  const notes = notesOf(buildChancePlan(c));
  assert.ok(notes.length > 0);
  for (const h of notes) assert.equal(h.note, 50);
});

test("probabilities are weights, so a louder fader turns up more often", () => {
  // Over one octave so each pitch class has exactly one candidate note.
  const c = cfg({ pcs: [1, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0], lo: 48, hi: 59, note: NV["1/16"] });
  let ones = 0, twos = 0;
  for (let seed = 1; seed <= 400; seed++) {
    for (const h of notesOf(buildChancePlan({ ...c, mseed: seed }))) {
      if (h.note % 12 === 0) ones++; else twos++;
    }
  }
  const ratio = ones / twos;
  assert.ok(ratio > 3.5 && ratio < 6.5, `C:D was ${ratio.toFixed(2)}, expected about 5`);
});

test("the range never runs backwards or past five octaves", () => {
  assert.equal(normalizeChance({ lo: 60, hi: 40 }, 16).hi, 60);
  assert.equal(normalizeChance({ lo: 24, hi: 96 }, 16).hi, 84);   // 24 + 60
  const c = normalizeChance({ lo: 30, hi: 30 }, 16);
  assert.equal(chanceCandidates({ ...c, pcs: new Array(12).fill(1) }).notes.length, 1);
});

test("the window never runs backwards, and clamps to the track's length", () => {
  assert.equal(normalizeChance({ first: 9, last: 3 }, 16).last, 9);
  const short = normalizeChance({ first: 20, last: 30 }, 8);
  assert.equal(short.first, 7);
  assert.equal(short.last, 7);
  assert.equal(chanceWindow(short), 1);
});

test("normalize fills in everything and survives rubbish", () => {
  const c = normalizeChance(null, 16);
  assert.deepEqual(Object.keys(c).sort(), Object.keys(CHANCE_DEFAULTS).sort());
  const junk = normalizeChance(
    { note: 99, var: "x", leg: -5, rest: NaN, pcs: [2, "a"], rseed: 0, lo: 1, hi: 500 }, 16);
  assert.equal(junk.note, CHANCE_NOTE_VALUES.length - 1);
  assert.equal(junk.leg, 0);
  assert.equal(junk.pcs.length, 12);
  assert.ok(junk.pcs.every(v => v >= 0 && v <= 1));
  assert.equal(junk.rseed, 1, "a zero seed is indistinguishable from an unset one");
  assert.ok(junk.lo >= 24 && junk.hi <= 96);
  assert.ok(Number.isFinite(junk.var) && Number.isFinite(junk.rest));
});

test("cloneChance copies the semitone array rather than sharing it", () => {
  const a = cloneChance(CHANCE_DEFAULTS);
  const b = cloneChance(a);
  b.pcs[0] = 0;
  assert.equal(a.pcs[0], 1);
  assert.equal(cloneChance(null), null);
});

test("every modulatable control round-trips through its 0..1 unit", () => {
  for (const key of CHANCE_MOD_KEYS) {
    const [lo, hi] = CHANCE_MOD_RANGE[key];
    assert.equal(chanceFromUnit(key, 0), lo, `${key} at 0`);
    assert.equal(chanceFromUnit(key, 1), hi, `${key} at 1`);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const v = chanceFromUnit(key, u);
      // The counts round, so a round trip lands within half a step of where it
      // started rather than exactly on it.
      const tol = hi > lo ? 0.5 / (hi - lo) + 1e-9 : 1;
      assert.ok(Math.abs(chanceToUnit(key, v) - u) <= tol, `${key} round trip at ${u}`);
    }
    // Out-of-range input is clamped, never propagated.
    assert.equal(chanceFromUnit(key, -3), lo);
    assert.equal(chanceFromUnit(key, 9), hi);
  }
});

test("a modulated value is always something the generator can use", () => {
  // Every 0..1 an LFO could hand any of the six, laid over the defaults, must
  // still build a plan — this is the path a lane sweeping `lo` past `hi` takes.
  for (const key of CHANCE_MOD_KEYS) {
    for (let i = 0; i <= 20; i++) {
      const c = normalizeChance({ ...CHANCE_DEFAULTS, [key]: chanceFromUnit(key, i / 20) }, 16);
      const plan = buildChancePlan(c);
      assert.equal(plan.length, chanceWindow(c));
      assertLaidEndToEnd(plan, `${key} at ${i / 20}`);
      for (const h of notesOf(plan)) {
        assert.ok(h.note >= c.lo && h.note <= c.hi, `${key} at ${i / 20} played out of range`);
        assert.ok(Number.isInteger(h.note));
        assert.ok(h.hits >= 1 && h.hits <= 8, "the transport clamps a ratchet to 1..8");
      }
    }
  }
});

test("accents land on the beat, and follow the window rather than the bar", () => {
  const c = cfg({ note: NV["1/16"] });
  const plan = buildChancePlan(c, { spb: 4 });
  assert.equal(plan[0].vel, 0.95);
  assert.equal(plan[1].vel, 0.68);
  assert.equal(plan[4].vel, 0.95);
  // A window starting off the beat keeps the TRACK's beats, not its own — its
  // step 0 is the track's step 2, which is not a downbeat.
  const off = buildChancePlan(normalizeChance({ ...CHANCE_DEFAULTS, note: NV["1/16"], first: 2 }, 16),
    { spb: 4 });
  assert.equal(off[0].vel, 0.68);
  assert.equal(off[2].vel, 0.95);
});
