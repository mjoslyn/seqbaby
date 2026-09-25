"use client";

import { useState } from "react";
import { forkSong } from "@/app/songs/actions";
import { IconFork } from "./menuIcons";

// Fork someone's song into your own songs, beside its heart: the studio
// byline and a profile page's rows. The fork is saved and that is all; the
// page you are on stays put. Once made, the button becomes a link to it, so a
// second press opens the fork rather than making another.

export default function ForkButton({
  songId,
  className,
  forkedClassName,
}: {
  songId: string;
  className?: string;
  forkedClassName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [fork, setFork] = useState<{ id: string; title: string } | null>(null);
  const [failed, setFailed] = useState(false);

  async function doFork() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await forkSong(songId);
      if (res.error === "Not signed in") {
        window.location.href = "/login";
        return;
      }
      // An id with an error is a fork whose first version failed: the song
      // exists, so a retry would make a second one.
      if (!res.id) throw new Error(res.error);
      setFork({ id: res.id, title: res.title ?? "fork" });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (fork) {
    const label = `forked into your songs as "${fork.title}", open it`;
    return (
      <a
        className={`${className ?? ""} ${forkedClassName ?? ""}`}
        href={`/studio?open=${fork.id}`}
        aria-label={label}
        title={label}
      >
        <IconFork />
      </a>
    );
  }

  const label = failed ? "could not fork, try again" : busy ? "forking…" : "fork into your songs";
  return (
    <button
      type="button"
      className={className}
      onClick={doFork}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      <IconFork />
    </button>
  );
}
