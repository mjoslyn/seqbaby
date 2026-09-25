// The homepage's order, for songs and patches alike: likes and freshness
// together, in the manner of a news aggregator's front page. Pure, no imports, for songName.js's reason:
// `node --test` pins it (test/rank.test.js).
//
//   score = (likes + 1) / (age in days + 1) ^ GRAVITY
//
// The +1 on likes is what lets a song nobody has heard yet onto the page at
// all: with zero likes it still scores on freshness alone, so a new song leads
// until something older has earned its place. The +1 on the age keeps a song
// published a minute ago from dividing by nothing. GRAVITY decides how fast a
// liked song sinks: at 1.5 a day-old song needs about three times the likes of
// a new one to sit beside it, and a week-old one about twenty-two.
//
// Freshness is `updated_at`, the same clock the card's "3h ago" reads, so a
// song its owner keeps working on stays near the top as it always has.

export const GRAVITY = 1.5;
const DAY = 86400000;

/** @param {number} likes @param {string|number|Date} updatedAt @param {number} now */
export function hotScore(likes, updatedAt, now = Date.now()) {
  const t =
    updatedAt instanceof Date ? updatedAt.getTime() : typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt);
  const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : 365;
  const n = Number.isFinite(likes) && likes > 0 ? likes : 0;
  return (n + 1) / Math.pow(ageDays + 1, GRAVITY);
}

/**
 * Rows of `{ likes, updatedAt }` (anything else rides along), best first.
 * Ties go to the newer song, then keep their incoming order.
 * @template {{ likes?: number|null, updatedAt: string }} T
 * @param {T[]} rows @param {number} now @returns {T[]}
 */
export function rankSongs(rows, now = Date.now()) {
  return rows
    .map((row, i) => ({ row, i, s: hotScore(row.likes ?? 0, row.updatedAt, now), t: Date.parse(row.updatedAt) || 0 }))
    .sort((a, b) => b.s - a.s || b.t - a.t || a.i - b.i)
    .map((e) => e.row);
}
