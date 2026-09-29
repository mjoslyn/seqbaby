import type { Metadata } from "next";
import Toy from "../home/Toy";
import BugForm from "./BugForm";
import styles from "./superbugs.module.css";

export const metadata: Metadata = {
  title: "superbugs · seqbaby",
  description: "Found a bug in seqbaby? Tell us. It goes straight to the repo's issues.",
};

// Sections of King Gizzard's "Superbug", from the tab, in C# minor at 90. The
// blip lane's numbers are semitones from A3 (220Hz), so C#3 is -8 and the low
// C# string's D#2 is -18. The intro is the clean riff's sixteen eighths (F# D#
// C# D# F# D# C# D# F# G# A# C# A# G# F# D#), the verse is the palm-muted chug
// on D#2, the chorus the same string's D# D# D# E D# figure. Drums are plain
// rock beats of my own.
const SUPERBUG = {
  bpm: 90,
  sections: [
    {
      name: "intro",
      blip: [-3, -6, -8, -6, -3, -6, -8, -6, -3, -1, 1, 4, 1, -1, -3, -6],
      start: ["x.......x.x.....", "....x.......x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
    },
    {
      name: "verse",
      blip: Array(16).fill(-18),
      start: ["x.......x.......", "....x.......x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
    },
    {
      name: "chorus",
      blip: [...Array(3).fill([-18, -18, -18, -17, -18]).flat(), -18],
      start: ["x...x...x...x...", "....x.......x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
    },
  ],
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
