// Which models the compose chat may be asked for.
//
// The choice comes from the browser, so it cannot be a free string: the turn
// runs against the DEPLOY's Anthropic key, and whatever id arrives is what it
// gets billed for. This list is the allowlist the route checks against and the
// dropdown the panel draws, in one place so the two cannot disagree.
//
// Plain JS with no imports, for lib/composeJobs.js's reasons: it is read by a
// client component (bundled by Next), by the route (Node runtime) and by the
// Netlify worker (bundled outside Next entirely), and nothing here may assume
// any of those three.

/** @type {{id: string, label: string, note: string}[]} */
export const COMPOSE_MODELS = [
  {
    id: "claude-opus-5",
    label: "opus 5",
    note: "slowest, best at arrangement",
  },
  {
    id: "claude-sonnet-5",
    label: "sonnet 5",
    note: "the balance — what a turn uses unless told otherwise",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "haiku 4.5",
    note: "fastest, best for small edits",
  },
];

// What a turn uses when nothing names a model: a request from an older panel,
// or ANTHROPIC_MODEL left unset on the deploy.
export const DEFAULT_COMPOSE_MODEL = "claude-sonnet-5";

/** Whether a model id is one this app will spend its key on. */
export const isComposeModel = (id) => COMPOSE_MODELS.some((m) => m.id === id);

/** The short name a model goes by in the transcript. An id that isn't on the
 *  list still gets a label rather than nothing — ANTHROPIC_MODEL can name one
 *  the dropdown doesn't offer, and a turn run on it should still say so. */
export const composeModelLabel = (id) => COMPOSE_MODELS.find((m) => m.id === id)?.label ?? id;
