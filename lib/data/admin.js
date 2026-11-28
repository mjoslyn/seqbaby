// The admin page's reads and writes: every account, its plan, suspending it,
// signing it out, deleting it, and a log of each of those.
//
// Nothing here checks WHO is asking: these run across every account, so the
// caller (app/admin/actions.ts, app/admin/page.tsx) checks the asker is on
// ADMIN_EMAILS first (lib/plans.js's isAdminEmail). Each write that names an
// admin refuses to act on that admin's own account, so nobody locks
// themselves out from this page.

import { all, bool, first, run } from "./db.js";
import { deleteUserData } from "./accounts.js";
import { effectivePlan, planById } from "../plans.js";
import { createProfile } from "../auth/profile.js";

const PAGE = 50;

const userRow = (r, now = Date.now()) => ({
  id: r.id,
  email: r.email,
  username: r.username ?? null,
  avatar_grid: r.avatar_grid ?? null,
  verified: bool(r.emailVerified),
  created_at: r.createdAt,
  plan: r.plan ?? "free",
  plan_until: r.plan_until ?? null,
  effective_plan: effectivePlan(r, now).id,
  suspended: bool(r.suspended),
  songs: Number(r.songs) || 0,
  turns_30d: Number(r.turns_30d) || 0,
  last_seen: r.last_seen ?? null,
});

/**
 * One page of accounts, newest first, optionally searched by email or name
 * and filtered by plan or suspension.
 * @param {{ q?: string, plan?: string, suspended?: boolean, offset?: number }} opts
 */
export async function listUsers(env, { q = "", plan = "", suspended = false, offset = 0 } = {}) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `?${params.length}`;
  };
  const term = String(q).trim().toLowerCase();
  if (term) {
    const like = p(`%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where.push(`(lower(u.email) like ${like} escape '\\' or pr.username_lower like ${like} escape '\\')`);
  }
  if (plan && planById(plan)) where.push(`coalesce(pr.plan, 'free') = ${p(plan)}`);
  if (suspended) where.push("pr.suspended = 1");
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await all(
    env.DB,
    `select u.id, u.email, u."emailVerified", u."createdAt",
            pr.username, pr.avatar_grid, pr.plan, pr.plan_until, pr.suspended,
            (select count(*) from songs s where s.owner_id = u.id) as songs,
            (select count(*) from compose_turns t where t.user_id = u.id and t.created_at >= ${p(since)}) as turns_30d,
            (select max(se."updatedAt") from "session" se where se."userId" = u.id) as last_seen
       from "user" u left join profiles pr on pr.id = u.id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by u."createdAt" desc
      limit ${p(PAGE + 1)} offset ${p(Math.max(0, Math.floor(Number(offset) || 0)))}`,
    ...params,
  );
  const now = Date.now();
  return { users: rows.slice(0, PAGE).map((r) => userRow(r, now)), more: rows.length > PAGE, pageSize: PAGE };
}

/** The counts across the top of the page. */
export async function adminStats(env) {
  const week = new Date(Date.now() - 7 * 86400_000).toISOString();
  const r = await first(
    env.DB,
    `select (select count(*) from "user") as users,
            (select count(*) from "user" where "createdAt" >= ?1) as new_7d,
            (select count(*) from profiles where plan <> 'free' and (plan_until is null or plan_until > ?2)) as paid,
            (select count(*) from profiles where suspended = 1) as suspended,
            (select count(*) from compose_turns where created_at >= ?1) as turns_7d`,
    week,
    new Date().toISOString(),
  );
  return {
    users: Number(r?.users) || 0,
    new_7d: Number(r?.new_7d) || 0,
    paid: Number(r?.paid) || 0,
    suspended: Number(r?.suspended) || 0,
    turns_7d: Number(r?.turns_7d) || 0,
  };
}

async function target(env, userId) {
  return first(env.DB, 'select id, email from "user" where id = ?1', userId);
}

/** Write to an account's profile, making the profile first if its sign-up
 *  hook never did: a plan or a suspension with no row to hold it would be
 *  reported as done and do nothing. */
async function writeProfile(env, t, sql, ...params) {
  if ((await run(env.DB, sql, t.id, ...params)) > 0) return;
  await createProfile(env.DB, { id: t.id, email: t.email });
  if ((await run(env.DB, sql, t.id, ...params)) === 0) throw new Error("couldn't write that account's profile");
}

async function log(env, adminId, t, action, detail = null) {
  await run(
    env.DB,
    "insert into admin_log (admin_id, target_id, target, action, detail) values (?1, ?2, ?3, ?4, ?5)",
    adminId,
    t?.id ?? null,
    t?.email ?? null,
    action,
    detail,
  );
}

/** Log an action on an account by id (a declined pro request). */
export async function logAction(env, adminId, userId, action, detail = null) {
  await log(env, adminId, await target(env, userId), action, detail);
}

/**
 * Put an account on a plan, until a date or for good. Says whether anything
 * changed (`changed`) and the account's email, so the caller can tell it.
 * @param {string | null} until an ISO date (the plan lapses at its start, UTC), or null
 * @returns {Promise<{ error: string } | { ok: true, email: string, plan: string, until: string | null, changed: boolean }>}
 */
export async function setPlan(env, adminId, userId, plan, until = null) {
  const p = planById(plan);
  if (!p) return { error: "no such plan" };
  let untilIso = null;
  if (until) {
    const t = Date.parse(until);
    if (!Number.isFinite(t)) return { error: "that date doesn't read as a date" };
    untilIso = new Date(t).toISOString();
  }
  if (p.id === "free") untilIso = null;
  const t = await target(env, userId);
  if (!t) return { error: "no such account" };
  const was = await first(env.DB, "select plan, plan_until from profiles where id = ?1", t.id);
  const changed = (was?.plan ?? "free") !== p.id || (was?.plan_until ?? null) !== untilIso;
  await writeProfile(env, t, "update profiles set plan = ?2, plan_until = ?3 where id = ?1", p.id, untilIso);
  await log(env, adminId, t, "plan", untilIso ? `${p.id} until ${untilIso.slice(0, 10)}` : p.id);
  return { ok: true, email: t.email, plan: p.id, until: untilIso, changed };
}

/** Suspend an account (and sign it out everywhere), or lift a suspension. */
export async function setSuspended(env, adminId, userId, on) {
  if (userId === adminId) return { error: "that's your own account" };
  const t = await target(env, userId);
  if (!t) return { error: "no such account" };
  await writeProfile(env, t, "update profiles set suspended = ?2 where id = ?1", on ? 1 : 0);
  if (on) await run(env.DB, 'delete from "session" where "userId" = ?1', userId);
  await log(env, adminId, t, on ? "suspend" : "unsuspend");
  return { ok: true };
}

/** End every session an account has. */
export async function signOutEverywhere(env, adminId, userId) {
  const t = await target(env, userId);
  if (!t) return { error: "no such account" };
  const n = await run(env.DB, 'delete from "session" where "userId" = ?1', userId);
  await log(env, adminId, t, "signout", `${n} session${n === 1 ? "" : "s"}`);
  return { ok: true, sessions: n };
}

/** Delete an account and everything in it. */
export async function deleteUser(env, adminId, userId) {
  if (userId === adminId) return { error: "that's your own account: delete it from settings" };
  const t = await target(env, userId);
  if (!t) return { error: "no such account" };
  await deleteUserData(env, userId);
  await log(env, adminId, t, "delete");
  return { ok: true };
}

/** The latest admin actions, newest first, with who did them. */
export async function adminLog(env, limit = 30) {
  return all(
    env.DB,
    `select l.id, l.at, l.action, l.detail, l.target, l.target_id, a.email as admin
       from admin_log l left join "user" a on a.id = l.admin_id
      order by l.id desc limit ?1`,
    Math.min(200, Math.max(1, Number(limit) || 30)),
  );
}

/** Whether an account is suspended. Never throws: it is on the sign-in path
 *  (lib/auth/config.js), and a missing column must not stop anyone signing in.
 *  @param {{ prepare(sql: string): any }} db */
export async function isSuspended(db, userId) {
  try {
    const r = await db.prepare("select suspended from profiles where id = ?1").bind(userId).first();
    return bool(r?.suspended);
  } catch {
    return false;
  }
}

/** An account's plan fields, for effectivePlan. Never throws. */
export async function planRow(env, userId) {
  if (!userId) return null;
  try {
    return await first(env.DB, "select plan, plan_until from profiles where id = ?1", userId);
  } catch {
    return null;
  }
}
