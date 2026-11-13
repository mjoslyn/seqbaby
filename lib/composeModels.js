// Which model a compose turn runs on.
//
// There is no choice in the panel: every turn runs on the deploy's model
// (ANTHROPIC_MODEL, else the default below). The browser never names one, so
// nothing it sends can pick what the site's key is billed for.
//
// Plain JS with no imports, for lib/composeJobs.js's reasons: it is read by a
// client component (bundled by Next), by the route, and by the compose job's
// Durable Object (bundled by wrangler, outside Next entirely), and nothing here
// may assume any of those three.

// What a turn uses when ANTHROPIC_MODEL is left unset on the deploy.
export const DEFAULT_COMPOSE_MODEL = "claude-haiku-5-5";

// The models an account on the deploy's allow-list may pick instead
// (COMPOSE_MODEL_PICKERS). The route only ever runs one of these, whatever
// the browser sends.
export const COMPOSE_MODELS = [
  { id: "claude-haiku-5-5", label: "haiku 5.5" },
  { id: "claude-sonnet-5-5", label: "sonnet 5.5" },
  { id: "claude-opus-5-5", label: "opus 5.5" },
  { id: "claude-fable-5-2", label: "fable 5.2" },
];

/** Whether an account may pick its model: its email is on the deploy's
 *  COMPOSE_MODEL_PICKERS, a list split by commas, spaces or newlines, case
 *  ignored. Unset or empty, nobody may. */
export function canPickModel(email, pickers) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return String(pickers || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

// What an unlock code adds (lib/unlock.js's UNLOCK_MODELS, spelled here too
// so this file keeps no imports; test/unlock.test.js holds the two together).
const UNLOCKED = ["claude-sonnet-5-5", "claude-opus-5-5"];

/** The models a visitor may pick, as menu entries: every one for an account on
 *  COMPOSE_MODEL_PICKERS; for an unlock code, the deploy's own plus sonnet and
 *  opus; otherwise none (no menu, the deploy's model). */
export function allowedModels({ picker = false, unlocked = false, defaultModel = DEFAULT_COMPOSE_MODEL } = {}) {
  if (picker) return COMPOSE_MODELS;
  if (!unlocked) return [];
  const ids = [defaultModel, ...UNLOCKED];
  return ids
    .filter((id, i) => ids.indexOf(id) === i)
    .map((id) => COMPOSE_MODELS.find((m) => m.id === id) ?? { id, label: composeModelLabel(id) });
}

/** The model a turn runs on: the one asked for when it is among `allowed`
 *  (`true` for every model on the list, or a list of menu entries), else null
 *  (the deploy's own). */
export function pickedModel(requested, allowed) {
  if (!allowed || typeof requested !== "string") return null;
  const list = allowed === true ? COMPOSE_MODELS : Array.isArray(allowed) ? allowed : [];
  return list.some((m) => m.id === requested) ? requested : null;
}

// Short names for the transcript. Older ids stay, because a saved
// conversation still says which model wrote each of its turns.
const LABELS = {
  "claude-haiku-5-5": "haiku 5.5",
  "claude-sonnet-5-5": "sonnet 5.5",
  "claude-opus-5-5": "opus 5.5",
  "claude-fable-5-2": "fable 5.2",
  "claude-opus-5": "opus 5",
  "claude-sonnet-5": "sonnet 5",
  "claude-haiku-4-5-20251001": "haiku 4.5",
};

/** The short name a model goes by in the transcript, or its id when it has
 *  none (ANTHROPIC_MODEL can name anything). */
export const composeModelLabel = (id) => LABELS[id] ?? id;
