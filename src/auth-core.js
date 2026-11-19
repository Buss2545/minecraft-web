// ระบบบัญชีผู้เล่น (ตรรกะล้วน ไม่พึ่ง Cloudflare) — ใช้ใน AccountHub (src/auth.js) และทดสอบด้วย Node ได้
// เก็บข้อมูลผ่าน storage แบบ Durable Object: get/put/delete/list
//   u:<username>  → { uid, username, salt, hash, rc:{salt,hash}, role, created }
//   id:<uid>      → username   (uid ที่ผูกกับบัญชีแล้ว)
//   s:<sha256(token)> → { uid, exp }
//   rl:<key>      → { n, until, t }   (กันเดารหัส)

import { hasBad } from "./profanity.js";
const enc = new TextEncoder();
export const UID_RE = /^[A-Za-z0-9_\-]{6,40}$/;
const BACKUP_DAYS = 7, BACKUP_GAP = 6 * 3600000, BACKUP_MAX = 28; // สำรองย้อนหลัง: เก็บ 7 วัน ห่างกันอย่างน้อย 6 ชม. สูงสุด 28 ชุด
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
    if (hasBad(name)) return { ok: false, err: "badword" };
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
    const rec = { uid, username: name, salt: sec.salt, hash: sec.hash, rc: await makeSecret(rc), role: "user", created: this.now(), last: this.now(), claimed };
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
    rec.last = this.now();
    await this.st.put("u:" + name, rec);
    return { ok: true, user: this.pub(rec), token: await this.newSession(rec.uid) };
  }

  async whoByHash(h) {
    if (!h) return null;
    const s = await this.st.get("s:" + h);
    if (!s) return null;
    if (s.exp < this.now()) { await this.st.delete("s:" + h); return null; }
    const name = await this.st.get("id:" + s.uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    return rec && !rec.banned ? { ...this.pub(rec), mu: (rec.muteUntil || 0) > this.now() ? rec.muteUntil : 0 } : null;
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

  // ออกรหัสกู้คืนชุดใหม่ให้คนที่ล็อกอินอยู่ (ต้องยืนยันด้วยรหัสผ่านปัจจุบัน • ชุดเก่าใช้ไม่ได้อีก)
  async newRecovery({ uid, password, ip }) {
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "auth" };
    const g = await this.gate(name, ip);
    if (g.err) return { ok: false, err: g.err, wait: g.wait };
    if (!(await checkSecret(String(password || ""), rec))) { await this.rlFail("u:" + name, g.a); return { ok: false, err: "cred" }; }
    await this.rlOk("u:" + name);
    const rc = randB64u(12).toUpperCase().replace(/[-_]/g, "X").match(/.{1,4}/g).join("-");
    rec.rc = await makeSecret(rc);
    await this.st.put("u:" + name, rec);
    return { ok: true, recovery: rc };
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
    if (hasBad(n)) return { ok: false, err: "badword" };
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
  async saveGet({ uid, i }) {
    if (i !== undefined && i !== null && i !== "" && i !== 0) {
      const k = String(i);
      if (!/^\d{1,14}$/.test(k)) return { ok: false, err: "bad" };
      const m = await this.st.get("svbm:" + uid + ":" + k);
      if (!m) return { ok: true, empty: true };
      return { ok: true, data: await this.st.get("svb:" + uid + ":" + k), meta: m };
    }
    const meta = await this.st.get("svm:" + uid);
    if (!meta) return { ok: true, empty: true };
    return { ok: true, data: await this.st.get("sv:" + uid), meta };
  }
  async saveList({ uid }) {
    await this.pruneBackups(uid);
    const out = (await this.backupList(uid)).map(([i, m]) => ({ i, u: m.u, size: m.size, sum: m.sum }));
    return { ok: true, backups: out, keepDays: BACKUP_DAYS };
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
      subs: num(sm.subs), path: sm.path === "farm" || sm.path === "str" ? sm.path : "",
    };
    const meta = { u: now, size: data.length, n: ((prev && prev.n) | 0) + 1, sum };
    if (prev) { // สำรองย้อนหลัง: เก็บ 7 วัน ห่างกันอย่างน้อย 6 ชั่วโมง (กันเซฟเสียถูกอัปทับทันที) • รายการเก่ากว่า 7 วันถูกลบอัตโนมัติ
      const bl = await this.backupList(uid);
      const newest = bl.length ? bl[0][1].u : 0;
      if (!bl.length || now - newest >= BACKUP_GAP) {
        const cur = await this.st.get("sv:" + uid);
        if (typeof cur === "string") {
          const id = String(prev.u);
          await this.st.put("svb:" + uid + ":" + id, cur);
          await this.st.put("svbm:" + uid + ":" + id, prev);
        }
      }
      await this.pruneBackups(uid);
    }
    await this.st.put("sv:" + uid, data);
    await this.st.put("svm:" + uid, meta);
    return { ok: true, meta };
  }
  async saveDel({ uid }) {
    await this.st.delete("sv:" + uid);
    await this.st.delete("svm:" + uid);
    await this.dropBackups(uid);
    return { ok: true };
  }
  // รายการสำรอง [id, meta] เรียงใหม่→เก่า (id = เวลาของเซฟนั้น ส่วนของเก่ามี id 1-3)
  async backupList(uid) {
    const all = await this.st.list({ prefix: "svbm:" + uid + ":" });
    const pl = ("svbm:" + uid + ":").length;
    return [...all].filter(([, m]) => m && m.u).map(([k, m]) => [k.slice(pl), m]).sort((a, b) => b[1].u - a[1].u);
  }
  async pruneBackups(uid) {
    const bl = await this.backupList(uid), lim = this.now() - BACKUP_DAYS * 86400000;
    for (const [id, m] of bl.filter(([, m], n) => m.u < lim || n >= BACKUP_MAX)) { await this.st.delete("svb:" + uid + ":" + id); await this.st.delete("svbm:" + uid + ":" + id); }
  }
  async dropBackups(uid) {
    for (const [id] of await this.backupList(uid)) { await this.st.delete("svb:" + uid + ":" + id); await this.st.delete("svbm:" + uid + ":" + id); }
  }

  // ----- แอดมินจัดการบัญชีผู้เล่น (route ใน auth.js ตรวจ role แอดมินก่อนเรียก) -----
  async adminUsers() {
    const all = await this.st.list({ prefix: "u:" });
    const out = [];
    for (const [k, v] of all) {
      if (!v || !v.username || k.startsWith("u:adm:")) continue;
      const pf = (await this.st.get("pf:" + v.uid)) || {};
      const sm = await this.st.get("svm:" + v.uid);
      out.push({ username: v.username, uid: v.uid, role: v.role === "admin" ? "admin" : "user", banned: !!v.banned, created: v.created || 0, last: v.last || 0, claimed: !!v.claimed, nick: pf.nick || "", hasSave: !!sm, saveAt: sm ? sm.u : 0 });
    }
    out.sort((a, b) => b.created - a.created);
    return { ok: true, users: out.slice(0, 500) };
  }
  async adminStats() { // สถิติรวมสำหรับแอดมิน (วันตามเวลาไทย UTC+7)
    const now = this.now(), DAY = 86400000, OFF = 7 * 3600000, dayOf = (t) => Math.floor((t + OFF) / DAY);
    const today = dayOf(now);
    const U = { total: 0, admins: 0, banned: 0, new1: 0, new7: 0, act1: 0, act7: 0 }, daily = Array.from({ length: 14 }, (_, i) => ({ day: today - 13 + i, n: 0, act: 0 }));
    for (const [k, v] of await this.st.list({ prefix: "u:" })) {
      if (!v || !v.username || k.startsWith("u:adm:")) continue;
      U.total++; if (v.role === "admin") U.admins++; if (v.banned) U.banned++;
      const c = v.created || 0, l = v.last || 0;
      if (now - c < DAY) U.new1++; if (now - c < 7 * DAY) U.new7++;
      if (l && now - l < DAY) U.act1++; if (l && now - l < 7 * DAY) U.act7++;
      const dc = daily.find((d) => d.day === dayOf(c)); if (dc) dc.n++;
      const dl = l && daily.find((d) => d.day === dayOf(l)); if (dl) dl.act++;
    }
    const S = { count: 0, bytes: 0, latest: 0 };
    for (const [, m] of await this.st.list({ prefix: "svm:" })) { if (!m) continue; S.count++; S.bytes += m.size | 0; S.latest = Math.max(S.latest, m.u | 0); }
    const G = { total: 0, done: 0, today: 0, avgMin: 0 }, cfg = await this.guestCfg();
    let sum = 0;
    for (const [, g] of await this.st.list({ prefix: "g:" })) { if (!g) continue; G.total++; sum += g.sec | 0; if (cfg.on && g.sec >= cfg.min * 60) G.done++; if (g.last && dayOf(g.last) === today) G.today++; }
    G.avgMin = G.total ? Math.round(sum / G.total / 60) : 0;
    return { ok: true, users: U, daily: daily.map((d) => ({ d: new Date(d.day * DAY).toISOString().slice(5, 10), n: d.n, act: d.act })), saves: S, guests: G, limitMin: cfg.min, limitOn: cfg.on };
  }
  // ----- รายงานผู้เล่น + ปิดเสียง -----
  async reportAdd(r) {
    const t = this.now();
    const c = (x, n) => Array.from(String(x || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim()).slice(0, n).join("");
    const who = (w) => ({ n: c(w && w.n, 16), u: UID_RE.test(String((w && w.u) || "")) ? String(w.u) : "", p: c(w && w.p, 40) });
    const rec = { t, room: c(r.room, 20), reason: c(r.reason, 30), by: who(r.by), to: who(r.to), lines: (Array.isArray(r.lines) ? r.lines : []).slice(0, 5).map((l) => ({ x: c(l && l.x, 120), t: Number(l && l.t) || 0 })), done: "" };
    // ชื่อผู้ใช้ของบัญชี (ถ้ามี) เพื่อให้แอดมินกดปิดเสียง/ระงับได้ทันที
    for (const k of ["by", "to"]) { if (rec[k].u) { const nm = await this.st.get("id:" + rec[k].u); if (nm) rec[k].a = String(nm); } }
    await this.st.put("rp:" + String(t).padStart(15, "0") + ":" + randB64u(3), rec);
    try { await this.inboxPut("sys", "ระบบ", "🚩 รายงานใหม่: " + (rec.by.n || "?") + " รายงาน " + (rec.to.n || "?") + " — " + rec.reason); } catch (e) { /* ไม่ให้กระทบการรายงาน */ }
    const all = [...(await this.st.list({ prefix: "rp:" })).keys()];
    if (all.length > 300) for (let i = 0; i < all.length - 200; i += 100) await this.st.delete(all.slice(i, Math.min(i + 100, all.length - 200)));
    return { ok: true };
  }
  // 📬 กล่องข้อความแอดมิน: ผู้เล่นส่งข้อความ/ระบบแจ้งเตือน → แอดมินอ่านแล้วข้อความถูกลบอัตโนมัติ (ack)
  async inboxPut(kind, from, text) {
    const t = this.now();
    const c = (x, n) => Array.from(String(x || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim()).slice(0, n).join("");
    await this.st.put("ib:" + String(t).padStart(15, "0") + ":" + randB64u(3), { t, k: kind === "sys" ? "sys" : "msg", from: c(from, 24), text: c(text, 300) });
    const all = [...(await this.st.list({ prefix: "ib:" })).keys()];
    if (all.length > 150) for (let i = 0; i < all.length - 100; i += 100) await this.st.delete(all.slice(i, Math.min(i + 100, all.length - 100)));
  }
  async msgSend({ uid, text, ip }) {
    const name = await this.st.get("id:" + uid);
    const rec = name ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "auth" };
    const tx = String(text || "").replace(/\s+/g, " ").trim();
    if (tx.length < 2) return { ok: false, err: "bad" };
    if (rec.muteUntil && rec.muteUntil > this.now()) return { ok: false, err: "muted" };
    const rl = await this.rlCheck("msg:" + uid, 5, 30 * 60000, 30 * 60000);
    if (rl.locked) return { ok: false, err: "locked", wait: rl.wait };
    await this.rlFail("msg:" + uid, rl);
    await this.inboxPut("msg", "@" + name, tx);
    return { ok: true };
  }
  async inboxList() {
    const all = [...(await this.st.list({ prefix: "ib:" }))];
    return { ok: true, items: all.slice(-100).reverse().map(([k, v]) => ({ id: k, ...v })) };
  }
  async inboxCount() { return { ok: true, n: (await this.st.list({ prefix: "ib:" })).size }; }
  async inboxAck(ids) {
    const ok = (Array.isArray(ids) ? ids : []).slice(0, 100).filter((x) => /^ib:\d{15}:[A-Za-z0-9_\-]+$/.test(String(x)));
    if (ok.length) await this.st.delete(ok);
    return { ok: true, n: ok.length };
  }
  // 🏆 อันดับผู้เล่น: อ่านจากสรุปเซฟออนไลน์ (svm.sum) • แคช 2 นาที • ไม่แสดงบัญชีที่ถูกระงับ
  // รีเซ็ตอันดับ: ทุก N วัน (ค่าเริ่มต้น 7, 0 = ปิดอัตโนมัติ) หรือแอดมินสั่งเอง • ตอนรีเซ็ตจะจดค่าตั้งต้น lb0:<uid> แล้วอันดับนับ "ที่เพิ่มขึ้น" ตั้งแต่รอบนี้
  // (เพื่อนไม่ถูกรีเซ็ต) • เก็บแชมป์รอบก่อน (อันดับ 1–3) ไว้แสดง
  async lbCfg() {
    const c = (await this.st.get("cfg:lb")) || {};
    return { days: c.days === undefined ? 7 : Math.min(Math.max(Math.round(+c.days) || 0, 0), 90), at: +c.at || 0, prev: c.prev || null };
  }
  async lbCfgSet({ days, reset }) {
    const c = await this.lbCfg();
    if (days !== undefined && days !== null && days !== "") c.days = Math.min(Math.max(Math.round(+days) || 0, 0), 90);
    if (reset) await this.lbReset(c);
    else await this.st.put("cfg:lb", c);
    this._lb = null;
    return { ok: true, cfg: { days: c.days, at: c.at } };
  }
  async lbReset(c) {
    const cur = await this.leaderboard(true); // อันดับรอบที่จบ → เก็บ 1–3 ไว้เป็นแชมป์รอบก่อน
    const prev = { at: c.at, end: this.now(), boards: {} };
    for (const k of Object.keys(cur.boards || {})) prev.boards[k] = cur.boards[k].slice(0, 3);
    const old = await this.st.list({ prefix: "lb0:" });
    if (old.size) { const ks = [...old.keys()]; for (let i = 0; i < ks.length; i += 100) await this.st.delete(ks.slice(i, i + 100)); }
    let batch = {}, n = 0;
    for (const [k, m] of await this.st.list({ prefix: "svm:" })) {
      if (!m || !m.sum) continue;
      batch["lb0:" + k.slice(4)] = [m.sum.money | 0, m.sum.subs | 0, m.sum.day | 0];
      if (++n % 100 === 0) { await this.st.put(batch); batch = {}; }
    }
    if (Object.keys(batch).length) await this.st.put(batch);
    c.at = this.now(); c.prev = prev;
    await this.st.put("cfg:lb", c);
    this._lb = null;
  }
  async leaderboard(raw) {
    if (!raw && this._lb && this.now() - this._lb.t < 120000) return this._lb.data;
    const cfg = await this.lbCfg();
    if (!raw) {
      if (!cfg.at) { cfg.at = this.now(); await this.st.put("cfg:lb", cfg); } // เริ่มนับรอบแรกจากตอนนี้ (ยังไม่รีเซ็ตค่า)
      else if (cfg.days > 0 && this.now() - cfg.at >= cfg.days * 86400000) await this.lbReset(cfg);
    }
    const base = new Map();
    for (const [k, v] of await this.st.list({ prefix: "lb0:" })) base.set(k.slice(4), v);
    const rows = [];
    for (const [k, m] of await this.st.list({ prefix: "svm:" })) {
      if (!m || !m.sum) continue;
      const uid = k.slice(4), b = base.get(uid);
      const r = { uid, ...m.sum, u: m.u | 0 };
      if (b) { r.money = Math.max(0, (r.money | 0) - (b[0] | 0)); r.subs = Math.max(0, (r.subs | 0) - (b[1] | 0)); r.day = Math.max(0, (r.day | 0) - (b[2] | 0)); }
      rows.push(r);
    }
    const out = { ok: true, total: rows.length, at: this.now(), boards: {}, since: cfg.at, days: cfg.days, next: cfg.days > 0 && cfg.at ? cfg.at + cfg.days * 86400000 : 0, relative: base.size > 0, prev: cfg.prev || null };
    const cache = new Map();
    const who = async (r) => {
      if (cache.has(r.uid)) return cache.get(r.uid);
      const name = await this.st.get("id:" + r.uid);
      const acc = name ? await this.st.get("u:" + name) : null;
      const pf = (await this.st.get("pf:" + r.uid)) || {};
      const v = acc && !acc.banned ? { n: String(pf.nick || r.name || name).slice(0, 16), e: String(pf.emoji || "").slice(0, 4), uid: r.uid } : null;
      cache.set(r.uid, v);
      return v;
    };
    for (const [key, field] of [["money", "money"], ["subs", "subs"], ["day", "day"]]) {
      const sorted = rows.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
      const list = [];
      for (const r of sorted) {
        if (list.length >= 10) break;
        const w = await who(r);
        if (w) list.push({ n: w.n, e: w.e, v: r[field], path: r.path || "" });
      }
      out.boards[key] = list;
    }
    if (!raw) this._lb = { t: this.now(), data: out };
    return out;
  }
  // 👥 เพื่อน: fr:<uid> = { f:[เพื่อน], in:[คำขอที่ได้รับ], out:[คำขอที่ส่ง] } • เพื่อน≤50 คำขอ≤30
  async frGet(uid) { const r = (await this.st.get("fr:" + uid)) || {}; return { f: Array.isArray(r.f) ? r.f : [], in: Array.isArray(r.in) ? r.in : [], out: Array.isArray(r.out) ? r.out : [] }; }
  async friendAdd({ uid, username }) {
    const name = cleanName(username);
    const t = NAME_RE.test(name) ? await this.st.get("u:" + name) : null;
    if (!t || t.banned || !t.uid) return { ok: false, err: "nf" };
    if (t.uid === uid) return { ok: false, err: "self" };
    const rl = await this.rlCheck("fr:" + uid, 20, 30 * 60000, 30 * 60000);
    if (rl.locked) return { ok: false, err: "locked", wait: rl.wait };
    await this.rlFail("fr:" + uid, rl);
    const me = await this.frGet(uid), th = await this.frGet(t.uid);
    if (me.f.includes(t.uid)) return { ok: true, state: "friends" };
    const drop = (arr, x) => arr.filter((y) => y !== x);
    if (me.in.includes(t.uid)) { // อีกฝั่งขอมาก่อนแล้ว → เป็นเพื่อนกันเลย
      if (me.f.length >= 50 || th.f.length >= 50) return { ok: false, err: "full" };
      me.in = drop(me.in, t.uid); th.out = drop(th.out, uid); me.f.push(t.uid); th.f.push(uid);
      await this.st.put("fr:" + uid, me); await this.st.put("fr:" + t.uid, th);
      return { ok: true, state: "friends" };
    }
    if (me.out.includes(t.uid)) return { ok: true, state: "sent" };
    if (me.out.length >= 30 || th.in.length >= 30) return { ok: false, err: "full" };
    me.out.push(t.uid); th.in.push(uid);
    await this.st.put("fr:" + uid, me); await this.st.put("fr:" + t.uid, th);
    return { ok: true, state: "sent" };
  }
  async friendAnswer({ uid, target, accept }) {
    if (!UID_RE.test(String(target || ""))) return { ok: false, err: "bad" };
    const me = await this.frGet(uid), th = await this.frGet(target);
    const drop = (arr, x) => arr.filter((y) => y !== x);
    if (!me.in.includes(target)) return { ok: false, err: "nf" };
    me.in = drop(me.in, target); th.out = drop(th.out, uid);
    if (accept) {
      if (me.f.length >= 50 || th.f.length >= 50) return { ok: false, err: "full" };
      if (!me.f.includes(target)) me.f.push(target);
      if (!th.f.includes(uid)) th.f.push(uid);
    }
    await this.st.put("fr:" + uid, me); await this.st.put("fr:" + target, th);
    return { ok: true };
  }
  async friendRemove({ uid, target }) {
    if (!UID_RE.test(String(target || ""))) return { ok: false, err: "bad" };
    const me = await this.frGet(uid), th = await this.frGet(target);
    const drop = (arr, x) => arr.filter((y) => y !== x);
    for (const k of ["f", "in", "out"]) { me[k] = drop(me[k], target); th[k] = drop(th[k], uid); }
    await this.st.put("fr:" + uid, me); await this.st.put("fr:" + target, th);
    return { ok: true };
  }
  async friendList({ uid }) {
    const me = await this.frGet(uid);
    const info = async (u) => {
      const name = await this.st.get("id:" + u);
      if (!name) return null;
      const acc = await this.st.get("u:" + name);
      if (!acc || acc.banned) return null;
      const pf = (await this.st.get("pf:" + u)) || {};
      return { uid: u, n: String(pf.nick || name).slice(0, 16), e: String(pf.emoji || "").slice(0, 4) };
    };
    const map = async (arr) => (await Promise.all(arr.map(info))).filter(Boolean);
    return { ok: true, friends: await map(me.f), incoming: await map(me.in), outgoing: await map(me.out) };
  }
  async adminReports() {
    const all = [...(await this.st.list({ prefix: "rp:" }))];
    return { ok: true, reports: all.slice(-100).reverse().map(([k, v]) => ({ id: k, ...v })) };
  }
  async reportResolve({ id, action }) {
    if (!/^rp:\d{15}:[A-Za-z0-9_\-]+$/.test(String(id || ""))) return { ok: false, err: "bad" };
    if (action === "delete") { await this.st.delete(id); return { ok: true }; }
    const r = await this.st.get(id);
    if (!r) return { ok: false, err: "nf" };
    r.done = action === "dismiss" ? "ปัดตก" : "จัดการแล้ว";
    await this.st.put(id, r);
    return { ok: true };
  }
  async adminMute({ username, minutes }) { // ปิดเสียงบัญชี: minutes=0 ยกเลิก • เก็บไว้ในบัญชี มีผลทุกห้องและตอนเชื่อมต่อใหม่
    const name = cleanName(username);
    const rec = NAME_RE.test(name) ? await this.st.get("u:" + name) : null;
    if (!rec) return { ok: false, err: "nf" };
    const m = Math.max(0, Math.min(Math.round(+minutes) || 0, 60 * 24 * 365));
    rec.muteUntil = m ? this.now() + m * 60000 : 0;
    await this.st.put("u:" + name, rec);
    return { ok: true, uid: rec.uid, until: rec.muteUntil };
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
    for (const k of ["u:" + t.name, "id:" + uid, "pf:" + uid, "sv:" + uid, "svm:" + uid, "fr:" + uid]) await this.st.delete(k);
    await this.dropBackups(uid);
    return { ok: true };
  }

  // ----- ล็อกเกม: แอดมินปิดเกมไว้ก่อน (ผู้เล่นทั่วไปเข้าไม่ได้ แอดมินเข้าได้) -----
  async locksGet() {
    const l = (await this.st.get("cfg:locks")) || {};
    const one = (g) => ({ on: !!(l[g] && l[g].on), msg: String((l[g] && l[g].msg) || "").slice(0, 200) });
    return { farm: one("farm"), life: one("life") };
  }
  async locksSet({ game, on, msg }) {
    if (game !== "farm" && game !== "life") return { ok: false, err: "game" };
    const l = await this.locksGet();
    l[game] = { on: !!on, msg: Array.from(String(msg || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim()).slice(0, 200).join("") };
    await this.st.put("cfg:locks", l);
    return { ok: true, locks: l };
  }

  // ----- เวลาทดลองเล่นของผู้ที่ยังไม่ล็อกอิน (แยกตามคุกกี้ bssj_gid) -----
  async guestCfg() {
    const c = (await this.st.get("cfg:guest")) || {};
    return { on: c.on !== false, min: Math.min(Math.max(Math.round(+c.min) || 120, 5), 1440) };
  }
  async guestCfgSet({ on, min }) {
    const c = { on: !!on, min: Math.min(Math.max(Math.round(+min) || 120, 5), 1440) };
    await this.st.put("cfg:guest", c);
    return { ok: true, cfg: c };
  }
  async guestStatus(gid, tick) {
    const cfg = await this.guestCfg();
    const limit = cfg.min * 60;
    let rec = (/^[A-Za-z0-9_\-]{16,40}$/.test(String(gid || "")) && (await this.st.get("g:" + gid))) || null;
    if (tick && /^[A-Za-z0-9_\-]{16,40}$/.test(String(gid || ""))) {
      const now = this.now();
      rec = rec || { sec: 0, first: now, last: 0 };
      // นับเฉพาะเวลาจริงที่ผ่านไปตั้งแต่ครั้งก่อน (สูงสุด 90 วินาทีต่อครั้ง) ลูกค้าโกงเพิ่มเวลาไม่ได้
      const add = rec.last ? Math.min(90, Math.max(0, Math.round((now - rec.last) / 1000))) : 0;
      rec = { sec: rec.sec + add, first: rec.first, last: now };
      await this.st.put("g:" + gid, rec);
    }
    const used = rec ? rec.sec : 0;
    return { ok: true, on: cfg.on, limit, used, left: cfg.on ? Math.max(0, limit - used) : limit };
  }

  // ----- บันทึกการกระทำของแอดมิน (audit log) — เก็บ ~300 รายการล่าสุด -----
  async logAct({ by, act, target, x }) {
    const t = this.now();
    await this.st.put("log:" + String(t).padStart(15, "0") + ":" + randB64u(3), { t, by: String(by || "").slice(0, 20), act: String(act || "").slice(0, 30), target: String(target || "").slice(0, 40), x: String(x || "").slice(0, 120) });
  }
  async adminLogClear() { // ล้างบันทึกทั้งหมด (ผู้เรียกเขียนรายการ "ล้างบันทึก" ไว้เป็นหลักฐานหลังจากนี้)
    const all = await this.st.list({ prefix: "log:" });
    const ks = [...all.keys()];
    for (let i = 0; i < ks.length; i += 100) await this.st.delete(ks.slice(i, i + 100));
    return { ok: true, n: ks.length };
  }
  async adminLog() {
    const all = await this.st.list({ prefix: "log:" });
    const rows = [...all];
    if (rows.length > 400) for (const [k] of rows.slice(0, rows.length - 300)) await this.st.delete(k);
    return { ok: true, log: rows.slice(-120).reverse().map(([, v]) => v) };
  }
  // โปรไฟล์สาธารณะ (ชื่อเล่น/อีโมจิ/สี/รูป) ใช้แสดงให้คนในห้องออนไลน์เห็น
  async pubProfile(uid) {
    if (!UID_RE.test(String(uid || ""))) return null;
    const name = await this.st.get("id:" + uid);
    if (!name) return null;
    const pf = (await this.st.get("pf:" + uid)) || {};
    return { nick: pf.nick || name, emoji: pf.emoji || "🧑‍🌾", color: pf.color || "#f2b134", pic: pf.pic || "" };
  }
  // ปลดการผูก: ย้ายบัญชีนี้ไปใช้ ID ใหม่ เพื่อคืน ID เดิมให้เจ้าของเซฟตัวจริงมาสมัครผูกได้ (กรณีมีคนสมัครตัดหน้า)
  async adminUnbind({ by, username }) {
    const t = await this.adminTarget(by, username);
    if (t.err) return { ok: false, err: t.err };
    const old = t.rec.uid;
    const nu = "u" + randB64u(15).replace(/[^A-Za-z0-9]/g, "x");
    for (const pre of ["pf:", "sv:", "svm:"]) {
      const v = await this.st.get(pre + old);
      if (v !== undefined && v !== null) { await this.st.put(pre + nu, v); await this.st.delete(pre + old); }
    }
    for (const [i] of await this.backupList(old)) for (const pre of ["svb:", "svbm:"]) {
      const v = await this.st.get(pre + old + ":" + i);
      if (v !== undefined && v !== null) { await this.st.put(pre + nu + ":" + i, v); await this.st.delete(pre + old + ":" + i); }
    }
    await this.st.delete("id:" + old);
    await this.st.put("id:" + nu, t.name);
    t.rec.uid = nu;
    t.rec.claimed = false;
    await this.st.put("u:" + t.name, t.rec);
    await this.dropSessions(old, "");
    return { ok: true, oldUid: old, newUid: nu };
  }
}
