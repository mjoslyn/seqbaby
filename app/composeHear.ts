"use client";

import { measureInFrame } from "@/app/enginePlayer";

// The compose panel's ears. A turn runs where there is no audio, so before it
// finishes it asks the browser that started it to play its song back: the
// song is loaded into a hidden studio (the homepage player's frame), played
// with the output disconnected, and every track's meter is read per section
// (public/js/measure.js). The numbers go back to the turn, which is told what
// was silent or out of balance (mcp/hearing.mjs) and gets one go at fixing it.
//
// Nothing is heard by the person, and the studio they are working in is not
// touched: a second engine does the playing.

/**
 * Whether this browser should be asked to listen at all. Not on a phone or
 * on a metered connection: it means booting a second engine beside the one
 * in use.
 */
export function canHear(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /(^|-)[23]g$/.test(conn?.effectiveType ?? "")) return false;
    if (window.matchMedia("(pointer: coarse), (max-width: 768px)").matches) return false;
    return typeof window.AudioContext !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Answer a job's request to be heard: fetch the song it is asking about,
 * measure it, post the report. Always posts something, a null report
 * included, so the turn is not left waiting out its clock. Never throws.
 */
export async function hearForJob(jobId: string, token: string | undefined, seq: number): Promise<void> {
  let report: unknown = null;
  const studio = window.seqbaby;
  // The hidden engine builds the song on this main thread. If the studio is
  // playing, give its scheduler room until that is done (lookahead.js).
  let held = !!(studio?.state as { playing?: boolean } | undefined)?.playing && !!studio?.stretchLookAhead;
  if (held) studio!.stretchLookAhead!();
  const release = () => {
    if (!held) return;
    held = false;
    studio?.restoreLookAhead?.();
  };
  try {
    const q = new URLSearchParams({ id: jobId, hear: String(seq) });
    if (token) q.set("t", token);
    const res = await fetch(`/api/compose/status?${q}`);
    const session = res.ok ? ((await res.json()) as { session?: unknown }).session : null;
    if (session) {
      const out = (await measureInFrame(session, release)) as { sections?: unknown[]; error?: string } | null;
      if (out && Array.isArray(out.sections)) report = out;
    }
  } catch {
    report = null;
  } finally {
    release();
  }
  try {
    await fetch("/api/compose/heard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: jobId, t: token, seq, report }),
    });
  } catch {
    // The turn stops waiting by its own clock.
  }
}

/** Say what became of a turn's changes (lib/data/composeTurns.js). Fire and
 *  forget: it is a record, and must never get in the way of the click. */
export function reportOutcome(job: { id: string; t?: string } | undefined, outcome: "kept" | "discarded" | "superseded" | "dropped", auditioned = false): void {
  if (!job?.id) return;
  try {
    void fetch("/api/compose/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, t: job.t, outcome, auditioned }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* nothing to do */
  }
}
