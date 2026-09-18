"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/app/ui.module.css";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; activity?: string[]; warnings?: string[] }
  | { role: "error"; text: string };

type ComposeResponse = { jobId?: string; error?: string };

type JobStatus = {
  status?: "running" | "done" | "error";
  events?: { type: string; summary?: string }[];
  reply?: string;
  session?: unknown;
  warnings?: string[];
  error?: string;
};

// How long to keep polling before giving up on a worker that has gone quiet.
// The worker's own ceiling is 15 minutes, so this sits just past it rather
// than cutting off a song that is still being written.
const POLL_INTERVAL_MS = 1500;
const POLL_LIMIT_MS = 16 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What to say when the response wasn't the route's own JSON. */
function describeFailure(status: number, raw: string, data: ComposeResponse | null): string {
  if (data?.error) return data.error;
  // 502/504 with an HTML body is the hosting layer, not the route: nothing
  // the route says ever gets this far, so the status is all there is to go on.
  if (status === 504 || status === 408) {
    return `that took too long and the server cut it off (${status}). A big request can run past the hosting timeout — try asking for one change at a time.`;
  }
  if (status === 502 || status === 503) {
    return `the server couldn't complete the request (${status}) — it may have run too long or run out of memory.`;
  }
  const snippet = raw.trim().slice(0, 160);
  if (snippet.startsWith("<")) return `the server returned a ${status} page instead of a reply.`;
  return snippet || `the server returned ${status} with an empty reply.`;
}

// A chat panel that edits the song open in the studio, backed by
// app/api/compose (the same songBuilder tools the MCP server exposes to an
// external agent, run server-side against the account's Anthropic key).
//
// Session state is deliberately NOT kept here across page loads -- the
// studio's own session is the source of truth (serializeSet/applySet), and
// the chat is just a way of driving it. Each message resends the studio's
// current session, so a change made by hand between messages is what the
// next request edits, and a reload losing the chat transcript costs nothing
// the session itself didn't already hold.
export default function ComposeChat() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Tool activity for the turn in flight, streamed in as it happens. It
  // moves onto the finished message when the turn lands.
  const [live, setLive] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !window.seqbaby) return;
    const session = window.seqbaby.serializeSet();
    // Only plain text crosses the wire between turns -- what the model called
    // and why lives entirely inside one request/response, so the transcript
    // this resends stays small how ever many tool calls a turn took.
    const history = messages
      .filter((m): m is Extract<Msg, { role: "user" | "assistant" }> => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setSending(true);
    setLive([]);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history, session }),
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
        setMessages((prev) => [...prev, { role: "error", text: describeFailure(res.status, raw, data) }]);
        return;
      }

      const started = (await res.json()) as ComposeResponse;
      if (!started.jobId) {
        setMessages((prev) => [...prev, { role: "error", text: started.error ?? "couldn't start that" }]);
        return;
      }

      // The turn is running somewhere nothing is waiting on, so from here it
      // is polled rather than awaited -- which is what lets it take the
      // minutes a whole song takes.
      const activity: string[] = [];
      const until = Date.now() + POLL_LIMIT_MS;
      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        if (Date.now() > until) {
          setMessages((prev) => [
            ...prev,
            { role: "error", text: "gave up waiting on that one — it may still be running." },
          ]);
          return;
        }

        const pollRes = await fetch(`/api/compose/status?id=${encodeURIComponent(started.jobId)}`);
        if (!pollRes.ok) {
          // A poll that fails is not the job failing: a blip shouldn't throw
          // away a song that is still being written, so keep asking.
          continue;
        }
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
          if (job.session) window.seqbaby?.applySet(job.session);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: job.reply || "Done.", activity: [...activity], warnings: job.warnings },
          ]);
          return;
        }
        if (job.status === "error") {
          setMessages((prev) => [...prev, { role: "error", text: job.error ?? "that didn't work" }]);
          return;
        }
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "error", text: `couldn't reach compose chat: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
      setLive([]);
    }
  }, [input, sending, messages]);

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
      <button className={styles.accountBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        compose
      </button>
      {open && (
        <div className={styles.chatBackdrop} onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div className={`${styles.panel} ${styles.chatPanel}`}>
          <div className={styles.panelTitle}>ask for changes to this song</div>
          <div className={styles.chatLog} ref={logRef}>
            {messages.length === 0 && (
              <div className={styles.chatEmpty}>
                Tell it what to make or change — “add a dubby bassline on the
                silverbox”, “make the hats swing more”, “put a reverb on the
                bus”. It edits the song that&apos;s open, live.
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
                {m.role === "assistant" && m.activity && m.activity.length > 0 && (
                  <div className={styles.chatActivity}>{m.activity.join(" · ")}</div>
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
          <div className={styles.chatRow}>
            <textarea
              className={styles.chatTextarea}
              rows={1}
              placeholder="make me a techno beat…"
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={send}
              disabled={sending || !input.trim()}
            >
              send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
