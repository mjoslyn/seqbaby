// An invite code: a way in to the site's key with no account and no key of
// your own.
//
// The compose panel had two ways to pay for a turn and neither suits handing
// the thing to someone. The deploy's key needs an ACCOUNT, which is a signup
// in the way of a demo; a key of your own needs a console, a card and five
// minutes. An invite code is the third: a string the site's owner mints and
// hands out, which buys a bounded number of turns on the deploy's key and
// nothing else. No account, nothing to install, and a cap that means a code
// that leaks costs what it was minted for rather than a month's bill.
//
// This file is the SHAPE of a code and nothing else -- what may be typed,
// what it looks like written down. It is plain JS with no imports for
// lib/composeKey.js's reasons: it is read by a client component (bundled by
// Next), by the routes (Node runtime) and by the minting script (plain Node),
// and nothing here may assume any of those three. In particular no
// node:crypto -- hashing a code is a server matter and lives beside the other
// hash, in lib/composeJobs.js.
//
// Whether a code is a code that this site knows is Postgres's answer, not
// this file's (migration 0012). Everything here is the typo check.

/** The alphabet a code is drawn from: lower case, no `0` `1` `i` `l` `o`.
 *  A code is read off a screen and typed into a phone by someone who did not
 *  choose it, so the pairs that get misread are simply not in it. */
export const INVITE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** How many characters carry the secret. 31^12 is ~7.8e17 codes, which is
 *  enough that guessing one is not a strategy, and short enough to read out
 *  loud in three groups of four. */
export const INVITE_LEN = 12;

const RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LEN}}$`);

/**
 * What was typed, as the one string everything else means by "that code".
 *
 * Hyphens are how a code is PRINTED, never what it is, so they come out here
 * along with spaces and case -- somebody will type `SEQ` in caps, or paste a
 * code with a line break in the middle of it, and neither is a different
 * code. Anything still outside the alphabet is left in place so that
 * `looksLikeInviteCode` refuses it rather than silently accepting a typo as
 * some other, valid, code.
 */
export function normalizeInviteCode(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "").slice(0, 64);
}

/** Whether a normalized code could be one at all. A typo check, run in the
 *  panel and again in the route, so a missing character is caught in the box
 *  it was typed into. */
export const looksLikeInviteCode = (raw) => RE.test(normalizeInviteCode(raw));

/** How a code is written down: three groups of four. The only place the
 *  hyphens exist. */
export function formatInviteCode(raw) {
  const s = normalizeInviteCode(raw);
  return s.length === INVITE_LEN ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : s;
}

/** A code minted from the caller's random bytes.
 *
 *  The randomness is passed IN rather than taken, because the two callers
 *  have different ones -- `crypto.randomBytes` in the minting script, and
 *  nothing else should be minting at all -- and this file may not import
 *  node:crypto (see the top). Rejection sampling rather than `% 31`, which
 *  would make the first nine letters of the alphabet likelier than the rest.
 *
 *  @param bytes a function taking a count and returning that many random
 *               bytes (Uint8Array or Buffer)
 */
export function makeInviteCode(bytes) {
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  let out = "";
  while (out.length < INVITE_LEN) {
    for (const b of bytes(INVITE_LEN * 2)) {
      if (b >= limit) continue;
      out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
      if (out.length === INVITE_LEN) break;
    }
  }
  return out;
}
