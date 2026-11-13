import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { UNLOCK_COOKIE, UNLOCK_MAX_AGE, codeMatches, mintUnlock } from "@/lib/unlock.js";

export const dynamic = "force-dynamic";

// GET /api/unlock?unlock=<code>&...  (what /studio?unlock= and /?unlock=
// redirect to, next.config.mjs)
//
// The right code sets the unlock cookie (lib/unlock.js); either way the
// visitor lands on the studio with the rest of the query intact and the code
// gone from the address bar, so it is not left in their history or in a link
// they copy from it. A wrong or rotated code just lands them, unlocked
// as they were.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const given = url.searchParams.get("unlock") ?? "";
  url.searchParams.delete("unlock");
  const env = await cfEnv();
  const ok = codeMatches(given, env.COMPOSE_UNLOCK_CODE);
  const to = new URL(`/studio${url.search}`, url.origin);
  const res = NextResponse.redirect(to, 303);
  if (ok) {
    res.cookies.set(UNLOCK_COOKIE, await mintUnlock(env.COMPOSE_UNLOCK_CODE as string), {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: UNLOCK_MAX_AGE,
    });
  }
  return res;
}
