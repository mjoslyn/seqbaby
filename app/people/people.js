// The people explorer's logic (/people): who a search, a tempo band, a set of
// instruments and a "makes" filter leave, in what order. Same bargain as the
// songs explorer (app/songs/explore.js): the page loads everyone once
// (peopleFeed.ts) and all of this runs in the browser.
//
// Pure, for songName.js's reason: `node --test` pins it (test/people.test.js).
// Its imports are pure as well, and the paging and the tempo bands are the
// songs explorer's own, so the two pages page and band the same way.

import { BPM_BANDS, instrumentOf, paginate } from "../songs/explore.js";

export { BPM_BANDS, paginate };

/** @typedef {{ handle: string, bio: string | null, avatarGrid: string | null, songs: number, patches: number, likes: number, latest: string, bpm: number | null, instruments: string[] }} Person */
/** @typedef {"busy" | "recent" | "liked" | "handle"} SortKey */
/** @typedef {"songs" | "patches"} Makes */
/** @typedef {{ q: string, sort: SortKey, min: number | null, max: number | null, with: string[], makes: Makes[], page: number }} Query */

export const SORTS = /** @type {const} */ ([
  ["busy", "busiest"],
  ["recent", "recently active"],
  ["liked", "most liked"],
  ["handle", "a to z"],
]);

export const MAKES = /** @type {const} */ ([
  ["songs", "songs"],
  ["patches", "patches"],
]);

/** @type {Query} */
export const EMPTY_QUERY = { q: "", sort: "busy", min: null, max: null, with: [], makes: [], page: 1 };

const SORT_KEYS = new Set(SORTS.map(([k]) => k));
const MAKES_KEYS = new Set(MAKES.map(([k]) => k));

/**
 * The tempo a person works at: the median of their songs' bpm, so one
 * 174bpm experiment does not make a house producer read as drum and bass.
 * Null when none of their songs carries one.
 * @param {unknown[]} bpms @returns {number | null}
 */
export function medianBpm(bpms) {
  const n = bpms.filter((b) => typeof b === "number" && b > 0).sort((a, b) => a - b);
  if (!n.length) return null;
  const mid = n.length >> 1;
  return Math.round(n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2);
}

/**
 * Everyone who has published something, from their public songs and patches.
 * `songs` rows are `{ owner, bpm, likes, at, engines }`, `patches` rows
 * `{ owner, likes, at, engine }`; `profiles` maps an owner id to the public
 * profile, and an owner with none (a private page, no name) is left out.
 * @param {{ owner: string, bpm?: unknown, likes?: number, at: string, engines?: unknown }[]} songs
 * @param {{ owner: string, likes?: number, at: string, engine?: unknown }[]} patches
 * @param {Map<string, { handle: string, bio: string | null, avatarGrid: string | null }>} profiles
 * @returns {Person[]}
 */
export function gatherPeople(songs, patches, profiles) {
  /** @type {Map<string, { songs: number, patches: number, likes: number, latest: number, bpms: unknown[], instruments: Set<string> }>} */
  const acc = new Map();
  const get = (id) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { songs: 0, patches: 0, likes: 0, latest: 0, bpms: [], instruments: new Set() }));
    return a;
  };
  const likes = (v) => (typeof v === "number" && v > 0 ? v : 0);
  for (const s of songs) {
    if (!profiles.has(s.owner)) continue;
    const a = get(s.owner);
    a.songs++;
    a.likes += likes(s.likes);
    a.latest = Math.max(a.latest, Date.parse(s.at) || 0);
    a.bpms.push(s.bpm);
    for (const k of Array.isArray(s.engines) ? s.engines : []) {
      const i = instrumentOf(k);
      if (i) a.instruments.add(i);
    }
  }
  for (const p of patches) {
    if (!profiles.has(p.owner)) continue;
    const a = get(p.owner);
    a.patches++;
    a.likes += likes(p.likes);
    a.latest = Math.max(a.latest, Date.parse(p.at) || 0);
    const i = instrumentOf(p.engine);
    if (i) a.instruments.add(i);
  }
  return [...acc].map(([id, a]) => {
    const p = /** @type {NonNullable<ReturnType<typeof profiles.get>>} */ (profiles.get(id));
    return {
      handle: p.handle,
      bio: p.bio,
      avatarGrid: p.avatarGrid,
      songs: a.songs,
      patches: a.patches,
      likes: a.likes,
      latest: new Date(a.latest).toISOString(),
      bpm: medianBpm(a.bpms),
      instruments: [...a.instruments].sort(),
    };
  });
}

const words = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether a person passes the query. Every search word has to appear in the
 * handle, the bio or an instrument; every picked instrument has to be one
 * they have used; a tempo bound reads their median bpm and leaves out anyone
 * with none; "makes" keeps only who has published at least one of each kind
 * picked.
 * @param {Person} p @param {Query} query
 */
export function matches(p, query) {
  const hay = `${p.handle} ${p.bio ?? ""} ${p.instruments.join(" ")}`.toLowerCase();
  for (const w of words(query.q)) if (!hay.includes(w.replace(/^@/, ""))) return false;
  if (query.min != null || query.max != null) {
    if (p.bpm == null) return false;
    if (query.min != null && p.bpm < query.min) return false;
    if (query.max != null && p.bpm > query.max) return false;
  }
  for (const i of query.with) if (!p.instruments.includes(i)) return false;
  for (const m of query.makes) if (!(p[m] > 0)) return false;
  return true;
}

const time = (iso) => Date.parse(iso) || 0;

/**
 * The people a query leaves, in its order. Ties go to whoever published most
 * recently, then the handle, so the order never depends on load order.
 * @template {Person} T @param {T[]} people @param {Query} query @returns {T[]}
 */
export function explorePeople(people, query) {
  const kept = people.filter((p) => matches(p, query));
  const recent = (a, b) => time(b.latest) - time(a.latest);
  /** @type {Record<SortKey, (a: T, b: T) => number>} */
  const by = {
    busy: (a, b) => b.songs + b.patches - (a.songs + a.patches),
    recent: () => 0,
    liked: (a, b) => b.likes - a.likes,
    handle: (a, b) => a.handle.localeCompare(b.handle),
  };
  const cmp = by[query.sort] || by.busy;
  return kept.sort((a, b) => cmp(a, b) || recent(a, b) || a.handle.localeCompare(b.handle));
}

/**
 * Every instrument anyone has used, with how many people the query would
 * leave if it were picked too, most common first. A picked instrument is
 * always listed, even at zero, so it can be unpicked.
 * @param {Person[]} people @param {Query} query @returns {{ name: string, count: number }[]}
 */
export function instrumentCounts(people, query) {
  const counts = new Map();
  for (const p of people) for (const i of p.instruments) if (!counts.has(i)) counts.set(i, 0);
  for (const i of query.with) if (!counts.has(i)) counts.set(i, 0);
  for (const p of people) {
    if (!matches(p, query)) continue;
    for (const i of p.instruments) counts.set(i, counts.get(i) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const bound = (v) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
};

const list = (v) => [
  ...new Set(
    String(v || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/**
 * A query from a URL's search string:
 * `?q=acid&sort=liked&bpm=120-135&with=silverbox,808&makes=patches&page=2`.
 * Anything unreadable is left at its default, never thrown on.
 * @param {string} search @returns {Query}
 */
export function parseQuery(search) {
  const p = new URLSearchParams(search);
  const sort = p.get("sort");
  const [lo, hi] = String(p.get("bpm") || "").split("-");
  return {
    q: (p.get("q") || "").slice(0, 100),
    sort: sort && SORT_KEYS.has(sort) ? /** @type {SortKey} */ (sort) : "busy",
    min: bound(lo),
    max: bound(hi),
    with: list(p.get("with")),
    makes: /** @type {Makes[]} */ (list(p.get("makes")).filter((m) => MAKES_KEYS.has(m))),
    page: bound(p.get("page")) ?? 1,
  };
}

/** The search string for a query, leaving out whatever is at its default, so
 *  an untouched explorer is a bare `/people`. @param {Query} query */
export function queryString(query) {
  const p = new URLSearchParams();
  if (query.q.trim()) p.set("q", query.q.trim());
  if (query.sort !== "busy") p.set("sort", query.sort);
  if (query.min != null || query.max != null) p.set("bpm", `${query.min ?? ""}-${query.max ?? ""}`);
  if (query.with.length) p.set("with", query.with.join(","));
  if (query.makes.length) p.set("makes", query.makes.join(","));
  if (query.page > 1) p.set("page", String(query.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
