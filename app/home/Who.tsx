"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./home.module.css";

// The homepage is cached and shared by everyone, so it cannot know who is
// looking at it. This island asks the browser: a signed-in visitor gets their
// own page in the corner instead of an invitation to sign in. The session read
// is local (no round trip); the handle is one small read of profile_cards.
export default function Who() {
  const [me, setMe] = useState<{ handle: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const id = data.session?.user.id;
        if (!id) return;
        const { data: card } = await supabase
          .from("profile_cards")
          .select("username")
          .eq("id", id)
          .maybeSingle();
        if (!cancelled) setMe({ handle: (card?.username as string) || null });
      } catch {
        // No Supabase env: the engine runs without one, and so does this page.
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
