/**
 * A pattern as a picture: one pass of its notes, pitch against time, as an
 * SVG. The arrangement's blocks wear it repeated across each pass, and the
 * clip view's cells wear it squeezed into the cell, both as a CSS mask so the
 * colour stays the stylesheet's.
 *
 * The pitch range is the pattern's own, so a bassline and a hat both fill the
 * box; a range under six semitones is centred in six, so one drum note reads
 * as a line of ticks rather than a wall. Velocity is the opacity. Chord tones
 * are not drawn (the root and the piano roll's extra notes are), which keeps
 * this free of theory.js.
 *
 * No imports, for chanceGen.js's reason: `node --test` runs it.
 */

/**
 * @param {{steps?: any[], notes?: any[], extraNotes?: any[], lengths?: number[], offsets?: number[], velocities?: number[]}|null|undefined} p
 * @param {number} [fallbackNote] the pitch a step with no note plays (C2 on a kit)
 * @param {{fat?: number}} [opts] `fat` thickens each note (rows tall, 0.8 by
 *   default), for a box too small for one row to read: a clip cell
 * @returns {string} the SVG, or "" for a pattern with nothing in it
 */
export function patternSvg(p, fallbackNote = 60, { fat = 0.8 } = {}) {
  const n = p?.steps?.length || 0;
  if (!n) return "";
  const hits = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!p.steps[i]) continue;
    const pitches = [p.notes?.[i] ?? fallbackNote, ...(p.extraNotes?.[i] || [])].filter(Number.isFinite);
    if (!pitches.length) continue;
    for (const m of pitches) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    hits.push({ i, pitches, len: Math.max(1, p.lengths?.[i] || 1), off: Number(p.offsets?.[i]) || 0, vel: p.velocities?.[i] ?? 0.5 });
  }
  if (!hits.length) return "";
  const range = hi - lo + 1;
  const noteH = Math.max(0.8, fat);
  const pad = (noteH - 0.8) / 2;                       // a fat note overhangs its row both ways
  const H = Math.max(range, 6) + 2 * pad;
  const y0 = (H - range) / 2;
  let rects = "";
  for (const h of hits) {
    const x = Math.max(0, h.i + h.off);
    const width = Math.max(0.35, Math.min(h.len, n - x) - 0.2);
    const op = (0.45 + 0.55 * Math.max(0, Math.min(1, h.vel))).toFixed(2);
    for (const m of h.pitches) {
      rects += `<rect x="${x.toFixed(2)}" y="${(y0 + hi - m + 0.1 - pad).toFixed(2)}" width="${width.toFixed(2)}" height="${noteH.toFixed(2)}" fill-opacity="${op}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${H}" preserveAspectRatio="none">${rects}</svg>`;
}

/** An SVG as a CSS `url()` value, safe inside a double-quoted style attribute. */
export function svgUrl(svg) {
  return `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}')`;
}
