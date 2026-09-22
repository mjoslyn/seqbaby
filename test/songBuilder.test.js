// Tests for the song builder: the module that writes a session without a
// browser (mcp/server.mjs runs on it). Run with `npm test`.
//
// Two kinds of claim are pinned here. The first is that the builder speaks the
// serialized format applySet reads: every pattern field, the cross-track
// indices, the fx stage shapes. The second is that it refuses what the studio
// would refuse -- an engine that does not exist, an LFO on a parameter the
// engine has no AudioParam for, a lane on a generator that is off -- using the
// engine's own tables rather than a copy of them.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as sb from "../public/js/songBuilder.js";
import { STATIC_ENGINES } from "../public/js/engineData.js";
import { LFO_KEYS, AUTOMATION_TARGETS } from "../public/js/constants.js";

const song = () => sb.newSong({ bpm: 120 });

test("a blank song validates and loads as a session", () => {
  const s = song();
  assert.equal(s._version, 3);
  assert.equal(sb.validate(s).ok, true);
  assert.deepEqual(sb.validate(s).warnings, ["the song has no tracks"]);
  assert.equal(JSON.parse(sb.toJSON(s)).bpm, 120);
});

test("emptyPatternBlob carries every per-step field emptyPattern does", () => {
  // emptyPattern (state.js) reads the live meter, so it cannot be imported
  // here; its field list is read out of the source instead.
  const src = fs.readFileSync(new URL("../public/js/state.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function emptyPattern"), src.indexOf("export function clonePattern"));
  const fields = [...body.matchAll(/^\s+(\w+):\s+new Array\(len\)/gm)].map(m => m[1]);
  assert.ok(fields.length >= 19, "found the field list");
  const mine = Object.keys(sb.emptyPatternBlob(4)).filter(k => Array.isArray(sb.emptyPatternBlob(4)[k]));
  assert.deepEqual(mine.sort(), fields.sort());
  assert.ok("automation" in sb.emptyPatternBlob(4));
});

test("engines resolve by key, by label and by plaits model name", () => {
  assert.equal(sb.resolveEngine("dm:808-kick").key, "dm:808-kick");
  assert.equal(sb.resolveEngine("808 Kick").key, "dm:808-kick");
  assert.equal(sb.resolveEngine("silverbox").key, "dm:silverbox");
  assert.equal(sb.resolveEngine("plaits:fm").key, "plaits:2");
  assert.equal(sb.resolveEngine("fm").key, "plaits:2");
  assert.equal(sb.resolveEngine("fx bus").key, "bus");
  assert.throws(() => sb.resolveEngine("dm:tb303"), /unknown engine/);
  assert.throws(() => sb.resolveEngine("silver"), /did you mean dm:silverbox/);
});

test("every static engine can be described, with the slider labels the panel shows", () => {
  for (const e of STATIC_ENGINES) {
    const d = sb.describeEngine(e.key);
    assert.equal(d.key, e.key);
    assert.ok(Array.isArray(d.lfoTargets) && Array.isArray(d.automationTargets));
  }
  assert.equal(sb.describeEngine("dm:silverbox").sliders.harm.label, "cutoff");
  assert.equal(sb.describeEngine("dm:snarl").sliders.morph, undefined, "hidden slider is left out");
  assert.equal(sb.describeEngine("dm:sub").presets.length, 11);
  assert.ok(sb.describeEngine("dm:guitar").panel.numeric.some(c => c.key === "gtpick" && c.min === 0.02));
});

test("step strings: hits, accents, soft hits, digits, ties, tiling", () => {
  const p = sb.parseSteps("x X o 5 . - _");
  assert.deepEqual(p.steps, [1, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(p.velocities, [0.8, 1, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(p.lengths, [1, 1, 1, 2, 0, 0, 0], "the trailing tie extends the digit hit");
  const t = sb.parseSteps("x_..");
  assert.deepEqual(t.lengths, [2, 0, 0, 0]);
  assert.throws(() => sb.parseSteps("_x"), /tie needs a hit/);
  assert.throws(() => sb.parseSteps("xq"), /unknown step character/);

  const s = song();
  const { index } = sb.addTrack(s, { engine: "808 kick" });
  const d = sb.setSteps(s, index, { steps: "x..." });
  assert.equal(d.steps, "x...x...x...x...", "a four-step string tiles a 16-step pattern");
  assert.equal(s.tracks[0].patterns[0].steps.filter(Boolean).length, 4);
  assert.throws(() => sb.setSteps(s, index, { steps: "x...." }), /does not divide/);
  assert.throws(() => sb.setSteps(s, index, { steps: "x".repeat(17) }), /set the track length first/);
});

test("notes go to the hits in order, or per step when one per step is given", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "silverbox" });
  sb.setSteps(s, index, { steps: "x.x.x.x.x.x.x.x.", notes: ["C2", "Eb2", "G2"] });
  const pat = s.tracks[0].patterns[0];
  assert.deepEqual(pat.notes.filter(n => n != null), [36, 39, 43, 36, 39, 43, 36, 39]);
  sb.setNotes(s, index, { notes: 48 });
  assert.ok(pat.notes.filter(n => n != null).every(n => n === 48));
  const perStep = Array(16).fill(null); perStep[0] = "A1";
  sb.setNotes(s, index, { notes: perStep });
  assert.equal(pat.notes[0], 33);
  assert.equal(pat.notes[2], null);
  assert.throws(() => sb.setNotes(s, index, { notes: ["H2"] }), /MIDI number or a note name/);
  const d = sb.describePattern(s.tracks[0], 0);
  assert.equal(d.steps, "x.x.x.x.x.x.x.x.");
  assert.equal(d.notes[0], "A1");
});

test("ties read back as they were written", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "subby" });
  sb.setSteps(s, index, { steps: "x_..X___o.5.x.x_" });
  assert.equal(sb.describePattern(s.tracks[0], 0).steps, "x_..X___o.o.x.x_");
});

test("a step in full", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "poly saw" });
  sb.setStep(s, index, { step: 0, on: true, note: "C3", chord: "min7", complexity: 1, ratchet: 2, arp: true, arpDir: "updown", extraNotes: ["G4"] });
  const pat = s.tracks[0].patterns[0];
  assert.equal(pat.steps[0], 1); assert.equal(pat.notes[0], 48); assert.equal(pat.chords[0], "min7");
  assert.equal(pat.lengths[0], 1, "switching a step on gives it a length");
  assert.deepEqual(pat.extraNotes[0], [67]);
  sb.setStep(s, index, { step: 1, on: true, chord: "7" });
  assert.equal(pat.chords[1], "dom7", "the legacy 7 spelling is canonicalised");
  assert.throws(() => sb.setStep(s, index, { step: 0, chord: "maj13" }), /unknown chord/);
  assert.throws(() => sb.setStep(s, index, { step: 16, on: true }), /step must be between 0 and 15/);
});

test("params are checked against the engine's own ranges, and another engine's keys are warned about", () => {
  const s = song();
  const g = sb.addTrack(s, { engine: "electric guitar" });
  const r = sb.setParams(s, g.index, { harm: 0.7, gtpick: 0.3, gtamp: "tweed" });
  assert.deepEqual(r.warnings, []);
  assert.equal(s.tracks[0].params.gtamp, "tweed");
  assert.throws(() => sb.setParams(s, g.index, { gtpick: 0.9 }), /gtpick must be between 0.02 and 0.5/);
  assert.throws(() => sb.setParams(s, g.index, { gtamp: "marshall" }), /gtamp must be one of/);
  assert.throws(() => sb.setParams(s, g.index, { nope: 1 }), /unknown param/);
  const w = sb.setParams(s, g.index, { bsgrind: 0.5 });
  assert.match(w.warnings[0], /belongs to dm:bass/);
  const k = sb.addTrack(s, { engine: "808 kick" });
  const w2 = sb.setParams(s, k.index, { osc1: 0.5 });
  assert.match(w2.warnings[0], /not a control on dm:808-kick/);
  const h = sb.addTrack(s, { engine: "hexop" });
  sb.setParams(s, h.index, { d3rat: 14, dalg: "5", d1fix: "fixed" });
  assert.throws(() => sb.setParams(s, h.index, { d3rat: 40 }), /d3rat must be between 0 and 31/);
});

test("presets are complete and only offered where they exist", () => {
  const s = song();
  const b = sb.addTrack(s, { engine: "electric bass" });
  const r = sb.applyPreset(s, b.index, "Dub");
  assert.equal(r.preset, "dub");
  assert.ok(s.tracks[0].params.bsamp, "the panel came with it");
  assert.ok("harm" in s.tracks[0].params, "and the four sliders");
  assert.throws(() => sb.applyPreset(s, b.index, "shoegaze"), /unknown dm:bass preset/);
  const k = sb.addTrack(s, { engine: "808 kick" });
  assert.throws(() => sb.applyPreset(s, k.index, "dub"), /has no presets/);
});

test("fx stages are written whole, with aliases for wet/amount", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "pad" });
  const d = sb.setFx(s, index, "delay", { wet: 0.4 });
  assert.equal(d.time, 0.375, "the rest of the stage is the default");
  assert.equal(d.fbk, 0.35);
  sb.setFx(s, index, "vinyl", { wet: 0.5 });
  assert.equal(s.tracks[0].fxConfig.vinyl.amount, 0.5, "wet on an amount stage");
  assert.throws(() => sb.setFx(s, index, "crush", { bits: 20 }), /crush.bits must be between 1 and 16/);
  assert.throws(() => sb.setFx(s, index, "echo", {}), /unknown fx stage/);
  sb.setFx(s, index, "shaper", { mode: "fold", wet: 0.2 });
  assert.throws(() => sb.setFx(s, index, "shaper", { mode: "bend" }), /shaper.mode must be one of/);
});

test("filter, eq and comp ranges; sidechain by index", () => {
  const s = song();
  const a = sb.addTrack(s, { engine: "808 kick" });
  const b = sb.addTrack(s, { engine: "pad" });
  sb.setFilter(s, b.index, { cutoff: 0.4, env: 0.5 });
  assert.throws(() => sb.setFilter(s, b.index, { cutoff: 2 }), /between 0 and 1/);
  assert.equal(sb.setFilter(s, b.index, { type: "highpass" }).type, "highpass");
  assert.throws(() => sb.setFilter(s, b.index, { type: "bandstop" }), /filter.type must be one of/);
  sb.setEq(s, b.index, { low: -6 });
  assert.throws(() => sb.setEq(s, b.index, { low: 30 }), /between -18 and 18/);
  const c = sb.setComp(s, b.index, { source: a.index, threshold: -30 });
  assert.equal(c.enabled, true, "setting a threshold switches it on");
  assert.equal(s.tracks[1].compSourceIndex, 0);
  assert.throws(() => sb.setComp(s, b.index, { source: b.index }), /cannot sidechain from itself/);
});

test("LFOs: only the engine's real targets, generator keys only when the generator is on", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "silverbox" });
  const l = sb.addLfo(s, index, { target: "cutoff", length: "1 bar", amount: 0.3 });
  assert.equal(l.div, 4); assert.equal(l.cycle, "16 steps"); assert.equal(l.sync, true);
  const h = sb.addLfo(s, index, { target: "reson", rate: 2.5 });
  assert.equal(h.sync, false);
  assert.throws(() => sb.addLfo(s, index, { target: "gtr_pick" }), /cannot be modulated on dm:silverbox/);
  assert.throws(() => sb.addLfo(s, index, { target: "euclid_rotate" }), /turn the euclid generator on first/);
  sb.setEuclid(s, index, { pulses: 3, steps: 8 });
  const e = sb.addLfo(s, index, { target: "euclid_rotate", shape: "randsq", length: "4 steps" });
  assert.equal(e.type, "randsq");
  const eu = sb.addLfo(s, index, { target: "vol", shape: "euclid", euclid: { pulses: 5, steps: 8 } });
  assert.equal(eu.epulses, 5);
  assert.throws(() => sb.addLfo(s, index, { target: "nothing" }), /unknown LFO target/);
  for (const k of Object.keys(s.tracks[0].lfoConfig)) assert.ok(LFO_KEYS.includes(k));
});

test("automation lanes belong to the pattern and tile", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "808 snare" });
  const a = sb.setAutomation(s, index, { target: "fx.reverb", values: [0, 0.5, 1, 0.5] });
  assert.equal(a.values.length, 16);
  assert.ok("fx.reverb" in AUTOMATION_TARGETS);
  assert.throws(() => sb.setAutomation(s, index, { target: "gtr.pick", values: [0] }), /cannot be automated/);
  assert.throws(() => sb.setAutomation(s, index, { target: "cutoff", values: [2] }), /between 0 and 1/);
  assert.throws(() => sb.setAutomation(s, index, { target: "cutoff", values: Array(5).fill(0) }), /do not tile/);
  sb.setAutomation(s, index, { pattern: 1, target: "cutoff", values: [1] });
  assert.equal(s.tracks[0].patterns[1].automation.cutoff.values.length, 16);
  assert.equal(s.tracks[0].patterns[0].automation.cutoff, undefined);
});

test("euclid is Bjorklund proper, and one generator at a time", () => {
  assert.equal(sb.euclidRing(5, 8), "x.xx.xx.");
  assert.equal(sb.euclidRing(3, 8), "x..x..x.");
  assert.equal(sb.euclidRing(4, 16), "x...x...x...x...");
  assert.equal(sb.euclidRing(0, 4), "....");
  assert.equal(sb.euclidRing(4, 4), "xxxx");
  assert.equal(sb.euclidRing(5, 8, 1), ".x.xx.xx");
  const s = song();
  const { index } = sb.addTrack(s, { engine: "909 closed hat" });
  sb.setChance(s, index, { scale: ["C", "G"] });
  assert.equal(s.tracks[0].chance.on, true);
  sb.setEuclid(s, index, { pulses: 7, steps: 16 });
  assert.equal(s.tracks[0].chance.on, false, "euclid switched chance off");
  assert.equal(s.tracks[0].euclid.on, true);
  sb.setChance(s, index, { note: "1/8", rest: 0.2 });
  assert.equal(s.tracks[0].euclid.on, false, "and chance switched euclid off");
  assert.equal(s.tracks[0].chance.note, 4);
  assert.deepEqual(s.tracks[0].chance.pcs, [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.throws(() => sb.setChance(s, index, { pitches: Array(12).fill(0) }), /every pitch weight is zero/);
  assert.throws(() => sb.setEuclid(s, index, { pulses: 20, steps: 16 }), /pulses must be between 0 and 16/);
});

test("sends go to buses only, never in a loop; removing a track fixes the indices", () => {
  const s = song();
  const a = sb.addTrack(s, { engine: "silverbox" });
  const b = sb.addTrack(s, { engine: "bus", name: "verb" });
  const c = sb.addTrack(s, { engine: "bus", name: "dirt" });
  sb.setTrack(s, a.index, { out: b.index });
  sb.setTrack(s, b.index, { out: c.index });
  assert.throws(() => sb.setTrack(s, c.index, { out: b.index }), /feed back/);
  assert.throws(() => sb.setTrack(s, a.index, { out: a.index }), /cannot send to itself/);
  assert.throws(() => sb.setTrack(s, b.index, { out: a.index }), /is not an fx bus/);
  sb.setComp(s, c.index, { source: a.index });
  sb.removeTrack(s, b.index);
  assert.equal(s.tracks.length, 2);
  assert.equal(s.tracks[0].outIndex, -1, "the send to the removed bus went back to master");
  assert.equal(s.tracks[1].compSourceIndex, 0, "a sidechain past the gap moved down");
  assert.equal(sb.validate(s).ok, true);
});

test("track length resizes every pattern, keeping what fits", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "808 clap" });
  sb.setSteps(s, index, { steps: "....x.......x..." });
  sb.setAutomation(s, index, { target: "vol", values: [1] });
  sb.setTrack(s, index, { length: 8 });
  const p = s.tracks[0].patterns[0];
  assert.equal(p.steps.length, 8); assert.equal(p.steps[4], 1);
  assert.equal(p.automation.vol.values.length, 8);
  sb.setTrack(s, index, { length: 12 });
  assert.equal(p.steps.length, 12); assert.equal(p.ratchets[11], 1);
  assert.equal(p.automation.vol.values[11], 0.5);
});

test("sampler and granular tracks need a source; the drum-kit guess follows the name", () => {
  const s = song();
  assert.throws(() => sb.addTrack(s, { engine: "sampler" }), /needs `sample`/);
  const k = sb.addTrack(s, { engine: "sampler", sample: "techno kick" });
  assert.deepEqual(s.tracks[k.index].sampleSource, { kind: "bundled", id: "Techno/kick", name: "techno kick" });
  assert.equal(s.tracks[k.index].isDrumKit, true);
  assert.throws(() => sb.addTrack(s, { engine: "granular sampler" }), /needs `texture`/);
  const g = sb.addTrack(s, { engine: "granular sampler", texture: "choir" });
  assert.equal(s.tracks[g.index].granularSample.id, "Reface/Reface_Choir");
  assert.throws(() => sb.addTrack(s, { engine: "pad", sample: "techno kick" }), /only applies to the sampler/);
  const p = sb.addTrack(s, { engine: "pad", name: "lead" });
  assert.equal(s.tracks[p.index].isDrumKit, false);
});

test("scale, tempo, arrangement and meters", () => {
  const s = sb.newSong({ bpm: 90, swing: 0.2, scale: { root: "Eb", mode: "dorian" } });
  assert.deepEqual(s.scale, { active: true, root: 3, mode: "dorian" });
  sb.setScale(s, null);
  assert.equal(s.scale.active, false);
  assert.throws(() => sb.setScale(s, { root: "C", mode: "klingon" }), /unknown scale mode/);
  assert.throws(() => sb.setTempo(s, { bpm: 1000 }), /bpm must be between/);
  sb.setArrangement(s, { mode: "chain", repeats: [2, 4] });
  assert.equal(s.patternMode, "chain"); assert.equal(s.patternRepeats[1], 4); assert.equal(s.patternRepeats[2], 1);
  assert.equal(sb.setMeter(s, 1, "7/8").steps, 14);
  assert.match(sb.summarize(s).arrangement.meters[0], /^1: 7\/8$/);
  assert.throws(() => sb.setMeter(s, 0, "4/3"), /denominator/);
});

test("fromBlob adopts a saved song and summarize reads it back", () => {
  const s = song();
  const { index } = sb.addTrack(s, { engine: "tines", name: "keys" });
  sb.setSteps(s, index, { steps: "x...x...", notes: ["C4", "E4"] });
  sb.setFx(s, index, "reverb", { wet: 0.3 });
  const back = sb.fromBlob(JSON.parse(sb.toJSON(s)));
  const sum = sb.summarize(back);
  assert.equal(sum.tracks[0].engine, "dm:tines");
  assert.deepEqual(sum.tracks[0].fx, ["reverb=0.3"]);
  assert.equal(sum.tracks[0].patterns[0].steps, "x...x...x...x...");
  assert.throws(() => sb.fromBlob({ tracks: "no" }), /not a seqbaby session/);
  // A blob with none of the optional fields is still editable.
  const bare = sb.fromBlob({ tracks: [{ engineKey: "plaits:0" }] });
  sb.setSteps(bare, 0, { steps: "x..." });
  assert.equal(sb.validate(bare).ok, true);
});

test("validate names a silent track and a bus with nothing on it", () => {
  const s = song();
  sb.addTrack(s, { engine: "pad" });
  sb.addTrack(s, { engine: "bus" });
  const v = sb.validate(s);
  assert.equal(v.ok, true);
  assert.match(v.warnings[0], /will be silent/);
  assert.match(v.warnings[1], /nothing sent to it/);
});
