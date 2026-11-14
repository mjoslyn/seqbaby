"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getOpenSong, setOpenSong, subscribeOpenSong } from "@/app/songs/openSong";
import { setComposedTitle } from "@/app/songs/suggestName";
import GroovePicker from "@/app/GroovePicker";
import { loadSongChat, saveSong, saveSongChat } from "@/app/songs/actions";
import { markSaved } from "@/app/songs/confirmDiscard";
import { trySave } from "@/app/songs/trySave";
import { composeModelLabel } from "@/lib/composeModels.js";
import { signupHref } from "@/lib/safeNext.js";
import { SITE_OUT_OF_BUDGET } from "@/lib/composeKey.js";
import { DEFAULT_COMPOSE_MODEL } from "@/lib/composeModels.js";
import { MODEL_EVENT, readModelPref, writeModelPref } from "@/app/composeModelPref";
import { diffHeadline, diffSessions } from "@/app/songs/sessionDiff.js";
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

type ComposeResponse = { jobId?: string; jobToken?: string; error?: string };

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
// `pending`: a transition (public/js/transition.js) is on its way to a bar
// line, and which button asked for it.
type Proposal = {
  session: unknown;
  before: unknown | null;
  title?: string | null;
  pending?: "audition" | "stop" | "keep" | null;
  note?: string;
  /** What the turn changed, for the card. */
  changes?: Diff;
  /** The new song's pattern to transition into (0-based), or unset for the default. */
  into?: number | null;
  /**
   * The turn was about another deck of a mix (public/js/mix.js), not the open
   * song: `deck` is that deck's id, and the session is written onto it
   * (`mix.merge`), at once, and never saved from here. `fresh`: the turn
   * wrote a new song from nothing and it is LOADED onto a new deck
   * (`mix.load`).
   */
  deck?: string;
  fresh?: boolean;
};

/** The patterns of a session with notes in them, by slot. */
function filledSlots(session: unknown): number[] {
  const s = session as { tracks?: { patterns?: ({ steps?: unknown[] } | null)[] }[] } | null;
  const out: number[] = [];
  for (let k = 0; k < 32; k++) if (s?.tracks?.some((t) => t.patterns?.[k]?.steps?.some(Boolean))) out.push(k);
  return out;
}

type Shape = "cut" | "sweep" | "drop" | "fade" | "stagger" | "bridge";
const SHAPES: Shape[] = ["cut", "sweep", "drop", "fade", "stagger", "bridge"];
const SHAPE_TIPS: Record<Shape, string> = {
  cut: "straight in, on the bar",
  sweep: "both songs play for the length: the new one from the start, the old one swept down and gone at the end",
  drop: "the playing song thins (harmony and lead, then bass, then drums), a near-silent last bar, then the hit",
  fade: "both songs play for the length: the old one fades out as the new one fades in",
  stagger: "the new song arrives a group at a time: drums, bass, harmony, lead",
  bridge: "a passage written for the join: the new song's intro works its way in while the playing song plays an outro over it, then the new song carries on from the section after its intro",
};

// How the review bar's writes reach what is playing: on the next bar or at
// once, cut or swept, over how many bars, and what happens to the tempo.
type TransitionPrefs = { when: "bar" | "now"; shape: Shape; bars: number; tempo: "auto" | "jump" | "ramp" };
const TRANSITION_KEY = "seqbaby.transition.v1";
const TRANSITION_DEFAULT: TransitionPrefs = { when: "bar", shape: "cut", bars: 2, tempo: "auto" };
function loadTransition(): TransitionPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(TRANSITION_KEY) || "null");
    if (!v || typeof v !== "object") return TRANSITION_DEFAULT;
    return {
      when: v.when === "now" ? "now" : "bar",
      shape: SHAPES.includes(v.shape) ? v.shape : "cut",
      bars: [1, 2, 4, 8].includes(Number(v.bars)) ? Number(v.bars) : 2,
      tempo: v.tempo === "jump" || v.tempo === "ramp" ? v.tempo : "auto",
    };
  } catch {
    return TRANSITION_DEFAULT;
  }
}

type JobStatus = {
  status?: "running" | "done" | "error";
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
): Promise<{ job: JobStatus; activity: Step[] } | { error: string }> {
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
    return { error: describeFailure(res.status, raw, data) };
  }

  const started = (await res.json()) as ComposeResponse;
  if (!started.jobId) return { error: started.error ?? "couldn't start that" };

  // The turn is running somewhere nothing is waiting on, so from here it
  // is polled rather than awaited -- which is what lets it take the
  // minutes a whole song takes.
  const activity: Step[] = [];
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
    if (job.status === "done") return { job, activity };
    if (job.status === "error") return { error: job.error ?? "that didn't work" };
  }
}

/** A bridge being written, or written, for one proposal (see `writeBridge`). */
type BridgeJob = {
  /** The proposal's session and `into` it was written for. */
  for: unknown;
  into: number | null;
  layout: BridgeLayout;
  status: "writing" | "ready" | "failed";
  /** The model's session, once ready: its bridge patterns are what is used. */
  result?: unknown;
};

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
  /** The deploy's own model, what the menu starts on. */
  defaultModel?: string;
}) {
  // The picked model, remembered per browser. Only sent when there is a menu;
  // anything the route does not allow runs on the deploy's model.
  const canPickModel = models.length > 1;
  // An account, or an unlock link's cookie: either may compose.
  const canCompose = signedIn || unlocked;
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
  // Which finished turns have their work log open, and whether the arrival
  // settings are: shut, they are one line saying what is set, so the reply
  // keeps the room.
  const [openLogs, setOpenLogs] = useState<Set<number>>(new Set());
  const [arrivalOpen, setArrivalOpen] = useState(false);
  // The turn's changes, waiting to be auditioned or kept. Nothing is written to
  // the studio until one of those is pressed.
  const [review, setReview] = useState<Proposal | null>(null);
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
  const [trans, setTransState] = useState<TransitionPrefs>(TRANSITION_DEFAULT);
  // What `send` needs of things defined after it: the shape picked when the
  // turn LANDS (it may have been changed while it ran), and the bridge writer.
  const shapeRef = useRef<Shape>("cut");
  shapeRef.current = trans.shape;
  const writeBridgeRef = useRef<((target: unknown, into: number | null, onActivity?: (a: Step[]) => void) => Promise<void>) | null>(null);
  useEffect(() => setTransState(loadTransition()), []);
  const setTrans = useCallback((patch: Partial<TransitionPrefs>) => {
    setTransState((cur) => {
      const next = { ...cur, ...patch };
      try { window.localStorage.setItem(TRANSITION_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  // What the autosave did with the last thing kept, in the space the review bar
  // has just left. Transient: it belongs to that click, so the next turn (and a
  // song arriving, or `new`) clears it.
  const [saveNote, setSaveNote] = useState("");
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
  const openSong = useSyncExternalStore(subscribeOpenSong, getOpenSong, getOpenSong);
  const songId = openSong.id;
  const isTemplate = openSong.isTemplate;

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
    window.seqbaby?.cancelTransition?.();
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
  }, [songId, isTemplate]);

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
      window.seqbaby?.cancelTransition?.();
      setReview(null);
      setSaveNote("");
    };
    window.addEventListener("seqbaby:newset", onNew);
    return () => window.removeEventListener("seqbaby:newset", onNew);
  }, []);

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
  const send = useCallback(async (prompt?: string, modelOverride?: string) => {
    const text = (prompt ?? input).trim();
    if (!text || sending || !window.seqbaby) return;
    if (!canCompose) return;
    // A transition still waiting on its bar line lands now: the turn is about
    // what is playing, and an audition or keep the button already asked for.
    window.seqbaby.finishTransition?.();
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
        { message: sent, history, session, unnamed: toB ? freshB : !getOpenSong().id || getOpenSong().isTemplate, ...(canPickModel ? { model: modelOverride || model } : {}) },
        setLive,
      );
      if ("error" in out) {
        land({ role: "error", text: out.error });
        return;
      }
      const { job, activity } = out;
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
      if (job.session && job.changed !== false) {
        // With bridge picked, the bridge is written before the changes are
        // offered, so it is ready the moment they can be auditioned.
        if (!toB && shapeRef.current === "bridge" && writeBridgeRef.current) {
          const mark = { t: "writing the bridge", ok: true };
          setLive([...activity, mark]);
          await writeBridgeRef.current(job.session, null, (a) => setLive([...activity, mark, ...a])).catch(() => {});
        }
        setReview({ session: job.session, before: null, title: job.title ?? null, changes, ...(toB ? { deck: deckId, fresh: freshB } : {}) });
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
  }, [input, sending, messages, canCompose, canPickModel, model, deck]);

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

  // ---- the written bridge ---------------------------------------------------
  //
  // With `bridge` picked, a proposal's bridge is WRITTEN: a second turn, sent
  // the moment the proposal is on the bar, that is handed the engine's draft
  // (both songs' tracks, the new song's intro and the old song's parts cut
  // short, in free pattern slots) and asked to make a transition of it. It is
  // written ahead because it takes a model the better part of a minute and an
  // audition should not wait for one: pressed before it is back, the audition
  // plays the draft, and the written one takes over if it arrives in time.
  // Only its bridge patterns are ever used (bridgeSession). One per proposal
  // and target pattern, and only while bridge is the shape picked: it costs a
  // turn.
  const bridgeJob = useRef<BridgeJob | null>(null);
  const [bridgeState, setBridgeState] = useState<"" | "writing" | "ready" | "failed">("");
  // Resolves when the bridge is written (or could not be): a turn waits on
  // it before it offers its changes, so the bridge is there with the song.
  const writeBridge = useCallback(async (target: unknown, into: number | null, onActivity?: (a: Step[]) => void): Promise<void> => {
    const api = window.seqbaby;
    const b = api?.bridge;
    if (!api || !b || !canCompose) return;
    const cur = bridgeJob.current;
    if (cur && cur.for === target && cur.into === into) return;
    const old = api.serializeSet();
    const layout = b.layout(old, target, into != null ? { start: into } : {});
    if (!layout) { bridgeJob.current = null; setBridgeState(""); return; }
    const draft = b.draft(old, target, layout);
    const job: BridgeJob = { for: target, into, layout, status: "writing" };
    bridgeJob.current = job;
    setBridgeState("writing");
    const mine = () => bridgeJob.current === job;
    try {
      const out = await runTurn(
        { message: b.prompt(old, target, layout), history: [], session: draft, unnamed: false, ...(canPickModel ? { model } : {}) },
        onActivity,
        mine,
      );
      if (!mine()) return;
      const got = "job" in out ? out.job.session : null;
      if (!got || !b.hasNotes(b.session(draft, got, layout), layout)) {
        job.status = "failed";
        setBridgeState("failed");
        return;
      }
      job.result = got;
      job.status = "ready";
      setBridgeState("ready");
      // An audition already on its way with the draft takes the written one.
      try { b.set(b.session(draft, got, layout), layout); } catch {}
    } catch {
      if (!mine()) return;
      job.status = "failed";
      setBridgeState("failed");
    }
  }, [canCompose, canPickModel, model]);
  writeBridgeRef.current = writeBridge;
  // A turn writes its bridge before it offers its changes (`send`). This is
  // for what comes after: bridge picked once a proposal is already on the
  // bar, or another `into` chosen, each of which wants a bridge of its own.
  useEffect(() => {
    const r = review;
    const wants = !!r && !r.before && !r.pending && !r.deck && trans.shape === "bridge";
    if (!wants) {
      if (!r || r.deck || trans.shape !== "bridge") { bridgeJob.current = null; setBridgeState(""); }
      return;
    }
    void writeBridge(r.session, r.into ?? null);
  }, [review, trans.shape, writeBridge]);
  // The written bridge for a proposal, as transitionTo takes it: laid out
  // again against the song as it is NOW (it may have been edited, or moved to
  // another pattern, since the bridge was asked for) and used only when that
  // is still the layout it was written for.
  const writtenBridge = useCallback((r: Proposal) => {
    const api = window.seqbaby;
    const b = api?.bridge;
    const job = bridgeJob.current;
    if (!api || !b || !job || job.status !== "ready" || job.for !== r.session || job.into !== (r.into ?? null)) return {};
    try {
      const old = api.serializeSet();
      const layout = b.layout(old, r.session, job.into != null ? { start: job.into } : {});
      if (!layout || !b.same(layout, job.layout)) return {};
      return { bridge: { session: b.session(b.draft(old, r.session, layout), job.result, layout), layout } };
    } catch {
      return {};
    }
  }, []);

  // A session written on the transition the bar's picker says
  // (public/js/transition.js). Resolves whether it landed: false when another
  // button called it off first. Falls back to an immediate write on an engine
  // cached from before transitions shipped.
  const writeAt = useCallback(async (session: unknown, r?: Proposal, back = false): Promise<boolean> => {
    const api = window.seqbaby;
    if (!api) return false;
    if (!api.transitionTo) {
      writeLive(session);
      return true;
    }
    // Going BACK to what was playing is not a song with an intro to work
    // through: a bridge's stop is a cut on the bar.
    if (trans.shape === "bridge" && back) return (await api.transitionTo(session, { ...trans, shape: "cut", when: "bar" })).landed;
    const into = !back && r?.into != null ? { into: r.into } : {};
    return (await api.transitionTo(session, { ...trans, ...into, ...(trans.shape === "bridge" && r ? writtenBridge(r) : {}) })).landed;
  }, [trans, writeLive, writtenBridge]);

  // A deck B turn's session, written onto that deck in place (mix.js,
  // mergeDeckB): at once, with no transition, since a transition is the open
  // song's. False when the deck has gone (ejected, landed, a song opened).
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
    setReview(null);
    setSaveNote("that deck is no longer loaded, so those changes had nowhere to go");
  }, []);

  // Audition: keep what is playing so it can be put back, then merge the
  // turn's session over it. Nothing is saved and nothing is torn down.
  // `before` is taken at the press: what is playing then is what stop puts back.
  const audition = useCallback(async () => {
    const r = review;
    if (!r || r.before || r.pending || !window.seqbaby) return;
    if (r.deck) {
      // A new song for a new deck: loaded there, stopped, ready to bring in.
      if (r.fresh) {
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
      setReview({ ...r, before: was, pending: null, note: "" });
      return;
    }
    const before = window.seqbaby.serializeSet();
    setReview({ ...r, pending: "audition", note: "" });
    const landed = await writeAt(r.session, r);
    setReview((cur) => (cur && cur.session === r.session && cur.pending === "audition"
      ? { ...cur, before: landed ? before : null, pending: null }
      : cur));
  }, [review, writeAt, writeDeckB, deckGone]);

  // Stop: back to what was playing, with the changes still on offer. Anything
  // changed BY HAND during the audition goes back with it -- undo reaches it
  // (the merge lands on the stack like any other edit), which is why this is a
  // button and not a confirm dialog. Pressed while the audition is still on
  // its way, it calls the audition off instead.
  const stopAudition = useCallback(async () => {
    const r = review;
    if (!r) return;
    if (r.deck) {
      if (!r.before) return;
      if (!writeDeckB(r.before, r.deck)) return deckGone();
      setReview({ ...r, before: null });
      return;
    }
    if (r.pending === "audition") {
        window.seqbaby?.cancelTransition?.();
      setReview((cur) => (cur && cur.session === r.session ? { ...cur, pending: null } : cur));
      return;
    }
    if (!r.before || r.pending) return;
    setReview({ ...r, pending: "stop" });
    const landed = await writeAt(r.before, r, true);
    setReview((cur) => (cur && cur.session === r.session && cur.pending === "stop"
      ? { ...cur, before: landed ? null : cur.before, pending: null }
      : cur));
  }, [review, writeAt, writeDeckB, deckGone]);

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
  const autosaveKept = useCallback(async () => {
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
  // arrive on the transition, and are saved once they have. A second press
  // while one is on its way lands it at once.
  const keepChanges = useCallback(async () => {
    const r = review;
    const api = window.seqbaby;
    if (!r || !api) return;
    if (r.deck) {
      // Another deck is not the open song: nothing is saved from here. Its song is
      // kept for good by landing it, or by keeping both decks, and saving.
      if (r.fresh) return void audition();
      if (!r.before && !writeDeckB(r.session, r.deck)) return deckGone();
      setReview(null);
      setSaveNote(`kept on deck ${r.deck.toUpperCase()}. It is saved once that deck is the song (eject deck A) or you keep the decks as one song, then save`);
      return;
    }
    if (r.pending === "keep") {
      api.finishTransition?.();
      return;
    }
    // An audition on its way has not landed (`before` is still null); a stop
    // on its way leaves the audition playing. Either way it is called off.
    if (r.pending) {
        api.cancelTransition?.();
    }
    if (!r.before) {
      setReview({ ...r, pending: "keep", note: "" });
      const landed = await writeAt(r.session, r);
      if (!landed) {
        setReview((cur) => (cur && cur.session === r.session && cur.pending === "keep" ? { ...cur, pending: null } : cur));
        return;
      }
    }
    // After the write: an applySet fallback announces a new session, which
    // clears any name held for the last one.
    if (r.title) setComposedTitle(r.title);
    setReview((cur) => (cur && cur.session === r.session ? null : cur));
    void autosaveKept();
  }, [review, writeAt, autosaveKept, writeDeckB, deckGone, audition]);

  // Discard is never on a transition: throwing the changes away is immediate.
  const discardChanges = useCallback(() => {
    const r = review;
    if (!r) return;
    if (r.pending) window.seqbaby?.cancelTransition?.();
    // `before` set means the changes are playing (a stop on its way included).
    if (r.before && r.deck) writeDeckB(r.before, r.deck);
    else if (r.before) writeLive(r.before);
    setReview(null);
    setSaveNote("");
  }, [review, writeLive, writeDeckB]);

  // The genre tab (GroovePicker.tsx) starts a turn from a genre: its brief
  // goes in the box and is sent as an ordinary turn, so it lands in the
  // review bar like any other and stays in the box if the turn cannot run.
  const buildGroove = useCallback(
    (prompt: string) => {
      setTab("chat");
      setInput(prompt);
      send(prompt);
    },
    [send],
  );

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

  const slots = review && !review.before ? filledSlots(review.session) : [];
  // The arrival settings are the open song's: a turn on another deck lands at once.
  const forB = review ? !!review.deck : deck !== "a";
  const DK = review?.deck && !review.fresh ? `deck ${review.deck.toUpperCase()}` : "the deck";
  const arrivalShown = arrivalOpen;
  const bridgeNote =
    bridgeState === "writing" ? "being written…" : bridgeState === "ready" ? "written" : bridgeState === "failed" ? "a draft (the written one failed)" : "";
  const arrivalSummary = [
    trans.shape === "cut"
      ? trans.when === "now" ? "straight in, now" : "straight in, on the next bar"
      : trans.shape === "bridge"
      ? `over a bridge${bridgeNote ? `, ${bridgeNote}` : ", written with the turn"}`
      : `a ${trans.bars}-bar ${trans.shape}, ${trans.when === "now" ? "from now" : "from the next bar"}`,
    ...(trans.tempo !== "auto" && trans.shape !== "cut" && trans.shape !== "stagger" ? [`tempo ${trans.tempo}s`] : []),
    ...(review?.into != null ? [`into pattern ${review.into + 1}`] : []),
  ].join(" · ");
  const arrival = forB ? (
    <div className={styles.cxArrivalNote}>another deck takes its changes at once: transitions are the open song&apos;s.</div>
  ) : (
    <div className={styles.cxArrival}>
      <button
        type="button"
        className={styles.cxArrivalSum}
        aria-expanded={arrivalShown}
        onClick={() => setArrivalOpen(!arrivalShown)}
        title="how a turn's changes arrive in what is playing: set before sending, or while reviewing"
      >
        <span className={styles.cxSegLabel}>arrives</span>
        <span className={styles.cxArrivalText}>{arrivalSummary}</span>
        <span aria-hidden>{arrivalShown ? "▴" : "▾"}</span>
      </button>
      {arrivalShown && (
        <div className={styles.cxArrivalBody}>
          <Seg
            label="shape"
            value={trans.shape}
            options={SHAPES.map((k) => ({ v: k, label: k, title: SHAPE_TIPS[k] }))}
            onPick={(v) => setTrans({ shape: v })}
          />
          <div className={styles.cxTip}>{SHAPE_TIPS[trans.shape]}.</div>
          <Seg
            label="when"
            value={trans.when}
            disabled={trans.shape === "bridge"}
            title="next bar: wait for the downbeat. now: as soon as possible. A bridge starts on the next bar"
            options={[{ v: "bar", label: "next bar" }, { v: "now", label: "now" }]}
            onPick={(v) => setTrans({ when: v })}
          />
          {trans.shape === "bridge" ? (
            <div
              className={styles.cxTip}
              title="the compose model writes the bridge as part of the turn, so it is ready with the changes; picked afterwards it is written then, and until it is back audition plays a draft made in code"
            >
              a bridge is as long as the new song&apos;s intro{bridgeNote ? `: ${bridgeNote}` : ""}. writing one costs a second turn.
            </div>
          ) : (
            <Seg
              label="over"
              value={trans.bars}
              disabled={trans.shape === "cut"}
              title="how many bars the transition runs: how long the songs overlap on a sweep or fade, how long a drop thins or a stagger arrives"
              options={[1, 2, 4, 8].map((b) => ({ v: b, label: `${b} bar${b > 1 ? "s" : ""}` }))}
              onPick={(v) => setTrans({ bars: v })}
            />
          )}
          <Seg
            label="tempo"
            value={trans.tempo}
            disabled={trans.shape === "cut" || trans.shape === "stagger"}
            title="when the bpm differs. auto: ramp a small change across the length (a bridge: across the bridge), jump a big one. cut and stagger jump"
            options={[{ v: "auto", label: "auto" }, { v: "jump", label: "jump" }, { v: "ramp", label: "ramp" }]}
            onPick={(v) => setTrans({ tempo: v })}
          />
          {review && slots.length > 0 && (
            <label
              className={styles.cxSeg}
              title={trans.shape === "bridge"
                ? "the new song's pattern its intro starts on: the bridge stands in for the intro from there, and the song carries on after it"
                : "the new song's pattern it lands on. as is: whatever pattern is playing"}
            >
              <span className={styles.cxSegLabel}>into</span>
              <select
                className={styles.chatModelSelect}
                value={review.into ?? ""}
                disabled={!!review.pending}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setReview((cur) => (cur ? { ...cur, into: v } : cur));
                }}
              >
                <option value="">{trans.shape === "bridge" ? "its start" : "the pattern playing"}</option>
                {slots.map((k) => (
                  <option key={k} value={k}>pattern {k + 1}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );

  const reviewTitle = !review
    ? ""
    : review.pending
    ? `${review.pending === "stop" ? "going back" : review.pending === "keep" ? "keeping" : "auditioning"} ${
        review.pending === "stop" && trans.shape === "bridge"
          ? "on the next bar"
          : trans.shape === "cut"
          ? trans.when === "now" ? "now" : "on the next bar"
          : trans.shape === "bridge"
          ? `over a ${bridgeState === "ready" ? "written" : "drafted"} bridge`
          : `with a ${trans.bars}-bar ${trans.shape}`
      }…`
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
          {tab === "genre" && <GroovePicker onBuild={buildGroove} busy={sending || composeOff} />}
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
                    {live.length === 0 ? "reading the song" : live[live.length - 1].t === "writing the bridge" || bridgeState === "writing" ? "writing the bridge" : "writing"}
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
                  onClick={review.before || review.pending === "audition" ? stopAudition : audition}
                  disabled={review.pending === "stop" || review.pending === "keep"}
                  title={review.pending === "audition"
                    ? "call the audition off before it lands"
                    : review.before
                    ? "put back what was playing before the audition"
                    : "hear them in what is playing, without stopping the transport"}
                >
                  {review.fresh ? "load to a deck" : review.before || review.pending === "audition" ? "■ stop" : "▶ audition"}
                </button>
                {!review.fresh && <button
                  className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                  onClick={keepChanges}
                  title={review.deck ? "leave them on the deck (saved once it is the song, or the decks are kept as one)" : review.pending === "keep" ? "land it now" :
                    signedIn && songId && !isTemplate
                      ? "make them part of the song, and save it as a new version"
                      : "make them part of the song"
                  }
                >
                  {review.pending === "keep" ? "keep now" : signedIn && songId && !isTemplate && !review.deck ? "keep + save" : "keep"}
                </button>}
                <button className={`${styles.smallBtn} ${styles.cxDiscard}`} onClick={discardChanges} title="throw them away">
                  discard
                </button>
              </div>
              {!review.fresh && tab === "chat" && arrival}
            </section>
          )}
          <div className={styles.cxComposer} hidden={tab !== "chat"}>
            {!review && arrival}
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
                disabled={sending || !input.trim() || composeOff}
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
