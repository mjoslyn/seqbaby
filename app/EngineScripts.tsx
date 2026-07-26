import { MAIN_SRC, TONE_SRC, WOSC_SRC } from "./engineAssets";

// The engine boot, server-rendered into the document instead of injected after
// hydration. The browser's parser sees these while the HTML is still arriving,
// so Tone/woscillators/main.js execute as soon as their (preloaded) bytes land
// — no longer waiting on the React bundle to download, parse and hydrate first.
//
// Ordering: parser-inserted `defer` classic scripts and non-async module
// scripts share one "execute in order" list, so these run strictly in document
// order — which the engine requires (`Tone` and `window.woscillators` are read
// at module-eval time). defer/module also guarantees the DOM is fully parsed
// before main.js's `init()` starts querying it.
//
// Why dangerouslySetInnerHTML rather than JSX <script> tags: the two rendering
// paths need *different* behaviour, and raw HTML gives exactly that for free.
//   - Initial page load: the server streams this string into the document, the
//     parser inserts the scripts, defer + ordering are honoured. Engine boots.
//   - Client-side navigation into the studio (sign-in redirects here): React
//     assigns innerHTML, and scripts set via innerHTML never execute. So no
//     unordered, defer-ignoring dynamic insertion happens behind our back —
//     ScriptLoader's onload-chained fallback owns that path instead.
//
// The inline marker is what tells the two apart, synchronously: it only runs on
// the parser path, so ScriptLoader can check `window.__seqbabyServerBoot` and
// know whether the engine is already booting.
const ENGINE_SCRIPTS_HTML = `
<script>window.__seqbabyServerBoot=1<\/script>
<script src="${TONE_SRC}" defer><\/script>
<script src="${WOSC_SRC}" defer><\/script>
<script src="${MAIN_SRC}" type="module"><\/script>
`;

export default function EngineScripts() {
  return <div dangerouslySetInnerHTML={{ __html: ENGINE_SCRIPTS_HTML }} />;
}
