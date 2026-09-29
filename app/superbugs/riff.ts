// The intro riff of King Gizzard's "Superbug", from the tab: C# minor, 3/4 at
// 90, three bars of eighths. Bars one and two are F# . D# . C# D#, bar three
// runs F# G# A# C# A# G#. The blip lane's numbers are semitones from A3
// (220Hz), so C#3 is -8; a number on a rest step is only there for a shaken-in
// note to land on. The drums are a plain waltz of my own.
//
// Its own module because two things draw it: the page's toy and the page's
// link preview (app/api/og/superbugs).
export const SUPERBUG = {
  bpm: 90,
  steps: 18,
  perBeat: 2,
  blip: [-3, -6, -6, -6, -8, -6, -3, -6, -6, -6, -8, -6, -3, -1, 1, 4, 1, -1],
  start: ["x.....x.....x.....", "....x.....x.....x.", "xxxxxxxxxxxxxxxxxx", "x.x.xxx.x.xxxxxxxx"],
};
