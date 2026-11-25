// The master chain's arithmetic (public/js/soundDefaults.js): what a config
// normalizes to, and the settings the glue and the drive take from a knob.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_K, MASTER_DEFAULTS, MASTER_KEYS, MASTER_LABELS, MASTER_RANGE, MASTER_TIPS,
  driveCurve, driveSettings, glueSettings, masterIsNeutral, normalizeMaster,
} from "../public/js/soundDefaults.js";

test("the defaults are neutral and every key has a range, a label and a tip", () => {
  assert.equal(masterIsNeutral(MASTER_DEFAULTS), true);
  assert.equal(masterIsNeutral(undefined), true);
  assert.equal(masterIsNeutral(null), true);
  for (const k of MASTER_KEYS) {
    const [lo, hi] = MASTER_RANGE[k];
    assert.ok(lo <= MASTER_DEFAULTS[k] && MASTER_DEFAULTS[k] <= hi, k);
    assert.ok(MASTER_LABELS[k] && MASTER_TIPS[k], k);
  }
});

test("a config is filled, clamped and stripped of what it does not know", () => {
  assert.deepEqual(normalizeMaster({ glue: 0.3 }), { low: 0, mid: 0, high: 0, glue: 0.3, drive: 0 });
  assert.deepEqual(normalizeMaster({ low: 99, high: -99, glue: 4, drive: -1, width: 2, mid: "x" }),
    { low: 12, mid: 0, high: -12, glue: 1, drive: 0 });
  assert.equal(masterIsNeutral({ glue: 0.01 }), false);
  assert.equal(masterIsNeutral({ mid: -0.5 }), false);
});

test("the glue compresses harder as it goes up, and its trim keeps the level about put", () => {
  let last = glueSettings(0);
  for (let g = 0.1; g <= 1.0001; g += 0.1) {
    const s = glueSettings(g);
    assert.ok(s.threshold < last.threshold && s.ratio > last.ratio, `at ${g}`);
    last = s;
  }
  for (const g of [0.1, 0.5, 1]) {
    const s = glueSettings(g);
    // what the node adds by itself, taken back to 0.6 of what a -6dBFS peak loses
    const auto = -0.6 * (s.threshold - s.threshold / s.ratio);
    const cut = Math.max(0, (-6 - s.threshold) * (1 - 1 / s.ratio));
    assert.ok(Math.abs(auto + s.trimDb - 0.6 * cut) < 1e-9);
    // net lift of a quiet passage: positive, and never more than 6dB
    assert.ok(auto + s.trimDb >= 0 && auto + s.trimDb < 6, `${g}: ${auto + s.trimDb}`);
    // a -6dBFS peak ends up within 4dB of where it was
    assert.ok(Math.abs(-cut + auto + s.trimDb) < 4, `${g}`);
  }
});

test("the drive's curve is odd, monotonic and reaches full scale; a small signal keeps about its level", () => {
  const c = driveCurve(1025);
  assert.ok(Math.abs(c[512]) < 1e-9);
  assert.ok(Math.abs(c[0] + 1) < 1e-6 && Math.abs(c[1024] - 1) < 1e-6);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
  for (let i = 0; i < 512; i++) assert.ok(Math.abs(c[i] + c[1024 - i]) < 1e-6);
  const slope = DRIVE_K / Math.tanh(DRIVE_K);
  for (const d of [0.05, 0.25, 0.5, 0.75, 1]) {
    const s = driveSettings(d);
    const net = 20 * Math.log10(s.pre * slope * s.post);       // a small signal, through the stage
    assert.ok(net > -0.25 && net < 3, `${d}: ${net}`);        // within a quarter dB at the bottom, a little up at the top
    assert.ok(s.post <= 1 / (s.pre * slope) * 2);
    // full scale in comes out no louder than it went in
    assert.ok(Math.tanh(DRIVE_K * s.pre) / Math.tanh(DRIVE_K) * s.post <= 1.0001, `${d}`);
  }
  assert.ok(driveSettings(1).pre > driveSettings(0.2).pre);
});
