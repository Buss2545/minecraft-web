// ระบบบัญชีผู้เล่น (ตรรกะล้วน ไม่พึ่ง Cloudflare) — ใช้ใน AccountHub (src/auth.js) และทดสอบด้วย Node ได้
// เก็บข้อมูลผ่าน storage แบบ Durable Object: get/put/delete/list
//   u:<username>  → { uid, username, salt, hash, rc:{salt,hash}, role, created }
//   id:<uid>      → username   (uid ที่ผูกกับบัญชีแล้ว)
//   s:<sha256(token)> → { uid, exp }
//   rl:<key>      → { n, until, t }   (กันเดารหัส)

const enc = new TextEncoder();
export const UID_RE = /^[A-Za-z0-9_\-]{6,40}$/;
export const NAME_RE = /^[a-z0-9_]{3,16}$/;
const PBKDF2_ITER = 100000; // เพดานของ Workers
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS_PER_USER = 8;

const b64u = (buf) => {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s) => {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};
export const randB64u = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256b64u(str) {
  return b64u(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}
async function pbkdf2(secret, saltB64) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(saltB64), iterations: PBKDF2_ITER }, key, 256);
  return b64u(bits);
}
function safeEq(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function makeSecret(secret) {
  const salt = randB64u(16);
  return { salt, hash: await pbkdf2(secret, salt) };
}
async function checkSecret(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) { await pbkdf2(secret, randB64u(16)); return false; } // ใช้เวลาใกล้เคียงกัน กันเดาว่ามี user ไหม
  return safeEq(await pbkdf2(secret, rec.salt), rec.hash);
}

const cleanName = (v) => String(v || "").trim().toLowerCase();
const okPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 72;

export class AuthCore {
  constructor(storage, opts = {}) {
    this.st = storage;
    this.now = opts.now || (() => Date.now());
  }

  // ----- กันเดารหัส: ต่อ username และต่อ IP -----
  async rlCheck(key, limit, lockMs, windowMs) {
    const r = (await this.st.get("rl:" + key)) || { n: 0, until: 0, t: 0 };
    const now = this.now();
    if (r.until > now) return { locked: true, wait: Math.ceil((r.until - now) / 1000) };
    if (r.t && now - r.t > windowMs) { r.n = 0; }
    return { locked: false, r, limit, lockMs };
  }
  async rlFail(key, chk) {
    const now = this.now();
    const r = chk.r;
    r.n = (r.n | 0) + 1;
    r.t = now;
    if (r.n >= chk.limit) { r.until = now + chk.lockMs; r.n = 0; }
    await this.st.put("rl:" + key, r);
  }
  async rlOk(key) { await this.st.delete("rl:" + key); }

  async gate(name, ip) {
    const a = await this.rlCheck("u:" + name, 5, 5 * 60000, 15 * 60000);
    const b = await this.rlCheck("ip:" + (ip || "?"), 30, 10 * 60000, 10 * 60000);
    if (a.locked) return { err: "locked", wait: a.wait };
    if (b.locked) return { err: "locked", wait: b.wait };
    return { a, b };
  }

  async newSession(uid) {
    const token = randB64u(32);
    const h = await sha256b64u(token);
    // จำกัดจำนวน session ต่อบัญชี: เก่าสุดถูกลบ
    const mine = [];
    const all = await this.st.list({ prefix: "s:" });
    for (const [k, v] of all) if (v && v.uid === uid) mine.push([k, v]);
    mine.sort((x, y) => x[1].exp - y[1].exp);
    while (mine.length >= MAX_SESSIONS_PER_USER) { const [k] = mine.shift(); await this.st.delete(k); }
    await this.st.put("s:" + h, { uid, exp: this.now() + SESSION_MS });
    return token;
  }
  async dropSessions(uid, exceptHash) {
    const all = await this.st.list({ prefix: "s:" });
    for (const [k, v] of all) if (v && v.uid === uid && k !== "s:" + exceptHash) await this.st.delete(k);
  }
  pub(u) { return { uid: u.uid, username: u.username, role: u.role === "admin" ? "admin" : "user" }; }

  async register({ username, password, pid, ip }) {
    const name = cleanName(username);
    if (!NAME_RE.test(name)) return { ok: false, err: "name" };
    if (!okPassword(password)) return { ok: false, err: "pw" };
    if (password.toLowerCase() === name) return { ok: false, err: "pw_same" };
    const ipRl = await this.rlCheck("reg:" + (ip || "?"), 8, 60 * 60000, 60 * 60000);
    if (ipRl.locked) return { ok: false, err: "locked", wait: ipRl.wait };
    if (await this.st.get("u:" + name)) return { ok: false, err: "taken" };
    let uid = "";
    let claimed = false;
    if (typeof pid === "string" && UID_RE.test(pid) && !(await this.st.get("id:" + pid))) { uid = pid; claimed = true; }
    if (!uid) uid = "u" + randB64u(15).replace(/[^A-Za-z0-9]/g, "x");
    const rc = randB64u(12).toUpperCase().replace(/[-_]/g, "X").match(/.{1,4}/g).join("-"); // รหัสกู้คืน (แสดงครั้งเดียว)
    const sec = await makeSecret(password);
    const rec = { uid, username: name, salt: sec.salt, hash: sec.hash, rc: await makeSecret(rc), role: "user", created: this.now() };
    await this.st.put("u:" + name, rec);
    await this.st.put("id:" + uid, name);
    await this.rlFail("reg:" + (ip || "?"), ipRl); // นับการสมัครต่อ IP (8 ต่อชั่วโมง)
    const token = await this.newSession(uid);
    return { ok: true, user: this.pub(rec), token, recovery: rc, claimed };
  }

  async login({ username, password, ip }) {
    const name = cleanName(username);
    if (!NAME_RE.test(name) || typeof password !== "string" || password.length > 200) return { ok: false, err: "bad" };
    const g = await this.gate(name, ip);
    if (g.err) return { ok: false, err: g.err, wait: g.wait };
    const rec = await this.st.get("u:" + name);
    const ok = await checkSecret(password, rec);
    if (!ok) {
      await this.rlFail("u:" + name, g.a);
      await this.rlFail("ip:" + (ip || "?"), g.b);
      return { ok: false, err: "cred" };
    }
    await this.rlOk("u:" + name);
    if (rec.banned) return { ok: false, err: "banned" };
    return { ok: true, user: this.pub(rec), token: await this.newSession(rec.uid) };
  }

  async whoByHash(h) {
    if (!h) return null;
    const s = await this.st.get("s:" + h);
    if (!s) return null;
    if (s.exp < this.now()) { await this.st.delete("s:" + h); return null; }
    const name = await this.st.get("id:" + s.uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    return rec && !rec.banned ? this.pub(rec) : null;
  }
  async logout(h) { if (h) await this.st.delete("s:" + h); return { ok: true }; }
  async uidBound(uid) { return !!(uid && (await this.st.get("id:" + uid))); }

  async changePassword({ uid, hash, oldPassword, newPassword, ip }) {
    if (!okPassword(newPassword)) return { ok: false, err: "pw" };
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "auth" };
    const g = await this.gate(name, ip);
    if (g.err) return { ok: false, err: g.err, wait: g.wait };
    if (!(await checkSecret(String(oldPassword || ""), rec))) { await this.rlFail("u:" + name, g.a); return { ok: false, err: "cred" }; }
    await this.rlOk("u:" + name);
    const sec = await makeSecret(newPassword);
    rec.salt = sec.salt; rec.hash = sec.hash;
    await this.st.put("u:" + name, rec);
    await this.dropSessions(uid, hash); // เครื่องอื่นหลุดทั้งหมด เหลือเครื่องนี้
    return { ok: true };
  }

  // กู้รหัสด้วยรหัสกู้คืน → ได้รหัสกู้คืนชุดใหม่ (ชุดเก่าใช้ไม่ได้อีก)
  async recover({ username, code, newPassword, ip }) {
    const name = cleanName(username);
    if (!NAME_RE.test(name) || !okPassword(newPassword)) return { ok: false, err: "bad" };
    const g = await this.gate(name, ip);
    if (g.err) return { ok: false, err: g.err, wait: g.wait };
    const rec = await this.st.get("u:" + name);
    const ok = await checkSecret(String(code || "").trim().toUpperCase(), rec && rec.rc);
    if (!ok) { await this.rlFail("u:" + name, g.a); await this.rlFail("ip:" + (ip || "?"), g.b); return { ok: false, err: "cred" }; }
    await this.rlOk("u:" + name);
    if (rec.banned) return { ok: false, err: "banned" };
    const sec = await makeSecret(newPassword);
    const rc = randB64u(12).toUpperCase().replace(/[-_]/g, "X").match(/.{1,4}/g).join("-");
    rec.salt = sec.salt; rec.hash = sec.hash; rec.rc = await makeSecret(rc);
    await this.st.put("u:" + name, rec);
    await this.dropSessions(rec.uid, "");
    return { ok: true, user: this.pub(rec), token: await this.newSession(rec.uid), recovery: rc };
  }

  // ตั้งตัวเองเป็นแอดมินด้วยรหัสตั้งต้น (secret ADMIN_SETUP_CODE) — ไม่ตั้ง secret = ปิดฟีเจอร์
  async claimAdmin({ uid, code, setupCode, ip }) {
    if (!setupCode || String(setupCode).length < 12) return { ok: false, err: "disabled" };
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "auth" };
    const g = await this.gate("adm:" + name, ip);
    if (g.err) return { ok: false, err: g.err, wait: g.wait };
    if (!safeEq(String(code || ""), String(setupCode))) { await this.rlFail("u:adm:" + name, g.a); await this.rlFail("ip:" + (ip || "?"), g.b); return { ok: false, err: "cred" }; }
    await this.rlOk("u:adm:" + name);
    rec.role = "admin";
    await this.st.put("u:" + name, rec);
    return { ok: true, user: this.pub(rec) };
  }
  async revokeAdmin({ uid }) {
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false };
    rec.role = "user";
    await this.st.put("u:" + name, rec);
    return { ok: true };
  }

  // ----- โปรไฟล์ + เซฟออนไลน์ (เก็บต่อ uid ของบัญชี) -----
  //   pf:<uid>  → { nick, emoji, color }       sv:<uid> → สตริง JSON ของเซฟ      svm:<uid> → { u, size, n, sum }
  async profileGet({ uid }) {
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "auth" };
    const pf = (await this.st.get("pf:" + uid)) || {};
    const meta = (await this.st.get("svm:" + uid)) || null;
    return {
      ok: true,
      user: this.pub(rec),
      created: rec.created,
      profile: { nick: pf.nick || rec.username, emoji: pf.emoji || "🧑‍🌾", color: pf.color || "#f2b134", pic: pf.pic || "" },
      save: meta,
    };
  }
  async profileSet({ uid, nick, emoji, color, pic }) {
    const name = await this.st.get("id:" + uid);
    if (!name) return { ok: false, err: "auth" };
    const n = Array.from(String(nick || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim()).slice(0, 16).join("");
    if (!n) return { ok: false, err: "nick" };
    const e = Array.from(String(emoji || "")).slice(0, 8).join("");
    if (!e || /[<>&"'\s]/.test(e)) return { ok: false, err: "emoji" };
    if (!/^#[0-9a-fA-F]{6}$/.test(String(color || ""))) return { ok: false, err: "color" };
    const old = (await this.st.get("pf:" + uid)) || {};
    let pc = old.pic || "";
    if (pic !== undefined) { // "" = ลบรูป • รับเฉพาะรูปย่อ jpeg/png/webp แบบ data URL (ไม่รับ SVG กันสคริปต์)
      if (pic === "" || pic === null) pc = "";
      else if (typeof pic === "string" && pic.length <= 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(pic)) pc = pic;
      else return { ok: false, err: "pic" };
    }
    const pf = { nick: n, emoji: e, color: String(color).toLowerCase(), pic: pc };
    await this.st.put("pf:" + uid, pf);
    return { ok: true, profile: pf };
  }
  async saveGet({ uid }) {
    const meta = await this.st.get("svm:" + uid);
    if (!meta) return { ok: true, empty: true };
    return { ok: true, data: await this.st.get("sv:" + uid), meta };
  }
  async savePut({ uid, data, summary, base, force }) {
    if (typeof data !== "string" || data.length < 2) return { ok: false, err: "bad" };
    if (data.length > 1800000) return { ok: false, err: "big" };
    try { const o = JSON.parse(data); if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, err: "bad" }; } catch { return { ok: false, err: "bad" }; }
    const prev = await this.st.get("svm:" + uid);
    const now = this.now();
    if (prev && !force) {
      if (Number(base) !== prev.u) return { ok: false, err: "conflict", meta: prev };
      if (now - prev.u < 3000) return { ok: false, err: "rate" };
    }
    const sm = summary && typeof summary === "object" ? summary : {};
    const num = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(1e12, Math.floor(+v))) : 0);
    const sum = {
      name: Array.from(String(sm.name || "").replace(/[\u0000-\u001f\u007f<>]/g, "")).slice(0, 16).join(""),
      day: num(sm.day), money: num(sm.money), gen: num(sm.gen),
    };
    const meta = { u: now, size: data.length, n: ((prev && prev.n) | 0) + 1, sum };
    await this.st.put("sv:" + uid, data);
    await this.st.put("svm:" + uid, meta);
    return { ok: true, meta };
  }
  async saveDel({ uid }) {
    await this.st.delete("sv:" + uid);
    await this.st.delete("svm:" + uid);
    return { ok: true };
  }

  // ----- แอดมินจัดการบัญชีผู้เล่น (route ใน auth.js ตรวจ role แอดมินก่อนเรียก) -----
  async adminUsers() {
    const all = await this.st.list({ prefix: "u:" });
    const out = [];
    for (const [k, v] of all) {
      if (!v || !v.username || k.startsWith("u:adm:")) continue;
      const pf = (await this.st.get("pf:" + v.uid)) || {};
      const sm = await this.st.get("svm:" + v.uid);
      out.push({ username: v.username, uid: v.uid, role: v.role === "admin" ? "admin" : "user", banned: !!v.banned, created: v.created || 0, nick: pf.nick || "", hasSave: !!sm, saveAt: sm ? sm.u : 0 });
    }
    out.sort((a, b) => b.created - a.created);
    return { ok: true, users: out.slice(0, 500) };
  }
  async adminTarget(by, username) {
    const name = cleanName(username);
    const rec = NAME_RE.test(name) ? await this.st.get("u:" + name) : null;
    if (!rec) return { err: "nf" };
    if (rec.uid === by) return { err: "self" };
    if (rec.role === "admin") return { err: "admin" }; // แอดมินด้วยกันแตะไม่ได้ (เลิกเป็นแอดมินเองก่อน)
    return { rec, name };
  }
  async adminBan({ by, username, ban }) {
    const t = await this.adminTarget(by, username);
    if (t.err) return { ok: false, err: t.err };
    t.rec.banned = !!ban;
    await this.st.put("u:" + t.name, t.rec);
    if (ban) await this.dropSessions(t.rec.uid, "");
    return { ok: true, banned: !!ban };
  }
  // ตั้งรหัสผ่านชั่วคราวให้ผู้เล่นที่ลืมรหัส (แสดงให้แอดมินเห็นครั้งเดียว) • ทุกเครื่องของเขาหลุด
  async adminReset({ by, username }) {
    const t = await this.adminTarget(by, username);
    if (t.err) return { ok: false, err: t.err };
    const temp = randB64u(9).replace(/[-_]/g, "x");
    const sec = await makeSecret(temp);
    t.rec.salt = sec.salt; t.rec.hash = sec.hash;
    await this.st.put("u:" + t.name, t.rec);
    await this.dropSessions(t.rec.uid, "");
    await this.st.delete("rl:u:" + t.name);
    return { ok: true, temp };
  }
  async adminDelete({ by, username }) {
    const t = await this.adminTarget(by, username);
    if (t.err) return { ok: false, err: t.err };
    const uid = t.rec.uid;
    await this.dropSessions(uid, "");
    for (const k of ["u:" + t.name, "id:" + uid, "pf:" + uid, "sv:" + uid, "svm:" + uid]) await this.st.delete(k);
    return { ok: true };
  }
}
