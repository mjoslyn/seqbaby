import { ENGINE_MODULES, TONE_SRC, WOSC_SRC } from "./engineAssets";

// The preloader: what the visitor looks at while the engine arrives.
//
// The studio's DOM is server-rendered (studioMarkup.ts), so the browser paints
// a complete-looking sequencer within a few hundred milliseconds — empty engine
// dropdowns, no tracks, dead buttons — and then keeps it that way until Tone
// (~1MB from a CDN), woscillators (the Plaits WASM port) and 44 engine modules
// have all landed and main.js's init() has built the starter kit. On a cold
// cache that gap is seconds long, and every one of them looks like a bug.
//
// So this covers it, and reports honest progress while it does. Three rules
// shaped the implementation:
//
//  1. It has to paint on the FIRST frame, or it is covering nothing. That rules
//     out a React component: the engine's deferred scripts run before React
//     hydrates, so a hydrated overlay would appear after the wait it exists to
//     hide. It's raw markup plus an inline script, served in the document.
//  2. It has to be impossible to get stuck behind. The overlay ships
//     `display: none` and the inline script reveals it, so a browser that never
//     runs the script shows the bare skeleton (today's behaviour) rather than a
//     permanent black screen. On top of that: an escape hatch at 8s, a hard
//     dismissal at 30s, and an error state wired to the scripts' onerror.
//  3. The progress has to be real. PerformanceObserver counts the engine's own
//     resources as they finish — that's ~50 discrete events, enough for a bar
//     that moves continuously — and the boot milestones (tone loaded,
//     woscillators loaded, init() entered, init() returned) raise a floor under
//     it. Whichever is further along wins, so if resource timings never show up
//     (a memory-cache hit reports nothing in some browsers), the milestones
//     alone still drive it.
//
// The driver is a source STRING rather than a module because both boot paths
// need it: the server-rendered path inlines it (no round trip, runs at parse),
// and ScriptLoader's soft-navigation fallback injects the same text as a
// <script> element. One implementation, two insertion points.

const STEP_CELLS = 16;

// What the wait is spent on. Loading is the one moment a visitor is looking at
// the app with nothing to do, so it's the one moment they'll read something —
// and seqbaby's best features (p-lock, the euclid ring, the right-click
// parameter menu) are the ones you'd never find by clicking around.
//
// Each tip is scoped, because half of them are lies on the wrong device: a
// phone has no right-click and no computer keyboard, and a desktop has no
// long-press. "any" tips show everywhere; the driver picks the rest from the
// same coarse-pointer/narrow-viewport test knob.js uses for its hit targets.
//
// The audio gate (main.js) rotates its own shorter HELP_TIPS on touch devices
// after this overlay clears. Kept separate deliberately — that list is about
// getting started, this one has a longer read and a wider brief — but they're
// worth glancing at together when either is edited.
const TIPS: Array<[scope: "any" | "touch" | "desktop", text: string]> = [
  ["any", "each track keeps its own sound per pattern — hit p-lock to pin it"],
  ["any", "the ring button beside the dice builds euclidean rhythms"],
  ["any", "drag the dice up or down to set how full it rolls"],
  ["any", "32 pattern slots per session — loop one or chain them"],
  ["any", "add an fx bus and route several tracks through one reverb"],
  ["any", "macro pads drive parameters across tracks from one xy pad"],
  ["any", "swap engines mid-session from the track header dropdown"],
  ["any", "share a session: hit share to copy a link"],
  ["desktop", "right-click any knob for what it does, plus its lfo and automation"],
  ["desktop", "play the computer keyboard: a-l are white keys, w-o black, z/x octave"],
  ["desktop", "drag a knob and move sideways for finer resolution"],
  ["touch", "long-press a step to open the note editor"],
  ["touch", "long-press a knob for its lfo, automation and macro assignment"],
  ["touch", "drag a step up or down to change its pitch"],
];

/** Pathname of an asset URL, which is what resource-timing entries carry. */
function pathOf(url: string): string {
  try {
    return new URL(url, "https://seqbaby.invalid").pathname;
  } catch {
    return url;
  }
}

// Weighted by transfer size, not file count: the 44 modules are ~1MB between
// them (so ~1 unit each at ~23KB a unit), Tone.js is 346KB and woscillators.js
// is 379KB. Counting files instead put 44 of the 46 units on the modules, which
// finish first — the bar hit 70% in two seconds and then sat there for eight
// while the two big files came down. These need only be roughly right; they
// decide how the wait is *distributed*, and a stalled bar is the failure mode.
const WEIGHTS: Record<string, number> = { [pathOf(TONE_SRC)]: 15, [pathOf(WOSC_SRC)]: 17 };
for (const m of ENGINE_MODULES) WEIGHTS[pathOf(m)] = 1;
const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

const CELLS = Array.from({ length: STEP_CELLS }, () => '<i class="sq-preload__step"></i>').join("");

/**
 * The overlay itself. Hidden until the driver reveals it (see rule 2 above),
 * and deliberately built from the same parts as the app it's covering: the
 * wordmark, and a 16-step row that fills as the engine loads.
 */
export const PRELOADER_HTML = `
<div id="sq-preload" class="sq-preload" style="display:none" role="progressbar" aria-label="loading seqbaby"
     aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
  <div class="sq-preload__box">
    <div class="sq-preload__logo"><img src="/favicon.svg" alt="" width="24" height="24" /><span>seqbaby</span></div>
    <div class="sq-preload__steps" aria-hidden="true">${CELLS}</div>
    <div class="sq-preload__foot">
      <span class="sq-preload__phase">loading engine</span>
      <span class="sq-preload__pct">0%</span>
    </div>
    <p class="sq-preload__tip"></p>
    <div class="sq-preload__slow" hidden>
      <span class="sq-preload__slow-msg"></span>
      <button class="sq-preload__slow-btn" type="button">continue anyway</button>
    </div>
  </div>
</div>`;

// The driver. Written as ES5-ish, unminified source with no template literals of
// its own (it lives inside one) and no `</` sequences (it's inlined in a
// <script>). Exposes window.__sqPreload = {step, fail, done} for the boot to
// call — every call site guards it, so the engine never depends on it existing.
export const PRELOADER_SCRIPT = `(function () {
  var root = document.getElementById("sq-preload");
  if (!root || window.__sqPreload) return;

  var WEIGHTS = ${JSON.stringify(WEIGHTS)};
  var TIPS = ${JSON.stringify(TIPS)};
  var TOTAL = ${TOTAL};
  // Milestone -> [label, the progress it guarantees]. The number is a floor,
  // not a value: resource counting usually reads higher, and whichever is
  // further along wins. Only the last milestone renames the phase — everything
  // before it is downloading, in parallel, and a label that named the file that
  // just FINISHED ("loading tone.js" once tone.js was in) read as a stall.
  var PHASES = {
    tone: ["", 0.36],
    wosc: ["", 0.62],
    engine: ["starting engine", 0.92]
  };

  var cells = root.querySelectorAll(".sq-preload__step");
  var tipEl = root.querySelector(".sq-preload__tip");
  var phaseEl = root.querySelector(".sq-preload__phase");
  var pctEl = root.querySelector(".sq-preload__pct");
  var slowEl = root.querySelector(".sq-preload__slow");
  var slowMsg = root.querySelector(".sq-preload__slow-msg");
  var slowBtn = root.querySelector(".sq-preload__slow-btn");

  var now = function () {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  };
  var t0 = now();
  var seen = {}, weighed = 0, files = 0, total = Object.keys(WEIGHTS).length;
  var floor = 0.02, real = 0.02, crept = 0.02, target = 0.02, shown = 0;
  var phaseName = "";
  var ending = false, gone = false, errored = false, raf = 0, painted = -1;
  var watchdog = 0, lastAdvance = 0, reloadOnClick = false;
  var tips = [], tipAt = 0, tipTimer = 0;

  // The markup ships style="display:none" so it stays invisible even before the
  // stylesheet lands. Clearing it here hands the display back to the .is-on
  // rule — an inline style would otherwise outrank it and hide the overlay for
  // the whole load.
  root.className = "sq-preload is-on";
  root.style.display = "";
  document.documentElement.classList.add("sq-preloading");

  tips = pickTips();
  // Random entry point: the first tip is the one most likely to be read, and a
  // fixed one would be the only tip a returning visitor ever sees.
  tipAt = Math.floor(Math.random() * tips.length);
  showTip();
  tipTimer = setInterval(rotateTip, 4200);

  function pathOf(u) {
    try { return new URL(u, location.href).pathname; } catch (e) { return u; }
  }

  // Tips for THIS device: a long-press hint on a desktop and a right-click hint
  // on a phone are both instructions the reader cannot follow.
  function pickTips() {
    var coarse = false;
    try {
      coarse = window.matchMedia("(any-pointer: coarse), (max-width: 768px)").matches;
    } catch (e) {}
    var want = coarse ? "touch" : "desktop";
    var out = [];
    for (var i = 0; i < TIPS.length; i++) {
      if (TIPS[i][0] === "any" || TIPS[i][0] === want) out.push(TIPS[i][1]);
    }
    return out;
  }

  function showTip() {
    if (!tipEl || !tips.length) return;
    tipEl.textContent = tips[tipAt % tips.length];
    tipAt++;
  }

  function rotateTip() {
    if (!tipEl || gone) return;
    // Fade out, swap, fade back — the swap has to happen while it's invisible or
    // the line changes length mid-fade and reads as a jump.
    tipEl.classList.add("is-fading");
    setTimeout(function () {
      if (gone) return;
      showTip();
      tipEl.classList.remove("is-fading");
    }, 200);
  }

  // One finished engine resource. Idempotent: a preload and the request that
  // matches it can both surface, and double-counting would run the bar ahead.
  function count(url) {
    if (errored) return;
    var p = pathOf(url);
    var w = WEIGHTS[p];
    if (!w || seen[p]) return;
    seen[p] = 1;
    weighed += w;
    files++;
    label();
    retarget();
  }

  function retarget() {
    if (errored) return;
    var next = Math.max(floor, TOTAL ? (weighed / TOTAL) * 0.88 : 0);
    if (!ending && next > 0.99) next = 0.99;
    if (next > real) {
      real = next;
      lastAdvance = now();
    }
    // Real news resets the creep to where reality is, so the trickle always
    // resumes from the measurement rather than trailing behind it.
    if (crept < real) crept = real;
    if (real > target) target = real;
  }

  // Every measurable event is discrete, and the biggest files land last, so
  // there are seconds at a time with genuinely nothing to report. Rather than
  // freeze, creep toward — but never more than a little past — what has
  // actually been measured, at a rate that decays as the gap closes.
  function trickle() {
    if (ending || errored) return;
    var cap = Math.min(0.95, real + 0.12);
    if (crept < cap) crept += (cap - crept) * 0.006;
    if (crept > target) target = crept;
  }

  // The file counter is the honest thing to show while everything downloads in
  // parallel. Silent until something has actually been counted: resource
  // timings are missing for memory-cache hits in some browsers, and "0/46"
  // under a moving bar would be a lie about a load that is going fine.
  function label() {
    if (!phaseEl || ending || errored || phaseName) return;
    phaseEl.textContent = files ? "loading engine · " + files + "/" + total : "loading engine";
  }

  var po = null;
  try {
    po = new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) count(es[i].name);
    });
  } catch (e) {}
  if (po) {
    // buffered:true replays whatever finished before this observer existed —
    // with modulepreload the fastest modules land during HTML parsing.
    try {
      po.observe({ type: "resource", buffered: true });
    } catch (e) {
      // Older engines take only the entryTypes form, and don't replay. Sweep
      // what has already landed by hand, then keep observing from here.
      try {
        var pre = performance.getEntriesByType("resource");
        for (var j = 0; j < pre.length; j++) count(pre[j].name);
        po.observe({ entryTypes: ["resource"] });
      } catch (e2) {}
    }
  }

  function paint() {
    var pct = Math.round(shown * 100);
    if (pct === painted) return;
    painted = pct;
    if (pctEl) pctEl.textContent = pct + "%";
    root.setAttribute("aria-valuenow", String(pct));
    var head = Math.floor(shown * cells.length);
    for (var i = 0; i < cells.length; i++) {
      var cls = "sq-preload__step";
      if (i < head) cls += " is-on";
      else if (i === head && !gone) cls += " is-head";
      if (cells[i].className !== cls) cells[i].className = cls;
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    trickle();
    // Ease toward the target rather than jumping to it: the underlying events
    // are discrete (a module lands, a milestone passes) and stepping the bar
    // reads as stalling between them. The run home is much faster: the engine
    // is READY at that point, and easing the last quarter of the bar at
    // browsing speed spent a further second of a booted app on an animation.
    shown += (target - shown) * (ending ? 0.4 : 0.14);
    if (target - shown < 0.003) shown = target;
    paint();
    if (ending && shown > 0.999) finish();
  }
  raf = requestAnimationFrame(frame);

  function remove() {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    clearInterval(watchdog);
    clearInterval(tipTimer);
    document.documentElement.classList.remove("sq-preloading");
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function finish() {
    cancelAnimationFrame(raf);
    root.classList.add("is-out");
    setTimeout(remove, 320);
  }

  function step(name) {
    var p = PHASES[name];
    if (!p || gone || ending || errored) return;
    if (p[0]) {
      phaseName = p[0];
      if (phaseEl) phaseEl.textContent = p[0];
    }
    if (p[1] > floor) floor = p[1];
    retarget();
  }

  function fail(what) {
    if (gone || ending || errored) return;
    // Freeze where it is: everything downstream (count, the milestones, the
    // trickle) checks this, so the bar stops rather than strolling on to 94%
    // under a message saying the engine is not coming.
    errored = true;
    root.classList.add("is-error");
    clearInterval(tipTimer);
    if (tipEl) tipEl.textContent = "";
    phaseName = "error";
    if (phaseEl) phaseEl.textContent = "couldn't load " + what;
    // A reload is the useful offer here, not "continue anyway": with a boot
    // script missing there is no sequencer under the overlay to continue into.
    reloadOnClick = true;
    if (slowBtn) slowBtn.textContent = "reload";
    showSlow("the engine didn't load. this is usually the network.");
  }

  function done() {
    if (gone || ending) return;
    // Outranks the error state — an engine that finished booting is the ground
    // truth, whatever a failed subresource claimed on the way.
    errored = false;
    root.classList.remove("is-error");
    // Nothing was really on screen yet on a warm cache — dismiss without the
    // fade, so a hot reload doesn't cost half a second of ceremony.
    if (now() - t0 < 250) { remove(); return; }
    ending = true;
    floor = 1;
    target = 1;
    if (phaseEl) phaseEl.textContent = "ready";
    clearInterval(watchdog);
    clearInterval(tipTimer);
    if (slowEl) slowEl.hidden = true;
  }

  function showSlow(msg) {
    if (!slowEl || gone) return;
    if (slowMsg) slowMsg.textContent = msg;
    slowEl.hidden = false;
  }

  if (slowBtn) {
    slowBtn.addEventListener("click", function () {
      if (reloadOnClick) location.reload();
      else remove();
    });
  }

  // The escape hatch, and the last-resort dismissal, both key off progress
  // having STOPPED rather than off the wall clock. A 1.7MB engine over a phone
  // connection legitimately takes half a minute, and neither nagging that
  // visitor nor — far worse — tearing the overlay off a boot that is still
  // running would be an improvement on waiting. Something silently broken (an
  // exception before init() returns, a request that will never answer) shows up
  // as a bar that has stopped moving, and that is what these watch for.
  lastAdvance = t0;
  watchdog = setInterval(function () {
    if (gone || ending) return;
    var idle = now() - lastAdvance;
    if (idle > 6000) showSlow("still loading. slow connection, or the engine is stuck.");
    if (idle > 25000) remove();
  }, 1000);

  window.__sqPreload = { step: step, fail: fail, done: done };
})();`;
