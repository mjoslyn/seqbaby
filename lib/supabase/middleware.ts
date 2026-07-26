import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and re-writes the auth
// cookies onto the response, so Server Components always see a fresh session.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and this call — it
  // refreshes the token and is what keeps the session alive.
  //
  // getClaims() rather than getUser(): both refresh an expiring session (via
  // getSession internally), but getClaims verifies the JWT locally against the
  // cached JWKS instead of making a blocking round trip to the auth server on
  // every single request. Since middleware runs before the studio HTML starts
  // streaming, that round trip sat directly in front of the engine's download
  // for signed-in visitors. On projects still using legacy HS256 secrets
  // getClaims falls back to getUser internally, so this is never slower.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
