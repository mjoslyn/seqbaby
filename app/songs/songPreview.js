// A song's step preview, from the compact shape the database computes
// (supabase/migrations/0012_song_preview.sql) to a grid of cells to draw.
//
// No imports, for songName.js's reason: pure, so `node --test` exercises it
// (test/songPreview.test.js), and it is on the render path of the homepage,
// a profile page and the songs menu, where a throw is a page that fails. It
// never throws; anything it cannot read comes back as no preview at all.

/**
 * @typedef {{ v: number, tie?: boolean } | null} PreviewCell  a hit (velocity
 *   0..1), a step held by the hit before it (`tie`), or a rest (null)
 * @typedef {{ cells: PreviewCell[], gen: null | "euclid" | "chance" }} PreviewRow
 * @typedef {{ pattern: number, cols: number, rows: PreviewRow[] }} Preview
 */

const MAX_COLS = 64;

function int(v, lo, hi, dflt) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

// Bjorklund, the same recursion as euclid.js's (which cannot be imported
// here: public/js is kept out of the Next graph, and that module touches the
// DOM). The shortcut `(i*k)%n < k` would land on a rotation of the canonical
// pattern and draw a different ring from the one the studio plays.
export function euclideanRhythm(steps, pulses, rotation = 0) {
  const n = Math.max(1, steps | 0);
  const k = Math.max(0, Math.min(n, pulses | 0));
  let pat;
  if (k === 0) pat = new Array(n).fill(false);
  else if (k === n) pat = new Array(n).fill(true);
  else {
    const counts = [];
    const remainders = [k];
    let divisor = n - k;
    let level = 0;
    for (;;) {
      counts.push(Math.floor(divisor / remainders[level]));
      remainders.push(divisor % remainders[level]);
      divisor = remainders[level];
      level++;
      if (remainders[level] <= 1) break;
    }
    counts.push(divisor);
    const out = [];
    const build = (lvl) => {
      if (lvl === -1) out.push(false);
      else if (lvl === -2) out.push(true);
      else {
        for (let i = 0; i < counts[lvl]; i++) build(lvl - 1);
        if (remainders[lvl] !== 0) build(lvl - 2);
      }
    };
    build(level);
    const first = out.indexOf(true);
    pat = first <= 0 ? out : out.slice(first).concat(out.slice(0, first));
  }
  const r = ((rotation | 0) % n + n) % n;
  return r ? pat.map((_, i) => pat[(i - r + n) % n]) : pat;
}

/** A live euclid track, as euclidPlan (euclid.js) lays it over the track. */
function euclidCells(len, g) {
  const cycle = int(g?.n, 1, len, Math.min(len, 16));
  const pulses = int(g?.p, 0, cycle, 4);
  const rotate = int(g?.r, 0, Math.max(0, cycle - 1), 0);
  const ring = euclideanRhythm(cycle, pulses, rotate);
  const cells = new Array(len).fill(null);
  const hits = [];
  for (let i = 0; i < len; i++) if (ring[i % cycle]) hits.push(i);
  hits.forEach((i, h) => {
    // The studio accents the downbeats; a quarter is four steps in 4/4.
    cells[i] = { v: g?.a === false ? 0.8 : i % 4 === 0 ? 0.95 : 0.62 };
    if (g?.l) {
      const next = h + 1 < hits.length ? hits[h + 1] : len;
      for (let j = i + 1; j < next; j++) cells[j] = { v: cells[i].v, tie: true };
    }
  });
  return cells;
}

/** A live chance track. Its notes are thrown by a generator the page does not
 *  run (chanceGen.js is the engine's), so the window it plays in is drawn,
 *  dotted from its rhythm seed so two chance tracks do not look alike. */
function chanceCells(len, c) {
  const first = int(c?.f, 0, len - 1, 0);
  const last = int(c?.l, first, len - 1, len - 1);
  let h = (typeof c?.s === "number" ? c.s | 0 : 1) || 1;
  const cells = new Array(len).fill(null);
  for (let i = first; i <= last; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ (i * 374761393);
    h ^= h >>> 13;
    if ((h >>> 0) % 5 < 2) cells[i] = { v: 0.45 };
  }
  return cells;
}

function writtenCells(s) {
  const cells = [];
  for (const ch of (typeof s === "string" ? s : "").slice(0, MAX_COLS)) {
    if (ch >= "1" && ch <= "9") cells.push({ v: Number(ch) / 9 });
    else if (ch === "-" && cells.length && cells[cells.length - 1]) cells.push({ v: cells[cells.length - 1].v, tie: true });
    else cells.push(null);
  }
  return cells;
}

/**
 * Decode a preview. Tracks shorter than the longest one are tiled across it,
 * because that is what they play: every track loops its own length
 * (polymeter), so a 16-step hat under a 32-step lead plays twice.
 * @param {unknown} raw
 * @returns {Preview | null}
 */
export function decodePreview(raw) {
  try {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.t)) return null;
    const rows = raw.t
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        if (r.g && typeof r.g === "object") {
          return { cells: euclidCells(int(r.n, 1, MAX_COLS, 16), r.g), gen: "euclid" };
        }
        if (r.c && typeof r.c === "object") {
          return { cells: chanceCells(int(r.n, 1, MAX_COLS, 16), r.c), gen: "chance" };
        }
        return { cells: writtenCells(r.s), gen: null };
      })
      .filter((r) => r.cells.length);
    if (!rows.length) return null;
    const cols = Math.max(...rows.map((r) => r.cells.length));
    for (const r of rows) {
      const own = r.cells;
      r.cells = Array.from({ length: cols }, (_, i) => {
        const c = own[i % own.length];
        return c ? { ...c } : null;
      });
    }
    return { pattern: int(raw.p, 0, 31, 0), cols, rows };
  } catch {
    return null;
  }
}

/**
 * The same preview, computed from a session in JS: supabase/migrations/
 * 0012_song_preview.sql's `song_preview`, line for line. The database's copy
 * is what every card reads, because it keeps the session in the database;
 * this one is for a session that never was in it -- a quick anonymous share
 * lives in the Blobs store (lib/api.js), and its link preview still wants a
 * picture. test/songPreview.test.js holds the two to the same output.
 * @param {unknown} d a serialized session
 */
export function previewFromSession(d) {
  try {
    const tracks = d && typeof d === "object" ? d.tracks : undefined;
    if (!Array.isArray(tracks)) return null;
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    // Postgres rounds numeric -> int half away from zero.
    const pgInt = (v) => Math.sign(v) * Math.round(Math.abs(v));
    let ap = 0;
    if (num(d.activePattern)) ap = Math.max(0, Math.min(31, pgInt(d.activePattern)));
    const nul = (v) => (v === undefined ? null : v);

    let rows = [];
    for (const cand of [ap, ...Array.from({ length: 32 }, (_, i) => i)]) {
      rows = [];
      let anyHit = false;
      let n = 0;
      for (const t of tracks) {
        if (n >= 8) break;
        if (!t || typeof t !== "object" || Array.isArray(t) || t.engineKey === "bus") continue;
        n++;
        const len = num(t.length) ? Math.max(1, Math.min(64, pgInt(t.length))) : 16;
        const e = t.euclid;
        if (e && typeof e === "object" && !Array.isArray(e) && e.on === true) {
          rows.push({
            n: len,
            g: {
              p: nul(e.pulses),
              n: nul(e.steps),
              r: nul(e.rotate),
              l: "gate" in e ? e.gate === "legato" : null,
              a: e.accent !== false,
            },
          });
          anyHit = true;
          continue;
        }
        const c = t.chance;
        if (c && typeof c === "object" && !Array.isArray(c) && c.on === true) {
          rows.push({ n: len, c: { f: nul(c.first), l: nul(c.last), s: nul(c.rseed) } });
          anyHit = true;
          continue;
        }
        const pat = Array.isArray(t.patterns) ? t.patterns[cand] : undefined;
        const arr = (k) => (pat && typeof pat === "object" && Array.isArray(pat[k]) ? pat[k] : []);
        const steps = arr("steps");
        const vels = arr("velocities");
        const lens = arr("lengths");
        let line = "";
        let hold = 0;
        for (let i = 0; i < len; i++) {
          const el = steps[i];
          if (el === true || (num(el) && el > 0)) {
            const v = num(vels[i]) ? vels[i] : 0.5;
            line += String(Math.max(1, Math.min(9, pgInt(v * 9))));
            hold = (num(lens[i]) ? Math.max(1, pgInt(lens[i])) : 1) - 1;
            anyHit = true;
          } else if (hold > 0) {
            line += "-";
            hold--;
          } else {
            line += ".";
          }
        }
        rows.push({ s: line });
      }
      if (anyHit) return { p: cand, t: rows };
    }
    return { p: ap, t: rows };
  } catch {
    return null;
  }
}
