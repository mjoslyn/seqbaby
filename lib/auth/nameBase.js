// A username from whatever someone signed up with: the part of their email
// before the @. Ported from the Postgres function `name_base` (Supabase
// migration 0013), so an account made here gets the name it would have got
// there. Pure, so node --test runs it (test/nameBase.test.js).

const FROM = "áàâäãåāçćčéèêëēęíìîïīłñńóòôöõøōśšúùûüūýÿžźż";
const TO = "aaaaaaaccceeeeeeiiiiilnnooooooossuuuuuyyzzz";

/** The base a username is made from: lowercase a-z 0-9 _ -, 2 to 24 chars. */
export function nameBase(src) {
  let s = "";
  for (const ch of String(src ?? "").toLowerCase()) {
    const i = FROM.indexOf(ch);
    s += i >= 0 ? TO[i] : ch;
  }
  s = s.replace(/[^a-z0-9_-]+/g, "-");
  s = s.replace(/^[-_]+|[-_]+$/g, "").slice(0, 24);
  s = s.replace(/[-_]+$/g, "");
  if (s.length < 2) s = "user" + s;
  return s;
}

/** The n-th name to try when the base is taken (n from 2): `base-2` .. `base-50`,
 *  then a short hash of the user id so the loop always ends. */
export function nameCandidate(base, n, userId) {
  if (n <= 1) return base;
  if (n <= 50) return `${base}-${n}`;
  let h = 0;
  for (const ch of `${userId}${n}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${base.slice(0, 21)}-${h.toString(16).padStart(8, "0").slice(0, 8)}`;
}
