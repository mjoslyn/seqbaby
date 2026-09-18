// Whose key a compose turn runs on.
//
// Two ways one gets paid for. The DEPLOY's key (ANTHROPIC_API_KEY), which
// needs an account and is rate limited per account because the spend is the
// site's; or the visitor's OWN key, typed into the panel, which needs no
// account at all because the spend is theirs. The second is the only way a
// signed-out visitor composes, and the only way anyone composes on a deploy
// with no key of its own.
//
// A brought key is never stored on the server. It rides the request that
// starts a turn, is handed straight to the worker that runs it, and lives
// nowhere else -- in particular NOT in the job record, which is a Netlify
// Blob that outlives the turn by design (see lib/composeJobs.js).
//
// Plain JS with no imports, for lib/composeModels.js's reasons: it is read by
// a client component (bundled by Next), by the route (Node runtime) and by
// the Netlify worker (bundled outside Next entirely), and nothing here may
// assume any of those three.

/** Longest key we will carry. Anthropic's run to ~110 characters; this is
 *  only here so a paste of something enormous is refused in the box it was
 *  pasted into rather than somewhere a worker has to report on. */
export const MAX_KEY_LEN = 300;

const SHAPE = /^sk-ant-[A-Za-z0-9_-]{16,}$/;

/** Where a visitor makes one. */
export const API_KEY_CONSOLE_URL = "https://console.anthropic.com/settings/keys";

/**
 * Whether a string is SHAPED like an Anthropic API key.
 *
 * Only Anthropic can say whether a key works, and this deliberately does not
 * try: it is a typo check, run in the panel and again in the route, so a
 * missing character fails in the field it was typed into instead of two
 * minutes later as a job that couldn't authenticate.
 */
export function looksLikeApiKey(k) {
  if (typeof k !== "string") return false;
  const s = k.trim();
  return s.length <= MAX_KEY_LEN && SHAPE.test(s);
}

/** How a remembered key is shown back: enough to recognise which one it is,
 *  never enough to use. */
export function maskApiKey(k) {
  const s = typeof k === "string" ? k.trim() : "";
  if (!s) return "";
  return `sk-ant-…${s.slice(-4)}`;
}

/**
 * What to tell someone when a turn died inside the Anthropic call.
 *
 * The three things that go wrong with a key of your own -- it is not a key
 * any more, it has no credit, it is being used too hard -- are all reported
 * as an HTTP error with a JSON body, and pasting that at somebody is no
 * answer: what they need to know is which of the three it was and that it is
 * theirs to fix. Anything unrecognised keeps its message, which is what makes
 * a real bug still debuggable.
 *
 * @param err the thrown error
 * @param brought whether the turn ran on the visitor's own key
 */
export function describeTurnFailure(err, brought) {
  const msg = String(err?.message ?? err);
  if (/authentication_error|invalid x-api-key|API key is invalid|\b401\b/i.test(msg)) {
    return brought
      ? "Anthropic wouldn't accept that key — check it, or make a new one."
      : "this site's Anthropic key was rejected.";
  }
  if (/credit balance|insufficient|billing|payment/i.test(msg)) {
    return brought
      ? "your Anthropic account is out of credit for that key."
      : "this site's Anthropic account is out of credit.";
  }
  if (/rate_limit|\b429\b/i.test(msg)) {
    return brought
      ? "Anthropic is rate limiting that key — give it a minute."
      : "this site's key is being used too hard right now — give it a minute.";
  }
  if (/overloaded|\b529\b/i.test(msg)) return "Anthropic is overloaded right now — try that again shortly.";
  return `compose failed: ${msg}`;
}
