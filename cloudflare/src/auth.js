import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { getDatabase, users, sessions, loginAttempts } from './db.js';

const SESSION_COOKIE = 'mari_sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function json(data, status = 200, headers = {}) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

function cookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function setCookie(headers, value) {
  headers.append('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`);
}

function clearCookie(headers) {
  headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return resolve(false);
    try {
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      scrypt(password, salt, expected.length, (err, derived) => {
        if (err) return reject(err);
        resolve(derived.length === expected.length && timingSafeEqual(derived, expected));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function validateUsername(username) {
  if (typeof username !== 'string') return 'Username ไม่ถูกต้อง';
  const value = username.trim();
  if (value.length < 3 || value.length > 24) return 'Username ต้องมี 3-24 ตัวอักษร';
  if (!/^[A-Za-z0-9_ก-๙-]+$/.test(value)) return 'Username ใช้ได้เฉพาะตัวอักษร ตัวเลข _ และภาษาไทย';
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) return 'Password ต้องมีอย่างน้อย 6 ตัวอักษร';
  if (password.length > 200) return 'Password ยาวเกินไป';
  return null;
}

async function uniqueUid(collection) {
  for (let i = 0; i < 20; i++) {
    const uid = Math.floor(100000 + Math.random() * 900000);
    if (!(await collection.findOne({ uid }))) return uid;
  }
  throw new Error('สร้าง UID ไม่สำเร็จ กรุณาลองใหม่');
}

function titleFor(user) {
  const titles = {
    member: ['สมาชิกใหม่', '🌱', '#35a95c'],
    admin: ['แอดมิน', '🛡️', '#d94b63'],
    trader: ['ผู้ซื้อขาย', '💰', '#c98a1c'],
    creator: ['ผู้สร้างเซิร์ฟเวอร์และเว็บไซต์', '🌸', '#ee7fa5'],
    moderator: ['ผู้ดูแลชุมชน', '💬', '#4d8bd8'],
    builder: ['นักสร้างโลก', '🧱', '#a66b3d'],
    supporter: ['ผู้สนับสนุนเซิร์ฟเวอร์', '💎', '#6d68d9'],
    veteran: ['ผู้เล่นรุ่นบุกเบิก', '⚔️', '#8c5bc7'],
    tester: ['นักทดสอบระบบ', '🔧', '#2f9e9e'],
    event_host: ['ผู้จัดกิจกรรม', '🎉', '#e7832b']
  };
  const [label, icon, color] = titles[user?.titleId] || titles.member;
  return { id: user?.titleId || 'member', label, icon, color };
}

function publicUser(user) {
  return {
    id: user.id,
    uid: user.uid,
    username: user.username,
    displayName: user.displayName || user.username,
    title: titleFor(user),
    minecraft: user.minecraft || '',
    minecraftVerified: !!user.minecraftVerified,
    balance: Number(user.balance || 0),
    rconAvailable: false
  };
}

function moderationStatus(user) {
  const m = user?.moderation || {};
  const active = entry => {
    if (!entry) return null;
    if (entry.permanent === true) return entry;
    const until = entry.until ? new Date(entry.until).getTime() : NaN;
    return Number.isFinite(until) && until > Date.now() ? entry : null;
  };
  const mute = active(m.mute);
  const ban = active(m.ban);
  return {
    muted: !!mute,
    banned: !!ban,
    mute: mute ? { until: mute.until || null, permanent: mute.permanent === true, reason: String(mute.reason || 'ไม่ได้ระบุเหตุผล'), startedAt: mute.startedAt || null } : null,
    ban: ban ? { until: ban.until || null, permanent: ban.permanent === true, reason: String(ban.reason || 'ไม่ได้ระบุเหตุผล'), startedAt: ban.startedAt || null } : null
  };
}

function moderationMessage(type, entry) {
  const label = type === 'ban' ? 'ถูกแบน' : 'ถูกปิดแชท';
  const until = entry?.permanent === true ? 'ถาวร' : (entry?.until ? new Date(entry.until).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ระบุ');
  return `${label}\nเหตุผล: ${String(entry?.reason || 'ไม่ได้ระบุเหตุผล')}\n${type === 'ban' ? 'ปลดแบน' : 'ปลด mute'}: ${until}`;
}

async function readJson(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

async function limited(db, request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const now = Date.now();
  const collection = loginAttempts(db);
  const existing = await collection.findOne({ ip, resetAt: { $gt: now } });
  if (existing && existing.count >= RATE_LIMIT_MAX) return false;
  await collection.updateOne(
    { ip },
    { $inc: { count: 1 }, $setOnInsert: { ip, resetAt: now + RATE_LIMIT_WINDOW_MS } },
    { upsert: true }
  );
  return true;
}

async function createSession(db, userId) {
  const id = randomBytes(32).toString('hex');
  await sessions(db).insertOne({ id, userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS) });
  return id;
}

export async function getAuthUser(request, env) {
  const sid = cookieValue(request, SESSION_COOKIE);
  if (!sid) return null;
  const db = await getDatabase(env);
  const session = await sessions(db).findOne({ id: sid });
  if (!session || (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now())) return null;
  const user = await users(db).findOne({ id: session.userId });
  if (!user) return null;
  const moderation = moderationStatus(user);
  if (moderation.banned) return { user: null, moderation, sessionId: sid };
  await users(db).updateOne({ id: user.id }, { $set: { lastActiveAt: new Date().toISOString() } }).catch(() => {});
  return { user, moderation, sessionId: sid };
}

export async function handleAuth(path, request, env) {
  const db = await getDatabase(env);
  const collection = users(db);

  if (path === '/api/register' && request.method === 'POST') {
    if (!(await limited(db, request))) return json({ error: 'พยายามมากเกินไป กรุณาลองใหม่ภายหลัง' }, 429);
    const body = await readJson(request);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const usernameErr = validateUsername(username);
    if (usernameErr) return json({ error: usernameErr }, 400);
    const passwordErr = validatePassword(password);
    if (passwordErr) return json({ error: passwordErr }, 400);
    const usernameLower = username.toLowerCase();
    if (await collection.findOne({ usernameLower })) return json({ error: 'Username นี้ถูกใช้งานแล้ว' }, 400);
    const user = {
      id: 'U' + Date.now().toString(36) + randomBytes(4).toString('hex'),
      uid: await uniqueUid(collection), username, usernameLower, displayName: username,
      titleId: 'member', passwordHash: await hashPassword(password), minecraft: '', minecraftVerified: false,
      balance: 0, createdAt: new Date().toISOString()
    };
    try { await collection.insertOne(user); } catch (err) {
      if (err?.code === 11000) return json({ error: 'Username นี้ถูกใช้งานแล้ว' }, 400);
      throw err;
    }
    const sid = await createSession(db, user.id);
    const headers = new Headers(); setCookie(headers, sid);
    return json({ success: true, user: publicUser(user) }, 200, headers);
  }

  if (path === '/api/login' && request.method === 'POST') {
    if (!(await limited(db, request))) return json({ error: 'พยายามมากเกินไป กรุณาลองใหม่ภายหลัง' }, 429);
    const body = await readJson(request);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const user = await collection.findOne({ usernameLower: username.toLowerCase() });
    if (!user || !(await verifyPassword(password, user.passwordHash))) return json({ error: 'Username หรือ Password ไม่ถูกต้อง' }, 401);
    const moderation = moderationStatus(user);
    if (moderation.banned) return json({ error: moderationMessage('ban', moderation.ban), code: 'ACCOUNT_BANNED', moderation }, 403);
    const sid = await createSession(db, user.id);
    const headers = new Headers(); setCookie(headers, sid);
    return json({ success: true, user: publicUser(user) }, 200, headers);
  }

  if (path === '/api/logout' && request.method === 'POST') {
    const sid = cookieValue(request, SESSION_COOKIE);
    if (sid) await sessions(db).deleteOne({ id: sid });
    const headers = new Headers(); clearCookie(headers);
    return json({ success: true }, 200, headers);
  }

  if (path === '/api/me' && request.method === 'GET') {
    const auth = await getAuthUser(request, env);
    if (!auth?.user) {
      const headers = new Headers();
      if (auth?.sessionId) clearCookie(headers);
      return json({ error: auth?.moderation?.banned ? moderationMessage('ban', auth.moderation.ban) : 'กรุณาเข้าสู่ระบบ' }, auth?.moderation?.banned ? 403 : 401, headers);
    }
    return json({ user: { ...publicUser(auth.user), moderation: auth.moderation } });
  }

  return null;
}
