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
import { ARRANGE_MAX_BARS, arrangementBars, migrateLegacyNames, migrateModKey, migrateTrackNames, normalizeArrangement, SET_VERSION, validateSet } from "../public/js/sessionFormat.js";

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
    "an arrangement (sessions written since the arrangement view)": session({ arrangement: [{ p: 0, bars: 4 }, { p: 2, bars: 8 }, { p: 0, bars: 4 }] }),
    "an empty arrangement": session({ arrangement: [] }),
    "arrangement explicitly null": session({ arrangement: null }),
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
    // normalizeArrangement would read it as "none", which turns a song back
    // into a slot-order chain without a word; applySet refuses instead.
    "arrangement is an object": [{ arrangement: { p: 0, bars: 4 } }, /arrangement is not an array/],
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

// ---- the emulator rename ------------------------------------------------
//
// Same stakes as validateSet's "accepts" half: every song and share link
// written before the emulators were renamed still spells them after the
// hardware, and a miss here is a track that loads with the wrong engine, or a
// mod matrix and a set of automation lanes that silently go missing.

test("migrateModKey rewrites both namespaces and leaves everything else alone", () => {
  assert.equal(migrateModKey("dx7_3lvl"), "hexop_3lvl");        // LFO target
  assert.equal(migrateModKey("dx7.3lvl"), "hexop.3lvl");        // automation lane
  assert.equal(migrateModKey("virus_cut2"), "contagion_cut2");
  assert.equal(migrateModKey("virus.osc2semi"), "contagion.osc2semi");
  assert.equal(migrateModKey("tb303_accent"), "silverbox_accent");
  assert.equal(migrateModKey("tb303.wave"), "silverbox.wave");
  assert.equal(migrateModKey("hexop_3lvl"), "hexop_3lvl", "idempotent — a current name matches nothing");
  assert.equal(migrateModKey("gtr_drv"), "gtr_drv");
  assert.equal(migrateModKey("fx.delay"), "fx.delay");
  assert.equal(migrateModKey("dx7"), "dx7", "the bare prefix is not a key");
});

test("every renamed engine key is migrated", () => {
  const pairs = [
    ["dm:303", "dm:silverbox"], ["dm:virus", "dm:contagion"], ["dm:dx7", "dm:hexop"],
    ["dm:mini-brute", "dm:snarl"], ["dm:moog", "dm:ladder"], ["dm:juno", "dm:drift"],
    ["dm:rhodes", "dm:tines"], ["dm:prophet6", "dm:oracle"],
  ];
  for (const [old, now] of pairs)
    assert.equal(migrateTrackNames({ engineKey: old }).engineKey, now);
  assert.equal(migrateTrackNames({ engineKey: "plaits:0" }).engineKey, "plaits:0");
  assert.equal(migrateTrackNames({ engineKey: "dm:guitar" }).engineKey, "dm:guitar");
});

test("a track's sound is migrated everywhere it is stored", () => {
  const td = migrateTrackNames({
    engineKey: "dm:303",
    params: { wave303: "square", accent303: 0.8, tune303: 5, harm: 0.5 },
    lfoConfig: { tb303_accent: { enabled: true }, cutoff: { enabled: false } },
    baseSound: { params: { wave303: "saw" }, lfoConfig: { dx7_3lvl: { enabled: true } } },
    patterns: [
      null,
      { automation: { "tb303.wave": { enabled: true }, "fx.delay": { enabled: true } },
        sound: { params: { tune303: -3 }, lfoConfig: { virus_sat: { enabled: true } } } },
    ],
  });
  assert.deepEqual(td.params, { sbwave: "square", sbaccent: 0.8, sbtune: 5, harm: 0.5 });
  assert.deepEqual(Object.keys(td.lfoConfig).sort(), ["cutoff", "silverbox_accent"]);
  assert.deepEqual(td.baseSound.params, { sbwave: "saw" });
  assert.ok("hexop_3lvl" in td.baseSound.lfoConfig);
  assert.ok("silverbox.wave" in td.patterns[1].automation);
  assert.ok("fx.delay" in td.patterns[1].automation);
  assert.deepEqual(td.patterns[1].sound.params, { sbtune: -3 });
  assert.ok("contagion_sat" in td.patterns[1].sound.lfoConfig);
});

test("macro pad assignments speak the automation namespace, so they migrate too", () => {
  const s = migrateLegacyNames({
    tracks: [{ engineKey: "dm:dx7" }],
    macroPads: [{ name: "sweep",
      x: [{ track: 0, key: "dx7.3lvl" }, { track: 0, key: "fx.delay" }],
      y: [{ track: 0, key: "virus.cut2" }] }],
  });
  assert.equal(s.tracks[0].engineKey, "dm:hexop");
  assert.deepEqual(s.macroPads[0].x.map(a => a.key), ["hexop.3lvl", "fx.delay"]);
  assert.deepEqual(s.macroPads[0].y.map(a => a.key), ["contagion.cut2"]);
});

test("migration survives the shapes validateSet lets through", () => {
  for (const bad of [null, undefined, 5, "x", []])
    assert.doesNotThrow(() => migrateLegacyNames(/** @type {any} */ (bad)));
  assert.doesNotThrow(() => migrateLegacyNames({ tracks: [null, 5, { params: 7 }] }));
  assert.doesNotThrow(() => migrateLegacyNames({ macroPads: [null, { x: 5 }, {}] }));
  assert.doesNotThrow(() => migrateTrackNames({ patterns: "not an array" }));
});

test("migration is idempotent — running it twice changes nothing", () => {
  const once  = migrateLegacyNames(JSON.parse(JSON.stringify(session({
    tracks: [{ engineKey: "dm:virus", params: { wave303: 1 }, lfoConfig: { virus_sat: {} } }],
  }))));
  const twice = migrateLegacyNames(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("a crush config written before the converter clock loads with the clock off", () => {
  const td = migrateTrackNames({
    fxConfig: { crush: { bits: 6, wet: 0.8 } },
    baseSound: { fxConfig: { crush: { bits: 4, wet: 1 } } },
    patterns: [null, { sound: { fxConfig: { crush: { bits: 12, wet: 0.3 } } } }],
  });
  // 1 is the top of the knob: no decimation, which is all the effect ever did
  // before the clock existed. The rest of the config is untouched.
  assert.deepEqual(td.fxConfig.crush, { bits: 6, wet: 0.8, rate: 1 });
  assert.equal(td.baseSound.fxConfig.crush.rate, 1);
  assert.equal(td.patterns[1].sound.fxConfig.crush.rate, 1);
});

test("a crush rate already in the song is left alone, including 0", () => {
  const td = migrateTrackNames({ fxConfig: { crush: { bits: 6, wet: 1, rate: 0 } } });
  assert.equal(td.fxConfig.crush.rate, 0);
  const again = migrateTrackNames({ fxConfig: { crush: { bits: 6, wet: 1, rate: 0.42 } } });
  assert.equal(again.fxConfig.crush.rate, 0.42);
});

// ---- the arrangement ------------------------------------------------------------
//
// Every reader of the format (applySet, the live merge, the song builder)
// takes the arrangement through normalizeArrangement, so what it drops and
// what it clamps is the whole of what a hand-edited song can put in front of
// the transport.

test("normalizeArrangement keeps sections, clamps bars and drops what is not a section", () => {
  assert.deepEqual(normalizeArrangement(undefined), []);
  assert.deepEqual(normalizeArrangement(null), []);
  assert.deepEqual(normalizeArrangement("1x4"), []);
  assert.deepEqual(normalizeArrangement({ p: 0, bars: 4 }), []);
  assert.deepEqual(normalizeArrangement([{ p: 0, bars: 4 }, { p: 2, bars: 8 }, { p: 0, bars: 4 }]),
    [{ p: 0, bars: 4 }, { p: 2, bars: 8 }, { p: 0, bars: 4 }], "the same pattern twice is the point");
  assert.deepEqual(normalizeArrangement([{ p: 3 }]), [{ p: 3, bars: 1 }], "no bars is one bar");
  assert.deepEqual(normalizeArrangement([{ p: 3, bars: 0 }, { p: 3, bars: -2 }, { p: 3, bars: 2.6 }]),
    [{ p: 3, bars: 1 }, { p: 3, bars: 1 }, { p: 3, bars: 3 }]);
  assert.deepEqual(normalizeArrangement([{ p: 1, bars: 1000 }]), [{ p: 1, bars: ARRANGE_MAX_BARS }]);
  assert.deepEqual(normalizeArrangement([{ p: 32, bars: 4 }, { p: -1, bars: 4 }, { p: "x", bars: 4 }, null, 7, { bars: 4 }]), [],
    "a pattern outside the bank, or none, is not a section");
  assert.deepEqual(normalizeArrangement([{ p: "2", bars: "4" }]), [{ p: 2, bars: 4 }], "numeric strings read as numbers");
  assert.deepEqual(normalizeArrangement([{ p: 40, bars: 1 }], 64), [{ p: 40, bars: 1 }], "the bank size is the caller's");
  const raw = [{ p: 0, bars: 4, extra: true }];
  const out = normalizeArrangement(raw);
  assert.deepEqual(out, [{ p: 0, bars: 4 }]);
  assert.notEqual(out[0], raw[0], "a fresh object, never the blob's own");
});

test("arrangementBars counts the bars one pass plays", () => {
  assert.equal(arrangementBars([]), 0);
  assert.equal(arrangementBars(undefined), 0);
  assert.equal(arrangementBars([{ p: 0, bars: 4 }, { p: 1, bars: 8 }, { p: 0, bars: 4 }]), 16);
  assert.equal(arrangementBars([{ p: 0 }, { p: 1, bars: 0 }]), 2, "a section is at least a bar");
});

test("normalizeArrangement keeps a rest: a section with no pattern", () => {
  assert.deepEqual(normalizeArrangement([{ p: 0, bars: 4 }, { p: null, bars: 2 }, { p: 1, bars: 4 }]),
    [{ p: 0, bars: 4 }, { p: null, bars: 2 }, { p: 1, bars: 4 }]);
  assert.deepEqual(normalizeArrangement([{ rest: true, bars: 3 }, { rest: true }]), [{ p: null, bars: 3 }, { p: null, bars: 1 }], "the builder's spelling");
  assert.deepEqual(normalizeArrangement([{ p: null, bars: 0 }, { p: null, bars: 1000 }]), [{ p: null, bars: 1 }, { p: null, bars: ARRANGE_MAX_BARS }], "clamped like any section");
  assert.deepEqual(normalizeArrangement([{ p: undefined, bars: 2 }, { bars: 2 }]), [], "no pattern at all is not a rest: a rest is said (null), not left out");
  assert.equal(arrangementBars([{ p: 0, bars: 4 }, { p: null, bars: 2 }]), 6, "a rest's bars count");
});

test("normalizeArrangement keeps a section's held-back tracks as sorted, distinct indices", () => {
  assert.deepEqual(normalizeArrangement([{ p: 0, bars: 4, off: [2, 0, 2, "1", -1, 1.4, "x", null] }]), [{ p: 0, bars: 4, off: [0, 1, 2] }]);
  assert.deepEqual(normalizeArrangement([{ p: 0, bars: 4 }, { p: 0, bars: 4, off: "all" }, { p: 0, bars: 4, off: [] }]), [{ p: 0, bars: 4 }, { p: 0, bars: 4 }, { p: 0, bars: 4 }], "absent, unreadable or empty is nobody held back, and is left unsaid");
  assert.deepEqual(normalizeArrangement([{ p: null, bars: 1, off: [3] }]), [{ p: null, bars: 1, off: [3] }], "a rest carries them too, harmlessly");
});
