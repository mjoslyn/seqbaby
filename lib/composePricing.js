// What a compose turn cost, from the token counts the API reported.
//
// US dollars per million tokens, Anthropic's first-party rates. A cache write
// is the 5-minute kind (1.25x input). Haiku 5.5 doubles past a 100K-token
// prompt; a compose round stays well under that, so the table keeps the
// lower rate. Update this table when the prices change: each turn's cost is
// written when it ends and never repriced.
//
// Plain JS with no imports: the compose job's Durable Object and the tests
// both read it.

export const PRICES = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-2": { in: 8, out: 40, cacheRead: 0.2, cacheWrite: 10 },
};

/**
 * A turn's cost in dollars, or null for a model with no price.
 * @param {string | null | undefined} model
 * @param {{ in?: number, out?: number, cacheRead?: number, cacheWrite?: number } | null | undefined} usage
 */
export function turnCost(model, usage) {
  const p = model ? PRICES[model] : null;
  if (!p || !usage) return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const usd =
    (n(usage.in) * p.in + n(usage.out) * p.out + n(usage.cacheRead) * p.cacheRead + n(usage.cacheWrite) * p.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
