// AccountHub: Durable Object เดียว ("main") เก็บบัญชีผู้เล่น + HTTP API /api/auth/*
// session = คุกกี้ HttpOnly (เก็บเฉพาะแฮชของ token ฝั่งเซิร์ฟเวอร์) • ทุก POST ต้องมาจากเว็บเดียวกัน (Origin) และเป็น JSON
import { DurableObject } from "cloudflare:workers";
import { AuthCore, sha256b64u, UID_RE } from "./auth-core.js";

const COOKIE = "bssj_sid";
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
      return reply(r, r.ok ? 200 : r.err === "locked" ? 429 : r.err === "disabled" ? 403 : 401);
    }
    if (p.startsWith("/admin-") && /^\/admin-(users|ban|reset|delete)$/.test(p)) {
      if (user.role !== "admin") return reply({ ok: false, err: "perm" }, 403);
      if (p === "/admin-users") return reply(await this.core.adminUsers());
      const a = { by: user.uid, username: d.username };
      const r = p === "/admin-ban" ? await this.core.adminBan({ ...a, ban: !!d.ban }) : p === "/admin-reset" ? await this.core.adminReset(a) : await this.core.adminDelete(a);
      return reply(r, r.ok ? 200 : 400);
    }
    if (p === "/profile") return reply(await this.core.profileGet({ uid: user.uid }));
    if (p === "/profile-set") { const r = await this.core.profileSet({ uid: user.uid, nick: d.nick, emoji: d.emoji, color: d.color, pic: d.pic }); return reply(r, r.ok ? 200 : 400); }
    if (p === "/save-get") return reply(await this.core.saveGet({ uid: user.uid }));
    if (p === "/save-put") { const r = await this.core.savePut({ uid: user.uid, data: d.data, summary: d.summary, base: d.base, force: !!d.force }); return reply(r, r.ok ? 200 : r.err === "conflict" ? 409 : r.err === "rate" ? 429 : 400); }
    if (p === "/save-del") return reply(await this.core.saveDel({ uid: user.uid }));
    if (p === "/admin-revoke") { // เลิกเป็นแอดมินเอง
      return reply(await this.core.revokeAdmin({ uid: user.uid }));
    }
    return reply({ ok: false, err: "nf" }, 404);
  }
}

const hub = (env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName("main"));
const callHub = async (env, path, body) => {
  const r = await hub(env).fetch(new Request("https://hub" + path, { method: "POST", body: JSON.stringify(body || {}) }));
  return r;
};

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
  if (op === "me") {
    if (request.method !== "GET") return reply({ ok: false }, 405);
    const { user } = await whoami(env, request, "");
    return reply({ ok: true, user: user || null, adminReady: String(env.ADMIN_SETUP_CODE || "").length >= 12 });
  }
  if (request.method !== "POST") return reply({ ok: false, err: "method" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return reply({ ok: false, err: "origin" }, 403);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return reply({ ok: false, err: "type" }, 415);
  if (!/^(register|login|logout|recover|password|admin-claim|admin-revoke|admin-users|admin-ban|admin-reset|admin-delete|profile|profile-set|save-get|save-put|save-del)$/.test(op)) return reply({ ok: false, err: "nf" }, 404);
  let d;
  try { d = await request.json(); } catch { return reply({ ok: false, err: "bad" }, 400); }
  if (!d || typeof d !== "object") return reply({ ok: false, err: "bad" }, 400);
  const body = { ...d, token: cookieOf(request), ip: request.headers.get("CF-Connecting-IP") || "", secure };
  const r = await callHub(env, "/" + op, body);
  return new Response(r.body, { status: r.status, headers: r.headers });
}
