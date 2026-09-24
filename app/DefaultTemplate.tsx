"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDefaultTemplate, type DefaultTemplate } from "@/app/songs/actions";
import { setOpenSong } from "@/app/songs/openSong";

// What a new song starts from, when the account has named a default template.
//
// The engine's own idea of "new" is the six starter tracks (`STARTER_TRACKS` in
// session.js), and that stays exactly what it was: this island applies a
// session over the top afterwards rather than teaching the engine about
// accounts. So the legacy static server, a signed-out visitor and anyone with
// no default template all get the same blank editor they always did.
//
// Two moments count as starting a new song, and both go through here so they
// cannot disagree:
//
//   - `seqbaby:newset`, which the engine fires from `newSet()` -- the top bar's
//     `new` lands there. NewSongButton clears the
//     open-song slot on the same event, synchronously; this then fills it with
//     the template, which is the order that leaves the slot right if there is
//     no template to load.
//   - a fresh page load of the studio's own URL, which is the other way to get
//     a blank editor (`new` is a real link, so opening it in a new tab
//     arrives here). Skipped when the URL already carries a session -- `?s=` is
//     a share link and `?open=` a deep link, and both load asynchronously too,
//     so racing them would be a coin toss over whose session wins. `?jam=` is
//     the same case once more: a room's session arrives from a peer a moment
//     after joining, and a template landing on top of it would be sent back
//     out to the room as an edit.
//
// The studio is left HOLDING the template (`isTemplate`), so the first save
// makes a song rather than another version of the template. That is the whole
// point: a default template you could accidentally save over would be a trap
// rather than a starting point.
export default function DefaultTemplate() {
  // One fetch per page. The blob is a whole session, base64 sample payloads
  // included, and `new` can be pressed repeatedly.
  //
  // Caught rather than allowed to reject: the studio and the engine are meant
  // to run with no Supabase env at all (`npm run dev` with an empty .env is the
  // documented way to work on the engine), and there the action throws on the
  // client it cannot build. A visitor with no account reaches the same place by
  // a different road, and the right answer for both is the blank session that
  // is already on screen.
  const cached = useRef<Promise<DefaultTemplate | null> | null>(null);

  const apply = useCallback(async () => {
    if (!cached.current)
      cached.current = getDefaultTemplate()
        .then((r) => r.template ?? null)
        .catch(() => null);
    const template = await cached.current;
    if (!template) return;
    try {
      window.seqbaby?.applySet(template.data);
    } catch {
      // A template saved by a newer build, or hand-edited into something
      // applySet refuses: the blank session already in front of the user is a
      // perfectly good fallback, and the open-song slot must stay empty so the
      // next save does not claim to have come from a template it could not
      // load.
      return;
    }
    setOpenSong({
      id: template.id,
      title: template.title,
      versionId: template.versionId,
      isTemplate: true,
    });
  }, []);

  useEffect(() => {
    const onNew = () => void apply();
    window.addEventListener("seqbaby:newset", onNew);

    const qs = new URLSearchParams(location.search);
    const carriesSession = qs.has("s") || qs.has("open") || qs.has("jam");
    let cancelled = false;
    const onReady = () => {
      if (!cancelled) void apply();
    };
    if (!carriesSession) {
      if (window.seqbaby) onReady();
      else window.addEventListener("seqbaby:ready", onReady, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("seqbaby:newset", onNew);
      window.removeEventListener("seqbaby:ready", onReady);
    };
  }, [apply]);

  return null;
}
