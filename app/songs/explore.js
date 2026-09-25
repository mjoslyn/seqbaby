// The songs explorer's logic (/songs): what an engine key is called as an
// instrument, and which songs a search, a bpm range and a set of instruments
// leave, in what order. The page loads a window of published songs once
// (explore.ts) and all of this runs in the browser, so a knob turn is a
// re-render, not a round trip.
//
// Pure, for songName.js's reason: `node --test` pins it (test/explore.test.js).
// Its one import is rank.js, pure as well, so the explorer's "on repeat" order
// is the homepage's own.

import { hotScore } from "../home/rank.js";

/** The emulator rename (sessionFormat.js `LEGACY_ENGINE_KEYS`). A song saved
 *  before it still says `dm:303` in the database, and it is a silverbox. The
 *  test holds this copy to the engine's. */
export const LEGACY_ENGINE_KEYS = {
  "dm:303": "dm:silverbox",
  "dm:virus": "dm:contagion",
  "dm:dx7": "dm:hexop",
  "dm:mini-brute": "dm:snarl",
  "dm:moog": "dm:ladder",
  "dm:juno": "dm:drift",
  "dm:rhodes": "dm:tines",
  "dm:prophet6": "dm:oracle",
};

const NAMED = {
  "dm:guitar": "guitar",
  "dm:bass": "bass",
  "dm:sub": "subby",
  "dm:granular": "granular",
  "dm:poly-saw": "poly saw",
  "dm:fm-bell": "fm bell",
  sampler: "sampler",
  upload: "sampler",
  eleven: "sampler",
  midi: "midi",
  custom: "tone synth",
};

/**
 * The instrument an engine key is, as a person would say it: every Plaits
 * model is `plaits`, every 808 voice is `808`, a legacy name is its new one.
 * Null for what is not an instrument (a bus, nothing).
 * @param {unknown} key @returns {string | null}
 */
export function instrumentOf(key) {
  let k = typeof key === "string" ? key.trim() : "";
  if (!k || k === "bus") return null;
  k = LEGACY_ENGINE_KEYS[k] || k;
  if (NAMED[k]) return NAMED[k];
  if (k.startsWith("plaits")) return "plaits";
  if (k.startsWith("wt:")) return "wavetable";
  if (k.startsWith("smp:")) return "sampler";
  if (k.startsWith("saved:")) return "tone synth";
  const drum = /^dm:(808|909)-/.exec(k);
  if (drum) return drum[1];
  return k.replace(/^dm:/, "").replace(/-/g, " ").toLowerCase().slice(0, 24) || null;
}

/** A song's instruments from its engine keys: distinct, sorted.
 *  @param {unknown} keys @returns {string[]} */
export function instrumentsOf(keys) {
  const out = new Set();
  for (const k of Array.isArray(keys) ? keys : []) {
    const name = instrumentOf(k);
    if (name) out.add(name);
  }
  return [...out].sort();
}

/** @typedef {{ handle?: string | null, name?: string | null } | string | null} Owner */
/** @typedef {{ id: string, title: string, owner?: Owner, bpm: number | null, likes: number, updatedAt: string, instruments: string[] }} ExploreSong */
/** @typedef {"hot" | "new" | "liked" | "bpm-up" | "bpm-down" | "title"} SortKey */
/** @typedef {{ q: string, sort: SortKey, min: number | null, max: number | null, with: string[] }} Query */

export const SORTS = /** @type {const} */ ([
  ["hot", "on repeat"],
  ["new", "newest"],
  ["liked", "most liked"],
  ["bpm-up", "slowest"],
  ["bpm-down", "fastest"],
  ["title", "a to z"],
]);

/** Tempo bands to click instead of typing two numbers. `null` is open-ended. */
export const BPM_BANDS = /** @type {const} */ ([
  ["slow", null, 89],
  ["90s", 90, 109],
  ["house", 110, 129],
  ["techno", 130, 149],
  ["fast", 150, null],
]);

/** @type {Query} */
export const EMPTY_QUERY = { q: "", sort: "hot", min: null, max: null, with: [] };

const SORT_KEYS = new Set(SORTS.map(([k]) => k));

/** Lower-case words, for a search that ignores case and word order. */
const words = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether a song passes everything but, optionally, one instrument (the
 * chips' counts ask "how many would there be if I also picked this one").
 * Every search word has to appear somewhere in the title, the owner's name or
 * an instrument; every picked instrument has to be in the song; a bpm bound
 * leaves out a song with no bpm, since it cannot be said to be inside it.
 * @param {ExploreSong} song @param {Query} query
 */
export function matches(song, query) {
  const o = song.owner;
  const who = typeof o === "string" ? o : o ? `${o.handle ?? ""} ${o.name ?? ""}` : "";
  const hay = `${song.title} ${who} ${song.instruments.join(" ")}`.toLowerCase();
  for (const w of words(query.q)) if (!hay.includes(w.replace(/^@/, ""))) return false;
  if (query.min != null || query.max != null) {
    if (song.bpm == null) return false;
    if (query.min != null && song.bpm < query.min) return false;
    if (query.max != null && song.bpm > query.max) return false;
  }
  for (const i of query.with) if (!song.instruments.includes(i)) return false;
  return true;
}

const time = (iso) => Date.parse(iso) || 0;

/**
 * The songs a query leaves, in its order. Ties go to the newer song. A song
 * with no bpm sorts after every song with one, whichever way bpm is sorted.
 * @template {ExploreSong} T @param {T[]} songs @param {Query} query @param {number} now @returns {T[]}
 */
export function explore(songs, query, now = Date.now()) {
  const kept = songs.filter((s) => matches(s, query));
  const newer = (a, b) => time(b.updatedAt) - time(a.updatedAt);
  const bpm = (dir) => (a, b) =>
    a.bpm == null ? (b.bpm == null ? 0 : 1) : b.bpm == null ? -1 : dir * (a.bpm - b.bpm);
  /** @type {Record<SortKey, (a: T, b: T) => number>} */
  const by = {
    hot: (a, b) => hotScore(b.likes, b.updatedAt, now) - hotScore(a.likes, a.updatedAt, now),
    new: () => 0,
    liked: (a, b) => b.likes - a.likes,
    "bpm-up": bpm(1),
    "bpm-down": bpm(-1),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  const cmp = by[query.sort] || by.hot;
  return kept.sort((a, b) => cmp(a, b) || newer(a, b));
}

/**
 * Every instrument in the catalog with how many songs the query would leave
 * if it were picked too, most common first. A picked instrument is always
 * listed, even at zero, so it can be unpicked.
 * @param {ExploreSong[]} songs @param {Query} query @returns {{ name: string, count: number }[]}
 */
export function instrumentCounts(songs, query) {
  const counts = new Map();
  for (const s of songs) for (const i of s.instruments) if (!counts.has(i)) counts.set(i, 0);
  for (const i of query.with) if (!counts.has(i)) counts.set(i, 0);
  for (const s of songs) {
    if (!matches(s, query)) continue;
    for (const i of s.instruments) counts.set(i, counts.get(i) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const bound = (v) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
};

/**
 * A query from a URL's search string: `?q=acid&sort=new&bpm=120-135&with=silverbox,808`.
 * Anything unreadable is left at its default, never thrown on.
 * @param {string} search @returns {Query}
 */
export function parseQuery(search) {
  const p = new URLSearchParams(search);
  const sort = p.get("sort");
  const [lo, hi] = String(p.get("bpm") || "").split("-");
  const picked = String(p.get("with") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    q: (p.get("q") || "").slice(0, 100),
    sort: sort && SORT_KEYS.has(sort) ? /** @type {SortKey} */ (sort) : "hot",
    min: bound(lo),
    max: bound(hi),
    with: [...new Set(picked)],
  };
}

/** The search string for a query, leaving out whatever is at its default, so
 *  an untouched explorer is a bare `/songs`. @param {Query} query */
export function queryString(query) {
  const p = new URLSearchParams();
  if (query.q.trim()) p.set("q", query.q.trim());
  if (query.sort !== "hot") p.set("sort", query.sort);
  if (query.min != null || query.max != null) p.set("bpm", `${query.min ?? ""}-${query.max ?? ""}`);
  if (query.with.length) p.set("with", query.with.join(","));
  const s = p.toString();
  return s ? `?${s}` : "";
}
