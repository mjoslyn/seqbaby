"use client";

// The compose panel's `genre` tab (the feature is still called groove in
// the code, the storage key and the docs): browse or search a genre, pick one, and
// a compose turn writes a whole song in it. The genres, their plans and the
// dice are app/songs/genres.js; this is the picker, and it is only the
// picker: ComposeChat renders it inside its own drawer and is handed the
// brief (`onBuild`), which it sends as an ordinary turn. Same model, same
// limits, and it lands in the review bar to be auditioned or kept.

import { useEffect, useMemo, useRef, useState } from "react";
import { GENRES, GENRE_FAMILIES, genreById, genrePrompt, rollGenre, rollSummary, searchGenres } from "@/app/songs/genres.js";
import styles from "@/app/ui.module.css";

type Genre = (typeof GENRES)[number];

const familyName = (id: string) => GENRE_FAMILIES.find((f) => f.id === id)?.name ?? id;

// What the panel holds between openings and reloads: the search, the filter,
// the pick, the note, and the last few builds. Per browser, best effort.
const STORE = "seqbaby.groove.v1";
const MAX_RECENT = 8;
// A build's seed is its dice (rollGenre): kept with the build, so a recent
// one can be built again exactly as it was.
type Recent = { id: string; extra: string; seed?: number };
const newSeed = () => 1 + Math.floor(Math.random() * 0x7fffffff);
type Saved = { query: string; family: string; picked: string; extra: string; recent: Recent[] };
function readSaved(): Partial<Saved> {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function writeSaved(v: Saved) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* blocked storage: it holds for this page */
  }
}

export default function GroovePicker({
  onBuild,
  busy = false,
}: {
  /** The brief for the picked genre and this roll: the panel sends it. */
  onBuild: (prompt: string) => void;
  /** A turn is running: nothing can be built until it is done. */
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  // The dice for the next build. Drawn after mount (a random number in the
  // first render would differ between the server's and the browser's).
  const [seed, setSeed] = useState(1);
  const [loaded, setLoaded] = useState(false);
  // Put back what the panel held last time, once, then keep it written.
  useEffect(() => {
    const s = readSaved();
    if (typeof s.query === "string") setQuery(s.query);
    if (typeof s.family === "string" && (s.family === "" || GENRE_FAMILIES.some((f) => f.id === s.family))) setFamily(s.family);
    if (typeof s.picked === "string" && genreById(s.picked)) setPicked(s.picked);
    if (typeof s.extra === "string") setExtra(s.extra);
    if (Array.isArray(s.recent)) {
      setRecent(s.recent.filter((r) => r && typeof r.id === "string" && genreById(r.id)).slice(0, MAX_RECENT));
    }
    setSeed(newSeed());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) writeSaved({ query, family, picked, extra, recent });
  }, [loaded, query, family, picked, extra, recent]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results: Genre[] = useMemo(() => searchGenres(query, family), [query, family]);
  const genre = picked ? genreById(picked) : undefined;
  const roll = useMemo(() => (genre ? rollGenre(genre, seed) : null), [genre, seed]);

  // A new search or filter starts at the top of the list.
  useEffect(() => setActive(0), [query, family]);
  // Mounted is shown: the tab was just opened.
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);
  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Picking leaves the search as it was, so the list stays to pick again.
  // A fresh pick is a fresh roll.
  const pick = (g: Genre) => {
    if (g.id !== picked) setSeed(newSeed());
    setPicked(g.id);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const g = results[active];
      if (g) {
        if (g.id === picked) build();
        else pick(g);
      }
    }
  };

  const build = () => {
    if (!genre || busy) return;
    onBuild(genrePrompt(genre, extra, seed));
    // The note stays (it is the history), and the build goes to the front of
    // the recent row, a repeat moved up rather than listed twice.
    const note = extra.trim();
    setRecent((r) => [{ id: genre.id, extra: note, seed }, ...r.filter((x) => !(x.id === genre.id && x.extra === note))].slice(0, MAX_RECENT));
    // The next build of the same genre is a different song.
    setSeed(newSeed());
  };

  const surprise = () => {
    const pool = family ? GENRES.filter((g) => g.family === family) : GENRES;
    const g = pool[Math.floor(Math.random() * pool.length)];
    if (!g) return;
    pick(g);
    setQuery("");
    setTimeout(() => listRef.current?.querySelector(`#groove-${g.id}`)?.scrollIntoView({ block: "nearest" }), 0);
  };

  return (
    <div className={styles.groovePane}>
          <input
            ref={searchRef}
            className={styles.grooveSearch}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="groove-list"
            aria-activedescendant={results[active] ? `groove-${results[active].id}` : undefined}
            placeholder={`search ${GENRES.length} genres…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={onSearchKey}
          />
          <div className={styles.grooveChips} role="group" aria-label="filter by family">
            <button
              className={`${styles.grooveChip} ${family === "" ? styles.grooveChipOn : ""}`}
              onClick={() => setFamily("")}
              aria-pressed={family === ""}
            >
              all
            </button>
            {GENRE_FAMILIES.map((f) => (
              <button
                key={f.id}
                className={`${styles.grooveChip} ${family === f.id ? styles.grooveChipOn : ""}`}
                onClick={() => setFamily(family === f.id ? "" : f.id)}
                aria-pressed={family === f.id}
              >
                {f.name}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className={styles.grooveChips} role="group" aria-label="recent grooves">
              <span className={styles.grooveRecentLabel}>recent</span>
              {recent.map((r) => {
                const g = genreById(r.id);
                if (!g) return null;
                return (
                  <button
                    key={r.id + "|" + r.extra}
                    className={`${styles.grooveChip} ${picked === r.id && extra.trim() === r.extra ? styles.grooveChipOn : ""}`}
                    title={`${r.extra ? `${g.name}: ${r.extra}` : g.name} (the same roll as that build; reroll for another)`}
                    onClick={() => {
                      setPicked(r.id);
                      setExtra(r.extra);
                      setSeed(typeof r.seed === "number" ? r.seed : newSeed());
                      setTimeout(() => listRef.current?.querySelector(`#groove-${r.id}`)?.scrollIntoView({ block: "nearest" }), 0);
                    }}
                  >
                    {g.name}
                    {r.extra ? " +" : ""}
                  </button>
                );
              })}
            </div>
          )}
          <ul id="groove-list" className={styles.grooveList} role="listbox" ref={listRef}>
            {results.length === 0 && <li className={styles.grooveNone}>no genre matches that</li>}
            {results.map((g, i) => (
              <li
                key={g.id}
                id={`groove-${g.id}`}
                data-i={i}
                role="option"
                aria-selected={g.id === picked}
                className={`${styles.grooveItem} ${i === active ? styles.grooveItemActive : ""} ${
                  g.id === picked ? styles.grooveItemPicked : ""
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(g)}
              >
                <span className={styles.grooveName}>{g.name}</span>
                <span className={styles.grooveMeta}>
                  {g.bpm[0]}-{g.bpm[1]} · {familyName(g.family)}
                </span>
              </li>
            ))}
          </ul>
          {genre ? (
            <div className={styles.grooveDetail}>
              <div className={styles.grooveDetailName}>
                {genre.name} <span className={styles.grooveMeta}>{genre.bpm[0]}-{genre.bpm[1]} bpm</span>
              </div>
              <div className={styles.grooveBrief}>{genre.brief}</div>
              {roll && (
                <div className={styles.grooveRoll}>
                  <span title="what the dice chose for this build: tempo, key, the parts and the form. Each build is rolled afresh">
                    {rollSummary(roll)}
                  </span>
                  <button className={styles.grooveChip} onClick={() => setSeed(newSeed())} title="roll again: another tempo, key, set of parts and form">
                    reroll
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.grooveBrief}>pick a genre from the list, or let it surprise you.</div>
          )}
          <input
            className={styles.grooveSearch}
            placeholder="anything else? (optional: “in D minor”, “add a vocal”)"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                build();
              }
            }}
          />
          <div className={styles.chatReviewBtns}>
            <button className={styles.smallBtn} onClick={surprise} title="pick a genre at random (from the filter, if one is on)">
              surprise me
            </button>
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={build}
              disabled={!genre || busy}
              title="write a whole song in this genre. It lands for review: nothing replaces the song until you keep it"
            >
              build
            </button>
          </div>
    </div>
  );
}
