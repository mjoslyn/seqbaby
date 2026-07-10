import { state } from "./state.js";

export const ICON_REPEAT = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a4 4 0 0 1 4-4h4"/><polyline points="10 4 12 6 10 8"/><path d="M12 6a4 4 0 0 1-4 4H4"/><polyline points="6 12 4 10 6 8"/></svg>`;
export const ICON_CHAIN  = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h10"/><polyline points="9 4 13 8 9 12"/></svg>`;
export const ICON_NOW    = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 1.5 3.5 9h3.5l-1 5.5L13.5 7H10l1-5.5z"/></svg>`;
export const ICON_FINISH = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="8" height="2" rx="0.5"/><rect x="4" y="12" width="8" height="2" rx="0.5"/><path d="M5 4c0 2.5 3 3.2 3 4s-3 1.5-3 4"/><path d="M11 4c0 2.5-3 3.2-3 4s3 1.5 3 4"/></svg>`;
export const ICON_SAVE     = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 2v4h6V2"/><rect x="5" y="9" width="6" height="5"/></svg>`;
export const ICON_LOAD     = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z"/></svg>`;
export const ICON_WAV      = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="3" y2="10"/><line x1="5.5" y1="3.5" x2="5.5" y2="12.5"/><line x1="8" y1="5.5" x2="8" y2="10.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="13.5"/><line x1="13" y1="6.5" x2="13" y2="9.5"/></svg>`;
export const ICON_REC      = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="5" /></svg>`;
export const ICON_CAPTURE  = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85"/><polyline points="12.9 2 12.9 4.9 10 4.9"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>`;
// Classic metronome — trapezoidal body + pendulum swung slightly right.
export const ICON_METRONOME = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 14h6l-1-11H6z"/><line x1="10.6" y1="3.2" x2="5.4" y2="13.5"/><circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none"/></svg>`;
// Question mark in a circle — opens the help/tips dialog.
export const ICON_HELP = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/><path d="M6.1 6.2c0-1.1 0.9-2 1.9-2s1.9 0.9 1.9 2c0 1.2-1.9 1.5-1.9 2.8"/><circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none"/></svg>`;

export const HELP_TIPS = [
  "long-press a step to open the note editor",
  "long-press a sample step to open the sample editor",
  "drag a step up or down to change pitch",
  "tap filter / env / fx / eq / comp / mod on a track to open that panel",
  "32 pattern slots per session — chain them or loop one",
  "swap engines mid-session from the track header dropdown",
  "save patches and reload them from any track",
  "share a session: tap share to copy a link",
];
// Painter's palette with four colored dots — paints when "on", greys when "off"
// (CSS handles the desaturation via aria-pressed).
export const ICON_PALETTE = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5c-3.6 0-6.5 2.7-6.5 6S4.4 13.5 8 13.5c.9 0 1.5-.5 1.5-1.2 0-.5-.3-.9-.3-1.4 0-.7.6-1.2 1.3-1.2h1c2 0 3.5-1.4 3.5-3.3 0-2.7-3-4.9-7-4.9z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="5.2" r="1.05" fill="hsl(0 72% 56%)"/><circle cx="9.5" cy="3.8" r="1.05" fill="hsl(60 72% 56%)"/><circle cx="11.9" cy="6.6" r="1.05" fill="hsl(180 72% 56%)"/><circle cx="4.6" cy="9.2" r="1.05" fill="hsl(270 72% 56%)"/></svg>`;
// Download — arrow into a tray.
export const ICON_DOWNLOAD = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8"/><polyline points="5 7 8 10 11 7"/><path d="M2.5 13h11"/></svg>`;
// bounce = render to audio; a compact waveform reads as "audio output"
export const ICON_BOUNCE = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M1.5 8h1.6M4.6 5.4v5.2M7 3v10M9.4 5.4v5.2M11.8 6.6v2.8M14.4 8h.1"/></svg>`;
export const ICON_DICE = `<svg class="sq-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="5.5" cy="5.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="10.5" cy="5.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="8"   cy="8"   r="0.9" fill="currentColor" stroke="none"/><circle cx="5.5" cy="10.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="10.5" cy="10.5" r="0.9" fill="currentColor" stroke="none"/></svg>`;

// ---- state --------------------------------------------------------------

