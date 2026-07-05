import { createBrowserClient } from "@supabase/ssr";

// Browser (client component) Supabase client. Uses the publishable key, which is
// safe to ship to the browser because Row Level Security gates every table.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
