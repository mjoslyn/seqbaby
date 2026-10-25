"use client";

import { useEffect, useState } from "react";
import styles from "./home.module.css";

// The homepage is cached and shared by everyone, so it cannot know who is
// looking at it. This island asks (/api/me, which reads the session cookie):
// a signed-in visitor gets their own page in the corner instead of an
// invitation to sign in.
export default function Who() {
  const [me, setMe] = useState<{ handle: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        const body = (await res.json()) as { id: string | null; handle?: string | null };
        if (!body.id) return;
        if (!cancelled) setMe({ handle: body.handle || null });
      } catch {
        // Offline, or no database: the page still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me) return <a className={styles.navLink} href="/login">sign in</a>;
  return (
    <a className={styles.navLink} href={me.handle ? `/u/${me.handle}` : "/settings"}>
      {me.handle ? `@${me.handle}` : "you"}
    </a>
  );
}
