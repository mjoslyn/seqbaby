"use client";

import { useState } from "react";
import { remixSong } from "@/app/songs/actions";
import { IconRemix } from "./menuIcons";

// Remix someone's song into your own songs, beside its heart: the studio
// byline and a profile page's rows. The remix is saved and that is all; the
// page you are on stays put. Once made, the button becomes a link to it, so a
// second press opens the remix rather than making another.

export default function RemixButton({
  songId,
  className,
  remixedClassName,
}: {
  songId: string;
  className?: string;
  remixedClassName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [remix, setRemix] = useState<{ id: string; title: string } | null>(null);
  const [failed, setFailed] = useState(false);

  async function doRemix() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await remixSong(songId);
      if (res.error === "Not signed in") {
        window.location.href = "/login";
        return;
      }
      // An id with an error is a remix whose first version failed: the song
      // exists, so a retry would make a second one.
      if (!res.id) throw new Error(res.error);
      setRemix({ id: res.id, title: res.title ?? "remix" });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (remix) {
    const label = `remixed into your songs as "${remix.title}", open it`;
    return (
      <a
        className={`${className ?? ""} ${remixedClassName ?? ""}`}
        href={`/studio?open=${remix.id}`}
        aria-label={label}
        title={label}
      >
        <IconRemix />
      </a>
    );
  }

  const label = failed ? "could not remix, try again" : busy ? "remixing…" : "remix into your songs";
  return (
    <button
      type="button"
      className={className}
      onClick={doRemix}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      <IconRemix />
    </button>
  );
}
