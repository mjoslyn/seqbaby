// Whether seqbaby can be installed from this browser, and the way to ask.
// A tiny store rather than state in a component, because the browser fires
// `beforeinstallprompt` once, early, and the menu that offers the install
// (HelpMenu) is mounted later and on some pages not at all.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type InstallState =
  /** the browser will show its own install dialog when asked */
  | "ready"
  /** iOS: there is no dialog to raise, only Share, then Add to Home Screen */
  | "ios"
  /** running as the installed app already */
  | "installed"
  /** nothing to offer (a browser with no install, or it has not said yet) */
  | "none";

let deferred: InstallEvent | null = null;
let state: InstallState = "none";
const subs = new Set<() => void>();
const set = (s: InstallState) => {
  if (s === state) return;
  state = s;
  subs.forEach((f) => f());
};

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

let started = false;
/** Start listening. Safe to call more than once; only the first does anything. */
export function watchInstall() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (standalone()) set("installed");
  else {
    const ua = navigator.userAgent;
    // iPadOS says it is a Mac; a Mac with a touch screen is an iPad.
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios && !/SeqbabyApp\//.test(ua)) set("ios");
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    // keep the browser's own banner back: the offer is in the help menu
    e.preventDefault();
    deferred = e as InstallEvent;
    set("ready");
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set("installed");
  });
}

export const getInstallState = () => state;
export const getServerInstallState = (): InstallState => "none";
export function subscribeInstall(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Raise the browser's install dialog. Resolves whether it was accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;                                 // a prompt can be shown once
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== "accepted") set("none");
    return outcome === "accepted";
  } catch {
    set("none");
    return false;
  }
}
