import test from "node:test";
import assert from "node:assert/strict";
import { generateSongName } from "../app/songs/songName.js";

// A pattern with hits on the given step indices, in a 16-step bar.
function pat(...hits) {
  const steps = Array.from({ length: 16 }, (_, i) => hits.includes(i));
  return { steps };
}

function track(engineKey, patterns = [pat(0, 4, 8, 12)], extra = {}) {
  return { engineKey, patterns, ...extra };
}

function set(over = {}) {
  return {
    bpm: 120,
    swing: 0,
    scale: { active: false, root: 0, mode: "minor" },
    tracks: [track("dm:silverbox")],
    ...over,
  };
}

test("a name is two lowercase words", () => {
  const name = generateSongName(set());
  assert.match(name, /^[a-z]+ [a-z]+$/);
});

test("the same session always names itself the same thing", () => {
  // Saving one session twice must not invent two songs.
  assert.equal(generateSongName(set()), generateSongName(set()));
});

test("a different arrangement gets a different name", () => {
  const a = generateSongName(set());
  const b = generateSongName(set({ tracks: [track("dm:silverbox", [pat(0, 3, 7)])] }));
  assert.notEqual(a, b);
});

test("tempo bands do not share adjectives", () => {
  // Which word is the seed's business; that a 60bpm song can never be handed a
  // 175bpm word is the band's. Sampled across many seeds (swing feeds the
  // digest) rather than asserted against a copy of the table.
  const words = (bpm) =>
    new Set(
      Array.from({ length: 200 }, (_, i) =>
        generateSongName(set({ bpm, swing: i })).split(" ")[0],
      ),
    );
  const slow = words(60);
  const fast = words(175);
  assert.ok(slow.size > 1 && fast.size > 1);
  for (const w of slow) assert.ok(!fast.has(w), `"${w}" appears in both bands`);
});

test("the noun comes from the engine the song is mostly made of", () => {
  const acid = ["acid", "squelch", "slide", "resonance", "ladder"];
  const rig = ["amp", "feedback", "pickup", "string", "fretwork"];
  assert.ok(acid.includes(generateSongName(set()).split(" ")[1]));
  assert.ok(
    rig.includes(generateSongName(set({ tracks: [track("dm:guitar")] })).split(" ")[1]),
  );
});

test("drums lose a tie -- every session has a kit in it", () => {
  const s = set({
    tracks: [
      track("dm:808-kick", [pat(0, 4, 8, 12)]),
      track("dm:808-chat", [pat(0, 2, 4, 6, 8, 10, 12, 14)]),
      track("dm:hexop", [pat(0)]), // the quiet one, but the distinguishing one
    ],
  });
  const fm = ["bell", "tine", "operator", "carrier", "sideband"];
  assert.ok(fm.includes(generateSongName(s).split(" ")[1]));
});

test("a kit on its own still names the song", () => {
  const s = set({ tracks: [track("dm:909-kick"), track("dm:909-snare")] });
  const drums = ["machine", "kit", "breaks", "groove", "pattern"];
  assert.ok(drums.includes(generateSongName(s).split(" ")[1]));
});

test("a session with nothing written in it says so", () => {
  const s = set({ tracks: [track("dm:silverbox", [pat()])] });
  assert.ok(["sketch", "blank", "outline", "stub"].includes(generateSongName(s).split(" ")[1]));
});

test("an fx bus is never what a song is named for", () => {
  const s = set({
    tracks: [track("bus", [pat(0, 1, 2, 3)]), track("dm:sub", [pat(0)])],
  });
  const sub = ["sub", "bottom", "tremor", "rumble", "subfloor"];
  assert.ok(sub.includes(generateSongName(s).split(" ")[1]));
});

test("a dark scale and a bright one pull from different adjectives", () => {
  const dark = generateSongName(set({ scale: { active: true, root: 0, mode: "phrygian" } }));
  const bright = generateSongName(set({ scale: { active: true, root: 0, mode: "lydian" } }));
  assert.notEqual(dark.split(" ")[0], bright.split(" ")[0]);
});

test("a hand-edited or missing blob still gets a name rather than throwing", () => {
  for (const bad of [undefined, null, {}, { tracks: "nope" }, { bpm: NaN, tracks: [{}] }]) {
    assert.match(generateSongName(bad), /^[a-z]+ [a-z]+$/);
  }
});
