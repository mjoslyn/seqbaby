// Accounts (lib/auth/config.js): Better Auth over the real schema on
// node:sqlite, with mail captured instead of sent.

import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { makeD1 } from "./helpers/cf.js";
import { makeAuth } from "../lib/auth/config.js";
import { nameBase, nameCandidate } from "../lib/auth/nameBase.js";

function setup() {
  const db = makeD1();
  const mail = [];
  const auth = makeAuth({
    database: db,
    secret: "test-secret-0123456789-abcdefghijklmnop",
    baseURL: "http://localhost:3000",
    sendMail: async (m) => void mail.push(m),
    withNextCookies: false,
  });
  return { db, mail, auth };
}

const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];

test("sign up needs the emailed link before it can sign in, and makes a profile", async () => {
  const { db, mail, auth } = setup();
  await auth.api.signUpEmail({ body: { email: "New.Person@example.com", password: "secret1", name: "" } });
  const profile = db.sqlite.prepare("select username from profiles").get();
  assert.equal(profile.username, "new-person");

  await assert.rejects(
    auth.api.signInEmail({ body: { email: "new.person@example.com", password: "secret1" } }),
    (e) => e.body?.code === "EMAIL_NOT_VERIFIED",
  );
  const link = mail.find((m) => /confirm/.test(m.subject)).url;
  const res = await auth.handler(new Request(link));
  assert.equal(res.status, 302);
  const ok = await auth.api.signInEmail({ body: { email: "new.person@example.com", password: "secret1" }, asResponse: true });
  assert.equal(ok.status, 200);
  const s = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(ok) }) });
  assert.equal(s.user.email, "new.person@example.com");
});

test("a password carried over from Supabase (bcrypt) still signs in", async () => {
  const { db, auth } = setup();
  const id = "11111111-1111-4111-8111-111111111111";
  const now = new Date().toISOString();
  db.sqlite
    .prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, '', 'old@example.com', 1, ?, ?)`)
    .run(id, now, now);
  db.sqlite
    .prepare(`insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt) values (?, ?, 'credential', ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), id, id, bcrypt.hashSync("hunter22", 10), now, now);
  const ok = await auth.api.signInEmail({ body: { email: "old@example.com", password: "hunter22" }, asResponse: true });
  assert.equal(ok.status, 200);
  await assert.rejects(auth.api.signInEmail({ body: { email: "old@example.com", password: "wrong!!" } }));
});

test("a magic link signs in, making the account (and its profile) the first time", async () => {
  const { db, mail, auth } = setup();
  await auth.api.signInMagicLink({ body: { email: "magic@example.com", callbackURL: "/studio" }, headers: new Headers() });
  const link = mail.find((m) => /sign-in link/.test(m.subject)).url;
  const res = await auth.handler(new Request(link));
  assert.ok([200, 302].includes(res.status));
  assert.match(res.headers.get("set-cookie") || "", /session_token/);
  assert.equal(db.sqlite.prepare("select username from profiles").get().username, "magic");
});

test("a reset link sets a new password, once", async () => {
  const { db, mail, auth } = setup();
  await auth.api.signUpEmail({ body: { email: "r@example.com", password: "first1", name: "" } });
  db.sqlite.prepare(`update "user" set emailVerified = 1`).run();
  await auth.api.requestPasswordReset({ body: { email: "r@example.com", redirectTo: "/reset-password" } });
  const link = mail.find((m) => /reset/.test(m.subject)).url;
  const landing = await auth.handler(new Request(link));
  const to = new URL(landing.headers.get("location"), "http://localhost:3000");
  assert.equal(to.pathname, "/reset-password");
  const token = to.searchParams.get("token");
  await auth.api.resetPassword({ body: { newPassword: "second2", token } });
  await assert.rejects(auth.api.resetPassword({ body: { newPassword: "third33", token } }), "a token works once");
  const ok = await auth.api.signInEmail({ body: { email: "r@example.com", password: "second2" }, asResponse: true });
  assert.equal(ok.status, 200);
});

test("usernames are made the way Supabase made them", () => {
  assert.equal(nameBase("José.Ñúñez"), "jose-nunez");
  assert.equal(nameBase("a"), "usera");
  assert.equal(nameBase("--x__"), "userx");
  assert.equal(nameBase("x".repeat(40)).length, 24);
  assert.equal(nameCandidate("mike", 1, "id"), "mike");
  assert.equal(nameCandidate("mike", 2, "id"), "mike-2");
  assert.match(nameCandidate("mike", 51, "id"), /^mike-[0-9a-f]{8}$/);
});
