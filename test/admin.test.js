// The admin page's data layer and its rules: plans (and their lapsing),
// suspensions (which stop sign-in), signing out, deleting, and the log.

import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/cf.js";
import { createProfile, makeAuth } from "../lib/auth/config.js";
import * as admin from "../lib/data/admin.js";
import { PLANS, effectivePlan, isAdminEmail, planById } from "../lib/plans.js";
import { allowedModels } from "../lib/composeModels.js";

async function user(env, id, email) {
  env.DB.sqlite
    .prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, '', ?, 1, ?, ?)`)
    .run(id, email, new Date().toISOString(), new Date().toISOString());
  await createProfile(env.DB, { id, email });
  return id;
}

const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";

async function world() {
  const env = makeEnv();
  await user(env, A, "boss@example.com");
  await user(env, B, "someone@example.com");
  return env;
}

test("admins are the emails on ADMIN_EMAILS, nobody else", () => {
  assert.ok(isAdminEmail("Boss@Example.com", "boss@example.com, other@example.com"));
  assert.ok(isAdminEmail("other@example.com", "boss@example.com\nother@example.com"));
  assert.ok(!isAdminEmail("someone@example.com", "boss@example.com"));
  assert.ok(!isAdminEmail("boss@example.com", ""));
  assert.ok(!isAdminEmail("", "boss@example.com"));
});

test("a plan lapses to free after its until, and an unknown plan reads as free", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  assert.equal(effectivePlan(null).id, "free");
  assert.equal(effectivePlan({ plan: "pro" }, now).id, "pro");
  assert.equal(effectivePlan({ plan: "pro", plan_until: "2026-12-01T00:00:00Z" }, now).id, "pro");
  assert.equal(effectivePlan({ plan: "pro", plan_until: "2026-11-01T00:00:00Z" }, now).id, "free");
  assert.equal(effectivePlan({ plan: "gold" }, now).id, "free");
  assert.equal(PLANS[0].id, "free", "free is first: the fallback");
});

test("pro adds sonnet and opus to the compose menu, as an unlock does", () => {
  assert.deepEqual(planById("pro").models, ["claude-sonnet-5-5", "claude-opus-5-5"]);
  const ids = allowedModels({ unlocked: planById("pro").models.length > 0, defaultModel: "claude-haiku-5-5" }).map((m) => m.id);
  assert.deepEqual(ids, ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.equal(allowedModels({ picker: true }).length, 4, "an admin picks from all four");
});

test("setting a plan is stored, validated, cleared for free, and logged", async () => {
  const env = await world();
  assert.equal((await admin.setPlan(env, A, B, "gold")).error, "no such plan");
  assert.equal((await admin.setPlan(env, A, B, "pro", "not a date")).error, "that date doesn't read as a date");
  assert.ok((await admin.setPlan(env, A, B, "pro", "2027-01-01")).ok);
  let row = await admin.planRow(env, B);
  assert.equal(row.plan, "pro");
  assert.equal(row.plan_until, "2027-01-01T00:00:00.000Z");
  assert.ok((await admin.setPlan(env, A, B, "free", "2027-01-01")).ok);
  row = await admin.planRow(env, B);
  assert.equal(row.plan, "free");
  assert.equal(row.plan_until, null, "free has no end date");
  const log = await admin.adminLog(env);
  assert.equal(log[0].action, "plan");
  assert.equal(log[0].detail, "free");
  assert.equal(log[1].detail, "pro until 2027-01-01");
  assert.equal(log[0].admin, "boss@example.com");
  assert.equal(log[0].target, "someone@example.com");
});

test("the list searches, filters by plan and suspension, and counts", async () => {
  const env = await world();
  await admin.setPlan(env, A, B, "pro");
  let r = await admin.listUsers(env, {});
  assert.equal(r.users.length, 2);
  r = await admin.listUsers(env, { q: "SOMEONE" });
  assert.deepEqual(r.users.map((u) => u.id), [B]);
  assert.equal(r.users[0].plan, "pro");
  assert.equal(r.users[0].effective_plan, "pro");
  r = await admin.listUsers(env, { q: "100%_" });
  assert.equal(r.users.length, 0, "a % or _ in the search is a character, not a wildcard");
  r = await admin.listUsers(env, { plan: "pro" });
  assert.deepEqual(r.users.map((u) => u.id), [B]);
  await admin.setSuspended(env, A, B, true);
  r = await admin.listUsers(env, { suspended: true });
  assert.deepEqual(r.users.map((u) => u.id), [B]);
  const stats = await admin.adminStats(env);
  assert.deepEqual(stats, { users: 2, new_7d: 2, paid: 1, suspended: 1, turns_7d: 0 });
});

test("an admin cannot suspend or delete their own account", async () => {
  const env = await world();
  assert.match((await admin.setSuspended(env, A, A, true)).error, /own account/);
  assert.match((await admin.deleteUser(env, A, A)).error, /own account/);
  assert.equal((await admin.setPlan(env, A, "nobody", "pro")).error, "no such account");
});

test("deleting an account takes the user row, its profile and its R2 data, and is logged", async () => {
  const env = await world();
  env.DB.sqlite.prepare(`insert into songs (id, owner_id, title, data) values ('s1', ?, 't', '{}')`).run(B);
  await env.BLOBS.put("songs/s1/samples/x", "abc");
  assert.ok((await admin.deleteUser(env, A, B)).ok);
  assert.equal(env.DB.sqlite.prepare(`select count(*) n from "user" where id = ?`).get(B).n, 0);
  assert.equal(env.DB.sqlite.prepare(`select count(*) n from profiles where id = ?`).get(B).n, 0);
  assert.equal(await env.BLOBS.get("songs/s1/samples/x"), null);
  const log = await admin.adminLog(env);
  assert.equal(log[0].action, "delete");
  assert.equal(log[0].target, "someone@example.com", "the log still says who, after they are gone");
});

test("a suspended account is signed out and cannot sign in until unsuspended", async () => {
  const env = makeEnv();
  const auth = makeAuth({
    database: env.DB,
    secret: "test-secret-0123456789-abcdefghijklmnop",
    baseURL: "http://localhost:3000",
    sendMail: async () => {},
    withNextCookies: false,
  });
  await auth.api.signUpEmail({ body: { email: "s@example.com", password: "secret1", name: "" } });
  env.DB.sqlite.prepare(`update "user" set emailVerified = 1`).run();
  const id = env.DB.sqlite.prepare(`select id from "user"`).get().id;
  await user(env, A, "boss@example.com");
  const signIn = () => auth.api.signInEmail({ body: { email: "s@example.com", password: "secret1" } });

  await signIn();
  const sessions = () => env.DB.sqlite.prepare(`select count(*) n from session where userId = ?`).get(id).n;
  assert.ok(sessions() > 0);

  assert.ok((await admin.setSuspended(env, A, id, true)).ok);
  assert.equal(sessions(), 0, "suspending ends every session");
  await assert.rejects(signIn(), (e) => e.body?.code === "SUSPENDED");

  const out = await admin.signOutEverywhere(env, A, id);
  assert.equal(out.sessions, 0);

  assert.ok((await admin.setSuspended(env, A, id, false)).ok);
  await signIn();
  assert.ok(sessions() > 0);
  assert.equal((await admin.signOutEverywhere(env, A, id)).sessions, 1);
  assert.deepEqual((await admin.adminLog(env)).map((l) => l.action), ["signout", "unsuspend", "signout", "suspend"]);
});
