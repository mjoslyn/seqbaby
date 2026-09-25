import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { STUDIO_BODY } from "@/app/studioMarkup";
import Preloader from "@/app/Preloader";
import StudioBody from "@/app/StudioBody";
import ScriptLoader from "@/app/ScriptLoader";
import EnginePreload from "@/app/EnginePreload";
import EngineScripts from "@/app/EngineScripts";
import OpenSongOnLoad from "@/app/OpenSongOnLoad";
import DefaultTemplate from "@/app/DefaultTemplate";
import { AccountBar } from "@/app/AccountBar";
import styles from "@/app/ui.module.css";
import { createClient } from "@/lib/supabase/server";
import { SITE_DESCRIPTION, SITE_URL, shareCard } from "@/app/shareCard";
import { linkedSong, linkedSongCard, jamHostName } from "@/app/songs/linkedSongTitle";
import { songShareTitle, jamShareTitle } from "@/app/shareCopy";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

// A share link points at the studio with the song in the query, so the link
// preview was the studio's own card however specific the thing being shared —
// twelve people posting twelve songs all got "seqbaby". A URL that names a
// song now gets a card that says who shared what: `mike has shared "cold
// squelch" with you`. A jam invite (`?jam=`) gets the same shape — `mike has
// shared a jam with you` — with the host's handle read off the link and
// checked against the profiles before it is put on a card (see jamHostName).
//
// The lookup only happens when the URL carries one. Metadata is resolved
// before the document flushes, so a Supabase round trip on every visit would
// hold back the engine's preload hints for everyone (the same reason the
// account bar sits behind <Suspense> below); a plain `/` does no work here and
// inherits the layout's card, while a `?s=` visit is already waiting on a
// fetch of the session itself.
// The card's picture: the song's steps, or a jam's, drawn by app/api/og for
// exactly the params this URL carries. Absolute, as og:image has to be, and
// on the host that served this page, so a deploy preview's card shows that
// deploy's image rather than production's.
async function cardImage(params: Record<string, string | null>): Promise<string> {
  let origin = SITE_URL.replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) origin = `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  } catch {
    /* no request (a static render): the site's own address will do */
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `${origin}/api/og?${q}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const slug = one(sp.s);
  const openId = one(sp.open);
  const jam = one(sp.jam);

  if (slug || openId) {
    const song = await linkedSong(slug, openId);
    if (song) {
      return {
        // The tab still says what the song is called; the sentence is for
        // the preview, where the reader has not opened anything yet.
        title: `${song.title} · seqbaby`,
        ...shareCard(
          songShareTitle(song.owner, song.title),
          `A song made in seqbaby. Open it to hear it or remix it. ${SITE_DESCRIPTION}`,
          await cardImage({ s: slug, open: slug ? null : openId }),
        ),
      };
    }
  }

  if (jam) {
    const host = await jamHostName(one(sp.by));
    return {
      title: "jam · seqbaby",
      ...shareCard(
        jamShareTitle(host),
        `Open the link to join and edit the song together, live. No account needed. ${SITE_DESCRIPTION}`,
        await cardImage({ jam, by: one(sp.by) }),
      ),
    };
  }

  return {};
}

// Resolving the account bar costs two *sequential* Supabase round trips
// (validate the session, then read the profile). Awaiting them in the page
// itself held back the entire document, so signed-in visitors waited on the
// network twice before a single byte of the studio — or of the engine's
// preload hints — reached the browser. Isolating it behind <Suspense> lets the
// shell stream immediately and the bar fill in when it resolves.
async function AccountBarSlot({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const sp = await searchParams;
  const slug = one(sp.s);
  const openId = one(sp.open);
  // Side by side: the byline's lookup does not need the user, only the
  // decision whether to show it does.
  const [
    {
      data: { user },
    },
    linked,
  ] = await Promise.all([supabase.auth.getUser(), linkedSongCard(slug, openId)]);
  // Your own song needs no byline: the songs menu and the save button already
  // say what it is.
  const viewing = linked && linked.ownerId !== user?.id ? linked : null;

  // Resolve a display name + handle. Tolerates the profiles table not existing
  // yet (before the migration is applied) by falling back to the email.
  let name: string | null = null;
  let username: string | null = null;
  let avatarGrid: string | null = null;
  if (user) {
    // avatar_grid is migration 0014's; asked of a database without it, the
    // select fails whole, so ask again without rather than lose the name.
    const q = (cols: string) =>
      supabase
        .from("profiles")
        .select(cols)
        .eq("id", user.id)
        .maybeSingle<{ display_name: string | null; username: string | null; avatar_grid?: string | null }>();
    let res = await q("display_name, username, avatar_grid");
    if (res.error) res = await q("display_name, username");
    const profile = res.data;
    avatarGrid = profile?.avatar_grid ?? null;
    name = profile?.username || profile?.display_name || user.email || null;
    username = profile?.username ?? null;
  }

  // Whether the deploy has a key of its own decides what the compose panel
  // offers: read here, in a server component, because the browser must not be
  // told anything about it beyond whether it exists.
  return (
    <AccountBar
      name={name}
      username={username}
      avatarGrid={avatarGrid}
      serverKey={!!process.env.ANTHROPIC_API_KEY}
      viewing={viewing}
    />
  );
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
//
// `?embed` is the studio as a player: the homepage's song cards load it in a
// hidden frame (app/enginePlayer.ts) and drive `window.seqbaby` from
// outside. No account bar (two Supabase round trips nobody sees), and no deep
// link or default template, which would race the song the page hands it.
export default async function StudioPage({ searchParams }: { searchParams: SearchParams }) {
  const embed = (await searchParams).embed !== undefined;
  return (
    <>
      {/* First in the document: it covers the un-booted skeleton below, and it
          can only do that if the parser reaches it before everything else. */}
      <Preloader />
      <EnginePreload />
      {!embed && (
        <Suspense fallback={<AccountBarFallback />}>
          <AccountBarSlot searchParams={searchParams} />
        </Suspense>
      )}
      {/* The engine's DOM. A client component so it can keep React from ever
          rewriting it on a re-render (StudioBody says why). */}
      <StudioBody html={STUDIO_BODY} />
      <EngineScripts />
      <ScriptLoader />
      {!embed && <OpenSongOnLoad />}
      {!embed && <DefaultTemplate />}
    </>
  );
}
