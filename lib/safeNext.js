// Where to send someone after they sign in: a path on this site, or the
// studio. Shared by the sign-in actions, the email-link callback
// (app/auth/confirm) and the buttons that send a signed-out visitor to log in
// (a heart, a remix, a patch save), so a visitor lands back where they were.
//
// Only a path: `new URL(next, origin)` takes an absolute URL (or a
// protocol-relative `//host`, or `/\host`, which browsers read the same way)
// over the origin, which would make sign-in an open redirect wearing the
// site's own domain. And never the login page itself, or the auth callback,
// which would loop. Pure, so `node --test` pins it (test/safeNext.test.js).

const FALLBACK = "/studio";

/** @param {unknown} next @returns {string} */
export function safeNext(next) {
  if (typeof next !== "string" || next.length > 2000) return FALLBACK;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return FALLBACK;
  if (/[\u0000-\u001f]/.test(next)) return FALLBACK;
  const path = next.split(/[?#]/)[0];
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/auth/")) return FALLBACK;
  return next;
}

/** The login page's URL for someone who should come back to `here`. */
export function loginHref(here) {
  const next = safeNext(here);
  return next === FALLBACK ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
