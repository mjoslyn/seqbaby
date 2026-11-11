// The groove picker's genres: the table, the search, the dice and the brief
// they send, with every plan held to the engine's own tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILY_PLANS, GENRES, GENRE_FAMILIES, KITS, genreById, genrePrompt, parseForm, parseVoice, rollGenre, rollSummary, searchGenres } from "../app/songs/genres.js";
import * as sb from "../public/js/songBuilder.js";

test("every genre is whole, unique and in a known family", () => {
  assert.ok(GENRES.length >= 100, `a big list: ${GENRES.length}`);
  const ids = new Set();
  const fams = new Set(GENRE_FAMILIES.map((f) => f.id));
  for (const g of GENRES) {
    assert.ok(!ids.has(g.id), `duplicate id ${g.id}`);
    ids.add(g.id);
    assert.ok(fams.has(g.family), `${g.id}: unknown family ${g.family}`);
    assert.ok(g.bpm[0] >= 40 && g.bpm[0] <= g.bpm[1] && g.bpm[1] <= 240, `${g.id}: bpm ${g.bpm}`);
    assert.ok(g.brief.length > 40, `${g.id}: a brief`);
  }
  for (const f of GENRE_FAMILIES) assert.ok(GENRES.some((g) => g.family === f.id), `${f.id} has genres`);
});

test("search ranks a name that starts with the query first", () => {
  assert.equal(searchGenres("tech")[0].name, "tech house");
  assert.equal(searchGenres("techno")[0].id, "techno");
  assert.ok(searchGenres("house").slice(0, 3).every((g) => g.name.includes("house")));
});

test("search finds aliases, words inside names, accents and case", () => {
  assert.equal(searchGenres("dnb")[0].id, "dnb");
  assert.equal(searchGenres("2-step")[0].id, "2-step");
  assert.equal(searchGenres("two step")[0].id, "2-step");
  assert.equal(searchGenres("ukg")[0].id, "garage");
  assert.ok(searchGenres("hop").some((g) => g.id === "lofi"));
  assert.ok(searchGenres("BOSSA").some((g) => g.id === "bossa"));
  assert.deepEqual(searchGenres("zzzz"), []);
});

test("a family filters, and an empty query lists it", () => {
  const all = searchGenres("", "bass");
  assert.ok(all.length > 5 && all.every((g) => g.family === "bass"));
  assert.ok(searchGenres("house", "techno").every((g) => g.family === "techno"));
  assert.equal(searchGenres("").length, GENRES.length);
});

test("the prompt asks for a whole song, with extras that win", () => {
  const g = genreById("acid");
  const p = genrePrompt(g, " in F minor ", 3);
  assert.match(p, /complete acid house song from scratch/);
  assert.match(p, /wins over anything above: in F minor$/);
  assert.doesNotMatch(genrePrompt(g, "", 3), /Also,/);
});

test("a roll is the seed's: the same again, and a different song from another", () => {
  for (const g of GENRES) {
    assert.deepEqual(rollGenre(g, 41), rollGenre(g, 41), g.id);
    const r = rollGenre(g, 41);
    assert.ok(r.bpm >= g.bpm[0] && r.bpm <= g.bpm[1] && Number.isInteger(r.bpm), `${g.id}: bpm ${r.bpm}`);
    assert.ok(r.form, `${g.id}: a form`);
    assert.match(genrePrompt(g, "", 41), new RegExp(`- ${r.bpm} bpm`));
    assert.ok(rollSummary(r).includes(`${r.bpm} bpm`));
  }
  // Across seeds a planned genre reaches every pool it has.
  const g = genreById("house");
  const seen = { bpm: new Set(), root: new Set(), form: new Set(), kit: new Set(), drums: new Set(), harmony: new Set(), bass: new Set(), roles: new Set(), prompt: new Set() };
  for (let seed = 1; seed <= 300; seed++) {
    const r = rollGenre(g, seed);
    seen.bpm.add(r.bpm); seen.root.add(r.root); seen.form.add(r.form); seen.kit.add(r.kit);
    seen.drums.add(JSON.stringify(r.drums)); seen.harmony.add(r.harmony);
    seen.bass.add(r.voices[0].engine + r.voices[0].how); seen.roles.add(r.voices.map((v) => v.role).join());
    seen.prompt.add(genrePrompt(g, "", seed));
    const [lo, hi] = g.plan.extras;
    const extras = r.voices.length - Object.keys(g.plan.core).length;
    assert.ok(extras >= lo && extras <= hi, `extras ${extras}`);
    assert.equal(r.moves.length, 2);
    assert.ok(r.swing >= g.plan.swing[0] && r.swing <= g.plan.swing[1]);
  }
  assert.equal(seen.bpm.size, g.bpm[1] - g.bpm[0] + 1);
  assert.equal(seen.root.size, 12);
  assert.equal(seen.form.size, FAMILY_PLANS.house.forms.length);
  assert.equal(seen.kit.size, g.plan.kits.length);
  assert.equal(seen.drums.size, g.plan.drums.length);
  assert.equal(seen.harmony.size, g.plan.harmony.length);
  assert.ok(seen.bass.size > 6 && seen.roles.size > 4);
  assert.ok(seen.prompt.size > 295, `distinct prompts: ${seen.prompt.size}`);
});

test("every family has forms chain mode can play", () => {
  const check = (form, where) => {
    const secs = parseForm(form);
    assert.ok(secs.length >= 3 && secs.length <= 12, `${where}: ${secs.length} sections`);
    for (const s of secs) {
      assert.ok(s.name, `${where}: a section name in ${form}`);
      assert.ok([1, 2, 4, 8, 12, 16].includes(s.bars), `${where}: ${s.name} ${s.bars} bars`);
    }
  };
  for (const f of GENRE_FAMILIES) {
    const plan = FAMILY_PLANS[f.id];
    assert.ok(plan && plan.forms.length >= 2, `${f.id}: forms`);
    plan.forms.forEach((form) => check(form, f.id));
  }
  for (const g of GENRES) (g.plan?.forms || []).forEach((form) => check(form, g.id));
});

test("a plan names only engines, presets, scales, kits and step strings that exist", () => {
  const planned = GENRES.filter((g) => g.plan);
  assert.ok(planned.length >= 10, `rewritten genres: ${planned.length}`);
  const voiceOk = (spec, where) => {
    const { engine, preset } = parseVoice(spec);
    const e = sb.resolveEngine(engine);
    assert.equal(e.key, engine, `${where}: ${engine} is spelled as its key`);
    if (preset) {
      const names = sb.describeEngine(e.key).presets.map((x) => x.name);
      assert.ok(names.includes(preset), `${where}: ${engine} has no preset ${JSON.stringify(preset)} (${names.join(", ")})`);
    }
  };
  const proseOk = (text, where) => {
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      assert.equal(sb.parseSteps(m[1]).steps.length, 16, `${where}: \`${m[1]}\` is one bar`);
    }
    for (const m of text.matchAll(/\b(?:dm|plaits|inst|wt):[\w-]+/g)) sb.resolveEngine(m[0]);
  };
  const samples = new Set(sb.BUNDLED_SAMPLE_LIST.map((x) => x.label));
  const kits = new Set(sb.BUNDLED_SAMPLE_LIST.map((x) => x.kit));
  for (const [name, text] of Object.entries(KITS)) {
    proseOk(text, `kit ${name}`);
    const listed = /\(([^)]*)\)/.exec(text)?.[1].split(", ") || [];
    for (const item of listed) if (!item.includes(":")) assert.ok(samples.has(item), `kit ${name}: no sample ${item}`);
    if (/acoustic kit/.test(text)) assert.ok(kits.has(name), `kit ${name}: no such acoustic kit`);
  }
  for (const g of planned) {
    const p = g.plan;
    for (const k of p.kits) assert.ok(KITS[k], `${g.id}: kit ${k}`);
    assert.ok(p.drums.length >= 2, `${g.id}: drum variants`);
    for (const d of p.drums) {
      for (const [role, str] of Object.entries(d)) {
        assert.equal(str.length, 16, `${g.id}: ${role} ${str}`);
        assert.ok(sb.parseSteps(str).steps.some(Boolean), `${g.id}: ${role} has a hit`);
      }
    }
    const pools = { ...p.core, ...(p.optional || {}) };
    assert.equal(Object.keys(pools).length, Object.keys(p.core).length + Object.keys(p.optional || {}).length, `${g.id}: a role is core or optional`);
    for (const [role, pool] of Object.entries(pools)) {
      assert.ok(pool.length >= 1, `${g.id}: ${role}`);
      pool.forEach((spec) => voiceOk(spec, `${g.id} ${role}`));
    }
    if (p.extras) assert.ok(p.extras[0] <= p.extras[1] && p.extras[1] <= Object.keys(p.optional || {}).length, `${g.id}: extras`);
    assert.ok(p.harmony.length >= 3 && p.moves.length >= 4 && p.avoid.length >= 2, `${g.id}: pools`);
    for (const h of p.harmony) {
      const cut = h.indexOf(": ");
      assert.ok(cut > 0, `${g.id}: harmony ${h} names its scale`);
      for (const sc of h.slice(0, cut).split("/")) assert.ok(sb.SCALE_NAMES.includes(sc), `${g.id}: scale ${sc}`);
    }
    for (const text of [...(p.bass || []), ...p.harmony, ...p.moves, ...p.avoid]) proseOk(text, g.id);
    for (const a of p.angles || []) assert.ok(a, `${g.id}: angle`);
    // What the dice say is a song the builder takes.
    for (let seed = 1; seed <= 20; seed++) {
      const r = rollGenre(g, seed);
      const song = sb.newSong({ bpm: r.bpm, swing: r.swing || 0, scale: { root: r.root, mode: r.scale } });
      r.voices.forEach((v, i) => {
        sb.addTrack(song, { engine: v.engine, name: v.role });
        if (v.preset) sb.applyPreset(song, i, v.preset);
      });
    }
  }
});
