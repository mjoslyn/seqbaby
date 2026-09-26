// The code drawer: Strudel live coding onto the running studio.
//
// A Strudel-like editor docked at the bottom of the studio. ctrl/⌘-Enter reads
// the code (strudel.js), writes the tracks it describes into the session and
// merges that onto the running engine (liveSet.js's mergeSet), so the
// transport never stops and every track the code does not touch keeps
// playing -- which is what re-evaluating means in Strudel. ctrl/⌘-. stops.
//
// It opens on the song itself, written as code (strudel.js's sessionToCode in
// its native form: seqbaby's instruments by name, and every knob, effect, LFO
// and lane that has moved), so running it unchanged changes nothing and
// editing it edits the song. The tracks are ordinary tracks afterwards: the
// grid shows them, a knob moves them, a save keeps them. The code is not a
// second copy of the song: reopened onto a song that has changed, it is
// written again from the song.
//
// While it plays, the tokens that made the sounding steps light up, as they do
// in strudel.cc: each step remembers the source offsets of the mini-notation
// atoms that wrote it (realize, in strudel.js), and the track's playhead
// (`t._nowIdx`, written by paintTrackNow) picks which.

import { state } from "./state.js";
import { serializeSet } from "./session.js";
import { mergeSet } from "./liveSet.js";
import { markExternalEdit } from "./history.js";
import { stopPlayback } from "./transport.js";
import { setStatus } from "./dom.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const EXAMPLES = {
  "four on the floor": `// ctrl+enter runs, ctrl+. stops
setcpm(124/4)

$: s("bd*4, ~ cp, [~ hh]*4, ~ ~ ~ oh").bank("RolandTR909")

bass: note("<c2 c2 eb2 g1>*8").s("sawtooth")
  .lpf(sine.range(300, 2400).slow(4)).lpq(6)

keys: chord("<Cm7 Ab^7 Fm7 G7>").voicing().s("gm_epiano1").room(0.5)
`,
  "acid": `setcpm(132/4)

$: s("bd*4, [~ sd]*2, hh*16").gain("1 0.7")

acid: note("c2 [c2 c3] eb2 [~ c2] g1 [c2 bb1] c3 c2")
  .s("tb303").lpf("<600 900 1400 2200>").lpq(14).delay(0.25)
`,
  "euclid": `setcpm(110/4)

$: s("bd(3,8), sd(2,8,4), hh(7,16)")
lead: n("<0 2 4 [6 7]>*4").scale("D4:dorian").s("supersaw").room(0.3)
`,
};

let _open = null;      // the drawer's handle while it exists
let _lastNames = [];   // the tracks the code holds: a line deleted from it removes its track
let _touched = {};     // what the last run set, per track: a setting deleted from the code goes back to its default
let _draft = null;     // { code, song }: the editor as it was closed, reopened only onto the same song
let _run = null;       // { code, locsByName: Map<name, number[][][]> } for the highlighter
let _raf = 0;

export function installCodePanel() {
  const btn = document.getElementById("code-btn");
  if (!btn) return;
  btn.addEventListener("click", () => toggleCodePanel());
  // A different song arriving is not the one the code wrote: forget which
  // tracks were the code's, so the next run cannot remove tracks of that song.
  const forget = () => { _lastNames = []; _touched = {}; _run = null; _draft = null; paint(); };
  window.addEventListener("seqbaby:setapplied", forget);
  window.addEventListener("seqbaby:newset", forget);
}

export function toggleCodePanel(force) {
  const want = force ?? !_open;
  if (!want) { _open?.close(); return; }
  if (_open) return;
  openPanel();
}

function openPanel() {
  const btn = document.getElementById("code-btn");
  const el = document.createElement("section");
  el.className = "sq-code";
  el.setAttribute("aria-label", "code");
  el.innerHTML = `
    <div class="sq-code__bar">
      <span class="sq-code__title">code</span>
      <button type="button" class="sq-code__run" title="run the code into the song (ctrl/⌘ enter)">▶ run</button>
      <button type="button" class="sq-code__stop sq-btn--ghost" title="stop (ctrl/⌘ .)">■ stop</button>
      <select class="sq-code__examples" title="start from an example">
        <option value="">examples…</option>
        ${Object.keys(EXAMPLES).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}
      </select>
      <button type="button" class="sq-code__from sq-btn--ghost" title="write the song as it is now into the editor, as code">from song</button>
      <button type="button" class="sq-code__copy sq-btn--ghost" title="copy the code">copy</button>
      <a class="sq-code__out sq-btn--ghost" target="_blank" rel="noopener" title="open this code in strudel.cc">strudel.cc ↗</a>
      <span class="sq-code__spacer"></span>
      <button type="button" class="sq-code__close sq-btn--ghost" title="close the drawer (the tracks stay)">×</button>
    </div>
    <div class="sq-code__editor">
      <pre class="sq-code__hl" aria-hidden="true"></pre>
      <textarea class="sq-code__input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"
        aria-label="Strudel code"></textarea>
    </div>
    <div class="sq-code__msg" role="status" aria-live="polite"></div>`;
  document.body.appendChild(el);
  document.body.classList.add("has-code-drawer");
  btn?.setAttribute("aria-pressed", "true");

  const q = (s) => el.querySelector(s);
  const input = q(".sq-code__input");
  const hl = q(".sq-code__hl");
  const msg = q(".sq-code__msg");
  const outLink = q(".sq-code__out");

  const say = (text, kind = "") => {
    msg.className = `sq-code__msg${kind ? ` is-${kind}` : ""}`;
    msg.innerHTML = text;
  };
  let strudelMod = null;
  const mod = async () => (strudelMod ||= await import("./strudel.js"));
  const refreshLink = async () => {
    const m = await mod();
    outLink.href = m.strudelUrl(input.value);
  };
  // strudel.cc knows none of seqbaby's own names (s("silverbox"), .knob, .fx ...),
  // so code using them opens there as its portable version: the same notes, stock
  // sounds, and only the effects Strudel has.
  const portableHref = () => {
    const m = strudelMod;
    if (!m) return;
    try {
      const read = m.readCode(input.value);
      if (!m.realize(read).native) return;
      const { code, warnings } = m.sessionToCode(m.codeToSong(input.value).song);
      outLink.href = m.strudelUrl(code);
      say(`<span>opened a portable version in strudel.cc: seqbaby's instruments as their nearest stock sounds</span>${warnings.length ? `<ul>${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`, "warn");
    } catch { /* unreadable code opens as written */ }
  };

  const run = async () => {
    let m, sb;
    try { [m, sb] = await Promise.all([mod(), import("./songBuilder.js")]); }
    catch (e) { say(`could not load the code reader: ${esc(e.message)}`, "error"); return; }
    const code = input.value;
    let read, realized, song, res;
    try {
      read = m.readCode(code);
      realized = m.realize(read);
      song = sb.fromBlob(serializeSet());
      res = m.writeTracks(song, realized, { previous: _lastNames, touched: _touched });
    } catch (e) {
      const at = Number.isFinite(e.pos) ? ` (line ${code.slice(0, e.pos).split("\n").length})` : "";
      say(`${esc(e.message)}${at}`, "error");
      if (Number.isFinite(e.pos)) { input.focus(); input.setSelectionRange(e.pos, e.pos + 1); }
      return;
    }
    try { mergeSet(song); }
    catch (e) { say(`the song would not take it: ${esc(e.message)}`, "error"); return; }
    markExternalEdit("run code");
    _lastNames = res.names;
    _touched = res.touched;
    _run = { code, locsByName: new Map(realized.tracks.filter(t => !t.empty).map(t => [t.name, t.stepLocs])) };
    const parts = [];
    if (res.made.length) parts.push(`added ${res.made.map(esc).join(", ")}`);
    if (res.changed.length) parts.push(`updated ${res.changed.map(esc).join(", ")}`);
    if (res.removed.length) parts.push(`removed ${res.removed.map(esc).join(", ")}`);
    if (res.bpm != null) parts.push(`${Math.round(res.bpm * 100) / 100} bpm`);
    const head = parts.join(" · ") || "nothing to play";
    say(`<span>${head}</span>${res.warnings.length ? `<ul>${res.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`, res.warnings.length ? "warn" : "ok");
    setStatus(`code: ${head}`);
    if (read.hush) { if (state.playing) await stopPlayback(); }
    else if (!state.playing && res.names.length) document.getElementById("play")?.click();
    paint();
  };
  const stop = async () => { if (state.playing) document.getElementById("play")?.click(); };

  // The song as code, in seqbaby's own form: every instrument, knob, effect,
  // LFO and lane, so running it back in changes nothing. Its tracks become
  // the code's: delete a track's line and run, and the track goes.
  const fromSong = async ({ opening = false } = {}) => {
    const m = await mod();
    const { code, warnings, names, skipped } = m.sessionToCode(serializeSet(), { native: true });
    const empty = !names.length;
    input.value = empty ? `${code}\n// nothing in the song has notes yet. Try:\n// $: s("bd*4, ~ cp, hh*8")\n` : code;
    _lastNames = names;
    _touched = {};
    _run = null;
    renderHl();
    refreshLink();
    const lead = opening
      ? "the song as code. <b>ctrl/⌘ enter</b> runs it back in without stopping, <b>ctrl/⌘ .</b> stops"
      : "the song, as code. ctrl+enter runs it";
    const notes = [...warnings, ...(skipped.length ? [`${skipped.join(", ")}: comments, and running leaves ${skipped.length > 1 ? "them" : "it"} as ${skipped.length > 1 ? "they are" : "it is"}`] : [])];
    say(`<span>${lead}</span>${notes.length ? `<ul>${notes.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`, notes.length ? "warn" : "ok");
  };

  // ---- the editor ---------------------------------------------------------
  const renderHl = () => { hl.innerHTML = highlight(input.value, activeRanges(input.value)) + "\n"; };
  const syncScroll = () => { hl.scrollTop = input.scrollTop; hl.scrollLeft = input.scrollLeft; };
  input.addEventListener("input", () => { renderHl(); refreshLink(); });
  input.addEventListener("scroll", syncScroll);
  // run / stop answer anywhere in the drawer, not only in the editor: after
  // pressing `from song` or picking an example the focus is on that control
  el.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); run(); return; }
    if ((mod || e.altKey) && e.key === ".") { e.preventDefault(); stop(); }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = input;
      input.value = value.slice(0, a) + "  " + value.slice(b);
      input.setSelectionRange(a + 2, a + 2);
      renderHl();
    }
    if (e.key === "Escape") input.blur();
  });
  q(".sq-code__run").addEventListener("click", run);
  q(".sq-code__stop").addEventListener("click", stop);
  q(".sq-code__from").addEventListener("click", () => fromSong());
  outLink.addEventListener("click", portableHref);
  q(".sq-code__copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(input.value); say("copied", "ok"); }
    catch { input.select(); say("select-all'd: copy it with ctrl/⌘ C", "warn"); }
  });
  q(".sq-code__examples").addEventListener("change", (e) => {
    const k = e.target.value;
    e.target.value = "";
    if (!EXAMPLES[k]) return;
    input.value = EXAMPLES[k];
    _run = null; renderHl(); refreshLink();
    say("ctrl+enter runs it", "ok");
  });
  const close = () => {
    _draft = { code: input.value, song: JSON.stringify(serializeSet()) };
    el.remove();
    document.body.classList.remove("has-code-drawer");
    btn?.setAttribute("aria-pressed", "false");
    cancelAnimationFrame(_raf);
    _open = null;
  };
  q(".sq-code__close").addEventListener("click", close);

  _open = { close, renderHl, input };
  // Reopened onto the song it was closed on, the editor is as it was left
  // (code that does not round-trip, like an every(), survives a close);
  // otherwise it opens on the song as it is now.
  if (_draft && _draft.song === JSON.stringify(serializeSet())) {
    input.value = _draft.code;
    renderHl();
    refreshLink();
    say("<b>ctrl/⌘ enter</b> runs it into the song without stopping, <b>ctrl/⌘ .</b> stops. <b>from song</b> rewrites it from the song", "");
  } else {
    input.value = "";
    say("reading the song…", "");
    fromSong({ opening: true }).catch(e => say(`could not read the song: ${esc(e.message)}`, "error"));
  }
  input.focus();
  const loop = () => { paint(); _raf = requestAnimationFrame(loop); };
  _raf = requestAnimationFrame(loop);
}

// ---- highlighting ------------------------------------------------------------

let _lastKey = "";
function paint() {
  if (!_open) return;
  const ranges = activeRanges(_open.input.value);
  const key = ranges.map(r => r.join(":")).join(",");
  if (key === _lastKey) return;
  _lastKey = key;
  _open.renderHl();
}

/** The source ranges of the atoms whose notes are sounding right now. */
function activeRanges(code) {
  if (!_run || !state.playing || _run.code !== code) return [];
  const out = [];
  for (const t of state.tracks) {
    const locs = _run.locsByName.get(t.name);
    if (!locs || t.muted) continue;
    const idx = t._nowIdx;
    if (!(idx >= 0)) continue;
    // the last step at or before the playhead that starts a note, while it lasts
    for (let k = 0; k < locs.length; k++) {
      const i = ((idx - k) % locs.length + locs.length) % locs.length;
      if (!t.steps?.[i]) continue;
      if (k < Math.max(1, t.lengths?.[i] || 1)) out.push(...locs[i]);
      break;
    }
  }
  return out;
}

const SYNTAX = [
  [/\/\/[^\n]*/y, "c"],
  [/"(?:[^"\\\n]|\\.)*"?|`[^`]*`?|'(?:[^'\\\n]|\\.)*'?/y, "s"],
  [/\b\d+(?:\.\d+)?\b/y, "n"],
  [/^[ \t]*_?[\w$]+(?=:)/my, "l"],
  [/\bsetc[pb]m\b|\bsetcps\b|\bhush\b/y, "k"],
  [/(?<=\.)[A-Za-z_]\w*/y, "m"],
  [/[A-Za-z_]\w*(?=\()/y, "f"],
];
/** The code as HTML: token colours, and a mark around each sounding atom. */
function highlight(code, ranges) {
  const cls = new Array(code.length).fill("");
  for (let i = 0; i < code.length;) {
    let hit = false;
    for (const [re, c] of SYNTAX) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) { for (let k = i; k < i + m[0].length; k++) cls[k] = c; i += m[0].length; hit = true; break; }
    }
    if (!hit) i++;
  }
  const on = new Uint8Array(code.length);
  for (const [a, b] of ranges) for (let k = Math.max(0, a); k < Math.min(code.length, b); k++) on[k] = 1;
  let html = "", i = 0;
  while (i < code.length) {
    let j = i + 1;
    while (j < code.length && cls[j] === cls[i] && on[j] === on[i]) j++;
    const text = esc(code.slice(i, j));
    const inner = cls[i] ? `<span class="t-${cls[i]}">${text}</span>` : text;
    html += on[i] ? `<mark>${inner}</mark>` : inner;
    i = j;
  }
  return html;
}
