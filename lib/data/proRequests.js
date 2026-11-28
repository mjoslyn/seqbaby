// Requests for the pro plan: an account asks (/pro), an admin answers (/admin).
//
// The account's own reads and writes say `user_id = ?`. The admin's list and
// decision read across accounts and check nothing themselves: their callers
// (app/admin) check ADMIN_EMAILS first, as for lib/data/admin.js.

import { all, first, isUnique, run, uuid } from "./db.js";
import { effectivePlan } from "../plans.js";
import { logAction, planRow, setPlan } from "./admin.js";

export const PRO_MESSAGE_MAX = 500;

/** The account's latest request, or null. */
export async function myProRequest(env, userId) {
  if (!userId) return null;
  return first(
    env.DB,
    "select id, status, message, created_at, decided_at from pro_requests where user_id = ?1 order by created_at desc limit 1",
    userId,
  );
}

/**
 * Ask for pro. Refused when the account is already on a paid plan or a request
 * is already waiting.
 * @returns {Promise<{ ok?: true, id?: string, error?: string, pending?: true }>}
 */
export async function requestPro(env, userId, message) {
  if (!userId) return { error: "sign in first" };
  if (effectivePlan(await planRow(env, userId)).id !== "free") return { error: "you're already on pro" };
  const text = String(message ?? "").trim().slice(0, PRO_MESSAGE_MAX) || null;
  const id = uuid();
  try {
    await run(env.DB, "insert into pro_requests (id, user_id, message) values (?1, ?2, ?3)", id, userId, text);
  } catch (e) {
    if (isUnique(e)) return { error: "your request is already waiting", pending: true };
    throw e;
  }
  return { ok: true, id };
}

/** Requests for the admin page, newest first, with who asked. */
export async function listProRequests(env, { status = "pending", limit = 50 } = {}) {
  return all(
    env.DB,
    `select r.id, r.user_id, r.message, r.status, r.created_at, r.decided_at,
            u.email, p.username, p.avatar_grid,
            (select count(*) from songs s where s.owner_id = r.user_id) as songs
       from pro_requests r
       join "user" u on u.id = r.user_id
       left join profiles p on p.id = r.user_id
      where r.status = ?1
      order by r.created_at desc limit ?2`,
    status,
    Math.min(200, Math.max(1, Number(limit) || 50)),
  );
}

/**
 * Answer a pending request. Approving puts the account on pro (until `until`,
 * an ISO date, or for good) through setPlan, which logs it.
 * @param {any} env
 * @param {string} adminId
 * @param {string} requestId
 * @param {boolean} approve
 * @param {string | null} [until]
 * @returns {Promise<{ ok?: true, error?: string, email?: string }>}
 */
export async function decideProRequest(env, adminId, requestId, approve, until = null) {
  const r = await first(
    env.DB,
    `select r.id, r.user_id, u.email from pro_requests r join "user" u on u.id = r.user_id
      where r.id = ?1 and r.status = 'pending'`,
    requestId,
  );
  if (!r) return { error: "that request isn't waiting any more" };
  if (approve) {
    const set = await setPlan(env, adminId, r.user_id, "pro", until);
    if (set.error) return set;
  } else {
    await logAction(env, adminId, r.user_id, "pro declined");
  }
  await run(
    env.DB,
    "update pro_requests set status = ?2, decided_at = ?3, decided_by = ?4 where id = ?1 and status = 'pending'",
    requestId,
    approve ? "approved" : "declined",
    new Date().toISOString(),
    adminId,
  );
  return { ok: true, email: r.email };
}
