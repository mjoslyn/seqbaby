"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/app/ui.module.css";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; activity?: string[]; warnings?: string[] }
  | { role: "error"; text: string };

type ComposeResponse = {
  reply?: string;
  session?: unknown;
  log?: { summary: string }[];
  warnings?: string[];
  error?: string;
};

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
  }, [messages, sending]);

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
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history, session }),
      });
      // Read as text and parse by hand. A failure that never reached the
      // route -- a gateway timing the request out, a 502 -- answers with an
      // HTML page, and res.json() on that throws a SyntaxError about an
      // unexpected "<", which is a report about the parser rather than about
      // what went wrong. The status is the useful part.
      const raw = await res.text();
      let data: ComposeResponse | null = null;
      try {
        data = raw ? (JSON.parse(raw) as ComposeResponse) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data) {
        setMessages((prev) => [...prev, { role: "error", text: describeFailure(res.status, raw, data) }]);
        return;
      }
      if (data.session) window.seqbaby?.applySet(data.session);
      const activity: string[] = Array.isArray(data.log) ? data.log.map((l: { summary: string }) => l.summary) : [];
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply || "Done.", activity, warnings: data.warnings },
      ]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "error", text: `couldn't reach compose chat: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
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
            {sending && <div className={styles.chatActivity}>working…</div>}
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
