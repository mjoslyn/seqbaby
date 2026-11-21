// Every engine says what it sounds like and how to make it sound played,
// and the names in that prose are real engines and presets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINE_CHARACTER, STATIC_ENGINES } from "../public/js/engineData.js";
import * as sb from "../public/js/songBuilder.js";

const KINDS = ["recorded", "modelled", "analog", "digital", "raw", "drum", "utility"];

test("every engine has a character, and describe_engine serves it", () => {
  for (const e of STATIC_ENGINES) {
    const c = ENGINE_CHARACTER[e.key];
    assert.ok(c, `${e.key}: no character`);
    assert.ok(KINDS.includes(c.kind), `${e.key}: kind ${c.kind}`);
    assert.ok(c.sound && c.use, `${e.key}: sound and use`);
    assert.deepEqual(sb.describeEngine(e.key).character, c);
  }
  assert.deepEqual(Object.keys(ENGINE_CHARACTER).sort(), STATIC_ENGINES.map((e) => e.key).sort());
});

test("engines, presets and panel keys named in a character exist", () => {
  const panelKeys = new Set(sb.describeEngines().flatMap((d) => [...(d.panel?.numeric || []), ...(d.panel?.select || []), ...(d.panel?.text || [])].map((x) => x.key)));
  for (const [key, c] of Object.entries(ENGINE_CHARACTER)) {
    const text = [c.sound, c.use, c.human, c.cheap].join(" ");
    for (const m of text.matchAll(/\b((?:dm|plaits|inst|wt):[\w-]+)(?:\/([a-z.]+(?: [a-z0-9.]+)*))?/g)) {
      const e = sb.resolveEngine(m[1]);
      if (m[2]) {
        const names = sb.describeEngine(e.key).presets.map((p) => p.name);
        assert.ok(names.some((n) => m[2] === n || m[2].startsWith(n + " ")), `${key}: ${m[1]} has no preset ${m[2]}`);
      }
    }
    for (const m of text.matchAll(/\b(?:sng|hlo|lnc|ldr|orc|gt|bs|sge)[a-z]{3,}\b/g)) assert.ok(panelKeys.has(m[0]), `${key}: no control ${m[0]}`);
  }
});

test("every preset says what it is", () => {
  for (const d of sb.describeEngines()) for (const p of d.presets) assert.ok(p.description, `${d.key}: ${p.name} has no description`);
});
