// Subscription levels, and who runs the site.
//
// A plan is what an account is entitled to. It is stored on the profile
// (`plan`, `plan_until`, migration 0007) and set from the admin page; there is
// no payment flow yet, so a plan is granted by hand. What each one unlocks
// is the table below, read by the compose route and the studio page.
//
// Admins are not a plan: they are the emails on the deploy's ADMIN_EMAILS
// secret, so no button on any page can make someone one.
//
// Plain JS, no imports, for lib/composeModels.js's reasons: the route, the
// pages and `node --test` all read it.

/** The model a plan that names one runs every compose turn on. */
export const HAIKU = "claude-haiku-5-5";

/** A plan's monthly allowance is counted over a rolling 30 days. */
export const PLAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Every plan, cheapest first.
 * - `models`: what the compose menu adds (pro: sonnet and opus).
 * - `model`: the one model every turn runs on, whatever is asked for (null:
 *   the deploy's, or a pick from the menu).
 * - `turns`: compose turns per PLAN_WINDOW_MS (null: no monthly cap; the
 *   hourly limit in lib/composeJobs.js still applies).
 * A visitor with no account is not a plan: lib/freeCompose.js (10 a month,
 * Haiku).
 */
export const PLANS = [
  { id: "free", label: "free", models: [], model: HAIKU, turns: 50 },
  { id: "pro", label: "pro", models: ["claude-sonnet-5-5", "claude-opus-5-5"], model: null, turns: null },
];

export const DEFAULT_PLAN = "free";

/** The plan with this id, or null. */
export const planById = (id) => PLANS.find((p) => p.id === id) ?? null;

/**
 * The plan an account is on right now: its stored plan, unless that plan has a
 * `plan_until` in the past (it lapses to free), or names no plan there is.
 * @param {{ plan?: string | null, plan_until?: string | null } | null | undefined} row
 * @returns {{ id: string, label: string, models: string[], model: string | null, turns: number | null }}
 */
export function effectivePlan(row, now = Date.now()) {
  const free = PLANS[0];
  const p = planById(row?.plan ?? DEFAULT_PLAN);
  if (!p) return free;
  if (p.id !== DEFAULT_PLAN && row?.plan_until) {
    const until = Date.parse(row.plan_until);
    if (Number.isFinite(until) && until <= now) return free;
  }
  return p;
}

/** Whether an email is on ADMIN_EMAILS (comma, space or newline separated, case ignored). */
export function isAdminEmail(email, admins) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return String(admins || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}
