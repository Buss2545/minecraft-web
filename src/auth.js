// AccountHub: Durable Object เดียว ("main") เก็บบัญชีผู้เล่น + HTTP API /api/auth/*
// session = คุกกี้ HttpOnly (เก็บเฉพาะแฮชของ token ฝั่งเซิร์ฟเวอร์) • ทุก POST ต้องมาจากเว็บเดียวกัน (Origin) และเป็น JSON
import { DurableObject } from "cloudflare:workers";
import { AuthCore, sha256b64u, UID_RE } from "./auth-core.js";

const COOKIE = "bssj_sid";
const cleanNameLocal = (v) => String(v || "").trim().toLowerCase().slice(0, 16);
const JSON_H = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export const cookieOf = (request) => {
  const m = /(?:^|;\s*)bssj_sid=([A-Za-z0-9_\-]{20,80})/.exec(request.headers.get("Cookie") || "");
  return m ? m[1] : "";
};
const setCookie = (token, secure, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
const reply = (obj, status = 200, extra) => new Response(JSON.stringify(obj), { status, headers: { ...JSON_H, ...(extra || {}) } });

export class AccountHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new AuthCore(ctx.storage);
  }

  // เรียกภายในจาก index.js เท่านั้น (ไม่เปิดให้ภายนอกยิงตรง เพราะ index.js ไม่ route path นี้จากผู้ใช้)
  async fetch(request) {
    const url = new URL(request.url);
    let d = {};
    if (request.method === "POST") { try { d = await request.json(); } catch { d = {}; } }
    const p = url.pathname;
    if (p === "/who") {
      const h = d.token ? await sha256b64u(String(d.token)) : "";
      const user = h ? await this.core.whoByHash(h) : null;
      const uid = UID_RE.test(String(d.uid || "")) ? String(d.uid) : "";
      const bound = !user && uid ? await this.core.uidBound(uid) : false;
      return reply({ user, bound });
    }
    if (p === "/pubprofile") return reply({ ok: true, profile: await this.core.pubProfile(d.uid) });
    if (p === "/locks") return reply({ ok: true, locks: await this.core.locksGet() });
    if (p === "/guestcfg") return reply({ ok: true, cfg: await this.core.guestCfg() });
    if (p === "/guest-status" || p === "/guest-tick") return reply(await this.core.guestStatus(d.gid, p === "/guest-tick"));
    const ip = String(d.ip || "").slice(0, 64);
    const secure = !!d.secure;
    if (p === "/register") {
      const r = await this.core.register({ username: d.username, password: d.password, pid: d.pid, ip });
      return r.ok ? reply({ ok: true, user: r.user, recovery: r.recovery, claimed: r.claimed }, 200, { "Set-Cookie": setCookie(r.token, secure, 2592000) }) : reply(r, r.err === "locked" ? 429 : 400);
    }
    if (p === "/login") {
      const r = await this.core.login({ username: d.username, password: d.password, ip });
      return r.ok ? reply({ ok: true, user: r.user }, 200, { "Set-Cookie": setCookie(r.token, secure, 2592000) }) : reply(r, r.err === "locked" ? 429 : 401);
    }
    if (p === "/recover") {
      const r = await this.core.recover({ username: d.username, code: d.code, newPassword: d.newPassword, ip });
      return r.ok ? reply({ ok: true, user: r.user, recovery: r.recovery }, 200, { "Set-Cookie": setCookie(r.token, secure, 2592000) }) : reply(r, r.err === "locked" ? 429 : 401);
    }
    const h = d.token ? await sha256b64u(String(d.token)) : "";
    const user = h ? await this.core.whoByHash(h) : null;
    if (p === "/logout") { await this.core.logout(h); return reply({ ok: true }, 200, { "Set-Cookie": setCookie("", secure, 0) }); }
    if (!user) return reply({ ok: false, err: "auth" }, 401);
    if (p === "/password") {
      const r = await this.core.changePassword({ uid: user.uid, hash: h, oldPassword: d.oldPassword, newPassword: d.newPassword, ip });
      return reply(r, r.ok ? 200 : r.err === "locked" ? 429 : 400);
    }
    if (p === "/admin-claim") {
      const r = await this.core.claimAdmin({ uid: user.uid, code: d.code, setupCode: this.env.ADMIN_SETUP_CODE, ip });
      if (r.ok) await this.core.logAct({ by: user.username, act: "ตั้งตัวเองเป็นแอดมิน", target: user.username });
      return reply(r, r.ok ? 200 : r.err === "locked" ? 429 : r.err === "disabled" ? 403 : 401);
    }
    if (p === "/admin-lock") {
      if (user.role !== "admin") return reply({ ok: false, err: "perm" }, 403);
      const r = await this.core.locksSet({ game: d.game, on: !!d.on, msg: d.msg });
      if (r.ok) await this.core.logAct({ by: user.username, act: d.on ? "ล็อกเกม" : "เปิดเกม", target: d.game === "farm" ? "บ้านสวนสุขใจ" : "ลิขิตชีวิต", x: d.msg });
      return reply(r, r.ok ? 200 : 400);
    }
    if (p === "/admin-guest") {
      if (user.role !== "admin") return reply({ ok: false, err: "perm" }, 403);
      const r = await this.core.guestCfgSet({ on: !!d.on, min: d.min });
      await this.core.logAct({ by: user.username, act: "ตั้งเวลาทดลองเล่น", target: r.cfg.on ? r.cfg.min + " นาที" : "ปิดจำกัด" });
      return reply(r);
    }
    if (p.startsWith("/admin-") && /^\/admin-(users|log|ban|reset|delete|unbind)$/.test(p)) {
      if (user.role !== "admin") return reply({ ok: false, err: "perm" }, 403);
      if (p === "/admin-users") return reply(await this.core.adminUsers());
      if (p === "/admin-log") return reply(await this.core.adminLog());
      const a = { by: user.uid, username: d.username };
      const r = p === "/admin-ban" ? await this.core.adminBan({ ...a, ban: !!d.ban }) : p === "/admin-reset" ? await this.core.adminReset(a) : p === "/admin-unbind" ? await this.core.adminUnbind(a) : await this.core.adminDelete(a);
      if (r.ok) await this.core.logAct({ by: user.username, act: p === "/admin-ban" ? (d.ban ? "ระงับบัญชี" : "คืนสิทธิ์บัญชี") : p === "/admin-reset" ? "ตั้งรหัสชั่วคราว" : p === "/admin-unbind" ? "ปลดการผูก ID" : "ลบบัญชี", target: cleanNameLocal(d.username) });
      return reply(r.ok && p === "/admin-unbind" ? { ok: true } : r, r.ok ? 200 : 400);
    }
    if (p === "/profile") return reply(await this.core.profileGet({ uid: user.uid }));
    if (p === "/profile-set") { const r = await this.core.profileSet({ uid: user.uid, nick: d.nick, emoji: d.emoji, color: d.color, pic: d.pic }); return reply(r, r.ok ? 200 : 400); }
    if (p === "/save-get") return reply(await this.core.saveGet({ uid: user.uid, i: d.i }));
    if (p === "/save-list") return reply(await this.core.saveList({ uid: user.uid }));
    if (p === "/save-put") { const r = await this.core.savePut({ uid: user.uid, data: d.data, summary: d.summary, base: d.base, force: !!d.force }); return reply(r, r.ok ? 200 : r.err === "conflict" ? 409 : r.err === "rate" ? 429 : 400); }
    if (p === "/save-del") return reply(await this.core.saveDel({ uid: user.uid }));
    if (p === "/admin-revoke") { // เลิกเป็นแอดมินเอง
      return reply(await this.core.revokeAdmin({ uid: user.uid }));
    }
    return reply({ ok: false, err: "nf" }, 404);
  }
}

const randGid = () => { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const hub = (env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName("main"));
const callHub = async (env, path, body) => {
  const r = await hub(env).fetch(new Request("https://hub" + path, { method: "POST", body: JSON.stringify(body || {}) }));
  return r;
};

// สถานะล็อกเกม (แคชในหน่วยความจำ 5 วินาที กันยิง Durable Object ทุกคำขอ)
let lockCache = { t: 0, v: null };
export async function getLocks(env, fresh) {
  const now = Date.now();
  if (!fresh && lockCache.v && now - lockCache.t < 5000) return lockCache.v;
  try {
    const r = await callHub(env, "/locks", {});
    const j = await r.json();
    lockCache = { t: now, v: j.locks };
    return j.locks;
  } catch {
    return lockCache.v || { farm: { on: false, msg: "" }, life: { on: false, msg: "" } };
  }
}
export async function profileOf(env, uid) {
  try { const r = await callHub(env, "/pubprofile", { uid }); const j = await r.json(); return j.profile || null; } catch { return null; }
}
let guestCache = { t: 0, v: null };
export async function getGuestCfg(env) {
  const now = Date.now();
  if (guestCache.v && now - guestCache.t < 5000) return guestCache.v;
  try { const r = await callHub(env, "/guestcfg", {}); const j = await r.json(); guestCache = { t: now, v: j.cfg }; return j.cfg; } catch { return guestCache.v || { on: true, min: 120 }; }
}
export async function guestLeft(env, gid) { // วินาทีที่เหลือของผู้เล่นที่ไม่ล็อกอิน (Infinity = ไม่จำกัด)
  const cfg = await getGuestCfg(env);
  if (!cfg.on) return Infinity;
  if (!gid) return cfg.min * 60;
  try { const r = await callHub(env, "/guest-status", { gid }); const j = await r.json(); return j.left; } catch { return Infinity; }
}
export const gidOf = (request) => { const m = /(?:^|;\s*)bssj_gid=([A-Za-z0-9_\-]{16,40})/.exec(request.headers.get("Cookie") || ""); return m ? m[1] : ""; };
export const resetLockCache = () => { lockCache = { t: 0, v: null }; guestCache = { t: 0, v: null }; };

// ตรวจ session ของคำขอ (ใช้กับ API และ WebSocket): คืน { user, bound }
export async function whoami(env, request, uidParam) {
  const token = cookieOf(request);
  if (!token && !uidParam) return { user: null, bound: false };
  try {
    const r = await callHub(env, "/who", { token, uid: uidParam || "" });
    return await r.json();
  } catch {
    return { user: null, bound: false };
  }
}

// POST /api/auth/* — กันข้ามเว็บ (CSRF): ต้องมี Origin ตรงกับโฮสต์เดียวกัน (หรือไม่มี Origin แต่เป็น same-site fetch) และเป็น JSON
export async function authApi(request, env) {
  const url = new URL(request.url);
  const op = url.pathname.replace(/^\/api\/auth\//, "");
  const secure = url.protocol === "https:";
  if (op === "locks") {
    if (request.method !== "GET") return reply({ ok: false }, 405);
    return reply({ ok: true, locks: await getLocks(env) });
  }
  if (op === "me") {
    if (request.method !== "GET") return reply({ ok: false }, 405);
    const { user } = await whoami(env, request, "");
    return reply({ ok: true, user: user || null, adminReady: String(env.ADMIN_SETUP_CODE || "").length >= 12 });
  }
  if (op === "guest-status" || op === "guest-tick") { // ผู้เล่นที่ยังไม่ล็อกอิน: เหลือเวลาทดลองเล่นเท่าไร (tick = นับเวลาเพิ่ม)
    if ((op === "guest-tick") !== (request.method === "POST")) return reply({ ok: false, err: "method" }, 405);
    if (op === "guest-tick") { const o = request.headers.get("Origin"); if (o && o !== url.origin) return reply({ ok: false, err: "origin" }, 403); }
    const { user } = await whoami(env, request, "");
    if (user) { const c = await getGuestCfg(env); return reply({ ok: true, member: true, on: c.on, left: 0, limit: c.min * 60, used: 0 }); }
    let gid = gidOf(request), fresh = false;
    if (!gid) { gid = randGid(); fresh = true; }
    const r = await callHub(env, "/" + op, { gid });
    const j = await r.json();
    return reply({ ...j, member: false }, 200, fresh ? { "Set-Cookie": `bssj_gid=${gid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}` } : undefined);
  }
  if (request.method !== "POST") return reply({ ok: false, err: "method" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return reply({ ok: false, err: "origin" }, 403);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return reply({ ok: false, err: "type" }, 415);
  if (!/^(register|login|logout|recover|password|admin-claim|admin-revoke|admin-users|admin-log|admin-unbind|admin-ban|admin-reset|admin-delete|admin-lock|admin-guest|profile|profile-set|save-get|save-list|save-put|save-del)$/.test(op)) return reply({ ok: false, err: "nf" }, 404);
  let d;
  try { d = await request.json(); } catch { return reply({ ok: false, err: "bad" }, 400); }
  if (!d || typeof d !== "object") return reply({ ok: false, err: "bad" }, 400);
  const body = { ...d, token: cookieOf(request), ip: request.headers.get("CF-Connecting-IP") || "", secure };
  const r = await callHub(env, "/" + op, body);
  if (op === "admin-lock") resetLockCache();
  return new Response(r.body, { status: r.status, headers: r.headers });
}
