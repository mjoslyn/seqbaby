import test from "node:test";
import assert from "node:assert/strict";
import { putShare, getShare, getShareMeta } from "../lib/api.js";

// @netlify/blobs isn't installed in this environment (nor most CI runs of
// this suite), so every call here exercises lib/api.js's in-memory fallback
// -- the same code path a plain `node server.js` or `next dev` takes with no
// Netlify context. That's deliberate: it's the one guaranteed-available path.

test("a share is tagged with a generated title and, when given one, an owner", async () => {
  const session = { bpm: 128, tracks: [{ engineKey: "dm:silverbox", patterns: [] }] };
  const { id } = await putShare({ session, ownerId: "user-1" });
  const meta = await getShareMeta({ id });
  assert.equal(typeof meta.title, "string");
  assert.ok(meta.title.length > 0);
  assert.equal(meta.ownerId, "user-1");

  const full = await getShare({ id });
  assert.deepEqual(full.session, session);
  assert.equal(full.title, meta.title);
  assert.equal(full.ownerId, "user-1");
});

test("an anonymous share still gets a title, but no owner", async () => {
  const { id } = await putShare({ session: { bpm: 90, tracks: [] } });
  const meta = await getShareMeta({ id });
  assert.equal(typeof meta.title, "string");
  assert.equal(meta.ownerId, null);
});

test("a given title is trusted, not regenerated from the session", async () => {
  const session = { bpm: 128, tracks: [{ engineKey: "dm:silverbox", patterns: [] }] };
  const { id } = await putShare({ session, title: "riot operator" });
  const meta = await getShareMeta({ id });
  assert.equal(meta.title, "riot operator");
});

test("an untitled or blank given title still falls back to a generated one", async () => {
  const session = { bpm: 128, tracks: [] };
  const { id: idUntitled } = await putShare({ session, title: "untitled" });
  const { id: idBlank } = await putShare({ session, title: "  " });
  const metaUntitled = await getShareMeta({ id: idUntitled });
  const metaBlank = await getShareMeta({ id: idBlank });
  assert.notEqual(metaUntitled.title.toLowerCase(), "untitled");
  assert.ok(metaUntitled.title.length > 0);
  assert.equal(metaUntitled.title, metaBlank.title);
});

test("the same session names itself the same thing twice", async () => {
  const session = { bpm: 140, tracks: [] };
  const a = await putShare({ session });
  const b = await putShare({ session });
  const metaA = await getShareMeta({ id: a.id });
  const metaB = await getShareMeta({ id: b.id });
  assert.equal(metaA.title, metaB.title);
});

test("a bad or unknown id resolves to no metadata, not a throw", async () => {
  assert.equal(await getShareMeta({ id: null }), null);
  assert.equal(await getShareMeta({ id: "not-a-real-share-id" }), null);
});

test("putShare rejects a non-object session", async () => {
  await assert.rejects(() => putShare({ session: null }));
  await assert.rejects(() => putShare({ session: "nope" }));
});
