import type { Metadata } from "next";
import Toy from "../home/Toy";
import BugForm from "./BugForm";
import styles from "./superbugs.module.css";

export const metadata: Metadata = {
  title: "superbugs · seqbaby",
  description: "Found a bug in seqbaby? Tell us. It goes straight to the repo's issues.",
};

// The intro riff of King Gizzard's "Superbug", from the tab: C# minor, 3/4 at
// 90, three bars of eighths. Bars one and two are F# . D# . C# D#, bar three
// runs F# G# A# C# A# G#. The blip lane's numbers are semitones from A3
// (220Hz), so C#3 is -8; a number on a rest step is only there for a shaken-in
// note to land on. The drums are a plain waltz of my own.
const SUPERBUG = {
  bpm: 90,
  steps: 18,
  perBeat: 2,
  blip: [-3, -6, -6, -6, -8, -6, -3, -6, -6, -6, -8, -6, -3, -1, 1, 4, 1, -1],
  start: ["x.....x.....x.....", "....x.....x.....x.", "xxxxxxxxxxxxxxxxxx", "x.x.xxx.x.xxxxxxxx"],
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
