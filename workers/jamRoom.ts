// A jam room: one Durable Object per `?jam=<room>`, holding a WebSocket per
// studio in it. It replaces the Supabase Realtime channel the room used to
// be, and does the same two jobs:
//
//   broadcast   a message from one member goes to every other member, as is
//               (the shell's envelope, cut into parts by lib/jamWire.js; the
//               room never looks inside one)
//   presence    who is here, sent to everyone whenever it changes
//
// The engine and app/JamPanel.tsx decide everything else (who hands a
// newcomer the song, what a patch is). The room is a relay with a guest list.
//
// Hibernation: the sockets are accepted through the state's WebSocket API, so
// a quiet room costs nothing between messages, and each member's presence is
// the socket's attachment rather than an in-memory map that would not survive
// the object being evicted.

import { DurableObject } from "cloudflare:workers";

export const JAM_ROOM_PATH = "/api/jam/";
const ROOM_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** The room id from `/api/jam/<room>`, or null for one that cannot be a room. */
export function jamRoomName(pathname: string): string | null {
  const room = pathname.slice(JAM_ROOM_PATH.length);
  return ROOM_RE.test(room) ? room : null;
}

export type JamPresence = { id: string; name: string; color: string; joinedAt: number };

/** What a member sends. */
type Incoming =
  | { t: "join"; id: string; name?: string; color?: string; joinedAt?: number }
  | { t: "track"; name?: string; color?: string; joinedAt?: number }
  | { t: "msg"; part: unknown };

/** One part is a slice of a message (lib/jamWire.js cuts at 60k characters);
 *  this is the most the room relays in one frame, with room for the envelope. */
const MAX_FRAME = 256 * 1024;
const MAX_MEMBERS = 32;

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

export class JamRoom extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // Answered without waking the object: the client's keepalive.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_MEMBERS)
      return new Response("this jam is full", { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_FRAME) return;
    let msg: Incoming;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() as JamPresence | null;

    if (msg.t === "join") {
      const id = clip(msg.id, 32);
      if (!id) return;
      // The same member arriving again (a reconnect that beat the old socket's
      // close) replaces themselves rather than appearing twice.
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const p = other.deserializeAttachment() as JamPresence | null;
        if (p?.id === id) other.close(4000, "replaced");
      }
      ws.serializeAttachment(this.presenceOf(id, msg));
      this.sendPresence();
      return;
    }
    if (!me) return; // nothing before a join
    if (msg.t === "track") {
      ws.serializeAttachment(this.presenceOf(me.id, msg, me.joinedAt));
      this.sendPresence();
      return;
    }
    if (msg.t === "msg") {
      const out = JSON.stringify({ t: "msg", part: msg.part });
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws || !other.deserializeAttachment()) continue;
        try {
          other.send(out);
        } catch {
          /* a socket closing under us; its close handler updates presence */
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // Code 1005/1006 cannot be sent back; anything else is echoed as asked.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
    this.sendPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.sendPresence(ws);
  }

  private presenceOf(
    id: string,
    m: { name?: string; color?: string; joinedAt?: number },
    keepJoinedAt?: number,
  ): JamPresence {
    return {
      id,
      name: clip(m.name, 40) || "guest",
      color: clip(m.color, 40),
      joinedAt: keepJoinedAt || (Number.isFinite(m.joinedAt) ? Number(m.joinedAt) : Date.now()),
    };
  }

  /** Everyone here, to everyone here. `gone` is a socket on its way out. */
  private sendPresence(gone?: WebSocket) {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== gone);
    const peers = sockets
      .map((s) => s.deserializeAttachment() as JamPresence | null)
      .filter((p): p is JamPresence => !!p)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const out = JSON.stringify({ t: "presence", peers });
    for (const s of sockets) {
      try {
        s.send(out);
      } catch {
        /* closing */
      }
    }
  }
}
