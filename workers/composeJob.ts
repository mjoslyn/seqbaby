// A compose turn as a Durable Object, and the limits it is counted against.
//
// Writing a whole song is dozens of model rounds over minutes. A Worker
// request is not allowed to take that long, so the route (app/api/compose)
// starts a job here and answers at once, and the browser polls
// /api/compose/status, which asks this object for its progress. The turn runs
// in the object's ALARM, which may run for fifteen minutes with nobody
// waiting on it: the shape the Netlify background function used to have.
//
// One object per job (idFromName(jobId)). Its storage holds the progress the
// browser polls; the session going in and the song coming out are in R2
// (compose/<id>/...), because a session with samples in it is megabytes and a
// Durable Object value stops at 2MB. An hour after the turn ends, a second
// alarm deletes all of it.
//
// A brought key is held in MEMORY only (`apiKey` below), for the life of the
// turn. If the object is evicted between being started and its alarm firing,
// the key is gone and the turn says so rather than running on the site's key.

import { DurableObject } from "cloudflare:workers";
// @ts-ignore the skill file is imported as text (wrangler.jsonc `rules`)
import guide from "../.claude/skills/compose/SKILL.md";
import { runComposeTurn, setComposeGuide } from "../mcp/composeTurn.mjs";
import {
  clearSiteOutOfBudget,
  markSiteOutOfBudget,
  releaseSlot,
  takeSlot,
} from "../lib/composeJobs.js";
import { describeTurnFailure, isOutOfCredit } from "../lib/composeKey.js";
import { recordTurn } from "../lib/data/composeTurns.js";

setComposeGuide(guide);

export type ComposeJobInput = {
  id: string;
  userId: string | null;
  keyHash: string | null;
  bucket: string;
  viewToken: string;
  message: string;
  history: { role: string; text: string }[];
  session: unknown;
  /** A model the account picked (already checked by the route), else the deploy's. */
  model?: string | null;
  /** The song has never been saved: the turn names it. */
  unnamed?: boolean;
  /** The panel will play the song back when asked (see `listen`). */
  canHear?: boolean;
  /** What kind of turn it is, for its record (lib/data/composeTurns.js). */
  meta?: { kind?: string; genre?: string | null; seed?: number | null };
};

export type ComposeProgress = {
  userId: string | null;
  keyHash: string | null;
  viewToken: string;
  bucket: string;
  brought: boolean;
  status: "running" | "done" | "error";
  events: unknown[];
  createdAt: string;
  updatedAt?: string;
  reply?: string;
  model?: string;
  changed?: boolean;
  warnings?: unknown;
  /** The name the turn gave the song, if any. */
  title?: string | null;
  /** The genre it said the song is, as a tag. */
  genre?: string | null;
  ms?: number;
  error?: string;
  /** The alarm has begun the turn: a retried alarm must not run it twice. */
  begun?: boolean;
  /** Set while the turn waits for the panel to play the song back: which
   *  listen it is. The song is at compose/<id>/hear.json meanwhile. */
  hear?: number | null;
  /** For the turn's record: never sent to the browser. */
  messageLen?: number;
  meta?: { kind?: string; genre?: string | null; seed?: number | null };
};

/** How long a finished job's progress and song stay readable. */
const KEEP_MS = 60 * 60 * 1000;
const inputKey = (id: string) => `compose/${id}/input.json`;
const resultKey = (id: string) => `compose/${id}/result.json`;
const hearKey = (id: string) => `compose/${id}/hear.json`;
/** How long a turn waits for the panel to listen: the hidden engine has to
 *  load, then play up to six sections. Past it the turn finishes unheard. */
const HEAR_WAIT_MS = 75 * 1000;

export class ComposeJob extends DurableObject<CloudflareEnv> {
  /** The visitor's own key, never written to storage. */
  private apiKey: string | null = null;
  /** The listen the running turn is waiting on, in memory like the turn. */
  private hearing: { seq: number; done: (report: unknown) => void } | null = null;
  private hearSeq = 0;

  /** Stake the job out and set the alarm that runs it. */
  async start(input: ComposeJobInput, apiKey?: string): Promise<void> {
    const brought = !!apiKey;
    this.apiKey = apiKey || null;
    await this.env.BLOBS.put(inputKey(input.id), JSON.stringify({
      message: input.message,
      history: input.history,
      session: input.session,
      model: input.model || null,
      unnamed: !!input.unnamed,
      canHear: !!input.canHear,
    }));
    const progress: ComposeProgress = {
      userId: input.userId,
      keyHash: input.keyHash,
      viewToken: input.viewToken,
      bucket: input.bucket,
      brought,
      status: "running",
      events: [],
      createdAt: new Date().toISOString(),
      messageLen: input.message.length,
      meta: input.meta,
    };
    await this.ctx.storage.put({ id: input.id, progress });
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** What the browser polls, the song included once there is one. */
  async progress(): Promise<(ComposeProgress & { session?: unknown }) | null> {
    const p = await this.ctx.storage.get<ComposeProgress>("progress");
    if (!p) return null;
    if (p.status !== "done") return p;
    const id = await this.ctx.storage.get<string>("id");
    const obj = id ? await this.env.BLOBS.get(resultKey(id)) : null;
    return { ...p, session: obj ? await obj.json() : undefined };
  }

  /** The song a pending listen is of, for the panel to play. */
  async hearSession(seq: number): Promise<unknown | null> {
    const p = await this.ctx.storage.get<ComposeProgress>("progress");
    const id = await this.ctx.storage.get<string>("id");
    if (!p || !id || p.status !== "running" || p.hear !== seq) return null;
    const obj = await this.env.BLOBS.get(hearKey(id));
    return obj ? await obj.json() : null;
  }

  /** The panel's report on a listen (or null: it could not). */
  async heard(seq: number, report: unknown): Promise<boolean> {
    if (!this.hearing || this.hearing.seq !== seq) return false;
    this.hearing.done(report);
    return true;
  }

  /**
   * Ask the panel to play `session` back, and wait for what it heard. The
   * turn's alarm is awaiting this, and a Durable Object takes other calls
   * while one awaits, so `heard` above is what ends the wait; a closed tab
   * ends it by the clock.
   */
  private async listen(id: string, session: unknown): Promise<unknown | null> {
    const seq = ++this.hearSeq;
    await this.env.BLOBS.put(hearKey(id), JSON.stringify(session));
    const mark = async (hear: number | null) => {
      const cur = await this.ctx.storage.get<ComposeProgress>("progress");
      if (cur) await this.ctx.storage.put("progress", { ...cur, hear, updatedAt: new Date().toISOString() });
    };
    await mark(seq);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = await new Promise<unknown>((resolve) => {
      this.hearing = { seq, done: resolve };
      timer = setTimeout(() => resolve(null), HEAR_WAIT_MS);
    });
    clearTimeout(timer);
    this.hearing = null;
    await mark(null);
    await this.env.BLOBS.delete(hearKey(id)).catch(() => {});
    return report;
  }

  async alarm(): Promise<void> {
    const id = await this.ctx.storage.get<string>("id");
    const p = await this.ctx.storage.get<ComposeProgress>("progress");
    if (!id || !p) return;
    if (p.status !== "running") return this.cleanUp(id);
    // An alarm that throws is retried; a turn that has begun is not re-run on
    // a retry, because it may already have spent the tokens.
    if (p.begun) return this.finish(id, { status: "error", error: "that turn was interrupted — send it again." });
    await this.ctx.storage.put("progress", { ...p, begun: true });

    const brought = p.brought;
    const apiKey = brought ? this.apiKey : this.env.ANTHROPIC_API_KEY;
    this.apiKey = null;
    if (!apiKey) {
      return this.finish(id, {
        status: "error",
        error: brought
          ? "the server restarted before your turn began — send it again."
          : "no Anthropic key to run that on.",
      });
    }

    try {
      const obj = await this.env.BLOBS.get(inputKey(id));
      if (!obj) throw new Error("that job's details were no longer on the server.");
      const job = (await obj.json()) as { message: string; history: never[]; session: unknown; model?: string | null; unnamed?: boolean; canHear?: boolean };
      const out = await runComposeTurn({
        apiKey,
        ...(job.model ? { model: job.model } : {}),
        message: job.message,
        history: job.history,
        session: job.session,
        unnamed: !!job.unnamed,
        soundsKey: this.env.FREESOUND_API_KEY || null,
        ...(job.canHear ? { listen: (session: unknown) => this.listen(id, session) } : {}),
        // Persisted as it happens: the point of a job that runs for minutes is
        // being able to watch it.
        onEvent: async (e: { type: string }) => {
          if (e.type !== "tool") return;
          const cur = await this.ctx.storage.get<ComposeProgress>("progress");
          if (!cur) return;
          cur.events = [...(cur.events ?? []), e].slice(-200);
          cur.updatedAt = new Date().toISOString();
          await this.ctx.storage.put("progress", cur);
        },
      });
      if (!brought) await clearSiteOutOfBudget(this.env.DB).catch(() => {});
      await this.env.BLOBS.put(resultKey(id), JSON.stringify(out.session));
      await this.finish(id, {
        status: "done",
        reply: out.reply,
        model: out.model,
        changed: out.changed,
        warnings: out.warnings,
        title: out.title ?? null,
        genre: out.genre ?? null,
        ms: out.ms,
      });
      await this.record(id, { status: "done", model: out.model, changed: out.changed, ms: out.ms, stats: out.stats });
    } catch (e) {
      console.error("[compose job]", e);
      // The site's key running dry switches compose off for everyone on it,
      // rather than letting each of them find out a minute into a turn.
      if (!brought && isOutOfCredit(e)) await markSiteOutOfBudget(this.env.DB).catch(() => {});
      await this.finish(id, { status: "error", error: describeTurnFailure(e, brought) });
      await this.record(id, { status: "error" });
    }
  }

  /** The turn's row in compose_turns. Its failing costs the record only. */
  private async record(id: string, t: { status: string; model?: string; changed?: boolean; ms?: number; stats?: unknown }) {
    try {
      const p = await this.ctx.storage.get<ComposeProgress>("progress");
      if (!p) return;
      await recordTurn(this.env.DB, { id, userId: p.userId, viewToken: p.viewToken, meta: p.meta, messageLen: p.messageLen, ...t });
    } catch (e) {
      console.error("[compose job] could not record the turn", e);
    }
  }

  private async finish(id: string, patch: Partial<ComposeProgress>) {
    const p = await this.ctx.storage.get<ComposeProgress>("progress");
    if (!p) return;
    await this.ctx.storage.put("progress", { ...p, ...patch, updatedAt: new Date().toISOString() });
    // The input is a whole session and nothing reads it after the turn.
    await this.env.BLOBS.delete(inputKey(id)).catch(() => {});
    const limits = this.env.COMPOSE_LIMITS.get(this.env.COMPOSE_LIMITS.idFromName(p.bucket));
    await limits.release(id).catch(() => {});
    await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
  }

  private async cleanUp(id: string) {
    await this.env.BLOBS.delete([inputKey(id), resultKey(id), hearKey(id)]).catch(() => {});
    await this.ctx.storage.deleteAll();
  }
}

/**
 * One usage bucket (an account, or a brought key / address): what it has
 * running and what it has started in the last hour. A Durable Object is
 * single-threaded, so ten requests sent together are ten turns of this
 * object, one after another, and only as many as the limit get a slot.
 */
export class ComposeLimits extends DurableObject<CloudflareEnv> {
  async take(id: string): Promise<{ ok?: true; error?: string }> {
    const next = takeSlot(await this.ctx.storage.get("rec"), id);
    if ("error" in next && next.error) return { error: next.error };
    await this.ctx.storage.put("rec", next);
    return { ok: true };
  }

  async release(id: string): Promise<void> {
    await this.ctx.storage.put("rec", releaseSlot(await this.ctx.storage.get("rec"), id));
  }
}
