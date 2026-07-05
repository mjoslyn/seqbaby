import { STUDIO_BODY } from "./studioMarkup";
import ScriptLoader from "./ScriptLoader";
import OpenSongOnLoad from "./OpenSongOnLoad";
import { AccountBar } from "./AccountBar";
import { createClient } from "@/lib/supabase/server";

// The studio route. The engine's static DOM skeleton (header, pattern bar, panels,
// #tracks, both <template>s, #ios-audio-unlock) is server-rendered as raw HTML so
// it exists in the document before the engine scripts run. `display: contents` on
// the wrapper removes its box so the sticky header/layout behave exactly as they
// did when this markup lived directly in <body>. ScriptLoader then injects the
// engine scripts (client-only) in the required order.
export default async function StudioPage() {
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

  return (
    <>
      <AccountBar name={name} username={username} />
      <div
        style={{ display: "contents" }}
        dangerouslySetInnerHTML={{ __html: STUDIO_BODY }}
      />
      <ScriptLoader />
      <OpenSongOnLoad />
    </>
  );
}
