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

/** Murmur3's finalizer: the low bits of an FNV hash are a function of the low
 *  bits of its input alone (a multiply never carries downwards), so every
 *  `% list.length` taken straight off hash32 shared the parity of the seed's
 *  digits -- the adjective, the noun and the family pick all moved together
 *  and half the names were unreachable. Measured: 504 of 1008 before this,
 *  all 1008 after. */
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A draw from the seed under its own salt, so every choice a name makes is
 *  independent of the others. */
function draw(seed, salt) {
  return mix32(hash32(`${salt}:${seed}`));
}

/** One word out of `list`, chosen by the seed under its own salt so the two
 *  halves of a name vary independently. */
function pick(list, seed, salt) {
  return list[draw(seed, salt) % list.length];
}

// Tempo bands, dark to bright within each. A band is a feel, not a genre: what
// changes between them is how hurried the adjective is allowed to sound.
//
// The pools are wide on purpose. With six words a side and five nouns a family,
// every scale-less house-tempo acid song drew from ninety names, and an account
// with a few dozen songs in it was already handing the server duplicates to
// number. Fourteen a side and twelve a family is over five hundred per band and
// family before the second-family nouns below widen it again.
const ADJECTIVES = {
  drift: {
    dark: ["midnight", "sunken", "dim", "hollow", "tarpit", "undertow", "buried", "fogbound", "abyssal", "leaden", "sleepless", "nocturnal", "tidal", "moth"],
    bright: ["dawn", "floating", "open", "pale", "daylit", "soft", "milky", "airy", "weightless", "lucid", "tender", "hazy", "lunar", "gentle"],
    neutral: ["idle", "still", "drowsy", "wide", "patient", "low", "slow", "lazy", "adrift", "lingering", "lowtide", "glacial", "halfasleep", "becalmed"],
  },
  walk: {
    dark: ["dusk", "smoky", "grey", "murk", "backroom", "late", "rainy", "sullen", "moody", "ashen", "sodden", "tarnished", "bruised", "dusty"],
    bright: ["amber", "warm", "easy", "sunlit", "glass", "clear", "honey", "breezy", "mellow", "golden", "velvet", "sunday", "rosy", "candid"],
    neutral: ["steady", "plain", "loose", "even", "quiet", "halfway", "casual", "sidewalk", "modest", "wandering", "rolling", "humble", "offbeat", "lowkey"],
  },
  house: {
    dark: ["basement", "concrete", "shadow", "unlit", "cold", "afterhours", "tunnel", "subway", "asphalt", "cellar", "dank", "blacklit", "stale", "bunker"],
    bright: ["neon", "chrome", "polished", "gold", "electric", "bright", "disco", "mirror", "glossy", "vivid", "plastic", "lacquer", "prism", "candy"],
    neutral: ["running", "looping", "tight", "upright", "mechanic", "level", "locked", "cyclic", "modular", "square", "factory", "clockwork", "motor", "deadpan"],
  },
  drive: {
    dark: ["iron", "blackout", "grim", "heavy", "thunder", "hard", "steel", "brutal", "militant", "ominous", "serrated", "granite", "tar", "savage"],
    bright: ["flash", "sharp", "silver", "fastlane", "high", "lit", "radiant", "blazing", "laser", "crystal", "kinetic", "jet", "turbo", "lightning"],
    neutral: ["driving", "forward", "strict", "tension", "pressure", "charge", "relentless", "marching", "pounding", "piston", "urgent", "surging", "engine", "torque"],
  },
  rush: {
    dark: ["riot", "frantic", "meltdown", "panic", "feral", "scorched", "rabid", "manic", "molten", "berserk", "havoc", "volcanic", "screaming", "wrecked"],
    bright: ["hyper", "flare", "strobe", "whitehot", "rocket", "dazzle", "supersonic", "sparkle", "glitter", "fizz", "comet", "giddy", "zippy", "sugar"],
    neutral: ["breakneck", "runaway", "overdrive", "fulltilt", "blur", "sprint", "hurtling", "racing", "jittery", "rapid", "stampede", "frenzied", "turbulent", "quickfire"],
  },
};

// What the session is mostly made of, as a noun. Named for what the family
// sounds like rather than for the engine key, so the name reads as a title and
// not as a settings dump -- but it is still derived from the engines, so two
// songs with different names are different songs.
const NOUNS = {
  acid: ["acid", "squelch", "slide", "resonance", "ladder", "diode", "accent", "bubble", "worm", "zap", "cutoff", "sequence"],
  fm: ["bell", "tine", "operator", "carrier", "sideband", "chime", "algorithm", "index", "ratio", "keys", "lattice", "gong"],
  rig: ["amp", "feedback", "pickup", "string", "fretwork", "strum", "riff", "tube", "cabinet", "twang", "lick", "fret"],
  sub: ["sub", "bottom", "tremor", "rumble", "subfloor", "lowend", "quake", "woofer", "depth", "boom", "trench", "fathom"],
  drone: ["drone", "hum", "dirge", "monolith", "undertow", "equation", "bytebeat", "ritual", "mantra", "ohm", "swell", "tide"],
  voice: ["choir", "chorus", "hymn", "chant", "refrain", "vowel", "lyric", "syllable", "canticle", "harmony", "breath", "lullaby"],
  analog: ["filter", "sweep", "detune", "circuit", "voltage", "oscillator", "envelope", "saw", "pulse", "unison", "transistor", "capacitor"],
  plaits: ["model", "particle", "swarm", "chord", "wavefold", "macro", "braid", "harmonic", "formant", "waveguide", "plait", "lattice"],
  texture: ["grain", "cloud", "texture", "haze", "vapour", "mist", "dust", "smear", "shimmer", "nebula", "fog", "static"],
  sampler: ["sample", "loop", "chop", "slice", "take", "cut", "splice", "crate", "reel", "tape", "flip", "dig"],
  drums: ["machine", "kit", "breaks", "groove", "pattern", "beat", "snare", "kick", "hat", "cymbal", "rhythm", "shuffle"],
  midi: ["signal", "channel", "link", "patch", "cable", "port", "clock", "message", "controller", "din"],
  none: ["session", "sketch", "take", "idea", "draft", "jam", "demo", "study", "etude", "fragment", "experiment", "number"],
};

// A session with nothing written in it gets told so. There is nothing else true
// to say about it, and "empty" is more use in a list than a flattering lie.
const EMPTY_NOUNS = ["sketch", "blank", "outline", "stub", "canvas", "silence", "placeholder", "nothing"];

/** The word tables, for the tests: what a band, a mood or a family can be
 *  called is pinned against these rather than against a copy of them. */
export const SONG_NAME_WORDS = { ADJECTIVES, NOUNS, EMPTY_NOUNS };

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
  if (key === "dm:drone") return "drone";
  if (key === "dm:vox") return "voice";
  if (key === "dm:lancet") return "drums";
  if (key === "dm:siege") return "drums";
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
 *
 * The arrangement is the notes, lengths and velocities as well as the step
 * mask. It used to be the mask alone, so two songs with the same rhythm and
 * different melodies -- every song written over one template's drums -- seeded
 * the same name and the server numbered them. The track names ride along for
 * the same reason: they are the one thing a person already typed to tell two
 * sessions apart.
 */
function digest(set) {
  const parts = [
    `bpm:${Math.round(Number(set?.bpm) || 0)}`,
    `sw:${Math.round(Number(set?.swing) || 0)}`,
    `sc:${set?.scale?.active ? 1 : 0}:${set?.scale?.root ?? 0}:${set?.scale?.mode ?? ""}`,
  ];
  const tracks = Array.isArray(set?.tracks) ? set.tracks : [];
  for (const t of tracks) {
    const lanes = (Array.isArray(t?.patterns) ? t.patterns : []).map((p) => {
      const steps = Array.isArray(p?.steps) ? p.steps : [];
      const notes = Array.isArray(p?.notes) ? p.notes : [];
      const lengths = Array.isArray(p?.lengths) ? p.lengths : [];
      const vels = Array.isArray(p?.velocities) ? p.velocities : [];
      let out = "";
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i]) { out += "."; continue; }
        out += `${notes[i] ?? ""}:${lengths[i] ?? ""}:${vels[i] ?? ""},`;
      }
      return out;
    });
    parts.push(`${t?.engineKey ?? "?"}|${t?.name ?? ""}|${t?.length ?? ""}|${lanes.join("/")}`);
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
 * The families the song is made of, most first. Drums lose ties on purpose:
 * nearly every session has a kit in it, so the kit is the least distinguishing
 * thing about any of them -- it names the song only when it is all there is.
 */
function familyRanking(set) {
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
  if (!written) return { families: [], empty: true };
  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fam]) => fam);
  const notDrums = ranked.filter((fam) => fam !== "drums");
  // Drums go last whatever their score: they only name a song that is nothing
  // but drums.
  const families = notDrums.length ? [...notDrums, ...ranked.filter((f) => f === "drums")] : ranked;
  return { families, empty: false };
}

/**
 * Which family the noun is drawn from. The song's main instrument, mostly --
 * but a song is made of more than one thing, and a third of the time the noun
 * says what ELSE is in it, so an account full of silverbox songs over hexop
 * chords is not an account full of "squelch", "acid" and "ladder". Only a
 * family that plays a part: drums are never the runner-up, because the kit is
 * what every session has.
 */
function nounFamily(families, seed) {
  if (!families.length) return null;
  const runnersUp = families.slice(1).filter((f) => f !== "drums");
  if (runnersUp.length && draw(seed, "fam") % 3 === 0) {
    return runnersUp[draw(seed, "fam2") % runnersUp.length];
  }
  return families[0];
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
    const { families, empty } = familyRanking(set);
    const family = nounFamily(families, seed);
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
