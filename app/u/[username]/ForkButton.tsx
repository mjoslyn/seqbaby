"use client";

import { useState } from "react";
import { forkSong } from "@/app/songs/actions";
import styles from "@/app/ui.module.css";

// Fork a session into your account and open it in the studio.
export default function ForkButton({ songId }: { songId: string }) {
  const [busy, setBusy] = useState(false);

  async function fork() {
    setBusy(true);
    const res = await forkSong(songId);
    if (res.error === "Not signed in") {
      window.location.href = "/login";
      return;
    }
    if (res.error || !res.id) {
      setBusy(false);
      return;
    }
    // Full navigation into the studio, which opens the fork once booted.
    window.location.href = `/?open=${res.id}`;
  }

  return (
    <button className={styles.repoAction} onClick={fork} disabled={busy}>
      {busy ? "forking…" : "fork"}
    </button>
  );
}
