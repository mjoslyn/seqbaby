// The sampled instruments (engineData.js INSTRUMENTS): every listed note has
// its file, the builder and the code drawer reach them, and the export keeps
// them what they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INSTRUMENTS, INSTRUMENT_ENGINES, STATIC_ENGINES, engineSliderLabels, instrumentNoteUrl } from "../public/js/engineData.js";
import { canAutomateKey } from "../public/js/constants.js";
import * as B from "../public/js/songBuilder.js";
import { codeToSong, sessionToCode } from "../public/js/strudel.js";

const root = new URL("..", import.meta.url).pathname;

test("every sampled note is on disk", () => {
  for (const inst of INSTRUMENTS) {
    assert.ok(inst.notes.length >= 10, inst.id);
    for (const n of inst.notes) {
      const file = join(root, "public", instrumentNoteUrl(inst.id, n));
      assert.ok(existsSync(file), file);
    }
  }
});

test("each instrument is an engine with a tone and a release", () => {
  for (const e of INSTRUMENT_ENGINES) {
    assert.ok(STATIC_ENGINES.includes(e));
    assert.equal(e.type, "instrument");
    assert.ok(!/[()]/.test(e.label), "a label is spelled into code, where parentheses are euclid");
    assert.deepEqual(engineSliderLabels(e.key), { harm: null, timb: "tone", morph: null, decay: "release" });
    assert.ok(canAutomateKey(e.key, "timb") && canAutomateKey(e.key, "decay"));
    assert.ok(!canAutomateKey(e.key, "morph"));
  }
});

test("the builder adds them by name and warns on a slider they lack", () => {
  const song = B.newSong({ bpm: 96 });
  assert.equal(B.addTrack(song, { engine: "nylon guitar" }).engine, "inst:guitar-nylon");
  assert.equal(B.addTrack(song, { engine: "acoustic guitar" }).engine, "inst:guitar-acoustic");
  const r = B.setParams(song, 0, { timb: 0.3, harm: 0.2 });
  assert.ok(r.warnings.some(w => w.startsWith("harm")));
});

test("code reaches them, and both exports come back as the same instruments", () => {
  const song = B.newSong({ bpm: 96 });
  for (const e of INSTRUMENT_ENGINES) {
    const { index } = B.addTrack(song, { engine: e.key });
    B.setSteps(song, index, { steps: "x...x..." });
  }
  B.setParams(song, 1, { timb: 0.3, decay: 0.7 });
  for (const native of [true, false]) {
    const back = codeToSong(sessionToCode(song, { native }).code).song;
    assert.deepEqual(back.tracks.map(t => t.engineKey), INSTRUMENT_ENGINES.map(e => e.key));
    if (native) assert.equal(back.tracks[1].params.decay, 0.7);
  }
  assert.equal(codeToSong('$: note("c3").s("gm_acoustic_guitar_nylon")').song.tracks[0].engineKey, "inst:guitar-nylon");
  assert.equal(codeToSong('$: note("c3").s("acoustic_guitar")').song.tracks[0].engineKey, "inst:guitar-acoustic");
  assert.equal(codeToSong('$: note("c3").s("guitar")').song.tracks[0].engineKey, "dm:guitar");
});
