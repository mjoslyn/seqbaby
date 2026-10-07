"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PatchCard from "../home/PatchCard";
import Pager from "../songs/Pager";
import { paginate } from "../songs/explore";
import { engineLabel } from "../home/patchPreview";
import type { FeedPatch } from "../home/feed";
import homeStyles from "../home/home.module.css";
import styles from "../songs/explore.module.css";

// The patch gallery's search box and list (/patches). Every patch the page
// loaded is here; a search or a page turn is a re-render, not a request. The
// query lives in the URL (`?q=&page=`) so a page of it is a link, and is read
// after mount rather than on the server, for the songs explorer's reason: the
// page is cached for everyone.

type Query = { q: string; page: number };

const EMPTY_QUERY: Query = { q: "", page: 1 };

function parseQuery(search: string): Query {
  const p = new URLSearchParams(search);
  return { q: p.get("q") ?? "", page: Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1) };
}

function queryString(q: Query): string {
  const p = new URLSearchParams();
  if (q.q.trim()) p.set("q", q.q.trim());
  if (q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word of the search is somewhere in the name, the engine or the person. */
function matches(p: FeedPatch, q: string): boolean {
  const want = words(q);
  if (!want.length) return true;
  const hay = [p.name, engineLabel(p.engine), p.engine, p.owner?.handle ?? "", p.owner?.name ?? ""].join(" ").toLowerCase();
  return want.every((w) => hay.includes(w));
}

export default function Gallery({ patches }: { patches: FeedPatch[] }) {
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

  const results = useMemo(() => patches.filter((p) => matches(p, query.q)), [patches, query.q]);
  const { page, pages, start, end } = paginate(results.length, query.page);

  const turn = (to: number) => {
    setQuery((q) => ({ ...q, page: to }));
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.row}>
          <input
            type="search"
            className={styles.search}
            placeholder="search by name, engine or person"
            aria-label="search patches"
            value={query.q}
            onChange={(e) => setQuery({ q: e.target.value, page: 1 })}
          />
        </div>
      </div>

      <p className={styles.summary} aria-live="polite" ref={top} hidden={!patches.length}>
        {results.length === patches.length
          ? `${patches.length} ${patches.length === 1 ? "patch" : "patches"}`
          : `${results.length} of ${patches.length} patches`}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        {query.q ? (
          <button type="button" className={styles.clear} onClick={() => setQuery(EMPTY_QUERY)}>
            clear search
          </button>
        ) : null}
      </p>

      {results.length ? (
        <>
          <ul className={homeStyles.cards}>
            {results.slice(start, end).map((p) => (
              <PatchCard key={p.id} patch={p} />
            ))}
          </ul>
          <Pager page={page} pages={pages} turn={turn} />
        </>
      ) : patches.length ? (
        <div className={homeStyles.empty}>
          <p className={homeStyles.emptyBig}>nothing matches</p>
          <p>try fewer words, or a different spelling.</p>
        </div>
      ) : (
        <p className={homeStyles.emptyLine}>
          no patches yet. <a href="/studio">make a sound</a>, save it as a patch, and publish it from the patches menu.
        </p>
      )}
    </div>
  );
}
