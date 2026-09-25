"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SongCard from "../home/SongCard";
import homeStyles from "../home/home.module.css";
import styles from "./explore.module.css";
import {
  BPM_BANDS,
  EMPTY_QUERY,
  SORTS,
  explore,
  instrumentCounts,
  pageNumbers,
  paginate,
  parseQuery,
  queryString,
  type Query,
  type SortKey,
} from "./explore";
import type { ExploreSong } from "./exploreFeed";

// The songs explorer's controls and list (/songs). Every song the page loaded
// is here already, so a search, a sort or a filter is a re-render of what is
// in memory (explore.js), never a request.
//
// The query lives in the URL (`?q=&sort=&bpm=&with=&page=`) so a filtered
// view, and the page of it you are on, is a link. It is read after mount rather than on the server: the page is cached
// for everyone (`revalidate` in page.tsx), and reading the query there would
// make it render per request.

export default function Explorer({
  songs,
  hasInstruments,
  now,
}: {
  songs: ExploreSong[];
  hasInstruments: boolean;
  now: number;
}) {
  const [query, setQuery] = useState<Query>(EMPTY_QUERY);
  const read = useRef(false);
  const top = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setQuery(parseQuery(window.location.search));
    read.current = true;
  }, []);

  useEffect(() => {
    if (!read.current) return;
    const next = `${window.location.pathname}${queryString(query)}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [query]);

  const results = useMemo(() => explore(songs, query, now), [songs, query, now]);
  const chips = useMemo(() => (hasInstruments ? instrumentCounts(songs, query) : []), [songs, query, hasInstruments]);

  const { page, pages, start, end } = paginate(results.length, query.page);

  // Any change but a page turn starts over at page 1: page 4 of a list that
  // has just been narrowed to a dozen songs is not a place anybody asked for.
  const update = (patch: Partial<Query>) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const turn = (to: number) => {
    update({ page: to });
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const toggle = (name: string) =>
    update({ with: query.with.includes(name) ? query.with.filter((i) => i !== name) : [...query.with, name] });
  const bpmValue = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const filtered = query.q.trim() !== "" || query.min != null || query.max != null || query.with.length > 0;

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.row}>
          <input
            className={styles.search}
            type="search"
            value={query.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="search titles, people, instruments"
            aria-label="search songs"
          />
          <label className={styles.sort}>
            <span>sort</span>
            <select value={query.sort} onChange={(e) => update({ sort: e.target.value as SortKey })}>
              {SORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>bpm</span>
          <span className={styles.chips}>
            {BPM_BANDS.map(([name, lo, hi]) => {
              const on = query.min === lo && query.max === hi;
              return (
                <button
                  key={name}
                  type="button"
                  className={styles.chip}
                  aria-pressed={on}
                  onClick={() => update(on ? { min: null, max: null } : { min: lo, max: hi })}
                  title={lo == null ? `under ${hi! + 1} bpm` : hi == null ? `${lo} bpm and up` : `${lo} to ${hi} bpm`}
                >
                  {name}
                </button>
              );
            })}
          </span>
          <span className={styles.range}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={query.min ?? ""}
              onChange={(e) => update({ min: bpmValue(e.target.value) })}
              placeholder="min"
              aria-label="lowest bpm"
            />
            <span aria-hidden>to</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={query.max ?? ""}
              onChange={(e) => update({ max: bpmValue(e.target.value) })}
              placeholder="max"
              aria-label="highest bpm"
            />
          </span>
        </div>

        {chips.length ? (
          <div className={styles.row}>
            <span className={styles.label}>with</span>
            <span className={styles.chips}>
              {chips.map(({ name, count }) => {
                const on = query.with.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={styles.chip}
                    aria-pressed={on}
                    disabled={!on && count === 0}
                    onClick={() => toggle(name)}
                  >
                    {name} <span className={styles.count}>{count}</span>
                  </button>
                );
              })}
            </span>
          </div>
        ) : null}
      </div>

      <p className={styles.summary} aria-live="polite" ref={top}>
        {results.length === songs.length
          ? `${songs.length} ${songs.length === 1 ? "song" : "songs"}`
          : `${results.length} of ${songs.length} songs`}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        {filtered ? (
          <button type="button" className={styles.clear} onClick={() => update({ ...EMPTY_QUERY, sort: query.sort })}>
            clear filters
          </button>
        ) : null}
      </p>

      {results.length ? (
        <>
          <ul className={homeStyles.cards}>
            {results.slice(start, end).map((s) => (
              <SongCard key={s.id} song={s} instruments={s.instruments} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav className={styles.pager} aria-label="pages">
              <button type="button" className={styles.pageBtn} disabled={page === 1} onClick={() => turn(page - 1)}>
                ← prev
              </button>
              {pageNumbers(page, pages).map((n, i) =>
                n == null ? (
                  <span key={`gap${i}`} className={styles.gap} aria-hidden>
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={styles.pageBtn}
                    aria-current={n === page ? "page" : undefined}
                    aria-label={`page ${n}`}
                    onClick={() => turn(n)}
                  >
                    {n}
                  </button>
                ),
              )}
              <button type="button" className={styles.pageBtn} disabled={page === pages} onClick={() => turn(page + 1)}>
                next →
              </button>
            </nav>
          ) : null}
        </>
      ) : songs.length ? (
        <div className={homeStyles.empty}>
          <p className={homeStyles.emptyBig}>nothing matches</p>
          <p>
            not a single song.{" "}
            <button type="button" className={styles.clear} onClick={() => update({ ...EMPTY_QUERY, sort: query.sort })}>
              clear the filters
            </button>{" "}
            or <a href="/studio">make the one you were looking for</a>.
          </p>
        </div>
      ) : (
        <div className={homeStyles.empty}>
          <p className={homeStyles.emptyBig}>¯\_(ツ)_/¯</p>
          <p>
            nothing published yet. <a href="/studio">make the first one</a>, publish it from the songs menu, and it
            lands right here.
          </p>
        </div>
      )}
    </>
  );
}
