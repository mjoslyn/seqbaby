import type { Metadata } from "next";
import Who from "../home/Who";
import Gallery from "./Gallery";
import { loadPatchGallery } from "../home/feed";
import homeStyles from "../home/home.module.css";
import styles from "../songs/explore.module.css";
import { SITE_URL, shareCard } from "../shareCard";

// The patch gallery: every patch people have published (the newest
// GALLERY_WINDOW of them), ranked as the homepage ranks its four, searchable
// by name, engine and person, and paged. Cached like the homepage, for
// feed.ts's reasons; the search and the paging are the browser's
// (Gallery.tsx).
export const revalidate = 60;

const TITLE = "patches · seqbaby";
const DESCRIPTION = "Every sound people have published from the studio. Press play to hear one, or save it into your own patch bay.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/patches" },
  ...shareCard(TITLE, DESCRIPTION, `${SITE_URL}api/og/home`),
};

export default async function PatchesPage() {
  const patches = await loadPatchGallery();
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
          <a className={homeStyles.navLink} href="/people">people</a>
          <a className={homeStyles.navLink} href="/manual">manual</a>
          <Who />
          <a className={`${homeStyles.navLink} ${homeStyles.navCta}`} href="/studio">open the studio →</a>
        </span>
      </nav>
      <header className={styles.head}>
        <h1 className={styles.title}>patches</h1>
        <p className={styles.lede}>every sound people have published. press play to hear one, or save it into your own bay.</p>
      </header>
      <Gallery patches={patches} />
    </div>
  );
}
