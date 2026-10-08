import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit", "face"];
// อุปกรณ์ที่ผู้เล่นถืออยู่: จอบ/บัวรดน้ำ/ขวาน/ค้อนทุบหิน/เบ็ด/ดาบ/เมล็ดพืช/เคียว-มือ (hide=true คือมือเปล่า)
const TOOL_IDS = new Set(["hoe", "can", "axe", "pick", "rod", "sword", "seed", "hand"]);
const EMO_IDS = new Set(["wave", "dance", "cheer", "sit"]); // อีโมตท่าทางในมัลติเพลเยอร์ (ต้องตรงกับ EMOTES ในเกม)
// นาฬิกากลางของห้อง (ซิงก์เฉพาะ "เวลาในวัน"): 1 นาทีเกม = 1 วินาทีจริง, วันของห้อง = 06:00 → 26:00 (1200 นาทีเกม) แล้ววนกลับ 06:00
const CLOCK_RATE = 1.0;
const CLOCK_START = 360;
const CLOCK_LEN = 1200;
const UID_RE = /^[A-Za-z0-9_\-]{6,40}$/;
const MARRY_STAGES = new Set(["date", "wed", "party"]);
// นอนพร้อมกัน: ถามทุกคนในห้อง (รอได้ 20 วิ) → ทุกคนนอนเสร็จ → เลื่อนนาฬิกาห้องไปเช้า 06:00 ของวันถัดไป
const SLEEP_ASK_MS = 20000;
const SLEEP_ACK_MS = 6000;
const MARRY_NO = new Set(["busy", "decline", "taken"]);
const GRACE_MS = 30000; // หัวห้องหลุด/ออก: รอก่อนปิดห้อง เผื่อเน็ตหลุดแป๊บเดียว
const PVP_RANGE = 100; // px: ระยะห่างสูงสุดที่เซิร์ฟเวอร์ยอมให้ตีโดน (ฝั่งผู้ตีตรวจ 44px เองอีกชั้น เผื่อแลคไว้)
const PVP_GAP = 220; // ms: ตีถี่สุดต่อคู่ผู้ตี→เป้าหมาย
const PVP_DMG_MAX = 40; // ดาเมจสูงสุดต่อการตีหนึ่งครั้ง (กัน client โกงส่งเลขใหญ่)
const PVP_KO_GAP = 2500; // ms: ประกาศ "ล้ม" ซ้ำคนเดิมไม่ถี่กว่านี้
const DUEL_MAX_MS = 190000; // ms: ดวลนานสุด (เกินนี้ = เสมอ ส่งกลับที่เดิม)
const DUEL_REQ_MS = 30000; // ms: คำท้าค้างได้นานสุด
const ROOM_MAX = 5; // คนสูงสุดต่อห้อง (คู่แต่งงานที่อยู่ด้วยกันนับเป็น 1 ที่)

// นับที่นั่ง: คู่แต่งงานที่ยืนยันตรงกันทั้งสองฝั่ง (sp ของแต่ละคนชี้หา uid อีกฝ่าย) นับรวมเป็น 1
function roomUnits(list) {
  let n = list.length;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.uid && b.uid && a.sp === b.uid && b.sp === a.uid) n--;
    }
  }
  return n;
}

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
    sw: TOOL_IDS.has(a.sw) ? a.sw : "",
    swn: a.swn | 0,
    fx: a.fx | 0,
    kn: a.kn | 0,
    pe: a.pe === 1 || a.pe === 2 ? a.pe : 0,
    bf: Math.max(0, Math.min(4, a.bf | 0)),
    kk: a.kk === 1 || a.kk === 2 ? a.kk : 0,
    eat: typeof a.eat === "string" ? a.eat : "",
    em: EMO_IDS.has(a.em) ? a.em : "",
    rad: !!a.rad,
    fish: !!a.fish,
    look: a.look,
    uid: a.uid || "",
  };
}

const FACT_OPS = new Set(["water", "plant", "fert", "harvest", "dig", "clear"]);
const FACT_WHY = new Set(["gone", "season", "off", "busy", "spot"]);
const TRADE_KEY = /^[A-Za-z0-9_:\-]{1,40}$/; // แลกได้ทุกไอเทม (ฝั่งเกมตรวจชื่อไอเทมจริงอีกชั้นตอน commit)

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
    this.pvp = false; // โหมด PvP ของห้อง (หัวห้องเปิด/ปิด)
    this.pvpT = new Map();
    this.pvpK = new Map();
    // จุดเริ่มนาฬิกาของห้อง เก็บถาวรครั้งเดียว (ห้องค้างนานก็ไม่เพี้ยน เพราะคำนวณจาก Date.now() เสมอ)
    ctx.blockConcurrencyWhile(async () => {
      let e = await ctx.storage.get("epoch");
      if (typeof e !== "number") {
        e = Date.now();
        await ctx.storage.put("epoch", e);
      }
      this.epoch = e;
      // วันที่ในเกมของ "หัวห้อง" ตอนสร้างห้อง (เก็บเป็น bd = วันหัวห้อง - เลขวันของห้อง) → วันห้อง = bd + k
      const bd = await ctx.storage.get("bd");
      this.bd = typeof bd === "number" ? bd : null;
      this.pvp = false; // PvP กลางเมืองยกเลิกแล้ว: ใช้ระบบท้าดวลที่ลานประลองแทน
    });
  }

  timeMsg() {
    return { type: "time", epoch: this.epoch, now: Date.now(), rate: CLOCK_RATE, start: CLOCK_START, len: CLOCK_LEN, bd: this.bd ?? null };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      if (new URL(request.url).pathname.endsWith("/status")) {
        const host = await this.getHost();
        return Response.json({ online: this.ctx.getWebSockets().length, host: !!host }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response("WebSocket endpoint | room.js v9 (room-cap-5 + pet + buff + mask-look + skills + uid-lock + room clock + marriage + sleep-together + saensuk social + shared-farm view + duel-arena)", { status: 426 });
    }

    const url = new URL(request.url);
    const playerId = (url.searchParams.get("player") || crypto.randomUUID()).slice(0, 40);
    const name = (url.searchParams.get("name") || "ผู้เล่น").slice(0, 16);

    // uid = ไอดีถาวรในเซฟ: 1 uid เชื่อมต่อได้ครั้งเดียว ใหม่เข้ามา → เตะอันเก่าออก (กันเปิดสองแท็บ/สองเครื่องแล้วแลกของกันเองปั๊มของ)
    const uidRaw = url.searchParams.get("uid") || "";
    const uid = UID_RE.test(uidRaw) ? uidRaw : "";
    const spRaw = url.searchParams.get("sp") || "";
    const sp = UID_RE.test(spRaw) ? spRaw : "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // สร้างห้อง (create) = เป็นหัวห้อง สร้างซ้ำไม่ได้ / เข้าห้อง (join) = ต้องมีหัวห้องอยู่ และห้องไม่เต็ม
    // ตรวจก่อนเตะการเชื่อมต่อเก่า เพื่อไม่ให้คำขอที่ถูกปฏิเสธไปทำลายการเชื่อมต่อเดิมของตัวเอง
    const mode = url.searchParams.get("mode") === "create" ? "create" : "join";
    const host = await this.getHost();
    const isHost = !!host && (host.playerId === playerId || (!!uid && host.uid === uid));
    const reject = (code, reason) => {
      server.accept();
      try { server.close(code, reason); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    };
    if (isHost) {
      if (host.gone) {
        await this.ctx.storage.put("host", { ...host, gone: null });
        await this.ctx.storage.deleteAlarm();
      }
    } else if (mode === "create") {
      if (host) return reject(4002, "room-exists");
      await this.ctx.storage.put("host", { playerId, uid, gone: null });
      // จำ "วันที่" ของหัวห้อง เพื่อให้ทุกคนที่เข้าห้องเห็นปฏิทินตรงกับหัวห้อง
      const dayRaw = Math.floor(Number(url.searchParams.get("day")));
      if (Number.isFinite(dayRaw) && dayRaw >= 1 && dayRaw <= 99999) {
        const k = Math.floor(((Date.now() - this.epoch) / 1000 * CLOCK_RATE) / CLOCK_LEN);
        this.bd = dayRaw - k;
        await this.ctx.storage.put("bd", this.bd);
      }
    } else {
      if (!host) return reject(4003, "no-host");
      const others = new Map();
      for (const w of this.ctx.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (!a?.playerId) continue;
        if (a.playerId === playerId || (uid && a.uid === uid)) continue;
        others.set(a.playerId, a);
      }
      if (roomUnits([...others.values(), { playerId, uid, sp }]) > ROOM_MAX) return reject(4004, "full");
    }

    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a?.playerId === playerId) {
        try { old.close(4001, "replaced"); } catch {}
      } else if (uid && a?.uid === uid) {
        try { old.close(4001, "uid-in-use"); } catch {}
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, name, uid, sp });

    const players = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.playerId && Number.isFinite(a.x) && Number.isFinite(a.y))
      .map(publicPlayer);

    server.send(JSON.stringify({ type: "welcome", playerId, players }));
    server.send(JSON.stringify({ type: "player:list", players }));
    server.send(JSON.stringify(this.timeMsg()));
    {
      const h2 = await this.getHost();
      const amHost = !!h2 && (h2.playerId === playerId || (!!uid && h2.uid === uid));
      server.send(JSON.stringify({ type: "pvp", on: !!this.pvp, host: amHost }));
    }
    try {
      const posts = (await this.ctx.storage.get("posts")) || [];
      server.send(JSON.stringify({ type: "social:list", posts: posts.map((p) => publicPost(p, uid || playerId)) }));
    } catch {}
    if (uid) {
      try {
        const pend = await this.ctx.storage.list({ prefix: "dv:" + uid + ":" });
        for (const [k, v] of pend) {
          server.send(JSON.stringify({ type: "divorce", uid: k.split(":")[2], name: v?.name || "ผู้เล่น" }));
          await this.ctx.storage.delete(k);
        }
      } catch {}
    }
    this.broadcast({ type: "player:join", player: { id: playerId, playerId, name } }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async getHost() {
    const h = await this.ctx.storage.get("host");
    if (!h) return null;
    if (h.gone && Date.now() - h.gone > GRACE_MS + 2000) return null; // เลยเวลารอแล้ว (alarm จะปิดห้อง)
    return h;
  }

  // หัวห้องออกจริง (ไม่มีการเชื่อมต่ออื่นของหัวห้องเหลืออยู่) → เริ่มนับถอยหลังปิดห้อง
  async hostLeft(player, leaving) {
    const host = await this.ctx.storage.get("host");
    if (!host || host.gone) return;
    if (!(host.playerId === player.playerId || (host.uid && host.uid === player.uid))) return;
    const still = this.ctx.getWebSockets().some((o) => {
      if (o === leaving) return false;
      const a = o.deserializeAttachment();
      return !!a && (a.playerId === host.playerId || (!!host.uid && a.uid === host.uid));
    });
    if (still) return;
    await this.ctx.storage.put("host", { ...host, gone: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + GRACE_MS);
  }

  // ครบเวลารอแล้วหัวห้องยังไม่กลับ → ปิดห้อง ลูกห้องเด้งออก (ห้องว่าง สร้างใหม่ได้)
  async alarm() {
    const host = await this.ctx.storage.get("host");
    if (!host || !host.gone) return;
    const left = host.gone + GRACE_MS - Date.now();
    if (left > 500) { await this.ctx.storage.setAlarm(Date.now() + left); return; }
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4005, "host-left"); } catch {}
    }
    await this.ctx.storage.delete("host");
    await this.ctx.storage.delete("bd");
    this.bd = null;
    this.pvp = false;
    await this.ctx.storage.delete("pvp");
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 14000) return; // 14000 เผื่อข้อความ farm เท่านั้น (เช็คต่อด้านล่าง)

    let data;
    try { data = JSON.parse(message); } catch { return; }
    if (!data || typeof data !== "object") return;
    if (message.length > 4000 && data.type !== "farm") return;

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
        sw: TOOL_IDS.has(data.sw) ? data.sw : "",
        swn: Number(data.swn) & 65535,
        fx: Number(data.fx) & 65535,
        kn: Number(data.kn) & 65535,
        pe: data.pe === 1 || data.pe === 2 ? data.pe : 0,
        bf: Math.max(0, Math.min(4, Number(data.bf) | 0)),
        kk: data.kk === 1 || data.kk === 2 ? data.kk : 0,
        eat: typeof data.eat === "string" && /^[df]:/.test(data.eat) ? data.eat.slice(0, 14) : "",
        em: EMO_IDS.has(data.em) ? data.em : "",
        rad: !!data.rad,
        fish: !!data.fish,
      };

      if (typeof data.sp === "string") next.sp = UID_RE.test(data.sp) ? data.sp : "";
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

    if (data.type === "farm") {
      return this.handleFarm(ws, data);
    }

    if (data.type === "fact") {
      return this.handleFact(ws, data);
    }

    if (data.type === "marry") {
      return this.handleMarry(ws, data);
    }

    if (data.type === "divorce") {
      return this.handleDivorce(ws, data);
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

    if (data.type === "duel") {
      return this.handleDuel(ws, data);
    }

    if (data.type === "pvp") {
      return this.handlePvpToggle(ws, data);
    }

    if (data.type === "pvp:hit") {
      return this.handlePvpHit(ws, data);
    }

    if (data.type === "pvp:ko") {
      return this.handlePvpKo(ws, data);
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

  // ===== PvP = ระบบท้าดวล =====
  // ตีกันในเมืองไม่ได้อีกแล้ว: แตะผู้เล่น → ท้าดวล → อีกฝ่ายรับ → ทั้งคู่วาปไปลานประลอง (ฉาก i:arena:<รหัสคู่>)
  // เซิร์ฟเวอร์ยอมให้ตีเฉพาะ "คู่ที่กำลังดวลกัน" ในลานประลองของคู่นั้นเท่านั้น
  async handlePvpToggle(ws) {
    try { ws.send(JSON.stringify({ type: "pvp", on: false, host: false })); } catch {}
  }

  handlePvpKo() {}

  duelSend(ws, obj) {
    try { ws.send(JSON.stringify({ type: "duel", ...obj })); } catch {}
  }

  handleDuel(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    if (!from) return;
    const act = String(d.act || "");
    const now = Date.now();

    // ยอมแพ้ / เลือดหมด (ผู้แพ้เป็นคนแจ้งเอง) → อีกฝ่ายชนะ
    if (act === "quit" || act === "ko") {
      if (!me.du) return;
      return this.endDuel(me.du.k, me.du.w, act === "ko" ? "ko" : "quit");
    }

    const to = String(d.to || "").slice(0, 40);
    if (!to || to === from) return;
    const peer = this.findWs(to);
    if (me.uid && peer?.deserializeAttachment()?.uid === me.uid) return;

    if (act === "req") {
      if (!peer) return this.duelSend(ws, { act: "no", from: to, reason: "gone" });
      const pa = peer.deserializeAttachment() || {};
      const okSc = (s) => s === "w" || (typeof s === "string" && s.startsWith("i:") && !s.startsWith("i:arena"));
      const pending = pa.dq && now - pa.dq.t < DUEL_REQ_MS && pa.dq.f !== from;
      if (me.du || pa.du || me.tr || pa.tr || pending || !okSc(me.sc) || me.sc !== pa.sc || me.sit || pa.sit) {
        return this.duelSend(ws, { act: "no", from: to, reason: "busy" });
      }
      this.setAtt(peer, { dq: { f: from, t: now } });
      return this.duelSend(peer, { act: "req", from, name: me.name || "ผู้เล่น" });
    }

    if (act === "no") {
      if (me.dq?.f === to) this.setAtt(ws, { dq: null });
      if (peer) this.duelSend(peer, { act: "no", from, reason: d.reason === "busy" ? "busy" : "decline" });
      return;
    }

    if (act === "cancel") {
      if (peer && peer.deserializeAttachment()?.dq?.f === from) {
        this.setAtt(peer, { dq: null });
        this.duelSend(peer, { act: "cancel", from });
      }
      return;
    }

    if (act === "yes") {
      const pa = peer?.deserializeAttachment() || {};
      if (!peer || !me.dq || me.dq.f !== to || now - me.dq.t > DUEL_REQ_MS || me.du || pa.du) {
        this.setAtt(ws, { dq: null });
        return this.duelSend(ws, { act: "cancel", from: to });
      }
      const k = now.toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
      this.setAtt(ws, { dq: null, du: { k, w: to, t: now } });
      this.setAtt(peer, { dq: null, du: { k, w: from, t: now } });
      this.duelSend(peer, { act: "start", from, name: me.name || "ผู้เล่น", k, side: 0 });
      this.duelSend(ws, { act: "start", from: to, name: pa.name || "ผู้เล่น", k, side: 1 });
      setTimeout(() => this.endDuel(k, null, "timeout"), DUEL_MAX_MS);
    }
  }

  // จบดวล: ล้างสถานะของทั้งคู่ + ส่ง end ให้ทั้งสองคน + ประกาศผลทั้งห้อง
  endDuel(k, winner, why) {
    const pair = [];
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a?.du?.k === k) pair.push([w, a]);
    }
    if (!pair.length) return;
    for (const [w, a] of pair) {
      try { this.setAtt(w, { du: null }); } catch {}
      this.pvpT.delete(a.playerId + ">" + a.du.w);
    }
    for (const [w] of pair) this.duelSend(w, { act: "end", k, w: winner || "", why });
    if (winner) {
      const win = pair.find(([, a]) => a.playerId === winner)?.[1] || pair.find(([, a]) => a.du.w === winner)?.[1];
      const lose = pair.find(([, a]) => a.playerId !== winner)?.[1];
      const wn = pair.find(([, a]) => a.playerId === winner)?.[1]?.name || this.findWs(winner)?.deserializeAttachment()?.name || win?.name || "ผู้เล่น";
      this.broadcast({ type: "duel", act: "result", win: wn, lose: lose?.name || "ผู้เล่น", why });
    }
  }

  // ผู้ตีส่งมา → เซิร์ฟเวอร์ตรวจ (ต้องเป็นคู่ดวลเดียวกัน/อยู่ลานประลองเดียวกัน/ระยะ/ความถี่/เพดานดาเมจ) แล้วส่งต่อให้เป้าหมายคนเดียว
  handlePvpHit(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId || !me.du || me.sit) return;
    const to = String(d.to || "").slice(0, 40);
    if (!to || to !== me.du.w) return;
    const now = Date.now();
    const key = me.playerId + ">" + to;
    if (now - (this.pvpT.get(key) || 0) < PVP_GAP) return;
    const tw = this.findWs(to);
    const tg = tw && tw.deserializeAttachment();
    if (!tg || !tg.du || tg.du.k !== me.du.k || tg.du.w !== me.playerId) return;
    if (typeof me.sc !== "string" || !me.sc.startsWith("i:arena:") || me.sc !== tg.sc) return;
    if (![me.x, me.y, tg.x, tg.y].every(Number.isFinite)) return;
    if (Math.hypot(me.x - tg.x, me.y - tg.y) > PVP_RANGE) return;
    this.pvpT.set(key, now);
    if (this.pvpT.size > 200) this.pvpT.clear();
    const dmg = Math.max(1, Math.min(PVP_DMG_MAX, Math.floor(Number(d.dmg) || 0)));
    try {
      tw.send(JSON.stringify({ type: "pvp:hit", from: me.playerId, name: me.name || "ผู้เล่น", dmg, cr: d.cr ? 1 : 0 }));
    } catch {}
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

  // ไร่ร่วมของคู่แต่งงาน: ส่งภาพสรุปไร่ (พิกัด/น้ำ/ปุ๋ย/พืช) ให้ผู้เล่นเป้าหมายเท่านั้น ไม่เก็บอะไรไว้ฝั่งเซิร์ฟเวอร์
  // เซิร์ฟเวอร์ใส่ uid ของผู้ส่งเอง ฝั่งรับจะรับเฉพาะ uid ที่ตรงกับคู่ในเซฟตัวเอง
  handleFarm(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId || !me.uid) return;
    const to = String(d.to || "").slice(0, 40);
    if (!to || to === me.playerId) return;
    const peer = this.findWs(to);
    if (!peer) return;
    if ((peer.deserializeAttachment() || {}).uid === me.uid) return;
    const send = (obj) => { try { peer.send(JSON.stringify({ type: "farm", from: me.playerId, uid: me.uid, ...obj })); } catch {} };
    if (d.off) return send({ off: 1 });
    if (!Array.isArray(d.s)) return;
    const now = Date.now();
    if (now - (me.lastFarm || 0) < 400) return;
    this.setAtt(ws, { lastFarm: now });
    const s = [];
    for (const e of d.s.slice(0, 200)) {
      if (!Array.isArray(e)) continue;
      const crop = typeof e[3] === "string" && /^[A-Za-z0-9_]{1,16}$/.test(e[3]) ? e[3] : 0;
      s.push([e[0] | 0, e[1] | 0, e[2] & 7, crop, Math.max(0, Math.min(99, Number(e[4]) || 0)), Math.max(0, Math.min(9, e[5] | 0))]);
    }
    send({ s });
  }

  // ช่วยงานในไร่ของคู่: ส่งคำขอ (รดน้ำ/ปลูก/ใส่ปุ๋ย/เก็บเกี่ยว/ขุด/ถอนต้นเหี่ยว) ไปให้เจ้าของไร่ตัดสิน แล้วส่งคำตอบ ok/no กลับ
  // เซิร์ฟเวอร์ใส่ from/uid ของผู้ส่งเอง และกรองค่าทุกช่องก่อนส่งต่อ (ฝั่งรับเช็คเองอีกชั้นว่า uid ตรงกับคู่ในเซฟ)
  handleFact(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId || !me.uid) return;
    const to = String(d.to || "").slice(0, 40);
    if (!to || to === me.playerId) return;
    const peer = this.findWs(to);
    if (!peer) return;
    if ((peer.deserializeAttachment() || {}).uid === me.uid) return;
    const op = String(d.op || "");
    const reply = op === "ok" || op === "no";
    if (!reply && !FACT_OPS.has(op)) return;
    if (!reply) {
      const now = Date.now();
      if (now - (me.lastFact || 0) < 80) return;
      this.setAtt(ws, { lastFact: now });
    }
    const out = { type: "fact", from: me.playerId, uid: me.uid, op, x: Number(d.x) | 0, y: Number(d.y) | 0 };
    if (reply) {
      const k = String(d.k || "");
      if (!FACT_OPS.has(k)) return;
      out.k = k;
      if (op === "no") out.why = FACT_WHY.has(String(d.why || "")) ? String(d.why) : "busy";
    }
    const t = String(d.t || "");
    if (/^[A-Za-z0-9_]{1,16}$/.test(t)) out.t = t;
    try { peer.send(JSON.stringify(out)); } catch {}
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
      if (pending || me.du || pa.du) return this.marrySend(ws, { act: "no", from: to, reason: "busy" });
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

  // หย่า (ผู้เล่นไปขอที่ลุงชัยในเกมแล้ว): แจ้งอีกฝ่ายตาม uid ถ้าออนไลน์ส่งทันที ถ้าไม่อยู่เก็บไว้ส่งตอนเข้าห้อง
  // uid ผู้ส่งมาจากเซิร์ฟเวอร์เอง (ปลอมไม่ได้) ฝั่งเกมจะทำงานต่อเมื่อ uid ตรงกับคู่ที่บันทึกไว้เท่านั้น
  async handleDivorce(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.uid) return;
    const target = String(d.uid || "").slice(0, 40);
    if (!UID_RE.test(target) || target === me.uid) return;
    const msg = JSON.stringify({ type: "divorce", uid: me.uid, name: me.name || "ผู้เล่น" });
    let sent = false;
    for (const w of this.ctx.getWebSockets()) {
      if (w.deserializeAttachment()?.uid === target) { try { w.send(msg); sent = true; } catch {} }
    }
    if (!sent) await this.ctx.storage.put("dv:" + target + ":" + me.uid, { name: me.name || "ผู้เล่น", t: Date.now() });
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
      if (me.tr || pa.tr || pending || me.du || pa.du) return this.tradeSend(ws, { act: "no", from: to, reason: "busy" });
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
      if (player.du) this.endDuel(player.du.k, player.du.w, "left"); // คู่ต่อสู้หลุด/ออก = อีกฝ่ายชนะ
      for (const w of this.ctx.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (a?.dq?.f === player.playerId) {
          this.setAtt(w, { dq: null });
          this.duelSend(w, { act: "cancel", from: player.playerId });
        }
      }
      this.ctx.storage.delete("av:" + player.playerId).catch(() => {});
      this.hostLeft(player, ws).catch(() => {});
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
