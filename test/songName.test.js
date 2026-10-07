import test from "node:test";
import assert from "node:assert/strict";
import { generateSongName, SONG_NAME_WORDS } from "../app/songs/songName.js";

const { ADJECTIVES, NOUNS, EMPTY_NOUNS } = SONG_NAME_WORDS;
const noun = (name) => name.split(" ")[1];
const adjective = (name) => name.split(" ")[0];

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
  assert.ok(NOUNS.acid.includes(noun(generateSongName(set()))));
  assert.ok(NOUNS.rig.includes(noun(generateSongName(set({ tracks: [track("dm:guitar")] })))));
});

test("a song made of two things is sometimes named for the second", () => {
  // Acid over hexop chords: mostly "squelch", but not only. Sampled across
  // seeds; the runner-up should be picked about a third of the time.
  let acid = 0;
  let fm = 0;
  for (let i = 0; i < 300; i++) {
    const n = noun(
      generateSongName(
        set({
          swing: i,
          tracks: [track("dm:silverbox", [pat(0, 4, 8, 12)]), track("dm:hexop", [pat(0)])],
        }),
      ),
    );
    if (NOUNS.acid.includes(n)) acid++;
    else if (NOUNS.fm.includes(n)) fm++;
    else assert.fail(`"${n}" is neither acid nor fm`);
  }
  assert.ok(acid > fm, "the main instrument still names most songs");
  assert.ok(fm > 50, `the runner-up named only ${fm} of 300`);
});

test("the same rhythm with a different melody is a different name", () => {
  // Every song written over one template's drums used to seed the same name.
  const steps = pat(0, 4, 8, 12).steps;
  const a = set({ tracks: [track("dm:silverbox", [{ steps, notes: [36, 0, 0, 0, 36, 0, 0, 0, 36, 0, 0, 0, 36] }])] });
  const b = set({ tracks: [track("dm:silverbox", [{ steps, notes: [36, 0, 0, 0, 43, 0, 0, 0, 36, 0, 0, 0, 41] }])] });
  assert.notEqual(generateSongName(a), generateSongName(b));
});

test("the names are spread, not bunched", () => {
  // The whole point: a few dozen songs on one account must not number
  // themselves. 200 different arrangements at one tempo on one engine.
  const names = new Set();
  for (let i = 0; i < 200; i++) names.add(generateSongName(set({ swing: i })));
  assert.ok(names.size > 150, `${names.size} distinct names in 200`);
  // And every word the tables hold is reachable: the hash's low bits used to
  // move together across the picks and strand half of them.
  const adjs = new Set();
  const nouns = new Set();
  for (let i = 0; i < 4000; i++) {
    const n = generateSongName(set({ swing: i }));
    adjs.add(adjective(n));
    nouns.add(noun(n));
  }
  const all = [...ADJECTIVES.house.dark, ...ADJECTIVES.house.bright, ...ADJECTIVES.house.neutral];
  for (const w of all) assert.ok(adjs.has(w), `"${w}" never picked`);
  for (const w of NOUNS.acid) assert.ok(nouns.has(w), `"${w}" never picked`);
});

test("drums lose a tie -- every session has a kit in it", () => {
  const s = set({
    tracks: [
      track("dm:808-kick", [pat(0, 4, 8, 12)]),
      track("dm:808-chat", [pat(0, 2, 4, 6, 8, 10, 12, 14)]),
      track("dm:hexop", [pat(0)]), // the quiet one, but the distinguishing one
    ],
  });
  assert.ok(NOUNS.fm.includes(noun(generateSongName(s))));
  // And across seeds it is never the kit: drums are never the runner-up either.
  for (let i = 0; i < 100; i++) {
    assert.ok(!NOUNS.drums.includes(noun(generateSongName({ ...s, swing: i }))));
  }
});

test("a kit on its own still names the song", () => {
  const s = set({ tracks: [track("dm:909-kick"), track("dm:909-snare")] });
  assert.ok(NOUNS.drums.includes(noun(generateSongName(s))));
});

test("a session with nothing written in it says so", () => {
  const s = set({ tracks: [track("dm:silverbox", [pat()])] });
  assert.ok(EMPTY_NOUNS.includes(noun(generateSongName(s))));
});

test("an fx bus is never what a song is named for", () => {
  const s = set({
    tracks: [track("bus", [pat(0, 1, 2, 3)]), track("dm:sub", [pat(0)])],
  });
  assert.ok(NOUNS.sub.includes(noun(generateSongName(s))));
});

test("a dark scale and a bright one pull from different adjectives", () => {
  const dark = generateSongName(set({ scale: { active: true, root: 0, mode: "phrygian" } }));
  const bright = generateSongName(set({ scale: { active: true, root: 0, mode: "lydian" } }));
  assert.notEqual(dark.split(" ")[0], bright.split(" ")[0]);
});

test("every word is one lowercase word, and no adjective sits in two bands", () => {
  const band = new Map();
  for (const [b, moods] of Object.entries(ADJECTIVES)) {
    for (const words of Object.values(moods)) {
      for (const w of words) {
        assert.match(w, /^[a-z]+$/);
        assert.ok(!band.has(w) || band.get(w) === b, `"${w}" is in ${band.get(w)} and ${b}`);
        band.set(w, b);
      }
    }
  }
  for (const words of [...Object.values(NOUNS), EMPTY_NOUNS]) {
    for (const w of words) assert.match(w, /^[a-z]+$/);
  }
});

test("a hand-edited or missing blob still gets a name rather than throwing", () => {
  for (const bad of [undefined, null, {}, { tracks: "nope" }, { bpm: NaN, tracks: [{}] }]) {
    assert.match(generateSongName(bad), /^[a-z]+ [a-z]+$/);
  }
});
