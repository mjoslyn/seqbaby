// The shape of an invite code.
//
// Pure, so `node --test` runs it: lib/composeInvite.js imports nothing, for
// the reason every other module in this suite does. What it guards is the one
// thing three places have to agree on -- the panel, the route and the minting
// script all decide "is that a code" from this file, and a disagreement
// between them is a code that mints fine and is refused when typed.

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  INVITE_ALPHABET,
  INVITE_LEN,
  formatInviteCode,
  looksLikeInviteCode,
  makeInviteCode,
  normalizeInviteCode,
} from "../lib/composeInvite.js";

const code = () => makeInviteCode(randomBytes);

test("a minted code is one this app accepts", () => {
  for (let i = 0; i < 200; i++) {
    const c = code();
    assert.equal(c.length, INVITE_LEN);
    assert.ok(looksLikeInviteCode(c), `refused its own code: ${c}`);
    // Round trip through how it is written down and back, which is the path
    // every code actually takes: printed by the script, typed into the panel.
    assert.ok(looksLikeInviteCode(formatInviteCode(c)));
    assert.equal(normalizeInviteCode(formatInviteCode(c)), c);
  }
});

test("the alphabet leaves out the characters that get misread", () => {
  for (const ch of "01ilo") assert.ok(!INVITE_ALPHABET.includes(ch), `${ch} is in the alphabet`);
});

test("how a code was typed is not a different code", () => {
  const c = code();
  const pretty = formatInviteCode(c);
  for (const typed of [pretty, pretty.toUpperCase(), ` ${pretty} `, pretty.replace(/-/g, " "), c.toUpperCase()]) {
    assert.equal(normalizeInviteCode(typed), c, `typed as ${JSON.stringify(typed)}`);
    assert.ok(looksLikeInviteCode(typed));
  }
});

test("a typo is refused rather than read as some other code", () => {
  const c = code();
  assert.ok(!looksLikeInviteCode(c.slice(0, -1)), "short code accepted");
  assert.ok(!looksLikeInviteCode(`${c}a`), "long code accepted");
  // A character outside the alphabet is the interesting case: stripping it
  // instead of refusing would turn one person's typo into somebody else's
  // valid code, or into a short string that happens to pass.
  assert.ok(!looksLikeInviteCode(`${c.slice(0, -1)}!`), "punctuation accepted");
  assert.ok(!looksLikeInviteCode(`${c.slice(0, -1)}o`), "a character not in the alphabet accepted");
  for (const junk of ["", "   ", null, undefined, 42, {}, "sk-ant-nope"]) {
    assert.ok(!looksLikeInviteCode(junk), `accepted ${JSON.stringify(junk)}`);
  }
});

test("nothing enormous is carried to the server", () => {
  assert.ok(normalizeInviteCode("a".repeat(5000)).length <= 64);
});

test("codes do not repeat, and no letter is likelier than another", () => {
  // Rejection sampling rather than `% 31`: a modulo would make the first nine
  // letters of the alphabet 9/8ths as likely as the rest, which is a real
  // loss of entropy in a credential this short.
  const seen = new Set();
  const counts = new Map();
  for (let i = 0; i < 2000; i++) {
    const c = code();
    seen.add(c);
    for (const ch of c) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  assert.equal(seen.size, 2000, "a code came up twice in two thousand");
  assert.equal(counts.size, INVITE_ALPHABET.length, "some letters never came up");
  const expected = (2000 * INVITE_LEN) / INVITE_ALPHABET.length;
  for (const [ch, n] of counts) {
    assert.ok(n > expected * 0.75 && n < expected * 1.25, `${ch} came up ${n} times, expected ~${expected | 0}`);
  }
});
