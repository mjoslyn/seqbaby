"use client";

import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import LikeButton from "@/app/LikeButton";
import RemixButton from "@/app/RemixButton";
import { subscribeOpenSong, getOpenSong } from "@/app/songs/openSong";
import type { LinkedSongCard } from "@/app/songs/linkedSongTitle";
import styles from "@/app/ui.module.css";

// Whose song this is, when it is not yours: "cold squelch by @mike", at the
// left of the top bar. A share link or a deep link to someone else's song
// otherwise opened in a studio that looked exactly like your own, with nothing
// saying whose work you were hearing or where to find more of it.
//
// Resolved on the server from the URL (linkedSongCard), because the engine
// clears `?s=` from the address bar as soon as the song lands. It goes away
// once the studio stops holding that song: `new`, a song of your own opened
// or saved (the open-song slot gets an id, which someone else's song never
// sets), or any other session arriving after the linked one.
export default function SongByline({ song }: { song: LinkedSongCard }) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const hide = () => setShown(false);
    const unsub = subscribeOpenSong(() => {
      if (getOpenSong().id) hide();
    });
    // The first session to arrive is the linked song itself; anything after
    // it (an import, a jam's song) is something else. Counted by the engine
    // (session.js), since this may mount after the first one landed.
    const onApplied = () => {
      if ((window.__seqbabySetsApplied ?? 0) > 1) hide();
    };
    window.addEventListener("seqbaby:newset", hide);
    window.addEventListener("seqbaby:setapplied", onApplied);
    return () => {
      unsub();
      window.removeEventListener("seqbaby:newset", hide);
      window.removeEventListener("seqbaby:setapplied", onApplied);
    };
  }, []);

  if (!shown) return null;
  const who = song.ownerHandle ?? song.owner;
  return (
    <span className={styles.byline} title={who ? `"${song.title}" by ${who}` : song.title}>
      <span className={styles.bylineTitle}>{song.title}</span>
      {who && (
        <>
          <span className={styles.bylineBy}>by</span>
          {song.ownerHandle ? (
            <a className={styles.bylineOwner} href={`/u/${song.ownerHandle}`}>
              <Avatar grid={song.ownerAvatarGrid} name={song.ownerHandle} size={16} />
              <span className={styles.bylineOwnerName}>@{song.ownerHandle}</span>
            </a>
          ) : (
            <span className={styles.bylineOwner}>
              <Avatar grid={song.ownerAvatarGrid} name={who} size={16} />
              <span className={styles.bylineOwnerName}>{who}</span>
            </span>
          )}
        </>
      )}
      {song.songId && (
        <LikeButton
          songId={song.songId}
          likes={song.likes}
          className={styles.bylineLike}
          likedClassName={styles.bylineLiked}
        />
      )}
      {song.songId && (
        <RemixButton songId={song.songId} openHere className={styles.bylineLike} remixedClassName={styles.bylineRemixed} />
      )}
    </span>
  );
}
