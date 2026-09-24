import test from "node:test";
import assert from "node:assert/strict";
import {
  PHRASE_STEPS,
  canPreview,
  engineLabel,
  isDrumPatch,
  patchEngineKey,
  patchSession,
  phraseFor,
} from "../app/home/patchPreview.js";
import { validateSet } from "../public/js/sessionFormat.js";
import { emptyPatternBlob } from "../public/js/songBuilder.js";

const trackPatch = (over = {}) => ({
  _kind: "track-patch",
  engineKey: "dm:silverbox",
  params: { harm: 0.4 },
  filter: { cutoff: 0.6 },
  fxConfig: {},
  lfoConfig: {},
  isDrumKit: false,
  speed: 2,
  ...over,
});

test("a track patch plays on its own engine; a legacy config on custom", () => {
  assert.equal(patchEngineKey(trackPatch()), "dm:silverbox");
  assert.equal(patchEngineKey({ synth: { type: "Synth" } }), "custom");
  assert.equal(patchEngineKey(null), "custom");
});

test("the session is one valid track carrying the patch's sound", () => {
  const s = patchSession(trackPatch(), "acid");
  const v = validateSet(s);
  assert.ok(v.ok, v.errors.join("; "));
  assert.equal(s.tracks.length, 1);
  const t = s.tracks[0];
  assert.equal(t.engineKey, "dm:silverbox");
  assert.equal(t.name, "acid");
  assert.deepEqual(t.params, { harm: 0.4 });
  assert.equal(t._kind, undefined);
  assert.equal(t.speed, 1, "the phrase plays at the speed the card draws it");
  assert.equal(s.scale.active, false);
});

test("a legacy custom-Tone patch rides as the track's customConfig", () => {
  const cfg = { synth: { type: "FMSynth" } };
  const t = patchSession(cfg, "bell").tracks[0];
  assert.equal(t.engineKey, "custom");
  assert.deepEqual(t.customConfig, cfg);
});

test("the pattern has every per-step array the format writes, at the phrase's length", () => {
  const p = patchSession(trackPatch()).tracks[0].patterns[0];
  for (const [k, v] of Object.entries(emptyPatternBlob(PHRASE_STEPS))) {
    if (Array.isArray(v)) assert.equal(p[k].length, PHRASE_STEPS, k);
    else assert.ok(k in p, k);
  }
});

test("the pattern writes exactly the phrase the card draws", () => {
  const cfg = trackPatch({ engineKey: "dm:hexop" });
  const phrase = phraseFor("dm:hexop", false);
  const p = patchSession(cfg).tracks[0].patterns[0];
  const on = p.steps.flatMap((s, i) => (s ? [i] : []));
  assert.deepEqual(on, phrase.steps.map((s) => s.i));
  for (const s of phrase.steps) {
    assert.equal(p.notes[s.i], s.note);
    assert.equal(p.lengths[s.i], s.len);
  }
});

test("every step fits the phrase and no note runs past the loop", () => {
  for (const [key, drum, hint] of [
    ["dm:silverbox"], ["dm:sub"], ["dm:pad"], ["dm:hexop"], ["custom"],
    ["dm:808-kick"], ["dm:909-chat"], ["sampler", true, "Techno/snare"], ["sampler", true, ""],
  ]) {
    const ph = phraseFor(key, drum, hint);
    assert.ok(ph.steps.length > 0, key);
    for (const s of ph.steps) {
      assert.ok(s.i >= 0 && s.i + s.len <= PHRASE_STEPS, `${key} step ${s.i}+${s.len}`);
      assert.ok(s.vel > 0 && s.vel <= 1, `${key} vel`);
    }
  }
});

test("drums get a rhythm and no pitch; the rest get notes", () => {
  const kick = phraseFor("dm:808-kick");
  assert.equal(kick.kind, "drum");
  assert.ok(kick.steps.every((s) => s.note === null));
  assert.ok([0, 4, 8, 12].every((i) => kick.steps.some((s) => s.i === i)), "four on the floor");
  const snare = phraseFor("sampler", true, "Techno/snare");
  assert.ok(snare.steps.some((s) => s.i === 4) && snare.steps.some((s) => s.i === 12), "backbeat");
  assert.ok(phraseFor("dm:silverbox").steps.every((s) => Number.isInteger(s.note)));
});

test("a silverbox line has accents and a slide", () => {
  const ph = phraseFor("dm:silverbox");
  assert.equal(ph.kind, "bass");
  assert.ok(ph.steps.some((s) => s.vel > 0.6), "accent");
  assert.ok(ph.steps.some((s) => s.len > 1 && ph.steps.some((t) => t.i === s.i + s.len)), "slide");
});

test("the patch's own drum flag beats the name", () => {
  assert.equal(isDrumPatch("sampler", true), true);
  assert.equal(isDrumPatch("dm:808-kick", false), false);
  assert.equal(isDrumPatch("dm:808-kick"), true);
  assert.equal(isDrumPatch("sampler", undefined, "big kick"), true);
});

test("engine labels", () => {
  assert.equal(engineLabel("dm:silverbox"), "silverbox");
  assert.equal(engineLabel("dm:808-kick"), "808 kick");
  assert.equal(engineLabel("plaits:3"), "plaits");
  assert.equal(engineLabel("wt:akwf"), "wavetable");
  assert.equal(engineLabel("custom"), "tone synth");
  assert.equal(engineLabel(""), "synth");
  assert.equal(engineLabel(null), "synth");
});

test("a legacy custom-Tone patch is drawn but not offered to the engine", () => {
  assert.equal(canPreview(patchEngineKey({ synth: "PolySynth" })), false);
  assert.equal(canPreview("saved:thing"), false);
  assert.equal(canPreview("dm:silverbox"), true);
});
