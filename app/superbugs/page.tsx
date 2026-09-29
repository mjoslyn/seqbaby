import type { Metadata } from "next";
import Toy from "../home/Toy";
import BugForm from "./BugForm";
import styles from "./superbugs.module.css";

export const metadata: Metadata = {
  title: "superbugs · seqbaby",
  description: "Found a bug in seqbaby? Tell us. It goes straight to the repo's issues.",
};

// It loads playing a chugging riff in the spirit of King Gizzard's
// "Superbug": four on the floor, a backbeat, busy hats and a minor-third stab.
// Written by ear, not transcribed.
const SUPERBUG = {
  bpm: 132,
  blip: [0, 0, 3, 0, 0, 5, 3, 0, 0, 0, 3, 0, 7, 5, 3, 0],
  start: ["x...x...x...x...", "....x.......x..x", "x.xxx.xxx.xxx.xx", "x.xx.xx.x.xx.xx."],
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
      <Toy {...SUPERBUG} />
      <BugForm />
    </div>
  );
}
