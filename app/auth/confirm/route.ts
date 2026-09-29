import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE, RECOVERY_MAX_AGE } from "@/lib/recoveryCookie";

// Only a path on this site. `new URL(next, origin)` takes an absolute URL (or a
// protocol-relative `//host`) over the origin, which would make this route an
// open redirect wearing the site's own domain.
function safeNext(next: string | null): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  )
    return "/studio";
  return next;
}

// Handles email-confirmation, magic-link and password-reset callbacks. Supabase
// may send either a PKCE `code` (exchangeCodeForSession) or a `token_hash`+`type`
// (verifyOtp), depending on the flow/version. Handle both; either sets the
// session cookies.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  const supabase = await createClient();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (token_hash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash })).error;
  }
  if (!ok)
    return NextResponse.redirect(new URL("/login?error=confirm", url.origin));

  const res = NextResponse.redirect(new URL(next, url.origin));
  // A reset link lets /reset-password set a password without the current one.
  // The PKCE path carries no `type`, so `next` is what names a reset; either
  // way the link had to come out of the account's inbox.
  if (type === "recovery" || next === "/reset-password") {
    res.cookies.set(RECOVERY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: RECOVERY_MAX_AGE,
    });
  }
  return res;
}
