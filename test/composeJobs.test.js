import test from "node:test";
import assert from "node:assert/strict";
import { createJob, finishJob, getJobProgress, canReadJob } from "../lib/composeJobs.js";

// No Netlify context here, so this is the in-memory path -- the limits and the
// read check are the same code either way; only the store differs.

const job = (userId) => createJob({ userId, keyHash: null, message: "m", history: [], session: {} });

test("requests sent together cannot pass the in-flight limit", async () => {
  const made = await Promise.all(Array.from({ length: 10 }, () => job("racer")));
  assert.equal(made.filter((j) => j.id).length, 3);
  assert.equal(made.filter((j) => j.error).length, 7);
});

test("finishing a job frees its slot", async () => {
  const made = await Promise.all([job("u2"), job("u2"), job("u2")]);
  assert.ok((await job("u2")).error);
  await finishJob(made[0].id, { status: "done" });
  assert.ok((await job("u2")).id);
});

test("a job is read with its view token or by its account, and by nobody else", async () => {
  const { id, viewToken } = await job("owner");
  const p = await getJobProgress(id);
  assert.equal(canReadJob(p, { token: viewToken }), true);
  assert.equal(canReadJob(p, { userId: "owner" }), true);
  assert.equal(canReadJob(p, { token: "wrong" }), false);
  assert.equal(canReadJob(p, { userId: "someone-else" }), false);
  assert.equal(canReadJob(p, {}), false);
});
