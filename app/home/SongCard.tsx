import SongPreview from "../SongPreview";
import Avatar from "../Avatar";
import LikeButton from "../LikeButton";
import PlayButton from "../PlayButton";
import RemixButton from "../RemixButton";
import { fingerprint } from "./fingerprint";
import type { FeedSong } from "./feed";
import styles from "./home.module.css";

// A published song's card: the homepage feed and the songs explorer (/songs).
// No hooks and no "use client", like SongPreview, so a server page and the
// explorer's client list draw it the same way.

function Fingerprint({ id }: { id: string }) {
  const lanes = fingerprint(id);
  return (
    <svg className={styles.printSvg} viewBox="0 0 64 16" aria-hidden preserveAspectRatio="none">
      {lanes.map((lane, y) =>
        lane.map((on, x) => (
          <rect
            key={`${y}-${x}`}
            x={x * 4 + 0.5}
            y={y * 4 + 0.5}
            width={3}
            height={3}
            rx={0.6}
            className={on ? styles.printOn : styles.printOff}
          />
        )),
      )}
    </svg>
  );
}

export default function SongCard({
  song,
  instruments,
}: {
  song: FeedSong;
  /** Drawn as tags under the title when given (the explorer). */
  instruments?: string[];
}) {
  return (
    <li className={styles.card}>
      {/* Beside the link rather than in it: a button inside an <a> is not
          allowed, and the card's own click still opens the song. */}
      <PlayButton slug={song.slug} title={song.title} />
      <a className={styles.cardLink} href={`/studio?s=${encodeURIComponent(song.slug)}`}>
        <span className={styles.print}>
          {song.preview ? <SongPreview preview={song.preview} height="100%" /> : <Fingerprint id={song.id} />}
        </span>
        <span className={styles.cardTitle}>{song.title}</span>
      </a>
      {instruments?.length ? (
        <span className={styles.cardTags}>
          {instruments.map((i) => (
            <span key={i} className={styles.engineTag}>
              {i}
            </span>
          ))}
        </span>
      ) : null}
      <span className={styles.cardMeta}>
        {song.owner ? (
          song.owner.handle ? (
            <a className={styles.cardOwner} href={`/u/${song.owner.handle}`}>
              <Avatar grid={song.owner.avatarGrid} name={song.owner.handle} size={18} />@{song.owner.handle}
            </a>
          ) : (
            <span className={styles.cardOwner}>
              <Avatar grid={song.owner.avatarGrid} name={song.owner.name} size={18} />
              {song.owner.name}
            </span>
          )
        ) : (
          <span>someone</span>
        )}
      </span>
      {/* A line of its own: the bpm on the left, the heart and the remix
          pushed right by the heart's auto margin, with or without a bpm. */}
      <span className={`${styles.cardMeta} ${styles.cardActions}`}>
        {song.bpm ? <span>{song.bpm} bpm</span> : null}
        <LikeButton songId={song.id} likes={song.likes} className={styles.like} likedClassName={styles.liked} />
        <RemixButton songId={song.id} className={styles.savePatch} remixedClassName={styles.saved} />
      </span>
    </li>
  );
}
