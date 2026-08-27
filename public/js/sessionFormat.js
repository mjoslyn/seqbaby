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
export const SET_VERSION = 2;

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
