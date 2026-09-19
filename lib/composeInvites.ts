// Checking and spending an invite code, server side.
//
// The code itself is Postgres's business (migration 0012): the table has no
// RLS policies at all, so nothing reaches it through the anon key, and the
// only way in is `redeem_compose_invite` -- a SECURITY DEFINER function that
// answers about the ONE code it was handed. This file is the two calls the
// routes make, and the rule that a code which cannot be checked is a code
// that does not work.
//
// Deliberately NOT a server action: nothing on the client should be able to
// ask the server to spend a code, only to try one, and the trying goes
// through app/api/compose/invite for the same reason `linkedSongTitle` is not
// one -- a named entry point is easier to reason about than an action anybody
// can import.

import { createClient } from "@/lib/supabase/server";
import { looksLikeInviteCode, normalizeInviteCode } from "@/lib/composeInvite.js";

export type InviteResult = {
  ok: boolean;
  /** Turns left on the code afterwards. Null means the code is uncapped;
   *  undefined means we are not saying (a refusal). */
  remaining?: number | null;
  /** Why not, in words meant for the person who typed it. */
  reason?: string;
};

/**
 * Try a code, and optionally spend a turn of it.
 *
 * `consume: false` is the look-before: the panel's check when a code is
 * pasted, and the route's before it writes a job record. `consume: true` is
 * the turn actually starting.
 *
 * Every failure is a refusal rather than a throw, including the ones that are
 * really ours -- no Supabase env, a function that isn't there yet because the
 * migration hasn't been applied. The alternative is a 500 in the middle of
 * someone's first message, and "that code isn't working" is both true and
 * actionable where a stack trace is neither. The real reason goes to the log.
 */
export async function tryInviteCode(raw: string, { consume }: { consume: boolean }): Promise<InviteResult> {
  const code = normalizeInviteCode(raw);
  // Refused here rather than in Postgres: a code that could not be a code is
  // a typo, and a round trip to be told so is a round trip wasted.
  if (!looksLikeInviteCode(code)) {
    return { ok: false, reason: "that doesn't look like an invite code" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("redeem_compose_invite", {
      p_code: code,
      p_consume: consume,
    });
    if (error) {
      console.warn("[compose] invite lookup failed:", error.message);
      return { ok: false, reason: "couldn't check that code just now — try again in a moment" };
    }
    const res = (data ?? {}) as InviteResult;
    if (!res.ok) return { ok: false, reason: res.reason ?? "that code isn't one this site knows" };
    return { ok: true, remaining: res.remaining ?? null };
  } catch (e) {
    console.warn("[compose] invite lookup threw:", (e as Error)?.message ?? e);
    return { ok: false, reason: "couldn't check that code just now — try again in a moment" };
  }
}
