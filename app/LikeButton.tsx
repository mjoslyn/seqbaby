"use client";

import { useEffect, useState } from "react";
import { likedSongIds, setLike } from "@/app/songs/actions";
import { likedPatchIds, setPatchLike } from "@/app/patches/actions";
import { loginHref } from "@/lib/safeNext";

// The heart on a song or patch card: the homepage feed and a profile page.
//
// The count comes from the server, the "did I" from here. The homepage is
// cached and shared by everyone (see home/feed.ts), so it cannot know who is
// looking; this asks from the browser, which carries the session cookie.
// Twenty-four hearts asking separately would be twenty-four requests, so every
// heart that mounts in the same tick joins one (`likedByMe`), one per kind.

type Kind = "song" | "patch";
const LIKED = { song: likedSongIds, patch: likedPatchIds } as const;
const SET_LIKE = { song: setLike, patch: setPatchLike } as const;

const pendingBy: Record<Kind, { ids: Set<string>; done: Promise<Set<string>> } | null> = { song: null, patch: null };

function likedByMe(kind: Kind, id: string): Promise<Set<string>> {
  let pending = pendingBy[kind];
  if (!pending) {
    const ids = new Set<string>();
    const done = new Promise<Set<string>>((resolve) => {
      queueMicrotask(async () => {
        pendingBy[kind] = null;
        try {
          // Signed out, the answer is an empty list.
          resolve(new Set(await LIKED[kind]([...ids])));
        } catch {
          resolve(new Set());
        }
      });
    });
    pending = pendingBy[kind] = { ids, done };
  }
  pending.ids.add(id);
  return pending.done;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LikeButton({
  songId,
  kind = "song",
  likes: initial,
  className,
  likedClassName,
}: {
  /** The song's id, or the patch's when `kind` is "patch". */
  songId: string;
  kind?: Kind;
  likes: number;
  className?: string;
  likedClassName?: string;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    likedByMe(kind, songId).then((set) => {
      if (!cancelled && set.has(songId)) setLiked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, songId]);

  async function toggle() {
    if (busy) return;
    const next = !liked;
    // Optimistic: a heart that waits a round trip to fill feels broken.
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    setBusy(true);
    try {
      const res = await SET_LIKE[kind](songId, next);
      if (res.error === "not signed in") {
        window.location.href = loginHref(location.pathname + location.search);
        return;
      }
      if (res.error) throw new Error(res.error);
      if (typeof res.likes === "number") setLikes(res.likes);
    } catch {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`${className ?? ""} ${liked ? (likedClassName ?? "") : ""}`}
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? `unlike (${likes})` : `like (${likes})`}
      title={liked ? "unlike" : "like"}
    >
      <Heart filled={liked} />
      <span>{likes}</span>
    </button>
  );
}
