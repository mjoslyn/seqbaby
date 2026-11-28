// Cloudflare Turnstile's server half: whether a token the browser got from the
// widget is a real pass. Plain JS, fetch only.
//
// No secret means no check (local dev): true. With one, a missing or failed
// token, or siteverify being unreachable, is false.

/**
 * @param {string | undefined} secret TURNSTILE_SECRET_KEY
 * @param {unknown} token the widget's token
 * @param {string | null} [ip] the visitor's address, when known
 */
export async function turnstilePasses(secret, token, ip = null) {
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    return data?.success === true;
  } catch {
    return false;
  }
}
