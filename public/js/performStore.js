/**
 * The perform view's own state, as data: which parameters are pinned to a
 * track's strip, and the scenes. No imports, for historyStore.js's reason:
 * the index ↔ id conversion is a pure function over plain objects, so
 * `node --test` exercises it (test/performStore.test.js).
 *
 * Live state names tracks by id; the file names them by INDEX into the
 * session's track list, as the macro pads do, because createTrack hands out
 * fresh ids on every load. Live state keeps the id because indices shift when
 * a track is removed and a pin must not quietly repoint.
 *
 *   live   { pins: [{trackId, key}],
 *            scenes: [{id, name, pattern, tracks: [{trackId, muted, soloed}],
 *                      knobs: [{trackId, key, unit}]}] }
 *   file   the same with `track` (an index) for `trackId`, and no scene ids
 */

export function emptyPerform() { return { pins: [], scenes: [] }; }

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const unit = (v) => Math.max(0, Math.min(1, num(v, 0)));

/**
 * @param {any} perf live perform state
 * @param {Map<any, number>} idx track id → index in the serialized order
 */
export function serializePerform(perf, idx) {
  const p = perf && typeof perf === "object" ? perf : emptyPerform();
  const pins = (Array.isArray(p.pins) ? p.pins : [])
    .filter(x => x && idx.has(x.trackId) && typeof x.key === "string")
    .map(x => ({ track: idx.get(x.trackId), key: x.key }));
  const scenes = (Array.isArray(p.scenes) ? p.scenes : [])
    .filter(s => s && typeof s === "object")
    .map(s => ({
      name: String(s.name ?? ""),
      pattern: s.pattern == null ? null : num(s.pattern, 0),
      tracks: (Array.isArray(s.tracks) ? s.tracks : [])
        .filter(x => x && idx.has(x.trackId))
        .map(x => ({ track: idx.get(x.trackId), muted: !!x.muted, soloed: !!x.soloed })),
      knobs: (Array.isArray(s.knobs) ? s.knobs : [])
        .filter(x => x && idx.has(x.trackId) && typeof x.key === "string")
        .map(x => ({ track: idx.get(x.trackId), key: x.key, unit: unit(x.unit) })),
    }));
  return { pins, scenes };
}

/**
 * @param {any} data a serialized `perform` block (or nothing)
 * @param {any[]} order the track ids, in the order the file counted them
 * @param {() => number} nextId hands out scene ids
 */
export function readPerform(data, order, nextId) {
  const out = emptyPerform();
  if (!data || typeof data !== "object") return out;
  const idAt = (i) => (Number.isInteger(i) && i >= 0 && i < order.length ? order[i] : undefined);
  for (const x of Array.isArray(data.pins) ? data.pins : []) {
    const id = idAt(x?.track);
    if (id === undefined || typeof x.key !== "string") continue;
    if (out.pins.some(p => p.trackId === id && p.key === x.key)) continue;
    out.pins.push({ trackId: id, key: x.key });
  }
  for (const s of Array.isArray(data.scenes) ? data.scenes : []) {
    if (!s || typeof s !== "object") continue;
    const scene = {
      id: nextId(),
      name: String(s.name ?? "") || `scene ${out.scenes.length + 1}`,
      pattern: s.pattern == null ? null : num(s.pattern, 0),
      tracks: [], knobs: [],
    };
    for (const x of Array.isArray(s.tracks) ? s.tracks : []) {
      const id = idAt(x?.track);
      if (id === undefined) continue;
      scene.tracks.push({ trackId: id, muted: !!x.muted, soloed: !!x.soloed });
    }
    for (const x of Array.isArray(s.knobs) ? s.knobs : []) {
      const id = idAt(x?.track);
      if (id === undefined || typeof x.key !== "string") continue;
      scene.knobs.push({ trackId: id, key: x.key, unit: unit(x.unit) });
    }
    out.scenes.push(scene);
  }
  return out;
}

/** Whether a serialized perform block holds anything worth writing. */
export function performIsEmpty(data) {
  return !data || (!(data.pins?.length) && !(data.scenes?.length));
}
