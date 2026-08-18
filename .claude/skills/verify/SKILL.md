---
name: verify
description: How to launch and drive seqbaby to verify engine changes at runtime.
---

# Verifying seqbaby engine changes

## Launch

```
npm run dev        # Next.js on :3000; engine works with no env vars
```

Open `http://localhost:3000/` in Chrome (claude-in-chrome tools work well).

## Drive

- A real click on **play** provides the user gesture that unlocks audio and
  builds voices/racks (`ensureAudio`). Synthetic `element.click()` does NOT
  count for step cells — the step grid listens on pointer events, so use the
  computer tool with real coordinates (`.sq-step` cells, get coords via
  `getBoundingClientRect` after `scrollIntoView`).
- The starter session has 6 tracks (kick/snare/hat/accent/bass/lead); all
  patterns start EMPTY — toggle steps before expecting sound.
- `window.seqbaby.state` exposes everything: `tracks[i].fxRack`, `.voice`,
  `.meterAnalyser` (taps fxRack.output), `state.masterAnalyser`.
- Measure audio without ears: `getFloatTimeDomainData` RMS on an analyser,
  sampled in a loop. Silence floor is ~0.0002 (keep-alive source); a kick hit
  peaks ~0.2.
- Every range input is wrapped in a `.sq-knob` by `knob.js` and driven by a
  relative pointer drag, so a synthetic pointer drag on the knob DOES work
  (~140px of vertical travel covers the full range). Setting the native value
  + `dispatchEvent(new Event("input", {bubbles:true}))` also still works and is
  quicker for setting an exact value. Note the input is `opacity:0` and sized
  to the knob, so drag at the `.sq-knob` wrapper's centre.
- Scope control lookups to the track (`t.el.querySelector(...)`), not the
  document: panels get reparented into modals, so `.sq-track .p-cutoff` can
  land on a different track once a panel is open. Controls inside a closed
  panel have a zero rect and can't be dragged until it's open.
- FX panel per track: the "fx" button on the track row opens it.

## Gotchas

- Anything you play is AUDIBLE on the user's machine — warn them before
  probing with rapid parameter changes (instant wet.value steps click).
- resize_window may silently fail (fullscreen); check `window.innerWidth`.
- `isMobileDevice()` (dom.js) gates mobile-only paths — can't be faked after
  page load; on-device checks need a phone or DevTools device emulation.
