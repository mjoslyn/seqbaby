// Sign-in sends a visitor back where they came from, and never off the site.
import assert from "node:assert/strict";
import test from "node:test";
import { loginHref, safeNext } from "../lib/safeNext.js";

test("a path on this site is kept, query and all", () => {
  assert.equal(safeNext("/songs?q=acid&page=2"), "/songs?q=acid&page=2");
  assert.equal(safeNext("/u/mike"), "/u/mike");
  assert.equal(safeNext("/reset-password"), "/reset-password");
});

test("anything that could leave the site, or loop, is the studio", () => {
  for (const bad of [null, undefined, 3, "", "songs", "https://evil.example/", "//evil.example",
    "/\\evil.example", "/login", "/login?next=/songs", "/auth/confirm?x=1", "/a\nb", "/" + "x".repeat(2001)]) {
    assert.equal(safeNext(bad), "/studio", String(bad).slice(0, 40));
  }
});

test("the login link carries where to come back to", () => {
  assert.equal(loginHref("/songs?with=silverbox"), "/login?next=%2Fsongs%3Fwith%3Dsilverbox");
  assert.equal(loginHref("/studio"), "/login");
  assert.equal(loginHref("https://evil.example"), "/login");
});
