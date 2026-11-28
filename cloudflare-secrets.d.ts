// The Worker's secrets and plain vars, which `wrangler types` cannot see
// (they live in the dashboard / `wrangler secret put`, or .dev.vars locally).
// The bindings themselves are in cloudflare-env.d.ts, generated from
// wrangler.jsonc by `npm run cf-typegen`.

interface CloudflareEnv {
  /** Signs Better Auth's session cookies. Required in production. */
  BETTER_AUTH_SECRET?: string;
  /** The site's own origin, e.g. https://www.playseqbaby.com. Optional: the request's is used otherwise. */
  BETTER_AUTH_URL?: string;
  /** Who auth email comes from, e.g. "seqbaby <hello@playseqbaby.com>". */
  EMAIL_FROM?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  /** Emails allowed to pick their compose model (comma or space separated). */
  COMPOSE_MODEL_PICKERS?: string;
  /** Emails that may open /admin (comma or space separated): accounts, plans,
   *  suspensions (lib/plans.js, lib/data/admin.js). */
  ADMIN_EMAILS?: string;
  /** The unlock code (lib/unlock.js): /studio?unlock=<code> lets compose run
   *  without an account and offers sonnet and opus. Rotate it to cut off every
   *  link and cookie handed out under the old one. */
  COMPOSE_UNLOCK_CODE?: string;
  /** Free compose with no account (lib/freeCompose.js): turns per visitor per
   *  window (default 10, "0" switches it off), the window in days (30), turns
   *  per IP per day (20), turns for the whole site per day (2000), and the
   *  secret the visitor cookie is signed with (else BETTER_AUTH_SECRET).
   *  A daily cap of 0 allows no free turns at all; it never means "no cap". */
  COMPOSE_FREE_TURNS?: string;
  COMPOSE_FREE_WINDOW_DAYS?: string;
  COMPOSE_FREE_IP_PER_DAY?: string;
  COMPOSE_FREE_SITE_PER_DAY?: string;
  COMPOSE_FREE_SECRET?: string;
  /** A freesound.org API key (lib/freesound.js): sound search in the sampler's
   *  picker and in a compose turn. Without it neither is offered. */
  FREESOUND_API_KEY?: string;
  GITHUB_ISSUES_TOKEN?: string;
  GITHUB_ISSUES_REPO?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Turns on /api/admin/import for the move from Supabase. Delete it after. */
  MIGRATION_TOKEN?: string;
}
