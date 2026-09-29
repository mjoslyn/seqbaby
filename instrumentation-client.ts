import posthog from "posthog-js";

// Runs in the browser before hydration (Next 15.3+). Analytics is optional:
// with no key set (local dev, the legacy server) nothing is initialised and
// the engine runs exactly as before.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    // Current defaults include history_change pageviews, which is what the
    // App Router's soft navigations need.
    defaults: "2025-05-24",
    person_profiles: "identified_only",
  });
}
