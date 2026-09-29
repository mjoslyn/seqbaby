"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase/client";

// Ties PostHog's anonymous visitor to the Supabase account, by user id only
// (no email or name: the id is enough to join against `profiles`). Renders
// nothing. A no-op without a PostHog key or Supabase env, since both are
// optional and the engine has to run without them.
export default function PostHogIdentify() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return;
    }
    const supabase = createClient();
    // Fires INITIAL_SESSION on subscribe, then SIGNED_IN / SIGNED_OUT.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id;
      if (id) {
        if (posthog.get_distinct_id() !== id) posthog.identify(id);
      } else if (posthog._isIdentified()) {
        posthog.reset();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
