"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

// Ties PostHog's anonymous visitor to the account, by user id only (no email
// or name: the id is enough to join against `profiles`). Renders nothing. A
// no-op without a PostHog key, since analytics are optional.
//
// Asked once per page load: signing in or out is a navigation here (a server
// action that redirects), so a page that loads is the moment the answer can
// have changed.
export default function PostHogIdentify() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) return;
    let cancelled = false;
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => r.json() as Promise<{ id: string | null }>)
      .then(({ id }) => {
        if (cancelled) return;
        if (id) {
          if (posthog.get_distinct_id() !== id) posthog.identify(id);
        } else if (posthog._isIdentified()) {
          posthog.reset();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
