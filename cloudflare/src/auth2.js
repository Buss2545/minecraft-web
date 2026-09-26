import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { getDatabase, users, sessions } from './db.js';

const COOKIE = 'mari_sid';
const MAX_AGE = 7 * 24 * 60 * 60;

function json(data, status = 200, headers = {}) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

function getCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

function scryptAsync(password, salt, length = 64) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function passwordOk(password, stored) {
  try {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== 64) return false;
    const actual = await scryptAsync(password, salt, 64);
    return timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function publicUser(user) {
  const titleId = user.titleId || 'member';
  return {
    id: user.id,
    uid: user.uid || null,
    username: user.username,
    displayName: user.displayName || user.username,
    displayNameChangedAt: user.displayNameChangedAt || null,
    avatarUrl: user.avatarUrl || '',
    titleId,
    title: { id: titleId },
    minecraft: user.minecraft || '',
    minecraftVerified: !!user.minecraftVerified,
    balance: Number(user.balance || 0),
    rconAvailable: false
  };
}

function setSession(headers, id) {
  headers.append('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}

function clearSession(headers) {
  headers.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

async function newSession(db, userId) {
  const id = randomBytes(32).toString('hex');
  await sessions(db).insertOne({
    id,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + MAX_AGE * 1000)
  });
  return id;
}

export async function handleAuth2(path, request, env) {
  const db = await getDatabase(env);
  const collection = users(db);

  if (path === '/api/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const user = await collection.findOne({ usernameLower: username.toLowerCase() });
    if (!user) return json({ error: 'Username หรือ Password ไม่ถูกต้อง' }, 401);
    const ok = await passwordOk(password, user.passwordHash);
    if (!ok) return json({ error: 'Username หรือ Password ไม่ถูกต้อง' }, 401);
    if (user?.moderation?.ban?.permanent === true) {
      return json({ error: 'บัญชีถูกแบน', code: 'ACCOUNT_BANNED' }, 403);
    }
    const sid = await newSession(db, user.id);
    const headers = new Headers();
    setSession(headers, sid);
    return json({ success: true, user: publicUser(user) }, 200, headers);
  }

  if (path === '/api/logout' && request.method === 'POST') {
    const sid = getCookie(request);
    if (sid) await sessions(db).deleteOne({ id: sid });
    const headers = new Headers();
    clearSession(headers);
    return json({ success: true }, 200, headers);
  }

  if (path === '/api/me' && request.method === 'GET') {
    const sid = getCookie(request);
    if (!sid) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
    const session = await sessions(db).findOne({ id: sid });
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
    const user = await collection.findOne({ id: session.userId });
    if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
    return json({ user: publicUser(user) });
  }

  if (path === '/api/register' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    if (!/^[A-Za-z0-9_ก-๙-]{3,24}$/.test(username)) return json({ error: 'Username ต้องมี 3-24 ตัวอักษร' }, 400);
    if (password.length < 6 || password.length > 200) return json({ error: 'Password ต้องมี 6-200 ตัวอักษร' }, 400);
    const usernameLower = username.toLowerCase();
    if (await collection.findOne({ usernameLower })) return json({ error: 'Username นี้ถูกใช้งานแล้ว' }, 400);
    const user = {
      id: 'U' + Date.now().toString(36) + randomBytes(4).toString('hex'),
      uid: Math.floor(100000 + Math.random() * 900000),
      username,
      usernameLower,
      displayName: username,
      titleId: 'member',
      passwordHash: await passwordHash(password),
      minecraft: '',
      minecraftVerified: false,
      balance: 0,
      createdAt: new Date().toISOString()
    };
    await collection.insertOne(user);
    const sid = await newSession(db, user.id);
    const headers = new Headers();
    setSession(headers, sid);
    return json({ success: true, user: publicUser(user) }, 200, headers);
  }

  return null;
}
