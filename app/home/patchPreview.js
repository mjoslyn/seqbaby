// What a patch card plays, and the session that plays it.
//
// A patch is a SOUND with no notes in it (session.js `serializeTrackPatch`,
// or a legacy custom-Tone config), so hearing one means writing it a part.
// The part is chosen by what the engine is FOR: a drum voice gets a rhythm
// that suits that drum, a bass engine a line with accents and a slide (the
// silverbox's accent is a velocity over 0.6, its slide a tie), a pad held
// chords, anything else a short melody. The card draws the same phrase it
// plays, so the picture and the sound come from one list.
//
// Pure, no imports, for songName.js's reason: `node --test` pins it
// (test/patchPreview.test.js), and it runs both on the server (the card's
// picture) and in the browser (the session handed to the hidden engine).

export const PHRASE_STEPS = 16;
export const PREVIEW_BPM = 120;

/** @typedef {{ i: number, note: number | null, len: number, vel: number, chord?: string }} PhraseStep */
/** @typedef {{ kind: "drum" | "bass" | "pad" | "lead", root: number, steps: PhraseStep[] }} Phrase */

const DRUM_RE = /\b(kick|snare|hat|hi-?hat|chat|ohat|clap|tom|perc|drum|cowbell|rim|kit)\b/;

/** The engine a patch plays on. A track patch names it; a legacy custom-Tone
 *  config IS the synth, which the engine knows as `custom`. */
export function patchEngineKey(config) {
  const c = config && typeof config === "object" ? config : null;
  if (c && c._kind === "track-patch" && typeof c.engineKey === "string" && c.engineKey) return c.engineKey;
  return "custom";
}

/**
 * Whether the hidden engine can play a patch on its own. A legacy custom-Tone
 * patch cannot: the studio plays one only as a `saved:<name>` engine read out
 * of the visitor's localStorage, and the catalog has no bare `custom` entry,
 * so the card draws it but offers no play button rather than writing into
 * someone's saved patches to make a preview work.
 */
export function canPreview(engineKey) {
  return engineKey !== "custom" && !String(engineKey || "").startsWith("saved:");
}

/** A short, human name for an engine key: `dm:silverbox` -> `silverbox`. */
export function engineLabel(key) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return "synth";
  if (k === "custom" || k.startsWith("saved:")) return "tone synth";
  if (k.startsWith("plaits")) return "plaits";
  if (k.startsWith("wt:")) return "wavetable";
  if (k === "dm:sub") return "subby";
  if (k === "dm:guitar") return "guitar";
  if (k === "dm:bass") return "bass";
  if (k.startsWith("smp:") || k === "upload" || k === "eleven") return "sampler";
  const bare = k.replace(/^dm:/, "").replace(/-/g, " ");
  return bare.toLowerCase().slice(0, 24);
}

/** Whether a patch plays as a drum. The patch's own flag when it carries one,
 *  else the engine's name and the hint (the patch's name, its sample's id):
 *  the same words `guessIsDrumKit` looks for. */
export function isDrumPatch(engineKey, flag, hint = "") {
  if (typeof flag === "boolean") return flag;
  return DRUM_RE.test(`${engineKey || ""} ${hint || ""}`.toLowerCase());
}

const hits = (pattern, vels, note = null) =>
  [...pattern].flatMap((ch, i) => (ch === "." ? [] : [{ i, note, len: 1, vel: vels[ch] ?? 0.7 }]));

function drumPhrase(key, hint) {
  // The engine names the drum for the synth kits (`dm:808-kick`); a sampler
  // only says so in its sample's id or the patch's name.
  const k = `${key || ""} ${hint || ""}`.toLowerCase();
  const v = { x: 0.8, X: 1, o: 0.4 };
  let pat = "x...x..ox.x.x..o"; // a generic hit: a broken beat
  if (/kick/.test(k)) pat = "X...x...X...x..o";
  else if (/snare|clap|rim/.test(k)) pat = "....X..o....X.o.";
  else if (/ohat/.test(k)) pat = "..x...x...x...X.";
  else if (/hat|chat/.test(k)) pat = "xoXoxoxoxoXoxoxx";
  else if (/cowbell|perc|tom/.test(k)) pat = "x..x..x...x.x...";
  return { kind: "drum", root: 0, steps: hits(pat, v) };
}

// Semitones above the root. Minor, so it sounds like something whatever the
// engine is, and short enough to loop without wearing out.
const BASS = [
  // i, rel, len, vel  -- a tie (len 2) into the next note is a slide on the silverbox
  [0, 0, 1, 0.9], [2, 0, 1, 0.5], [3, 12, 1, 0.8], [4, 0, 2, 0.5], [6, 3, 1, 0.9],
  [8, 0, 1, 0.5], [10, 7, 1, 0.8], [11, 10, 1, 0.5], [12, 0, 1, 0.9], [14, 12, 1, 0.5], [15, 3, 1, 0.8],
];
const LEAD = [
  [0, 0, 2, 0.8], [2, 3, 1, 0.6], [3, 7, 2, 0.75], [6, 10, 1, 0.6], [7, 12, 3, 0.85],
  [10, 10, 1, 0.6], [11, 7, 2, 0.7], [14, 3, 2, 0.65],
];
const PAD = [
  [0, 0, 8, 0.7, "min7"], [8, -4, 8, 0.7, "maj7"],
];

function rootFor(key) {
  const k = String(key || "");
  if (k === "dm:sub") return 33;
  if (k === "dm:silverbox" || k === "dm:bass") return 36;
  if (k === "dm:guitar") return 52;
  if (k === "dm:fm-bell") return 72;
  return 60;
}

function kindFor(key) {
  const k = String(key || "");
  if (k === "dm:sub" || k === "dm:silverbox" || k === "dm:bass") return "bass";
  if (k === "dm:pad" || k === "dm:granular") return "pad";
  return "lead";
}

/**
 * @param {string} engineKey
 * @param {boolean | undefined} drumFlag  the patch's `isDrumKit`, if it has one
 * @param {string} [hint]  the patch's name and its sample's id, for a sampler
 * @returns {Phrase}
 */
export function phraseFor(engineKey, drumFlag, hint = "") {
  if (isDrumPatch(engineKey, drumFlag, hint)) return drumPhrase(engineKey, hint);
  const kind = kindFor(engineKey);
  const root = rootFor(engineKey);
  const table = kind === "bass" ? BASS : kind === "pad" ? PAD : LEAD;
  return {
    kind,
    root,
    steps: table.map(([i, rel, len, vel, chord]) => ({ i, note: root + rel, len, vel, ...(chord ? { chord } : {}) })),
  };
}

/** The words a phrase is picked by beyond the engine key. One function, so the
 *  card's picture (from the feed's columns) and the session (from the whole
 *  config) read the same ones. */
export function previewHint(name, sampleId) {
  return `${name || ""} ${typeof sampleId === "string" ? sampleId : ""}`.trim();
}

function patternFrom(phrase) {
  const n = PHRASE_STEPS;
  const fill = (v) => Array.from({ length: n }, () => v);
  const p = {
    steps: fill(0), lengths: fill(0), notes: fill(null), velocities: fill(0.5), chords: fill(""),
    offsets: fill(0), arps: fill(false), arpRates: fill(0.25), arpRanges: fill(1), arpDirs: fill("up"),
    complexities: fill(0), ratchets: fill(1),
    sampleStarts: fill(0), sampleEnds: fill(1), sampleFadeIns: fill(0), sampleFadeOuts: fill(0), sampleLoopModes: fill("off"),
    extraNotes: fill(null), extraLengths: fill(null),
    automation: {},
    soundLocked: false, sound: null,
  };
  for (const s of phrase.steps) {
    p.steps[s.i] = 1;
    p.lengths[s.i] = s.len;
    p.notes[s.i] = s.note;
    p.velocities[s.i] = s.vel;
    if (s.chord) p.chords[s.i] = s.chord;
  }
  return p;
}

/**
 * The one-track session a patch card plays: the patch's sound, the phrase
 * above, a neutral tempo, no scale (a scale left on by the song before would
 * snap the phrase), one pattern on repeat.
 */
export function patchSession(config, name = "patch") {
  const c = config && typeof config === "object" ? config : {};
  const engineKey = patchEngineKey(c);
  let track;
  if (c._kind === "track-patch") {
    const { _kind, ...sound } = c;
    void _kind;
    track = { ...sound };
  } else {
    track = { customConfig: c };
  }
  const flag = typeof c.isDrumKit === "boolean" ? c.isDrumKit : undefined;
  const hint = previewHint(name, c.sampleSource?.id);
  const drum = isDrumPatch(engineKey, flag, hint);
  const phrase = phraseFor(engineKey, flag, hint);
  Object.assign(track, {
    name: String(name || "patch").slice(0, 40),
    engineKey,
    length: PHRASE_STEPS,
    isDrumKit: drum,
    // The phrase is written in sixteenths; a patch saved from a double-time
    // track would otherwise play it at twice the speed the card draws it.
    speed: 1,
    muted: false,
    soloed: false,
    patterns: [patternFrom(phrase)],
  });
  return {
    _version: 3,
    bpm: PREVIEW_BPM,
    swing: 0,
    scale: { active: false, root: 0, mode: "minor" },
    activePattern: 0,
    patternMode: "repeat",
    tracks: [track],
  };
}
