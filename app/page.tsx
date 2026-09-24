import type { Metadata } from "next";
import Toy from "./home/Toy";
import Who from "./home/Who";
import SongPreview from "./SongPreview";
import Avatar from "./Avatar";
import PlayableAvatar from "./PlayableAvatar";
import LikeButton from "./LikeButton";
import PlayCard from "./home/PlayCard";
import { loadFeed, fingerprint, type FeedSong } from "./home/feed";
import styles from "./home/home.module.css";
import { SITE_URL, shareCard } from "./shareCard";

// The homepage. The studio itself is at /studio (app/studio/page.tsx); links
// that still name the studio's old place at / (`?s=`, `?open=`, `?jam=`) are
// redirected there by next.config.mjs before this page is reached.
//
// Rendered once a minute and cached in between: see feed.ts for why the feed
// reads no cookies, and Who.tsx for how a signed-in visitor still gets their
// own name in the corner.
export const revalidate = 60;

const TITLE = "seqbaby · a step sequencer with opinions";
const DESCRIPTION =
  "Turn the knobs. All of them. At once. A step sequencer in a browser tab: analog and FM models, 808s, samples, and songs people just made.";

// The homepage's own card: the hero line over the latest published songs
// (app/api/og/home). Pinned to the site's origin, not the request's, because
// reading the host would make this cached page dynamic.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...shareCard(TITLE, DESCRIPTION, `${SITE_URL}api/og/home`),
};

const BOX = [
  ["silverbox", "a model of a certain silver acid box. the squelch is in the circuit, not a preset."],
  ["hexop", "six sine operators, thirty-two algorithms, zero patience for presets you didn't make."],
  ["guitar + bass", "a whole rig in a worklet. turn bloom up and the speaker talks back to the string."],
  ["subby", "bass for phones. it fakes the frequencies your speaker can't make, and your ears believe it."],
  ["plaits", "sixteen models from a very famous little module, running in wasm."],
  ["jam", "send a link. edit the same song together, live. nobody needs an account."],
  ["compose", "describe what you want in plain words."],
  ["euclid + chance", "one button divides a rhythm evenly, the other throws dice at it."],
] as const;

const BLURBS = [
  "no install. no plugin. no manual (there is a manual).",
  "32 patterns per song, which is at least 29 more than you'll finish.",
  "undo goes back 100 steps. regret goes back further.",
];

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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

function SongCard({ song }: { song: FeedSong }) {
  return (
    <li className={styles.card}>
      {/* Beside the link rather than in it: a button inside an <a> is not
          allowed, and the card's own click still opens the song. */}
      <PlayCard slug={song.slug} title={song.title} />
      <a className={styles.cardLink} href={`/studio?s=${encodeURIComponent(song.slug)}`}>
        <span className={styles.print}>
          {song.preview ? <SongPreview preview={song.preview} height="100%" /> : <Fingerprint id={song.id} />}
        </span>
        <span className={styles.cardTitle}>{song.title}</span>
      </a>
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
        {song.bpm ? <span>{song.bpm} bpm</span> : null}
        <span>{ago(song.updatedAt)}</span>
        <LikeButton songId={song.id} likes={song.likes} className={styles.like} likedClassName={styles.liked} />
      </span>
    </li>
  );
}

export default async function HomePage() {
  const { songs, people } = await loadFeed();

  return (
    <div className={styles.home}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={22} height={22} />
          seqbaby
        </a>
        <span className={styles.navLinks}>
          <a className={styles.navLink} href="/manual">manual</a>
          <Who />
          <a className={`${styles.navLink} ${styles.navCta}`} href="/studio">open the studio →</a>
        </span>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.kicker}>a browser step sequencer · est. whenever you pressed play</p>
          <h1 className={styles.title}>
            turn the knobs. all of them. <span className={styles.wobble}>at once.</span>
          </h1>
          <p className={styles.lede}>
            seqbaby is a step sequencer that lives in a tab. hand-built analog and FM models, 808s and
            909s, samples, a guitar that feeds back, and a sub bass that works on a phone. share a song
            with a link. jam on one with a friend.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.cta} href="/studio">open the studio</a>
            <a className={styles.ctaGhost} href="/login?mode=signup">make an account</a>
          </div>
          <p className={styles.small}>no account needed to make noise. you only need one to keep it.</p>
        </div>
        <div className={styles.heroToy}>
          <Toy />
          <p className={styles.toyNote}>
            ↑ this one&apos;s a toy. the real one has 32 patterns, a mod matrix and opinions.
          </p>
        </div>
      </header>

      <ul className={styles.ticker} aria-hidden>
        {[...BLURBS, ...BLURBS].map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>fresh off the sequencer</h2>
          <span className={styles.sectionSub}>songs people have published, the loved and the new first. click one to open it, remix it, fork it.</span>
        </div>
        {songs.length ? (
          <ul className={styles.cards}>
            {songs.map((s) => (
              <SongCard key={s.id} song={s} />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyBig}>¯\_(ツ)_/¯</p>
            <p>
              nothing here yet. the sequencer is lonely. <a href="/studio">make the first one</a>, publish
              it from the songs menu, and it lands right here.
            </p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>people making noise</h2>
          <span className={styles.sectionSub}>everyone with a public page. go see what they&apos;ve made.</span>
        </div>
        {people.length ? (
          <ul className={styles.people}>
            {people.map((p) => (
              <li key={p.handle}>
                <a className={styles.person} href={`/u/${p.handle}`}>
                  <PlayableAvatar grid={p.avatarGrid} name={p.handle} size={44} />
                  <span className={styles.personText}>
                    <span className={styles.personName}>@{p.handle}</span>
                    {p.bio && <span className={styles.personBio}>{p.bio}</span>}
                    <span className={styles.personCount}>
                      {p.songs ? `${p.songs} ${p.songs === 1 ? "song" : "songs"}` : "no songs yet"}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyLine}>
            a room with a sound system and no one in it. <a href="/login?mode=signup">be the first one through the door.</a>
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>what&apos;s in the box</h2>
          <span className={styles.sectionSub}>every engine, knob and fx stage is in the studio. here are some highlights.</span>
        </div>
        <ul className={styles.box}>
          {BOX.map(([name, line], i) => (
            <li key={name} className={styles.boxItem} style={{ ["--tilt" as string]: `${(i % 3) - 1}deg` }}>
              <strong>{name}</strong>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.footer}>
        <a href="/studio">studio</a>
        <a href="/manual">manual</a>
        <span className={styles.footNote}>made with too many oscillators.</span>
      </footer>
    </div>
  );
}
