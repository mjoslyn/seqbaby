// The brought-key half of compose: what counts as a key, what is shown back,
// and who may read a job when there is no account to check against.
//
// Both modules are plain JS with no DOM and no Next, for the reasons the
// engine's pure modules are, so node --test exercises them directly.

import test from "node:test";
import assert from "node:assert/strict";
import { describeTurnFailure, looksLikeApiKey, maskApiKey, MAX_KEY_LEN } from "../lib/composeKey.js";
import { canReadJob, createJob, getJobInput, getJobProgress, hashApiKey } from "../lib/composeJobs.js";

const KEY = "sk-ant-api03-" + "a".repeat(80) + "_-AA";

test("a key is recognised by shape, and a near miss is not", () => {
  assert.equal(looksLikeApiKey(KEY), true);
  assert.equal(looksLikeApiKey(`  ${KEY}  `), true, "a pasted key carries whitespace");

  assert.equal(looksLikeApiKey(""), false);
  assert.equal(looksLikeApiKey("   "), false);
  assert.equal(looksLikeApiKey("sk-ant-"), false, "prefix alone is not a key");
  assert.equal(looksLikeApiKey("sk-proj-" + "a".repeat(40)), false, "another vendor's key");
  assert.equal(looksLikeApiKey(KEY.replace("sk-ant-", "")), false);
  assert.equal(looksLikeApiKey(`sk-ant-${"a".repeat(MAX_KEY_LEN)}`), false, "refused before it is carried");
  assert.equal(looksLikeApiKey(null), false);
  assert.equal(looksLikeApiKey(undefined), false);
  assert.equal(looksLikeApiKey({ toString: () => KEY }), false, "only a string is a key");
  // A key with a newline in it is a key plus something else; the API would
  // reject it, and the whole point of the check is to say so here.
  assert.equal(looksLikeApiKey(`${KEY}\nexport FOO=1`), false);
});

test("a masked key names itself and nothing more", () => {
  const shown = maskApiKey(KEY);
  assert.match(shown, /AA$/, "enough to tell two keys apart");
  assert.equal(shown.includes(KEY.slice(7, 40)), false, "never the body of the key");
  assert.ok(shown.length < 20);
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey(undefined), "");
});

test("a key hash is stable, distinct, and not the key", () => {
  const h = hashApiKey(KEY);
  assert.equal(h, hashApiKey(KEY), "the same key must land in the same bucket");
  assert.notEqual(h, hashApiKey(KEY + "x"));
  assert.equal(h.includes(KEY.slice(-8)), false);
  assert.equal(/^[A-Za-z0-9_-]+$/.test(h), true, "usable as a blob key");
});

test("a job is readable by its token, or by the account that owns it", () => {
  const job = { userId: "user-1", viewToken: "tok-1" };
  assert.equal(canReadJob(job, { token: "tok-1" }), true);
  assert.equal(canReadJob(job, { userId: "user-1" }), true);

  assert.equal(canReadJob(job, { token: "tok-2" }), false);
  assert.equal(canReadJob(job, { token: "" }), false);
  assert.equal(canReadJob(job, { userId: "user-2" }), false);
  assert.equal(canReadJob(job, {}), false);
  assert.equal(canReadJob(null, { token: "tok-1" }), false);

  // A signed-out visitor's job: the token is the only way in, and an account
  // that happens to be signed in somewhere else is not one.
  const anon = { userId: null, keyHash: "abc", viewToken: "tok-3" };
  assert.equal(canReadJob(anon, { token: "tok-3" }), true);
  assert.equal(canReadJob(anon, { userId: "user-1" }), false);
  // A job written before view tokens existed still reaches its owner.
  assert.equal(canReadJob({ userId: "user-1" }, { userId: "user-1" }), true);
  assert.equal(canReadJob({ userId: "user-1" }, { token: "anything" }), false);
});

test("a job started on a brought key records the hash and not the key", async () => {
  const keyHash = hashApiKey(KEY);
  const { id, token, viewToken, error } = await createJob({
    userId: null,
    keyHash,
    message: "make me a techno beat",
    history: [],
    session: null,
    model: "claude-sonnet-5",
  });
  assert.equal(error, undefined);
  assert.ok(id && token && viewToken);
  assert.notEqual(token, viewToken, "the worker's secret is not the browser's");

  const input = await getJobInput(id);
  assert.equal(input.keyHash, keyHash);
  assert.equal(input.userId, null);
  assert.equal(JSON.stringify(input).includes(KEY), false, "the key itself never reaches the store");

  const progress = await getJobProgress(id);
  assert.equal(progress.status, "running");
  assert.equal(canReadJob(progress, { token: viewToken }), true);
  assert.equal(canReadJob(progress, { token: "guessed" }), false);
});

test("one key may not park unbounded turns on the worker", async () => {
  const keyHash = hashApiKey(`${KEY}-limits`);
  const start = () => createJob({ userId: null, keyHash, message: "hi", history: [], session: null });
  const made = [await start(), await start(), await start()];
  for (const m of made) assert.ok(m.id, "the first three run");
  const fourth = await start();
  assert.equal(fourth.id, undefined);
  assert.match(fourth.error, /running/);
});

test("a failed turn says which of the three things went wrong, and whose", () => {
  const auth = new Error('401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}');
  assert.match(describeTurnFailure(auth, true), /wouldn't accept that key/);
  assert.match(describeTurnFailure(auth, false), /this site's/);

  assert.match(describeTurnFailure(new Error("400 credit balance is too low"), true), /out of credit/);
  assert.match(describeTurnFailure(new Error("429 rate_limit_error"), true), /rate limiting/);
  assert.match(describeTurnFailure(new Error("529 overloaded_error"), true), /overloaded/);

  // Anything else keeps its own message: a real bug has to stay debuggable.
  assert.equal(describeTurnFailure(new Error("socket hang up"), true), "compose failed: socket hang up");
  assert.equal(describeTurnFailure("plain string", false), "compose failed: plain string");
});
