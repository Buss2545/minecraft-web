import { DurableObject } from "cloudflare:workers";

const DIRS = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const LOOK_KEYS = ["hair", "skin", "shirt", "pants", "g", "hs", "hat", "fit", "face"];
// อุปกรณ์ที่ผู้เล่นถืออยู่: จอบ/บัวรดน้ำ/ขวาน/ค้อนทุบหิน/เบ็ด/ดาบ/เมล็ดพืช/เคียว-มือ (hide=true คือมือเปล่า)
const TOOL_IDS = new Set(["hoe", "can", "axe", "pick", "rod", "sword", "seed", "hand"]);
const PERS_IDS = new Set(["cheer", "shy", "dreamer", "serious", "playful", "warm", "earthy", "explorer", "generous", "calm"]);
const EMO_IDS = new Set(["wave", "dance", "cheer", "sit", "i_stretch", "i_yawn", "i_look", "i_drowsy", "pee", "poop", "kiss"]); // อีโมตท่าทางในมัลติเพลเยอร์ (ต้องตรงกับ EMOTES ในเกม) + ท่าว่าง/ท่าง่วง (i_*) ที่เพื่อนเห็น (ต้องตรงกับ IDLE_W ในเกม)
// นาฬิกากลางของห้อง (ซิงก์เฉพาะ "เวลาในวัน"): 1 นาทีเกม = 1 วินาทีจริง, วันของห้อง = 06:00 → 26:00 (1200 นาทีเกม) แล้ววนกลับ 06:00
const CLOCK_RATE = 1.0;
const CLOCK_START = 360;
const CLOCK_LEN = 1200;
const UID_RE = /^[A-Za-z0-9_\-]{6,40}$/;
const MARRY_STAGES = new Set(["date", "wed", "party", "kid", "kiss"]);
// นอนพร้อมกัน: ถามทุกคนในห้อง (รอได้ 20 วิ) → ทุกคนนอนเสร็จ → เลื่อนนาฬิกาห้องไปเช้า 06:00 ของวันถัดไป
const SLEEP_ASK_MS = 20000;
const SLEEP_ACK_MS = 6000;
const MARRY_NO = new Set(["busy", "decline", "taken"]);
const HSK_RE = /^i:player:[A-Za-z0-9_\-]{1,31}$/; // คีย์ซีนห้องนอนในบ้าน (ใช้เลือก "นอนบ้านใคร")
const GRACE_MS = 30000; // หัวห้องหลุด/ออก: รอก่อนปิดห้อง เผื่อเน็ตหลุดแป๊บเดียว
const PVP_RANGE = 100; // px: ระยะห่างสูงสุดที่เซิร์ฟเวอร์ยอมให้ตีโดน (ฝั่งผู้ตีตรวจ 44px เองอีกชั้น เผื่อแลคไว้)
const PVP_GAP = 220; // ms: ตีถี่สุดต่อคู่ผู้ตี→เป้าหมาย
const PVP_DMG_MAX = 40; // ดาเมจสูงสุดต่อการตีหนึ่งครั้ง (กัน client โกงส่งเลขใหญ่)
const DUEL_HP = 100; // HP คงที่ของทั้งคู่ในลานประลอง (เซิร์ฟเวอร์นับเอง ไม่เชื่อ client)
const DUEL_INTRO_MS = 2300; // ms: ช่วงคัตซีนต้นดวล ตี/โดนตีไม่ได้
const DUEL_INV_MS = 700; // ms: อมตะสั้นๆ หลังโดนตี
const DUEL_MAX_MS = 190000; // ms: ดวลนานสุด (เกินนี้ = เสมอ ส่งกลับที่เดิม)
const DUEL_REQ_MS = 30000; // ms: คำท้าค้างได้นานสุด
const CARRY_RANGE = 160; // px: ระยะสูงสุดที่ขออุ้มได้ (เผื่อแลค)
const ROOM_MAX = 6; // คนสูงสุดต่อห้อง รวมหัวห้อง (คู่แต่งงานที่อยู่ด้วยกันนับเป็น 1 ที่)

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

// แผงขายของ (ตลาดเมืองใหญ่) ของผู้เล่น: ส่งต่อให้เพื่อนเห็นลูกค้า/ระดับแผง — ไม่เก็บใน attachment (จำกัด 2KB) แค่ relay
function cleanStall(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.c)) return null;
  const c = [];
  for (const a of v.c.slice(0, 3)) {
    if (!Array.isArray(a)) continue;
    const x = Number(a[0]), y = Number(a[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    c.push([
      Math.max(0, Math.min(20000, Math.round(x))),
      Math.max(0, Math.min(20000, Math.round(y))),
      typeof a[2] === "string" && a[2].length === 1 && "udlr".includes(a[2]) ? a[2] : "u",
      Math.max(0, Math.min(2, Number(a[3]) | 0)),
      Math.abs(Number(a[4]) | 0) % 2147483647,
      Math.max(0, Math.min(4, Number(a[5]) | 0)),
      typeof a[6] === "string" && /^[A-Za-z0-9_:\-]{1,24}$/.test(a[6]) ? a[6] : "",
      Math.max(1, Math.min(9, Number(a[7]) | 0 || 1)),
      typeof a[8] === "string" ? a[8].slice(0, 12) : "",
      typeof a[9] === "string" ? a[9].slice(0, 4) : "",
    ]);
  }
  return { lv: Math.max(1, Math.min(5, Number(v.lv) | 0 || 1)), c };
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
    ps: PERS_IDS.has(a.ps) ? a.ps : "",
    wc: a.wc === 1 || a.wc === 2 ? a.wc : 0,
    fd: a.fd === 1 ? 1 : 0,
    um: a.um === 1 ? 1 : 0, // กางร่มกันฝนอยู่ (เพื่อนเห็นด้วย)
    bk: a.bk >= 1 && a.bk <= 3 ? a.bk | 0 : 0, // ขี่จักรยาน (1=ขี่ 2=กำลังขึ้น 3=กำลังลง)
    zz: a.zz === 1 ? 1 : 0,
    hsk: typeof a.hsk === "string" ? a.hsk : "",
    pst: a.pst === 1 ? 1 : 0,
    pgx: a.pst === 1 ? a.pgx | 0 : 0,
    pgy: a.pst === 1 ? a.pgy | 0 : 0,
    bf: Math.max(0, Math.min(4, a.bf | 0)),
    kk: Number.isInteger(a.kk) && a.kk >= 1 && a.kk <= 4 ? a.kk : 0,
    eat: typeof a.eat === "string" ? a.eat : "",
    em: EMO_IDS.has(a.em) ? a.em : "",
    rad: Math.max(0, Math.min(9, Number(a.rad) | 0)),
    fish: !!a.fish,
    dn: a.dn === 1 || a.dn === 2 ? a.dn : 0,
    cb: a.dn === 2 && typeof a.cr === "string" ? a.cr.slice(0, 40) : "",
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
      this.jb = (await ctx.storage.get("jb")) || null; // วิทยุห้อง (MP3 ที่หัวห้อง/แอดมินเปิด)
      this.pvp = false; // PvP กลางเมืองยกเลิกแล้ว: ใช้ระบบท้าดวลที่ลานประลองแทน
    });
  }

  timeMsg() {
    return { type: "time", epoch: this.epoch, now: Date.now(), rate: CLOCK_RATE, start: CLOCK_START, len: CLOCK_LEN, bd: this.bd ?? null };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      const pth = new URL(request.url).pathname;
      if (pth === "/api/notice" || pth === "/api/admin") return this.noticeApi(request, pth);
      if (new URL(request.url).pathname.endsWith("/status")) {
        const host = await this.getHost();
        // ชื่อหัวห้อง: ใช้ชื่อจากการเชื่อมต่อปัจจุบันก่อน (ล่าสุดสุด) ไม่งั้นใช้ชื่อที่จำไว้ตอนสร้างห้อง
        let hostName = host?.name || "";
        if (host) {
          for (const w of this.ctx.getWebSockets()) {
            const a = w.deserializeAttachment();
            if (a && (a.playerId === host.playerId || (host.uid && a.uid === host.uid)) && a.name) { hostName = a.name; break; }
          }
        }
        const atts = this.ctx.getWebSockets().map((w) => w.deserializeAttachment()).filter((a) => a && a.playerId);
        const seats = roomUnits(atts); // ที่นั่งที่ใช้จริง (คู่แต่งงานนับ 1) ตรงกับที่ตัดคนเข้าห้อง
        return Response.json({ online: this.ctx.getWebSockets().length, seats, host: !!host, hostName }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response("WebSocket endpoint | room.js v9 (room-cap-5 + pet + buff + mask-look + skills + uid-lock + room clock + marriage + sleep-together + sleep-house/slots + saensuk social + shared-farm view + duel-arena + carry)", { status: 426 });
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
      await this.ctx.storage.put("host", { playerId, uid, name, gone: null });
      await this.clearVisited(); // ห้องใหม่ = ทุกคนนับเป็นเข้าห้องครั้งแรกอีกครั้ง
      // ห้องใหม่ = เริ่มนาฬิกาใหม่เสมอ: เวลา 06:00 ของวันห้องที่ 0 (ไม่ใช้เวลาเก่าของห้องก่อนหน้า)
      this.epoch = Date.now();
      await this.ctx.storage.put("epoch", this.epoch);
      this.sl = null; // เคลียร์สถานะนอนค้างจากห้องเก่า
      this.jb = null;
      await this.ctx.storage.delete("jb");
      // จำ "วันที่" ของหัวห้อง เพื่อให้ทุกคนที่เข้าห้องเห็นปฏิทินตรงกับหัวห้อง (k = 0 เพราะเพิ่งเริ่มนาฬิกา)
      const dayRaw = Math.floor(Number(url.searchParams.get("day")));
      if (Number.isFinite(dayRaw) && dayRaw >= 1 && dayRaw <= 99999) {
        this.bd = dayRaw;
        await this.ctx.storage.put("bd", this.bd);
      } else {
        this.bd = null;
        await this.ctx.storage.delete("bd");
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

    // เข้าห้องนี้ครั้งแรกหรือไม่ (ไคลเอนต์ใช้เล่นคัทซีนรถสองแถวมาส่ง) — จำตาม uid ในเซฟ ต่อเน็ตหลุดแล้วกลับมาไม่นับเป็นครั้งแรก
    let first = false;
    if (uid) {
      try {
        const vk = "vis:" + uid;
        if (!(await this.ctx.storage.get(vk))) {
          first = true;
          await this.ctx.storage.put(vk, 1);
        }
      } catch {}
    }
    server.send(JSON.stringify({ type: "welcome", playerId, players, first }));
    server.send(JSON.stringify({ type: "player:list", players }));
    server.send(JSON.stringify(this.timeMsg()));
    if (this.jb) server.send(JSON.stringify(this.jbMsg()));
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

  // ประกาศหน้าแรก (อัปเดต/ปิดปรับปรุง) — อ่านได้ทุกคน, แก้ได้เฉพาะแอดมิน (ตรวจรหัสที่เซิร์ฟเวอร์ ไม่ได้อยู่ในหน้าเว็บ)
  // ตั้งรหัสจริงด้วย secret ชื่อ ADMIN_PASSWORD (ถ้าไม่ตั้งจะใช้ค่าในโค้ด)
  // ตรวจรหัสแอดมิน (ใช้ร่วมกับประกาศหน้าแรก) ผิด 5 ครั้งติด → ล็อก 5 นาที
  async adminCheck(pw) {
    const now = Date.now();
    const lock = (await this.ctx.storage.get("adm")) || { n: 0, until: 0 };
    if (lock.until > now) return { ok: false, err: "locked", wait: Math.ceil((lock.until - now) / 1000) };
    if (String(pw || "") !== String(this.env.ADMIN_PASSWORD || "marijpadmin2026")) {
      lock.n = (lock.n | 0) + 1;
      if (lock.n >= 5) { lock.until = now + 300000; lock.n = 0; }
      await this.ctx.storage.put("adm", lock);
      return { ok: false, err: "pw" };
    }
    if (lock.n || lock.until) await this.ctx.storage.put("adm", { n: 0, until: 0 });
    return { ok: true };
  }

  jbMsg() {
    const j = this.jb;
    return { type: "jb", url: j?.url || "", title: j?.title || "", by: j?.by || "", startAt: j?.startAt || 0, now: Date.now() };
  }

  // วิทยุห้อง: เฉพาะหัวห้อง (หรือแอดมินที่ใส่รหัส) ตั้ง/หยุดเพลงได้ ทุกคนในห้องเล่นเพลงเดียวกันที่ตำแหน่งเดียวกัน
  async handleJb(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId) return;
    const err = (e, extra) => { try { ws.send(JSON.stringify({ type: "jb:err", err: e, ...(extra || {}) })); } catch {} };
    const host = await this.getHost();
    let ok = !!host && (host.playerId === me.playerId || (!!host.uid && me.uid === host.uid));
    if (!ok) {
      if (!d.pw) return err("perm");
      const r = await this.adminCheck(d.pw);
      if (!r.ok) return err(r.err, r.wait ? { wait: r.wait } : null);
    }
    const now = Date.now();
    if (this.jbT && now - this.jbT < 1500) return; // กันกดรัว
    this.jbT = now;
    if (d.type === "jb:stop") {
      this.jb = null;
      await this.ctx.storage.delete("jb");
      this.broadcast(this.jbMsg());
      return;
    }
    const url = String(d.url || "").trim();
    let okUrl = false;
    try { okUrl = url.length <= 600 && !/[\s\u0000-\u001f]/.test(url) && new URL(url).protocol === "https:"; } catch {}
    // ไฟล์เพลงที่วางในโฟลเดอร์ music/ ของเว็บเอง (เช่น /music/song1.mp3) ใช้แทนลิงก์ได้
    if (!okUrl) okUrl = /^\/music\/[A-Za-z0-9_.-]{1,80}\.(mp3|ogg|m4a|wav|opus)$/i.test(url);
    if (!okUrl) return err("url");
    const title = Array.from(String(d.title || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, 40).join("");
    this.jb = { url, title, by: String(me.name || "หัวห้อง").slice(0, 16), startAt: now };
    await this.ctx.storage.put("jb", this.jb);
    this.broadcast(this.jbMsg());
  }

  async noticeApi(request, pth) {
    const H = { "Cache-Control": "no-store" };
    const items = (await this.ctx.storage.get("notice")) || [];
    if (pth === "/api/notice") return Response.json({ items }, { headers: H });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let d;
    try { d = await request.json(); } catch { return Response.json({ ok: false, err: "bad" }, { status: 400, headers: H }); }
    const now = Date.now();
    const lock = (await this.ctx.storage.get("adm")) || { n: 0, until: 0 };
    if (lock.until > now) return Response.json({ ok: false, err: "locked", wait: Math.ceil((lock.until - now) / 1000) }, { status: 429, headers: H });
    const pw = String(this.env.ADMIN_PASSWORD || "marijpadmin2026");
    if (String(d.pw || "") !== pw) {
      lock.n = (lock.n | 0) + 1; // ผิด 5 ครั้งติด → ล็อก 5 นาที กันเดารหัส
      if (lock.n >= 5) { lock.until = now + 300000; lock.n = 0; }
      await this.ctx.storage.put("adm", lock);
      return Response.json({ ok: false, err: "pw" }, { status: 401, headers: H });
    }
    if (lock.n || lock.until) await this.ctx.storage.put("adm", { n: 0, until: 0 });
    let list = items;
    if (d.op === "add") {
      const text = Array.from(String(d.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, 200).join("");
      const k = d.k === "maint" || d.k === "update" ? d.k : "info";
      // at = เวลาที่แอดมินตั้งเอง (ms) — ไม่ใส่/ผิดรูปแบบ/ห่างเกิน 1 ปี → ใช้เวลาปัจจุบัน
      let at = Number(d.at);
      if (!Number.isFinite(at) || Math.abs(at - now) > 366 * 86400000) at = now;
      if (text) list = [{ id: crypto.randomUUID().slice(0, 8), k, text, t: now, at: Math.round(at) }, ...items].slice(0, 6);
    } else if (d.op === "del") {
      list = items.filter((x) => x.id !== String(d.id || ""));
    } else if (d.op === "clear") {
      list = [];
    }
    if (list !== items) await this.ctx.storage.put("notice", list);
    return Response.json({ ok: true, items: list }, { headers: H });
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
    await this.rearm();
  }

  // alarm เดียวใช้ร่วมกัน: ตั้งปลุกที่เวลาใกล้สุดระหว่าง "ปิดห้องหลังหัวห้องออก" กับ "ดวลหมดเวลา"
  // (เวลาดวลอ่านจาก attachment ของ WebSocket ซึ่งอยู่รอดตอน DO รีสตาร์ท/ไฮเบอร์เนต ต่างจาก setTimeout ที่หายไป)
  async rearm() {
    let next = Infinity;
    const host = await this.ctx.storage.get("host");
    if (host && host.gone) next = host.gone + GRACE_MS;
    for (const ws of this.ctx.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (a && a.du) next = Math.min(next, (a.du.t || 0) + DUEL_MAX_MS);
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 50));
  }

  // ล้างรายชื่อ uid ที่เคยเข้าห้อง (ตอนสร้างห้องใหม่ / ห้องปิด)
  async clearVisited() {
    try {
      const all = await this.ctx.storage.list({ prefix: "vis:" });
      for (const k of all.keys()) await this.ctx.storage.delete(k);
    } catch {}
  }

  async alarm() {
    const now = Date.now();
    // 1) ดวลที่เกินเวลา = เสมอ ส่งกลับที่เดิม
    const ended = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (a && a.du && !ended.has(a.du.k) && now - (a.du.t || 0) >= DUEL_MAX_MS - 500) {
        ended.add(a.du.k);
        this.endDuel(a.du.k, null, "timeout");
      }
    }
    // 2) ครบเวลารอแล้วหัวห้องยังไม่กลับ → ปิดห้อง ลูกห้องเด้งออก (ห้องว่าง สร้างใหม่ได้)
    const host = await this.ctx.storage.get("host");
    if (host && host.gone && host.gone + GRACE_MS - now <= 500) {
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(4005, "host-left"); } catch {}
      }
      await this.ctx.storage.delete("host");
      await this.ctx.storage.delete("bd");
      this.bd = null;
      this.epoch = Date.now(); // ปิดห้อง = ทิ้งเวลาเก่า ห้องถัดไปเริ่ม 06:00 ใหม่
      await this.ctx.storage.put("epoch", this.epoch);
      this.sl = null;
      this.jb = null;
      await this.ctx.storage.delete("jb");
      this.pvp = false;
      await this.ctx.storage.delete("pvp");
      await this.clearVisited();
    }
    await this.rearm();
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
        ps: PERS_IDS.has(data.ps) ? data.ps : "",
        // สัตว์เลี้ยง "นั่งรอ": ส่งพิกัดที่มันนั่งอยู่ให้เพื่อนเห็นตรงกัน
        pst: data.pst === 1 && Number.isFinite(Number(data.pgx)) && Number.isFinite(Number(data.pgy)) ? 1 : 0,
        pgx: Math.max(0, Math.min(20000, Math.round(Number(data.pgx)) || 0)),
        pgy: Math.max(0, Math.min(20000, Math.round(Number(data.pgy)) || 0)),
        bf: Math.max(0, Math.min(4, Number(data.bf) | 0)),
        kk: Number.isInteger(data.kk) && data.kk >= 1 && data.kk <= 4 ? data.kk : 0,
        eat: typeof data.eat === "string" && /^[df]:/.test(data.eat) ? data.eat.slice(0, 14) : "",
        em: EMO_IDS.has(data.em) ? data.em : "",
        rad: Math.max(0, Math.min(9, Number(data.rad) | 0)),
        fish: !!data.fish,
        dn: data.dn === 1 || data.dn === 2 ? data.dn : 0,
        wc: data.wc === 1 || data.wc === 2 ? data.wc : 0,
        fd: data.fd === 1 ? 1 : 0,
        um: data.um === 1 ? 1 : 0, // กางร่มกันฝนอยู่ (เพื่อนเห็นด้วย)
        bk: data.bk >= 1 && data.bk <= 3 ? data.bk | 0 : 0, // ขี่จักรยาน (1=ขี่ 2=กำลังขึ้น 3=กำลังลง)
        zz: data.zz === 1 ? 1 : 0, // กำลังนอนบนที่นอน (เพื่อนในซีนเดียวกันจะเห็นท่านอน)
        hsk: typeof data.hsk === "string" && HSK_RE.test(data.hsk) ? data.hsk : "",
      };

      if (typeof data.sp === "string") next.sp = UID_RE.test(data.sp) ? data.sp : "";
      if (!player.uid && typeof data.uid === "string" && UID_RE.test(data.uid)) next.uid = data.uid; // uid ล็อกตั้งแต่ตอนเชื่อมต่อ แก้ทีหลังไม่ได้
      if (!player.playerId && typeof data.id === "string" && data.id) next.playerId = data.id.slice(0, 40); // playerId ล็อกตั้งแต่ตอนเชื่อมต่อ (กันปลอมตัวเป็นคนอื่น)
      if (typeof data.name === "string" && data.name) next.name = data.name.slice(0, 16);

      const look = cleanLook(data.look);
      if (look) next.look = look;
      // ลุกขึ้น/หายล้ม → ปล่อยลิงก์อุ้มและแจ้งคนอุ้ม
      if (!next.dn && next.cr) {
        const pw = this.findWs(next.cr);
        if (pw) {
          const pc = pw.deserializeAttachment() || {};
          if (pc.cy === next.playerId) {
            this.setAtt(pw, { cy: "" });
            try { pw.send(JSON.stringify({ type: "carry", act: "drop", from: next.playerId })); } catch {}
          }
        }
        next.cr = "";
        next.crFun = 0;
      }
      ws.serializeAttachment(next);

      const stl = cleanStall(data.stl);
      this.broadcast({ type: "player:state", player: stl ? { ...publicPlayer(next), stl } : publicPlayer(next) }, ws);
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

    if (data.type === "kid") {
      return this.handleKid(ws, data);
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

    if (data.type === "carry") {
      return this.handleCarry(ws, data);
    }

    if (data.type === "pvp") {
      return this.handlePvpToggle(ws, data);
    }

    if (data.type === "jb:set" || data.type === "jb:stop") {
      return this.handleJb(ws, data);
    }

    if (data.type === "pvp:hit") {
      return this.handlePvpHit(ws, data);
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


  duelSend(ws, obj) {
    try { ws.send(JSON.stringify({ type: "duel", ...obj })); } catch {}
  }

  handleDuel(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    if (!from) return;
    const act = String(d.act || "");
    const now = Date.now();

    // ยอมแพ้ → อีกฝ่ายชนะ (เลือดหมดเซิร์ฟเวอร์ตัดสินเองใน handlePvpHit ไม่รับ "ko" จาก client แล้ว)
    if (act === "quit") {
      if (!me.du) return;
      return this.endDuel(me.du.k, me.du.w, "quit");
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
      this.setAtt(ws, { dq: null, du: { k, w: to, t: now, hp: DUEL_HP, iv: 0 } });
      this.setAtt(peer, { dq: null, du: { k, w: from, t: now, hp: DUEL_HP, iv: 0 } });
      this.duelSend(peer, { act: "start", from, name: me.name || "ผู้เล่น", k, side: 0 });
      this.duelSend(ws, { act: "start", from: to, name: pa.name || "ผู้เล่น", k, side: 1 });
      this.rearm().catch(() => {}); // ตั้ง alarm จับเวลาดวล (ทนรีสตาร์ท)
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
    if (now - (me.du.t || 0) < DUEL_INTRO_MS) return; // ยังอยู่ในคัตซีนต้นดวล
    if (now - (tg.du.iv || 0) < DUEL_INV_MS) return; // เป้าหมายอมตะสั้นๆ หลังโดนตี
    this.pvpT.set(key, now);
    if (this.pvpT.size > 200) this.pvpT.clear();
    const dmg = Math.max(1, Math.min(PVP_DMG_MAX, Math.floor(Number(d.dmg) || 0)));
    // เซิร์ฟเวอร์เป็นคนนับ HP: ทั้งคู่เริ่ม DUEL_HP เท่ากัน หมด = แพ้ทันที (ไม่ต้องรอผู้แพ้แจ้ง จึงโกงให้เสมอไม่ได้)
    const hp = Math.max(0, (Number.isFinite(tg.du.hp) ? tg.du.hp : DUEL_HP) - dmg);
    this.setAtt(tw, { du: { ...tg.du, hp, iv: now } });
    try {
      tw.send(JSON.stringify({ type: "pvp:hit", from: me.playerId, name: me.name || "ผู้เล่น", dmg, cr: d.cr ? 1 : 0, hp, max: DUEL_HP }));
    } catch {}
    if (hp <= 0) this.endDuel(me.du.k, me.playerId, "ko");
  }

  // ===== ระบบอุ้มคนล้ม =====
  // คนล้ม (dn=1) ต้องกดยอมก่อน → เซิร์ฟเวอร์จับคู่ cy(คนอุ้ม→คนล้ม) / cr(คนล้ม→คนอุ้ม)
  // ส่งถึงคลินิก/โรงพยาบาล (sc = i:clinic / i:hospital) แล้วคนอุ้มส่ง deliver → คนล้มได้รับ heal
  handleCarry(ws, d) {
    const me = ws.deserializeAttachment() || {};
    const from = me.playerId;
    const to = String(d.to || "").slice(0, 40);
    const act = String(d.act || "");
    if (!from || !to || to === from) return;
    const peer = this.findWs(to);
    const pa = peer ? peer.deserializeAttachment() || {} : null;
    const out = (w, o) => { try { w.send(JSON.stringify({ type: "carry", ...o })); } catch {} };
    if (!peer) { if (act === "req") out(ws, { act: "no", from: to, reason: "gone" }); return; }
    if (me.uid && pa.uid === me.uid) return;

    if (act === "req") {
      const near = [me.x, me.y, pa.x, pa.y].every(Number.isFinite) && Math.hypot(me.x - pa.x, me.y - pa.y) <= CARRY_RANGE;
      const fun = d.fun === 1; // อุ้มเล่นๆ: เป้าหมายไม่ต้องล้ม แต่ต้องว่างทั้งคู่
      const bad = fun
        ? me.dn || me.cy || me.cr || pa.dn || pa.cy || pa.cr || me.sc !== "w" || pa.sc !== "w" || !near
        : me.dn || me.cy || pa.dn !== 1 || pa.cr || me.sc !== "w" || pa.sc !== "w" || !near;
      if (bad) return out(ws, { act: "no", from: to, reason: "busy" });
      return out(peer, { act: "req", from, name: me.name || "ผู้เล่น", fun: fun ? 1 : 0 });
    }
    if (act === "ok" && d.fun === 1) { // คนถูกอุ้มเล่นๆ (ยังไม่ล้ม) → คนอุ้ม
      if (me.dn || me.cr || me.cy || pa.dn || pa.cy || pa.cr) return out(peer, { act: "no", from, reason: "busy" });
      this.setAtt(ws, { cr: to, crFun: 1 });
      this.setAtt(peer, { cy: from });
      return out(peer, { act: "ok", from, fun: 1 });
    }
    if (act === "ok") { // คนล้ม → คนอุ้ม
      if (me.dn !== 1 || me.cr || (pa.cy && pa.cy !== from)) return out(peer, { act: "no", from, reason: "busy" });
      this.setAtt(ws, { cr: to });
      this.setAtt(peer, { cy: from });
      return out(peer, { act: "ok", from });
    }
    if (act === "revive") { // คนมียา → คนล้ม: ชุบให้ฟื้นทันที (ฝั่งคนใช้หักยาเมื่อได้ "revived")
      const near = [me.x, me.y, pa.x, pa.y].every(Number.isFinite) && Math.hypot(me.x - pa.x, me.y - pa.y) <= CARRY_RANGE;
      if (me.dn || !pa.dn || pa.crFun || !near) return out(ws, { act: "no", from: to, reason: "busy" });
      const cw = pa.cr ? this.findWs(pa.cr) : null;
      this.setAtt(peer, { dn: 0, cr: "", cy: "" });
      if (cw && (cw.deserializeAttachment() || {}).cy === to) { this.setAtt(cw, { cy: "" }); out(cw, { act: "drop", from: to }); }
      out(ws, { act: "revived", from: to });
      return out(peer, { act: "revive", from, name: me.name || "ผู้เล่น" });
    }
    if (act === "no") {
      return out(peer, { act: "no", from, reason: d.reason === "busy" ? "busy" : "decline" });
    }
    if (act === "drop") {
      if (me.cy !== to && me.cr !== to) return;
      this.setAtt(ws, { cy: "", cr: "", crFun: 0 });
      if (pa.cy === from || pa.cr === from) this.setAtt(peer, { cy: "", cr: "", crFun: 0 });
      return out(peer, { act: "drop", from });
    }
    if (act === "deliver") { // คนอุ้ม → คนล้ม
      if (me.cy !== to || pa.cr !== from || pa.crFun) return;
      if (me.sc !== "i:clinic" && me.sc !== "i:hospital") return;
      this.setAtt(ws, { cy: "" });
      this.setAtt(peer, { cr: "" });
      return out(peer, { act: "heal", from });
    }
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
    for (const e of d.s.slice(0, 350)) {
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

  // ชื่อลูกของคู่ผู้เล่น: เก็บตามคู่ uid (เรียงแล้ว) ใครส่ง set ก่อนคือชื่อที่ใช้ร่วมกัน อีกฝั่งส่ง get/รับ push แล้วใช้ชื่อเดียวกัน
  // since = เวลาที่ฝั่งผู้ส่งเริ่มตกลงมีลูก (ชื่อที่เก่ากว่านั้นถือเป็นลูกคนก่อน ไม่นำมาใช้)
  async handleKid(ws, d) {
    const me = ws.deserializeAttachment() || {};
    if (!me.playerId || !me.uid) return;
    const other = String(d.uid || "").slice(0, 40);
    if (!UID_RE.test(other) || other === me.uid) return;
    const act = String(d.act || "");
    const since = Math.max(0, Number(d.since) || 0);
    const key = "kid:" + [me.uid, other].sort().join(":");
    const send = (w, obj) => { try { w.send(JSON.stringify({ type: "kid", ...obj })); } catch {} };
    let rec = await this.ctx.storage.get(key);
    if (rec && rec.t < since) rec = null;
    if (act === "get") return send(ws, { act: "child", uid: other, rec: rec || null });
    if (act === "set") {
      if (!rec) {
        const n = Array.from(String(d.n || "").replace(/[<>&"]/g, "").trim()).slice(0, 8).join("") || "น้องใหม่";
        const col = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : "");
        const hs = typeof d.hs === "string" && /^[a-z]{1,10}$/.test(d.hs) ? d.hs : "";
        rec = { n, g: d.g === "m" ? "m" : "f", hr: col(d.hr), sk: col(d.sk), hs, by: me.uid, byName: me.name || "ผู้เล่น", t: Date.now() };
        await this.ctx.storage.put(key, rec);
        for (const w of this.ctx.getWebSockets()) {
          if ((w.deserializeAttachment() || {}).uid === other) send(w, { act: "child", uid: me.uid, rec });
        }
      }
      return send(ws, { act: "child", uid: other, rec });
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
      let at = "", atn = "";
      const atRaw = String(d.at || "");
      if (HSK_RE.test(atRaw)) {
        for (const w of this.ctx.getWebSockets()) {
          const a = w.deserializeAttachment();
          if (a?.playerId && a.hsk === atRaw) { at = atRaw; atn = String(a.name || "ผู้เล่น").slice(0, 16); break; }
        }
      }
      const ask = new Set();
      for (const w of this.ctx.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (!a?.playerId || a.playerId === from) continue;
        if (me.uid && a.uid === me.uid) continue;
        ask.add(a.playerId);
      }
      this.sl = { init: from, t: Date.now(), phase: "ask", ask, yes: new Set(), go: new Set(), done: new Set(), at, atn };
      if (ask.size === 0) return this.sleepGo();
      this.sleepSend(from, { act: "wait", n: ask.size });
      for (const id of ask) this.sleepSend(id, { act: "ask", from, name: me.name || "ผู้เล่น", at, atn });
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
      this.sleepSend(id, { act: "go", forced: !willing, at: sl.at || "", atn: sl.atn || "" });
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
      if (player.cy || player.cr) {
        const pw = this.findWs(player.cy || player.cr);
        if (pw) {
          const pc = pw.deserializeAttachment() || {};
          if (pc.cy === player.playerId || pc.cr === player.playerId) {
            this.setAtt(pw, { cy: "", cr: "", crFun: 0 });
            try { pw.send(JSON.stringify({ type: "carry", act: "drop", from: player.playerId })); } catch {}
          }
        }
      }
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
