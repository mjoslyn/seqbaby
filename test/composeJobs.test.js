import test from "node:test";
import assert from "node:assert/strict";
import { MAX_IN_FLIGHT, MAX_PER_HOUR, STALE_MS, canReadJob, releaseSlot, takeSlot, usageOf } from "../lib/composeJobs.js";

// The arithmetic the compose Durable Objects run (workers/composeJob.ts). A
// usage bucket is one object, so its requests are taken one after another;
// what is tested here is what each one decides.

test("only MAX_IN_FLIGHT jobs run at once", () => {
  let rec;
  const made = [];
  for (let i = 0; i < 10; i++) {
    const next = takeSlot(rec, `j${i}`);
    if (next.error) continue;
    rec = next;
    made.push(i);
  }
  assert.equal(made.length, MAX_IN_FLIGHT);
});

test("finishing a job frees its slot", () => {
  let rec;
  for (const id of ["a", "b", "c"]) rec = takeSlot(rec, id);
  assert.ok(takeSlot(rec, "d").error);
  rec = releaseSlot(rec, "a");
  assert.ok(!takeSlot(rec, "d").error);
});

test("a slot whose job never reported back goes stale on its own", () => {
  const t0 = 1_000_000;
  let rec;
  for (const id of ["a", "b", "c"]) rec = takeSlot(rec, id, t0);
  assert.ok(takeSlot(rec, "d", t0 + 1000).error);
  assert.ok(!takeSlot(rec, "d", t0 + STALE_MS + 1).error);
});

test("an hour holds MAX_PER_HOUR starts, finished or not", () => {
  const t0 = 5_000_000;
  let rec;
  for (let i = 0; i < MAX_PER_HOUR; i++) {
    rec = takeSlot(rec, `j${i}`, t0 + i);
    assert.ok(!rec.error, `start ${i}`);
    rec = releaseSlot(rec, `j${i}`, t0 + i);
  }
  assert.match(takeSlot(rec, "one-more", t0 + MAX_PER_HOUR).error, /hour/);
  assert.equal(usageOf(rec, t0 + 60 * 60 * 1000 + MAX_PER_HOUR + 1).started.length, 0);
});

test("a job is read with its view token or by its account, and by nobody else", () => {
  const p = { userId: "owner", viewToken: "tok" };
  assert.equal(canReadJob(p, { token: "tok" }), true);
  assert.equal(canReadJob(p, { userId: "owner" }), true);
  assert.equal(canReadJob(p, { token: "wrong" }), false);
  assert.equal(canReadJob(p, { userId: "someone-else" }), false);
  assert.equal(canReadJob(p, {}), false);
});
