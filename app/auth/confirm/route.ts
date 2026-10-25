import { NextResponse } from "next/server";
// Only a path on this site: see lib/safeNext.js.
import { safeNext } from "@/lib/safeNext";

// Where the links in sign-up confirmation and magic-link emails end up. Better
// Auth checks the token at /api/auth/verify-email or /api/auth/magic-link/verify,
// sets the session cookie, and redirects here with `next` intact -- or with
// `error` when the token was expired, used, or made up. This sends the visitor
// on: to where they were going, or to the sign-in page saying the link failed.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
}
