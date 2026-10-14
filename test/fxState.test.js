// The fx rack's config reaches the audio by one road, and the stores that hold
// it agree on its shape. Each claim here was once false:
//
// - patternSound.js kept its own stage -> apply method table, without gain and
//   pan, so a p-lock recall, an undo, a jam patch or a code run moved those two
//   knobs and left the sound where it was.
// - session.js and track.js pushed a config onto an existing rack through
//   hand-kept lists of stages, which skipped amp, gain and pan (and the chain
//   order and fx copies), so a song opened after the first play lost them.
// - history pinned only the filter and voice fields an automation lane
//   rewrites, while the fx lanes write the stage's config too.
// - the song builder wrote gspeed without its format marker, so the loader
//   doubled every granular speed an agent asked for.
//
// The modules that do the work touch Tone and the DOM, so the first two are
// pinned by reading their source, as modKeyPrefix.test.js does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AUTOMATION_TARGETS, FX_STAGE_LEVEL_KEY, fxLanePath } from "../public/js/constants.js";
import { defaultFxConfig } from "../public/js/soundDefaults.js";
import * as sb from "../public/js/songBuilder.js";

const src = (f) => readFileSync(`public/js/${f}`, "utf8");

function fxApplyTable() {
  const m = /export const FX_APPLY = \{([\s\S]*?)\};/.exec(src("fxRack.js"));
  assert.ok(m, "fxRack.js exports FX_APPLY");
  return Object.fromEntries([...m[1].matchAll(/(\w+):\s*"(\w+)"/g)].map(x => [x[1], x[2]]));
}

test("the rack's FX_APPLY covers every stage, and each method exists", () => {
  const table = fxApplyTable();
  const rack = src("fxRack.js");
  for (const stage of [...Object.keys(FX_STAGE_LEVEL_KEY), "amp"]) {
    assert.ok(table[stage], `FX_APPLY has ${stage}`);
    assert.match(rack, new RegExp(`\\n  ${table[stage]}\\(`), `FXRack has ${table[stage]}()`);
  }
});

test("patternSound recalls through the rack's own FX_APPLY, not a copy", () => {
  const ps = src("patternSound.js");
  assert.match(ps, /import \{ FX_APPLY \} from "\.\/fxRack\.js"/);
  assert.doesNotMatch(ps, /const FX_APPLY\s*=/);
});

test("a config lands on an existing rack through applyConfig, never a stage list", () => {
  for (const f of ["session.js", "track.js", "liveSet.js"]) {
    const s = src(f);
    // a hand-kept list reads `<track>.fxRack.applyVinyl(<track>.fxConfig.vinyl)`
    assert.doesNotMatch(s, /\.fxRack\.apply[A-Z]\w*\(\w+\.fxConfig\.\w+\)/, `${f} pushes stages by hand`);
  }
  assert.match(src("session.js"), /fxRack\?\.applyConfig\(\)/);
  assert.match(src("track.js"), /loadTrackFromData\(dup, td\)/, "duplicateTrack loads through the song loader");
});

test("every fx lane names a field its stage's config has", () => {
  const fx = defaultFxConfig();
  const keys = Object.keys(AUTOMATION_TARGETS).filter(k => k.startsWith("fx."));
  assert.ok(keys.length > 40);
  for (const key of keys) {
    const path = fxLanePath(key);
    assert.ok(path, `${key} has a path`);
    const [root, stage, field] = path;
    assert.equal(root, "fxConfig");
    assert.ok(fx[stage], `${key}: stage ${stage}`);
    assert.ok(field in fx[stage], `${key}: ${stage}.${field} is not in the default config`);
  }
  // a copy's lane is its stage's, on the copy
  assert.deepEqual(fxLanePath("fx.delay.time#2"), ["fxConfig", "delay#2", "time"]);
  assert.deepEqual(fxLanePath("fx.reverb#3"), ["fxConfig", "reverb#3", "wet"]);
  // not fx lanes
  for (const k of ["cutoff", "harm", "gran.window", "fx.nope", "fx"]) assert.equal(fxLanePath(k), null, k);
});

test("the builder stamps gspeed's format marker, so the loader does not double it", () => {
  const s = sb.newSong();
  const g = sb.addTrack(s, { engine: "granular sampler", texture: "choir" });
  sb.setParams(s, g.index, { gspeed: 0.75 });
  const p = s.tracks[g.index].params;
  assert.equal(p.gspeed, 0.75);
  assert.equal(p.gspeedV, 2);
  // a granular track the builder never gave a speed carries no marker
  const h = sb.addTrack(s, { engine: "granular sampler", texture: "choir" });
  sb.setParams(s, h.index, { gpitch: 7 });
  assert.equal(s.tracks[h.index].params.gspeedV, undefined);
});
