// Which model a compose turn runs on.
//
// There is no choice in the panel: every turn runs on the deploy's model
// (ANTHROPIC_MODEL, else the default below). The browser never names one, so
// nothing it sends can pick what the site's key is billed for.
//
// Plain JS with no imports, for lib/composeJobs.js's reasons: it is read by a
// client component (bundled by Next), by the route (Node runtime) and by the
// Netlify worker (bundled outside Next entirely), and nothing here may assume
// any of those three.

// What a turn uses when ANTHROPIC_MODEL is left unset on the deploy.
export const DEFAULT_COMPOSE_MODEL = "claude-sonnet-5-5";

// Short names for the transcript. Older ids stay, because a saved
// conversation still says which model wrote each of its turns.
const LABELS = {
  "claude-sonnet-5-5": "sonnet 5.5",
  "claude-opus-5": "opus 5",
  "claude-sonnet-5": "sonnet 5",
  "claude-haiku-4-5-20251001": "haiku 4.5",
};

/** The short name a model goes by in the transcript, or its id when it has
 *  none (ANTHROPIC_MODEL can name anything). */
export const composeModelLabel = (id) => LABELS[id] ?? id;
