// Naming a song that nobody named. Plain JS with JSDoc types and no imports,
// for the same reason versionTree.js and sessionFormat.js are: it is pure, so
// `node --test` can exercise it without a browser or a React renderer.
//
// The problem it solves is a list of forty rows that all say "untitled". The
// fix is not a counter -- "untitled 12" is as unscannable as "untitled" -- but
// a name that says something true about the session: roughly how fast it is,
// roughly how dark, and what the most characteristic thing in it is. Two words
// is the whole budget, because the name sits in a menu row beside a date.

/** FNV-1a, 32-bit. Small, dependency-free, and good enough to spread words. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One word out of `list`, chosen by the seed under its own salt so the two
 *  halves of a name vary independently. */
function pick(list, seed, salt) {
  return list[hash32(`${salt}:${seed}`) % list.length];
}

// Tempo bands, dark to bright within each. A band is a feel, not a genre: what
// changes between them is how hurried the adjective is allowed to sound.
const ADJECTIVES = {
  drift: {
    dark: ["midnight", "sunken", "dim", "hollow", "tarpit", "undertow"],
    bright: ["dawn", "floating", "open", "pale", "daylit", "soft"],
    neutral: ["idle", "still", "drowsy", "wide", "patient", "low"],
  },
  walk: {
    dark: ["dusk", "smoky", "grey", "murk", "backroom", "late"],
    bright: ["amber", "warm", "easy", "sunlit", "glass", "clear"],
    neutral: ["steady", "plain", "loose", "even", "quiet", "halfway"],
  },
  house: {
    dark: ["basement", "concrete", "shadow", "unlit", "cold", "afterhours"],
    bright: ["neon", "chrome", "polished", "gold", "electric", "bright"],
    neutral: ["running", "looping", "tight", "upright", "mechanic", "level"],
  },
  drive: {
    dark: ["iron", "blackout", "grim", "heavy", "thunder", "hard"],
    bright: ["flash", "sharp", "silver", "fastlane", "high", "lit"],
    neutral: ["driving", "forward", "strict", "tension", "pressure", "charge"],
  },
  rush: {
    dark: ["riot", "frantic", "meltdown", "panic", "feral", "scorched"],
    bright: ["hyper", "flare", "strobe", "whitehot", "rocket", "dazzle"],
    neutral: ["breakneck", "runaway", "overdrive", "fulltilt", "blur", "sprint"],
  },
};

// What the session is mostly made of, as a noun. Named for what the family
// sounds like rather than for the engine key, so the name reads as a title and
// not as a settings dump -- but it is still derived from the engines, so two
// songs with different names are different songs.
const NOUNS = {
  acid: ["acid", "squelch", "slide", "resonance", "ladder"],
  fm: ["bell", "tine", "operator", "carrier", "sideband"],
  rig: ["amp", "feedback", "pickup", "string", "fretwork"],
  sub: ["sub", "bottom", "tremor", "rumble", "subfloor"],
  analog: ["filter", "sweep", "detune", "circuit", "voltage"],
  plaits: ["model", "particle", "swarm", "chord", "wavefold"],
  texture: ["grain", "cloud", "texture", "haze", "vapour"],
  sampler: ["sample", "loop", "chop", "slice", "take"],
  drums: ["machine", "kit", "breaks", "groove", "pattern"],
  midi: ["signal", "channel", "link", "patch"],
  none: ["session", "sketch", "take", "idea", "draft"],
};

// A session with nothing written in it gets told so. There is nothing else true
// to say about it, and "empty" is more use in a list than a flattering lie.
const EMPTY_NOUNS = ["sketch", "blank", "outline", "stub"];

const BRIGHT_MODES = new Set([
  "major",
  "lydian",
  "mixolydian",
  "pentatonic",
  "prometheus",
  "whole tone",
]);
const DARK_MODES = new Set([
  "minor",
  "phrygian",
  "blues",
  "minor pentatonic",
  "harmonic minor",
  "melodic minor",
  "phrygian dominant",
  "double harmonic",
  "hungarian minor",
  "neapolitan minor",
  "persian",
  "enigmatic",
  "hirajoshi",
  "in sen",
  "iwato",
  "octatonic h-w",
  "octatonic w-h",
]);

/** Which noun family an engine key belongs to. The key string is the source of
 *  truth for engines everywhere else too (catalog.js), so it is what is matched
 *  here rather than a parallel list of labels. */
function familyFor(engineKey, isDrumKit) {
  const key = String(engineKey || "");
  if (key === "bus") return null; // a bus has no sound of its own to be named for
  if (key === "dm:silverbox") return "acid";
  if (key === "dm:hexop" || key === "dm:fm-bell" || key === "dm:tines") return "fm";
  if (key === "dm:guitar" || key === "dm:bass") return "rig";
  if (key === "dm:sub") return "sub";
  if (key === "dm:granular" || key === "wt:akwf" || key === "dm:pad") return "texture";
  if (key.startsWith("plaits:")) return "plaits";
  if (key.startsWith("dm:808-") || key.startsWith("dm:909-")) return "drums";
  if (key.startsWith("dm:")) return "analog";
  if (key === "midi") return "midi";
  if (key === "sampler" || key.startsWith("smp:") || key === "upload" || key === "eleven")
    return isDrumKit ? "drums" : "sampler";
  return null; // saved:* patches and anything unknown: no honest family
}

/** How many steps a track actually writes, across all its patterns. A track
 *  that plays is more characteristic of the song than one sitting empty on an
 *  engine somebody auditioned once. */
function trackWeight(track) {
  let n = 0;
  const patterns = Array.isArray(track?.patterns) ? track.patterns : [];
  for (const p of patterns) {
    const steps = Array.isArray(p?.steps) ? p.steps : [];
    for (const s of steps) if (s) n++;
  }
  return n;
}

/**
 * A compact digest of what the session IS, used as the naming seed.
 *
 * Deliberately not a hash of the whole blob: the blob carries base64 sample
 * payloads, so hashing it would be megabytes of work and would rename a song
 * for re-uploading the same drum hit. Arrangement, engines and tempo are what
 * the name claims to describe, so they are what seeds it.
 */
function digest(set) {
  const parts = [
    `bpm:${Math.round(Number(set?.bpm) || 0)}`,
    `sw:${Math.round(Number(set?.swing) || 0)}`,
    `sc:${set?.scale?.active ? 1 : 0}:${set?.scale?.root ?? 0}:${set?.scale?.mode ?? ""}`,
  ];
  const tracks = Array.isArray(set?.tracks) ? set.tracks : [];
  for (const t of tracks) {
    const mask = (Array.isArray(t?.patterns) ? t.patterns : [])
      .map((p) => (Array.isArray(p?.steps) ? p.steps : []).map((s) => (s ? 1 : 0)).join(""))
      .join(".");
    parts.push(`${t?.engineKey ?? "?"}|${mask}`);
  }
  return parts.join("~");
}

function tempoBand(bpm) {
  const n = Number(bpm);
  if (!isFinite(n) || n <= 0) return "house";
  if (n < 85) return "drift";
  if (n < 110) return "walk";
  if (n < 132) return "house";
  if (n < 150) return "drive";
  return "rush";
}

/** Dark, bright, or -- with no scale switched on -- nothing to go on, in which
 *  case the seed picks. A name is not a claim, and three empty pools would make
 *  every scale-less song sound the same. */
function mood(set, seed) {
  const scale = set?.scale;
  if (scale?.active) {
    const m = String(scale.mode || "");
    if (BRIGHT_MODES.has(m)) return "bright";
    if (DARK_MODES.has(m)) return "dark";
  }
  return pick(["dark", "bright", "neutral"], seed, "mood");
}

/**
 * The family the song is most made of. Drums lose ties on purpose: nearly every
 * session has a kit in it, so the kit is the least distinguishing thing about
 * any of them -- it names the song only when it is all there is.
 */
function dominantFamily(set) {
  const tracks = Array.isArray(set?.tracks) ? set.tracks : [];
  /** @type {Map<string, number>} */
  const score = new Map();
  let written = 0;
  for (const t of tracks) {
    const fam = familyFor(t?.engineKey, t?.isDrumKit);
    const w = trackWeight(t);
    written += w;
    if (!fam) continue;
    // An unplayed track still says which engines this song is about, just far
    // more quietly than one carrying the part.
    score.set(fam, (score.get(fam) || 0) + w * 4 + 1);
  }
  if (!written) return { family: null, empty: true };
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const notDrums = ranked.find(([fam]) => fam !== "drums");
  const top = ranked[0]?.[0] === "drums" && notDrums ? notDrums[0] : ranked[0]?.[0];
  return { family: top ?? null, empty: false };
}

/**
 * Name a session that was saved without one.
 *
 * Deterministic on the session's content: the same arrangement always names
 * itself the same thing, so saving one session twice cannot invent two songs.
 * Two genuinely different sessions can still collide on two common words --
 * that is the server's problem to disambiguate, not this function's, since only
 * the server knows what the account already holds.
 *
 * Never throws and never returns empty: it is called on the save path, and a
 * song that fails to save because its name generator choked on a hand-edited
 * blob would be an absurd way to lose work.
 *
 * @param {unknown} set a serialized session (session.js `serializeSet`)
 * @returns {string} two lowercase words, e.g. "basement squelch"
 */
export function generateSongName(set) {
  try {
    const seed = hash32(digest(set));
    const { family, empty } = dominantFamily(set);
    const nouns = empty ? EMPTY_NOUNS : NOUNS[family] || NOUNS.none;
    const adjectives = ADJECTIVES[tempoBand(set?.bpm)][mood(set, seed)];
    const adjective = pick(adjectives, seed, "adj");
    let noun = pick(nouns, seed, "noun");
    // "ladder ladder" is not a name.
    if (noun === adjective) noun = nouns[(nouns.indexOf(noun) + 1) % nouns.length];
    return `${adjective} ${noun}`;
  } catch {
    return "untitled session";
  }
}
