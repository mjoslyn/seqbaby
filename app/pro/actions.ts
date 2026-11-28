"use server";

// Asking for pro, and the account's plan as the /pro page and the compose
// panel show it.

import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { linkMail, sendMail, siteBase } from "@/lib/auth/mail";
import { isAdminEmail } from "@/lib/plans.js";
import { requestPro } from "@/lib/data/proRequests.js";
import { SITE_URL } from "@/app/shareCard";

export async function requestProAccess(message: string): Promise<{ ok?: boolean; error?: string; pending?: boolean }> {
  const user = await currentUser();
  if (!user) return { error: "sign in first" };
  const env = await cfEnv();
  let r: { ok?: true; error?: string; pending?: true };
  try {
    r = await requestPro(env, user.id, message);
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
  if (r.error) return r;
  // Tell the admins, best effort: a request is on /admin whether or not
  // the mail goes.
  const admins = String(env.ADMIN_EMAILS || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter((x) => x && isAdminEmail(x, env.ADMIN_EMAILS));
  const base = siteBase(env, SITE_URL);
  for (const to of admins) {
    await sendMail(
      env,
      linkMail(to, "seqbaby: a pro request", `${user.email} asked for pro.`, "answer it on /admin", `${base}admin`),
    ).catch((e) => console.error("[pro] could not mail an admin", e));
  }
  return { ok: true };
}
