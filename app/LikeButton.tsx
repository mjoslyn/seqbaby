"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setLike } from "@/app/songs/actions";

// The heart on a song card: the homepage feed and a profile page.
//
// The count comes from the server, the "did I" from here. The homepage is
// cached and shared by everyone (see home/feed.ts), so it cannot know who is
// looking; this asks the browser, the way home/Who.tsx does. Twenty-four
// hearts asking separately would be twenty-four reads, so every heart that
// mounts in the same tick joins one query (`likedByMe`).

let pending: { ids: Set<string>; done: Promise<Set<string>> } | null = null;

function likedByMe(id: string): Promise<Set<string>> {
  if (!pending) {
    const ids = new Set<string>();
    const done = new Promise<Set<string>>((resolve) => {
      queueMicrotask(async () => {
        pending = null;
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          const me = data.session?.user.id;
          if (!me) return resolve(new Set());
          const { data: rows } = await supabase
            .from("song_likes")
            .select("song_id")
            .eq("user_id", me)
            .in("song_id", [...ids]);
          resolve(new Set((rows ?? []).map((r) => r.song_id as string)));
        } catch {
          // No Supabase env, or no 0016 yet: nothing is liked.
          resolve(new Set());
        }
      });
    });
    pending = { ids, done };
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
  likes: initial,
  className,
  likedClassName,
}: {
  songId: string;
  likes: number;
  className?: string;
  likedClassName?: string;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    likedByMe(songId).then((set) => {
      if (!cancelled && set.has(songId)) setLiked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  async function toggle() {
    if (busy) return;
    const next = !liked;
    // Optimistic: a heart that waits a round trip to fill feels broken.
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    setBusy(true);
    try {
      const res = await setLike(songId, next);
      if (res.error === "Not signed in") {
        window.location.href = "/login";
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
