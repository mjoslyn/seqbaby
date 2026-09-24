// Sessions the song preview is pinned on, shared by test/songPreview.test.js
// (which checks the JS port) and by whoever regenerates the expected output
// from Postgres (see the comment in that test). Not a test file itself.
import * as sb from "../public/js/songBuilder.js";

function built(fn, opts) {
  const s = sb.newSong(opts);
  fn(s);
  return JSON.parse(sb.toJSON(s));
}

export const recipes = {
  "drums, acid with ties, a 32-step lead": () =>
    built((s) => {
      sb.addTrack(s, { engine: "dm:808-kick", name: "kick" });
      sb.addTrack(s, { engine: "dm:808-snare", name: "snare" });
      sb.addTrack(s, { engine: "dm:909-chat", name: "hat" });
      sb.addTrack(s, { engine: "dm:silverbox", name: "acid" });
      sb.addTrack(s, { engine: "plaits:0", name: "lead", length: 32 });
      sb.setSteps(s, 0, { steps: "X...x...X...x..o" });
      sb.setSteps(s, 1, { steps: "....X.......X..." });
      sb.setSteps(s, 2, { steps: "o.x.o.x.o.x.o.xX" });
      sb.setSteps(s, 3, { steps: "x_.xX.x__.X.x.xo" });
      sb.setSteps(s, 4, { steps: "x___....x_x_....x_______..x.x..." });
    }, { bpm: 128 }),
  "a live euclid ring beside written parts": () =>
    built((s) => {
      sb.addTrack(s, { engine: "dm:808-kick", name: "kick" });
      sb.addTrack(s, { engine: "dm:guitar", name: "gtr" });
      sb.addTrack(s, { engine: "dm:808-snare", name: "rim" });
      sb.setSteps(s, 0, { steps: "X......x..X....." });
      sb.setSteps(s, 1, { steps: "x_______x___x___" });
      sb.setEuclid(s, 2, { on: true, pulses: 5, steps: 16 });
    }),
  "legato euclid, and a bus that is left out": () =>
    built((s) => {
      sb.addTrack(s, { engine: "dm:sub", name: "sub" });
      sb.addTrack(s, { engine: "bus", name: "verb" });
      sb.addTrack(s, { engine: "dm:909-chat", name: "hat" });
      sb.setSteps(s, 0, { steps: "x_____..x_.x____" });
      sb.setEuclid(s, 2, { on: true, pulses: 11, steps: 16, gate: "legato" });
    }),
  "a chance track": () =>
    built((s) => {
      sb.addTrack(s, { engine: "plaits:0", name: "melody" });
      sb.setChance(s, 0, { first: 2, last: 13, rhythmSeed: 77 });
    }),
  "the saved pattern is empty, so the first one with notes": () => {
    const d = built((s) => {
      sb.addTrack(s, { engine: "dm:808-kick", name: "kick" });
      sb.setSteps(s, 0, { pattern: 5, steps: "x.x." });
    });
    d.activePattern = 2;
    return d;
  },
  "nothing written anywhere": () => built((s) => sb.addTrack(s, { engine: "plaits:0", name: "empty", length: 8 })),
  "more than eight tracks": () =>
    built((s) => {
      for (let i = 0; i < 10; i++) {
        sb.addTrack(s, { engine: "dm:808-kick", name: `k${i}` });
        sb.setSteps(s, i, { steps: ".".repeat(i) + "x" + ".".repeat(15 - i) });
      }
    }),
  "junk": () => ({
    activePattern: 40.6,
    tracks: [1, null, [], { engineKey: "x", length: "q", patterns: { a: 1 } },
      { length: 4.5, patterns: [{ steps: [true, 1, 0, "1"], velocities: ["x", 1, 0.5, 0], lengths: [3, null, 0, 0] }] }],
  }),
  "no tracks": () => ({ tracks: "nope" }),
};
