// voxPhonetic.js — English words respelled as syllables the vox can sing.
//
// The lyric field reads a chunk as one sung syllable: a consonant, a vowel
// (u o a e i, or a glide from one to another), and a consonant after. English
// spelling is nothing like that ("night" read that way is "nig"), so with the
// panel's `phonetic` box ticked the lyric goes through here first:
//
//   words ─▶ CMUdict (ARPAbet) ─┬─▶ syllables ─▶ vox spelling ("nait", "he-lou")
//            or, not in it,     │
//            letter-to-sound ───┘
//
// - **The dictionary is fetched only when the box is ticked** (`loadVoxDict`):
//   ~125k words, about 1.7MB as text, compressed on the wire. Until it lands,
//   and for any word it lacks, the letter-to-sound rules below stand in.
// - **One syllable is one note**, so a word comes back as its syllables joined
//   by hyphens, and voxSyllables splits them again.
// - **The vox has five vowels and eighteen consonants**: every English vowel
//   folds onto the nearest (or a glide: AY eye "ai", EY day "ei", OW go "ou",
//   AW now "au", OY boy "oi"), ER is an e with an r after it, a consonant
//   cluster keeps its strongest sound ("str" is s, "pl" is p), and a syllable
//   keeps one consonant after its vowel.
//
// No imports and no DOM, so `node --test` runs it (test/voxPhonetic.test.js).
// The dictionary is public/js/data/cmudict.txt, built by
// scripts/make-vox-dict.mjs from CMUdict (BSD, its notice is in the file).

// ARPAbet, one character a phone, as the dictionary file stores it.
export const ARPA_CODE = {
  AA: "a", AE: "@", AH: "^", AO: "c", AW: "W", AY: "Y", EH: "E", ER: "R", EY: "e",
  IH: "I", IY: "i", OW: "o", OY: "O", UH: "U", UW: "u",
  B: "b", CH: "C", D: "d", DH: "D", F: "f", G: "g", HH: "h", JH: "J", K: "k",
  L: "l", M: "m", N: "n", NG: "N", P: "p", R: "r", S: "s", SH: "S", T: "t",
  TH: "T", V: "v", W: "w", Y: "y", Z: "z", ZH: "Z",
};
const CODE_ARPA = Object.fromEntries(Object.entries(ARPA_CODE).map(([k, v]) => [v, k]));

// What each phone is sung as.
const VOWEL = {
  AA: "a", AE: "a", AH: "a", AO: "o", AW: "au", AY: "ai", EH: "e", ER: "e",
  EY: "ei", IH: "i", IY: "i", OW: "ou", OY: "oi", UH: "u", UW: "u",
};
const CONS = {
  B: "b", CH: "sh", D: "d", DH: "d", F: "f", G: "g", HH: "h", JH: "d", K: "k",
  L: "l", M: "m", N: "n", NG: "n", P: "p", R: "r", S: "s", SH: "sh", T: "t",
  TH: "f", V: "v", W: "w", Y: "y", Z: "z", ZH: "z",
};
const isVowel = (p) => p in VOWEL;

// The one consonant an onset cluster keeps: its first, which is the burst or
// the hiss ("str" is s, "pl" p, "tr" t, "by" b).
function onsetOf(cl) {
  if (!cl.length) return "";
  return CONS[cl[0]];
}
// The one consonant a coda keeps: the first that can be sung after a vowel.
function codaOf(cl) {
  for (const p of cl) if (p !== "HH" && p !== "W" && p !== "Y") return CONS[p];
  return "";
}

/**
 * Phones (ARPAbet, stress digits allowed) as vox syllables, e.g.
 * ["N","AY1","T"] -> ["nait"]. Between two vowels a single consonant starts
 * the next syllable; of two or more, the first ends this one and the rest
 * start the next.
 * @param {string[]} phones
 * @returns {string[]}
 */
export function phonesToVox(phones) {
  const ph = phones.map(p => String(p).toUpperCase().replace(/\d/g, "")).filter(p => p in ARPA_CODE);
  const nuclei = [];
  ph.forEach((p, i) => { if (isVowel(p)) nuclei.push(i); });
  if (!nuclei.length) return [];
  const syl = nuclei.map(i => ({ on: [], v: ph[i], co: [] }));
  syl[0].on = ph.slice(0, nuclei[0]);
  for (let n = 0; n < nuclei.length - 1; n++) {
    const cl = ph.slice(nuclei[n] + 1, nuclei[n + 1]);
    if (cl.length === 1 && cl[0] !== "NG") syl[n + 1].on = cl;
    else if (cl.length) { syl[n].co = [cl[0]]; syl[n + 1].on = cl.slice(1); }
  }
  syl[syl.length - 1].co = ph.slice(nuclei[nuclei.length - 1] + 1);
  return syl.map(({ on, v, co }) => {
    // ER is an r-coloured e: the r is its coda, whatever follows
    const coda = v === "ER" ? "r" : codaOf(co);
    return onsetOf(on) + VOWEL[v] + coda;
  });
}

// ---- letter-to-sound, for words the dictionary does not have --------------
// A small rule set in the spirit of the old speech chips' (NRL, 1976): enough
// for a made-up word or a name to come out singable, not to pass a spelling
// bee. Longest match first, left to right.
const V_LETTERS = "aeiouy";
const isV = (c) => c !== undefined && "aeiou".includes(c);
const RULES = [
  ["tion", ["SH", "AH", "N"]], ["sion", ["SH", "AH", "N"]],
  ["eigh", ["EY"]], ["ough", ["AO"]], ["igh", ["AY"]], ["tch", ["CH"]],
  ["ch", ["CH"]], ["sh", ["SH"]], ["th", ["TH"]], ["ph", ["F"]], ["wh", ["W"]],
  ["ck", ["K"]], ["ng", ["NG"]], ["qu", ["K", "W"]], ["gh", []],
  ["ee", ["IY"]], ["ea", ["IY"]], ["oo", ["UW"]], ["ou", ["AW"]],
  ["ai", ["EY"]], ["ay", ["EY"]], ["ei", ["EY"]], ["ey", ["EY"]],
  ["oa", ["OW"]], ["oi", ["OY"]], ["oy", ["OY"]], ["au", ["AO"]], ["aw", ["AO"]],
  ["ue", ["UW"]], ["ew", ["UW"]],
  ["ar", ["AA", "R"]], ["or", ["AO", "R"]], ["er", ["ER"]], ["ir", ["ER"]], ["ur", ["ER"]],
];
const SHORT = { a: ["AE"], e: ["EH"], i: ["IH"], o: ["AA"], u: ["AH"] };
const LONG = { a: ["EY"], e: ["IY"], i: ["AY"], o: ["OW"], u: ["UW"] };
const PLAIN = {
  b: "B", d: "D", f: "F", h: "HH", j: "JH", k: "K", l: "L", m: "M", n: "N", p: "P",
  q: "K", r: "R", s: "S", t: "T", v: "V", w: "W", z: "Z",
};

/**
 * Guess a word's phones from its letters.
 * @param {string} word lowercase a-z
 * @returns {string[]}
 */
export function letterToSound(word) {
  const w = word.replace(/[^a-z]/g, "");
  const out = [];
  const vowelsIn = [...w].filter(c => V_LETTERS.includes(c)).length;
  let i = 0;
  if (w.startsWith("kn") || w.startsWith("wr")) i = 1;
  while (i < w.length) {
    const c = w[i], rest = w.slice(i);
    const atEnd = i === w.length - 1;
    // "ow" at the end is go, elsewhere now
    if (rest.startsWith("ow")) { out.push(i + 2 === w.length ? "OW" : "AW"); i += 2; continue; }
    // a final -le after a consonant: little, table
    if (rest === "le" && i > 0 && !isV(w[i - 1])) { out.push("AH", "L"); break; }
    const rule = RULES.find(([g]) => rest.startsWith(g));
    if (rule) { out.push(...rule[1]); i += rule[0].length; continue; }
    if (isV(c)) {
      // a final e is silent when the word has another vowel
      if (c === "e" && atEnd) { if (vowelsIn === 1) out.push("IY"); break; }
      // vowel, one consonant, final e: the long vowel (make, time, home)
      const magic = !isV(w[i + 1]) && w[i + 1] !== undefined && w[i + 2] === "e" && i + 3 === w.length;
      // a vowel ending a short word is long too (go, hi, be)
      const open = atEnd && vowelsIn === 1;
      out.push(...(magic || open ? LONG[c] : SHORT[c]));
      i++; continue;
    }
    if (c === "y") {
      if (i === 0) out.push("Y");
      else if (atEnd) out.push(vowelsIn === 1 ? "AY" : "IY");
      else out.push("IH");
      i++; continue;
    }
    if (c === "x") { out.push("K", "S"); i++; continue; }
    if (c === "c") { out.push("eiy".includes(w[i + 1]) ? "S" : "K"); i++; continue; }
    if (c === "g") { out.push(w[i + 1] === "e" && i + 2 === w.length ? "JH" : "G"); i++; continue; }
    // a doubled consonant is one sound
    if (w[i + 1] === c) { i++; continue; }
    if (PLAIN[c]) out.push(PLAIN[c]);
    i++;
  }
  return out;
}

// ---- the dictionary ---------------------------------------------------------

/**
 * Read the dictionary file: `word code` a line, `#` lines a header.
 * @param {string} text
 * @returns {Map<string, string>} word -> phone codes
 */
export function parseVoxDict(text) {
  const map = new Map();
  for (const line of String(text).split("\n")) {
    if (!line || line[0] === "#") continue;
    const sp = line.indexOf(" ");
    if (sp > 0) map.set(line.slice(0, sp), line.slice(sp + 1).trim());
  }
  return map;
}

/** A dictionary code string as ARPAbet phones. */
export function codeToPhones(code) {
  return [...code].map(c => CODE_ARPA[c]).filter(Boolean);
}

let dict = null, loading = null;

/** Whether the dictionary has arrived. */
export function voxDictReady() { return !!dict; }

/**
 * Fetch the dictionary, once. Resolves to it, or to null if it could not be
 * had (the rules then do every word).
 * @returns {Promise<Map<string, string>|null>}
 */
export function loadVoxDict() {
  if (dict) return Promise.resolve(dict);
  if (!loading) {
    loading = fetch(new URL("./data/cmudict.txt", import.meta.url))
      .then(r => { if (!r.ok) throw new Error(`cmudict ${r.status}`); return r.text(); })
      .then(t => (dict = parseVoxDict(t)))
      .catch(e => { console.warn("vox dictionary failed", e); loading = null; return null; });
  }
  return loading;
}

/**
 * A lyric respelled for the vox: each word as its syllables, hyphen-joined,
 * words space-separated. A word with no vowel letter at all is left as it is,
 * so a hum (`mmm`) still hums.
 * @param {string} text
 * @param {Map<string, string>|null} [d] the dictionary; the loaded one by default
 * @returns {string}
 */
export function voxRespell(text, d = dict) {
  const words = String(text || "").toLowerCase().replace(/[^a-z'\s,-]/g, " ").split(/[\s,-]+/);
  const out = [];
  for (const raw of words) {
    const w = raw.replace(/'/g, "");
    if (!w) continue;
    if (![...w].some(c => V_LETTERS.includes(c))) { out.push(w); continue; }
    const code = d?.get(w) ?? d?.get(raw);
    const phones = code ? codeToPhones(code) : letterToSound(w);
    const syl = phonesToVox(phones);
    out.push(syl.length ? syl.join("-") : w);
  }
  return out.join(" ");
}
