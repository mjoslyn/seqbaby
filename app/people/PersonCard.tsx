import PlayableAvatar from "../PlayableAvatar";
import { ago } from "../home/SongCard";
import homeStyles from "../home/home.module.css";
import styles from "./people.module.css";
import type { Person } from "./people";

// A person's card in the people explorer (/people): the homepage's person
// card, plus what they have published, their hearts, when they last
// published, the tempo they work at and the instruments they reach for.

/** How many instrument tags a card shows before it says "+n". */
const TAGS = 6;

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export default function PersonCard({ person: p, now }: { person: Person; now: number }) {
  const made = [p.songs ? count(p.songs, "song") : "", p.patches ? count(p.patches, "patch") : ""].filter(Boolean);
  const more = p.instruments.length - TAGS;
  return (
    <li>
      <a className={`${homeStyles.person} ${styles.card}`} href={`/u/${p.handle}`}>
        <PlayableAvatar grid={p.avatarGrid} name={p.handle} size={44} />
        <span className={homeStyles.personText}>
          <span className={homeStyles.personName}>@{p.handle}</span>
          {p.bio && <span className={homeStyles.personBio}>{p.bio}</span>}
          <span className={homeStyles.personCount}>
            {made.join(" · ")}
            {p.likes ? ` · ♥ ${p.likes}` : ""}
          </span>
          <span className={styles.meta}>
            {p.bpm != null ? `~${p.bpm} bpm · ` : ""}last published {ago(p.latest, now)}
          </span>
          {p.instruments.length ? (
            <span className={homeStyles.cardTags}>
              {p.instruments.slice(0, TAGS).map((i) => (
                <span key={i} className={homeStyles.engineTag}>
                  {i}
                </span>
              ))}
              {more > 0 ? <span className={styles.more}>+{more}</span> : null}
            </span>
          ) : null}
        </span>
      </a>
    </li>
  );
}
