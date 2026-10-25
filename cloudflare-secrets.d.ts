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
  GITHUB_ISSUES_TOKEN?: string;
  GITHUB_ISSUES_REPO?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Turns on /api/admin/import for the move from Supabase. Delete it after. */
  MIGRATION_TOKEN?: string;
}
