// What a compose turn did to a song, read off the two sessions: the one that
// was sent and the one that came back. The model's reply says what it meant
// to do in a sentence; this says what moved, track by track, so the changes
// can be judged before they are auditioned or kept.
//
// Pure, no imports, never throws (it is on the path that offers a turn's
// changes, and a hand-edited blob must not cost the offer): `node --test`
// runs it (test/sessionDiff.test.js).

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Key order must not read as a change: the engine and the song builder write
// the same object in different orders.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
const same = (a, b) => a === b || canon(a) === canon(b);

const hasNotes = (p) => !!p && Array.isArray(p.steps) && p.steps.some(Boolean);

// A pattern's notes: everything in it that is not its lanes or its sound.
function notesOf(p) {
  if (!p || typeof p !== "object") return null;
  const out = {};
  for (const k of Object.keys(p)) {
    if (k === "automation" || k === "sound" || k === "soundLocked") continue;
    out[k] = p[k];
  }
  return out;
}

// Only lanes that are on and say something: an empty lane object is nothing.
function lanesOf(p) {
  const a = p && p.automation;
  if (!a || typeof a !== "object") return null;
  const out = {};
  for (const k of Object.keys(a)) if (a[k] && a[k].enabled) out[k] = a[k].values;
  return Object.keys(out).length ? out : null;
}

function enabledLfos(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const out = {};
  for (const k of Object.keys(cfg)) if (cfg[k] && cfg[k].enabled) out[k] = cfg[k];
  return Object.keys(out).length ? out : null;
}

const SOUND_KEYS = ["params", "wavetable", "customConfig", "sampleSource", "granularSample", "glide", "speed"];

/** A short name for an engine key: `dm:silverbox` reads `silverbox`. */
export function engineName(key) {
  const k = String(key ?? "");
  const i = k.indexOf(":");
  if (k.startsWith("plaits")) return "plaits";
  return (i >= 0 ? k.slice(i + 1) : k).replace(/[_-]+/g, " ") || "track";
}

function slotList(slots) {
  return slots.map((s) => s + 1).join(", ");
}

function fxStages(a, b) {
  const out = [];
  const A = a && typeof a === "object" ? a : {};
  const B = b && typeof b === "object" ? b : {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (k === "order") continue;
    if (!same(A[k], B[k])) out.push(k);
  }
  if (!out.length && !same(A.order, B.order)) out.push("order");
  return out;
}

function trackParts(a, b) {
  const parts = [];
  if (a.name !== b.name) parts.push(`renamed from ${a.name || "unnamed"}`);
  if (a.engineKey !== b.engineKey) parts.push(`${engineName(a.engineKey)} → ${engineName(b.engineKey)}`);

  const wrote = [], cleared = [], edited = [], lanes = [], locks = [];
  const n = Math.max(a.patterns?.length ?? 0, b.patterns?.length ?? 0);
  for (let k = 0; k < n; k++) {
    const pa = a.patterns?.[k], pb = b.patterns?.[k];
    const ha = hasNotes(pa), hb = hasNotes(pb);
    if (!ha && hb) wrote.push(k);
    else if (ha && !hb) cleared.push(k);
    else if (ha && hb && !same(notesOf(pa), notesOf(pb))) edited.push(k);
    if (!same(lanesOf(pa), lanesOf(pb))) lanes.push(k);
    if (!!pa?.soundLocked !== !!pb?.soundLocked || (pb?.soundLocked && !same(pa?.sound, pb?.sound))) locks.push(k);
  }
  if (wrote.length) parts.push(`wrote pattern ${slotList(wrote)}`);
  if (edited.length) parts.push(`notes in pattern ${slotList(edited)}`);
  if (cleared.length) parts.push(`cleared pattern ${slotList(cleared)}`);

  if (SOUND_KEYS.some((k) => !same(a[k], b[k]))) parts.push("sound");
  if (!same(a.filter, b.filter)) parts.push("filter");
  if (!same(a.eq, b.eq)) parts.push("eq");
  if (!same({ ...a.comp, source: 0 }, { ...b.comp, source: 0 })) parts.push("compressor");
  if (locks.length) parts.push(`its own sound in pattern ${slotList(locks)}`);
  const fx = fxStages(a.fxConfig, b.fxConfig);
  if (fx.length) parts.push(`fx: ${fx.slice(0, 4).join(", ")}${fx.length > 4 ? "…" : ""}`);
  if (!same(enabledLfos(a.lfoConfig), enabledLfos(b.lfoConfig))) parts.push("modulation");
  if (lanes.length) parts.push(`automation in pattern ${slotList(lanes)}`);
  if (!same(a.euclid, b.euclid) || !same(a.chance, b.chance)) parts.push("generator");
  if ((a.outIndex ?? -1) !== (b.outIndex ?? -1) || (a.compSourceIndex ?? -1) !== (b.compSourceIndex ?? -1)) parts.push("routing");
  if (!!a.muted !== !!b.muted) parts.push(b.muted ? "muted" : "unmuted");
  if (!same(a.arrangement ?? [], b.arrangement ?? [])) parts.push("timeline");
  return parts;
}

const tkey = (t) => `${t?.engineKey ?? ""}\u0000${t?.name ?? ""}`;

/**
 * @returns {{ globals: string[], tracks: { kind: "added"|"removed"|"changed", name: string, engine: string, parts: string[] }[], added: number, removed: number, changed: number, empty: boolean }}
 */
export function diffSessions(before, after) {
  const out = { globals: [], tracks: [], added: 0, removed: 0, changed: 0, empty: true };
  try {
    const A = before && typeof before === "object" ? before : {};
    const B = after && typeof after === "object" ? after : {};
    const ta = Array.isArray(A.tracks) ? A.tracks.filter((t) => t && typeof t === "object") : [];
    const tb = Array.isArray(B.tracks) ? B.tracks.filter((t) => t && typeof t === "object") : [];

    // Which track is which: engine + name, the identity the merge and the
    // compose tools use; what is left over pairs up by position, so a rename
    // or an engine change is an edit to a track and not one going and another
    // arriving.
    const pair = new Array(tb.length).fill(-1);
    const used = new Array(ta.length).fill(false);
    tb.forEach((t, j) => {
      const i = ta.findIndex((x, i) => !used[i] && tkey(x) === tkey(t));
      if (i >= 0) { pair[j] = i; used[i] = true; }
    });
    tb.forEach((t, j) => {
      if (pair[j] < 0 && j < ta.length && !used[j]) { pair[j] = j; used[j] = true; }
    });

    tb.forEach((t, j) => {
      const name = t.name || engineName(t.engineKey);
      if (pair[j] < 0) {
        const slots = (t.patterns ?? []).map((p, k) => (hasNotes(p) ? k : -1)).filter((k) => k >= 0);
        const parts = t.engineKey === "bus" ? ["fx bus"] : slots.length ? [`pattern ${slotList(slots)}`] : ["no notes yet"];
        out.tracks.push({ kind: "added", name, engine: engineName(t.engineKey), parts });
        out.added++;
        return;
      }
      const parts = trackParts(ta[pair[j]], t);
      if (parts.length) {
        out.tracks.push({ kind: "changed", name, engine: engineName(t.engineKey), parts });
        out.changed++;
      }
    });
    ta.forEach((t, i) => {
      if (used[i]) return;
      out.tracks.push({ kind: "removed", name: t.name || engineName(t.engineKey), engine: engineName(t.engineKey), parts: [] });
      out.removed++;
    });

    if (A.bpm !== B.bpm && B.bpm != null) out.globals.push(A.bpm != null && ta.length ? `${A.bpm} → ${B.bpm} bpm` : `${B.bpm} bpm`);
    if ((A.swing ?? 0) !== (B.swing ?? 0) && B.swing != null) out.globals.push(`swing ${B.swing}`);
    if (!same(A.scale, B.scale) && B.scale) {
      out.globals.push(B.scale.active ? `${NOTE[(((B.scale.root ?? 0) % 12) + 12) % 12]} ${B.scale.mode ?? ""}`.trim() : "scale off");
    }
    if ((A.patternMode ?? "repeat") !== (B.patternMode ?? "repeat")) {
      out.globals.push(B.patternMode === "chain" ? "chains its patterns" : B.patternMode === "arrange" ? "plays its arrangement" : "repeats one pattern");
    }
    const sections = (s) => {
      let n = 0;
      for (let k = 0; k < 32; k++) if (s.some((t) => hasNotes(t.patterns?.[k]))) n++;
      return n;
    };
    const sa = sections(ta), sb = sections(tb);
    if (sa !== sb) out.globals.push(sa ? `${sa} → ${sb} patterns` : `${sb} pattern${sb === 1 ? "" : "s"}`);
    else if (!same(A.patternRepeats, B.patternRepeats)) out.globals.push("section lengths");
    if (!same(A.patternMeters, B.patternMeters)) out.globals.push("meter");
    if (!same(A.macroPads ?? [], B.macroPads ?? [])) out.globals.push("macro pads");
  } catch {
    /* an unreadable blob has no summary; the changes are offered all the same */
  }
  out.empty = !out.globals.length && !out.tracks.length;
  return out;
}

/** One line for the diff: `2 tracks added · 3 changed · 128 bpm`. */
export function diffHeadline(d) {
  if (!d || d.empty) return "";
  const bits = [];
  if (d.added) bits.push(`${d.added} track${d.added === 1 ? "" : "s"} added`);
  if (d.changed) bits.push(`${d.changed} changed`);
  if (d.removed) bits.push(`${d.removed} removed`);
  return [...bits, ...d.globals].join(" · ");
}
