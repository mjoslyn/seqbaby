// The drawn eq's response math against the Web Audio biquads it stands for,
// and the eq keys a band's frequency and width travel in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandCoefs, bandState, coefDb, eqResponseDb, nearestBand } from "../public/js/eqDraw.js";
import { EQ_BAND_DEFS, EQ_KEYS, eqDefault, eqRange, eqValue, splitEqKey } from "../public/js/soundDefaults.js";
import * as sb from "../public/js/songBuilder.js";
import { sessionToCode } from "../public/js/strudel.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("a flat eq is flat", () => {
  const db = eqResponseDb(EQ_BAND_DEFS, {}, [20, 100, 1000, 10000, 20000]);
  for (const d of db) near(d, 0, 1e-9, "flat");
});

test("a bell peaks at its gain, at its frequency", () => {
  const bell = { type: "peaking", freq: 1000, q: 1, gain: 9 };
  near(coefDb(bandCoefs(bell), 1000), 9, 1e-6, "peak");
  assert.ok(coefDb(bandCoefs(bell), 100) < 0.5, "a decade off is near flat");
  const narrow = coefDb(bandCoefs({ ...bell, q: 6 }), 1400);
  const wide = coefDb(bandCoefs({ ...bell, q: 0.5 }), 1400);
  assert.ok(wide > narrow + 3, "a higher Q is narrower");
});

test("shelves reach their gain past the corner and nothing the other side", () => {
  const lo = bandCoefs({ type: "lowshelf", freq: 250, gain: -12 });
  near(coefDb(lo, 20), -12, 0.3, "low shelf below");
  near(coefDb(lo, 250), -6, 0.1, "half the gain at the corner");
  near(coefDb(lo, 10000), 0, 0.05, "low shelf above");
  const hi = bandCoefs({ type: "highshelf", freq: 5000, gain: 6 });
  near(coefDb(hi, 18000), 6, 0.6, "high shelf above");
  near(coefDb(hi, 100), 0, 0.05, "high shelf below");
});

test("a band's frequency and Q come from its keys, defaults when absent", () => {
  const mid = EQ_BAND_DEFS.find(b => b.key === "mid");
  assert.deepEqual(bandState(mid, { mid: 3 }), { type: "peaking", freq: 1200, q: 0.8, gain: 3 });
  assert.deepEqual(bandState(mid, { mid: 3, midFreq: 400, midQ: 4 }), { type: "peaking", freq: 400, q: 4, gain: 3 });
  const db = eqResponseDb(EQ_BAND_DEFS, { mid: 6, midFreq: 400 }, [400, 1200]);
  near(db[0], 6, 0.05, "the moved bell peaks where it was moved");
  assert.ok(db[1] < 2, "and not where it was");
});

test("nearestBand is by log distance", () => {
  const f = EQ_BAND_DEFS.map(b => b.freq);
  assert.equal(nearestBand(f, 30), 0);
  assert.equal(nearestBand(f, 900), 2);    // 900 is nearer 1200 than 600 in octaves
  assert.equal(nearestBand(f, 15000), 4);
});

test("the eq keys", () => {
  assert.deepEqual(EQ_KEYS.slice(0, 5), ["low", "lomid", "mid", "himid", "high"]);
  assert.ok(EQ_KEYS.includes("lowFreq") && EQ_KEYS.includes("midQ"));
  assert.ok(!EQ_KEYS.includes("lowQ"), "a shelf has no Q");
  assert.equal(splitEqKey("lowQ"), null);
  assert.equal(splitEqKey("himidFreq").field, "freq");
  assert.equal(eqDefault("lomidFreq"), 600);
  assert.equal(eqDefault("midQ"), 0.8);
  assert.equal(eqValue({}, "highFreq"), 5000);
  assert.deepEqual(eqRange("midQ"), [0.1, 18]);
});

test("the song builder takes a band's frequency and Q, and refuses a shelf's Q", () => {
  const s = sb.newSong();
  sb.addTrack(s, { engine: "dm:silverbox" });
  sb.setEq(s, 0, { mid: 4, midFreq: 700, midQ: 2 });
  assert.equal(s.tracks[0].eq.midFreq, 700);
  assert.throws(() => sb.setEq(s, 0, { lowQ: 2 }), /unknown eq key/);
  assert.throws(() => sb.setEq(s, 0, { midFreq: 5 }), /eq\.midFreq/);
});

test("code carries a moved band and leaves an unmoved one out", () => {
  const s = sb.newSong();
  sb.addTrack(s, { engine: "dm:silverbox", name: "acid" });
  sb.setSteps(s, 0, { steps: "x..." });
  sb.setEq(s, 0, { lomid: -3, lomidFreq: 450 });
  const code = sessionToCode(s, { native: true }).code;
  assert.match(code, /\.eq\('lomidFreq', 450\)/);
  assert.doesNotMatch(code, /midQ|highFreq/);
});
