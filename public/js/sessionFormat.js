// The serialized-session format: its version, and a check of a blob against it.
//
// Deliberately its own module with NO imports. Everything else in the engine
// reaches for the DOM or Tone at import time, which makes it unloadable outside
// a browser; this is a pure function over a plain object, so keeping it separate
// is what lets test/sessionFormat.test.js exercise it under `node --test`.
// session.js and appApi.js both import from here.

// The format version stamped into every serialized session. Bump it when the
// MEANING of an existing field changes. A new field needs no bump: applySet
// already tolerates absent keys and falls back to a default.
//
//   1 (implied) — everything written before stamping existed. An absent
//     `_version` reads as 1, which is the whole migration for existing rows.
//   2 — the first stamped format, identical in shape to 1. The number exists so
//     the next meaning-change has something to branch on, rather than needing
//     another per-field marker the way granular's gspeed needed `gspeedV`.
//   3 — the eight brand-derived emulators were renamed (dm:dx7 → dm:hexop and
//     the rest, see migrateLegacyNames below), which renames their engine keys,
//     LFO targets and automation lanes. Nothing here branches on the number —
//     the migration is name-driven and idempotent — but an older build reading
//     a 3 would silently drop those engines, so the warning it raises is true.
export const SET_VERSION = 3;

/**
 * Check a serialized session before applySet() commits to it.
 *
 * applySet is destructive up front — it stops the transport and removes every
 * track before it reads a single field — so a blob that throws halfway through
 * leaves you with an empty session and no way back. This runs first so the
 * answer is "load failed" rather than "load failed, and your work is gone".
 *
 * Deliberately lenient: sessions written by any earlier build have to keep
 * loading, so only the conditions that would actually throw inside applySet are
 * errors. Anything merely odd is a warning, because applySet already defaults
 * its way past most of it.
 *
 * @param {any} data
 * @returns {{ok: boolean, version: number, errors: string[], warnings: string[]}}
 */
export function validateSet(data) {
  const errors = [];
  const warnings = [];

  if (data === null || typeof data !== "object" || Array.isArray(data))
    return { ok: false, version: 0, errors: ["not a session object"], warnings };

  let version = 1;   // absent means "written before stamping" — see SET_VERSION
  if (data._version !== undefined) {
    if (!Number.isInteger(data._version) || data._version < 1)
      errors.push(`_version is not a positive integer (${JSON.stringify(data._version)})`);
    else {
      version = data._version;
      if (version > SET_VERSION)
        warnings.push(`saved by a newer version of seqbaby (format ${version}, this build reads ${SET_VERSION}) — some settings may not load`);
    }
  }

  // `for (const td of s.tracks || [])` throws on a truthy non-iterable, and
  // quietly builds junk tracks from a string, which is iterable.
  if (data.tracks && !Array.isArray(data.tracks)) {
    errors.push("tracks is not an array");
  } else if (Array.isArray(data.tracks)) {
    data.tracks.forEach((td, i) => {
      if (td === null || typeof td !== "object") {
        errors.push(`track ${i} is not an object`);
        return;
      }
      // ek.startsWith() runs on whatever engineKey holds once it is truthy; a
      // falsy one is fine, applySet defaults it to plaits:0.
      if (td.engineKey && typeof td.engineKey !== "string")
        errors.push(`track ${i} has a non-string engineKey`);
      if (td.patterns != null && !Array.isArray(td.patterns))
        warnings.push(`track ${i}: patterns is not an array, its patterns will be skipped`);
      if (td.length != null && !Number.isFinite(td.length))
        warnings.push(`track ${i}: length is not a number, defaulting to 16`);
    });
  }

  for (const k of ["bpm", "swing"])
    if (data[k] != null && !Number.isFinite(data[k]))
      warnings.push(`${k} is not a number, keeping the current value`);

  return { ok: errors.length === 0, version, errors, warnings };
}

// ---- the emulator rename ------------------------------------------------
//
// The eight brand-derived emulators were renamed to names of their own:
//
//   dm:303 → dm:silverbox   dm:virus → dm:contagion   dm:dx7 → dm:hexop
//   dm:mini-brute → dm:snarl   dm:moog → dm:ladder    dm:juno → dm:drift
//   dm:rhodes → dm:tines       dm:prophet6 → dm:oracle
//
// A song written before that still spells them the old way, and the name is in
// four places, not one: the engine key, three of the silverbox's `params` keys,
// the LFO target keys (`dx7_3lvl`) and the automation lane keys (`dx7.3lvl`) —
// which the macro pads store too. So the rename is undone on the way in, here,
// rather than left to `applySet` to defend against key by key.
//
// It lives in this module for the same reason validateSet does: it is a pure
// function over a plain object, so `node --test` can exercise it. It is
// idempotent — a current name matches nothing — and mutates in place, which is
// what applySet and applyTrackPatch already do with the granular params.

const LEGACY_ENGINE_KEYS = {
  "dm:303":        "dm:silverbox",
  "dm:virus":      "dm:contagion",
  "dm:dx7":        "dm:hexop",
  "dm:mini-brute": "dm:snarl",
  "dm:moog":       "dm:ladder",
  "dm:juno":       "dm:drift",
  "dm:rhodes":     "dm:tines",
  "dm:prophet6":   "dm:oracle",
};

// The three silverbox panel params. The other emulators' params were already
// spelled with a neutral prefix (`v…`, `d…`), so only these carry a model name.
const LEGACY_PARAM_KEYS = { wave303: "sbwave", accent303: "sbaccent", tune303: "sbtune" };

// LFO targets and automation lanes differ only in their separator, so one
// pattern covers both: `dx7_3lvl` → `hexop_3lvl`, `dx7.3lvl` → `hexop.3lvl`.
const LEGACY_MOD_PREFIXES = { tb303: "silverbox", virus: "contagion", dx7: "hexop" };
const LEGACY_MOD_KEY = /^(tb303|virus|dx7)([_.])(.+)$/;

/** One LFO-target or automation-lane key, old spelling → new. @param {string} k */
export function migrateModKey(k) {
  const m = typeof k === "string" && LEGACY_MOD_KEY.exec(k);
  return m ? LEGACY_MOD_PREFIXES[m[1]] + m[2] + m[3] : k;
}

/** Rewrite an object's keys in place. A key already at its new spelling wins —
 *  a hand-edited song holding both would otherwise have the stale one clobber
 *  the current one. */
function renameKeys(obj, rename) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const n = rename(k);
    if (n === k) continue;
    if (!(n in obj)) obj[n] = obj[k];
    delete obj[k];
  }
}

/** A sound snapshot, or anything shaped like one (a track, a saved patch). */
function migrateSoundNames(o) {
  if (!o || typeof o !== "object") return;
  renameKeys(o.params, (k) => LEGACY_PARAM_KEYS[k] || k);
  renameKeys(o.lfoConfig, migrateModKey);
}

/**
 * One serialized track — also the shape of a saved patch, which carries the
 * same engineKey / params / lfoConfig fields.
 * @param {any} td @returns {any} the same object
 */
export function migrateTrackNames(td) {
  if (!td || typeof td !== "object") return td;
  if (LEGACY_ENGINE_KEYS[td.engineKey]) td.engineKey = LEGACY_ENGINE_KEYS[td.engineKey];
  migrateSoundNames(td);          // the live sound
  migrateSoundNames(td.baseSound); // the sound every unlocked pattern shares
  for (const p of Array.isArray(td.patterns) ? td.patterns : []) {
    if (!p || typeof p !== "object") continue;
    renameKeys(p.automation, migrateModKey);
    migrateSoundNames(p.sound);   // a p-locked pattern's own sound
  }
  return td;
}

/**
 * A whole serialized session: every track, plus the macro pads, whose
 * assignments are stored as automation keys.
 * @param {any} data @returns {any} the same object
 */
export function migrateLegacyNames(data) {
  if (!data || typeof data !== "object") return data;
  for (const td of Array.isArray(data.tracks) ? data.tracks : []) migrateTrackNames(td);
  for (const pad of Array.isArray(data.macroPads) ? data.macroPads : []) {
    for (const axis of ["x", "y"]) {
      for (const a of Array.isArray(pad?.[axis]) ? pad[axis] : [])
        if (a && typeof a === "object") a.key = migrateModKey(a.key);
    }
  }
  return data;
}
