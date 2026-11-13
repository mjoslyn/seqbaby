import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS,
  bridgeHasNotes,
  bridgePrompt,
  bridgeSession,
  codeBridge,
  compositeSession,
  fadeGain,
  freeSlot,
  groupStages,
  overlapSession,
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

test("bridge: a free slot, a prompt that says the length, only the slot taken back", () => {
  assert.equal(freeSlot(newS), 1);
  const full = { tracks: [{ patterns: Array.from({ length: 32 }, () => pat([true])) }] };
  assert.equal(freeSlot(full), -1);
  const prompt = bridgePrompt(oldS, newS, 1, 4, 0);
  assert.match(prompt, /exactly 4 bars long \(64 steps/);
  assert.match(prompt, /pattern 2 \(index 1\)/);
  assert.match(prompt, /120 bpm/);
  const result = {
    ...newS,
    bpm: 90,
    tracks: [
      { ...newS.tracks[0], patterns: [pat(on(1)), pat(on(2))] },   // touched pattern 1 too: ignored
      newS.tracks[1],
      newS.tracks[2],
      { name: "riser", engineKey: "dm:contagion", patterns: [pat(on(1)), pat(on(4))] },
    ],
  };
  const b = bridgeSession(newS, result, 1);
  assert.equal(b.bpm, 126, "only the slot comes back, not the tempo");
  assert.equal(b.tracks[0].patterns[0], newS.tracks[0].patterns[0]);
  assert.deepEqual(b.tracks[0].patterns[1].steps, on(2));
  const riser = b.tracks.find(t => t.name === "riser");
  assert.ok(riser && !riser.patterns[0].steps.some(Boolean), "an added track plays only the bridge");
  assert.ok(bridgeHasNotes(b, 1));
  assert.ok(!bridgeHasNotes(newS, 1));
});

test("the quick bridge: the new song's start, kick out and a roll in the last bar, bass and lead out", () => {
  const roll = { name: "snare", engineKey: "dm:lancet", isDrumKit: true, patterns: [{ ...pat([false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], Array(16).fill(38)), velocities: Array(16).fill(0.8) }] };
  const song = { ...newS, patternMeters: [{ num: 4, den: 4 }], tracks: [T.kick, roll, T.bass, T.pad, T.lead] };
  const b = codeBridge(song, 3, 2, 0);
  const steps = (name) => b.tracks.find(t => t.name === name).patterns[3].steps.map(x => (x ? "x" : ".")).join("");
  assert.equal(steps("kick"), "x...x...x...x..." + "................", "the kick sits out the last bar");
  assert.equal(steps("snare"), "....x.......x..." + "x.x.x.x.xxxxxxxx", "the snare rolls up");
  assert.equal(steps("bass"), ".".repeat(32));
  assert.equal(steps("lead"), ".".repeat(32));
  assert.equal(steps("pad"), "x.......x.......x.......x.......", "the chords carry");
  const sn = b.tracks.find(t => t.name === "snare").patterns[3];
  assert.ok(sn.velocities[31] > sn.velocities[16], "the roll gets louder");
  assert.equal(b.tracks[0].patterns[0], song.tracks[0].patterns[0], "only the bridge slot is written");
  assert.ok(bridgeHasNotes(b, 3));
  const quiet = codeBridge({ ...newS, tracks: [T.lead] }, 2, 1, 0);
  assert.ok(bridgeHasNotes(quiet, 2), "nothing left to thin: the start pattern as it is");
});
