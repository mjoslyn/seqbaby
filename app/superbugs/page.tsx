import type { Metadata } from "next";
import BugForm from "./BugForm";
import styles from "./superbugs.module.css";

export const metadata: Metadata = {
  title: "superbugs · seqbaby",
  description: "Found a bug in seqbaby? Tell us. It goes straight to the repo's issues.",
};

export default function SuperbugsPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/">← seqbaby</a>
        <a href="/studio">studio</a>
        <a href="/manual">manual</a>
      </nav>
      <h1 className={styles.title}>superbugs</h1>
      <p className={styles.lede}>
        something crawled into the sequencer and it is not a feature. tell us what it did. no account
        needed; it lands as an issue on{" "}
        <a href="https://github.com/mjoslyn/seqbaby/issues" target="_blank" rel="noopener noreferrer">
          the repo
        </a>
        .
      </p>
      <BugForm />
    </div>
  );
}
