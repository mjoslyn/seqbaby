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
import { COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL } from "@/lib/composeModels.js";
import { MODEL_EVENT, readModelPref, writeModelPref } from "@/app/composeModelPref";
import styles from "@/app/ui.module.css";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; model?: string; activity?: string[]; warnings?: string[] }
  | { role: "error"; text: string };

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
  /** A bridge is being written for this proposal, and what went wrong writing one. */
  writing?: boolean;
  note?: string;
};
type Bridge = { session: unknown; slot: number; start: number; bars: number };

type Shape = "cut" | "sweep" | "drop" | "fade" | "stagger" | "bridge";
const SHAPES: Shape[] = ["cut", "sweep", "drop", "fade", "stagger", "bridge"];
const SHAPE_TIPS: Record<Shape, string> = {
  cut: "straight in, on the bar",
  sweep: "both songs play for the length: the new one from the start, the old one swept down and gone at the end",
  drop: "the playing song thins (harmony and lead, then bass, then drums), a near-silent last bar, then the hit",
  fade: "both songs play for the length: the old one fades out as the new one fades in",
  stagger: "the new song arrives a group at a time: drums, bass, harmony, lead",
  bridge: "the model writes a bridge exactly that long, which plays before the new song",
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
  events?: { type: string; summary?: string }[];
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

/** Whether the studio holds a song with notes in it: something to bridge from. */
function studioHasNotes(): boolean {
  try {
    const s = window.seqbaby?.serializeSet() as { tracks?: { patterns?: ({ steps?: unknown[] } | null)[] }[] } | undefined;
    return !!s?.tracks?.some((t) => t.patterns?.some((p) => p?.steps?.some(Boolean)));
  } catch {
    return false;
  }
}

/** What to say when the response wasn't the route's own JSON. */
// One compose turn run to the end with no transcript of its own: the bridge's.
// The song that comes back, or why there is none.
async function runTurn(message: string, session: unknown, model?: string): Promise<{ session?: unknown; error?: string }> {
  try {
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, history: [], session, unnamed: false, ...(model ? { model } : {}) }),
    });
    const raw = await res.text();
    let started: ComposeResponse | null = null;
    try { started = raw ? (JSON.parse(raw) as ComposeResponse) : null; } catch { started = null; }
    if (!res.ok || !started?.jobId) return { error: res.ok ? started?.error ?? "couldn't start that" : describeFailure(res.status, raw, started) };
    const until = Date.now() + POLL_LIMIT_MS;
    let misses = 0;
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      if (Date.now() > until) return { error: "gave up waiting on it" };
      const q = new URLSearchParams({ id: started.jobId });
      if (started.jobToken) q.set("t", started.jobToken);
      let poll: Response;
      try { poll = await fetch(`/api/compose/status?${q}`); } catch { if (++misses > MAX_POLL_MISSES) return { error: "lost contact with the server" }; continue; }
      if (poll.status === 401 || poll.status === 404) return { error: poll.status === 401 ? "signed out" : "the job is gone" };
      if (!poll.ok) { if (++misses > MAX_POLL_MISSES) return { error: `the server kept failing (${poll.status})` }; continue; }
      misses = 0;
      const job = (await poll.json()) as JobStatus;
      if (job.status === "done") return job.session ? { session: job.session } : { error: job.reply || "it wrote nothing" };
      if (job.status === "error") return { error: job.error ?? "that didn't work" };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

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
 *        needs one: signed out, the button goes to sign up.
 * @param serverKey whether this deploy has an Anthropic key, which every
 *        turn runs on. Without one compose is switched off.
 * @param budgetOut whether that key has run out of budget, as the server
 *        knew it when the page was drawn.
 */
export default function ComposeChat({
  signedIn,
  serverKey,
  budgetOut,
  canPickModel = false,
  defaultModel = DEFAULT_COMPOSE_MODEL,
}: {
  signedIn: boolean;
  serverKey: boolean;
  budgetOut: boolean;
  /** This account is on the deploy's COMPOSE_MODEL_PICKERS: show a model menu.
   *  The route checks the same list, so the menu is only ever a request. */
  canPickModel?: boolean;
  /** The deploy's own model, what the menu starts on. */
  defaultModel?: string;
}) {
  // The picked model, remembered per browser. Only sent when the account may
  // pick; anything the route does not allow runs on the deploy's model.
  const [model, setModel] = useState(defaultModel);
  useEffect(() => {
    if (!canPickModel) return;
    setModel(readModelPref(defaultModel));
    // A pick made anywhere else on the page is a pick here too.
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<{ model?: string }>).detail?.model;
      if (id) setModel(id);
    };
    window.addEventListener(MODEL_EVENT, onPick);
    return () => window.removeEventListener(MODEL_EVENT, onPick);
  }, [canPickModel, defaultModel]);
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
  const [live, setLive] = useState<string[]>([]);
  // The turn's changes, waiting to be auditioned or kept. Nothing is written to
  // the studio until one of those is pressed.
  const [review, setReview] = useState<Proposal | null>(null);
  const [trans, setTransState] = useState<TransitionPrefs>(TRANSITION_DEFAULT);
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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending, live]);

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
    if (!signedIn) return;
    // A transition still waiting on its bar line lands now: the turn is about
    // what is playing, and an audition or keep the button already asked for.
    bridgeRun.current++;
    window.seqbaby.finishTransition?.();
    const session = window.seqbaby.serializeSet();
    // Only plain text crosses the wire between turns -- what the model called
    // and why lives entirely inside one request/response, so the transcript
    // this resends stays small how ever many tool calls a turn took.
    const history = messages
      .filter((m): m is Extract<Msg, { role: "user" | "assistant" }> => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.text }));

    // The transcript is tracked as a value as well as in state, because the
    // turn that ends this one has to be PERSISTED, and setMessages callbacks
    // can't hand anything back to do that with.
    const withUser: Msg[] = [...messages, { role: "user", text }];
    setMessages(withUser);
    setInput("");
    setSending(true);
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
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A song never saved (or a template, whose first save makes a new
        // song) has no name of its own: the turn is asked to give it one.
        body: JSON.stringify({ message: text, history, session, unnamed: !getOpenSong().id || getOpenSong().isTemplate, ...(canPickModel ? { model: modelOverride || model } : {}) }),
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
        land({ role: "error", text: describeFailure(res.status, raw, data) });
        return;
      }

      const started = (await res.json()) as ComposeResponse;
      if (!started.jobId) {
        land({ role: "error", text: started.error ?? "couldn't start that" });
        return;
      }

      // The turn is running somewhere nothing is waiting on, so from here it
      // is polled rather than awaited -- which is what lets it take the
      // minutes a whole song takes.
      const activity: string[] = [];
      const until = Date.now() + POLL_LIMIT_MS;
      let misses = 0;
      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        if (Date.now() > until) {
          land({ role: "error", text: "gave up waiting on that one; it may still be running." });
          return;
        }

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
          // still does server-side, but a turn on a brought key has no
          // account behind it at all.
          const q = new URLSearchParams({ id: started.jobId });
          if (started.jobToken) q.set("t", started.jobToken);
          pollRes = await fetch(`/api/compose/status?${q}`);
        } catch {
          if (++misses > MAX_POLL_MISSES) {
            land({ role: "error", text: "lost contact with the server while that was running." });
            return;
          }
          continue;
        }
        if (pollRes.status === 401) {
          land({ role: "error", text: "signed out while that was running; sign in and the song may still be there." });
          return;
        }
        if (pollRes.status === 404) {
          land({ role: "error", text: "that job is no longer on the server." });
          return;
        }
        if (!pollRes.ok) {
          // Anything else (a 5xx, a rate limit) might pass, but not forever.
          if (++misses > MAX_POLL_MISSES) {
            land({ role: "error", text: `the server kept failing to report on that (${pollRes.status}).` });
            return;
          }
          continue;
        }
        misses = 0;
        const job = (await pollRes.json()) as JobStatus;

        const summaries = (job.events ?? [])
          .filter((e) => e.type === "tool" && e.summary)
          .map((e) => e.summary!);
        if (summaries.length !== activity.length) {
          activity.length = 0;
          activity.push(...summaries);
          setLive([...activity]);
        }

        if (job.status === "done") {
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
          if (job.session && job.changed !== false) setReview({ session: job.session, before: null, title: job.title ?? null });
          // A name with nothing to review (the turn only named the song) is
          // the song's at once; otherwise it comes with the changes, on keep.
          else if (job.title) setComposedTitle(job.title);
          land({
            role: "assistant",
            text: job.reply || "Done.",
            // What it actually ran on, as the worker reported it.
            model: job.model,
            activity: [...activity],
            warnings: job.warnings,
          });
          return;
        }
        if (job.status === "error") {
          land({ role: "error", text: job.error ?? "that didn't work" });
          return;
        }
      }
    } catch (e) {
      land({ role: "error", text: `couldn't reach compose chat: ${(e as Error).message}` });
    } finally {
      setSending(false);
      setLive([]);
    }
  }, [input, sending, messages, signedIn, canPickModel, model]);

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

  // A session written on the transition the bar's picker says
  // (public/js/transition.js). Resolves whether it landed: false when another
  // button called it off first. Falls back to an immediate write on an engine
  // cached from before transitions shipped.
  //
  // A bridge is written by a turn of its own (`runTurn`), and it is started
  // AHEAD: as soon as a proposal arrives with bridge picked (and again when the
  // length changes), so that by the time audition or keep is pressed it is
  // usually written and the transition only waits for the bar line. The jobs
  // are held per proposal and per length (`bridgeJobs`), so a press awaits the
  // one already running rather than starting another, and a failed one is
  // dropped so the press tries again. Going BACK to what was playing (stop) has
  // no bridge to play: it is a cut on the bar. `bridgeRun` is how a button
  // pressed while a press is waiting on a bridge calls it off: the bridge is
  // still kept for the next press, but that press does not go on to land it.
  const bridgeRun = useRef(0);
  const bridgeJobs = useRef<{ session: unknown; jobs: Map<number, Promise<Bridge | string>>; running: Set<number> }>({
    session: null, jobs: new Map(), running: new Set(),
  });
  const startBridge = useCallback((r: Proposal, bars: number): Promise<Bridge | string> => {
    const api = window.seqbaby;
    if (!api?.bridge) return Promise.resolve("this studio can't play a bridge");
    const reg = bridgeJobs.current;
    if (reg.session !== r.session) {
      reg.session = r.session;
      reg.jobs = new Map();
      reg.running = new Set();
    }
    const have = reg.jobs.get(bars);
    if (have) return have;
    const newS = r.session as { activePattern?: number };
    const slot = api.bridge.freeSlot(newS);
    if (slot < 0) return Promise.resolve("every pattern slot is in use");
    const start = newS.activePattern ?? 0;
    const prompt = api.bridge.bridgePrompt(api.serializeSet(), newS, slot, bars, start);
    const mark = (patch: Partial<Proposal>) =>
      setReview((cur) => (cur && cur.session === r.session ? { ...cur, ...patch } : cur));
    const job = (async (): Promise<Bridge | string> => {
      const got = await runTurn(prompt, newS, canPickModel ? model : undefined);
      if (!got.session) return got.error ?? "nothing came back";
      const bs = api.bridge!.bridgeSession(newS, got.session, slot);
      if (!api.bridge!.bridgeHasNotes(bs, slot)) return "it came back empty";
      return { session: bs, slot, start, bars };
    })();
    reg.jobs.set(bars, job);
    reg.running.add(bars);
    mark({ writing: true, note: "" });
    void job.then((res) => {
      if (reg.session !== r.session) return;
      reg.running.delete(bars);
      if (typeof res === "string" && reg.jobs.get(bars) === job) reg.jobs.delete(bars);
      mark({ writing: reg.running.size > 0, ...(typeof res === "string" ? { note: `no bridge: ${res}` } : {}) });
    });
    return job;
  }, [canPickModel, model]);

  const writeAt = useCallback(async (session: unknown, r?: Proposal, back = false): Promise<boolean> => {
    const api = window.seqbaby;
    if (!api) return false;
    if (!api.transitionTo) {
      writeLive(session);
      return true;
    }
    if (trans.shape !== "bridge" || !api.bridge) {
      return (await api.transitionTo(session, trans)).landed;
    }
    if (back || !r) return (await api.transitionTo(session, { ...trans, shape: "cut", when: "bar" })).landed;
    const run = ++bridgeRun.current;
    const br = await startBridge(r, trans.bars);
    if (run !== bridgeRun.current) return false;
    if (typeof br === "string") {
      setReview((cur) => (cur && cur.session === r.session ? { ...cur, note: `no bridge: ${br}` } : cur));
      return false;
    }
    return (await api.transitionTo(session, { ...trans, bridge: { session: br.session, slot: br.slot, start: br.start } })).landed;
  }, [trans, writeLive, startBridge]);

  // The bridge for the proposal on offer, started before anyone asks for it:
  // always when there is a song in the studio to bridge from (notes in it),
  // whatever shape is picked, so picking bridge later never waits on one; and
  // with bridge picked even when there is not. Only while the changes are not
  // playing yet: mid-audition keep writes nothing and stop is a cut, so
  // neither plays a bridge.
  useEffect(() => {
    if (!review || review.before) return;
    if (trans.shape !== "bridge" && !studioHasNotes()) return;
    void startBridge(review, trans.bars);
  }, [review, trans.shape, trans.bars, startBridge]);

  // Audition: keep what is playing so it can be put back, then merge the
  // turn's session over it. Nothing is saved and nothing is torn down.
  // `before` is taken at the press: what is playing then is what stop puts back.
  const audition = useCallback(async () => {
    const r = review;
    if (!r || r.before || r.pending || !window.seqbaby) return;
    const before = window.seqbaby.serializeSet();
    setReview({ ...r, pending: "audition", note: "" });
    const landed = await writeAt(r.session, r);
    setReview((cur) => (cur && cur.session === r.session && cur.pending === "audition"
      ? { ...cur, before: landed ? before : null, pending: null }
      : cur));
  }, [review, writeAt]);

  // Stop: back to what was playing, with the changes still on offer. Anything
  // changed BY HAND during the audition goes back with it -- undo reaches it
  // (the merge lands on the stack like any other edit), which is why this is a
  // button and not a confirm dialog. Pressed while the audition is still on
  // its way, it calls the audition off instead.
  const stopAudition = useCallback(async () => {
    const r = review;
    if (!r) return;
    if (r.pending === "audition") {
      bridgeRun.current++;
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
  }, [review, writeAt]);

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
    if (r.pending === "keep") {
      api.finishTransition?.();
      return;
    }
    // An audition on its way has not landed (`before` is still null); a stop
    // on its way leaves the audition playing. Either way it is called off.
    if (r.pending) {
      bridgeRun.current++;
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
  }, [review, writeAt, autosaveKept]);

  // Discard is never on a transition: throwing the changes away is immediate.
  const discardChanges = useCallback(() => {
    const r = review;
    if (!r) return;
    bridgeRun.current++;
    if (r.pending) window.seqbaby?.cancelTransition?.();
    // `before` set means the changes are playing (a stop on its way included).
    if (r.before) writeLive(r.before);
    setReview(null);
    setSaveNote("");
  }, [review, writeLive]);

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
          if (!signedIn) {
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
          : signedIn
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
          <div className={styles.panelHead}>
            <div className={styles.chatTabs} role="tablist" aria-label="compose">
              <button
                role="tab"
                aria-selected={tab === "chat"}
                className={`${styles.grooveChip} ${tab === "chat" ? styles.grooveChipOn : ""}`}
                onClick={() => setTab("chat")}
                title="ask for changes to this song, in words"
              >
                ask
              </button>
              <button
                role="tab"
                aria-selected={tab === "genre"}
                className={`${styles.grooveChip} ${tab === "genre" ? styles.grooveChipOn : ""}`}
                onClick={() => setTab("genre")}
                title="pick a genre and it writes a whole song in it"
              >
                genre
              </button>
            </div>
            <button className={styles.panelClose} onClick={() => setOpen(false)} aria-label="close" title="close">
              ×
            </button>
          </div>
          {canPickModel && (
            <label className={styles.chatModelRow}>
              <span className={styles.chatModelLabel}>model</span>
              <select
                className={styles.chatModelSelect}
                value={model}
                onChange={(e) => pickModel(e.target.value)}
                disabled={sending}
              >
                {COMPOSE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tab === "genre" && <GroovePicker onBuild={buildGroove} busy={sending || composeOff} />}
          <div className={styles.chatLog} ref={logRef} hidden={tab !== "chat"}>
            {messages.length === 0 && (
              <div className={styles.chatEmpty}>
                say what you want and it works on the song that&apos;s open:
                “add a dubby bassline on the silverbox”, “make the hats swing
                more”, “put a reverb on the bus”. changes wait for you to
                audition or keep them, so nothing is lost until you say so.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div
                  className={`${styles.chatMsg} ${
                    m.role === "user"
                      ? styles.chatMsgUser
                      : m.role === "error"
                        ? styles.chatMsgError
                        : styles.chatMsgAssistant
                  }`}
                >
                  {m.text}
                </div>
                {m.role === "assistant" && (m.model || (m.activity && m.activity.length > 0)) && (
                  <div className={styles.chatActivity}>
                    {[...(m.model ? [composeModelLabel(m.model)] : []), ...(m.activity ?? [])].join(" · ")}
                  </div>
                )}
                {m.role === "assistant" && m.warnings && m.warnings.length > 0 && (
                  <div className={styles.chatWarn}>{m.warnings.join(" · ")}</div>
                )}
              </div>
            ))}
            {sending && (
              <div className={styles.chatActivity}>
                {live.length > 0 ? `${live.join(" · ")} …` : "working…"}
              </div>
            )}
          </div>
          {!review && saveNote && <div className={styles.chatActivity}>{saveNote}</div>}
          {review && (
            <div className={`${styles.chatReview} ${review.before ? styles.chatReviewLive : ""}`}>
              <div className={styles.chatReviewText}>
                {review.writing && review.pending && review.pending !== "stop"
                  ? `writing a ${trans.bars}-bar bridge into it…`
                  : review.pending
                  ? `${review.pending === "stop" ? "going back" : review.pending === "keep" ? "keeping" : "auditioning"} ${
                      review.pending === "stop" && trans.shape === "bridge"
                        ? "on the next bar"
                        : trans.shape === "cut"
                        ? trans.when === "now" ? "now" : "on the next bar"
                        : `with a ${trans.bars}-bar ${trans.shape}`
                    }…`
                  : review.note
                  ? review.note
                  : review.writing
                  ? `writing a ${trans.bars}-bar bridge so it's ready when you press audition or keep…`
                  : review.before
                  ? "auditioning: you are hearing the changes, but the song does not have them yet."
                  : "these changes aren't in the song yet. audition drops them into what's playing; keep makes them the song."}
              </div>
              <div className={styles.chatReviewBtns}>
                <button
                  className={styles.smallBtn}
                  onClick={review.before || review.pending === "audition" ? stopAudition : audition}
                  disabled={review.pending === "stop" || review.pending === "keep"}
                  title={review.pending === "audition"
                    ? "call the audition off before it lands"
                    : review.before
                    ? "put back what was playing before the audition"
                    : "hear them in what is playing, without stopping the transport"}
                >
                  {review.before || review.pending === "audition" ? "stop" : "audition"}
                </button>
                <button
                  className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                  onClick={keepChanges}
                  title={review.pending === "keep" ? "land it now" : 
                    signedIn && songId && !isTemplate
                      ? "make them part of the song, and save it as a new version"
                      : "make them part of the song"
                  }
                >
                  keep
                </button>
                <button className={styles.smallBtn} onClick={discardChanges} title="throw them away">
                  discard
                </button>
              </div>
            </div>
          )}
          <div className={styles.chatTransition} title="how a turn's changes arrive in what is playing: picked before sending, or in review">
            <select
              className={styles.chatModelSelect}
              value={trans.when}
              onChange={(e) => setTrans({ when: e.target.value as TransitionPrefs["when"] })}
              aria-label="when"
              title="next bar: wait for the downbeat. now: as soon as possible"
            >
              <option value="bar">next bar</option>
              <option value="now">now</option>
            </select>
            <select
              className={styles.chatModelSelect}
              value={trans.shape}
              onChange={(e) => setTrans({ shape: e.target.value as TransitionPrefs["shape"] })}
              aria-label="shape"
              title={SHAPES.map((k) => `${k}: ${SHAPE_TIPS[k]}`).join("\n")}
            >
              {SHAPES.map((k) => (
                <option key={k} value={k} title={SHAPE_TIPS[k]}>{k}</option>
              ))}
            </select>
            <select
              className={styles.chatModelSelect}
              value={trans.bars}
                  onChange={(e) => setTrans({ bars: Number(e.target.value) })}
              aria-label="length"
              title="how many bars the transition runs: how long the songs overlap on a sweep or fade, and how long a bridge is. A bridge is written in the background as soon as a turn's changes arrive, at this length, whatever shape is picked"
            >
              {[1, 2, 4, 8].map((b) => (
                <option key={b} value={b}>{b} bar{b > 1 ? "s" : ""}</option>
              ))}
            </select>
            <select
              className={styles.chatModelSelect}
              value={trans.tempo}
              disabled={trans.shape === "cut" || trans.shape === "stagger" || trans.shape === "bridge"}
              onChange={(e) => setTrans({ tempo: e.target.value as TransitionPrefs["tempo"] })}
              aria-label="tempo"
              title="when the bpm differs. auto: ramp a small change across the length, jump a big one. cut, stagger and bridge jump"
            >
              <option value="auto">tempo: auto</option>
              <option value="jump">tempo: jump</option>
              <option value="ramp">tempo: ramp</option>
            </select>
          </div>
          <div className={styles.chatRow} hidden={tab !== "chat"}>
            <textarea
              ref={inputRef}
              className={styles.chatTextarea}
              rows={2}
              placeholder="make me a techno beat…  (shift+enter for a new line)"
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={() => send()}
              disabled={sending || !input.trim() || composeOff}
            >
              {sending ? "working…" : "send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
