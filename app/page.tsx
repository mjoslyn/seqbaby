import { STUDIO_BODY } from "./studioMarkup";
import ScriptLoader from "./ScriptLoader";

// The studio route. The engine's static DOM skeleton (header, pattern bar, panels,
// #tracks, both <template>s, #ios-audio-unlock) is server-rendered as raw HTML so
// it exists in the document before the engine scripts run. `display: contents` on
// the wrapper removes its box so the sticky header/layout behave exactly as they
// did when this markup lived directly in <body>. ScriptLoader then injects the
// engine scripts (client-only) in the required order.
export default function StudioPage() {
  return (
    <>
      <div
        style={{ display: "contents" }}
        dangerouslySetInnerHTML={{ __html: STUDIO_BODY }}
      />
      <ScriptLoader />
    </>
  );
}
