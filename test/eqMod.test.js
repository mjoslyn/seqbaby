// The eq as LFO targets and automation lanes: every band's gain, frequency and
// (bells) Q, one key in three spellings (.p-eq-<key> / eq_<key> / eq.<key>).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTOMATION_TARGETS, CURVED_LFO_CURVES, CURVED_LFO_KEYS, EQ_AUTO_KEYS, EQ_LFO_KEYS, LFO_AMP_SCALE, LFO_KEYS,
  autoLabel, canAutomateKey, canModulateKey, eqKeyOfTarget, lfoLabel,
} from "../public/js/constants.js";
import { EQ_BAND_DEFS, EQ_KEYS, eqFromUnit, eqRange, eqToUnit, splitEqKey } from "../public/js/soundDefaults.js";
import * as B from "../public/js/songBuilder.js";
import * as S from "../public/js/strudel.js";

test("eq targets: every eq key is an LFO target and a lane, shelves have no Q", () => {
  assert.equal(EQ_KEYS.length, 13);
  assert.deepEqual(EQ_LFO_KEYS, EQ_KEYS.map(k => `eq_${k}`));
  assert.deepEqual(EQ_AUTO_KEYS, EQ_KEYS.map(k => `eq.${k}`));
  for (const k of EQ_KEYS) {
    assert.ok(LFO_KEYS.includes(`eq_${k}`), k);
    assert.ok(AUTOMATION_TARGETS[`eq.${k}`], k);
    assert.equal(eqKeyOfTarget(`eq_${k}`), k);
    assert.equal(eqKeyOfTarget(`eq.${k}`), k);
  }
  for (const b of EQ_BAND_DEFS.filter(b => b.q == null)) {
    assert.ok(!LFO_KEYS.includes(`eq_${b.key}Q`));
    assert.equal(eqKeyOfTarget(`eq_${b.key}Q`), null);
  }
  assert.equal(eqKeyOfTarget("eq_bogus"), null);
  assert.equal(lfoLabel("eq_lomidQ"), "eq lo mid q");
  assert.equal(autoLabel("eq.highFreq"), "eq high freq");
  assert.equal(lfoLabel("eq_mid"), "eq mid");
});

test("eq targets: any engine, a bus included", () => {
  for (const engine of ["dm:808-kick", "dm:hexop", "plaits:0", "bus", "sampler", "dm:silverbox"]) {
    for (const k of EQ_KEYS) {
      assert.ok(canModulateKey(engine, `eq_${k}`), `${engine} eq_${k}`);
      assert.ok(canAutomateKey(engine, `eq.${k}`), `${engine} eq.${k}`);
    }
  }
  assert.ok(!canAutomateKey("dm:hexop", "eq.lowQ"));
});

test("eq targets: a gain swings its ±18dB linearly, a frequency and a Q in octaves", () => {
  for (const k of EQ_KEYS) {
    const field = splitEqKey(k).field;
    if (field === "gain") {
      assert.equal(LFO_AMP_SCALE[`eq_${k}`], 36, k);
      assert.ok(!CURVED_LFO_KEYS.has(`eq_${k}`), k);
      assert.equal(eqFromUnit(k, 0.5), 0);
      continue;
    }
    assert.ok(CURVED_LFO_KEYS.has(`eq_${k}`), k);
    const curve = CURVED_LFO_CURVES[`eq_${k}`];
    const [lo, hi] = eqRange(k);
    assert.ok(Math.abs(curve.to(0) - lo) < 1e-9 && Math.abs(curve.to(1) - hi) < 1e-6, k);
    // the middle of the travel is the geometric middle of the range
    assert.ok(Math.abs(curve.to(0.5) - Math.sqrt(lo * hi)) < 1e-6, k);
    for (const v of [lo, 100, 1200, hi * 0.9]) {
      if (v < lo || v > hi) continue;
      assert.ok(Math.abs(curve.to(curve.from(v)) - v) / v < 1e-9, `${k} ${v}`);
    }
    // an octave is the same stretch of travel wherever it starts
    if (field === "freq") {
      const oct = (f) => eqToUnit(k, 2 * f) - eqToUnit(k, f);
      assert.ok(Math.abs(oct(100) - oct(4000)) < 1e-9);
    }
  }
  // out of range clamps rather than running off the travel
  assert.equal(eqToUnit("midFreq", 5), 0);
  assert.equal(eqToUnit("midFreq", 1e6), 1);
  assert.equal(eqFromUnit("low", 2), 18);
  assert.equal(eqFromUnit("low", -1), -18);
});

test("eq targets: the freq and Q inputs are log, over the ranges the lanes play", () => {
  const markup = readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  for (const k of EQ_KEYS) {
    const m = new RegExp(`<input class="p-eq-${k}" type="range"([^>]*)/>`).exec(markup);
    assert.ok(m, k);
    const attrs = m[1];
    const [lo, hi] = eqRange(k);
    assert.ok(attrs.includes(`min="${lo}"`) && attrs.includes(`max="${hi}"`), k);
    assert.equal(attrs.includes('data-scale="log"'), splitEqKey(k).field !== "gain", k);
  }
});

test("eq targets: the song builder takes them, and code writes and reads them back", () => {
  const song = B.newSong({ bpm: 120 });
  B.addTrack(song, { engine: "dm:hexop", name: "keys" });
  B.setSteps(song, 0, { steps: "x...x...x...x..." });
  B.addLfo(song, 0, { target: "eq_midFreq", shape: "sine", amount: 0.6, length: "1 bar" });
  B.addLfo(song, 0, { target: "eq_low", shape: "triangle", amount: 0.3 });
  B.setAutomation(song, 0, { target: "eq.himidQ", values: [0, 0.25, 0.5, 1] });
  assert.throws(() => B.addLfo(song, 0, { target: "eq_lowQ" }), /unknown LFO target/);
  assert.throws(() => B.setAutomation(song, 0, { target: "eq.highQ", values: [0.5] }), /unknown automation target/);

  const code = S.sessionToCode(song, { native: true }).code;
  assert.match(code, /\.lfo\('eq_midFreq', 'sine', 0\.6/);
  assert.match(code, /\.aut\('eq\.himidQ'/);
  const t = S.codeToSong(code).song.tracks[0];
  const on = Object.entries(t.lfoConfig).filter(([, v]) => v.enabled).map(([k, v]) => [k, v.depth]).sort();
  assert.deepEqual(on, [["eq_low", 0.3], ["eq_midFreq", 0.6]]);
  assert.deepEqual(t.patterns[0].automation["eq.himidQ"].values.slice(0, 4), [0, 0.25, 0.5, 1]);
  assert.ok(t.patterns[0].automation["eq.himidQ"].enabled);
});
