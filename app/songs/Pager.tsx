import styles from "./explore.module.css";
import { pageNumbers } from "./explore";

// The explorers' page links (/songs, /people): prev, the first, the last, the
// current page with a neighbour either side, next. Nothing when one page does.

export default function Pager({ page, pages, turn }: { page: number; pages: number; turn: (to: number) => void }) {
  if (pages <= 1) return null;
  return (
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
  );
}
