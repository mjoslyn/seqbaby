"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PersonCard from "./PersonCard";
import Pager from "../songs/Pager";
import homeStyles from "../home/home.module.css";
import styles from "../songs/explore.module.css";
import {
  BPM_BANDS,
  EMPTY_QUERY,
  MAKES,
  SORTS,
  explorePeople,
  instrumentCounts,
  paginate,
  parseQuery,
  queryString,
  type Makes,
  type Person,
  type Query,
  type SortKey,
} from "./people";

// The people explorer's controls and list (/people), the songs explorer's
// (app/songs/Explorer.tsx) with people in it: everyone is in memory already,
// so a search, a sort or a filter is a re-render (people.js), and the query
// lives in the URL, read after mount so the cached page stays cached.

export default function PeopleExplorer({
  people,
  hasInstruments,
}: {
  people: Person[];
  hasInstruments: boolean;
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

  const results = useMemo(() => explorePeople(people, query), [people, query]);
  const chips = useMemo(() => (hasInstruments ? instrumentCounts(people, query) : []), [people, query, hasInstruments]);

  const { page, pages, start, end } = paginate(results.length, query.page);

  // Any change but a page turn starts over at page 1, as on /songs.
  const update = (patch: Partial<Query>) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const turn = (to: number) => {
    update({ page: to });
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const toggle = (name: string) =>
    update({ with: query.with.includes(name) ? query.with.filter((i) => i !== name) : [...query.with, name] });
  const toggleMakes = (m: Makes) =>
    update({ makes: query.makes.includes(m) ? query.makes.filter((x) => x !== m) : [...query.makes, m] });
  const bpmValue = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const filtered =
    query.q.trim() !== "" || query.min != null || query.max != null || query.with.length > 0 || query.makes.length > 0;
  const clear = () => update({ ...EMPTY_QUERY, sort: query.sort });

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.row}>
          <input
            className={styles.search}
            type="search"
            value={query.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="search names, bios, instruments"
            aria-label="search people"
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
          <span className={styles.label}>makes</span>
          <span className={styles.chips}>
            {MAKES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                aria-pressed={query.makes.includes(key)}
                onClick={() => toggleMakes(key)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.label} title="the median tempo of their songs">
            bpm
          </span>
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
                  title={
                    lo == null
                      ? `mostly under ${hi! + 1} bpm`
                      : hi == null
                        ? `mostly ${lo} bpm and up`
                        : `mostly ${lo} to ${hi} bpm`
                  }
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
            <span className={styles.label}>uses</span>
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
        {results.length === people.length
          ? `${people.length} ${people.length === 1 ? "person" : "people"}`
          : `${results.length} of ${people.length} people`}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        {filtered ? (
          <button type="button" className={styles.clear} onClick={clear}>
            clear filters
          </button>
        ) : null}
      </p>

      {results.length ? (
        <>
          <ul className={homeStyles.people}>
            {results.slice(start, end).map((p) => (
              <PersonCard key={p.handle} person={p} />
            ))}
          </ul>
          <Pager page={page} pages={pages} turn={turn} />
        </>
      ) : people.length ? (
        <div className={homeStyles.empty}>
          <p className={homeStyles.emptyBig}>nobody matches</p>
          <p>
            not a soul.{" "}
            <button type="button" className={styles.clear} onClick={clear}>
              clear the filters
            </button>{" "}
            or <a href="/studio">be the person you were looking for</a>.
          </p>
        </div>
      ) : (
        <div className={homeStyles.empty}>
          <p className={homeStyles.emptyBig}>¯\_(ツ)_/¯</p>
          <p>
            a room with a sound system and no one in it. <a href="/login?mode=signup">be the first one through the door</a>,
            publish a song, and you land right here.
          </p>
        </div>
      )}
    </>
  );
}
