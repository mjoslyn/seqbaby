import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_MODEL,
  dropDaily,
  dropWindow,
  freeConfig,
  hashIp,
  mintFree,
  readFree,
  takeDaily,
  takeWindow,
  windowLeft,
} from "../lib/freeCompose.js";

const DAY = 24 * 60 * 60 * 1000;

test("free compose is on with a secret and a turn count, off without either", () => {
  const on = freeConfig({ BETTER_AUTH_SECRET: "s" });
  assert.equal(on.on, true);
  assert.equal(on.turns, 10);
  assert.equal(on.windowMs, 30 * DAY);
  assert.equal(on.ipPerDay, 20);
  assert.equal(on.sitePerDay, 2000);
  assert.equal(freeConfig({}).on, false, "no secret, no free turns");
  assert.equal(freeConfig({ BETTER_AUTH_SECRET: "s", COMPOSE_FREE_TURNS: "0" }).on, false);
  assert.equal(freeConfig({ COMPOSE_FREE_SECRET: "a", BETTER_AUTH_SECRET: "b" }).secret, "a");
  assert.equal(freeConfig({ BETTER_AUTH_SECRET: "s", COMPOSE_FREE_TURNS: "junk" }).turns, 10);
  assert.equal(FREE_MODEL, "claude-haiku-5-5");
});

test("a visitor cookie reads back under its secret only, and every visitor is new", async () => {
  const v = await mintFree("one");
  const id = await readFree(v, "one");
  assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(await readFree(v, "two"), null);
  const [vid, sig] = v.split(".");
  assert.equal(await readFree(`${vid}x.${sig}`, "one"), null);
  assert.equal(await readFree("garbage", "one"), null);
  assert.equal(await readFree(undefined, "one"), null);
  assert.notEqual(await readFree(await mintFree("one"), "one"), id);
});

test("an address hashes the same every time, and never to itself", async () => {
  const a = await hashIp("203.0.113.9", "s");
  assert.equal(a, await hashIp("203.0.113.9", "s"));
  assert.notEqual(a, await hashIp("203.0.113.10", "s"));
  assert.notEqual(a, await hashIp("203.0.113.9", "t"));
  assert.ok(!a.includes("203"));
});

test("a visitor gets N turns in the window, then none, then more as old ones age out", () => {
  const t0 = 1_000_000_000_000;
  let rec = [];
  for (let i = 0; i < 10; i++) {
    const r = takeWindow(rec, `j${i}`, 10, 30 * DAY, t0 + i);
    assert.ok(!("error" in r));
    assert.equal(r.left, 9 - i);
    rec = r.rec;
  }
  assert.deepEqual(takeWindow(rec, "j10", 10, 30 * DAY, t0 + 20), { error: "limit", left: 0 });
  assert.equal(windowLeft(rec, 10, 30 * DAY, t0 + 20), 0);
  // a turn that never started is given back
  assert.equal(windowLeft(dropWindow(rec, "j3"), 10, 30 * DAY, t0 + 20), 1);
  // a month later the window has moved on
  assert.equal(windowLeft(rec, 10, 30 * DAY, t0 + 31 * DAY), 10);
  assert.ok(!("error" in takeWindow(rec, "j11", 10, 30 * DAY, t0 + 31 * DAY)));
});

test("a daily count stops at its limit, gives back, and starts over the next UTC day", () => {
  const t0 = Date.UTC(2026, 10, 28, 12);
  let rec = null;
  for (let i = 0; i < 3; i++) rec = takeDaily(rec, 3, t0).rec;
  assert.deepEqual(rec, { day: "2026-11-28", n: 3 });
  assert.deepEqual(takeDaily(rec, 3, t0), { error: "limit" });
  rec = dropDaily(rec, t0);
  assert.equal(rec.n, 2);
  assert.ok(!("error" in takeDaily(rec, 3, t0)));
  assert.deepEqual(takeDaily({ day: "2026-11-28", n: 3 }, 3, t0 + DAY).rec, { day: "2026-11-29", n: 1 });
  assert.deepEqual(dropDaily({ day: "2026-11-27", n: 5 }, t0), { day: "2026-11-27", n: 5 }, "yesterday's count is left alone");
  assert.deepEqual(dropDaily({ day: "2026-11-28", n: 0 }, t0), { day: "2026-11-28", n: 0 });
});
