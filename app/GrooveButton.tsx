"use client";

// The top bar's `groove`: browse or search a genre, pick one, and a compose
// session starts writing a whole song in it. The genres and their briefs are
// app/songs/genres.js; this is the picker. Building hands the brief to the
// compose panel as an event (ComposeChat listens for `seqbaby:groove`), so the
// turn is an ordinary compose turn: same key, same limits, and it lands in the
// review bar to be auditioned or kept.

import { useEffect, useMemo, useRef, useState } from "react";
import { GENRES, GENRE_FAMILIES, genreById, genrePrompt, rollGenre, rollSummary, searchGenres } from "@/app/songs/genres.js";
import { signupHref } from "@/lib/safeNext.js";
import { COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL } from "@/lib/composeModels.js";
import { MODEL_EVENT, readModelPref, writeModelPref } from "@/app/composeModelPref";
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

export default function GrooveButton({
  signedIn,
  canPickModel = false,
  defaultModel = DEFAULT_COMPOSE_MODEL,
}: {
  signedIn: boolean;
  /** This account is on COMPOSE_MODEL_PICKERS: the same menu compose has. */
  canPickModel?: boolean;
  defaultModel?: string;
}) {
  // One remembered pick shared with compose (app/composeModelPref.ts).
  const [model, setModel] = useState(defaultModel);
  useEffect(() => {
    if (!canPickModel) return;
    setModel(readModelPref(defaultModel));
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<{ model?: string }>).detail?.model;
      if (id) setModel(id);
    };
    window.addEventListener(MODEL_EVENT, onPick);
    return () => window.removeEventListener(MODEL_EVENT, onPick);
  }, [canPickModel, defaultModel]);
  const [open, setOpen] = useState(false);
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
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);
  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
    if (!genre) return;
    window.dispatchEvent(new CustomEvent("seqbaby:groove", {
      detail: { prompt: genrePrompt(genre, extra, seed), ...(canPickModel ? { model } : {}) },
    }));
    setOpen(false);
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
    <div className={styles.songsWrap}>
      <button
        className={styles.accountBtn}
        onClick={() => {
          // Groove runs on compose, which needs an account: a signed-out
          // visitor is sent to make one and comes back here after.
          if (!signedIn) {
            location.href = signupHref(location.pathname + location.search);
            return;
          }
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        title={signedIn ? "pick a genre and compose writes a whole song in it" : "make an account to build songs from a genre"}
      >
        groove
      </button>
      {open && <div className={styles.chatBackdrop} onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className={`${styles.panel} ${styles.chatPanel} ${styles.groovePanel}`} role="dialog" aria-label="groove">
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>pick a groove</div>
            <button className={styles.panelClose} onClick={() => setOpen(false)} aria-label="close" title="close">
              ×
            </button>
          </div>
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
          {canPickModel && (
            <label className={styles.chatModelRow}>
              <span className={styles.chatModelLabel}>model</span>
              <select
                className={styles.chatModelSelect}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  writeModelPref(e.target.value);
                }}
              >
                {COMPOSE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.chatReviewBtns}>
            <button className={styles.smallBtn} onClick={surprise} title="pick a genre at random (from the filter, if one is on)">
              surprise me
            </button>
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={build}
              disabled={!genre}
              title="open compose and write a whole song in this genre. It lands for review: nothing replaces the song until you keep it"
            >
              build in compose
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
