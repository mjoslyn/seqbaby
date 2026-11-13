import { test } from "node:test";
import assert from "node:assert/strict";
import { UNLOCK_MODELS, codeMatches, mintUnlock, readUnlock } from "../lib/unlock.js";
import { COMPOSE_MODELS, allowedModels, pickedModel } from "../lib/composeModels.js";
import { bucketFor } from "../lib/composeJobs.js";

test("the code matches only itself, and no code set unlocks nothing", () => {
  assert.ok(codeMatches("open sesame", "open sesame"));
  assert.ok(codeMatches(" open sesame ", "open sesame"));
  assert.ok(!codeMatches("open sesam", "open sesame"));
  assert.ok(!codeMatches("", "open sesame"));
  assert.ok(!codeMatches("", ""));
  assert.ok(!codeMatches("anything", undefined));
});

test("a cookie reads back under its code, and not after a rotation or a tamper", async () => {
  const v = await mintUnlock("first-code");
  const id = await readUnlock(v, "first-code");
  assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(await readUnlock(v, "second-code"), null, "rotating the code cuts every cookie off");
  assert.equal(await readUnlock(v, ""), null);
  const [vid, sig] = v.split(".");
  assert.equal(await readUnlock(`${vid}x.${sig}`, "first-code"), null);
  assert.equal(await readUnlock(`${vid}.${sig.slice(1)}a`, "first-code"), null);
  assert.equal(await readUnlock("garbage", "first-code"), null);
  assert.equal(await readUnlock(undefined, "first-code"), null);
  assert.notEqual(await readUnlock(await mintUnlock("first-code"), "first-code"), id, "every visitor gets their own id");
});

test("an unlock offers the deploy's model plus sonnet and opus, and nothing else", () => {
  const ids = (l) => l.map((m) => m.id);
  assert.deepEqual(ids(allowedModels({ unlocked: true, defaultModel: "claude-haiku-5-5" })), ["claude-haiku-5-5", ...UNLOCK_MODELS]);
  assert.deepEqual(ids(allowedModels({ unlocked: true, defaultModel: "claude-sonnet-5-5" })), UNLOCK_MODELS);
  assert.deepEqual(ids(allowedModels({})), []);
  assert.deepEqual(allowedModels({ picker: true, unlocked: true }), COMPOSE_MODELS);
  const unlocked = allowedModels({ unlocked: true });
  assert.equal(pickedModel("claude-opus-5-5", unlocked), "claude-opus-5-5");
  assert.equal(pickedModel("claude-sonnet-5-5", unlocked), "claude-sonnet-5-5");
  assert.equal(pickedModel("claude-fable-5-2", unlocked), null);
  assert.equal(pickedModel("claude-fable-5-2", true), "claude-fable-5-2");
  assert.equal(pickedModel("claude-opus-5-5", []), null);
});

test("an unlocked visitor has a bucket of their own, an account its own", () => {
  assert.equal(bucketFor({ userId: null, keyHash: null, unlockId: "abc" }), "unlock/abc");
  assert.equal(bucketFor({ userId: "u1", keyHash: null, unlockId: "abc" }), "users/u1");
  assert.equal(bucketFor({ userId: null, keyHash: null }), null);
});
