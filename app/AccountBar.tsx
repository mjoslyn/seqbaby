"use client";

import { signOut } from "@/app/auth/actions";
import SongsMenu from "@/app/SongsMenu";
import SaveButton from "@/app/SaveButton";
import styles from "@/app/ui.module.css";

// A dedicated account bar that sits above the transport (rendered as the first
// element on the page, ahead of the engine markup).
export function AccountBar({
  name,
  username,
}: {
  name: string | null;
  username?: string | null;
}) {
  return (
    <div className={styles.topBar}>
      <a className={styles.manualLink} href="/manual" title="how seqbaby works">
        manual
      </a>
      {name && <SaveButton />}
      <button
        className={styles.shareBtn}
        onClick={() => window.seqbaby?.onShareSet?.()}
        title="create a shareable link for this session"
      >
        share
      </button>
      {name ? (
        <>
          <SongsMenu />
          <a
            className={styles.accountName}
            title="your profile"
            href={username ? `/u/${username}` : "/settings"}
          >
            {name}
          </a>
          <a className={styles.accountBtn} href="/settings">
            settings
          </a>
          <form action={signOut}>
            <button className={styles.accountBtn} type="submit">
              sign out
            </button>
          </form>
        </>
      ) : (
        <a className={styles.accountBtn} href="/login">
          sign in
        </a>
      )}
    </div>
  );
}
