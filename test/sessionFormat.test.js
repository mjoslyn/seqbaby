// Tests for the serialized-session format check. Run with `npm test`.
//
// validateSet decides what applySet is allowed to attempt. Its rule is not
// "is this a well-formed session" -- it is "will applySet survive this", which
// is a much narrower question, and the reason it is hand-written rather than a
// schema: it has to keep accepting anything any previous build ever wrote,
// while catching the handful of shapes that throw partway through a destructive
// operation with no undo.
//
// That rule lives in prose, so these tests are what keep it honest. The two
// halves matter for different reasons:
//
//   "accepts" -- a regression here is user-visible data loss: a real session
//     that used to load stops loading. Never delete a case from it.
//   "rejects" -- each case is paired with the applySet expression it would
//     break, exercised directly at the bottom of this file. If applySet stops
//     doing one of those things, or starts doing a new one, that pairing is
//     what has gone stale.

import test from "node:test";
import assert from "node:assert/strict";
import { SET_VERSION, validateSet } from "../public/js/sessionFormat.js";

const track = (over = {}) => ({ engineKey: "plaits:0", length: 16, ...over });
const session = (over = {}) => ({ _version: SET_VERSION, bpm: 120, swing: 0, tracks: [track()], ...over });

test("SET_VERSION is an integer above the implied legacy version", () => {
  assert.ok(Number.isInteger(SET_VERSION));
  assert.ok(SET_VERSION >= 2, "1 is the implied version of unstamped blobs, so stamping 1 would be indistinguishable from stamping nothing");
});

test("accepts what current serializeSet writes", () => {
  const r = validateSet(session());
  assert.deepEqual(r, { ok: true, version: SET_VERSION, errors: [], warnings: [] });
});

// Every one of these is a shape some earlier build could have written. A
// failure here means a real session somewhere stopped loading.
test("accepts legacy sessions", async (t) => {
  const cases = {
    "no _version at all (every row written before stamping)": { bpm: 120, tracks: [track()] },
    "no tracks key": { bpm: 120 },
    "empty object": {},
    "tracks explicitly null": { tracks: null },
    "tracks empty array": { tracks: [] },
    "track with no engineKey (applySet defaults to plaits:0)": { tracks: [{ length: 16 }] },
    "track with empty-string engineKey (falsy, so also defaulted)": { tracks: [{ engineKey: "" }] },
    "track with no length (applySet defaults to 16)": { tracks: [{ engineKey: "plaits:0" }] },
    "legacy sampler engine keys": { tracks: [{ engineKey: "smp:Kit/kick" }, { engineKey: "upload" }, { engineKey: "eleven" }] },
    "extra unknown keys (forward-compatible additions)": session({ somethingNew: { a: 1 } }),
  };
  for (const [label, blob] of Object.entries(cases)) {
    await t.test(label, () => {
      const r = validateSet(blob);
      assert.equal(r.ok, true, `rejected with: ${r.errors.join("; ")}`);
    });
  }
});

test("unstamped blobs read as version 1", () => {
  assert.equal(validateSet({ bpm: 120 }).version, 1);
  assert.equal(validateSet(session()).version, SET_VERSION);
});

test("rejects blobs applySet cannot survive", async (t) => {
  const cases = {
    "tracks is an object": [{ tracks: { a: 1 } }, /tracks is not an array/],
    "tracks is a number": [{ tracks: 5 }, /tracks is not an array/],
    // A string IS iterable, so this one does not throw -- it silently builds a
    // junk track per character, having already deleted the real ones.
    "tracks is a string": [{ tracks: "abc" }, /tracks is not an array/],
    "a track is null": [{ tracks: [track(), null] }, /track 1 is not an object/],
    "a track is a number": [{ tracks: [3] }, /track 0 is not an object/],
    "a track is a string": [{ tracks: ["nope"] }, /track 0 is not an object/],
    "engineKey is a number": [{ tracks: [track({ engineKey: 42 })] }, /non-string engineKey/],
    "engineKey is an object": [{ tracks: [track({ engineKey: {} })] }, /non-string engineKey/],
    "not an object": ["hello", /not a session object/],
    "an array": [[1, 2, 3], /not a session object/],
    "_version is a string": [session({ _version: "2" }), /_version is not a positive integer/],
    "_version is zero": [session({ _version: 0 }), /_version is not a positive integer/],
    "_version is negative": [session({ _version: -1 }), /_version is not a positive integer/],
    "_version is fractional": [session({ _version: 1.5 }), /_version is not a positive integer/],
  };
  for (const [label, [blob, expected]] of Object.entries(cases)) {
    await t.test(label, () => {
      const r = validateSet(blob);
      assert.equal(r.ok, false, "should have been rejected");
      assert.match(r.errors.join("; "), expected);
    });
  }
});

test("null and undefined are rejected, not crashed on", () => {
  for (const v of [null, undefined]) assert.equal(validateSet(v).ok, false);
});

test("warns without rejecting on the survivable oddities", async (t) => {
  const cases = {
    "a blob from a newer build": [session({ _version: SET_VERSION + 97 }), /newer version of seqbaby/],
    "patterns is not an array": [{ tracks: [track({ patterns: {} })] }, /patterns is not an array/],
    "length is not a number": [{ tracks: [track({ length: "sixteen" })] }, /length is not a number/],
    "bpm is not a number": [session({ bpm: "120" }), /bpm is not a number/],
    "swing is not a number": [session({ swing: "0" }), /swing is not a number/],
  };
  for (const [label, [blob, expected]] of Object.entries(cases)) {
    await t.test(label, () => {
      const r = validateSet(blob);
      assert.equal(r.ok, true, `should still load, got: ${r.errors.join("; ")}`);
      assert.match(r.warnings.join("; "), expected);
    });
  }
});

test("a newer-version warning names both versions", () => {
  const { warnings } = validateSet(session({ _version: 99 }));
  assert.match(warnings.join(""), /format 99/);
  assert.match(warnings.join(""), new RegExp(`reads ${SET_VERSION}`));
});

test("errors accumulate across tracks rather than stopping at the first", () => {
  const r = validateSet({ tracks: [track({ engineKey: 1 }), null, track({ engineKey: {} })] });
  assert.equal(r.errors.length, 3);
});

// ---------------------------------------------------------------------------
// Why each rejected case is rejected.
//
// These mirror the expressions applySet actually runs on a track (session.js,
// the `for (const td of s.tracks || [])` loop). They are here so the rule above
// is anchored to something executable instead of a claim in a comment: if one
// of these stops throwing, the matching case in "rejects" is no longer earning
// its place, and if applySet grows a new one, it belongs here too.
// ---------------------------------------------------------------------------

test("the expressions applySet runs really do break on the rejected shapes", async (t) => {
  await t.test("for..of over a non-iterable throws", () => {
    assert.throws(() => { for (const _ of /** @type {any} */ ({ a: 1 })) { /* applySet's tracks loop */ } }, TypeError);
    assert.throws(() => { for (const _ of /** @type {any} */ (5)) { /* same */ } }, TypeError);
  });

  await t.test("for..of over a string does NOT throw -- it quietly yields junk", () => {
    const built = [];
    for (const td of /** @type {any} */ ("abc")) built.push(td.engineKey || "plaits:0");
    assert.deepEqual(built, ["plaits:0", "plaits:0", "plaits:0"],
      "three junk tracks, which is why a string in `tracks` is an error even though nothing throws");
  });

  await t.test("reading engineKey off a null track throws", () => {
    assert.throws(() => { const td = /** @type {any} */ (null); return td.engineKey; }, TypeError);
  });

  await t.test("startsWith on a truthy non-string engineKey throws", () => {
    assert.throws(() => { const ek = /** @type {any} */ (42) || "plaits:0"; return ek.startsWith("smp:"); }, TypeError);
  });

  await t.test("...but a falsy engineKey is fine, because applySet defaults it first", () => {
    const ek = "" || "plaits:0";
    assert.equal(ek.startsWith("smp:"), false);
  });

  await t.test("Object.assign over a primitive is a no-op, so bad params are only a warning", () => {
    assert.deepEqual(Object.assign({}, /** @type {any} */ (5)), {});
  });
});
