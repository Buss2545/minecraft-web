import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit"];
// อุปกรณ์ที่ผู้เล่นถืออยู่: จอบ/บัวรดน้ำ/ขวาน/ค้อนทุบหิน/เบ็ด/ดาบ/เมล็ดพืช/เคียว-มือ (hide=true คือมือเปล่า)
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
    sc: a.sc || "w",
    sit: !!a.sit,
    tool: TOOL_IDS.has(a.tool) ? a.tool : "hand",
    tier: Math.max(0, Math.min(3, a.tier | 0)),
    hide: !!a.hide,
    look: a.look,
  };
}

const TRADE_KEY = /^(crop|food):[A-Za-z0-9_\-]{1,30}$/;

function cleanOffer(d) {
  const money = Math.max(0, Math.min(9999999, Math.floor(Number(d.money) || 0)));
  const items = {};
  if (d.items && typeof d.items === "object") {
    for (const k of Object.keys(d.items).slice(0, 60)) {
      const n = Math.max(0, Math.min(9999, Math.floor(Number(d.items[k]) || 0)));
      if (n > 0 && TRADE_KEY.test(k)) items[k] = n;
    }
  }
  return { money, items };
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

    server.send(JSON.stringify({ type: "welcome", playerId, players }));
    server.send(JSON.stringify({ type: "player:list", players }));
    this.broadcast({ type: "player:join", player: { id: playerId, playerId, name } }, server);

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
        sc: typeof data.sc === "string" && data.sc ? data.sc.slice(0, 40) : data.w === false ? "x" : "w",
        sit: !!data.sit,
        tool: TOOL_IDS.has(data.tool) ? data.tool : player.tool || "hand",
        tier: Math.max(0, Math.min(3, Number(data.tier) | 0)),
        hide: !!data.hide,
      };

      if (typeof data.id === "string" && data.id) next.playerId = data.id.slice(0, 40);
      if (typeof data.name === "string" && data.name) next.name = data.name.slice(0, 16);

      const look = cleanLook(data.look);
      if (look) next.look = look;
      ws.serializeAttachment(next);

      this.broadcast({ type: "player:state", player: publicPlayer(next) }, ws);
      return;
    }

    if (data.type === "trade") {
      return this.handleTrade(ws, data);
    }

    if (data.type === "chat") {
      this.broadcast({
        type: "chat",
        id: player.playerId,
        playerId: player.playerId,
        name: player.name || "ผู้เล่น",
        text: String(data.text || "").slice(0, 300),
      });
    }
  }

  webSocketClose(ws) { this.handleLeave(ws); }
  webSocketError(ws) { this.handleLeave(ws); }

  findWs(id) {
    return this.ctx.getWebSockets().find((w) => w.deserializeAttachment()?.playerId === id);
  }

  setAtt(ws, patch) {
    const cur = ws.deserializeAttachment() || {};
    ws.serializeAttachment({ ...cur, ...patch });
  }

  tradeSend(ws, obj) {
    try { ws.send(JSON.stringify({ type: "trade", ...obj })); } catch {}
  }

  // เซิร์ฟเวอร์เป็นผู้ตัดสิน: เก็บข้อเสนอ/การล็อกของแต่ละฝั่ง แล้วส่ง commit ให้ทั้งคู่พร้อมกันครั้งเดียว
  async handleTrade(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    const to = String(d.to || "").slice(0, 40);
    const act = String(d.act || "");
    if (!from || !to || to === from) return;
    const peer = this.findWs(to);
    const inTrade = (a, other) => a?.tr && a.tr.w === other;

    if (act === "req") {
      if (!peer) return this.tradeSend(ws, { act: "no", from: to, reason: "gone" });
      const pa = peer.deserializeAttachment() || {};
      const pending = pa.rq && Date.now() - pa.rq.t < 30000 && pa.rq.f !== from;
      if (me.tr || pa.tr || pending) return this.tradeSend(ws, { act: "no", from: to, reason: "busy" });
      this.setAtt(peer, { rq: { f: from, t: Date.now() } });
      return this.tradeSend(peer, { act: "req", from, name: me.name || "ผู้เล่น" });
    }

    if (act === "no") {
      if (me.rq?.f === to) this.setAtt(ws, { rq: null });
      if (peer) this.tradeSend(peer, { act: "no", from, reason: d.reason === "busy" ? "busy" : "decline" });
      return;
    }

    if (act === "yes") {
      const pa = peer?.deserializeAttachment();
      if (!peer || me.rq?.f !== to || me.tr || pa?.tr) {
        this.setAtt(ws, { rq: null });
        return this.tradeSend(ws, { act: "cancel", from: to });
      }
      this.setAtt(ws, { rq: null, tr: { w: to, lk: 0 } });
      this.setAtt(peer, { rq: null, tr: { w: from, lk: 0 } });
      await this.ctx.storage.put("o:" + from, { m: 0, i: {}, v: 0 });
      await this.ctx.storage.put("o:" + to, { m: 0, i: {}, v: 0 });
      this.tradeSend(ws, { act: "start", from: to });
      this.tradeSend(peer, { act: "start", from });
      return;
    }

    if (act === "cancel") {
      if (inTrade(me, to)) {
        await this.endTrade(from, to, "cancel");
      } else {
        const pa = peer?.deserializeAttachment();
        if (peer && pa?.rq?.f === from) {
          this.setAtt(peer, { rq: null });
          this.tradeSend(peer, { act: "cancel", from });
        }
      }
      return;
    }

    // offer / lock ใช้ได้เฉพาะตอนอยู่ในเซสชันเดียวกัน
    if (!peer || !inTrade(me, to) || !inTrade(peer.deserializeAttachment(), from)) return;

    if (act === "offer") {
      const o = cleanOffer(d);
      const prev = (await this.ctx.storage.get("o:" + from)) || { v: 0 };
      const v = (prev.v || 0) + 1;
      await this.ctx.storage.put("o:" + from, { m: o.money, i: o.items, v });
      this.setAtt(ws, { tr: { w: to, lk: 0 } });
      this.setAtt(peer, { tr: { w: from, lk: 0 } }); // มีใครแก้ข้อเสนอ = ล็อกของทั้งสองฝั่งหลุด
      this.tradeSend(peer, { act: "offer", from, money: o.money, items: o.items, v });
      return;
    }

    if (act === "lock") {
      const theirs = await this.ctx.storage.get("o:" + to);
      if (!theirs || theirs.v !== (Number(d.sv) | 0)) {
        return this.tradeSend(ws, { act: "stale", from: to }); // ยังไม่เห็นข้อเสนอล่าสุดของอีกฝ่าย
      }
      this.setAtt(ws, { tr: { w: to, lk: 1 } });
      if (peer.deserializeAttachment()?.tr?.lk) {
        const mine = await this.ctx.storage.get("o:" + from);
        const pack = (o) => ({ money: o?.m || 0, items: o?.i || {} });
        await this.endTrade(from, to, null);
        this.tradeSend(ws, { act: "commit", from: to, mine: pack(mine), theirs: pack(theirs) });
        this.tradeSend(peer, { act: "commit", from, mine: pack(theirs), theirs: pack(mine) });
      } else {
        this.tradeSend(peer, { act: "lock", from });
      }
    }
  }

  async endTrade(a, b, notify) {
    for (const id of [a, b]) {
      const w = this.findWs(id);
      if (w) {
        this.setAtt(w, { tr: null, rq: null });
        if (notify) this.tradeSend(w, { act: notify, from: id === a ? b : a });
      }
    }
    await this.ctx.storage.delete(["o:" + a, "o:" + b]);
  }

  handleLeave(ws) {
    const player = ws.deserializeAttachment();
    if (!player?.playerId) return;

    if (player.tr?.w) {
      const other = this.findWs(player.tr.w);
      if (other && other !== ws && other.deserializeAttachment()?.tr?.w === player.playerId) {
        this.setAtt(other, { tr: null });
        this.tradeSend(other, { act: "cancel", from: player.playerId, reason: "left" });
      }
      this.ctx.storage.delete(["o:" + player.playerId, "o:" + player.tr.w]).catch(() => {});
    }

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
        player: { id: player.playerId, playerId: player.playerId },
      }, ws);
    }
  }

  broadcast(data, except = null) {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(payload); } catch {}
    }
  }
}
