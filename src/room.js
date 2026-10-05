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

const TOOL_IDS = new Set(["hoe", "can", "axe", "pick", "rod", "sword", "seed", "hand"]);

function cleanText(v, max) {
  return Array.from(String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, max)
    .join("");
}

function publicPlayer(a) {
  return {
    id: a.playerId,
    playerId: a.playerId,
    name: a.name || "ผู้เล่น",
    x: a.x,
    y: a.y,
    dir: a.direction || "d",
    direction: a.direction || "d",
    moving: !!a.moving,
    w: a.w !== false,
    sit: !!a.sit,
    look: a.look,
    tool: a.tool,
    tier: a.tier,
    hide: !!a.hide,
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
    const name = cleanText(url.searchParams.get("name"), 16) || "ผู้เล่น";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a?.playerId === playerId) {
        try { old.close(4000, "replaced"); } catch {}
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, name });

    const players = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.playerId && Number.isFinite(a.x) && Number.isFinite(a.y))
      .map(publicPlayer);

    const roster = this.roster(server);
    const online = this.onlineCount();

    server.send(JSON.stringify({ type: "welcome", playerId, players, roster, online }));
    server.send(JSON.stringify({ type: "player:list", players }));
    this.broadcast({ type: "player:join", player: { id: playerId, playerId, name }, name, online }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 4000) return;

    let data;
    try { data = JSON.parse(message); } catch { return; }
    if (!data || typeof data !== "object") return;

    const player = ws.deserializeAttachment() || {};

    if (data.type === "state" || data.type === "player:state" || data.type === "player:join") {
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const next = {
        ...player,
        x,
        y,
        direction: DIRS[String(data.direction || data.dir || "").toLowerCase()] || player.direction || "d",
        moving: !!data.moving,
        w: data.w !== false,
        sit: !!data.sit,
      };

      // ใช้ playerId ที่ผูกกับ WebSocket เท่านั้น ห้ามให้ client เปลี่ยนตัวตนระหว่างเชื่อมต่อ
      // เพื่อป้องกันชื่อ/ตัวละคร/จำนวนออนไลน์ไม่ตรงกัน
      next.playerId = player.playerId;

      // ชื่อหลักมาจากตัวละครบนหน้าเกม (S.name) ที่ client ส่งมาพร้อม state
      // หากยังไม่มีชื่อ ให้คงชื่อเดิมที่ได้ตอนเปิด WebSocket
      if (typeof data.name === "string" && data.name.trim()) {
        next.name = cleanText(data.name, 16) || next.name || "ผู้เล่น";
      }

      // อาวุธ/เครื่องมือที่กำลังถือ (ซิงค์เฉพาะที่ถืออยู่ ไม่ซิงค์ Inventory)
      if (TOOL_IDS.has(data.tool)) next.tool = data.tool;
      const tier = Number(data.tier);
      if (Number.isInteger(tier) && tier >= 0 && tier <= 3) next.tier = tier;
      if (typeof data.hide === "boolean") next.hide = data.hide;

      const look = cleanLook(data.look);
      if (look) next.look = look;
      ws.serializeAttachment(next);

      this.broadcast({ type: "player:state", player: publicPlayer(next) }, ws);
      return;
    }

    if (data.type === "chat") {
      const text = cleanText(data.text, 120);
      if (!text || !player.playerId) return;

      // กันสแปม: ข้อความถี่เกินไปจะถูกข้าม
      const now = Date.now();
      if (player.lastChat && now - player.lastChat < 350) return;
      ws.serializeAttachment({ ...player, lastChat: now });

      // broadcast ไปยังทุกคนในห้องนี้เท่านั้น (1 ห้อง = 1 Durable Object)
      this.broadcast({
        type: "chat",
        id: player.playerId,
        playerId: player.playerId,
        name: player.name || "ผู้เล่น",
        text,
        t: now,
      });
    }
  }

  webSocketClose(ws) { this.handleLeave(ws); }
  webSocketError(ws) { this.handleLeave(ws); }

  handleLeave(ws) {
    const player = ws.deserializeAttachment();
    if (!player?.playerId) return;

    const stillHere = this.ctx.getWebSockets().some((o) => {
      if (o === ws) return false;
      const a = o.deserializeAttachment();
      return a?.playerId === player.playerId;
    });

    if (!stillHere) {
      this.broadcast({
        type: "player:leave",
        id: player.playerId,
        playerId: player.playerId,
        name: player.name || "ผู้เล่น",
        player: { id: player.playerId, playerId: player.playerId },
        online: this.onlineCount(ws),
      }, ws);
    }
  }

  // จำนวนผู้เล่นออนไลน์ (นับตาม playerId ไม่ซ้ำ)
  onlineCount(except = null) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a?.playerId) ids.add(a.playerId);
    }
    return ids.size;
  }

  // รายชื่อทุกคนในห้อง (ยกเว้นตัวเอง) แม้ยังไม่เคยส่งตำแหน่ง
  roster(except = null) {
    const seen = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a?.playerId) seen.set(a.playerId, { id: a.playerId, name: a.name || "ผู้เล่น" });
    }
    return [...seen.values()];
  }

  broadcast(data, except = null) {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(payload); } catch {}
    }
  }
}
