"use server";

// The admin page's writes. Every one checks the caller is on ADMIN_EMAILS
// itself: a server action is a public endpoint, whatever page draws its button.

import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { isAdminEmail } from "@/lib/plans.js";
import * as admin from "@/lib/data/admin.js";

type Result = { ok?: boolean; error?: string };

async function asAdmin() {
  const user = await currentUser();
  const env = await cfEnv();
  if (!user || !isAdminEmail(user.email, env.ADMIN_EMAILS)) return null;
  return { user, env };
}

const fail = (e: unknown): Result => ({ error: String((e as Error)?.message ?? e) });

export async function adminSetPlan(userId: string, plan: string, until: string | null): Promise<Result> {
  const a = await asAdmin();
  if (!a) return { error: "not allowed" };
  try {
    return await admin.setPlan(a.env, a.user.id, userId, plan, until || null);
  } catch (e) {
    return fail(e);
  }
}

export async function adminSetSuspended(userId: string, on: boolean): Promise<Result> {
  const a = await asAdmin();
  if (!a) return { error: "not allowed" };
  try {
    return await admin.setSuspended(a.env, a.user.id, userId, on);
  } catch (e) {
    return fail(e);
  }
}

export async function adminSignOut(userId: string): Promise<Result> {
  const a = await asAdmin();
  if (!a) return { error: "not allowed" };
  try {
    return await admin.signOutEverywhere(a.env, a.user.id, userId);
  } catch (e) {
    return fail(e);
  }
}

export async function adminDeleteUser(userId: string, confirmEmail: string): Promise<Result> {
  const a = await asAdmin();
  if (!a) return { error: "not allowed" };
  try {
    const t = await admin.listUsers(a.env, { q: confirmEmail });
    if (!t.users.some((u) => u.id === userId && u.email.toLowerCase() === confirmEmail.trim().toLowerCase())) {
      return { error: "type the account's email exactly to delete it" };
    }
    return await admin.deleteUser(a.env, a.user.id, userId);
  } catch (e) {
    return fail(e);
  }
}
