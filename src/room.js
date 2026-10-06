import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit"];
// อุปกรณ์ที่ผู้เล่นถืออยู่: จอบ/บัวรดน้ำ/ขวาน/ค้อนทุบหิน/เบ็ด/ดาบ/เมล็ดพืช/เคียว-มือ (hide=true คือมือเปล่า)
const TOOL_IDS = new Set(["hoe", "can", "axe", "pick", "rod", "sword", "seed", "hand"]);
// นาฬิกากลางของห้อง (ซิงก์เฉพาะ "เวลาในวัน"): 1 นาทีเกม = 1 วินาทีจริง, วันของห้อง = 06:00 → 26:00 (1200 นาทีเกม) แล้ววนกลับ 06:00
const CLOCK_RATE = 1.0;
const CLOCK_START = 360;
const CLOCK_LEN = 1200;
const UID_RE = /^[A-Za-z0-9_\-]{6,40}$/;
const MARRY_STAGES = new Set(["date", "wed"]);
// นอนพร้อมกัน: ถามทุกคนในห้อง (รอได้ 20 วิ) → ทุกคนนอนเสร็จ → เลื่อนนาฬิกาห้องไปเช้า 06:00 ของวันถัดไป
const SLEEP_ASK_MS = 20000;
const SLEEP_ACK_MS = 6000;
const MARRY_NO = new Set(["busy", "decline", "taken"]);

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
    uid: a.uid || "",
  };
}

const TRADE_KEY = /^(crop|food):[A-Za-z0-9_\-]{1,30}$/;

// แสนสุข (โซเชียลในมือถือ): เก็บโพสต์ล่าสุดของห้อง แล้วส่งให้ทุกคนที่ออนไลน์ + คนที่เพิ่งเข้าห้อง
const SOC_MAX = 40;
const SOC_LEN = 200;
const SOC_GAP = 2000;

function cleanSocText(t) {
  return Array.from(String(t || "").replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/g, " ").replace(/\s+/g, " ").trim()).slice(0, SOC_LEN).join("");
}

function publicPost(p, key) {
  const lkb = Array.isArray(p.lkb) ? p.lkb : [];
  return { id: p.id, pid: p.pid, uid: p.uid || "", name: p.name || "ผู้เล่น", text: p.text, t: p.t, lk: lkb.length, me: !!key && lkb.includes(key) };
}

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
    // จุดเริ่มนาฬิกาของห้อง เก็บถาวรครั้งเดียว (ห้องค้างนานก็ไม่เพี้ยน เพราะคำนวณจาก Date.now() เสมอ)
    ctx.blockConcurrencyWhile(async () => {
      let e = await ctx.storage.get("epoch");
      if (typeof e !== "number") {
        e = Date.now();
        await ctx.storage.put("epoch", e);
      }
      this.epoch = e;
    });
  }

  timeMsg() {
    return { type: "time", epoch: this.epoch, now: Date.now(), rate: CLOCK_RATE, start: CLOCK_START, len: CLOCK_LEN };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      if (new URL(request.url).pathname.endsWith("/status")) {
        return Response.json({ online: this.ctx.getWebSockets().length }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response("WebSocket endpoint | room.js v5 (uid-lock + room clock + marriage + sleep-together + saensuk social)", { status: 426 });
    }

    const url = new URL(request.url);
    const playerId = (url.searchParams.get("player") || crypto.randomUUID()).slice(0, 40);
    const name = (url.searchParams.get("name") || "ผู้เล่น").slice(0, 16);

    // uid = ไอดีถาวรในเซฟ: 1 uid เชื่อมต่อได้ครั้งเดียว ใหม่เข้ามา → เตะอันเก่าออก (กันเปิดสองแท็บ/สองเครื่องแล้วแลกของกันเองปั๊มของ)
    const uidRaw = url.searchParams.get("uid") || "";
    const uid = UID_RE.test(uidRaw) ? uidRaw : "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a?.playerId === playerId) {
        try { old.close(4001, "replaced"); } catch {}
      } else if (uid && a?.uid === uid) {
        try { old.close(4001, "uid-in-use"); } catch {}
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, name, uid });

    const players = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.playerId && Number.isFinite(a.x) && Number.isFinite(a.y))
      .map(publicPlayer);

    server.send(JSON.stringify({ type: "welcome", playerId, players }));
    server.send(JSON.stringify({ type: "player:list", players }));
    server.send(JSON.stringify(this.timeMsg()));
    try {
      const posts = (await this.ctx.storage.get("posts")) || [];
      server.send(JSON.stringify({ type: "social:list", posts: posts.map((p) => publicPost(p, uid || playerId)) }));
    } catch {}
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

      if (!player.uid && typeof data.uid === "string" && UID_RE.test(data.uid)) next.uid = data.uid; // uid ล็อกตั้งแต่ตอนเชื่อมต่อ แก้ทีหลังไม่ได้
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

    if (data.type === "marry") {
      return this.handleMarry(ws, data);
    }

    if (data.type === "sleep") {
      return this.handleSleep(ws, data);
    }

    if (data.type === "social") {
      return this.handleSocial(ws, data);
    }

    if (data.type === "social:like") {
      return this.handleSocialLike(ws, data);
    }

    if (data.type === "time") {
      try { ws.send(JSON.stringify(this.timeMsg())); } catch {}
      return;
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

  // โพสต์แสนสุข: ชื่อมาจากชื่อผู้เล่นที่เชื่อมต่ออยู่ (เซิร์ฟเวอร์ใส่เอง ไม่เชื่อชื่อที่ client ส่งมา)
  async handleSocial(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId) return;
    const text = cleanSocText(d.text);
    if (!text) return;
    const now = Date.now();
    if (now - (me.lastSoc || 0) < SOC_GAP) return;
    this.setAtt(ws, { lastSoc: now });
    const post = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      pid: me.playerId,
      uid: me.uid || "",
      name: me.name || "ผู้เล่น",
      text,
      t: now,
      lkb: [],
    };
    const posts = (await this.ctx.storage.get("posts")) || [];
    posts.unshift(post);
    if (posts.length > SOC_MAX) posts.length = SOC_MAX;
    await this.ctx.storage.put("posts", posts);
    this.broadcast({ type: "social", post: publicPost(post) });
  }

  async handleSocialLike(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const key = me.uid || me.playerId;
    if (!key) return;
    const id = String(d.id || "").slice(0, 24);
    const posts = (await this.ctx.storage.get("posts")) || [];
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    p.lkb = Array.isArray(p.lkb) ? p.lkb : [];
    if (p.lkb.includes(key) || p.lkb.length >= 200) return;
    p.lkb.push(key);
    await this.ctx.storage.put("posts", posts);
    this.broadcast({ type: "social:like", id, n: p.lkb.length });
  }

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

  marrySend(ws, obj) {
    try { ws.send(JSON.stringify({ type: "marry", ...obj })); } catch {}
  }

  // ขอเป็นแฟน (stage=date) / ขอแต่งงาน (stage=wed) ระหว่างผู้เล่น: เซิร์ฟเวอร์เก็บคำขอที่ค้างอยู่ฝั่งผู้รับ
  // แล้วส่ง "ok" ให้ทั้งคู่พร้อมกันพร้อม uid/ชื่อของอีกฝ่าย (uid คือไอดีถาวรที่เก็บในเซฟ ใช้จำคู่ข้ามเซสชัน)
  handleMarry(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    const to = String(d.to || "").slice(0, 40);
    const act = String(d.act || "");
    if (!from || !to || to === from) return;
    const peer = this.findWs(to);
    if (me.uid && peer?.deserializeAttachment()?.uid === me.uid) return;

    if (act === "req") {
      const stage = String(d.stage || "");
      if (!MARRY_STAGES.has(stage)) return;
      if (!me.uid) return this.marrySend(ws, { act: "no", from: to, reason: "taken" });
      if (!peer) return this.marrySend(ws, { act: "no", from: to, reason: "gone" });
      const pa = peer.deserializeAttachment() || {};
      const pending = pa.mr && Date.now() - pa.mr.t < 30000 && pa.mr.f !== from;
      if (pending) return this.marrySend(ws, { act: "no", from: to, reason: "busy" });
      this.setAtt(peer, { mr: { f: from, s: stage, t: Date.now() } });
      return this.marrySend(peer, { act: "req", from, name: me.name || "ผู้เล่น", uid: me.uid, stage });
    }

    if (act === "no") {
      if (me.mr?.f === to) this.setAtt(ws, { mr: null });
      if (peer) this.marrySend(peer, { act: "no", from, reason: MARRY_NO.has(d.reason) ? d.reason : "decline" });
      return;
    }

    if (act === "yes") {
      const mr = me.mr;
      const pa = peer?.deserializeAttachment() || {};
      if (!peer || !mr || mr.f !== to || Date.now() - mr.t > 30000 || !me.uid || !pa.uid) {
        this.setAtt(ws, { mr: null });
        return this.marrySend(ws, { act: "cancel", from: to });
      }
      this.setAtt(ws, { mr: null });
      this.marrySend(ws, { act: "ok", from: to, uid: pa.uid, name: pa.name || "ผู้เล่น", stage: mr.s });
      this.marrySend(peer, { act: "ok", from, uid: me.uid, name: me.name || "ผู้เล่น", stage: mr.s });
      return;
    }

    if (act === "cancel") {
      const pa = peer?.deserializeAttachment() || {};
      if (peer && pa.mr?.f === from) {
        this.setAtt(peer, { mr: null });
        this.marrySend(peer, { act: "cancel", from });
      }
    }
  }

  // เซิร์ฟเวอร์เป็นผู้ตัดสิน: เก็บข้อเสนอ/การล็อกของแต่ละฝั่ง แล้วส่ง commit ให้ทั้งคู่พร้อมกันครั้งเดียว
  async handleTrade(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    const to = String(d.to || "").slice(0, 40);
    const act = String(d.act || "");
    if (!from || !to || to === from) return;
    const peer = this.findWs(to);
    if (me.uid && peer?.deserializeAttachment()?.uid === me.uid) return;
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


  // ---------- นอนพร้อมกัน ----------
  // สถานะอยู่ในหน่วยความจำ (this.sl) ถ้า DO ถูกรีสตาร์ทกลางคัน ฝั่งเกมจะหมดเวลาเองและไม่มีใครค้าง
  sleepSend(id, obj) {
    const w = this.findWs(id);
    if (w) { try { w.send(JSON.stringify({ type: "sleep", ...obj })); } catch {} }
  }

  sleepName(id) {
    return this.findWs(id)?.deserializeAttachment()?.name || "ผู้เล่น";
  }

  handleSleep(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    if (!from) return;
    const act = String(d.act || "");
    if (this.sl && Date.now() - this.sl.t > SLEEP_ASK_MS + SLEEP_ACK_MS + 5000) this.sl = null; // ค้างนานผิดปกติ ล้างทิ้ง
    const sl = this.sl;

    if (act === "req") {
      if (sl) return this.sleepSend(from, { act: "busy" });
      const ask = new Set();
      for (const w of this.ctx.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (!a?.playerId || a.playerId === from) continue;
        if (me.uid && a.uid === me.uid) continue;
        ask.add(a.playerId);
      }
      this.sl = { init: from, t: Date.now(), phase: "ask", ask, yes: new Set(), go: new Set(), done: new Set() };
      if (ask.size === 0) return this.sleepGo();
      this.sleepSend(from, { act: "wait", n: ask.size });
      for (const id of ask) this.sleepSend(id, { act: "ask", from, name: me.name || "ผู้เล่น" });
      return;
    }

    if (!sl) return;

    if (act === "yes") {
      if (sl.phase !== "ask" || !sl.ask.has(from)) return;
      sl.yes.add(from);
      return this.sleepCheck();
    }

    if (act === "no") {
      if (sl.phase !== "ask" || !sl.ask.has(from)) return;
      const reason = d.reason === "busy" ? "busy" : "decline";
      for (const id of [sl.init, ...sl.ask]) {
        if (id !== from) this.sleepSend(id, { act: "denied", from, name: me.name || "ผู้เล่น", reason });
      }
      this.sl = null;
      return;
    }

    if (act === "cancel") {
      if (sl.phase !== "ask" || sl.init !== from) return;
      for (const id of sl.ask) this.sleepSend(id, { act: "cancel", from, name: me.name || "ผู้เล่น" });
      this.sl = null;
      return;
    }

    if (act === "tmo") {
      // ผู้ขอส่งมาเมื่อครบเวลา: คนที่ไม่ตอบจะถูกพาเข้านอนไปด้วย
      if (sl.phase !== "ask" || sl.init !== from) return;
      if (Date.now() - sl.t < SLEEP_ASK_MS - 2000) return;
      return this.sleepGo();
    }

    if (act === "done") {
      if (sl.phase !== "go" || !sl.go.has(from)) return;
      sl.done.add(from);
      return this.sleepCheck();
    }
  }

  sleepCheck() {
    const sl = this.sl;
    if (!sl) return;
    if (sl.phase === "ask") {
      if ([...sl.ask].every((i) => sl.yes.has(i))) this.sleepGo();
    } else if ([...sl.go].every((i) => sl.done.has(i))) {
      this.sleepJump();
    }
  }

  sleepGo() {
    const sl = this.sl;
    if (!sl) return;
    sl.phase = "go";
    sl.t = Date.now();
    const everyone = [sl.init, ...sl.ask].filter((id) => this.findWs(id));
    sl.go = new Set(everyone);
    for (const id of everyone) {
      const willing = id === sl.init || sl.yes.has(id);
      this.sleepSend(id, { act: "go", forced: !willing });
    }
    setTimeout(() => { if (this.sl === sl) this.sleepJump(); }, SLEEP_ACK_MS); // กันค้างถ้ามีใครไม่ส่ง done
    if (everyone.length === 0) this.sleepJump();
  }

  // เลื่อน epoch ให้นาฬิกาห้องกระโดดไปต้นวันห้องถัดไป (06:00) แล้วส่งเวลาใหม่ให้ทุกคน
  sleepJump() {
    if (!this.sl) return;
    this.sl = null;
    const el = ((Date.now() - this.epoch) / 1000) * CLOCK_RATE;
    const k = Math.floor(el / CLOCK_LEN);
    const delta = (((k + 1) * CLOCK_LEN - el) / CLOCK_RATE) * 1000 + 50;
    this.epoch -= delta;
    this.ctx.storage.put("epoch", this.epoch).catch(() => {});
    this.broadcast(this.timeMsg());
  }

  sleepLeave(id) {
    const sl = this.sl;
    if (!sl) return;
    if (sl.init === id && sl.phase === "ask") {
      for (const o of sl.ask) this.sleepSend(o, { act: "cancel", from: id, name: "ผู้ขอนอน" });
      this.sl = null;
      return;
    }
    sl.ask.delete(id); sl.yes.delete(id); sl.go.delete(id); sl.done.delete(id);
    this.sleepCheck();
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
      this.sleepLeave(player.playerId);
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
