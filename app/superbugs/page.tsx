import type { Metadata } from "next";
import Toy from "../home/Toy";
import BugForm from "./BugForm";
import styles from "./superbugs.module.css";

export const metadata: Metadata = {
  title: "superbugs · seqbaby",
  description: "Found a bug in seqbaby? Tell us. It goes straight to the repo's issues.",
};

// It loads playing the intro riff of King Gizzard's "Superbug", from the tab:
// C# minor, the clean intro's sixteen eighths (F# D# C# D# F# D# C# D# F# G#
// A# C# A# G# F# D#). The blip lane's numbers are semitones from A3 (220Hz),
// so C#3 is -8. Drums are a plain rock beat of my own, and the tempo is
// 90, as told.
const SUPERBUG = {
  bpm: 90,
  blip: [-3, -6, -8, -6, -3, -6, -8, -6, -3, -1, 1, 4, 1, -1, -3, -6],
  start: ["x.......x.x.....", "....x.......x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
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
