"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import {
  PALETTE,
  SIZE,
  SHAPE_NAMES,
  decodeGrid,
  defaultGrid,
  encodeGrid,
  fillGrid,
  generateGrid,
  invertGrid,
  mirrorGrid,
  shapeGrid,
  shiftGrid,
  type Grid,
} from "@/app/profile/avatarGrid";
import { playAvatar } from "@/app/profile/avatarPlayer";
import styles from "./avatarEditor.module.css";

// The avatar editor: a 16x16 step grid you paint like the studio's, in the
// studio's own colours. Three tools: draw (press and drag; starting on a cell
// already in the chosen colour clears instead, the way a step toggles), fill
// (paint bucket) and erase. Plus a generator, the precanned shapes and a few
// sequencer moves. Since it IS a pattern it also plays: rows are notes of a
// pentatonic scale, top highest, the playhead walks the columns, and each
// colour has its own waveform (app/profile/avatarPlayer.ts).
//
// `value` null means "the one my name gives me" -- saved as null, so that
// default follows a rename rather than freezing the old name's grid.

type Tool = "draw" | "fill" | "erase";

export default function AvatarEditor({
  value,
  name,
  onChange,
}: {
  value: string | null;
  name: string;
  onChange: (next: string | null) => void;
}) {
  const grid: Grid = decodeGrid(value) ?? defaultGrid(name);
  const [color, setColor] = useState(1);
  const [tool, setTool] = useState<Tool>("draw");
  const stroke = useRef<number | null>(null); // the value a drag is painting
  const [step, setStep] = useState(-1);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const set = (g: Grid) => onChange(encodeGrid(g));
  const paintCell = (i: number, v: number) => {
    const g = gridRef.current;
    if (g.cells[i] === v) return;
    const cells = g.cells.slice();
    cells[i] = v;
    gridRef.current = { cells };
    set({ cells });
  };

  useEffect(() => {
    const up = () => (stroke.current = null);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const play = () => {
    if (step >= 0) return stopRef.current?.();
    stopRef.current = playAvatar(() => gridRef.current, setStep);
  };

  const down = (i: number) => {
    if (tool === "fill") return set(fillGrid(grid, i, color));
    const v = tool === "erase" || grid.cells[i] === color ? 0 : color;
    stroke.current = v;
    paintCell(i, v);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.main}>
        <div
          className={styles.grid}
          onPointerLeave={() => (stroke.current = null)}
          role="grid"
          aria-label="avatar steps"
        >
          {grid.cells.map((v, i) => (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-label={`row ${Math.floor(i / SIZE) + 1} step ${(i % SIZE) + 1}${v ? `, ${PALETTE[v]?.name}` : ""}`}
              className={[
                styles.cell,
                i % SIZE === step ? styles.now : "",
                (i % SIZE) % 4 === 0 ? styles.beat : "",
              ].join(" ")}
              style={v ? { background: PALETTE[v]?.hex } : undefined}
              onPointerDown={(e) => {
                e.preventDefault();
                // Touch captures the pointer to the first cell; release it so
                // the cells under the finger get their own pointerenter.
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                down(i);
              }}
              onPointerEnter={() => {
                if (stroke.current !== null) paintCell(i, stroke.current);
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  down(i);
                  stroke.current = null;
                }
              }}
            />
          ))}
        </div>

        <div className={styles.side}>
          <div className={styles.palette} role="radiogroup" aria-label="colour">
            {PALETTE.map((p, i) =>
              p ? (
                <button
                  key={p.hex}
                  type="button"
                  role="radio"
                  aria-checked={color === i}
                  className={`${styles.swatch} ${color === i ? styles.swatchOn : ""}`}
                  style={{ background: p.hex }}
                  onClick={() => {
                    setColor(i);
                    if (tool === "erase") setTool("draw");
                  }}
                  title={p.name}
                  aria-label={p.name}
                />
              ) : null,
            )}
          </div>
          <div className={styles.row} role="radiogroup" aria-label="tool">
            {(["draw", "fill", "erase"] as Tool[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tool === t}
                className={`${styles.tool} ${tool === t ? styles.toolOn : ""}`}
                onClick={() => setTool(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <button type="button" className={`${styles.tool} ${step >= 0 ? styles.toolOn : ""}`} onClick={play}>
              {step >= 0 ? "■ stop" : "▶ play it"}
            </button>
            <button
              type="button"
              className={styles.tool}
              onClick={() => set(generateGrid(Math.random(), { color }))}
              title="a random creature in the chosen colour"
            >
              ⚄ generate
            </button>
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.tool} onClick={() => set(shiftGrid(grid, -1))} title="shift left">
              ◀
            </button>
            <button type="button" className={styles.tool} onClick={() => set(shiftGrid(grid, 1))} title="shift right">
              ▶
            </button>
            <button type="button" className={styles.tool} onClick={() => set(mirrorGrid(grid))} title="copy the left half onto the right">
              mirror
            </button>
            <button type="button" className={styles.tool} onClick={() => set(invertGrid(grid, color))}>
              invert
            </button>
            <button type="button" className={styles.tool} onClick={() => set({ cells: new Array(SIZE * SIZE).fill(0) })}>
              clear
            </button>
          </div>
          <button
            type="button"
            className={styles.link}
            onClick={() => onChange(null)}
            disabled={value === null}
            title="the grid your name generates, which changes if your name does"
          >
            {value === null ? "using the one your name makes" : "back to the one your name makes"}
          </button>
        </div>
      </div>

      <div className={styles.shapes} aria-label="shapes">
        {SHAPE_NAMES.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.shape}
            onClick={() => set(shapeGrid(s, color))}
            title={s}
          >
            <Avatar grid={encodeGrid(shapeGrid(s, color))} name={s} size={40} />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
