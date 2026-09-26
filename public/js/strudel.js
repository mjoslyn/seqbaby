// Strudel and Tidal code, read into a seqbaby song -- and a song written back out.
//
// Strudel (strudel.cc) and TidalCycles describe music as patterns in time;
// seqbaby holds it as steps on tracks. The two meet on the grid: a pattern
// queried cycle by cycle (miniNotation.js) is a list of onsets, and a list of
// onsets is a step sequence. So this module is three things:
//
//   1. two small front ends, one for Strudel's JavaScript and one for Tidal's
//      Haskell, that turn code into the SAME pattern values -- never `eval`:
//      a pasted snippet (or a jam peer's) is data, and only the functions
//      listed below exist;
//   2. `realize`, which queries those patterns and writes tracks: one per
//      sound (`s("bd sd")` is two drum voices here, because a seqbaby track
//      is one instrument), as many bars as the pattern takes to repeat, a
//      grid fine enough that nothing collides, off-grid onsets as step nudges;
//   3. `sessionToCode`, the way back out, so a song made here opens in
//      strudel.cc (`strudelUrl`) or in a Tidal editor.
//
// Pure, for songBuilder.js's reason: the code panel (codePanel.js) imports it
// on demand in the studio, and mcp/server.mjs and test/strudel.test.js run it
// under Node.
//
// What does not translate is said, not dropped silently: every result carries
// `warnings`, one line per thing seqbaby had to approximate or ignore.

import { Pattern, mini, MiniError, silence, stack, fastcat, slowcat, fast, late, rev, ply, degradeBy, euclidPat, signal, segment, sampleSignal, SIGNAL_NAMES } from "./miniNotation.js";
import { addTrack, removeTrack, setTrack, setFilter, setFx, setParams, addLfo, setAutomation, patternOf, emptyPatternBlob, newSong, setTempo } from "./songBuilder.js";
import { CURVED_LFO_CURVES, STEPS_PER_BAR } from "./constants.js";
import { SCALES, CHORD_TYPES } from "./theoryData.js";
import { staticEngineByKey } from "./engineData.js";

export class CodeError extends Error {
  constructor(msg, pos) { super(msg); this.name = "CodeError"; this.pos = pos; }
}

const MAX_STEPS = 64;          // a track's longest length (songBuilder's addTrack range)
const PROBE_CYCLES = 32;       // how far ahead a pattern is asked, to find where it repeats
const MAX_PERIOD = 16;

// ---- values ---------------------------------------------------------------------
// A value in either language is one of: a number, a plain string, a Pattern
// (of raw atoms, or of control objects {s, note, lpf ...}), a signal (sine ...),
// a list (Tidal's [a, b]) or a function (Tidal's curried builtins, and the
// arrow functions Strudel passes to every/sometimes).

const isPat = (v) => v instanceof Pattern;
const isSig = (v) => v && v.kind === "signal";
const isFn = (v) => v && v.kind === "fn";

/** Anything pattern-like, as a Pattern: a number or string is one per cycle. */
function asPattern(v, ctx) {
  if (isPat(v)) return v;
  if (typeof v === "number") return new Pattern((b, e) => {
    const out = [];
    for (let c = Math.ceil(b - 1e-9); c < e - 1e-9; c++) out.push({ begin: c, end: c + 1, value: v, locs: [] });
    return out;
  });
  if (typeof v === "string") return mini(v);
  if (Array.isArray(v)) return stack(v.map(x => asPattern(x, ctx)));
  if (isSig(v)) return segment(v, 16);
  if (v == null) return silence;
  throw new CodeError(`expected a pattern, got ${describe(v)}`);
}
function describe(v) {
  if (isPat(v)) return "a pattern";
  if (isSig(v)) return `a ${v.shape} signal`;
  if (isFn(v)) return `the function ${v.name || "(lambda)"}`;
  return JSON.stringify(v);
}

/** The value a pattern holds at time t (the event sounding then), or undefined. */
function sampleAt(v, t) {
  if (isSig(v)) return sampleSignal(v, t);
  if (!isPat(v)) return v;
  const c = Math.floor(t + 1e-9);
  let best;
  for (const h of v.query(c, c + 1)) if (h.begin <= t + 1e-9 && t < h.end - 1e-9) best = h;
  return best ? best.value : undefined;
}

/** Wrap raw atoms as a control: `s("bd sd")` -> {s: "bd"}, {s: "sd"}. */
function control(name, v, ctx, dialect) {
  const pat = asPattern(v, ctx);
  return pat.withValue(x => (x && typeof x === "object") ? x : { [name]: coerce(name, x, dialect) });
}
function coerce(name, x, dialect) {
  if (typeof x !== "string") return x;
  if (NUMERIC_CONTROLS.has(name)) { const n = Number(x); return Number.isFinite(n) ? n : x; }
  if (name === "note" || name === "n") { const n = Number(x); return Number.isFinite(n) ? n : x; }
  return x;
}

/**
 * `pat.lpf(arg)`: the structure is pat's, and the value comes from arg at each
 * event's onset -- Strudel's `set.in` / Tidal's `#`. A signal is kept whole on
 * the event (`_mods`), because an LFO is what it becomes.
 */
function setControl(pat, name, arg, dialect) {
  const p = asPattern(pat);
  if (isSig(arg)) return p.withValue(v => ({ ...obj(v), _mods: { ...(obj(v)._mods || {}), [name]: arg } }));
  if (isPat(arg)) return p.withValue((v, h) => {
    const got = sampleAt(arg, h.begin);
    if (got === undefined) return obj(v);
    const val = got && typeof got === "object" ? got[name] ?? Object.values(got)[0] : coerce(name, got, dialect);
    return { ...obj(v), [name]: val };
  });
  return p.withValue(v => ({ ...obj(v), [name]: coerce(name, arg, dialect) }));
}
const obj = (v) => (v && typeof v === "object") ? v : (v == null ? {} : { _raw: v });

/** Tidal's `#` family and Strudel's `.set()`: every key of the right side lands on the left's events. */
function mergePatterns(left, right, op = "set") {
  const L = asPattern(left);
  if (isSig(right)) return L;
  const R = asPattern(right);
  return L.withValue((v, h) => {
    const got = sampleAt(R, h.begin);
    if (got === undefined) return obj(v);
    const base = obj(v), add = obj(got);
    if (op === "set") return { ...base, ...add, _mods: { ...(base._mods || {}), ...(add._mods || {}) } };
    const out = { ...base };
    for (const [k, x] of Object.entries(add)) {
      if (k.startsWith("_")) continue;
      out[k] = typeof out[k] === "number" && typeof x === "number" ? arith(op, out[k], x) : (out[k] ?? x);
    }
    return out;
  });
}
function arith(op, a, b) {
  switch (op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return b ? a / b : a; }
  return b;
}
/** Arithmetic on the note / n / raw value of every event (`.add(12)`, `"0 2" + "<0 7>"`). */
function applyArith(pat, op, arg) {
  const p = asPattern(pat);
  return p.withValue((v, h) => {
    const x = isPat(arg) || isSig(arg) ? sampleAt(arg, h.begin) : arg;
    const n = typeof x === "object" && x ? (x.note ?? x.n ?? x._raw) : Number(x);
    if (!Number.isFinite(Number(n))) return v;
    if (v && typeof v === "object") {
      const key = v.note != null ? "note" : v.n != null ? "n" : null;
      if (!key) return v;
      const cur = typeof v[key] === "number" ? v[key] : noteNumber(v[key], v._dialect);
      return cur == null ? v : { ...v, [key]: arith(op, cur, Number(n)) };
    }
    const cur = Number(v);
    return Number.isFinite(cur) ? arith(op, cur, Number(n)) : v;
  });
}

// Controls whose values are numbers, and what each one becomes here.
const NUMERIC_CONTROLS = new Set([
  "gain", "velocity", "legato", "lpf", "cutoff", "hpf", "hcutoff", "bpf", "bandf", "lpq", "resonance", "hpq", "bpq",
  "room", "size", "roomsize", "sz", "delay", "delaytime", "delayfeedback", "crush", "coarse", "distort", "shape",
  "phaser", "phaserdepth", "fm", "lpenv", "pan", "speed", "orbit", "attack", "release", "decay", "sustain",
  "cps", "sus", "clip", "vowel_", "postgain",
]);
const ALIASES = {
  sound: "s", ctf: "lpf", cutoff: "lpf", lp: "lpf", hcutoff: "hpf", hp: "hpf", bandf: "bpf", bp: "bpf",
  resonance: "lpq", res: "lpq", sz: "size", roomsize: "size", delayt: "delaytime", delayfb: "delayfeedback", dfb: "delayfeedback", dt: "delaytime",
  ph: "phaser", dist: "distort", lpe: "lpenv", vel: "velocity", att: "attack", rel: "release", dec: "decay",
};
const canon = (k) => ALIASES[k] || k;
// Accepted and translated; everything else in NUMERIC_CONTROLS is accepted and
// then reported as not translated.
const TRANSLATED = new Set(["s", "note", "n", "gain", "velocity", "legato", "clip", "lpf", "hpf", "bpf", "lpq", "room", "size",
  "delay", "delaytime", "delayfeedback", "crush", "coarse", "distort", "shape", "phaser", "fm", "lpenv", "bank", "scale", "chord", "voicing", "postgain"]);
// Visual / editor methods: nothing to say about them.
const IGNORED_QUIETLY = new Set(["color", "colour", "pianoroll", "_pianoroll", "punchcard", "_punchcard", "scope", "_scope", "spiral", "_spiral",
  "analyze", "log", "fft", "orbit", "draw", "markcss", "spectrum", "_spectrum", "cpm", "p"]);

// ---- notes, scales, chords -------------------------------------------------------

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/**
 * A note as MIDI. Strudel spells middle C `c4` (60) and a bare letter sits in
 * octave 3; Tidal counts from middle C, so `c5` / `c` / `0` are all 60.
 */
export function noteNumber(x, dialect = "strudel") {
  if (typeof x === "number") return dialect === "tidal" ? 60 + x : x;
  const s = String(x ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return noteNumber(Number(s), dialect);
  const m = /^([a-gA-G])((?:#|b|s|f)*)(-?\d+)?$/.exec(s);
  if (!m) return null;
  let v = PC[m[1].toLowerCase()];
  for (const a of m[2]) v += (a === "#" || a === "s") ? 1 : -1;
  const oct = m[3] != null ? Number(m[3]) : (dialect === "tidal" ? 5 : 3);
  return dialect === "tidal" ? v + oct * 12 : v + (oct + 1) * 12;
}
export function midiName(m, dialect = "strudel") {
  const names = ["c", "c#", "d", "eb", "e", "f", "f#", "g", "ab", "a", "bb", "b"];
  const tidal = ["c", "cs", "d", "ef", "e", "f", "fs", "g", "af", "a", "bf", "b"];
  const pc = ((m % 12) + 12) % 12;
  return dialect === "tidal" ? `${tidal[pc]}${Math.floor(m / 12)}` : `${names[pc]}${Math.floor(m / 12) - 1}`;
}

const SCALE_ALIASES = {
  ionian: "major", aeolian: "minor", "natural minor": "minor", "major pentatonic": "pentatonic", majpent: "pentatonic",
  minpent: "minor pentatonic", "pentatonic minor": "minor pentatonic", harmonicminor: "harmonic minor", melodicminor: "melodic minor",
  wholetone: "whole tone", "whole-tone": "whole tone", chromatic: "chromatic", majp: "pentatonic", "minor blues": "blues",
};
/** "C:minor" / "D4:dorian" / "minor pentatonic" -> { root (MIDI, or null), steps } */
export function parseScale(spec, dialect = "strudel") {
  const s = String(spec ?? "").trim();
  const m = /^(?:([A-Ga-g](?:#|b|s|f)?)(-?\d+)?[:\s_]+)?(.+)$/.exec(s);
  if (!m) return null;
  let name = m[3].toLowerCase().replace(/[:_]/g, " ").replace(/\s+/g, " ").trim();
  name = SCALE_ALIASES[name] || SCALE_ALIASES[name.replace(/ /g, "")] || name;
  const steps = name === "chromatic" ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : SCALES[name];
  if (!steps) return null;
  let root = null;
  if (m[1]) root = noteNumber(m[1] + (m[2] ?? (dialect === "tidal" ? "5" : "3")), dialect);
  return { root, steps, name };
}
function degreeToSemis(deg, steps) {
  const d = Math.round(deg), n = steps.length;
  return steps[((d % n) + n) % n] + 12 * Math.floor(d / n);
}

const CHORD_QUALITY = [
  [/^(|M|maj|major)$/, "maj"], [/^(m|-|min|minor)$/, "min"], [/^(7|dom7|dom)$/, "dom7"],
  [/^(\^7?|maj7|M7|Δ7?|j7)$/, "maj7"], [/^(m7|-7|min7|mi7)$/, "min7"], [/^(o|dim|°)$/, "dim"],
  [/^(o7|dim7|°7)$/, "dim"], [/^(h7?|m7b5|-7b5|ø7?)$/, "m7b5"], [/^(\+|aug)$/, "aug"],
  [/^(sus|sus4|7sus4?)$/, "sus4"], [/^sus2$/, "sus2"], [/^(add9|add2|2)$/, "add9"], [/^(6|69|M6)$/, "maj"],
  [/^(m6|-6|m69)$/, "min"], [/^(\^9|maj9|\^13|maj13)$/, "maj7"], [/^(m9|-9|m11|-11|m13)$/, "min7"],
];
/** A chord symbol ("C^7", "Am7", "F#o") as { root (MIDI, octave 3), type (a CHORD_TYPES key) }. */
export function parseChord(sym) {
  const m = /^([A-Ga-g])(#|b)?(.*)$/.exec(String(sym ?? "").trim());
  if (!m) return null;
  let root = PC[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  let q = m[3];
  const slash = q.indexOf("/"); if (slash >= 0) q = q.slice(0, slash);
  let type = null, exact = true;
  for (const [re, t] of CHORD_QUALITY) if (re.test(q)) { type = t; break; }
  if (!type) { exact = false; type = /^(m|-|mi)/.test(q) ? "min7" : /^\d/.test(q) ? "dom7" : "maj"; }
  if (!(type in CHORD_TYPES)) type = "maj";
  return { root: 48 + ((root % 12) + 12) % 12, type, exact };
}

// ---- sounds -> engines ---------------------------------------------------------

// A drum sound's ROLE, from the names Strudel's default kits and Tidal's
// Dirt-Samples use. `808bd` / `909sd` style names carry their machine.
const DRUM_ROLES = [
  [/^(bd|kick|kd|bassdrum|bd\d*)$/, "kick"], [/^(sd|sn|snare|sd\d*)$/, "snare"], [/^(hh|ch|hc|hat|hihat|closedhat)$/, "chat"],
  [/^(oh|ho|openhat|ohh)$/, "ohat"], [/^(cp|clap|claps|realclaps)$/, "clap"], [/^(cb|cowbell)$/, "cowbell"],
  [/^(rim|rs|rimshot)$/, "rim"], [/^(lt|mt|ht|tom|toms|lo|mo|hi)$/, "tom"], [/^(cr|crash|rd|ride|cy|cymbal)$/, "cymbal"],
  [/^(perc|misc|click|tink|glitch|sh|shaker|tb|tambourine)$/, "perc"],
];
function drumRole(name) {
  for (const [re, role] of DRUM_ROLES) if (re.test(name)) return role;
  return null;
}
// Which kit a bank names. Strudel's banks are "RolandTR909" and friends.
function kitOf(bank) {
  const b = String(bank || "").toLowerCase();
  if (/909/.test(b)) return "909";
  if (/cr-?78|compurhythm78/.test(b)) return "CR78";
  if (/rolandr8|\br-?8\b/.test(b)) return "R8";
  if (/techno/.test(b)) return "Techno";
  if (/break|amen/.test(b)) return "breakbeat13";
  if (/acoustic|live/.test(b)) return "acoustic-kit";
  return "808";
}
const SAMPLER_KITS = new Set(["CR78", "R8", "Techno", "breakbeat13", "acoustic-kit"]);
function drumVoice(role, kit) {
  if (SAMPLER_KITS.has(kit)) {
    const part = role === "kick" ? "kick" : role === "snare" || role === "clap" || role === "rim" ? "snare"
      : role === "tom" && kit === "Techno" ? "tom1" : "hihat";
    return { engine: "sampler", sample: `${kit}/${part}` };
  }
  const m = kit === "909" ? "909" : "808";
  const key = {
    kick: `dm:${m}-kick`, snare: `dm:${m}-snare`, chat: `dm:${m}-chat`, ohat: `dm:${m}-ohat`, clap: `dm:${m}-clap`,
    cowbell: "dm:808-cowbell", rim: "dm:808-cowbell", tom: null, cymbal: `dm:${m}-ohat`, perc: "dm:808-cowbell",
  }[role];
  if (role === "tom") return { engine: "sampler", sample: "Techno/tom1" };
  return { engine: key };
}

// Names this module WRITES (sessionToCode) read straight back to their engine,
// so a round trip keeps its instruments; the rules below catch everything else.
const EXPORT_SOUND = {
  "dm:poly-saw": "sawtooth", "dm:contagion": "supersaw", "dm:snarl": "square", "dm:tines": "gm_epiano1",
  "dm:bass": "gm_electric_bass_finger", "dm:silverbox": "gm_synth_bass_1", "dm:ladder": "gm_synth_bass_2",
  "dm:guitar": "gm_electric_guitar_clean", "dm:pad": "gm_pad_warm", "dm:oracle": "gm_pad_poly",
  "dm:fm-bell": "gm_tubular_bells", "dm:drift": "gm_lead_2_sawtooth", "dm:sub": "gm_synth_bass_sub",
  "dm:hexop": "gm_fx_crystal", "wt:akwf": "gm_lead_8_bass_lead", "dm:granular": "gm_pad_halo",
};
const SOUND_EXACT = Object.fromEntries(Object.entries(EXPORT_SOUND).map(([k, v]) => [v, k]));
const MELODIC_RULES = [
  [/^(supersaw|superhoover)$/, "dm:contagion"],
  [/^(saw|sawtooth|supersquare_saw)$/, "dm:poly-saw"],
  [/^(square|pulse|superpwm|supersquare)$/, "dm:snarl"],
  [/^(superfm|fm|dx7?|superfork)$/, "dm:hexop"],
  [/^(tb303|303|acid|superacid|superchip)$/, "dm:silverbox"],
  [/^(sub|subbass|super808|808bass)$/, "dm:sub"],
  [/(piano|epiano|rhodes|wurli|clavinet|harpsichord)/, "dm:tines"],
  [/(synth_bass|synthbass|moog)/, "dm:ladder"],
  [/(bass)/, "dm:bass"],
  [/(guitar|gtr|pluck)/, "dm:guitar"],
  [/(organ|hammond|superhammond|string|violin|cello|choir|voice)/, "dm:oracle"],
  [/(bell|glock|celesta|music_box|vibraphone|marimba|xylophone|kalimba|superfork)/, "dm:fm-bell"],
  [/(pad|superpad|warm|halo)/, "dm:pad"],
  [/(lead|supermandolin)/, "dm:drift"],
  [/^wt_/, "wt:akwf"],
  [/^(white|pink|brown|noise|supernoise)$/, "plaits:9"],
  [/^(triangle|tri|superchip|sine|sin|supergong|pure)$/, "plaits:0"],
];

/**
 * What a sound name plays on here: `{engine, sample?, drum}`. `notes` is the
 * list of MIDI notes the voice plays (for the one rule that needs them: a sine
 * under C3 is a sub bass, above it a lead).
 */
export function voiceFor(sound, { bank, notes = [], fm = false } = {}) {
  const raw = String(sound ?? "").trim();
  let name = raw.toLowerCase().replace(/:\d+$/, "");
  let kit = bank ? kitOf(bank) : null;
  const machine = /^(808|909)([a-z]+)$/.exec(name);
  if (machine) { kit = kit || machine[1]; name = machine[2]; }
  const bankName = /^(roland)?(tr)?(808|909)_?(\w+)$/.exec(name);
  if (bankName) { kit = kit || bankName[3]; name = bankName[4]; }
  if (SOUND_EXACT[name]) return { engine: SOUND_EXACT[name], drum: false, exact: true };
  const role = drumRole(name);
  if (role) return { ...drumVoice(role, kit || "808"), drum: true, exact: role !== "rim" && role !== "cymbal" && role !== "perc" && role !== "tom" };
  if (fm && /^(sine|sin|triangle|tri|$)/.test(name)) return { engine: "dm:hexop", drum: false, exact: true };
  if (/^(sine|sin)$/.test(name)) {
    const low = notes.length && notes.reduce((a, b) => a + b, 0) / notes.length < 48;
    return { engine: low ? "dm:sub" : "plaits:0", drum: false, exact: true };
  }
  for (const [re, engine] of MELODIC_RULES) if (re.test(name)) return { engine, drum: false, exact: /^(triangle|tri|sawtooth|saw|square|supersaw)$/.test(name) || engine !== "plaits:0" };
  return { engine: "plaits:0", drum: false, exact: false };
}

// ---- Strudel: a JavaScript subset --------------------------------------------------

function lexJs(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") { toks.push({ t: "nl", s: i, e: i + 1 }); i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (src.startsWith("/*", i)) { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) { if (src[j] === "\\") j++; j++; }
      if (j >= src.length) throw new CodeError("a string is not closed", i);
      toks.push({ t: ch === "'" ? "str" : "mini", v: src.slice(i + 1, j), s: i, e: j + 1, inner: i + 1 });
      i = j + 1; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
    if (num) { toks.push({ t: "num", v: Number(num[0]), s: i, e: i + num[0].length }); i += num[0].length; continue; }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id) { toks.push({ t: "id", v: id[0], s: i, e: i + id[0].length }); i += id[0].length; continue; }
    if (src.startsWith("=>", i)) { toks.push({ t: "=>", s: i, e: i + 2 }); i += 2; continue; }
    if ("()[]{},.:;=+-*/%".includes(ch)) { toks.push({ t: ch, s: i, e: i + 1 }); i++; continue; }
    throw new CodeError(`unexpected character ${JSON.stringify(ch)}`, i);
  }
  return toks;
}

function parseJs(src) {
  const toks = lexJs(src);
  let p = 0;
  const peek = (k = 0) => toks[p + k];
  const skipNl = () => { while (peek()?.t === "nl" || peek()?.t === ";") p++; };
  const next = () => { skipNlInside(); return toks[p++]; };
  let depth = 0;
  function skipNlInside() { if (depth > 0) while (peek()?.t === "nl") p++; }
  const expect = (t) => {
    const k = next();
    if (!k || k.t !== t) throw new CodeError(`expected ${t}${k ? ` but found ${k.v ?? k.t}` : " at the end"}`, k ? k.s : src.length);
    return k;
  };

  const stmts = [];
  skipNl();
  while (p < toks.length) {
    const start = peek();
    let label = null;
    if (start.t === "id" && peek(1)?.t === ":") { label = start.v; p += 2; }
    else if ((start.v === "const" || start.v === "let" || start.v === "var") && peek(1)?.t === "id" && peek(2)?.t === "=") {
      const name = peek(1).v; p += 3;
      stmts.push({ kind: "assign", name, expr: parseExpr(), pos: start.s });
      endStmt(); continue;
    }
    stmts.push({ kind: label != null ? "label" : "expr", label, expr: parseExpr(), pos: start.s });
    endStmt();
  }
  return stmts;

  function endStmt() {
    const k = peek();
    if (k && k.t !== "nl" && k.t !== ";") {
      // a method chain continued on the next line starts with `.`, which parseExpr has eaten already
      throw new CodeError(`unexpected ${k.v ?? k.t}`, k.s);
    }
    skipNl();
  }

  function parseExpr() { return parseAdd(); }
  function parseAdd() {
    let l = parseMul();
    while (peek() && (peek().t === "+" || peek().t === "-")) { const op = next().t; l = { k: "bin", op, l, r: parseMul() }; }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (peek() && (peek().t === "*" || peek().t === "/" || peek().t === "%")) { const op = next().t; l = { k: "bin", op, l, r: parseUnary() }; }
    return l;
  }
  function parseUnary() {
    if (peek()?.t === "-") { next(); return { k: "neg", e: parseUnary() }; }
    return parsePostfix();
  }
  function parsePostfix() {
    let e = parsePrimary();
    for (;;) {
      // a chain may continue on the next line: `s("bd")\n  .fast(2)`
      let q = p;
      while (toks[q]?.t === "nl") q++;
      if (toks[q]?.t !== ".") break;
      p = q + 1;
      const name = expect("id");
      let args = null;
      if (peek()?.t === "(") args = parseArgs();
      e = { k: "method", target: e, name: name.v, args: args || [], call: !!args, pos: name.s };
    }
    return e;
  }
  function parseArgs() {
    expect("("); depth++;
    const args = [];
    skipNlInside();
    if (peek()?.t !== ")") {
      for (;;) {
        args.push(parseArrowOrExpr());
        skipNlInside();
        if (peek()?.t === ",") { next(); skipNlInside(); if (peek()?.t === ")") break; continue; }
        break;
      }
    }
    depth--; expect(")");
    return args;
  }
  function parseArrowOrExpr() {
    if (peek()?.t === "id" && peek(1)?.t === "=>") { const param = next().v; next(); return { k: "arrow", param, body: parseExpr() }; }
    if (peek()?.t === "(" && peek(1)?.t === "id" && peek(2)?.t === ")" && peek(3)?.t === "=>") {
      next(); const param = next().v; next(); next(); return { k: "arrow", param, body: parseExpr() };
    }
    return parseExpr();
  }
  function parsePrimary() {
    const k = next();
    if (!k) throw new CodeError("unexpected end of code", src.length);
    if (k.t === "num") return { k: "num", v: k.v };
    if (k.t === "str") return { k: "str", v: k.v };
    if (k.t === "mini") return { k: "mini", v: k.v, offset: k.inner, pos: k.s };
    if (k.t === "(") { depth++; const e = parseArrowOrExpr(); depth--; expect(")"); return e; }
    if (k.t === "[") {
      depth++;
      const items = [];
      skipNlInside();
      while (peek() && peek().t !== "]") { items.push(parseExpr()); skipNlInside(); if (peek()?.t === ",") next(); skipNlInside(); }
      depth--; expect("]");
      return { k: "list", items };
    }
    if (k.t === "id") {
      if (k.v === "await" || k.v === "new") return parsePrimary();
      if (peek()?.t === "(") return { k: "call", name: k.v, args: parseArgs(), pos: k.s };
      return { k: "id", name: k.v, pos: k.s };
    }
    throw new CodeError(`unexpected ${k.v ?? k.t}`, k.s);
  }
}

// ---- Tidal: a Haskell subset ------------------------------------------------------

const TIDAL_OPS = ["|+|", "|-|", "|*|", "|/|", "|<|", "|>|", "|+", "|-", "|*", "|/", "|<", "|>", "+|", "-|", "*|", "/|", "<|", ">|", "<~", "~>", "#", "$", "+", "-", "*", "/", "."];
function lexHs(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith("--", i)) { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (src.startsWith("{-", i)) { const j = src.indexOf("-}", i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (ch === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new CodeError("a string is not closed", i);
      toks.push({ t: "mini", v: src.slice(i + 1, j), s: i, e: j + 1, inner: i + 1 }); i = j + 1; continue;
    }
    const num = /^\d+(\.\d+)?(e[-+]?\d+)?/i.exec(src.slice(i));
    if (num) { toks.push({ t: "num", v: Number(num[0]), s: i, e: i + num[0].length }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][\w']*/.exec(src.slice(i));
    if (id) { toks.push({ t: "id", v: id[0], s: i, e: i + id[0].length }); i += id[0].length; continue; }
    if ("()[],".includes(ch)) { toks.push({ t: ch, s: i, e: i + 1 }); i++; continue; }
    const op = TIDAL_OPS.find(o => src.startsWith(o, i));
    if (op) { toks.push({ t: "op", v: op, s: i, e: i + op.length }); i += op.length; continue; }
    if (ch === "=") { toks.push({ t: "=", s: i, e: i + 1 }); i++; continue; }
    throw new CodeError(`unexpected character ${JSON.stringify(ch)}`, i);
  }
  return toks;
}
// Precedence and associativity, as Tidal declares them.
const HS_PREC = { "$": [0, "r"], "#": [1, "l"], ".": [9, "r"], "+": [6, "l"], "-": [6, "l"], "*": [7, "l"], "/": [7, "l"], "<~": [5, "l"], "~>": [5, "l"] };
const hsPrec = (op) => HS_PREC[op] || (op.includes("|") ? [1, "l"] : [6, "l"]);

function parseHsExpr(toks, src) {
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  function parseOp(minPrec) {
    let l = parseApp();
    for (;;) {
      const k = peek();
      if (!k || k.t !== "op") break;
      const [prec, assoc] = hsPrec(k.v);
      if (prec < minPrec) break;
      next();
      const r = parseOp(assoc === "r" ? prec : prec + 1);
      l = { k: "op", op: k.v, l, r, pos: k.s };
    }
    return l;
  }
  function parseApp() {
    const parts = [];
    while (peek() && (peek().t === "num" || peek().t === "mini" || peek().t === "id" || peek().t === "(" || peek().t === "[")) parts.push(parseAtom());
    if (!parts.length) {
      const k = peek();
      // a section: (# speed 2), (+ n 12)
      throw new CodeError(k ? `unexpected ${k.v ?? k.t}` : "unexpected end", k ? k.s : src.length);
    }
    return parts.slice(1).reduce((f, a) => ({ k: "app", f, a }), parts[0]);
  }
  function parseAtom() {
    const k = next();
    if (k.t === "num") return { k: "num", v: k.v };
    if (k.t === "mini") return { k: "mini", v: k.v, offset: k.inner, pos: k.s };
    if (k.t === "id") return { k: "id", name: k.v, pos: k.s };
    if (k.t === "[") {
      const items = [];
      while (peek() && peek().t !== "]") { items.push(parseOp(0)); if (peek()?.t === ",") next(); }
      if (next()?.t !== "]") throw new CodeError("a list is not closed", k.s);
      return { k: "list", items };
    }
    // ( expr ), (op expr) and (expr op) sections, and (-1)
    if (peek()?.t === "op" && toks[p + 1] && toks[p + 1].t !== ")") {
      const op = next().v;
      if (op === "-" ) { const e = parseOp(0); expectClose(k); return { k: "neg", e }; }
      const r = parseOp(0); expectClose(k);
      return { k: "section", op, r };
    }
    if (peek()?.t === "op" && toks[p + 1]?.t === ")") { const op = next().v; next(); return { k: "opfn", op }; }
    const e = parseOp(0);
    if (peek()?.t === "op" && toks[p + 1]?.t === ")") { const op = next().v; next(); return { k: "lsection", op, l: e }; }
    expectClose(k);
    return e;
  }
  function expectClose(open) { if (next()?.t !== ")") throw new CodeError("a bracket is not closed", open.s); }
  const e = parseOp(0);
  if (p < toks.length) throw new CodeError(`unexpected ${toks[p].v ?? toks[p].t}`, toks[p].s);
  return e;
}

/** Tidal statements: a line starting in column 0 begins one; indented lines,
 *  and lines starting with an operator or a closing bracket, continue it. The
 *  text is sliced from the source whole, so offsets inside it stay true. */
function splitHsStatements(src) {
  const starts = [];
  let pos = 0, inBlock = false;
  for (const line of src.split("\n")) {
    const bare = line.replace(/--.*$/, "");
    if (/^\s*\{-/.test(line) && !/-\}/.test(line)) inBlock = true;
    else if (inBlock && /-\}/.test(line)) inBlock = false;
    else if (!inBlock && bare.trim() !== "" && /^\S/.test(line) && !/^(#|\||\+|\$|\.|,|\]|\)|<~|~>)/.test(line) && !/^\{-/.test(line)) starts.push(pos);
    pos += line.length + 1;
  }
  return starts.map((s, i) => ({ text: src.slice(s, i + 1 < starts.length ? starts[i + 1] : src.length).replace(/\s+$/, ""), pos: s }));
}

// ---- the evaluator -----------------------------------------------------------------

/** A function value. Tidal's are curried: applied one argument at a time. */
function fn(name, arity, impl) { return { kind: "fn", name, arity, impl, args: [] }; }
function applyFn(f, arg, ctx) {
  if (!isFn(f)) throw new CodeError(`${describe(f)} is not a function`);
  const g = { ...f, args: [...f.args, arg] };
  if (f.unknown) {
    // An unknown function passes the pattern it is eventually given through.
    if (isPat(arg)) { ctx.warn(`\`${f.name}\` is not supported here and was left out`); return arg; }
    return g;
  }
  return g.args.length >= g.arity ? g.impl(...g.args) : g;
}
function unknownFn(name) { return { kind: "fn", name, arity: Infinity, args: [], unknown: true, impl: () => null }; }
/** A value used as a function of a pattern (a Strudel arrow, a Tidal partial). */
function callWith(f, pat, ctx) {
  if (isFn(f)) return applyFn(f, pat, ctx);
  return pat;
}

function numberOf(v, what, ctx) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  if (isPat(v)) {
    const h = v.query(0, 1)[0];
    const n = Number(h?.value);
    if (Number.isFinite(n)) {
      if (v.query(0, 4).some(x => Number(x.value) !== n)) ctx.warn(`${what} changes over time; seqbaby takes its first value, ${n}`);
      return n;
    }
  }
  throw new CodeError(`${what} must be a number`);
}

/** The functions and methods both languages share. `d` is the dialect. */
function library(ctx, d) {
  const ctl = (name) => (v) => control(name, v, ctx, d);
  const pat = (v) => asPattern(v, ctx);
  const warnSkip = (name) => (p) => { ctx.warn(`\`${name}\` is not supported here and was left out`); return p; };
  const lib = {
    s: ctl("s"), sound: ctl("s"), note: ctl("note"), n: ctl("n"), chord: ctl("chord"),
    stack: (...xs) => stack(xs.flat().map(pat)),
    cat: (...xs) => slowcat(xs.flat().map(pat)), slowcat: (...xs) => slowcat(xs.flat().map(pat)),
    seq: (...xs) => fastcat(xs.flat().map(pat)), fastcat: (...xs) => fastcat(xs.flat().map(pat)),
    sequence: (...xs) => fastcat(xs.flat().map(pat)),
    fast: (n, p) => fastBy(p, n), slow: (n, p) => fastBy(p, n, true), density: (n, p) => fastBy(p, n),
    hurry: (n, p) => fastBy(p, n), rev: (p) => rev(pat(p)),
    ply: (n, p) => ply(pat(p), numberOf(n, "ply", ctx)),
    degrade: (p) => degradeBy(pat(p), 0.5, 11), degradeBy: (x, p) => degradeBy(pat(p), numberOf(x, "degradeBy", ctx), 13),
    euclid: (k, n, p) => euclidPat(pat(p), numberOf(k, "euclid pulses", ctx), numberOf(n, "euclid steps", ctx)),
    euclidRot: (k, n, r, p) => euclidPat(pat(p), numberOf(k, "euclid pulses", ctx), numberOf(n, "euclid steps", ctx), numberOf(r, "euclid rotate", ctx)),
    early: (t, p) => late(pat(p), -numberOf(t, "early", ctx)), late: (t, p) => late(pat(p), numberOf(t, "late", ctx)),
    segment: (n, v) => isSig(v) ? segment(v, numberOf(n, "segment", ctx)) : fastBy(v, n),
    range: (lo, hi, v) => isSig(v) ? { ...v, lo: numberOf(lo, "range", ctx), hi: numberOf(hi, "range", ctx) } : v,
    scale: (name, p) => scalePattern(pat(p), name, ctx, d),
    silence,
  };
  for (const s of SIGNAL_NAMES) lib[s] = signal(s);
  function fastBy(p, n, invert = false) {
    const k = numberOf(n, invert ? "slow" : "fast", ctx);
    const f = invert ? 1 / k : k;
    if (isSig(p)) return { ...p, speed: p.speed * f };
    return fast(pat(p), f);
  }
  lib._warnSkip = warnSkip;
  return lib;
}

/** Scale degrees -> notes. With a root the result is absolute (Strudel's
 *  `n("0 2").scale("C:minor")`), without one it is semitones (Tidal's `scale "minor" "0 2"`). */
function scalePattern(p, name, ctx, d) {
  // "C:minor pentatonic" as ONE name when it reads as one, before mini-notation splits it
  const namePat = isPat(name) && !isPat(name.query(0, 1)[0]?.value) ? wholeName(name, d) : name;
  return p.withValue((v, h) => {
    const spec = isPat(namePat) ? sampleAt(namePat, h.begin) : namePat;
    const sc = parseScale(typeof spec === "object" && spec ? spec._raw ?? spec.scale : spec, d);
    if (!sc) { ctx.warn(`unknown scale ${JSON.stringify(spec)}`); return v; }
    const o = obj(v);
    const deg = o.n ?? o.note ?? o._raw;
    const dn = Number(deg);
    if (!Number.isFinite(dn)) return v;
    const semis = degreeToSemis(dn, sc.steps);
    if (sc.root == null) return (v && typeof v === "object") ? { ...o, n: semis, _scaled: "rel" } : semis;
    const { n: _n, _raw, ...rest } = o;
    return { ...rest, note: sc.root + semis, _abs: true };
  });
}

function wholeName(pat, d) {
  const atoms = pat.query(0, 1).map(h => h.value);
  const joined = atoms.join(" ");
  return atoms.length > 1 && parseScale(joined, d) && pat.query(1, 2).map(h => h.value).join(" ") === joined ? joined : pat;
}

function evalJs(node, env, ctx) {
  const lib = ctx.lib;
  switch (node.k) {
    case "num": return node.v;
    case "str": return node.v;
    case "mini": try { return mini(node.v, node.offset); } catch (e) { throw wrapMini(e); }
    case "neg": { const v = evalJs(node.e, env, ctx); if (typeof v === "number") return -v; return applyArith(v, "*", -1); }
    case "bin": {
      const l = evalJs(node.l, env, ctx), r = evalJs(node.r, env, ctx);
      if (typeof l === "number" && typeof r === "number") return node.op === "%" ? l % r : arith(node.op, l, r);
      return applyArith(l, node.op, r);
    }
    case "list": return node.items.map(i => evalJs(i, env, ctx));
    case "arrow": return fn("(x => ...)", 1, (arg) => evalJs(node.body, { ...env, [node.param]: arg }, ctx));
    case "id": {
      if (node.name in env) return env[node.name];
      if (node.name in lib) {
        const v = lib[node.name];
        return typeof v === "function" ? fn(node.name, Math.max(1, v.length), (...a) => v(...a)) : v;
      }
      if (JS_METHODS[node.name]) return fn(node.name, 1, (p) => callMethod(p, node.name, [], ctx, node.pos));
      throw new CodeError(`\`${node.name}\` is not defined`, node.pos);
    }
    case "call": {
      const args = node.args.map(a => evalJs(a, env, ctx));
      if (node.name in env && isFn(env[node.name])) return args.reduce((f, a) => applyFn(f, a, ctx), env[node.name]);
      return callFunction(node.name, args, ctx, node.pos);
    }
    case "method": {
      const target = evalJs(node.target, env, ctx);
      const args = node.args.map(a => evalJs(a, env, ctx));
      return callMethod(target, node.name, args, ctx, node.pos);
    }
  }
  throw new CodeError(`cannot read ${node.k}`);
}
function wrapMini(e) { return e instanceof MiniError ? new CodeError(`mini-notation: ${e.message}`, e.pos) : e; }

const SIDE_EFFECTS = {
  setcpm: (args, ctx) => { ctx.bpm = numberOf(args[0], "setcpm", ctx) * 4; },
  setcps: (args, ctx) => { ctx.bpm = numberOf(args[0], "setcps", ctx) * 240; },
  setbpm: (args, ctx) => { ctx.bpm = numberOf(args[0], "setbpm", ctx); },
  samples: () => {}, hush: (args, ctx) => { ctx.hush = true; }, await: () => {}, initHydra: () => {}, useRNG: () => {},
  setVoicingRange: () => {}, soundAlias: () => {}, aliasBank: () => {}, loadOrc: () => {},
};

function callFunction(name, args, ctx, pos) {
  if (SIDE_EFFECTS[name]) { SIDE_EFFECTS[name](args, ctx); return undefined; }
  const lib = ctx.lib;
  if (name === "stack" || name === "cat" || name === "seq" || name === "slowcat" || name === "fastcat" || name === "sequence") return lib[name](...args);
  if (name === "arrange") {
    ctx.warn("`arrange` is played as its sections in turn, one cycle each");
    return slowcat(args.map(a => Array.isArray(a) ? asPattern(a[1], ctx) : asPattern(a, ctx)));
  }
  if (["s", "sound", "note", "n", "chord"].includes(name)) return lib[name](args[0]);
  if (name in lib && typeof lib[name] === "function") {
    const f = lib[name];
    // curried-style calls: fast(2, pat) / rev(pat)
    try { return f(...args); } catch (e) { if (e instanceof CodeError) throw Object.assign(e, { pos: e.pos ?? pos }); throw e; }
  }
  // add(12), fast(2) ... with no pattern: a function for every / off / superimpose to apply
  if (JS_METHODS[name] || TRANSLATED.has(canon(name))) {
    if (args.length && isPat(args[args.length - 1]) && args.length > 1) return callMethod(args[args.length - 1], name, args.slice(0, -1), ctx, pos);
    return fn(name, 1, (p) => callMethod(p, name, args, ctx, pos));
  }
  ctx.warn(`\`${name}()\` is not supported here and was left out`);
  return args.find(isPat);
}

// Methods: name -> (self, args, ctx) => value
const JS_METHODS = {
  fast: (p, a, c) => c.lib.fast(a[0], p), slow: (p, a, c) => c.lib.slow(a[0], p), hurry: (p, a, c) => c.lib.fast(a[0], p),
  rev: (p, a, c) => c.lib.rev(p), ply: (p, a, c) => c.lib.ply(a[0], p),
  degrade: (p, a, c) => c.lib.degrade(p), degradeBy: (p, a, c) => c.lib.degradeBy(a[0], p),
  euclid: (p, a, c) => c.lib.euclid(a[0], a[1], p), euclidRot: (p, a, c) => c.lib.euclidRot(a[0], a[1], a[2], p),
  early: (p, a, c) => c.lib.early(a[0], p), late: (p, a, c) => c.lib.late(a[0], p),
  segment: (p, a, c) => c.lib.segment(a[0], p), seg: (p, a, c) => c.lib.segment(a[0], p),
  range: (p, a, c) => c.lib.range(a[0], a[1], p), rangex: (p, a, c) => c.lib.range(a[0], a[1], p),
  scale: (p, a, c) => scalePattern(asPattern(p, c), a[0], c, c.dialect),
  add: (p, a) => applyArith(p, "+", a[0]), sub: (p, a) => applyArith(p, "-", a[0]), mul: (p, a) => applyArith(p, "*", a[0]),
  transpose: (p, a) => applyArith(p, "+", a[0]), trans: (p, a) => applyArith(p, "+", a[0]),
  set: (p, a) => mergePatterns(p, a[0]),
  voicing: (p) => asPattern(p).withValue(v => ({ ...obj(v), voicing: true })),
  voicings: (p) => asPattern(p).withValue(v => ({ ...obj(v), voicing: true })),
  struct: (p, a, c) => {
    const st = asPattern(a[0], c).filter(h => h.value === "x" || h.value === "t" || h.value === "true" || h.value === 1 || h.value === "1");
    const src = asPattern(p, c);
    return st.withValue((_, h) => sampleAt(src, h.begin) ?? {});
  },
  mask: (p, a, c) => {
    const m = asPattern(a[0], c), src = asPattern(p, c);
    return src.filter(h => { const v = sampleAt(m, h.begin); return v != null && v !== "0" && v !== 0 && v !== "f" && v !== "false"; });
  },
  mute: (p) => asPattern(p).withValue(v => ({ ...obj(v), _muted: true })),
  hush: (p) => asPattern(p).withValue(v => ({ ...obj(v), _muted: true })),
  // things that make sense only live, in Strudel's own scheduler
  every: (p, a, c) => { c.warn("`every` is not supported here; the pattern plays unchanged"); return p; },
  firstOf: (p, a, c) => { c.warn("`firstOf` is not supported here; the pattern plays unchanged"); return p; },
  lastOf: (p, a, c) => { c.warn("`lastOf` is not supported here; the pattern plays unchanged"); return p; },
  sometimes: (p, a, c) => { c.warn("`sometimes` is not supported here; the pattern plays unchanged"); return p; },
  often: (p, a, c) => { c.warn("`often` is not supported here; the pattern plays unchanged"); return p; },
  rarely: (p, a, c) => { c.warn("`rarely` is not supported here; the pattern plays unchanged"); return p; },
  jux: (p, a, c) => { c.warn("`jux` needs a stereo field per note, which a seqbaby track does not have; left out"); return p; },
  off: (p, a, c) => {
    const t = numberOf(a[0], "off", c);
    const shifted = late(callWith(a[1], asPattern(p, c), c) ?? asPattern(p, c), t);
    return stack(asPattern(p, c), shifted);
  },
  superimpose: (p, a, c) => stack(asPattern(p, c), callWith(a[0], asPattern(p, c), c) ?? silence),
  layer: (p, a, c) => stack(a.map(f => callWith(f, asPattern(p, c), c) ?? silence)),
};

function callMethod(target, name, args, ctx, pos) {
  if (target === undefined) throw new CodeError(`.${name}() has nothing to act on`, pos);
  const key = canon(name);
  if (JS_METHODS[name]) return JS_METHODS[name](target, args, ctx);
  if (IGNORED_QUIETLY.has(name)) return target;
  // s / note / n with no args convert raw atoms: "c e g".note()
  if ((key === "s" || key === "note" || key === "n" || key === "chord") && !args.length) return control(key, target, ctx, ctx.dialect);
  if (key === "bank") return setControl(target, "bank", args[0], ctx.dialect);
  if (isSig(target)) {
    if (name === "slow") return { ...target, speed: target.speed / numberOf(args[0], "slow", ctx) };
    if (name === "fast") return { ...target, speed: target.speed * numberOf(args[0], "fast", ctx) };
  }
  if (TRANSLATED.has(key) || NUMERIC_CONTROLS.has(key) || ["s", "note", "n"].includes(key)) {
    if (!TRANSLATED.has(key)) ctx.warnOnce(`.${name}()`, `\`${name}\` has no equivalent here and was left out`);
    return setControl(target, key, args.length ? args[0] : 1, ctx.dialect);
  }
  ctx.warnOnce(`.${name}()`, `\`.${name}()\` is not supported here and was left out`);
  return target;
}

function evalHs(node, env, ctx) {
  const lib = ctx.lib;
  switch (node.k) {
    case "num": return node.v;
    case "mini": try { return mini(node.v, node.offset); } catch (e) { throw wrapMini(e); }
    case "neg": { const v = evalHs(node.e, env, ctx); return typeof v === "number" ? -v : applyArith(v, "*", -1); }
    case "list": return node.items.map(i => evalHs(i, env, ctx));
    case "id": return hsIdent(node.name, env, ctx, node.pos);
    case "app": return applyFn(asFn(evalHs(node.f, env, ctx), ctx, node), evalHs(node.a, env, ctx), ctx);
    case "section": { const r = evalHs(node.r, env, ctx); return fn(`(${node.op} ...)`, 1, (l) => hsOp(node.op, l, r, ctx)); }
    case "lsection": { const l = evalHs(node.l, env, ctx); return fn(`(... ${node.op})`, 1, (r) => hsOp(node.op, l, r, ctx)); }
    case "opfn": return fn(`(${node.op})`, 2, (l, r) => hsOp(node.op, l, r, ctx));
    case "op": {
      if (node.op === "$") return applyFn(asFn(evalHs(node.l, env, ctx), ctx, node), evalHs(node.r, env, ctx), ctx);
      if (node.op === ".") {
        const f = evalHs(node.l, env, ctx), g = evalHs(node.r, env, ctx);
        return fn("(f . g)", 1, (x) => applyFn(asFn(f, ctx, node), applyFn(asFn(g, ctx, node), x, ctx), ctx));
      }
      return hsOp(node.op, evalHs(node.l, env, ctx), evalHs(node.r, env, ctx), ctx);
    }
  }
  throw new CodeError(`cannot read ${node.k}`);
}
function asFn(v, ctx, node) {
  if (isFn(v)) return v;
  throw new CodeError(`${describe(v)} is applied to something, but it is not a function`, node?.pos);
}
function hsOp(op, l, r, ctx) {
  if (typeof l === "number" && typeof r === "number") return arith(op, l, r);
  if (op === "#" || op === "|>" || op === "|>|" || op === ">|" ) return mergePatterns(l, r, "set");
  if (op === "|<" || op === "|<|" || op === "<|") return mergePatterns(r, l, "set");
  if (op === "<~") return late(asPattern(r, ctx), -numberOf(l, "<~", ctx));
  if (op === "~>") return late(asPattern(r, ctx), numberOf(l, "~>", ctx));
  const bare = op.replace(/\|/g, "");
  if (["+", "-", "*", "/"].includes(bare)) {
    // pattern + number / pattern + pattern of raw numbers: arithmetic on the note;
    // a control pattern on the right (# n 12 style) goes through the merge.
    if (isPat(r) && r.query(0, 1).some(h => h.value && typeof h.value === "object")) return mergePatterns(l, r, bare);
    return applyArith(l, bare, r);
  }
  throw new CodeError(`the operator ${op} is not supported`);
}
const HS_ARITY = {
  s: 1, sound: 1, note: 1, n: 1, fast: 2, slow: 2, density: 2, hurry: 2, rev: 1, ply: 2, degrade: 1, degradeBy: 2,
  euclid: 3, euclidRot: 4, segment: 2, range: 3, scale: 2, stack: 1, cat: 1, fastcat: 1, slowcat: 1, randcat: 1,
  every: 3, sometimes: 2, often: 2, rarely: 2, almostNever: 2, almostAlways: 2, jux: 2, chop: 2, striate: 2, off: 3,
  superimpose: 2, whenmod: 4, within: 3, iter: 2, palindrome: 1, brak: 1, swingBy: 3, shuffle: 2, scramble: 2, arp: 2,
  toScale: 2, run: 1, irand: 1, struct: 2, mask: 2, sometimesBy: 3, someCyclesBy: 3, inside: 3, outside: 3, linger: 2,
  trunc: 2, stut: 4, echo: 4, plyWith: 3, chunk: 3,
};
function hsIdent(name, env, ctx, pos) {
  if (name in env) return env[name];
  const lib = ctx.lib;
  const key = canon(name);
  if (SIGNAL_NAMES.includes(name)) return lib[name];
  if (name === "silence") return silence;
  if (["s", "sound", "note", "n"].includes(name)) return fn(name, 1, (v) => lib[name](v));
  if (name === "stack" || name === "cat" || name === "fastcat" || name === "slowcat") return fn(name, 1, (xs) => lib[name](...[].concat(xs)));
  if (name === "randcat") return fn(name, 1, (xs) => { ctx.warn("`randcat` is written as `cat`: seqbaby writes the same bars every time"); return lib.cat(...[].concat(xs)); });
  if (name === "run") return fn(name, 1, (n) => fastcat(Array.from({ length: Math.max(1, Math.round(numberOf(n, "run", ctx))) }, (_, i) => asPattern(i))));
  if (name === "toScale") return fn(name, 2, (list, p) => asPattern(p, ctx).withValue(v => {
    const steps = [].concat(list).map(Number); const d = Number(obj(v)._raw ?? v);
    return Number.isFinite(d) ? degreeToSemis(d, steps) : v;
  }));
  if (["fast", "slow", "density", "hurry", "rev", "ply", "degrade", "degradeBy", "euclid", "euclidRot", "segment", "range", "scale"].includes(name)) {
    return fn(name, HS_ARITY[name], (...a) => lib[name](...a));
  }
  if (name === "off") return fn(name, 3, (t, f, p) => JS_METHODS.off(p, [t, f], ctx));
  if (name === "superimpose") return fn(name, 2, (f, p) => JS_METHODS.superimpose(p, [f], ctx));
  if (name === "struct") return fn(name, 2, (st, p) => JS_METHODS.struct(p, [st], ctx));
  if (name === "mask") return fn(name, 2, (m, p) => JS_METHODS.mask(p, [m], ctx));
  if (HS_ARITY[name]) {
    const arity = HS_ARITY[name];
    return fn(name, arity, (...a) => { ctx.warnOnce(name, `\`${name}\` is not supported here; the pattern plays unchanged`); return a[a.length - 1]; });
  }
  if (key === "bank") return fn(name, 1, (v) => control("bank", v, ctx, "tidal"));
  if (TRANSLATED.has(key) || NUMERIC_CONTROLS.has(key) || name === "vowel" || name === "cut" || name === "begin" || name === "end" || name === "unit") {
    if (!TRANSLATED.has(key)) ctx.warnOnce(name, `\`${name}\` has no equivalent here and was left out`);
    return fn(name, 1, (v) => {
      if (isSig(v)) return pureObj({ _mods: { [key]: v } });
      return control(key, v, ctx, "tidal");
    });
  }
  ctx.warnOnce(name, `\`${name}\` is not supported here and was left out`);
  return unknownFn(name);
}
function pureObj(value) {
  return new Pattern((b, e) => {
    const out = [];
    for (let c = Math.ceil(b - 1e-9); c < e - 1e-9; c++) out.push({ begin: c, end: c + 1, value, locs: [] });
    return out;
  });
}

// ---- reading a program ---------------------------------------------------------------

/** Strudel or Tidal? Tidal's `d1 $` and `# lpf` are unmistakable. */
export function detectDialect(code) {
  const s = String(code);
  if (/^\s*(d\d+|p\s+"[^"]*"|p\s+\d+)\s*(\$|silence)/m.test(s) || /^\s*setcps\s*\(/m.test(s) || /^\s*hush\s*$/m.test(s) && !/\$:/.test(s)) return "tidal";
  if (/\s#\s*[a-z]+\s/.test(s) && !/[.(]/.test(s.replace(/"[^"]*"/g, ""))) return "tidal";
  return "strudel";
}

/**
 * Read code into its playing patterns. Returns
 * `{ dialect, bpm, hush, outputs: [{label, muted, pat, pos}], warnings }`.
 * Throws a CodeError (with `pos`, an offset into the code) on a syntax error.
 */
export function readCode(code, { dialect } = {}) {
  const src = String(code ?? "");
  const d = dialect || detectDialect(src);
  const warnings = [];
  const seen = new Set();
  const ctx = {
    dialect: d, bpm: null, hush: false,
    warn: (m) => { if (!seen.has(m)) { seen.add(m); warnings.push(m); } },
    warnOnce: (key, m) => { if (!seen.has(key)) { seen.add(key); warnings.push(m); } },
  };
  ctx.lib = library(ctx, d);
  const outputs = [];
  if (d === "tidal") readTidal(src, ctx, outputs);
  else readStrudel(src, ctx, outputs);
  return { dialect: d, bpm: ctx.bpm, hush: ctx.hush, outputs, warnings };
}

function readStrudel(src, ctx, outputs) {
  const stmts = parseJs(src);
  const env = {};
  let lastBare = null, n = 0;
  for (const st of stmts) {
    if (st.kind === "assign") { env[st.name] = evalJs(st.expr, env, ctx); continue; }
    const v = evalJs(st.expr, env, ctx);
    if (st.kind === "label") {
      const muted = st.label.startsWith("_");
      const name = st.label.replace(/^_/, "");
      if (!isPat(v)) { if (v !== undefined) ctx.warn(`${st.label}: is not a pattern`); continue; }
      outputs.push({ label: name === "$" ? null : name, index: n++, muted, pat: v, pos: st.pos });
    } else if (isPat(v)) lastBare = { label: null, index: n, muted: false, pat: v, pos: st.pos };
  }
  if (!outputs.length && lastBare) outputs.push(lastBare);
}

function readTidal(src, ctx, outputs) {
  const env = {};
  for (const { text, pos } of splitHsStatements(src)) {
    const t = text.trim();
    if (/^(import|:set|:\{|:\}|let\s+\w+\s*=\s*$)/.test(t)) continue;
    if (/^hush\b/.test(t)) { ctx.hush = true; continue; }
    const setcps = /^setcps\s+(.+)$/s.exec(t);
    if (setcps) { ctx.bpm = numberOf(evalHs(parseHsExpr(lexHs(setcps[1]), setcps[1]), env, ctx), "setcps", ctx) * 240; continue; }
    const setbpm = /^setbpm\s+(.+)$/s.exec(t);
    if (setbpm) { ctx.bpm = numberOf(evalHs(parseHsExpr(lexHs(setbpm[1]), setbpm[1]), env, ctx), "setbpm", ctx); continue; }
    const letm = /^let\s+([a-z]\w*)\s*=\s*(.+)$/s.exec(t);
    const lead = text.length - text.trimStart().length;
    if (letm) {
      const off = pos + lead + t.indexOf(letm[2]);
      env[letm[1]] = evalHs(parseHsExpr(shift(lexHs(letm[2]), off), letm[2]), env, ctx);
      continue;
    }
    const dm = /^(d(\d+)|p\s+"([^"]+)"|p\s+(\d+))\s*(\$)?\s*/.exec(t);
    if (!dm) { ctx.warn(`skipped a line Tidal would run but that makes no pattern: ${t.split("\n")[0].slice(0, 40)}`); continue; }
    const label = dm[2] ? `d${dm[2]}` : (dm[3] || `p${dm[4]}`);
    const body = t.slice(dm[0].length);
    const off = pos + lead + dm[0].length;
    if (/^silence\s*$/.test(body) || !body.trim()) { outputs.push({ label, index: outputs.length, muted: true, pat: silence, pos: pos + lead }); continue; }
    let v;
    try { v = evalHs(parseHsExpr(shift(lexHs(body), off), body), env, ctx); }
    catch (e) { if (e instanceof CodeError && e.pos != null && e.pos < off) e.pos += off; throw e; }
    if (!isPat(v)) { ctx.warn(`${label} is not a pattern`); continue; }
    outputs.push({ label, index: outputs.length, muted: false, pat: v, pos: pos + lead });
  }
}
function shift(toks, off) { return toks.map(k => ({ ...k, s: k.s + off, e: k.e + off, inner: k.inner != null ? k.inner + off : undefined })); }

// ---- patterns -> tracks ---------------------------------------------------------------

/** What an event plays: its voice, its notes, how loud. */
function resolveHap(h, d) {
  const v = obj(h.value);
  const out = { begin: h.begin, end: h.end, locs: h.locs || [], v };
  let notes = [], chordType = "";
  if (v.chord != null) {
    const c = parseChord(v.chord);
    if (c) { notes = [c.root]; chordType = c.type; out.chordExact = c.exact; out.chordSym = v.chord; }
  }
  const pitch = v.note ?? v.n;
  if (pitch != null && !notes.length) {
    const tc = tidalChord(pitch, d);
    if (tc) { notes = [tc.root]; chordType = tc.type; out.chordExact = true; }
    else {
      const m = v._abs ? Number(pitch) : noteNumber(pitch, d);
      if (m != null && Number.isFinite(m)) notes = [Math.round(m)];
    }
  }
  if (v._raw != null && !notes.length && v.s == null) {
    const m = noteNumber(v._raw, d);
    if (m != null) notes = [m];
  }
  out.notes = notes;
  out.chordType = chordType;
  out.sound = v.s != null ? String(v.s) : (notes.length ? (v.fm != null ? "sine" : "triangle") : (v._raw != null ? String(v._raw) : null));
  return out;
}

// Tidal's chord names: "c'maj e'min7"
const TIDAL_CHORDS = { major: "maj", maj: "maj", minor: "min", min: "min", m: "min", dom7: "dom7", seven: "dom7", major7: "maj7", maj7: "maj7",
  minor7: "min7", min7: "min7", m7: "min7", sus2: "sus2", sus4: "sus4", dim: "dim", diminished: "dim", aug: "aug", plus: "aug", add9: "add9", m7b5: "m7b5" };
function tidalChord(x, d) {
  const m = /^([a-gA-G](?:#|b|s|f)?-?\d*)'(\w+)/.exec(String(x));
  if (!m) return null;
  const root = noteNumber(m[1], d);
  if (root == null) return null;
  return { root, type: TIDAL_CHORDS[m[2]] || "maj" };
}

const trackNameOf = (s) => String(s).replace(/[^\w#: -]/g, "").slice(0, 32) || "track";

/**
 * Turn read code into track blueprints: one per voice per output. Each has its
 * grid (`stepsPerCycle`, `cycles`), its steps, and the sound settings the code
 * gave it. Pure data; `writeTracks` puts them in a song.
 */
export function realize(read) {
  const d = read.dialect;
  const warnings = [...read.warnings];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  const tracks = [];
  const usedNames = new Set();
  for (const out of read.outputs) {
    const haps = [];
    for (let c = 0; c < PROBE_CYCLES; c++) for (const h of out.pat.cycle(c)) haps.push(resolveHap(h, d));
    const sounding = haps.filter(h => h.sound != null && !h.v._muted);
    const groups = new Map();
    for (const h of sounding) {
      const notesForVoice = h.notes;
      const voice = voiceFor(h.sound, { bank: h.v.bank, notes: notesForVoice, fm: h.v.fm != null });
      const key = `${voice.engine}|${voice.sample || ""}`;
      if (!groups.has(key)) groups.set(key, { voice, sounds: new Set(), haps: [] });
      const g = groups.get(key);
      g.sounds.add(h.sound.replace(/:\d+$/, ""));
      g.haps.push(h);
    }
    // a sine is a sub or a lead depending on the notes it plays -- decide once per group
    for (const g of groups.values()) {
      if (!g.voice.exact) warn(`"${[...g.sounds][0]}" has no match here; it plays on ${staticEngineByKey(g.voice.engine)?.label || g.voice.engine}`);
    }
    const muted = out.muted || (sounding.length && sounding.every(h => h.v._muted));
    if (!groups.size) {
      if (out.label) tracks.push({ name: uniqueName(out.label, usedNames), label: out.label, empty: true, muted: true });
      continue;
    }
    const many = groups.size > 1;
    for (const g of groups.values()) {
      const soundName = [...g.sounds].join("+");
      const base = out.label ? (many ? `${out.label} ${soundName}` : out.label) : soundName;
      const bp = blueprint(g, d, warn);
      tracks.push({ ...bp, name: uniqueName(trackNameOf(base), usedNames), label: out.label, muted, engine: g.voice.engine, sample: g.voice.sample, drum: g.voice.drum });
    }
  }
  return { bpm: read.bpm, tracks, warnings, dialect: d, hush: read.hush };
}
function uniqueName(name, used) {
  let n = name, i = 2;
  while (used.has(n)) n = `${name} ${i++}`;
  used.add(n);
  return n;
}

const sig = (list, c) => list.filter(h => h.begin >= c - 1e-9 && h.begin < c + 1 - 1e-9)
  .map(h => `${(h.begin - c).toFixed(5)}|${(h.end - h.begin).toFixed(5)}|${h.notes.join(",")}|${h.chordType}|${JSON.stringify(stripPrivate(h.v))}`)
  .sort().join(";");
function stripPrivate(v) { const o = {}; for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) o[k] = x; return o; }

/** How many cycles until the group repeats (1..16), or null if it never does in the probe. */
function periodOf(haps) {
  const sigs = Array.from({ length: PROBE_CYCLES }, (_, c) => sig(haps, c));
  for (let n = 1; n <= MAX_PERIOD; n++) {
    let ok = true;
    for (let c = n; c < PROBE_CYCLES && ok; c++) if (sigs[c] !== sigs[c % n]) ok = false;
    if (ok) return n;
  }
  return null;
}

const SPEEDS = [1, 2, 4, 8];
function blueprint(g, d, warn) {
  let cycles = periodOf(g.haps);
  if (cycles == null) { cycles = 4; warn(`a pattern on ${[...g.sounds].join("+")} never repeats (randomness?); seqbaby writes its first 4 cycles and loops them`); }
  // the grid: 16 steps a cycle, doubled until no two onsets share a step,
  // halved only when the pattern is too long to fit 64 steps at 16 a cycle
  const onsets = [...new Set(g.haps.filter(h => h.begin < cycles - 1e-9).map(h => h.begin.toFixed(6)))].map(Number);
  let speed = null;
  for (const r of SPEEDS) {
    const S = STEPS_PER_BAR * r;
    if (S * cycles > MAX_STEPS) break;
    const steps = new Set(onsets.map(t => Math.round(t * S)));
    if (steps.size === onsets.length) { speed = r; break; }
  }
  if (speed == null) {
    // too dense or too long: take the finest grid that fits
    const fits = [8, 4, 2, 1, 0.5, 0.25].filter(r => STEPS_PER_BAR * r * cycles <= MAX_STEPS);
    speed = fits.length ? fits[0] : 0.25;
    if (!fits.length) {
      const maxCycles = Math.floor(MAX_STEPS / (STEPS_PER_BAR * 0.25));
      warn(`a pattern on ${[...g.sounds].join("+")} repeats every ${cycles} cycles; a track holds ${maxCycles}, so the rest is cut`);
      cycles = maxCycles;
    }
  }
  const S = STEPS_PER_BAR * speed;
  const length = Math.round(S * cycles);
  const pat = emptyPatternBlob(length);
  const stepLocs = Array.from({ length }, () => []);
  const haps = g.haps.filter(h => h.begin < cycles - 1e-9).sort((a, b) => a.begin - b.begin);
  let dropped = 0;
  const firstAt = new Map();
  // gain: one value everywhere -> the track fader; varying -> step velocities
  const gains = haps.map(h => Number(h.v.gain ?? 1) * Number(h.v.postgain ?? 1));
  const constantGain = gains.every(x => Math.abs(x - gains[0]) < 1e-6) ? gains[0] : null;
  for (const h of haps) {
    const pos = h.begin * S;
    const i = Math.round(pos) % length;
    const prior = firstAt.get(i);
    if (prior != null && Math.abs(prior.begin - h.begin) > 1e-6) { dropped++; continue; }
    const legato = Number(h.v.legato ?? h.v.clip ?? 1);
    // a drum is a hit: its length on the grid is one step whatever the event's span
    const len = g.voice.drum ? 1 : Math.max(1, Math.min(length, Math.round((h.end - h.begin) * S * (Number.isFinite(legato) ? legato : 1))));
    const vel = clamp(0.8 * Number(h.v.velocity ?? 1) * (constantGain == null ? Number(h.v.gain ?? 1) * Number(h.v.postgain ?? 1) : 1), 0.05, 1);
    stepLocs[i].push(...(h.locs || []));
    if (prior == null) {
      firstAt.set(i, h);
      pat.steps[i] = 1;
      pat.lengths[i] = len;
      pat.velocities[i] = round3(vel);
      pat.offsets[i] = round3(clamp(pos - Math.round(pos), -0.5, 0.5));
      if (h.notes.length) {
        pat.notes[i] = h.notes[0];
        if (h.chordType) pat.chords[i] = h.chordType;
        if (h.notes.length > 1) { pat.extraNotes[i] = h.notes.slice(1); pat.extraLengths[i] = h.notes.slice(1).map(() => len); }
      }
    } else if (h.notes.length) {
      // same onset, another note: a chord
      const extra = pat.extraNotes[i] || [];
      const lens = pat.extraLengths[i] || [];
      for (const n of h.notes) if (n !== pat.notes[i] && !extra.includes(n)) { extra.push(n); lens.push(len); }
      pat.extraNotes[i] = extra.length ? extra : null;
      pat.extraLengths[i] = extra.length ? lens : null;
      if (pat.notes[i] == null) pat.notes[i] = h.notes[0];
    }
  }
  if (dropped) warn(`${dropped} note${dropped > 1 ? "s" : ""} on ${[...g.sounds].join("+")} fell on a step another note already starts on, and ${dropped > 1 ? "were" : "was"} dropped`);
  if (haps.some(h => h.chordType && !h.chordExact)) warn(`some chord symbols were played as the nearest chord seqbaby has (${Object.keys(CHORD_TYPES).filter(Boolean).join(", ")})`);
  if (g.voice.drum) for (let i = 0; i < length; i++) if (pat.steps[i] && pat.notes[i] != null && !g.haps.some(h => h.v.note != null)) pat.notes[i] = null;

  // sound: constants set the knob, per-event changes become a lane, signals an LFO
  const sound = soundSettings(haps, S, length, d, warn, constantGain);
  return { stepsPerCycle: S, speed, cycles, length, pattern: pat, stepLocs, ...sound };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const round3 = (x) => Math.round(x * 1000) / 1000;

const hzToKnob = (hz) => clamp(CURVED_LFO_CURVES.cutoff.from(Number(hz)), 0, 1);
const knobToHz = (u) => Math.round(CURVED_LFO_CURVES.cutoff.to(u));
const CRUSH_RATE = { from: (hz) => clamp(Math.log(hz / 250) / Math.log(48000 / 250), 0, 1) };

/** Each control, as seqbaby: where it goes and how its units map. */
function controlTargets(d) {
  return {
    lpf: { lane: "cutoff", lfo: "cutoff", knob: hzToKnob },
    hpf: { lane: "cutoff", lfo: "cutoff", knob: hzToKnob },
    bpf: { lane: "cutoff", lfo: "cutoff", knob: hzToKnob },
    lpq: { lane: "reson", lfo: "reson", knob: (q) => clamp(d === "tidal" ? Number(q) : Number(q) / 20, 0, 1) },
    room: { lane: "fx.reverb", lfo: "verb", knob: (x) => clamp(Number(x), 0, 1) },
    delay: { lane: "fx.delay", lfo: "delay", knob: (x) => clamp(Number(x), 0, 1) },
    shape: { lane: "fx.shaper", lfo: "shaper", knob: (x) => clamp(Number(x), 0, 1) },
    distort: { lane: "fx.fuzz", lfo: "fuzz", knob: (x) => clamp(Number(x) / 2, 0, 1) },
    gain: { lane: "vol", lfo: "vol", knob: (x) => clamp(0.8 * Number(x), 0, 1) },
  };
}

function soundSettings(haps, S, length, d, warn, constantGain) {
  const targets = controlTargets(d);
  const values = {};
  const mods = {};
  for (const h of haps) {
    for (const [k, x] of Object.entries(h.v)) {
      if (k.startsWith("_")) continue;
      (values[k] ||= []).push({ t: h.begin, x });
    }
    for (const [k, s] of Object.entries(h.v._mods || {})) mods[k] = s;
  }
  const constant = (k) => {
    const list = values[k];
    if (!list?.length) return undefined;
    return list.every(e => e.x === list[0].x) ? list[0].x : undefined;
  };
  const varies = (k) => values[k]?.length && constant(k) === undefined;
  const filter = {}, fx = {}, params = {}, lanes = {}, lfos = [];
  // the filter's shape: the first of lpf / hpf / bpf the code used
  const fType = values.lpf ? "lpf" : values.hpf ? "hpf" : values.bpf ? "bpf" : mods.lpf ? "lpf" : mods.hpf ? "hpf" : mods.bpf ? "bpf" : null;
  if (fType) {
    filter.type = { lpf: "lowpass", hpf: "highpass", bpf: "bandpass" }[fType];
    if ([values.lpf, values.hpf, values.bpf].filter(Boolean).length > 1) warn("a track here has one filter; the first of lpf / hpf / bpf was used");
  }
  const laneOf = (k) => {
    const tgt = targets[k];
    const list = values[k].slice().sort((a, b) => a.t - b.t);
    const out = [];
    let j = 0, cur = list[0].x;
    for (let i = 0; i < length; i++) {
      const t = i / S;
      while (j < list.length && list[j].t <= t + 1e-9) cur = list[j++].x;
      out.push(round3(tgt.knob(cur)));
    }
    return out;
  };
  for (const k of ["lpf", "hpf", "bpf", "lpq", "room", "delay", "shape", "distort"]) {
    if (k === "lpf" || k === "hpf" || k === "bpf") { if (k !== fType) continue; }
    if (!values[k]) continue;
    const c = constant(k);
    if (c !== undefined) applyConst(k, c);
    else { lanes[targets[k].lane] = laneOf(k); applyConst(k, values[k][0].x); }
  }
  function applyConst(k, x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return;
    switch (k) {
      case "lpf": case "hpf": case "bpf": filter.cutoff = round3(hzToKnob(n)); break;
      case "lpq": filter.reson = round3(targets.lpq.knob(n)); break;
      case "room": fx.reverb = { ...(fx.reverb || {}), wet: round3(clamp(n, 0, 1)) }; break;
      case "delay": fx.delay = { ...(fx.delay || {}), wet: round3(clamp(n, 0, 1)) }; break;
      case "shape": fx.shaper = { wet: 1, amount: round3(clamp(n, 0, 1)), mode: "saturate" }; break;
      case "distort": fx.fuzz = { amount: round3(clamp(n / 2, 0, 1)), drive: round3(clamp(0.4 + n * 0.1, 0, 1)) }; break;
    }
  }
  const one = (k) => { const c = constant(k); if (varies(k)) warn(`\`${k}\` changes per note; seqbaby takes the first value`); return c !== undefined ? c : values[k]?.[0]?.x; };
  if (values.size) {
    const n = Number(one("size"));
    if (Number.isFinite(n)) fx.reverb = { ...(fx.reverb || {}), decay: round3(clamp(d === "tidal" ? 0.5 + n * 6 : n, 0.2, 8)) };
  }
  if (values.delaytime) { const n = Number(one("delaytime")); if (Number.isFinite(n)) fx.delay = { ...(fx.delay || {}), time: round3(clamp(n, 0.05, 1)) }; }
  if (values.delayfeedback) { const n = Number(one("delayfeedback")); if (Number.isFinite(n)) fx.delay = { ...(fx.delay || {}), fbk: round3(clamp(n, 0, 0.95)) }; }
  if (values.crush) { const n = Number(one("crush")); if (Number.isFinite(n)) fx.crush = { ...(fx.crush || {}), wet: 1, bits: round3(clamp(n, 1, 16)) }; }
  if (values.coarse) { const n = Number(one("coarse")); if (Number.isFinite(n) && n > 1) fx.crush = { ...(fx.crush || {}), wet: 1, rate: round3(CRUSH_RATE.from(48000 / n)) }; }
  if (values.phaser) { const n = Number(one("phaser")); if (Number.isFinite(n)) fx.phaser = { wet: 0.5, rate: round3(clamp(n / 10, 0, 1)) }; }
  if (values.lpenv) { const n = Number(one("lpenv")); if (Number.isFinite(n)) filter.env = round3(clamp(Math.abs(n) / 8, 0, 1)); }
  if (constantGain != null && Math.abs(constantGain - 1) > 1e-6) params.vol = round3(clamp(0.8 * constantGain, 0, 1));
  // signals -> LFOs, the slider parked at the middle of the range
  for (const [k0, s] of Object.entries(mods)) {
    const k = canon(k0);
    const tgt = targets[k];
    if (!tgt) { warn(`a signal on \`${k0}\` has no equivalent here and was left out`); continue; }
    const lo = tgt.knob(s.lo), hi = tgt.knob(s.hi);
    const base = (lo + hi) / 2;
    const shape = { sine: "sine", cosine: "sine", tri: "triangle", triangle: "triangle", saw: "sawtooth", sawtooth: "sawtooth", isaw: "sawtooth", square: "square", rand: "randsq", perlin: "randsq" }[s.shape] || "sine";
    lfos.push({
      target: tgt.lfo, shape, amount: round3(Math.min(1, Math.abs(hi - lo))), length: clamp(4 / s.speed, 0.0625, 64),
      phase: s.shape === "cosine" ? 0.25 : undefined, base: round3(base), knob: k,
    });
    if (k === "lpf" || k === "hpf" || k === "bpf") { filter.cutoff = round3(base); filter.type ||= { lpf: "lowpass", hpf: "highpass", bpf: "bandpass" }[k]; }
    else if (k === "lpq") filter.reson = round3(base);
    else if (k === "room") fx.reverb = { ...(fx.reverb || {}), wet: round3(base) };
    else if (k === "delay") fx.delay = { ...(fx.delay || {}), wet: round3(base) };
    else if (k === "shape") fx.shaper = { wet: 1, amount: round3(base), mode: "saturate" };
    else if (k === "distort") fx.fuzz = { amount: round3(base) };
    else if (k === "gain") params.vol = round3(base);
    if (lanes[tgt.lane]) delete lanes[tgt.lane];
  }
  return { filter, fx, params, lanes, lfos };
}

// ---- writing into a song -----------------------------------------------------------

/**
 * Put the tracks read from code into `song` (a songBuilder song -- a studio
 * session through `fromBlob` works). A track is found by NAME: the one of that
 * name is rewritten (its active pattern, its grid, and only the settings the
 * code named -- a knob moved by hand afterwards and not mentioned in the code
 * stays where it was); a new name is a new track; a name the code made LAST
 * time and no longer mentions (`previous`) is removed. Tracks the code never
 * made are left alone.
 * @returns {{ names: string[], made: string[], changed: string[], removed: string[], warnings: string[], bpm: number|null }}
 */
export function writeTracks(song, realized, { previous = [], pattern } = {}) {
  const pIdx = pattern ?? song.activePattern ?? 0;
  const warnings = [...realized.warnings];
  if (realized.bpm != null) setTempo(song, { bpm: clamp(realized.bpm, 20, 300) });
  const made = [], changed = [], names = [];
  for (const bp of realized.tracks) {
    names.push(bp.name);
    let i = song.tracks.findIndex(t => t.name === bp.name);
    if (bp.empty) { if (i >= 0) { song.tracks[i].muted = true; changed.push(bp.name); } continue; }
    const engineKey = bp.engine;
    const sameVoice = i >= 0 && song.tracks[i].engineKey === engineKey
      && (engineKey !== "sampler" || song.tracks[i].sampleSource?.id === bp.sample);
    if (i < 0 || !sameVoice) {
      const added = addTrack(song, { engine: engineKey, name: bp.name, length: bp.length, sample: bp.sample, drumKit: bp.drum });
      if (i >= 0) {
        // same name, another instrument: replace it in place, keeping its routing
        const fresh = song.tracks.pop();
        fresh.outIndex = song.tracks[i].outIndex ?? -1;
        fresh.compSourceIndex = song.tracks[i].compSourceIndex ?? -1;
        song.tracks[i] = fresh;
        changed.push(bp.name);
      } else { i = added.index; made.push(bp.name); }
    } else changed.push(bp.name);
    const t = song.tracks[i];
    if (t.euclid?.on) t.euclid.on = false;
    if (t.chance?.on) t.chance.on = false;
    setTrack(song, i, { length: bp.length, speed: bp.speed, mute: !!bp.muted });
    t.patterns[pIdx] = bp.pattern;
    if (!t.patterns[pIdx].automation) t.patterns[pIdx].automation = {};
    // the lanes and LFOs the code describes replace the ones it described before
    for (const k of Object.keys(t.patterns[pIdx].automation)) delete t.patterns[pIdx].automation[k];
    try {
      if (Object.keys(bp.filter).length) setFilter(song, i, bp.filter);
      for (const [stage, cfg] of Object.entries(bp.fx)) setFx(song, i, stage, cfg);
      if (Object.keys(bp.params).length) setParams(song, i, bp.params);
      for (const k of Object.keys(t.lfoConfig || {})) if (t.lfoConfig[k]?.fromCode) delete t.lfoConfig[k];
      for (const l of bp.lfos) {
        try {
          addLfo(song, i, { target: l.target, shape: l.shape, amount: l.amount, length: l.length, bipolar: true, phase: l.phase });
          t.lfoConfig[l.target].fromCode = true;
        } catch (e) { warnings.push(`${bp.name}: ${e.message}`); }
      }
      for (const [target, vals] of Object.entries(bp.lanes)) {
        try { setAutomation(song, i, { pattern: pIdx, target, values: vals }); }
        catch (e) { warnings.push(`${bp.name}: ${e.message}`); }
      }
    } catch (e) { warnings.push(`${bp.name}: ${e.message}`); }
    // make sure every other pattern has the track's length (setTrack resized those that exist)
    patternOf(t, pIdx);
  }
  const removed = [];
  for (const name of previous) {
    if (names.includes(name)) continue;
    const i = song.tracks.findIndex(t => t.name === name);
    if (i >= 0) { removeTrack(song, i); removed.push(name); }
  }
  return { names, made, changed, removed, warnings, bpm: realized.bpm };
}

/** Code straight to a fresh song (the MCP tool's and the tests' way in). */
export function codeToSong(code, opts = {}) {
  const read = readCode(code, opts);
  const r = realize(read);
  const song = newSong({ bpm: r.bpm ?? 120 });
  const res = writeTracks(song, r);
  return { song, ...res, dialect: r.dialect, tracks: r.tracks };
}

// ---- a song written out as code --------------------------------------------------------

const DRUM_EXPORT = {
  "dm:808-kick": ["bd", "RolandTR808"], "dm:808-snare": ["sd", "RolandTR808"], "dm:808-chat": ["hh", "RolandTR808"],
  "dm:808-ohat": ["oh", "RolandTR808"], "dm:808-clap": ["cp", "RolandTR808"], "dm:808-cowbell": ["cb", "RolandTR808"],
  "dm:909-kick": ["bd", "RolandTR909"], "dm:909-snare": ["sd", "RolandTR909"], "dm:909-chat": ["hh", "RolandTR909"],
  "dm:909-ohat": ["oh", "RolandTR909"], "dm:909-clap": ["cp", "RolandTR909"],
  "plaits:13": ["bd", null], "plaits:14": ["sd", null], "plaits:15": ["hh", null],
};
const SAMPLE_BANK = { CR78: "RolandCompurhythm78", R8: "RolandR8" };
function soundForTrack(t) {
  if (DRUM_EXPORT[t.engineKey]) { const [s, bank] = DRUM_EXPORT[t.engineKey]; return { s, bank, drum: true }; }
  if (t.engineKey === "sampler" && t.sampleSource?.kind === "bundled") {
    const [kit, part] = String(t.sampleSource.id).split("/");
    const s = /kick/.test(part) ? "bd" : /snare/.test(part) ? "sd" : /tom/.test(part) ? "lt" : "hh";
    return { s, bank: SAMPLE_BANK[kit] || null, drum: true };
  }
  if (EXPORT_SOUND[t.engineKey]) return { s: EXPORT_SOUND[t.engineKey], drum: false };
  if (t.engineKey === "plaits:9") return { s: "white", drum: false };
  if (String(t.engineKey).startsWith("plaits:")) return { s: "triangle", drum: false };
  return { s: "triangle", drum: false, approx: true };
}

/**
 * The active pattern of every track, as Strudel (default) or Tidal code.
 * Buses, MIDI tracks and live generators say so in a comment rather than
 * vanishing. Returns `{ code, warnings }`.
 */
export function sessionToCode(session, { dialect = "strudel" } = {}) {
  const tidal = dialect === "tidal";
  const s = session || {};
  const warnings = [];
  const pIdx = s.activePattern ?? 0;
  const lines = [];
  const bpm = Number(s.bpm) || 120;
  lines.push(tidal ? `setcps (${round3(bpm)}/60/4)` : `setcpm(${round3(bpm)}/4)`);
  lines.push("");
  let dn = 1;
  const used = new Set();
  for (const [ti, t] of (s.tracks || []).entries()) {
    if (t.engineKey === "bus") { lines.push(`${tidal ? "--" : "//"} ${t.name}: an fx bus, which has no notes to write`); continue; }
    if (t.engineKey === "midi") { lines.push(`${tidal ? "--" : "//"} ${t.name}: a midi out track, left out`); continue; }
    const pat = t.patterns?.[pIdx];
    if (!pat || !pat.steps?.some(Boolean)) {
      if (t.euclid?.on || t.chance?.on) lines.push(`${tidal ? "--" : "//"} ${t.name}: its rhythm is a live ${t.euclid?.on ? "euclid ring" : "chance generator"}, which does not export`);
      continue;
    }
    const snd = soundForTrack(t);
    if (tidal && snd.drum) {
      // Tidal has no banks; Dirt-Samples names its machines in the sound instead
      const m = snd.bank === "RolandTR909" ? "909" : snd.bank === "RolandTR808" ? "808" : null;
      if (m === "808") snd.s = { bd: "808bd", sd: "808sd", hh: "808hc", oh: "808oh" }[snd.s] || snd.s;
      if (m === "909") { snd.s = `909${snd.s}`; if (!warnings.some(w => /909/.test(w))) warnings.push("909 voices are written 909bd, 909sd ...; Dirt-Samples has only a 909 kick, so load a 909 kit under those names to hear them in Tidal"); }
    }
    if (snd.approx) warnings.push(`${t.name} (${t.engineKey}) has no Strudel sound; written as a triangle`);
    const L = pat.steps.length || t.length || 16;
    const speed = Number(t.speed) || 1;
    const melodic = !snd.drum;
    const noteAt = (i) => {
      const root = pat.notes?.[i];
      const r = root ?? (melodic ? (staticEngineByKey(t.engineKey)?.defaultNote ?? 60) : null);
      if (r == null) return null;
      let notes = [r];
      const chord = pat.chords?.[i];
      if (chord && CHORD_TYPES[chord]) notes = CHORD_TYPES[chord].map(x => r + x);
      if (pat.extraNotes?.[i]) notes = notes.concat(pat.extraNotes[i]);
      return notes;
    };
    const tokens = [];
    const vels = [];
    let anyVel = false;
    for (let i = 0; i < L;) {
      if (!pat.steps[i]) { tokens.push("~"); vels.push("~"); i++; continue; }
      let next = i + 1;
      while (next < L && !pat.steps[next]) next++;
      const len = melodic ? Math.max(1, Math.min(Number(pat.lengths?.[i]) || 1, next - i)) : 1;
      let tok;
      if (melodic) {
        const ns = noteAt(i);
        tok = ns.length > 1 ? `[${ns.map(n => midiName(n, dialect)).join(",")}]` : midiName(ns[0], dialect);
      } else tok = snd.s;
      const r = pat.ratchets?.[i] || 1;
      if (r > 1) tok = `${tok}*${r}`;
      tokens.push(len > 1 ? `${tok}@${len}` : tok);
      const v = Number(pat.velocities?.[i] ?? 0.8);
      if (Math.abs(v - 0.8) > 0.02) anyVel = true;
      vels.push(round3(v / 0.8));
      for (let k = 1; k < len; k++) vels.push("~");
      for (let k = i + len; k < next; k++) { tokens.push("~"); vels.push("~"); }
      i = next;
    }
    const cycles = L / (STEPS_PER_BAR * speed);
    const grouped = groupTokens(tokens, STEPS_PER_BAR * speed);
    let label = trackNameOf(t.name).replace(/[^\w]/g, "_").replace(/^(\d)/, "_$1") || `t${ti}`;
    while (used.has(label)) label += "_";
    used.add(label);
    const slow = Math.abs(cycles - 1) > 1e-6 ? round3(cycles) : null;
    const nudged = (pat.offsets || []).some((o, i) => pat.steps[i] && Math.abs(o) > 0.01);
    if (nudged) warnings.push(`${t.name} has nudged steps; the code puts them on the grid`);
    const f = { ...{ type: "lowpass", cutoff: 1, reson: 0 }, ...(t.filter || {}) };
    const fx = t.fxConfig || {};
    const vol = t.params?.vol;
    const ctl = [];
    if (f.cutoff < 0.999) {
      const hz = knobToHz(f.cutoff);
      ctl.push([f.type === "highpass" ? "hpf" : f.type === "bandpass" ? "bpf" : "lpf", hz]);
    }
    if (f.reson > 0.001) ctl.push([tidal ? "resonance" : "lpq", round3(tidal ? f.reson : f.reson * 20)]);
    if (vol != null && Math.abs(vol - 0.8) > 0.01) ctl.push(["gain", round3(vol / 0.8)]);
    if (fx.reverb?.wet > 0) { ctl.push(["room", round3(fx.reverb.wet)]); if (fx.reverb.decay != null) ctl.push([tidal ? "size" : "size", round3(tidal ? clamp((fx.reverb.decay - 0.5) / 6, 0, 1) : fx.reverb.decay)]); }
    if (fx.delay?.wet > 0) { ctl.push(["delay", round3(fx.delay.wet)]); if (fx.delay.time != null) ctl.push(["delaytime", round3(fx.delay.time)]); if (fx.delay.fbk != null) ctl.push(["delayfeedback", round3(fx.delay.fbk)]); }
    if (fx.crush?.wet > 0) ctl.push(["crush", round3(fx.crush.bits ?? 8)]);
    if (fx.shaper?.wet > 0) ctl.push(["shape", round3(fx.shaper.amount ?? 0.5)]);
    if (fx.fuzz?.amount > 0) ctl.push(["distort", round3((fx.fuzz.amount ?? 0) * 2)]);
    // LFOs on the controls that have a name in both languages come back out as signals
    const lfoOut = [];
    for (const [key, l] of Object.entries(t.lfoConfig || {})) {
      const spec = LFO_EXPORT[key];
      if (!l?.enabled || !spec || !l.sync) continue;
      const knob = spec.knobOf(t);
      const depth = Number(l.depth) || 0;
      const bip = l.bipolar ?? l.type !== "euclid";
      const lo = clamp(bip ? knob - depth / 2 : knob, 0, 1), hi = clamp(bip ? knob + depth / 2 : knob + depth, 0, 1);
      const shape = { sine: "sine", triangle: "tri", sawtooth: "saw", square: "square", randsq: "rand" }[l.type];
      if (!shape) continue;
      const name = spec.name(t, tidal);
      const cyc = round3((Number(l.div) || 4) / 4);
      const a = round3(spec.units(lo, tidal)), b = round3(spec.units(hi, tidal));
      const expr = tidal
        ? `(${cyc !== 1 ? `slow ${cyc} $ ` : ""}range ${a} ${b} ${shape})`
        : `${shape}.range(${a}, ${b})${cyc !== 1 ? `.slow(${cyc})` : ""}`;
      for (let k = ctl.length - 1; k >= 0; k--) if (ctl[k][0] === name) ctl.splice(k, 1);
      lfoOut.push([name, expr]);
    }
    ctl.push(...lfoOut);
    const muted = !!t.muted;
    if (tidal) {
      const main = melodic ? `note "${grouped}" # s "${snd.s}"` : `s "${grouped}"`;
      let line = `d${dn++} $ ${slow ? `slow ${slow} $ ` : ""}${main}`;
      if (anyVel) line += ` # gain "${groupTokens(vels, STEPS_PER_BAR * speed)}"`;
      for (const [k, v] of ctl) line += ` # ${k} ${v}`;
      lines.push(`${muted ? "-- " : ""}-- ${t.name}`);
      lines.push(muted ? `-- ${line}` : line);
    } else {
      let line = `${muted ? "_" : ""}${label}: ${melodic ? `note("${grouped}").s("${snd.s}")` : `s("${grouped}")`}`;
      if (snd.bank) line += `.bank("${snd.bank}")`;
      if (slow) line += `.slow(${slow})`;
      if (anyVel) line += `\n  .velocity("${groupTokens(vels, STEPS_PER_BAR * speed)}")`;
      for (const [k, v] of ctl) line += `.${k}(${v})`;
      lines.push(line);
    }
    lines.push("");
  }
  return { code: lines.join("\n").replace(/\n+$/, "\n"), warnings };
}
const LFO_EXPORT = {
  cutoff: { knobOf: (t) => t.filter?.cutoff ?? 1, units: (u) => knobToHz(u),
    name: (t) => t.filter?.type === "highpass" ? "hpf" : t.filter?.type === "bandpass" ? "bpf" : "lpf" },
  reson: { knobOf: (t) => t.filter?.reson ?? 0, units: (u, tidal) => tidal ? u : u * 20, name: (t, tidal) => tidal ? "resonance" : "lpq" },
  verb: { knobOf: (t) => t.fxConfig?.reverb?.wet ?? 0, units: (u) => u, name: () => "room" },
  delay: { knobOf: (t) => t.fxConfig?.delay?.wet ?? 0, units: (u) => u, name: () => "delay" },
  vol: { knobOf: (t) => t.params?.vol ?? 0.8, units: (u) => u / 0.8, name: () => "gain" },
};

/** Tokens into bars and beats: `[bd ~ ~ ~] [sd ~ ~ ~]`, bars as `<...>` would change meaning, so
 *  bars are just spaced wider. `@` weights count toward the beat they start in. */
function groupTokens(tokens, perCycle) {
  const beat = perCycle % 4 === 0 ? perCycle / 4 : perCycle;
  const out = [];
  let pos = 0, cur = [];
  const flush = () => { if (cur.length) out.push(cur.join(" ")); cur = []; };
  for (const tok of tokens) {
    cur.push(tok);
    const w = Number(/@(\d+)$/.exec(tok)?.[1] || 1);
    pos += w;
    if (pos % beat === 0) flush();
    if (pos % perCycle === 0) out.push("|BAR|");
  }
  flush();
  return out.join("  ").replace(/\s*\|BAR\|\s*/g, "   ").trim();
}

/** A strudel.cc link that opens with this code in the editor. */
export function strudelUrl(code) {
  const bytes = new TextEncoder().encode(String(code));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return `https://strudel.cc/#${encodeURIComponent(b64)}`;
}
