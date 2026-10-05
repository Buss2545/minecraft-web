import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit"];

function cleanLook(look) {
  if (!look || typeof look !== "object") return undefined;
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = look[k];
    if ((typeof v === "string" && v.length <= 24) || typeof v === "number") out[k] = v;
  }
  return out;
}

// ข้อมูลผู้เล่นที่ส่งให้คนอื่น (เก็บใน attachment ของ socket เพื่อให้รอดตอน hibernate)
function publicPlayer(a) {
  return {
    playerId: a.playerId,
    name: a.name || "ผู้เล่น",
    x: a.x,
    y: a.y,
    direction: a.direction || "d",
    moving: !!a.moving,
    w: a.w !== false,
    sit: !!a.sit,
    look: a.look,
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket endpoint", { status: 426 });
    }

    const url = new URL(request.url);
    const playerId = (url.searchParams.get("player") || crypto.randomUUID()).slice(0, 40);
    const name = (url.searchParams.get("name") || "ผู้เล่น").slice(0, 16);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // reconnect ด้วย playerId เดิม: ปิด socket เก่าที่ค้างอยู่ ไม่ให้ผู้เล่นซ้ำ
    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a?.playerId === playerId) {
        try { old.close(4000, "replaced"); } catch {}
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, name });

    // ส่งรายชื่อ/สถานะผู้เล่นที่มีอยู่ให้คนใหม่ (ไม่รวมตัวเอง)
    const players = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.playerId && a.playerId !== playerId && Number.isFinite(a.x) && Number.isFinite(a.y))
      .map(publicPlayer);

    server.send(JSON.stringify({ type: "welcome", playerId, players }));

    this.broadcast({ type: "player:join", player: { playerId, name } }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 2000) return;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    const player = ws.deserializeAttachment() || {};

    if (data.type === "state") {
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const next = {
        ...player,
        x,
        y,
        direction: DIRS[String(data.direction || "").toLowerCase()] || player.direction || "d",
        moving: !!data.moving,
        w: data.w !== false,
        sit: !!data.sit,
      };
      if (typeof data.name === "string" && data.name) next.name = data.name.slice(0, 16);
      const look = cleanLook(data.look);
      if (look) next.look = look;
      ws.serializeAttachment(next);

      this.broadcast({ type: "player:state", player: publicPlayer(next) }, ws);
      return;
    }

    if (data.type === "chat") {
      this.broadcast({
        type: "chat",
        playerId: player.playerId,
        name: player.name || "ผู้เล่น",
        text: String(data.text || "").slice(0, 300),
      });
    }
  }

  webSocketClose(ws) {
    this.handleLeave(ws);
  }

  webSocketError(ws) {
    this.handleLeave(ws);
  }

  handleLeave(ws) {
    const player = ws.deserializeAttachment();
    if (!player?.playerId) return;
    // ถ้ามี socket ใหม่ของ playerId เดิมอยู่แล้ว (reconnect) ไม่ต้องประกาศว่าออก
    const stillHere = this.ctx.getWebSockets().some((o) => {
      if (o === ws) return false;
      const a = o.deserializeAttachment();
      return a?.playerId === player.playerId;
    });
    if (!stillHere) this.broadcast({ type: "player:leave", playerId: player.playerId }, ws);
  }

  broadcast(data, except = null) {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {
        // Ignore sockets that are already closed.
      }
    }
  }
}
