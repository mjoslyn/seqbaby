// Tests for the Strudel bridge: the mini-notation's timing
// (miniNotation.js), code read into tracks and written back out (strudel.js).
// Run with `npm test`.
//
// What is pinned is what a person typing into the code drawer relies on: that
// the notation means what it means in Strudel (where an onset lands,
// which cycle `<a b>` is on), that each sound becomes its own track on the
// engine it names, that a pattern takes as many bars as it needs to repeat and a
// grid fine enough that nothing collides, and that a song survives the round trip.

import test from "node:test";
import assert from "node:assert/strict";
import { mini, bjorklund } from "../public/js/miniNotation.js";
import { euclidRing, validate } from "../public/js/songBuilder.js";
import * as S from "../public/js/strudel.js";
import { CHORD_TYPES } from "../public/js/theoryData.js";
import { defaultTrackParams } from "../public/js/soundDefaults.js";
import { guitarTone as sbGuitarTone } from "../public/js/engineData.js";

const onsets = (src, c = 0) => mini(src).cycle(c).map(h => [h.value, +(h.begin - c).toFixed(4)]);

test("mini-notation: sequences, subdivision, rests", () => {
  assert.deepEqual(onsets("bd sd"), [["bd", 0], ["sd", 0.5]]);
  assert.deepEqual(onsets("bd*2 [~ sd]"), [["bd", 0], ["bd", 0.25], ["sd", 0.75]]);
  assert.deepEqual(onsets("bd - ~ sd"), [["bd", 0], ["sd", 0.75]]);
  assert.deepEqual(onsets("a . b c"), [["a", 0], ["b", 0.5], ["c", 0.75]]);
});

test("mini-notation: alternation advances each child only when it plays", () => {
  assert.deepEqual([0, 1, 2].map(c => onsets("<a b> c", c).map(x => x[0]).join("")), ["ac", "bc", "ac"]);
  assert.deepEqual([0, 1, 2, 3].map(c => onsets("<a <b c>>", c)[0][0]), ["a", "b", "a", "c"]);
  assert.deepEqual([0, 1, 2].map(c => onsets("a/2", c).length), [1, 0, 1]);
  assert.deepEqual([0, 1].map(c => onsets("hh*<2 4>", c).length), [2, 4]);
});

test("mini-notation: weights, replicate, ranges, stacks, polymeter", () => {
  assert.deepEqual(onsets("a@3 b"), [["a", 0], ["b", 0.75]]);
  assert.deepEqual(onsets("a _ _ b"), [["a", 0], ["b", 0.75]]);
  assert.deepEqual(onsets("a!3 b").map(x => x[1]), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(onsets("0 .. 3").map(x => x[0]), ["0", "1", "2", "3"]);
  assert.deepEqual(onsets("[a,b] c"), [["a", 0], ["b", 0], ["c", 0.5]]);
  assert.deepEqual([0, 1].map(c => onsets("{a b c}%4", c).map(x => x[0]).join("")), ["abca", "bcab"]);
});

test("mini-notation: euclid is Bjorklund proper, the same ring as the engine's", () => {
  assert.deepEqual(onsets("bd(3,8)").map(x => x[1]), [0, 0.375, 0.75]);
  for (const [k, n] of [[3, 8], [5, 8], [7, 16], [4, 12]]) assert.equal(bjorklund(k, n).map(x => x ? "x" : ".").join(""), euclidRing(k, n));
});

test("mini-notation: randomness is deterministic, and errors say where", () => {
  assert.deepEqual(onsets("bd? sd? hh? oh?", 3), onsets("bd? sd? hh? oh?", 3));
  assert.throws(() => mini("bd [sd"), (e) => e.pos === 6);
  assert.throws(() => mini("bd @ sd"), /@/);
});

test("notes: Strudel spells middle C c4, a bare letter sits in octave 3", () => {
  assert.equal(S.noteNumber("c4"), 60);
  assert.equal(S.noteNumber("c"), 48);
  assert.equal(S.noteNumber("eb2"), 39);
  assert.equal(S.noteNumber(48), 48);
  assert.equal(S.midiName(63), "eb4");
});

test("chord symbols fold to the chords a step can hold", () => {
  assert.deepEqual(S.parseChord("Cm7"), { root: 48, type: "min7", exact: true });
  assert.equal(S.parseChord("Ab^7").type, "maj7");
  assert.equal(S.parseChord("G7").type, "dom7");
  assert.equal(S.parseChord("F#o").type, "dim");
  assert.equal(S.parseChord("Dm9").type, "min7");
});

test("sounds pick engines: kits by bank, synths by name", () => {
  assert.equal(S.voiceFor("bd").engine, "dm:808-kick");
  assert.equal(S.voiceFor("sd", { bank: "RolandTR909" }).engine, "dm:909-snare");
  assert.equal(S.voiceFor("909hh").engine, "dm:909-chat");
  assert.deepEqual(S.voiceFor("hh", { bank: "RolandCompurhythm78" }), { engine: "sampler", sample: "CR78/hihat", drum: true, exact: true });
  assert.equal(S.voiceFor("sawtooth").engine, "dm:poly-saw");
  assert.equal(S.voiceFor("supersaw").engine, "dm:contagion");
  assert.equal(S.voiceFor("tb303").engine, "dm:silverbox");
  assert.equal(S.voiceFor("gm_acoustic_bass").engine, "dm:bass");
  assert.equal(S.voiceFor("superpiano").engine, "dm:tines");
  assert.equal(S.voiceFor("sine", { notes: [36, 38] }).engine, "dm:sub");
  assert.equal(S.voiceFor("sine", { notes: [72] }).engine, "plaits:0");
  assert.equal(S.voiceFor("sine", { fm: true }).engine, "dm:hexop");
  assert.equal(S.voiceFor("mystery").exact, false);
});

const track = (song, name) => song.tracks.find(t => t.name === name);
const steps = (t, p = 0) => t.patterns[p].steps.join("");

test("Strudel: one track per sound, named for its label", () => {
  const { song, names, warnings } = S.codeToSong(`setcpm(124/4)
$: s("bd*4, ~ cp, hh*8").bank("RolandTR909")
bass: note("c2 eb2 g2 c3").s("sawtooth")`);
  assert.equal(song.bpm, 124);
  assert.deepEqual(names, ["bd", "cp", "hh", "bass"]);
  assert.deepEqual(warnings, []);
  assert.equal(track(song, "bd").engineKey, "dm:909-kick");
  assert.equal(steps(track(song, "bd")), "1000100010001000");
  assert.equal(steps(track(song, "cp")), "0000000010000000");
  assert.equal(steps(track(song, "hh")), "1010101010101010");
  const bass = track(song, "bass");
  assert.equal(bass.engineKey, "dm:poly-saw");
  assert.deepEqual(bass.patterns[0].notes.filter(n => n != null), [36, 39, 43, 48]);
  assert.equal(bass.patterns[0].lengths[0], 4);
  assert.equal(validate(song).ok, true);
});

test("a pattern takes as many bars as it needs to repeat", () => {
  const { song } = S.codeToSong(`$: note("<c3 e3 g3>").s("piano")`);
  const t = song.tracks[0];
  assert.equal(t.length, 48);
  assert.deepEqual(t.patterns[0].notes.filter(n => n != null), [48, 52, 55]);
});

test("a dense pattern gets a finer grid; an off-grid onset is a nudge", () => {
  const fastHat = S.codeToSong(`$: s("hh*32")`).song.tracks[0];
  assert.equal(fastHat.speed, 2);
  assert.equal(fastHat.length, 32);
  assert.equal(steps(fastHat), "1".repeat(32));
  const trip = S.codeToSong(`$: s("bd bd bd")`).song.tracks[0];
  assert.equal(trip.speed, 1);
  const p = trip.patterns[0];
  assert.deepEqual(p.steps.map((s, i) => s ? i : -1).filter(i => i >= 0), [0, 5, 11]);
  assert.deepEqual([p.offsets[0], p.offsets[5], p.offsets[11]], [0, 0.333, -0.333]);
});

test("a long pattern trades grid for length rather than being cut", () => {
  const t = S.codeToSong(`$: note("<c3 e3 g3 b3 d4 f4 a4 c5>").s("piano")`).song.tracks[0];
  assert.equal(t.length, 64);
  assert.equal(t.speed, 0.5);
  assert.deepEqual(t.patterns[0].notes.filter(n => n != null), [48, 52, 55, 59, 62, 65, 69, 72]);
});

test("scales, chords, arithmetic", () => {
  const { song } = S.codeToSong(`
lead: n("0 2 4 7").scale("C4:minor").s("supersaw")
up: note("c3 e3").add(12).s("piano")
keys: chord("<Cm7 G7>").voicing().s("gm_epiano1")`);
  assert.deepEqual(track(song, "lead").patterns[0].notes.filter(n => n != null), [60, 63, 67, 72]);
  assert.deepEqual(track(song, "up").patterns[0].notes.filter(n => n != null), [60, 64]);
  const keys = track(song, "keys");
  assert.deepEqual(keys.patterns[0].chords.filter(Boolean), ["min7", "dom7"]);
  assert.equal(keys.engineKey, "dm:tines");
});

test("constants set knobs, per-note values become lanes, signals LFOs", () => {
  const { song } = S.codeToSong(`
a: s("sawtooth*4").note("c2").lpf(800).lpq(10).room(0.4).delay(0.3).delaytime(0.25).gain(0.5)
b: note("c3*4").s("sawtooth").lpf("200 400 800 1600")
c: note("c3*4").s("sawtooth").lpf(sine.range(200, 2000).slow(4))`);
  const a = track(song, "a");
  assert.equal(a.filter.cutoff, 0.446);
  assert.equal(a.filter.reson, 0.5);
  assert.equal(a.fxConfig.reverb.wet, 0.4);
  assert.deepEqual([a.fxConfig.delay.wet, a.fxConfig.delay.time], [0.3, 0.25]);
  assert.equal(a.params.vol, 0.4);
  const lane = track(song, "b").patterns[0].automation.cutoff;
  assert.equal(lane.enabled, true);
  assert.ok(lane.values[0] < lane.values[4] && lane.values[4] < lane.values[8] && lane.values[8] < lane.values[12]);
  const lfo = track(song, "c").lfoConfig.cutoff;
  assert.equal(lfo.type, "sine");
  assert.equal(lfo.div, 16);
  assert.equal(lfo.sync, true);
});

test("varying gain is step velocity", () => {
  const t = S.codeToSong(`$: s("hh*4").gain("1 0.5")`).song.tracks[0];
  assert.deepEqual(t.patterns[0].velocities.filter((_, i) => t.patterns[0].steps[i]), [0.8, 0.8, 0.4, 0.4]);
});

test("muted labels, and what is not supported is said", () => {
  const { song, warnings } = S.codeToSong(`_drums: s("bd*4")
lead: note("c4 e4").s("sawtooth").jux(rev).vowel("a").every(4, x => x.fast(2))`);
  assert.equal(track(song, "drums").muted, true);
  assert.ok(warnings.some(w => /jux/.test(w)));
  assert.ok(warnings.some(w => /vowel/.test(w)));
  assert.ok(warnings.some(w => /every/.test(w)));
});

test("a syntax error carries where it is", () => {
  const code = `$: s("bd sd")\nbass: note("c2 [eb2").s("saw")`;
  assert.throws(() => S.readCode(code), (e) => e instanceof S.CodeError && code.slice(0, e.pos).split("\n").length === 2);
});

test("writeTracks upserts by name and removes what the code stopped naming", () => {
  const first = S.codeToSong(`a: s("bd*4")\nb: s("hh*8")`);
  const song = first.song;
  song.tracks.push({ ...JSON.parse(JSON.stringify(song.tracks[0])), name: "by hand" });
  const res = S.writeTracks(song, S.realize(S.readCode(`a: s("bd*2")`)), { previous: first.names });
  assert.deepEqual(res.changed, ["a"]);
  assert.deepEqual(res.removed, ["b"]);
  assert.deepEqual(song.tracks.map(t => t.name), ["a", "by hand"]);
  assert.equal(steps(song.tracks[0]), "1000000010000000");
  // another instrument under the same name replaces the track in place
  S.writeTracks(song, S.realize(S.readCode(`a: note("c3").s("piano")`)), { previous: ["a"] });
  assert.equal(song.tracks[0].engineKey, "dm:tines");
  assert.equal(song.tracks[0].name, "a");
});

test("a song round-trips through Strudel code", () => {
  const src = `setcpm(120/4)
bd: s("bd*4").bank("RolandTR909")
bass: note("<c2 eb2>*8").s("sawtooth").lpf(sine.range(300,2000).slow(4)).lpq(8)
keys: chord("<Cm7 G7>").voicing().s("gm_epiano1").room(0.4)`;
  const a = S.codeToSong(src).song;
  { const dialect = "strudel";
    const { code } = S.sessionToCode(a);
    const b = S.codeToSong(code).song;
    assert.equal(b.bpm, a.bpm, dialect);
    assert.deepEqual(b.tracks.map(t => t.engineKey), a.tracks.map(t => t.engineKey), dialect);
    for (let i = 0; i < a.tracks.length; i++) {
      const pa = a.tracks[i].patterns[0], pb = b.tracks[i].patterns[0];
      assert.equal(pb.steps.join(""), pa.steps.join(""), `${dialect} ${a.tracks[i].name}`);
      // a chord symbol comes back as its notes: the pitches agree, the spelling need not
      const pitches = (p) => p.steps.flatMap((on, j) => {
        if (!on || p.notes[j] == null) return [];
        const chord = (CHORD_TYPES[p.chords[j]] || [0]).map(x => p.notes[j] + x);
        return [[...new Set([...chord, ...(p.extraNotes[j] || [])])].sort((x, y) => x - y).join(",")];
      });
      assert.deepEqual(pitches(pb), pitches(pa), `${dialect} ${a.tracks[i].name}`);
    }
    assert.equal(b.tracks[1].lfoConfig.cutoff?.type, "sine", dialect);
  }
});

test("strudelUrl puts the code in the hash, base64", () => {
  const url = S.strudelUrl(`s("bd sd")`);
  assert.ok(url.startsWith("https://strudel.cc/#"));
  const b64 = decodeURIComponent(url.split("#")[1]);
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), `s("bd sd")`);
});

// ---- seqbaby's own names and controls ---------------------------------------------

test("seqbaby's engines by name, key, old key and menu name", () => {
  assert.equal(S.nativeEngine("silverbox"), "dm:silverbox");
  assert.equal(S.nativeEngine("dm:contagion"), "dm:contagion");
  assert.equal(S.nativeEngine("dm:303"), "dm:silverbox");
  assert.equal(S.nativeEngine("subby"), "dm:sub");
  assert.equal(S.nativeEngine("electric_guitar"), "dm:guitar");
  assert.equal(S.nativeEngine("plaits:3"), "plaits:3");
  assert.equal(S.nativeEngine("plaits:virtual_analog"), "plaits:0");
  // a sampler, a granular track, midi and a bus need the studio
  for (const n of ["sampler", "granular", "midi", "bus", "fx_bus"]) assert.equal(S.nativeEngine(n), null, n);
  assert.equal(S.voiceFor("hexop").engine, "dm:hexop");
  assert.equal(S.voiceFor("bd").engine, "dm:808-kick");
  for (const key of ["dm:silverbox", "dm:contagion", "dm:guitar", "dm:sub", "plaits:5", "wt:akwf"]) assert.equal(S.nativeEngine(S.nativeName(key)), key, key);
});

test("knob, preset, fx, filter, eq, comp, lfo and aut land on the track", () => {
  const { song, warnings } = S.codeToSong(`kick: s("bd*4")
acid: note("c2 eb2").s("silverbox").knob("sbaccent", 0.9).knob("sbwave", "square")
  .filter("type", "squelch").filter("env", 0.6).fx("chorus.wet", 0.3).fx("delay.sync", true)
  .eq("low", -3).comp("threshold", -30).comp("source", "kick")
  .lfo("reson", "euclid(3,8,1,0.2)", 0.4, 0.5).lfo("chorus", "tri", 0.2, "2hz")
  .aut("cutoff", "0 0.25 0.5 1")
gtr: note("e3").s("electric_guitar").preset("surf twang")`);
  assert.deepEqual(warnings, []);
  const t = track(song, "acid");
  assert.equal(t.engineKey, "dm:silverbox");
  assert.deepEqual([t.params.sbaccent, t.params.sbwave], [0.9, "square"]);
  assert.deepEqual([t.filter.type, t.filter.env], ["squelch", 0.6]);
  assert.deepEqual([t.fxConfig.chorus.wet, t.fxConfig.delay.sync], [0.3, true]);
  assert.equal(t.eq.low, -3);
  assert.deepEqual([t.comp.enabled, t.comp.threshold, t.compSourceIndex], [true, -30, 0]);
  assert.deepEqual([t.lfoConfig.reson.type, t.lfoConfig.reson.epulses, t.lfoConfig.reson.erotate, t.lfoConfig.reson.div], ["euclid", 3, 1, 0.5]);
  assert.deepEqual([t.lfoConfig.chorus.type, t.lfoConfig.chorus.sync, t.lfoConfig.chorus.rate], ["triangle", false, 2]);
  assert.deepEqual(t.patterns[0].automation.cutoff.values, [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1]);
  assert.equal(track(song, "gtr").params.gtamp, sbGuitarTone("surf twang").gtamp);
});

test("bad seqbaby controls are warnings, not failures", () => {
  const { song, warnings } = S.codeToSong(`a: note("c3").s("silverbox").knob("nope", 1).fx("chorus.nope", 1).preset("x").knob("sbaccent", 0.7)`);
  assert.equal(track(song, "a").params.sbaccent, 0.7);
  assert.ok(warnings.some(w => /nope/.test(w)));
  assert.ok(warnings.some(w => /preset/.test(w)));
});

test("a setting the last run set and this one does not goes back to its default", () => {
  const first = S.codeToSong(`a: note("c3").s("silverbox").knob("sbaccent", 0.9).fx("chorus.wet", 0.3).lpf(500)`);
  const song = first.song;
  // a knob turned by hand, which no run ever mentioned
  song.tracks[0].params.sbtune = 12;
  S.writeTracks(song, S.realize(S.readCode(`a: note("c3").s("silverbox").fx("chorus.wet", 0.3)`)), { previous: first.names, touched: first.touched });
  const t = song.tracks[0];
  assert.equal(t.params.sbaccent, 0.6);
  assert.equal(t.filter.cutoff, 1);
  assert.equal(t.fxConfig.chorus.wet, 0.3);
  assert.equal(t.params.sbtune, 12);
});

test(".p names a track, and a label wins over it", () => {
  const { names } = S.codeToSong(`$: s("hh*8").p('hats two')\nkick: s("bd*4").p('ignored')`);
  assert.deepEqual(names, ["hats two", "kick"]);
});

test("native export rebuilds the song: instruments, knobs, fx, eq, comp, LFOs, lanes", () => {
  const src = `setcpm(126/4)
kick: s("bd*4")
acid: note("c2 [c2 c3] eb2 g1").s("silverbox").knob("sbaccent", 0.9).knob("sbwave", "square")
  .filter("type", "squelch").lpq(10).fx("chorus.wet", 0.3).fx("reverb.decay", 5).room(0.2).eq("low", -3)
  .comp("threshold", -30).comp("source", "kick")
  .lfo("chorus", "sine", 0.3, 8).lfo("reson", "euclid(3,8,1,0.2)", 0.4, 0.5).aut("fx.delay", "0 0.5")
$: note("<[e3,b3] [d3,a3]>").s("electric_guitar").preset("surf twang").p('the gtr')
sub: note("c1").s("subby").gain(0.5)`;
  const a = S.codeToSong(src).song;
  const norm = (x) => x && typeof x === "object" ? (Array.isArray(x) ? x.map(norm) : Object.fromEntries(Object.keys(x).filter(k => k !== "fromCode").sort().map(k => [k, norm(x[k])]))) : x;
  { const dialect = "strudel";
    const out = S.sessionToCode(a, { native: true });
    assert.deepEqual(out.warnings, [], dialect);
    const b = S.codeToSong(out.code).song;
    assert.equal(b.bpm, a.bpm);
    for (const ta of a.tracks) {
      const tb = track(b, ta.name);
      assert.ok(tb, `${dialect}: ${ta.name}`);
      for (const k of ["engineKey", "filter", "fxConfig", "eq", "comp", "compSourceIndex", "length", "speed", "lfoConfig"]) assert.deepEqual(norm(tb[k]), norm(ta[k]), `${dialect} ${ta.name} ${k}`);
      const DP = defaultTrackParams();
      for (const [k, v] of Object.entries(ta.params)) assert.deepEqual(tb.params[k] ?? DP[k], v, `${dialect} ${ta.name} params.${k}`);
      assert.deepEqual(norm(tb.patterns[0].automation), norm(ta.patterns[0].automation), `${dialect} ${ta.name} lanes`);
      assert.equal(tb.patterns[0].steps.join(""), ta.patterns[0].steps.join(""));
    }
  }
});

test("portable export says what it leaves out, and plays stock sounds", () => {
  const a = S.codeToSong(`acid: note("c2").s("silverbox").knob("sbaccent", 0.9).fx("chorus.wet", 0.3).aut("cutoff", "0 1")`).song;
  const { code, warnings } = S.sessionToCode(a);
  assert.match(code, /s\("gm_synth_bass_1"\)/);
  assert.match(code, /\.lpf\("60!8 20000!8"\)/);
  assert.doesNotMatch(code, /knob|\.fx\(/);
  assert.ok(warnings.some(w => /chorus/.test(w) && /silverbox settings/.test(w)));
});

test("native export leaves what code can't hold as a comment, and running it leaves the track alone", () => {
  const a = S.codeToSong(`arp: note("c3 e3").s("piano")`).song;
  a.tracks[0].patterns[0].arps[0] = true;
  const out = S.sessionToCode(a, { native: true });
  assert.deepEqual(out.skipped, ["arp"]);
  assert.deepEqual(out.names, []);
  assert.match(out.code, /\/\/ arp: uses arps/);
});
