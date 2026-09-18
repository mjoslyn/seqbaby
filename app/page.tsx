import { Suspense } from "react";
import type { Metadata } from "next";
import { STUDIO_BODY } from "./studioMarkup";
import Preloader from "./Preloader";
import ScriptLoader from "./ScriptLoader";
import EnginePreload from "./EnginePreload";
import EngineScripts from "./EngineScripts";
import OpenSongOnLoad from "./OpenSongOnLoad";
import DefaultTemplate from "./DefaultTemplate";
import { AccountBar } from "./AccountBar";
import styles from "./ui.module.css";
import { createClient } from "@/lib/supabase/server";
import { SITE_DESCRIPTION, shareCard } from "./shareCard";
import { linkedSongTitle } from "./songs/linkedSongTitle";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

// A share link points at the studio with the song in the query, so the link
// preview was the studio's own card however specific the thing being shared —
// twelve people posting twelve songs all got "seqbaby". A URL that names a
// song now titles the card with it.
//
// The lookup only happens when the URL carries one. Metadata is resolved
// before the document flushes, so a Supabase round trip on every visit would
// hold back the engine's preload hints for everyone (the same reason the
// account bar sits behind <Suspense> below); a plain `/` does no work here and
// inherits the layout's card, while a `?s=` visit is already waiting on a
// fetch of the session itself.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const slug = one(sp.s);
  const openId = one(sp.open);
  if (!slug && !openId) return {};

  const title = await linkedSongTitle(slug, openId);
  if (!title) return {};

  return {
    title: `${title} · seqbaby`,
    ...shareCard(title, `A song made in seqbaby. ${SITE_DESCRIPTION}`),
  };
}

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

  // Whether the deploy has a key of its own decides what the compose panel
  // offers: read here, in a server component, because the browser must not be
  // told anything about it beyond whether it exists.
  return <AccountBar name={name} username={username} serverKey={!!process.env.ANTHROPIC_API_KEY} />;
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
      {/* First in the document: it covers the un-booted skeleton below, and it
          can only do that if the parser reaches it before everything else. */}
      <Preloader />
      <EnginePreload />
      <Suspense fallback={<AccountBarFallback />}>
        <AccountBarSlot />
      </Suspense>
      {/* The engine's deferred scripts run before React hydrates and immediately
          rewrite this subtree (populating the scale/engine selects, the pattern
          grid, the starter tracks), so React always finds the DOM different from
          the HTML it served and logs a hydration mismatch. It can't "fix" it
          either — the __html string is constant, so nothing gets re-rendered.
          suppressHydrationWarning is React's escape hatch for exactly this
          third-party-mutation case; it applies to this element only. */}
      <div
        suppressHydrationWarning
        style={{ display: "contents" }}
        dangerouslySetInnerHTML={{ __html: STUDIO_BODY }}
      />
      <EngineScripts />
      <ScriptLoader />
      <OpenSongOnLoad />
      <DefaultTemplate />
    </>
  );
}
