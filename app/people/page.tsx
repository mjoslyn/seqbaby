import type { Metadata } from "next";
import Who from "../home/Who";
import PeopleExplorer from "./PeopleExplorer";
import { loadPeopleCatalog } from "./peopleFeed";
import homeStyles from "../home/home.module.css";
import styles from "../songs/explore.module.css";
import { SITE_URL, shareCard } from "../shareCard";

// The people explorer: everyone with a public page who has published a song
// or a patch, searchable by name, bio and instrument, sortable, and filtered
// by the tempo they work at and what they use. Cached like the songs
// explorer, for feed.ts's reasons; the filtering is the browser's
// (PeopleExplorer.tsx).
export const revalidate = 60;

const TITLE = "people · seqbaby";
const DESCRIPTION = "Everyone publishing songs and patches from the studio. Find people by name, tempo and instrument.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...shareCard(TITLE, DESCRIPTION, `${SITE_URL}api/og/home`),
};

export default async function PeoplePage() {
  const { people, hasInstruments } = await loadPeopleCatalog();
  return (
    <div className={homeStyles.home}>
      <nav className={homeStyles.nav}>
        <a className={homeStyles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={22} height={22} />
          seqbaby
        </a>
        <span className={homeStyles.navLinks}>
          <a className={homeStyles.navLink} href="/songs">songs</a>
          <a className={homeStyles.navLink} href="/manual">manual</a>
          <Who />
          <a className={`${homeStyles.navLink} ${homeStyles.navCta}`} href="/studio">open the studio →</a>
        </span>
      </nav>
      <header className={styles.head}>
        <h1 className={styles.title}>people</h1>
        <p className={styles.lede}>everyone making noise in here. find your people, press their faces.</p>
      </header>
      <PeopleExplorer people={people} hasInstruments={hasInstruments} />
    </div>
  );
}
