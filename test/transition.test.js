import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS,
  compositeSession,
  fadeGain,
  freeSlot,
  groupStages,
  isKick,
  isSnare,
  overlapSession,
  rollVelocity,
  BRIDGE_MAX_BARS,
  blankPattern,
  bridgeHasNotes,
  bridgeLayout,
  bridgePrompt,
  bridgeSession,
  codeBridge,
  introPlan,
  sameLayout,
  trackGroup,
  SWEEP_BOTTOM,
  SWEEP_TOP,
  normalizeTransition,
  openSteps,
  rampBpm,
  sweepHz,
  tempoMode,
  transitionSteps,
} from "../public/js/transitionPlan.js";

test("defaults: next bar, cut, 2 bars, auto tempo", () => {
  assert.deepEqual(normalizeTransition(), { when: "bar", shape: "cut", bars: 2, tempo: "auto" });
  assert.deepEqual(normalizeTransition({ when: "x", shape: "sweep", bars: 3, tempo: "ramp" }),
    { when: "bar", shape: "sweep", bars: 2, tempo: "ramp" });
  assert.equal(normalizeTransition({ bars: "8" }).bars, 8);
});

test("a cut lands on the next bar line, or at once", () => {
  assert.deepEqual(transitionSteps({ when: "bar", shape: "cut", bars: 4 }, 16, 0), { wait: 0, run: 0 });
  assert.deepEqual(transitionSteps({ when: "bar", shape: "cut", bars: 4 }, 16, 5), { wait: 11, run: 0 });
  assert.deepEqual(transitionSteps({ when: "now", shape: "cut", bars: 4 }, 16, 5), { wait: 0, run: 0 });
});

test("a sweep runs whole bars and always ends on a bar line", () => {
  for (const bars of [1, 2, 4, 8]) {
    for (const barLen of [16, 14, 28, 12]) {
      for (let tick = 0; tick < barLen; tick++) {
        for (const when of ["bar", "now"]) {
          const { wait, run } = transitionSteps({ when, shape: "sweep", bars }, barLen, tick);
          assert.equal((tick + wait + run) % barLen, 0, `${when} ${bars} ${barLen} ${tick}`);
          assert.ok(run >= Math.ceil(barLen / 2) + (bars - 1) * barLen, "never shorter than half a bar under the asked length");
          if (when === "bar") assert.equal(run, bars * barLen);
          else assert.equal(wait, 0);
        }
      }
    }
  }
});

test("tempo: a cut jumps, auto ramps close tempos and jumps far ones", () => {
  assert.equal(tempoMode("auto", 120, 120, "sweep"), "none");
  assert.equal(tempoMode("ramp", 120, 128, "cut"), "jump");
  assert.equal(tempoMode("auto", 124, 128, "sweep"), "ramp");
  assert.equal(tempoMode("auto", 120, 137, "sweep"), "ramp");
  assert.equal(tempoMode("auto", 100, 140, "sweep"), "jump");
  assert.equal(tempoMode("auto", 87, 174, "sweep"), "jump");
  assert.equal(tempoMode("auto", 174, 87, "sweep"), "jump");
  assert.equal(tempoMode("ramp", 100, 140, "sweep"), "ramp");
  assert.equal(tempoMode("jump", 124, 128, "sweep"), "jump");
});

test("the ramp and the sweep run from where they are to where they land", () => {
  assert.equal(rampBpm(120, 128, 0), 120);
  assert.equal(rampBpm(120, 128, 1), 128);
  assert.equal(rampBpm(120, 128, 2), 128);
  assert.equal(rampBpm(120, 128, 0.5), 124);
  assert.equal(sweepHz(0), SWEEP_TOP);
  assert.ok(Math.abs(sweepHz(1) - SWEEP_BOTTOM) < 1e-6);
  let last = Infinity;
  for (let p = 0; p <= 1; p += 0.05) { const f = sweepHz(p); assert.ok(f <= last); last = f; }
  assert.equal(openSteps(1, 16), 8);
  assert.equal(openSteps(4, 16), 16);
});

const pat = (steps, notes = [], chords = [], extra = []) => ({ steps, notes, chords, extraNotes: extra });
const on = (n) => Array.from({ length: 16 }, (_, i) => i % n === 0);
const T = {
  kick: { name: "kick", engineKey: "drum:808-kick", isDrumKit: true, patterns: [pat(on(4))] },
  bass: { name: "bass", engineKey: "dm:silverbox", patterns: [pat(on(2), Array(16).fill(36))] },
  low: { name: "line", engineKey: "plaits:va", patterns: [pat(on(2), Array(16).fill(40))] },
  pad: { name: "pad", engineKey: "pad", patterns: [pat(on(8), Array(16).fill(60), Array(16).fill("min"))] },
  lead: { name: "lead", engineKey: "dm:hexop", patterns: [pat(on(4), Array(16).fill(72))] },
  bus: { name: "bus", engineKey: "bus", patterns: [] },
};

test("groups: drums, bass, harmony, lead, bus", () => {
  assert.deepEqual(GROUPS, ["drums", "bass", "harmony", "lead"]);
  assert.equal(trackGroup(T.kick), "drums");
  assert.equal(trackGroup(T.bass), "bass");
  assert.equal(trackGroup(T.low), "bass", "a part written low is the bass");
  assert.equal(trackGroup(T.pad), "harmony");
  assert.equal(trackGroup(T.lead), "lead");
  assert.equal(trackGroup(T.bus), "bus");
});

test("stagger: one group a bar over four, a beat over one", () => {
  assert.deepEqual(groupStages("stagger", 4, 16, 4).map(e => [e.groups[0], e.at]),
    [["drums", 0], ["bass", 16], ["harmony", 32], ["lead", 48]]);
  assert.deepEqual(groupStages("stagger", 1, 16, 4).map(e => e.at), [0, 4, 8, 12]);
});

test("drop: rest, then bass, then drums, and a near-silent last bar", () => {
  const four = groupStages("drop", 4, 16, 4);
  assert.deepEqual(four.map(e => e.groups.join("+")), ["harmony+lead", "bass", "drums"]);
  assert.deepEqual(four.map(e => e.at), [16, 32, 48], "the drums leave as the last bar starts");
  const one = groupStages("drop", 1, 16, 4);
  assert.deepEqual(one.map(e => e.at), [4, 8, 12], "over one bar: a beat each, the last beat silent");
});

test("fade: unity to -36dB", () => {
  assert.equal(fadeGain(0), 1);
  assert.ok(Math.abs(20 * Math.log10(fadeGain(1)) + 36) < 1e-9);
});

const oldS = { bpm: 120, activePattern: 0, tracks: [T.kick, { ...T.bass, outIndex: 2 }, T.bus, T.pad], macroPads: [{ name: "p", x: [{ track: 3, key: "vol" }], y: [{ track: 1, key: "cutoff" }] }] };
const newS = { bpm: 126, activePattern: 0, tracks: [{ ...T.kick, name: "kick2" }, T.lead, { ...T.bass, name: "acid" }], macroPads: [] };

test("stagger's mixed session: arrived groups from the new song, the rest from the old, indices renumbered", () => {
  const mid = compositeSession(oldS, newS, new Set(["drums"]));
  assert.equal(mid.bpm, 126);
  assert.deepEqual(mid.tracks.map(t => t.name), ["kick2", "bass", "bus", "pad"]);
  assert.equal(mid.tracks[1].outIndex, 2, "the old bass still feeds the old bus");
  assert.deepEqual(mid.macroPads[0].x.map(a => a.track), [3]);
  assert.deepEqual(mid.macroPads[0].y.map(a => a.track), [1]);
  const late = compositeSession(oldS, newS, new Set(["drums", "bass", "harmony"]));
  assert.deepEqual(late.tracks.map(t => t.name), ["kick2", "acid", "bus"]);
  assert.equal(late.macroPads[0].x.length, 0, "a pad on a track that left lets it go");
});

test("overlap: every new track, and the old ones the new song lacks", () => {
  const both = overlapSession(oldS, { ...newS, tracks: [...newS.tracks, T.pad] });
  assert.deepEqual(both.tracks.map(t => t.name), ["kick2", "lead", "acid", "pad", "kick", "bass", "bus"]);
  assert.equal(both.tracks.find(t => t.name === "bass").outIndex, 6);
});

test("bridge: a free slot and a rising roll", () => {
  assert.equal(freeSlot(newS), 1);
  const full = { tracks: [{ patterns: Array.from({ length: 32 }, () => pat([true])) }] };
  assert.equal(freeSlot(full), -1);
  const roll = Array.from({ length: 16 }, (_, k) => (rollVelocity(k, 16) ? "x" : ".")).join("");
  assert.equal(roll, "x.x.x.x.xxxxxxxx");
  assert.ok(rollVelocity(15, 16) > rollVelocity(0, 16));
  assert.equal(rollVelocity(16, 16), 0);
  assert.ok(isKick({ name: "kick", engineKey: "dm:808-kick" }) && !isKick({ name: "hat" }));
  assert.ok(isSnare({ name: "clap" }) && isSnare({ engineKey: "dm:lancet" }));
  assert.equal("patterns" in normalizeTransition({ shape: "bridge", patterns: 3 }), false);
  // a bridge has bars of its own to ramp across
  assert.equal(tempoMode("auto", 124, 128, "bridge"), "ramp");
  assert.equal(tempoMode("auto", 100, 140, "bridge"), "jump");
});

// A full pattern: `str` tiled over `len` steps, x a hit.
function part(str, len = 16, note = 60) {
  const p = blankPattern(len);
  for (let i = 0; i < len; i++) {
    if (str[i % str.length] !== "x") continue;
    p.steps[i] = 1; p.notes[i] = note; p.lengths[i] = 1; p.velocities[i] = 0.8;
  }
  return p;
}
const trk = (name, engineKey, patterns, extra = {}) => ({ name, engineKey, speed: 1, length: 16, patterns, ...extra });
const hits = (p, from = 0, to = p.steps.length) => p.steps.slice(from, to).filter(Boolean).length;

// The new song: a sparse intro (pad alone, 4 bars), then the song (2 slots).
const NEXT = {
  bpm: 126, activePattern: 0, patternMode: "chain", patternRepeats: [4, 8, 8],
  scale: { active: true, root: 9, mode: "minor" },
  tracks: [
    trk("kick", "drum:909-kick", [blankPattern(16), part("x..."), part("x...")], { isDrumKit: true }),
    trk("sub", "dm:sub", [blankPattern(16), part("x.x.", 16, 33), part("x...", 16, 33)]),
    trk("pad", "pad", [part("x......."), part("x......."), part("x.......")]),
  ],
};
// The song playing: one pattern, a different kit, bass, chords and lead.
const PREV = {
  bpm: 120, activePattern: 0, patternMode: "repeat",
  tracks: [
    trk("kick", "drum:808-kick", [part("x...")], { isDrumKit: true }),
    trk("snare", "drum:808-snare", [part("....x...")], { isDrumKit: true }),
    trk("bass", "dm:silverbox", [part("x.xx", 16, 36)]),
    trk("keys", "dm:tines", [Object.assign(part("x.......", 16, 60), { chords: Array(16).fill("min") })]),
    trk("lead", "dm:hexop", [part("x.x.", 16, 76)]),
  ],
};

test("the intro: the leading sections sparser than the song, and where it carries on", () => {
  const i = introPlan(NEXT);
  assert.deepEqual(i.sections, [{ slot: 0, bars: 4 }]);
  assert.equal(i.land, 1);
  assert.equal(i.leadIn, false);
  assert.equal(i.barLen, 16);
  // A song that does not chain: its pattern, once, and it starts from the top.
  const one = introPlan(PREV);
  assert.deepEqual(one.sections, [{ slot: 0, bars: 1 }]);
  assert.equal(one.land, 0);
  assert.equal(one.leadIn, true);
  // Two sparse sections before the full one are both the intro.
  const two = { ...NEXT, patternRepeats: [4, 4, 8], tracks: NEXT.tracks.map((t, k) => ({ ...t, patterns: [t.patterns[0], k === 0 ? blankPattern(16) : t.patterns[1], t.patterns[2]] })) };
  assert.deepEqual(introPlan(two).sections, [{ slot: 0, bars: 4 }, { slot: 1, bars: 4 }]);
  assert.equal(introPlan(two).land, 2);
  // An intro longer than a bridge runs is led into, and the song starts at the top.
  const long = introPlan({ ...NEXT, patternRepeats: [BRIDGE_MAX_BARS + 8, 8, 8] });
  assert.equal(long.leadIn, true);
  assert.equal(long.land, 0);
  assert.ok(long.bars <= 8);
  // `start` moves where the song is taken to begin.
  assert.equal(introPlan(NEXT, { start: 1 }).sections[0].slot, 1);
});

test("the layout: the intro cut into patterns of 64 steps, in slots free in both songs", () => {
  const l = bridgeLayout(PREV, NEXT);
  assert.equal(l.bars, 4);
  assert.deepEqual(l.segs.map(g => [g.slot, g.bars]), [[3, 4]]);
  assert.deepEqual(l.segs[0].from, [0, 1, 2, 3].map(bar => ({ slot: 0, bar })));
  assert.equal(l.land, 1);
  assert.equal(l.oldSlot, 0);
  // Eight bars are two patterns; a double-speed track halves what one holds.
  const eight = bridgeLayout(PREV, { ...NEXT, patternRepeats: [8, 8, 8] });
  assert.deepEqual(eight.segs.map(g => [g.slot, g.bars]), [[3, 4], [4, 4]]);
  const fast = bridgeLayout({ ...PREV, tracks: [{ ...PREV.tracks[0], speed: 2 }] }, NEXT);
  assert.deepEqual(fast.segs.map(g => g.bars), [2, 2]);
  // No free slot in either song: no bridge.
  const full = { tracks: [trk("x", "pad", Array.from({ length: 32 }, () => part("x")))] };
  assert.equal(bridgeLayout(full, NEXT), null);
  assert.ok(sameLayout(l, bridgeLayout(PREV, NEXT)));
  assert.ok(!sameLayout(l, eight));
});

test("the draft: the new song's intro under the old song's outro", () => {
  const l = bridgeLayout(PREV, NEXT);
  const s = codeBridge(PREV, NEXT, l);
  const slot = l.segs[0].slot;
  const by = Object.fromEntries(s.tracks.map(t => [`${t.engineKey}/${t.name}`, t.patterns[slot]]));
  assert.equal(s.bpm, 126);
  assert.equal(s.tracks.length, 3 + 5);
  for (const p of Object.values(by)) assert.equal(p.steps.length, 64);
  // the new song plays its intro: the pad, four times over; its kick and sub rest
  assert.equal(hits(by["pad/pad"]), 8);
  assert.equal(hits(by["drum:909-kick/kick"]), 0);
  assert.equal(hits(by["dm:sub/sub"]), 0);
  // the old song thins: lead a bar, chords two, bass three, the kick to the last bar
  assert.ok(hits(by["dm:hexop/lead"], 0, 16) > 0);
  assert.equal(hits(by["dm:hexop/lead"], 16), 0);
  assert.ok(hits(by["dm:tines/keys"], 16, 32) > 0);
  assert.equal(hits(by["dm:tines/keys"], 32), 0);
  assert.ok(hits(by["dm:silverbox/bass"], 32, 48) > 0);
  assert.equal(hits(by["dm:silverbox/bass"], 48), 0);
  assert.equal(hits(by["drum:808-kick/kick"], 0, 48), 12);
  assert.equal(hits(by["drum:808-kick/kick"], 48), 0);
  // and its snare rolls up into the landing
  const snare = by["drum:808-snare/snare"];
  assert.equal(snare.steps.slice(48).map(v => (v ? "x" : ".")).join(""), "x.x.x.x.xxxxxxxx");
  assert.ok(snare.velocities[63] > snare.velocities[48]);
  // the songs themselves are as they were
  assert.deepEqual(s.tracks[2].patterns[0], NEXT.tracks[2].patterns[0]);
  assert.deepEqual(s.tracks[5].patterns[0], PREV.tracks[2].patterns[0]);
  assert.ok(bridgeHasNotes(s, l));
  assert.ok(!bridgeHasNotes(NEXT, l));
});

test("the draft: the old kick and bass rest wherever the new song plays its own", () => {
  // an intro with the new kick and sub in from the start
  const busy = { ...NEXT, tracks: NEXT.tracks.map(t => ({ ...t, patterns: [t.patterns[1], t.patterns[1], t.patterns[2]] })), patternRepeats: [2, 8, 8] };
  const l = bridgeLayout(PREV, busy);
  const s = codeBridge(PREV, busy, l);
  const slot = l.segs[0].slot;
  const old = (name) => s.tracks.find(t => t.name === name && PREV.tracks.some(o => o.engineKey === t.engineKey)).patterns[slot];
  assert.equal(hits(old("kick")), 0);
  assert.equal(hits(old("bass")), 0);
  assert.ok(hits(old("lead")) > 0);
});

test("the prompt names the bridge patterns, the outgoing tracks and the landing", () => {
  const l = bridgeLayout(PREV, NEXT);
  const text = bridgePrompt(PREV, NEXT, l);
  assert.match(text, /pattern 4 \(index 3\): 4 bars, 64 steps/);
  assert.match(text, /OUTGOING song\): kick, snare, bass, keys, lead/);
  assert.match(text, /carries on from pattern 2/);
  assert.match(text, /A minor/);
  assert.ok(text.includes("\n") && !text.includes("\\n"));
  assert.match(bridgePrompt(NEXT, PREV, bridgeLayout(NEXT, PREV)), /follows it from the top/);
});

test("a written bridge: only the bridge patterns are taken from the model's session", () => {
  const l = bridgeLayout(PREV, NEXT);
  const draft = codeBridge(PREV, NEXT, l);
  const slot = l.segs[0].slot;
  const result = JSON.parse(JSON.stringify(draft));
  result.bpm = 90;                                              // not its to change
  result.tracks[2].patterns[slot] = part("xx", 64);             // the pad's bridge, rewritten
  result.tracks[2].patterns[0] = part("xxxx");                  // the song itself: ignored
  result.tracks[5].patterns[slot] = part("x", 32);              // the wrong length: the draft's stays
  result.tracks.push(trk("extra", "pad", [part("x")]));         // a track it was not asked for
  const out = bridgeSession(draft, result, l);
  assert.equal(out.bpm, 126);
  assert.equal(out.tracks.length, draft.tracks.length);
  assert.equal(hits(out.tracks[2].patterns[slot]), 64);
  assert.deepEqual(out.tracks[2].patterns[0], draft.tracks[2].patterns[0]);
  assert.deepEqual(out.tracks[5].patterns[slot], draft.tracks[5].patterns[slot]);
});
