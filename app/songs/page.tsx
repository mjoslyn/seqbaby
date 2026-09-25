import type { Metadata } from "next";
import Who from "../home/Who";
import Explorer from "./Explorer";
import { loadExplore } from "./exploreFeed";
import homeStyles from "../home/home.module.css";
import styles from "./explore.module.css";
import { SITE_URL, shareCard } from "../shareCard";

// The songs explorer: every published song (the newest EXPLORE_WINDOW of
// them), searchable by title, person and instrument, sortable, and filtered
// by tempo and by what it is made of. Cached like the homepage, for
// feed.ts's reasons; the filtering is the browser's (Explorer.tsx).
export const revalidate = 60;

const TITLE = "songs · seqbaby";
const DESCRIPTION = "Every song people have published from the studio. Search them, sort them, and filter by tempo and instrument.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...shareCard(TITLE, DESCRIPTION, `${SITE_URL}api/og/home`),
};

export default async function SongsPage() {
  const { songs, hasInstruments, now } = await loadExplore();
  return (
    <div className={homeStyles.home}>
      <nav className={homeStyles.nav}>
        <a className={homeStyles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={22} height={22} />
          seqbaby
        </a>
        <span className={homeStyles.navLinks}>
          <a className={homeStyles.navLink} href="/manual">manual</a>
          <Who />
          <a className={`${homeStyles.navLink} ${homeStyles.navCta}`} href="/studio">open the studio →</a>
        </span>
      </nav>
      <header className={styles.head}>
        <h1 className={styles.title}>songs</h1>
        <p className={styles.lede}>everything people have published. dig in, press play, steal ideas.</p>
      </header>
      <Explorer songs={songs} hasInstruments={hasInstruments} now={now} />
    </div>
  );
}
