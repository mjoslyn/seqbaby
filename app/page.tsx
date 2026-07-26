import { Suspense } from "react";
import { STUDIO_BODY } from "./studioMarkup";
import ScriptLoader from "./ScriptLoader";
import EnginePreload from "./EnginePreload";
import EngineScripts from "./EngineScripts";
import OpenSongOnLoad from "./OpenSongOnLoad";
import { AccountBar } from "./AccountBar";
import styles from "./ui.module.css";
import { createClient } from "@/lib/supabase/server";

// Resolving the account bar costs two *sequential* Supabase round trips
// (validate the session, then read the profile). Awaiting them in the page
// itself held back the entire document, so signed-in visitors waited on the
// network twice before a single byte of the studio — or of the engine's
// preload hints — reached the browser. Isolating it behind <Suspense> lets the
// shell stream immediately and the bar fill in when it resolves.
async function AccountBarSlot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve a display name + handle. Tolerates the profiles table not existing
  // yet (before the migration is applied) by falling back to the email.
  let name: string | null = null;
  let username: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .maybeSingle();
    name = profile?.display_name || profile?.username || user.email || null;
    username = profile?.username ?? null;
  }

  return <AccountBar name={name} username={username} />;
}

// Holds the bar's exact height while it streams, so the studio below never
// shifts. Deliberately empty rather than a signed-out bar — a "sign in" link
// that flips to your account a moment later reads as a glitch.
function AccountBarFallback() {
  return (
    <div className={styles.topBar} aria-hidden>
      <span className={styles.accountBtn} style={{ visibility: "hidden" }}>
        sign in
      </span>
    </div>
  );
}

// The studio route. The engine's static DOM skeleton (header, pattern bar, panels,
// #tracks, both <template>s, #ios-audio-unlock) is server-rendered as raw HTML so
// it exists in the document before the engine scripts run. `display: contents` on
// the wrapper removes its box so the sticky header/layout behave exactly as they
// did when this markup lived directly in <body>. EngineScripts then boots the
// engine straight from the document, in the required order.
export default function StudioPage() {
  return (
    <>
      <EnginePreload />
      <Suspense fallback={<AccountBarFallback />}>
        <AccountBarSlot />
      </Suspense>
      <div
        style={{ display: "contents" }}
        dangerouslySetInnerHTML={{ __html: STUDIO_BODY }}
      />
      <EngineScripts />
      <ScriptLoader />
      <OpenSongOnLoad />
    </>
  );
}
