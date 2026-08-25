import { PRELOADER_HTML, PRELOADER_SCRIPT } from "./preloader";

// Server-rendered so the overlay is in the very first bytes of the document and
// paints with the first frame — the whole point is to cover the seconds before
// the engine (and React) exist. See preloader.ts for why the driver is inline
// source rather than a component.
//
// dangerouslySetInnerHTML for the same reason EngineScripts uses it: on the
// parser path the inline <script> executes immediately after the markup it
// drives; on a client-side navigation React assigns innerHTML and the script
// does NOT run, which is exactly right — ScriptLoader owns that path and
// injects the same source itself once it knows it is the one booting.
// The id is how ScriptLoader finds this source again on the soft-navigation
// path: React renders the tag but innerHTML-parsed scripts never execute, so it
// re-runs the text from here rather than importing it — which would ship the
// whole driver in the client bundle as well as in the document.
const PRELOADER_MARKUP = `${PRELOADER_HTML}
<script id="sq-preload-boot">${PRELOADER_SCRIPT}<\/script>`;

export default function Preloader() {
  return <div dangerouslySetInnerHTML={{ __html: PRELOADER_MARKUP }} />;
}
