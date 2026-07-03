import { engineByKey } from "./catalog.js";
import { STEPS_PER_BAR } from "./constants.js";
import { state } from "./state.js";

export function totalSteps() { return STEPS_PER_BAR; }

// Strong-beat accent positions for a pattern. Each "beat" in an N/D meter is
// 16/D sixteenth-note steps apart (e.g. 4/4 → every 4, 7/8 → every 2, 6/8 → 2).
export function autoAccents(len, meter) {
  const set = new Set();
  const stepsPerBeat = stepsPerBeatForMeter(meter);
  for (let i = 0; i < len; i += stepsPerBeat) set.add(i);
  return set;
}
export function stepsPerBeatForMeter(meter) {
  const den = Number(meter?.den) || 4;
  return Math.max(1, Math.round(16 / den));
}
export function stepsPerBarForMeter(meter) {
  const num = Math.max(1, Math.round(Number(meter?.num) || 4));
  return num * stepsPerBeatForMeter(meter);
}
export function activeMeter() {
  return state.patternMeters[state.activePattern] || { num: 4, den: 4 };
}
export function patternMeter(idx) {
  return state.patternMeters[idx] || { num: 4, den: 4 };
}
export const COMMON_METERS = ["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "5/4", "7/4", "5/8", "7/8"];
export function parseMeter(str) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(str || ""));
  if (!m) return null;
  const num = Math.max(1, Math.min(32, Number(m[1])));
  const den = Math.max(1, Math.min(32, Number(m[2])));
  if (![1, 2, 4, 8, 16, 32].includes(den)) return null;
  return { num, den };
}

// Guess whether a track is playing a drum kit based on engine type + name.
// Used at track creation and re-run on engine/name change via redetectDrumKit.
export function guessIsDrumKit({ engineKey, name }) {
  const eng = engineByKey(engineKey);
  if (eng?.type === "sample") return true;
  const blob = `${engineKey || ""} ${eng?.label || ""} ${name || ""}`.toLowerCase();
  return /\b(kick|snare|hat|hi-?hat|clap|tom|perc|drum)\b/.test(blob);
}

// Recompute t.isDrumKit from current engineKey + name. Existing step notes are
// left untouched — only future blank steps + sample pitch baseline follow the
// new flag. Call this whenever engine or track name changes.
export function redetectDrumKit(t) {
  t.isDrumKit = guessIsDrumKit({ engineKey: t.engineKey, name: t.name });
}

