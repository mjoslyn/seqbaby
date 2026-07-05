import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server (Server Component / Route Handler / Server Action) Supabase client.
// Reads and writes the auth session cookies via next/headers.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a Server Component, setAll throws (cookies are read-only there).
          // That's fine: the middleware refreshes the session, so we can ignore.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}
