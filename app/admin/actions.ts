"use server";

// The admin page's writes. Every one checks the caller is on ADMIN_EMAILS
// itself: a server action is a public endpoint, whatever page draws its button.

import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { isAdminEmail, planById } from "@/lib/plans.js";
import * as admin from "@/lib/data/admin.js";
import { decideProRequest } from "@/lib/data/proRequests.js";
import { linkMail, sendMail, siteBase } from "@/lib/auth/mail";
import { SITE_URL } from "@/app/shareCard";

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
  let r: Awaited<ReturnType<typeof admin.setPlan>>;
  try {
    r = await admin.setPlan(a.env, a.user.id, userId, plan, until || null);
  } catch (e) {
    return fail(e);
  }
  if ("error" in r) return r;
  // Tell the account, best effort, and only when something changed.
  if (r.changed && r.email) {
    const base = siteBase(a.env, SITE_URL);
    const day = r.until ? r.until.slice(0, 10) : null;
    const mail =
      r.plan === "pro"
        ? linkMail(
            r.email,
            "you're on seqbaby pro",
            `Your account is on seqbaby pro${day ? ` until ${day}` : ""}: compose has no monthly cap, and Sonnet and Opus are in its model menu.`,
            "open the studio",
            `${base}studio`,
          )
        : linkMail(
            r.email,
            "your seqbaby plan",
            `Your account is on the free plan now: ${planById("free")?.turns ?? 50} compose turns a month, on Haiku. You can ask for pro again any time.`,
            "see your plan",
            `${base}pro`,
          );
    await sendMail(a.env, mail).catch((e) => console.error("[admin] could not mail the account", e));
  }
  return { ok: true };
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

/** Answer a pro request: approve (pro until a date, or for good) or decline,
 *  and tell the account by email, best effort. */
export async function adminDecidePro(requestId: string, approve: boolean, until: string | null): Promise<Result> {
  const a = await asAdmin();
  if (!a) return { error: "not allowed" };
  let r: { ok?: true; error?: string; email?: string };
  try {
    r = await decideProRequest(a.env, a.user.id, requestId, approve, until || null);
  } catch (e) {
    return fail(e);
  }
  if (r.error || !r.email) return r;
  const base = siteBase(a.env, SITE_URL);
  const mail = approve
    ? linkMail(
        r.email,
        "you're on seqbaby pro",
        `Your pro request was approved${until ? ` (until ${until})` : ""}: compose has no monthly cap now, and Sonnet and Opus are in its model menu.`,
        "open the studio",
        `${base}studio`,
      )
    : linkMail(
        r.email,
        "your seqbaby pro request",
        "Your pro request wasn't approved this time. You still have the free plan's turns, and you can ask again later.",
        "see your plan",
        `${base}pro`,
      );
  await sendMail(a.env, mail).catch((e) => console.error("[pro] could not mail the account", e));
  return { ok: true };
}
