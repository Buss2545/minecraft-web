import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit"];
const TOOL_IDS = new Set(["hoe", "can", "axe", "pick", "rod", "sword", "seed", "hand"]);

function cleanLook(look) {
  if (!look || typeof look !== "object") return undefined;
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = look[k];
    if ((typeof v === "string" && v.length <= 24) || typeof v === "number") out[k] = v;
  }
  return out;
}

function cleanText(v, max) {
  return Array.from(String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, max).join("");
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
    const url = new URL(request.url);

    if (url.pathname === "/admin" && request.method === "POST") {
      if (request.headers.get("X-BSJ-Admin-Verified") !== "1") {
        return new Response("Forbidden", { status: 403 });
      }
      return this.adminAction(request);
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket endpoint", { status: 426 });
    }

    if (request.headers.get("X-BSJ-Auth-Verified") !== "1") {
      return new Response("Login required", { status: 401 });
    }

    const userId = cleanText(url.searchParams.get("user"), 32);
    const role = url.searchParams.get("role") === "admin" ? "admin" : "user";
    if (!userId) return new Response("User ID required", { status: 400 });

    if (role !== "admin" && await this.isBanned(userId)) {
      return new Response("BANNED", { status: 403 });
    }

    const playerId = role === "admin" ? "admin:" + userId : userId;
    const name = cleanText(url.searchParams.get("name"), 16) || (role === "admin" ? "Admin" : "ผู้เล่น");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // หนึ่ง ID ต่อหนึ่งห้อง: การเชื่อมต่อใหม่จะแทนที่การเชื่อมต่อเก่า
    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a?.playerId === playerId) {
        try { old.close(4000, "replaced"); } catch {}
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, userId, role, name });

    const players = this.ctx.getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.playerId && Number.isFinite(a.x) && Number.isFinite(a.y))
      .map(publicPlayer);

    const roster = this.roster(server);
    const online = this.onlineCount();

    server.send(JSON.stringify({ type: "welcome", playerId, userId, role, players, roster, online }));
    server.send(JSON.stringify({ type: "player:list", players }));
    this.broadcast({ type: "player:join", player: { id: playerId, playerId, name }, name, online }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async isBanned(userId) {
    return !!(await this.ctx.storage.get("ban:" + userId));
  }

  async adminAction(request) {
    let data;
    try { data = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

    const action = String(data.action || "");
    const userId = cleanText(data.userId, 32);
    const reason = cleanText(data.reason, 160) || "Admin ban";

    if (action === "list") {
      const bans = [];
      const list = await this.ctx.storage.list({ prefix: "ban:" });
      for (const [key, value] of list) bans.push({ userId: key.slice(4), ...(value || {}) });
      return Response.json({ ok: true, online: this.roster(), count: this.onlineCount(), bans });
    }

    if (!userId && action !== "unban") return Response.json({ ok: false, error: "User ID required" }, { status: 400 });

    if (action === "ban") {
      await this.ctx.storage.put("ban:" + userId, { reason, at: Date.now() });
      this.closeUser(userId, 4003, "banned");
      this.broadcast({ type: "admin:ban", userId });
      return Response.json({ ok: true, action, userId });
    }

    if (action === "unban") {
      await this.ctx.storage.delete("ban:" + userId);
      return Response.json({ ok: true, action, userId });
    }

    if (action === "kick") {
      const closed = this.closeUser(userId, 4002, "kicked");
      return Response.json({ ok: true, action, userId, closed });
    }

    if (action === "rename") {
      const name = cleanText(data.name, 16);
      let changed = false;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a?.userId === userId) {
          ws.serializeAttachment({ ...a, name: name || "ผู้เล่น" });
          changed = true;
        }
      }
      return Response.json({ ok: true, action, userId, changed });
    }

    return Response.json({ ok: false, error: "Unknown admin action" }, { status: 400 });
  }

  closeUser(userId, code, reason) {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.userId === userId) {
        n++;
        try { ws.close(code, reason); } catch {}
      }
    }
    return n;
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

      next.playerId = player.playerId;
      next.userId = player.userId;

      if (typeof data.name === "string" && data.name.trim()) {
        next.name = cleanText(data.name, 16) || next.name || "ผู้เล่น";
      }

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

      const now = Date.now();
      if (player.lastChat && now - player.lastChat < 350) return;
      ws.serializeAttachment({ ...player, lastChat: now });

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
        userId: player.userId,
        name: player.name || "ผู้เล่น",
        player: { id: player.playerId, playerId: player.playerId },
        online: this.onlineCount(ws),
      }, ws);
    }
  }

  onlineCount(except = null) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a?.playerId) ids.add(a.playerId);
    }
    return ids.size;
  }

  roster(except = null) {
    const seen = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a?.playerId) {
        seen.set(a.playerId, {
          id: a.playerId,
          userId: a.userId || a.playerId,
          name: a.name || "ผู้เล่น",
          role: a.role || "user",
        });
      }
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
