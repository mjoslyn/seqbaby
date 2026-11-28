// The record of how compose turns went (compose_turns): what a turn cost, what
// the checks found, and whether the person kept what it made.
//
// Written by the job when a turn ends and answered by the panel when its
// review bar is. Read only by whoever runs the site (`composeReport`, or the
// same SQL through `wrangler d1 execute`): there is no route that lists it.
// Never the words of a turn, only numbers and the genre picker's choice.
//
// The one access rule: a turn's OUTCOME is set by whoever started it, proved
// by the account that owns the row or by the job's view token (all an
// unlocked visitor has). Held by test/data.test.js.

import { createHash } from "node:crypto";
import { all, run } from "./db.js";
import { turnCost } from "../composePricing.js";

export const tokenHash = (token) => createHash("sha256").update(String(token || "")).digest("base64url");

export const OUTCOMES = ["kept", "discarded", "superseded", "dropped"];

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const flag = (v) => (v == null ? null : v ? 1 : 0);

/** What the panel may say a turn was, cut down to what the table holds. */
export function turnMeta(raw) {
  const kind = raw?.kind === "genre" || raw?.kind === "deck" ? raw.kind : "ask";
  const genre = typeof raw?.genre === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.genre) ? raw.genre : null;
  const seed = Number.isInteger(raw?.seed) && raw.seed >= 0 && raw.seed <= 0xffffffff ? raw.seed : null;
  return { kind: genre ? "genre" : kind, genre, seed: genre ? seed : null };
}

/**
 * Write a finished turn. Never throws to the caller's detriment: the job
 * catches, since a turn's song matters more than its record.
 * @param {import("./db.js").D1} db
 */
export async function recordTurn(db, t) {
  const s = t.stats || {};
  const meta = turnMeta(t.meta);
  const u = t.usage || null;
  await run(
    db,
    `insert into compose_turns
       (id, user_id, token_hash, kind, genre, seed, model, status, changed, message_len, ms,
        rounds, tool_calls, tool_errors, nudges, lint_first, lint_last, heard, hear_notes, polished, tracks, sections, critic, critic_notes,
        tokens_in, tokens_out, cache_read, cache_write, cost_usd)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24,
             ?25, ?26, ?27, ?28, ?29)
     on conflict (id) do nothing`,
    t.id, t.userId ?? null, tokenHash(t.viewToken), meta.kind, meta.genre, meta.seed, t.model ?? null,
    t.status === "done" ? "done" : "error", t.changed ? 1 : 0, int(t.messageLen) ?? 0, int(t.ms),
    int(s.rounds), int(s.toolCalls), int(s.toolErrors), int(s.nudges), int(s.lintFirst), int(s.lintLast),
    flag(s.heard), int(s.hearNotes), int(s.polished), int(s.tracks), int(s.sections),
    flag(s.critic), int(s.criticNotes),
    int(u?.in), int(u?.out), int(u?.cacheRead), int(u?.cacheWrite), turnCost(t.model, u),
  );
}

/**
 * Say what became of a turn's changes. Only its starter may: the row's own
 * account, or the holder of the job's view token. The first answer stands,
 * except that `kept` and `discarded` (a decision) replace `superseded` and
 * `dropped` (the absence of one).
 * @param {import("./db.js").D1} db
 * @param {{ id: string, userId?: string | null, token?: string }} who
 * @param {{ outcome: string, auditioned?: boolean }} what
 * @returns {Promise<boolean>} whether a row was written
 */
export async function setTurnOutcome(db, { id, userId = null, token = "" }, { outcome, auditioned = false }) {
  if (!OUTCOMES.includes(outcome) || typeof id !== "string" || !id) return false;
  const decided = outcome === "kept" || outcome === "discarded";
  const n = await run(
    db,
    `update compose_turns
        set outcome = ?1, auditioned = max(auditioned, ?2), outcome_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      where id = ?3
        and ((?4 is not null and user_id = ?4) or (?5 <> '' and token_hash = ?6))
        and (outcome is null or (?7 = 1 and outcome in ('superseded', 'dropped')))`,
    outcome, auditioned ? 1 : 0, id, userId, token || "", tokenHash(token), decided ? 1 : 0,
  );
  return n > 0;
}

/**
 * The keep rate and the cost of a turn, grouped by `by`, over the last `days`.
 * For whoever runs the site; nothing serves this to a browser.
 * @param {"model" | "genre" | "kind"} by
 */
export async function composeReport(db, { by = "model", days = 30 } = {}) {
  const col = by === "genre" ? "genre" : by === "kind" ? "kind" : "model";
  return all(
    db,
    `select ${col} as grp,
            count(*) as turns,
            sum(status = 'error') as errors,
            sum(changed) as changed,
            sum(outcome = 'kept') as kept,
            sum(outcome = 'discarded') as discarded,
            sum(outcome is null and changed = 1) as unanswered,
            round(1.0 * sum(outcome = 'kept') / nullif(sum(outcome in ('kept', 'discarded')), 0), 3) as keep_rate,
            round(avg(ms) / 1000.0, 1) as avg_seconds,
            round(avg(rounds), 1) as avg_rounds,
            round(avg(lint_last), 2) as avg_lint_left,
            round(avg(hear_notes), 2) as avg_hear_notes,
            sum(critic = 1) as reviewed,
            round(avg(critic_notes), 2) as avg_critic_notes,
            round(sum(cost_usd), 4) as cost_usd,
            round(avg(cost_usd), 4) as avg_cost_usd
       from compose_turns
      where created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)
      group by ${col}
      order by turns desc`,
    `-${Math.max(1, Math.round(days))} days`,
  );
}
