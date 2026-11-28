"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getOpenSong, setOpenSong, subscribeOpenSong } from "@/app/songs/openSong";
import { addComposedTags, setComposedTitle, suggestNewSongName } from "@/app/songs/suggestName";
import { genreById } from "@/app/songs/genres";
import { normalizeTags } from "@/lib/songTags.js";
import GroovePicker from "@/app/GroovePicker";
import { addSongTags, loadSongChat, saveSong, saveSongChat } from "@/app/songs/actions";
import { markSaved } from "@/app/songs/confirmDiscard";
import { trySave } from "@/app/songs/trySave";
import { composeModelLabel } from "@/lib/composeModels.js";
import { signupHref } from "@/lib/safeNext.js";
import { SITE_OUT_OF_BUDGET } from "@/lib/composeKey.js";
import { DEFAULT_COMPOSE_MODEL } from "@/lib/composeModels.js";
import { MODEL_EVENT, readModelPref, writeModelPref } from "@/app/composeModelPref";
import { diffHeadline, diffSessions } from "@/app/songs/sessionDiff.js";
import { canHear, hearForJob, reportOutcome } from "@/app/composeHear";
import { TURNSTILE_SITE_KEY, loadTurnstile } from "@/app/turnstile";
import styles from "@/app/ui.module.css";

/** One tool call of a turn: what it did in a few words, and whether it worked. */
type Step = { t: string; ok: boolean };
type Diff = ReturnType<typeof diffSessions>;

type Msg =
  | { role: "user"; text: string; /** the deck the turn was about, when not the open song ("new": a new deck) */ deck?: string }
  | {
      role: "assistant";
      text: string;
      model?: string;
      /** The tool summaries, as a transcript saved before `log` kept them. */
      activity?: string[];
      /** The turn's work, call by call. */
      log?: Step[];
      /** What the turn changed in the song (sessionDiff.js), when it changed it. */
      changes?: Diff;
      /** How long the turn took. */
      ms?: number;
      warnings?: string[];
    }
  | { role: "error"; text: string };

/** A turn's work, runs of the same call folded into one line with a count. */
function foldSteps(steps: Step[]): { t: string; ok: boolean; n: number }[] {
  const out: { t: string; ok: boolean; n: number }[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last.t === s.t && last.ok === s.ok) last.n++;
    else out.push({ ...s, n: 1 });
  }
  return out;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// What the panel can be asked for, as things to press: each fills the box
// with a request to edit, so the first turn is not a blank page.
const STARTERS: { label: string; text: string }[] = [
  { label: "a whole song", text: "write me a whole song: a dark, driving techno track with an intro, a build, a drop and an outro" },
  { label: "add a part", text: "add a dubby bassline on the silverbox that answers the kick" },
  { label: "change a sound", text: "make the hats swing more and open the filter on the bass" },
  { label: "arrange it", text: "turn this loop into a full song: intro, verse, drop, breakdown, outro, chained" },
  { label: "mix it", text: "put a reverb on a bus, send the snare and lead to it, and duck the bass under the kick" },
  { label: "ask about it", text: "what would make this groove hit harder?" },
];

type ComposeResponse = {
  jobId?: string;
  jobToken?: string;
  error?: string;
  /** Free compose (lib/freeCompose.js): turns left after this one. */
  freeLeft?: number | null;
  /** The answer is "make an account": a free limit ran out, or none is offered. */
  signup?: boolean;
  /** The route wants a Turnstile token before a visitor's first free turn. */
  check?: boolean;
};

/** Free compose with no account, as the studio page found it. */
export type FreeCompose = {
  /** Turns per window (COMPOSE_FREE_TURNS). */
  turns: number;
  /** Left in the window, or null when this browser has not used one yet. */
  left: number | null;
  /** The first turn needs the robot check. */
  check: boolean;
};

/**
 * A turn's changes, sitting between the model and the studio.
 *
 * A turn used to be written straight into the session with `applySet`, which
 * stops the transport and rebuilds every voice — so asking for a hi-hat while
 * a track was playing stopped the track. `mergeSet` (public/js/liveSet.js)
 * writes the same session onto the engine without stopping it, which is what
 * makes an audition possible at all: the new track joins on the step everyone
 * else is on, and everything already playing goes on playing.
 *
 * `before` is what was playing when the audition started, kept so stopping one
 * is the same operation in reverse. Null means the changes are not in the
 * session at all yet.
 */
type Proposal = {
  session: unknown;
  before: unknown | null;
  title?: string | null;
  /** The turn's genre, as tags the song gets when the changes are kept. */
  tags?: string[];
  note?: string;
  /** What the turn changed, for the card. */
  changes?: Diff;
  /**
   * The turn was about another deck of a mix (public/js/mix.js), not the open
   * song: `deck` is that deck's id, and the session is written onto it
   * (`mix.merge`), at once, and never saved from here. `fresh`: the turn
   * wrote a new song from nothing and it is LOADED onto a new deck
   * (`mix.load`).
   */
  deck?: string;
  fresh?: boolean;
  /** The job that made it, for saying what became of it (reportOutcome). */
  job?: { id: string; t?: string };
  /** It has been auditioned at least once. */
  auditioned?: boolean;
  /**
   * The turn wrote a new song over the open one (a genre build, or nothing of
   * what was there survives), so `keep` asks where it is saved: as a song of
   * its own, or as the open song's next version.
   */
  newSong?: boolean;
};

/** Nothing the session sent had written survives in what came back. */
function replacesAll(sent: unknown, got: unknown): boolean {
  type T = { engineKey?: string; name?: string; patterns?: { steps?: unknown[] }[] };
  const tracks = (x: unknown): T[] => ((x as { tracks?: T[] })?.tracks ?? []).filter((t) => t.engineKey !== "bus");
  const key = (t: T) => `${t.engineKey}\n${t.name}`;
  const had = tracks(sent).filter((t) => t.patterns?.some((p) => p?.steps?.some(Boolean)));
  if (!had.length) return false;
  const now = new Set(tracks(got).map(key));
  return had.every((t) => !now.has(key(t)));
}

type JobStatus = {
  status?: "running" | "done" | "error";
  /** The turn is waiting for this browser to play its song back: which listen. */
  hear?: number;
  events?: { type: string; summary?: string; ok?: boolean }[];
  /** How long the turn ran, on the worker's clock. */
  ms?: number;
  reply?: string;
  /** Which model ran the turn. Absent on a record written before the panel
   *  could ask for one, which is why the transcript prints it only when it
   *  is there. */
  model?: string;
  session?: unknown;
  /** Whether the turn actually altered the song. False for a question, or for
   *  edits that cancelled out. Absent on a record written before this existed,
   *  which is why the check below is `!== false` rather than truthiness. */
  changed?: boolean;
  warnings?: string[];
  /** The name the turn gave the song, when it was asked to (unsaved). */
  title?: string | null;
  /** The genre it said the song is. */
  genre?: string | null;
  error?: string;
};

// How long to keep polling before giving up on a worker that has gone quiet.
// The worker's own ceiling is 15 minutes, so this sits just past it rather
// than cutting off a song that is still being written.
const POLL_INTERVAL_MS = 1500;
const POLL_LIMIT_MS = 16 * 60 * 1000;
// Consecutive polls that couldn't get an answer at all before giving up: at
// the interval above, roughly half a minute of no contact.
const MAX_POLL_MISSES = 20;

// Where a key used to be kept when compose ran on the visitor's own key. It is
// gone, so anything left there is cleared on the next visit.
const OLD_KEY_STORES = ["seqbaby.anthropicKey.v1", "seqbaby.composeKeyMode.v1"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What to say when the response wasn't the route's own JSON. */
function describeFailure(status: number, raw: string, data: ComposeResponse | null): string {
  if (data?.error) return data.error;
  // 502/504 with an HTML body is the hosting layer, not the route: nothing
  // the route says ever gets this far, so the status is all there is to go on.
  if (status === 504 || status === 408) {
    return `that took too long and the server cut it off (${status}). A big request can run past the hosting timeout, so try asking for one change at a time.`;
  }
  if (status === 502 || status === 503) {
    return `the server couldn't complete the request (${status}); it may have run too long or run out of memory.`;
  }
  const snippet = raw.trim().slice(0, 160);
  if (snippet.startsWith("<")) return `the server returned a ${status} page instead of a reply.`;
  return snippet || `the server returned ${status} with an empty reply.`;
}

// A chat panel that edits the song open in the studio, backed by
// app/api/compose (the same songBuilder tools the MCP server exposes to an
// external agent, run server-side on the site's Anthropic key). It needs an
// account: signed out, the button goes to sign up.
//
// The SONG's state is not kept here -- the studio's own session is the source
// of truth (serializeSet) and each message resends it, so a change made by hand
// between messages is what the next one edits. The one thing held is a turn's
// RESULT, until it is auditioned or kept (see `Proposal`): a session is what
// the model hands back, and it is a snapshot of the one it was given, so a
// change made by hand while a turn was in flight is not in it -- keeping the
// turn drops that change, exactly as writing it straight in always did.
//
// The CONVERSATION is kept, attached to the song (song_chats, migration 0011):
// it is the record of how a song came to sound the way it does, and coming
// back to one a week later used to mean re-explaining it from scratch. It
// follows whichever song is open, which is why this reads the same open-song
// store the save and songs menus do.
/**
 * @param signedIn whether there is an account behind this panel. Compose
 *        needs one, or an unlock link: otherwise the button goes to sign up.
 * @param serverKey whether this deploy has an Anthropic key, which every
 *        turn runs on. Without one compose is switched off.
 * @param budgetOut whether that key has run out of budget, as the server
 *        knew it when the page was drawn.
 */
/**
 * One compose turn, start to finish: posted, then polled until the job says
 * done or failed. Resolves the finished job, or the sentence to show instead.
 * `onActivity` is handed the tool summaries as they grow; `live` returning
 * false stops the polling (the job itself runs on: nothing can call it back).
 */
async function runTurn(
  body: Record<string, unknown>,
  onActivity?: (steps: Step[]) => void,
  live?: () => boolean,
  onReply?: (r: ComposeResponse, ok: boolean) => void,
): Promise<{ job: JobStatus; activity: Step[]; ref: { id: string; t?: string } } | { error: string }> {
  const res = await fetch("/api/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Anything that failed before the route got to stream -- auth, a bad
  // request, a gateway page -- arrives as an ordinary body with a status
  // worth reading. Parse it by hand: res.json() on an HTML error page
  // throws about an unexpected "<", which reports on the parser rather
  // than on what went wrong.
  if (!res.ok || !res.body) {
    const raw = await res.text();
    let data: ComposeResponse | null = null;
    try {
      data = raw ? (JSON.parse(raw) as ComposeResponse) : null;
    } catch {
      data = null;
    }
    if (data) onReply?.(data, false);
    return { error: describeFailure(res.status, raw, data) };
  }

  const started = (await res.json()) as ComposeResponse;
  onReply?.(started, true);
  if (!started.jobId) return { error: started.error ?? "couldn't start that" };

  // The turn is running somewhere nothing is waiting on, so from here it
  // is polled rather than awaited -- which is what lets it take the
  // minutes a whole song takes.
  const activity: Step[] = [];
  const ref = { id: started.jobId, t: started.jobToken };
  // Which listen has been answered: the turn asks once, and is polled many
  // times while it waits.
  let heardSeq = 0;
  const until = Date.now() + POLL_LIMIT_MS;
  let misses = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    if (live && !live()) return { error: "dropped" };
    if (Date.now() > until) return { error: "gave up waiting on that one; it may still be running." };

    // A failed poll is usually not the job failing -- a blip must not throw
    // away a song still being written -- but "keep asking" is only right
    // for something that might recover. A 404 (no such job, or not this
    // account's) and a 401 (signed out) are answers, not blips: asking
    // again gets the same reply until the 16-minute limit reports a
    // timeout that never happened.
    let pollRes: Response;
    try {
      // The job token is how this browser proves the job is its own to
      // read. An account's session would do for a signed-in visitor, and
      // still does server-side, but an unlocked visitor has no account.
      const q = new URLSearchParams({ id: started.jobId });
      if (started.jobToken) q.set("t", started.jobToken);
      pollRes = await fetch(`/api/compose/status?${q}`);
    } catch {
      if (++misses > MAX_POLL_MISSES) return { error: "lost contact with the server while that was running." };
      continue;
    }
    if (pollRes.status === 401) return { error: "signed out while that was running; sign in and the song may still be there." };
    if (pollRes.status === 404) return { error: "that job is no longer on the server." };
    if (!pollRes.ok) {
      // Anything else (a 5xx, a rate limit) might pass, but not forever.
      if (++misses > MAX_POLL_MISSES) return { error: `the server kept failing to report on that (${pollRes.status}).` };
      continue;
    }
    misses = 0;
    const job = (await pollRes.json()) as JobStatus;

    const summaries = (job.events ?? [])
      .filter((e) => e.type === "tool" && e.summary)
      .map((e) => ({ t: e.summary!, ok: e.ok !== false }));
    if (summaries.length !== activity.length) {
      activity.length = 0;
      activity.push(...summaries);
      onActivity?.([...activity]);
    }
    // The turn wants its song played back (app/composeHear.ts). Answered on
    // the side: the polling goes on, and shows the listen as a step.
    if (job.status === "running" && job.hear && job.hear !== heardSeq) {
      heardSeq = job.hear;
      void hearForJob(ref.id, ref.t, job.hear);
    }
    if (job.status === "done") return { job, activity, ref };
    if (job.status === "error") return { error: job.error ?? "that didn't work" };
  }
}

/** What a turn changed, track by track: + added, - removed, ~ changed. */
function Changes({ d }: { d?: Diff }) {
  if (!d || d.empty || !Array.isArray(d.tracks) || !Array.isArray(d.globals)) return null;
  return (
    <div className={styles.cxChanges}>
      {d.globals.length > 0 && (
        <div className={styles.cxGlobals}>
          {d.globals.map((g) => (
            <span key={g} className={styles.cxGlobal}>{g}</span>
          ))}
        </div>
      )}
      {d.tracks.length > 0 && (
        <ul className={styles.cxTracks}>
          {d.tracks.map((t, i) => (
            <li
              key={i}
              className={`${styles.cxTrack} ${t.kind === "added" ? styles.cxAdded : t.kind === "removed" ? styles.cxRemoved : ""}`}
            >
              <span className={styles.cxMark} aria-hidden>
                {t.kind === "added" ? "+" : t.kind === "removed" ? "−" : "~"}
              </span>
              <span className={styles.cxName}>
                {t.name}
                {t.engine && t.engine !== t.name ? <span className={styles.cxEngine}> {t.engine}</span> : null}
              </span>
              <span className={styles.cxParts}>
                {t.kind === "removed" ? "removed" : `${t.kind === "added" ? "new · " : ""}${t.parts.join(" · ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A turn's work, call by call, a failed call (one it then retried) marked. */
function WorkLog({ steps, tail }: { steps: Step[]; tail?: number }) {
  const folded = foldSteps(steps);
  const shown = tail ? folded.slice(-tail) : folded;
  if (!shown.length) return null;
  return (
    <ol className={styles.cxLog}>
      {tail && folded.length > shown.length ? <li className={styles.cxLogMore}>… {folded.length - shown.length} earlier</li> : null}
      {shown.map((st, i) => (
        <li key={i} className={st.ok ? "" : styles.cxLogBad}>
          <span aria-hidden>{st.ok ? "✓" : "✕"}</span> {st.t}
          {st.n > 1 ? <span className={styles.cxLogN}> ×{st.n}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** A labelled row of choices, one lit: a select with every option in sight. */
function Seg<T extends string | number>({
  label,
  value,
  options,
  onPick,
  disabled,
  title,
}: {
  label: string;
  value: T;
  options: { v: T; label: string; title?: string }[];
  onPick: (v: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className={`${styles.cxSeg} ${disabled ? styles.cxSegOff : ""}`} role="group" aria-label={label} title={title}>
      <span className={styles.cxSegLabel}>{label}</span>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          className={`${styles.grooveChip} ${o.v === value ? styles.grooveChipOn : ""}`}
          aria-pressed={o.v === value}
          disabled={disabled}
          title={o.title}
          onClick={() => onPick(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ComposeChat({
  signedIn,
  serverKey,
  budgetOut,
  models = [],
  unlocked = false,
  free = null,
  defaultModel = DEFAULT_COMPOSE_MODEL,
}: {
  signedIn: boolean;
  serverKey: boolean;
  budgetOut: boolean;
  /** The models this visitor may pick (lib/composeModels.js's allowedModels:
   *  every one on COMPOSE_MODEL_PICKERS, sonnet and opus for an unlock). Two
   *  or more is a menu. The route checks the same rule, so the menu is only
   *  ever a request. */
  models?: { id: string; label: string }[];
  /** Opened an unlock link (lib/unlock.js): compose without an account. */
  unlocked?: boolean;
  /** Free turns with no account (lib/freeCompose.js), when offered. */
  free?: FreeCompose | null;
  /** The deploy's own model, what the menu starts on. */
  defaultModel?: string;
}) {
  // The picked model, remembered per browser. Only sent when there is a menu;
  // anything the route does not allow runs on the deploy's model.
  const canPickModel = models.length > 1;
  // An account, an unlock link's cookie, or a free turn: any may compose.
  const isFree = !signedIn && !unlocked && !!free;
  const canCompose = signedIn || unlocked || isFree;
  // Free turns left (null: none used yet, so all of them), whether the robot
  // check still stands before the first one, and its token once passed.
  const [freeLeft, setFreeLeft] = useState<number | null>(free?.left ?? null);
  const [needCheck, setNeedCheck] = useState(!!free?.check && !!TURNSTILE_SITE_KEY);
  const [checkToken, setCheckToken] = useState("");
  // Bumped to draw a fresh widget when a token was refused (each is single use).
  const [checkRound, setCheckRound] = useState(0);
  const freeOut = isFree && freeLeft === 0;
  const freeBlocked = isFree && (freeOut || (needCheck && !checkToken));
  const modelIds = models.map((m) => m.id).join(",");
  const [model, setModel] = useState(defaultModel);
  useEffect(() => {
    if (!canPickModel) return;
    const ids = modelIds.split(",");
    setModel(readModelPref(defaultModel, ids));
    // A pick made anywhere else on the page is a pick here too.
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<{ model?: string }>).detail?.model;
      if (id && ids.includes(id)) setModel(id);
    };
    window.addEventListener(MODEL_EVENT, onPick);
    return () => window.removeEventListener(MODEL_EVENT, onPick);
  }, [canPickModel, defaultModel, modelIds]);
  const pickModel = (id: string) => {
    setModel(id);
    writeModelPref(id);
  };
  const [ready, setReady] = useState(false);
  // The site's key is out of budget: known from the page, or learned from a
  // turn that failed for it since.
  const [siteDry, setSiteDry] = useState(budgetOut);
  const [open, setOpen] = useState(false);
  // What the drawer shows: the conversation, or the genre picker.
  const [tab, setTab] = useState<"chat" | "genre">("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Tool activity for the turn in flight, filled in as it happens. It moves
  // onto the finished message when the turn lands.
  const [live, setLive] = useState<Step[]>([]);
  // When the turn in flight was sent, and a clock that ticks while it runs: a
  // whole song is minutes, and a panel that only says "working" for that long
  // reads as stuck.
  const [startedAt, setStartedAt] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [sending]);
  // Which finished turns have their work log open.
  const [openLogs, setOpenLogs] = useState<Set<number>>(new Set());
  // The turn's changes, waiting to be auditioned or kept. Nothing is written to
  // the studio until one of those is pressed.
  const [review, setReview] = useState<Proposal | null>(null);
  // The same, for the places that let a proposal go without having it in
  // their closure (the next send, a song arriving): each says what became of
  // the turn before dropping it.
  const reviewRef = useRef<Proposal | null>(null);
  useEffect(() => { reviewRef.current = review; }, [review]);
  const letGo = useCallback((outcome: "superseded" | "dropped") => {
    const r = reviewRef.current;
    if (r) reportOutcome(r.job, outcome, !!r.auditioned);
  }, []);
  // Which deck a turn is about: the open song, or deck B of the mix view. And
  // whether a second song is loaded there, which decides what a deck B turn
  // does (edit that song, or write a new one for the empty deck).
  // "a" is the open song, "new" a new song for a new deck, anything else the
  // id of a loaded deck.
  const [deck, setDeck] = useState<string>("a");
  const [decks, setDecks] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const read = () => {
      const list = (window.seqbaby?.mix?.decks?.() ?? []).filter((d) => !d.loading).map((d) => ({ id: d.id, title: d.title }));
      setDecks((cur) => (cur.length === list.length && cur.every((d, i) => d.id === list[i].id && d.title === list[i].title) ? cur : list));
      // a deck that has gone (ejected, landed) is no longer a target
      setDeck((cur) => (cur === "a" || cur === "new" || list.some((d) => d.id === cur) ? cur : "a"));
    };
    read();
    window.addEventListener("seqbaby:mix", read);
    window.addEventListener("seqbaby:ready", read);
    return () => {
      window.removeEventListener("seqbaby:mix", read);
      window.removeEventListener("seqbaby:ready", read);
    };
  }, []);
  // What the autosave did with the last thing kept, in the space the review bar
  // has just left. Transient: it belongs to that click, so the next turn (and a
  // song arriving, or `new`) clears it.
  const [saveNote, setSaveNote] = useState("");
  // With the drawer shut (keep closes it), the save note goes to the studio's
  // own status line too, or "press save to keep it for good" would be said to
  // nobody. Written straight to #status, as the engine's setStatus does.
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    if (openRef.current || !saveNote) return;
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = saveNote;
    el.classList.toggle("is-err", saveNote.startsWith("kept, but not saved"));
  }, [saveNote]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Which song the transcript on screen belongs to. Null means it belongs to
  // no song yet -- the conversation that built a session nobody has saved --
  // which is what lets the first save adopt it instead of losing it.
  const attachedRef = useRef<string | null>(null);
  // The transcript, readable from an async callback without making every
  // message a reason to re-run the effect that loads one.
  const messagesRef = useRef<Msg[]>([]);
  // Out of budget, or no key on the deploy at all: compose is switched off,
  // and the button says why (an open review bar still has to be reachable).
  const composeOff = (siteDry || !serverKey) && !review;
  // What a turn's start says back about free compose.
  const onFreeReply = useCallback((r: ComposeResponse, ok: boolean) => {
    if (typeof r.freeLeft === "number") setFreeLeft(r.freeLeft);
    if (r.check) {
      setCheckToken("");
      setNeedCheck(!!TURNSTILE_SITE_KEY);
      setCheckRound((n) => n + 1);
    } else if (ok) {
      setNeedCheck(false);
      setCheckToken("");
    }
    if (r.signup && !ok && r.freeLeft === 0) setFreeLeft(0);
  }, []);
  const openSong = useSyncExternalStore(subscribeOpenSong, getOpenSong, getOpenSong);
  const songId = openSong.id;
  const isTemplate = openSong.isTemplate;
  const openTitle = openSong.title;

  // A key kept by an earlier version of this panel is a secret with no use
  // left: clear it.
  useEffect(() => {
    try {
      for (const k of OLD_KEY_STORES) window.localStorage.removeItem(k);
    } catch {
      /* blocked storage: nothing was kept there either */
    }
  }, []);

  useEffect(() => {
    if (window.seqbaby) {
      setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    window.addEventListener("seqbaby:ready", onReady);
    return () => window.removeEventListener("seqbaby:ready", onReady);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The log follows the turn in flight to its newest line. A finished turn is
  // shown from its TOP: the reply is the thing to read, and a result taller
  // than the log used to arrive scrolled to its last line.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const last = log.lastElementChild as HTMLElement | null;
    if (!sending && last && messages[messages.length - 1]?.role === "assistant") {
      log.scrollTo({ top: Math.max(0, last.offsetTop - log.offsetTop - 4) });
    } else {
      log.scrollTo({ top: log.scrollHeight });
    }
  }, [messages, sending, live, open, tab]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // The conversation follows the song. Opening one brings its chat back;
  // opening a song that has none, or closing the last one, leaves a blank
  // panel rather than the previous song's transcript.
  //
  // A TEMPLATE is the exception, the same one the save field makes for a
  // template's name: what is open is a starting point, and the next save
  // detaches into a song of its own. Loading the template's conversation here
  // would put it in front of someone starting something new -- and then, on
  // that first save, write it into the new song as if it had been about it.
  // `new` goes through here whenever the account has a default template, so
  // this is the ordinary path, not a corner.
  useEffect(() => {
    // A different song is open, so changes offered against the last one are
    // not about what is loaded now -- and `before` describes a session that is
    // no longer there. What the last keep saved was said about another song.
    letGo("dropped");
    setReview(null);
    setSaveNote("");
    setOpenLogs(new Set());
    if (!songId || isTemplate) {
      setMessages([]);
      attachedRef.current = null;
      return;
    }
    // Whether what is on screen is a transcript with no song of its own --
    // the conversation that built an unsaved session. If it belongs to some
    // OTHER song, it goes now rather than when the load returns: until then it
    // is the previous song's words sitting under this song's name, and a turn
    // landing in that window would save them onto this one.
    const carrying = attachedRef.current === null && messagesRef.current.length > 0;
    if (!carrying) setMessages([]);
    // Attached to nothing until a load says otherwise, which is what stops a
    // turn landing mid-load from writing over a chat it has not read yet.
    attachedRef.current = null;

    let alive = true;
    loadSongChat(songId).then((res) => {
      if (!alive || res.error) return;
      const stored = res.messages ?? [];
      // A transcript belonging to no song yet moves to whichever song that
      // session becomes -- which is exactly what the first save is, and
      // equally the first save off a template. Without this the conversation
      // that built the song was simply dropped at the moment it got something
      // to be attached to.
      //
      // Only ever onto a song with no conversation of its own: opening an
      // existing song while carrying one must not overwrite what is already
      // there, so a song that has a chat wins and ours is let go.
      const adopt = carrying && stored.length === 0 && messagesRef.current.length > 0;
      attachedRef.current = songId;
      if (adopt) {
        saveSongChat(songId, messagesRef.current).catch(() => {});
        return; // keep what is on screen; it is now this song's
      }
      setMessages(stored);
    });
    return () => {
      alive = false;
    };
  }, [songId, isTemplate, letGo]);

  // `new` (and the logo, which is the same thing) blanks the session. The
  // conversation about the song that was open is not about the blank one, so
  // it goes too. Needed on top of the effect above because starting from a
  // session with no song open leaves the id null either side of the `new`,
  // so nothing there would fire.
  useEffect(() => {
    const onNew = () => {
      setMessages([]);
      setInput("");
      attachedRef.current = null;
      // The session it was about has just been blanked, and `before` describes
      // one that no longer exists -- putting it back would undo the `new`.
      letGo("dropped");
      setReview(null);
      setSaveNote("");
    };
    window.addEventListener("seqbaby:newset", onNew);
    return () => window.removeEventListener("seqbaby:newset", onNew);
  }, [letGo]);

  // Opening the drawer does not focus the input: on a phone that throws the
  // keyboard up over the transcript and the review bar before anything has
  // been read. A tap in the box is what asks for it.

  // Grow with what's typed, up to the cap in the stylesheet: it's a box you
  // write a paragraph of brief into, not a one-line search field.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input, open]);

  // `prompt` is sent in place of the box: the groove button's brief.
  // `meta` is what kind of turn it is, for its record: the genre and roll.
  const send = useCallback(async (prompt?: string, modelOverride?: string, meta?: { genre: string; seed: number }) => {
    const text = (prompt ?? input).trim();
    if (!text || sending || !window.seqbaby) return;
    if (!canCompose || freeBlocked) return;
    // A turn on deck B is sent that deck's song, or, with nothing loaded
    // there, an empty session to write a new one in: the open song's tempo, so
    // the two mix, and a line saying what it is for.
    const mix = window.seqbaby.mix;
    const toB = deck !== "a" && !!mix?.merge;
    const editB = toB && deck !== "new" && !!mix?.decks?.().some((d) => d.id === deck && !d.loading);
    const freshB = toB && !editB;
    const deckId = editB ? deck : "new";
    const open0 = freshB ? (window.seqbaby.serializeSet() as { bpm?: number; scale?: { active?: boolean; root?: number; mode?: string } }) : null;
    const session = editB
      ? mix!.serialize!(deck)
      : freshB
      ? { _version: window.seqbaby.setVersion, bpm: open0?.bpm ?? 120, tracks: [] }
      : window.seqbaby.serializeSet();
    const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const key = open0?.scale?.active ? ` in ${NOTE[(((open0.scale.root ?? 0) % 12) + 12) % 12]} ${open0.scale.mode ?? ""}`.trimEnd() : "";
    const sent = freshB
      ? `${text}\n\n(This is a NEW song, written from the empty session: it will be loaded onto another deck and mixed with a song at ${open0?.bpm ?? 120} bpm${key}. Keep to that tempo${key ? " and a key that sits with it" : ""} unless asked otherwise.)`
      : text;
    // Only plain text crosses the wire between turns -- what the model called
    // and why lives entirely inside one request/response, so the transcript
    // this resends stays small how ever many tool calls a turn took.
    const history = messages
      .filter((m): m is Extract<Msg, { role: "user" | "assistant" }> => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.text }));

    // The transcript is tracked as a value as well as in state, because the
    // turn that ends this one has to be PERSISTED, and setMessages callbacks
    // can't hand anything back to do that with.
    const withUser: Msg[] = [...messages, { role: "user", text, ...(toB ? { deck: deckId } : {}) }];
    setMessages(withUser);
    setInput("");
    setSending(true);
    setStartedAt(Date.now());
    const sentAt = Date.now();
    setLive([]);
    // Asking for the next thing settles the last one. The session just
    // serialized is what the model is being asked about, so whatever is in the
    // engine -- an audition included -- is what this turn builds on, and there
    // is nothing left to put back to.
    letGo("superseded");
    setReview(null);
    setSaveNote("");

    // Attached to whichever song is open WHEN THE TURN LANDS, not when it
    // started: a turn takes minutes, and the first save of a new song happens
    // somewhere in the middle of plenty of them.
    //
    // Never onto a template -- that conversation belongs to the song the next
    // save makes, not to the starting point. Nothing is lost by waiting: the
    // whole transcript is written on the first turn after that save, by which
    // point the store names the new song.
    const land = (msg: Msg) => {
      if (msg.role === "error" && msg.text === SITE_OUT_OF_BUDGET) setSiteDry(true);
      const final = [...withUser, msg];
      setMessages(final);
      const now = getOpenSong();
      // Only onto a song this panel is actually attached to -- meaning its
      // chat has been read, or this transcript was adopted into it. A turn
      // landing while a load is still in flight, or after one failed, would
      // otherwise upsert whatever is on screen over a conversation nobody has
      // seen. That turn is not lost: `final` carries the whole transcript, so
      // the next one writes it.
      if (now.id && !now.isTemplate && attachedRef.current === now.id) {
        saveSongChat(now.id, final).catch(() => {});
      }
    };

    try {
      // A song never saved (or a template, whose first save makes a new
      // song) has no name of its own: the turn is asked to give it one.
      const out = await runTurn(
        {
          message: sent, history, session,
          unnamed: toB ? freshB : !getOpenSong().id || getOpenSong().isTemplate,
          ...(canPickModel ? { model: modelOverride || model } : {}),
          // This browser will play the turn's song back when asked.
          canHear: canHear(),
          meta: meta ? { kind: "genre", ...meta } : { kind: toB ? "deck" : "ask" },
          ...(checkToken ? { turnstile: checkToken } : {}),
        },
        setLive,
        undefined,
        onFreeReply,
      );
      if ("error" in out) {
        land({ role: "error", text: out.error });
        return;
      }
      const { job, activity, ref } = out;
      // Only when the turn actually changed the song: a question changes
      // nothing, and the session it hands back was captured when the
      // message was SENT, which on a turn that takes minutes means writing
      // it would throw away anything done by hand since.
      //
      // And even then it is not written -- it is offered. The changes go
      // into the review bar, where `audition` drops them into the playing
      // session (mergeSet: no teardown, no stopped transport) and `keep`
      // makes them the song. Writing a turn straight in is what used to
      // silence a track that was playing while you asked for another one.
      const changes = job.session && job.changed !== false ? diffSessions(session, job.session) : undefined;
      // The song's genre, as its tag: the picker's own when it built the
      // prompt, else what the turn said the song is.
      const tags = normalizeTags([(meta?.genre && (genreById(meta.genre) as { name?: string } | undefined)?.name) || job.genre || ""]);
      if (job.session && job.changed !== false) {
        const newSong = !toB && (!!meta?.genre || replacesAll(session, job.session));
        setReview({ session: job.session, before: null, title: job.title ?? null, tags, changes, job: ref, ...(newSong ? { newSong } : {}), ...(toB ? { deck: deckId, fresh: freshB } : {}) });
      }
      // A name with nothing to review (the turn only named the song) is
      // the song's at once; otherwise it comes with the changes, on keep.
      // (A deck B turn never names the open song.)
      else if (job.title && !toB) setComposedTitle(job.title);
      land({
        role: "assistant",
        text: job.reply || "Done.",
        // What it actually ran on, as the worker reported it.
        model: job.model,
        log: activity,
        ...(changes && !changes.empty ? { changes } : {}),
        ms: job.ms ?? Date.now() - sentAt,
        warnings: job.warnings,
      });
    } catch (e) {
      land({ role: "error", text: `couldn't reach compose chat: ${(e as Error).message}` });
    } finally {
      setSending(false);
      setLive([]);
    }
  }, [input, sending, messages, canCompose, canPickModel, model, deck, letGo, checkToken, onFreeReply, freeBlocked]);

  // ---- the review bar ------------------------------------------------------
  //
  // Both directions are the same call: a session, written onto the live engine
  // in place. Auditioning writes the turn's; stopping writes back what was
  // playing before it. Neither stops the transport, which is the whole point.
  const writeLive = useCallback((session: unknown) => {
    const api = window.seqbaby;
    if (!api) return;
    // applySet is the fallback for an engine older than mergeSet (a cached
    // main.js from before this shipped). It costs the transport, which is
    // exactly what the merge exists to avoid, but it is never silence.
    if (api.mergeSet) api.mergeSet(session);
    else api.applySet(session);
  }, []);

  // A deck B turn's session, written onto that deck in place (mix.js,
  // mergeDeckB). False when the deck has gone (ejected, landed, a song opened).
  const writeDeckB = useCallback((session: unknown, id?: string): boolean => {
    try {
      if (!id || !window.seqbaby?.mix?.decks?.().some((d) => d.id === id)) return false;
      return !!window.seqbaby?.mix?.merge?.(session, id);
    } catch (e) {
      console.error(e);
      return false;
    }
  }, []);
  const deckGone = useCallback(() => {
    letGo("dropped");
    setReview(null);
    setSaveNote("that deck is no longer loaded, so those changes had nowhere to go");
  }, [letGo]);

  // Audition: keep what is playing so it can be put back, then merge the
  // turn's session over it. Nothing is saved and nothing is torn down.
  // `before` is taken at the press: what is playing then is what stop puts back.
  const audition = useCallback(async () => {
    const r = review;
    if (!r || r.before || !window.seqbaby) return;
    if (r.deck) {
      // A new song for a new deck: loaded there, stopped, ready to bring in.
      if (r.fresh) {
        // Loading it onto a deck is what keeping a new song is.
        reportOutcome(r.job, "kept");
        setReview(null);
        setSaveNote("loading onto a new deck…");
        try {
          const ok = await window.seqbaby.mix!.load(r.session, { title: r.title || "composed", source: { kind: "compose" } });
          setSaveNote(ok ? "on a new deck: open the mix view, start it, and bring the crossfader over" : "");
        } catch (e) {
          setSaveNote(`could not load it onto a deck: ${(e as Error).message}`);
        }
        return;
      }
      const there = !!window.seqbaby.mix?.decks?.().some((d) => d.id === r.deck);
      const was = there ? window.seqbaby.mix?.serialize?.(r.deck) ?? null : null;
      if (!was || !writeDeckB(r.session, r.deck)) return deckGone();
      setReview({ ...r, before: was, note: "", auditioned: true });
      return;
    }
    const before = window.seqbaby.serializeSet();
    writeLive(r.session);
    setReview({ ...r, before, note: "", auditioned: true });
  }, [review, writeLive, writeDeckB, deckGone]);

  // Stop: back to what was playing, with the changes still on offer. Anything
  // changed BY HAND during the audition goes back with it -- undo reaches it
  // (the merge lands on the stack like any other edit), which is why this is a
  // button and not a confirm dialog.
  const stopAudition = useCallback(async () => {
    const r = review;
    if (!r) return;
    if (r.deck) {
      if (!r.before) return;
      if (!writeDeckB(r.before, r.deck)) return deckGone();
      setReview({ ...r, before: null });
      return;
    }
    if (!r.before) return;
    writeLive(r.before);
    setReview({ ...r, before: null });
  }, [review, writeLive, writeDeckB, deckGone]);

  // Keeping is a real edit to the song, so it is SAVED, as a version of its
  // own. The top-bar save is a click away in another island and nobody presses
  // it mid-conversation, so a kept turn used to live only in the tab it was
  // asked for in -- one reload from being a transcript about a song that never
  // got the changes it describes. The rule is exactly the top bar's: the open
  // song, branching off whichever version is loaded, which is what keeps the
  // tree right when the conversation was started from an older version.
  //
  // Nothing is saved when there is no song to save into -- signed out, or a
  // session nobody has named yet, or a template, whose first save MAKES a song
  // and so is a decision with a name attached. Inventing one here would put a
  // row in somebody's list under a name they never saw. The note says so
  // rather than saying nothing, since "keep" having kept nothing anywhere is
  // the thing worth knowing.
  const autosaveKept = useCallback(async (as?: { title?: string | null; tags?: string[] }) => {
    const now = getOpenSong();
    if (!signedIn) return setSaveNote("");
    if (now.isTemplate) return setSaveNote("kept. press save to make this a song of its own");
    if (!now.id) return setSaveNote("kept. press save to keep it for good");
    if (!window.seqbaby) return;
    setSaveNote("saving…");
    // What is in the ENGINE, not the turn's session: mid-audition that is the
    // changes plus anything moved by hand since, which is the right answer to
    // "keep what I am hearing" and the same answer the review bar gives.
    const data = window.seqbaby.serializeSet();
    // A new song written over the open one, kept as a song of its own: the
    // open song is left as it was last saved, and the studio holds the new
    // one from here. Its name is the turn's, else a generated one that is
    // not the open song's; the server gives a taken name a number.
    if (as) {
      const title = as.title?.trim() || suggestNewSongName(now.title) || now.title;
      const res = await trySave(data, () => saveSong({ title, data, titleGenerated: true, tags: as.tags, label: "compose" }));
      if (res.error) return setSaveNote(`kept, but not saved: ${res.error}`);
      markSaved(data);
      const saved = res.title ?? title;
      // The conversation that built it goes with it: attached to nothing, it
      // is adopted by the song the slot names next (the song-change effect).
      attachedRef.current = null;
      setOpenSong({ id: res.id ?? null, title: saved, versionId: res.versionId ?? null, isTemplate: false });
      // After that effect, which clears the note with the old song.
      setTimeout(() => setSaveNote(`kept · saved as a new song, \u201c${saved}\u201d`), 60);
      return;
    }
    // Labelled `compose` and nothing more, so the tree still says which saves
    // nobody pressed. Not with what was asked for: that would copy the
    // transcript into song_versions, a second table whose privacy it would
    // then depend on, and one a cleared chat would leave behind.
    const label = "compose";
    const res = await trySave(data, () => saveSong({
      id: now.id ?? undefined,
      title: now.title,
      data,
      // Undefined, never null: null is "this is a root", and a song whose open
      // version is unknown wants the tip it already has.
      parentVersionId: now.versionId ?? undefined,
      label,
    }));
    if (res.error) return setSaveNote(`kept, but not saved: ${res.error}`);
    markSaved(data);
    // The studio is now holding the version just written, so the NEXT save --
    // from here or from the top bar -- branches off it rather than off the one
    // this conversation started from.
    if (res.versionId) setOpenSong({ versionId: res.versionId });
    setSaveNote(
      res.unchanged
        ? `kept, nothing to save: still v${res.versionSeq}`
        : `kept · saved as v${res.versionSeq}`,
    );
  }, [signedIn]);

  // Keep: the changes are the song now. Mid-audition there is nothing to write
  // -- the engine is already playing them, hand edits and all. Otherwise they
  // are written in now, and saved.
  const keepChanges = useCallback(async (where?: "new" | "version") => {
    const r = review;
    const api = window.seqbaby;
    if (!r || !api) return;
    if (r.deck) {
      // Another deck is not the open song: nothing is saved from here. Its song is
      // kept for good by landing it, or by keeping both decks, and saving.
      if (r.fresh) return void audition();
      if (!r.before && !writeDeckB(r.session, r.deck)) return deckGone();
      reportOutcome(r.job, "kept", !!r.auditioned);
      setReview(null);
      setOpen(false);
      setSaveNote(`kept on deck ${r.deck.toUpperCase()}. It is saved once that deck is the song (eject deck A) or you keep the decks as one song, then save`);
      return;
    }
    if (!r.before) writeLive(r.session);
    reportOutcome(r.job, "kept", !!r.auditioned);
    // After the write: an applySet fallback announces a new session, which
    // clears any name held for the last one.
    if (r.title) setComposedTitle(r.title);
    // Its genre goes on the song: at once when one of the account's own is
    // open (added to its tags, never replacing them), else into what the save
    // box will offer when the song is first saved.
    const asNew = where === "new";
    if (r.tags?.length && !asNew) {
      const now = getOpenSong();
      if (signedIn && now.id && !now.isTemplate) void addSongTags(now.id, r.tags).catch(() => {});
      else addComposedTags(r.tags);
    }
    setReview((cur) => (cur && cur.session === r.session ? null : cur));
    // Keeping is the end of the conversation's business with this turn: the
    // drawer goes, and what the save did is said in the studio's status line
    // (the effect on saveNote below), where it is still seen.
    setOpen(false);
    void autosaveKept(asNew ? { title: r.title, tags: r.tags } : undefined);
  }, [review, writeLive, autosaveKept, writeDeckB, deckGone, audition, signedIn]);

  const discardChanges = useCallback(() => {
    const r = review;
    if (!r) return;
    // `before` set means the changes are playing (a stop on its way included).
    if (r.before && r.deck) writeDeckB(r.before, r.deck);
    else if (r.before) writeLive(r.before);
    reportOutcome(r.job, "discarded", !!r.auditioned);
    setReview(null);
    setSaveNote("");
  }, [review, writeLive, writeDeckB]);

  // The genre tab (GroovePicker.tsx) starts a turn from a genre: its brief
  // goes in the box and is sent as an ordinary turn, so it lands in the
  // review bar like any other and stays in the box if the turn cannot run.
  const startBuild = useCallback(
    (prompt: string, meta?: { genre: string; seed: number }) => {
      setTab("chat");
      setInput(prompt);
      send(prompt, undefined, meta);
    },
    [send],
  );
  // A genre build writes a new song over the open one. When that is a song of
  // the account's with changes not saved yet, it asks first (a card in the
  // drawer, not a dialog: an engine modal sits under the drawer).
  const [pendingBuild, setPendingBuild] = useState<{ prompt: string; meta?: { genre: string; seed: number } } | null>(null);
  const [savingFirst, setSavingFirst] = useState(false);
  const buildGroove = useCallback(
    (prompt: string, meta?: { genre: string; seed: number }) => {
      const now = getOpenSong();
      const dirty = signedIn && deck === "a" && !!now.id && !now.isTemplate && !!window.seqbaby?.hasUnsavedChanges?.();
      if (dirty) return setPendingBuild({ prompt, meta });
      startBuild(prompt, meta);
    },
    [startBuild, signedIn, deck],
  );
  const resolveBuild = useCallback(async (how: "save" | "skip" | "cancel") => {
    const b = pendingBuild;
    if (!b || savingFirst) return;
    if (how === "cancel") return setPendingBuild(null);
    if (how === "save" && window.seqbaby) {
      const now = getOpenSong();
      const data = window.seqbaby.serializeSet();
      setSavingFirst(true);
      const res = await trySave(data, () => saveSong({ id: now.id ?? undefined, title: now.title, data, parentVersionId: now.versionId ?? undefined }));
      setSavingFirst(false);
      if (res.error) return setSaveNote(`not saved: ${res.error}`);
      markSaved(data);
      if (res.versionId) setOpenSong({ versionId: res.versionId });
    }
    setPendingBuild(null);
    startBuild(b.prompt, b.meta);
  }, [pendingBuild, savingFirst, startBuild]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  if (!ready) return null;

  const DK = review?.deck && !review.fresh ? `deck ${review.deck.toUpperCase()}` : "the deck";

  const reviewTitle = !review
    ? ""
    : review.fresh
    ? "a new song for a new deck"
    : review.before
    ? review.deck ? `auditioning on ${DK}` : "auditioning"
    : review.deck ? `changes ready for ${DK}` : "changes ready";
  const reviewText = !review
    ? ""
    : review.note
    ? review.note
    : review.deck
    ? (review.fresh
        ? "load puts it on the deck, stopped, ready to start and bring in."
        : review.before
        ? "the deck is playing these changes. keep leaves them there."
        : "audition writes them onto the deck; keep leaves them there.")
    : review.before
    ? "you are hearing the changes, but the song does not have them yet."
    : "not in the song yet. audition drops them into what's playing; keep makes them the song.";

  const mixable = typeof window !== "undefined" && !!window.seqbaby?.mix?.merge;

  return (
    <div className={styles.songsWrap} ref={wrapRef}>
      {/* A closed drawer hides the review bar but not the audition: the extra
          track goes on playing, and with nothing said here there would be no
          way to find out why it is there. */}
      <button
        className={`${styles.accountBtn} ${review ? styles.composeBtnHolding : ""}`}
        onClick={() => {
          // Composing needs an account: a signed-out visitor is sent to make
          // one, and comes back here after (the studio's leave guard asks
          // first if there is unsaved work).
          if (!canCompose) {
            location.href = signupHref(location.pathname + location.search);
            return;
          }
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        disabled={composeOff && !open}
        title={composeOff
          ? (serverKey ? SITE_OUT_OF_BUDGET : "compose isn't set up here")
          : review
          ? (review.before
              ? "auditioning changes: open to keep or stop them"
              : "changes waiting: open to audition or keep them")
          : canCompose
          ? "ask for changes to this song"
          : "make an account to compose"}
      >
        compose{review ? " ·" : ""}
      </button>
      {open && (
        <div className={styles.chatBackdrop} onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div className={`${styles.panel} ${styles.chatPanel}`}>
          <div className={styles.cxHead}>
            <div className={styles.chatTabs} role="tablist" aria-label="compose">
              <button
                role="tab"
                aria-selected={tab === "chat"}
                className={`${styles.cxTab} ${tab === "chat" ? styles.cxTabOn : ""}`}
                onClick={() => setTab("chat")}
                title="say what you want, in words: a part, a sound, an arrangement, a whole song, or a question"
              >
                ask
              </button>
              <button
                role="tab"
                aria-selected={tab === "genre"}
                className={`${styles.cxTab} ${tab === "genre" ? styles.cxTabOn : ""}`}
                onClick={() => setTab("genre")}
                title="pick a genre and it writes a whole song in it"
              >
                genre
              </button>
            </div>
            {canPickModel && (
              <select
                className={styles.chatModelSelect}
                value={model}
                onChange={(e) => pickModel(e.target.value)}
                disabled={sending}
                aria-label="model"
                title="the model the next turn runs on"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            <button className={styles.panelClose} onClick={() => setOpen(false)} aria-label="close" title="close (a turn in flight carries on)">
              ×
            </button>
          </div>
          {isFree && (
            <FreeStrip
              key={checkRound}
              turns={free!.turns}
              left={freeLeft}
              check={needCheck}
              onToken={setCheckToken}
            />
          )}
          {tab === "genre" && <GroovePicker onBuild={buildGroove} busy={sending || composeOff || freeBlocked} />}
          <div className={styles.chatLog} ref={logRef} hidden={tab !== "chat"}>
            {messages.length === 0 && !sending && (
              <div className={styles.cxEmpty}>
                <div className={styles.cxEmptyLead}>
                  say what you want and it is written into the song that&apos;s open.
                </div>
                <div className={styles.cxStarters}>
                  {STARTERS.map((st) => (
                    <button
                      key={st.label}
                      type="button"
                      className={styles.cxStarter}
                      title={`“${st.text}” (put in the box to edit, not sent)`}
                      onClick={() => {
                        setInput(st.text);
                        inputRef.current?.focus();
                      }}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                <ul className={styles.cxEmptyList}>
                  <li>it adds tracks, writes parts, sets sounds, fx, modulation and automation, and arranges sections.</li>
                  <li>each reply says what it did and lists what changed. nothing lands until you audition or keep it.</li>
                  <li>the <b>genre</b> tab builds a whole song from one of 150 genres.</li>
                </ul>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className={styles.cxAsk}>
                  {m.deck && <span className={styles.cxAskTag}>{m.deck === "new" ? "new deck" : `deck ${m.deck.toUpperCase()}`}</span>}
                  {m.text}
                </div>
              ) : m.role === "error" ? (
                <div key={i} className={styles.cxError} role="alert">
                  {m.text}
                </div>
              ) : (
                (() => {
                  const steps: Step[] = m.log ?? (m.activity ?? []).map((t) => ({ t, ok: true }));
                  const failed = steps.filter((st) => !st.ok).length;
                  const logOpen = openLogs.has(i);
                  return (
                    <article key={i} className={styles.cxResult}>
                      <div className={styles.cxReply}>{m.text}</div>
                      <Changes d={m.changes} />
                      {m.warnings && m.warnings.length > 0 && (
                        <div className={styles.cxWarn}>
                          <div className={styles.cxWarnHead}>worth a look</div>
                          <ul>
                            {m.warnings.map((w, k) => (
                              <li key={k}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(m.model || m.ms || steps.length > 0) && (
                        <div className={styles.cxFoot}>
                          {m.model && <span>{composeModelLabel(m.model)}</span>}
                          {m.ms ? <span>{clock(m.ms)}</span> : null}
                          {steps.length > 0 && (
                            <button
                              type="button"
                              className={styles.cxFootBtn}
                              aria-expanded={logOpen}
                              onClick={() =>
                                setOpenLogs((cur) => {
                                  const next = new Set(cur);
                                  if (next.has(i)) next.delete(i);
                                  else next.add(i);
                                  return next;
                                })
                              }
                              title="every call the turn made into the song, in order"
                            >
                              {steps.length} step{steps.length === 1 ? "" : "s"}
                              {failed ? ` · ${failed} retried` : ""} {logOpen ? "▴" : "▾"}
                            </button>
                          )}
                        </div>
                      )}
                      {logOpen && <WorkLog steps={steps} />}
                    </article>
                  );
                })()
              ),
            )}
            {sending && (
              <article className={`${styles.cxResult} ${styles.cxRunning}`} aria-live="polite">
                <div className={styles.cxRunHead}>
                  <span className={styles.cxPulse} aria-hidden />
                  <span className={styles.cxRunWhat}>
                    {live.length === 0 ? "reading the song" : "writing"}
                  </span>
                  <span>{clock(Date.now() - startedAt)}</span>
                  {live.length > 0 && <span>{live.length} step{live.length === 1 ? "" : "s"}</span>}
                </div>
                <WorkLog steps={live} tail={7} />
                <div className={styles.cxHint}>
                  a part takes under a minute, a whole song a few. it carries on with this closed; what you change by hand meanwhile is not in what comes back.
                </div>
              </article>
            )}
          </div>
          {!review && saveNote && <div className={styles.cxNote}>{saveNote}</div>}
          {pendingBuild && (
            <section className={styles.chatReview} aria-label="unsaved changes">
              <div className={styles.cxReviewHead}>
                <span className={styles.cxReviewTitle}>unsaved changes</span>
              </div>
              <div className={styles.chatReviewText}>
                &ldquo;{openTitle}&rdquo; has changes that are not saved. The build writes a new song over it: save them as its next version first?
              </div>
              <div className={styles.chatReviewBtns}>
                <button className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} onClick={() => resolveBuild("save")} disabled={savingFirst}>
                  {savingFirst ? "saving…" : "save, then build"}
                </button>
                <button className={styles.smallBtn} onClick={() => resolveBuild("skip")} disabled={savingFirst} title="build without saving them; undo can still bring them back until the page is left">
                  build without saving
                </button>
                <button className={`${styles.smallBtn} ${styles.cxDiscard}`} onClick={() => resolveBuild("cancel")} disabled={savingFirst}>
                  cancel
                </button>
              </div>
            </section>
          )}
          {review && (
            <section className={`${styles.chatReview} ${review.before ? styles.chatReviewLive : ""}`} aria-label="changes to review">
              <div className={styles.cxReviewHead}>
                <span className={styles.cxReviewTitle}>
                  {reviewTitle}
                  {review.title ? <span className={styles.cxReviewName}> “{review.title}”</span> : null}
                </span>
                {review.changes && !review.changes.empty && <span className={styles.cxReviewSum}>{diffHeadline(review.changes)}</span>}
              </div>
              {/* Under the genre picker the card is its head and its buttons:
                  the list needs the room, and the rest is a tab away. */}
              {tab === "chat" && <div className={styles.chatReviewText}>{reviewText}</div>}
              <div className={styles.chatReviewBtns}>
                <button
                  className={`${styles.smallBtn} ${review.fresh ? styles.smallBtnPrimary : ""}`}
                  onClick={review.before ? stopAudition : audition}
                  title={review.before
                    ? "put back what was playing before the audition"
                    : "hear them in what is playing, without stopping the transport"}
                >
                  {review.fresh ? "load to a deck" : review.before ? "■ stop" : "▶ audition"}
                </button>
                {!review.fresh && review.newSong && signedIn && songId && !isTemplate && !review.deck && <button
                  className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                  onClick={() => keepChanges("new")}
                  title={`keep it, and save it as a song of its own. \u201c${openTitle}\u201d stays as it was last saved`}
                >
                  keep + save new song
                </button>}
                {!review.fresh && <button
                  className={`${styles.smallBtn} ${review.newSong && signedIn && songId && !isTemplate && !review.deck ? "" : styles.smallBtnPrimary}`}
                  onClick={() => keepChanges("version")}
                  title={review.deck ? "leave them on the deck (saved once it is the song, or the decks are kept as one)" :
                    signedIn && songId && !isTemplate
                      ? "make them part of the song, and save it as a new version"
                      : "make them part of the song"
                  }
                >
                  {signedIn && songId && !isTemplate && !review.deck ? (review.newSong ? "keep + save as its next version" : "keep + save") : "keep"}
                </button>}
                <button className={`${styles.smallBtn} ${styles.cxDiscard}`} onClick={discardChanges} title="throw them away">
                  discard
                </button>
              </div>
            </section>
          )}
          <div className={styles.cxComposer} hidden={tab !== "chat"}>
            <textarea
              ref={inputRef}
              className={styles.chatTextarea}
              rows={4}
              placeholder={
                composeOff
                  ? (serverKey ? "compose is resting: the site's budget has run out" : "compose isn't set up here")
                  : deck === "new"
                  ? "describe a new song for a new deck…"
                  : deck !== "a"
                  ? `what should change on deck ${deck.toUpperCase()}?`
                  : review
                  ? "ask for more (it builds on what is playing, and settles these changes)…"
                  : messages.length
                  ? "what next?"
                  : "a part, a sound, a whole song, a question…"
              }
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className={styles.cxComposerRow}>
              {mixable && (
                <div className={styles.chatDeckSelect}>
                  <Seg
                    label="for"
                    value={deck}
                    disabled={sending}
                    title="which song the next turn is about: the open song, a song loaded on another deck (edited in place, on the deck), or a NEW song written at this song's tempo and loaded onto a new deck to mix in"
                    options={[
                      { v: "a", label: decks.length ? "A" : "this song", title: "the open song" },
                      ...decks.map((d) => ({ v: d.id, label: d.id.toUpperCase(), title: `deck ${d.id.toUpperCase()}: ${d.title}` })),
                      { v: "new", label: "+ new deck", title: "a new song, written from nothing at this song's tempo and loaded onto a new deck" },
                    ]}
                    onPick={(v) => setDeck(v)}
                  />
                </div>
              )}
              <span className={styles.cxKeys} title="shift+enter for a new line">enter sends</span>
              <button
                className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                onClick={() => send()}
                disabled={sending || !input.trim() || composeOff || freeBlocked}
              >
                {sending ? "working…" : "send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Free compose's line in the drawer: how many turns are left, the way to more,
 * and the robot check before the first one (app/turnstile.ts).
 */
function FreeStrip({
  turns,
  left,
  check,
  onToken,
}: {
  turns: number;
  left: number | null;
  check: boolean;
  onToken: (t: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [checkErr, setCheckErr] = useState("");
  useEffect(() => {
    if (!check || !TURNSTILE_SITE_KEY) return;
    let gone = false;
    loadTurnstile()
      .then((ts) => {
        if (gone || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "auto",
          size: "flexible",
          callback: (t: string) => {
            onToken(t);
            setCheckErr("");
          },
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            setCheckErr("the robot check failed, try again");
          },
        });
      })
      .catch(() => {
        if (!gone) setCheckErr("the robot check did not load (an ad blocker?)");
      });
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [check, onToken]);
  const n = left ?? turns;
  const signup = () => {
    location.href = signupHref(location.pathname + location.search);
  };
  return (
    <div className={styles.cxFree}>
      <div className={styles.cxFreeLine}>
        <span>
          {n === 0
            ? `that's your ${turns} free turns.`
            : left === null
            ? `${turns} free turns, no account needed.`
            : `${n} of ${turns} free turns left.`}
        </span>
        <button type="button" className={styles.smallBtn} onClick={signup}>
          {n === 0 ? "make an account to keep going" : "make an account for more"}
        </button>
      </div>
      {check && TURNSTILE_SITE_KEY && n > 0 && (
        <>
          <div className={styles.cxFreeHint}>one quick check before your first song:</div>
          <div ref={box} />
          {checkErr && <div className={styles.cxFreeHint}>{checkErr}</div>}
        </>
      )}
    </div>
  );
}
