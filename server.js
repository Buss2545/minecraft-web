// Mari JP SMP - real backend starter
// - salted scrypt password hashing
// - session cookies (in-memory session store)
// - orders + users persisted to data.json
// - /api/status proxies mcsrvstat.us so the browser never needs to hit a
//   third-party API directly (avoids CORS issues + keeps things simple)
'use strict';

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');

// ---------- config ----------
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'mari_sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IS_PROD = process.env.NODE_ENV === 'production';

// The Minecraft server the site advertises. Override with env vars if you
// ever move host/port without touching code.
const MC_HOST = process.env.MC_HOST || 'marijp2006.svmine.com';
const MC_PORT = process.env.MC_PORT || '11206';

// Canonical shop catalog. NEVER trust price/product from the client -
// always look it up here before writing an order.
const SHOP_PRODUCTS = {
  'VIP': 50,
  'VIP+': 100,
  'MVP': 150,
  'MVP+': 200,
  'ELITE': 300,
  'LEGEND': 500,
  'EMPEROR': 1000
};

// ---------- tiny JSON "database" ----------
// A single JSON file is fine for a small server starter. Writes are
// serialized through a promise chain so two requests can never interleave
// and corrupt the file, and each write goes to a temp file + rename so a
// crash mid-write can't leave data.json truncated.
let writeChain = Promise.resolve();

async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.orders)) parsed.orders = [];
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { users: [], orders: [] };
    throw err;
  }
}

function writeData(data) {
  writeChain = writeChain.then(async () => {
    const tmp = DATA_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, DATA_FILE);
  });
  return writeChain;
}

// Mutating read-modify-write helper: guarantees the read and write happen
// back-to-back on the same "turn" of the write chain.
function mutateData(mutator) {
  const result = writeChain.then(readData).then(async (data) => {
    const out = await mutator(data);
    const tmp = DATA_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, DATA_FILE);
    return out;
  });
  writeChain = result.then(() => {}, () => {}); // keep chain alive even on error
  return result;
}

// ---------- password hashing (scrypt + per-user salt) ----------
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return resolve(false);
    const salt = Buffer.from(saltHex, 'hex');
    const hashBuf = Buffer.from(hashHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== hashBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, hashBuf));
    });
  });
}

// ---------- sessions (in-memory) ----------
// sessionId -> { userId, createdAt }
// Restarting the server clears sessions (users just log in again). That's a
// fine trade-off for a starter; swap in a store like connect-redis or a
// "sessions" table in a real database for production.
const sessions = new Map();

function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { userId, createdAt: Date.now() });
  return id;
}

function destroySession(id) {
  sessions.delete(id);
}

function getSession(req) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  return { id, ...session };
}

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ---------- basic per-IP rate limiting for auth endpoints ----------
// Not a substitute for a real rate limiter in production, but stops the
// most obvious brute-force scripts.
const attempts = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'พยายามมากเกินไป กรุณาลองใหม่ภายหลัง' });
  }
  next();
}

// ---------- validation ----------
function validateUsername(username) {
  if (typeof username !== 'string') return 'Username ไม่ถูกต้อง';
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 24) return 'Username ต้องมี 3-24 ตัวอักษร';
  if (!/^[A-Za-z0-9_ก-๙-]+$/.test(trimmed)) return 'Username ใช้ได้เฉพาะตัวอักษร ตัวเลข _ และภาษาไทย';
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) return 'Password ต้องมีอย่างน้อย 6 ตัวอักษร';
  if (password.length > 200) return 'Password ยาวเกินไป';
  return null;
}

function publicUser(user) {
  return { id: user.id, username: user.username, minecraft: user.minecraft || '' };
}

// ---------- /api/status caching ----------
let statusCache = { at: 0, data: null };
const STATUS_CACHE_MS = 20 * 1000;

async function fetchEdition(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return { online: false };
    const d = await r.json();
    return {
      online: !!d.online,
      players: d.players ? { online: d.players.online ?? 0, max: d.players.max ?? 0 } : { online: 0, max: 0 },
      motd: d.motd?.clean?.[0] || '',
      version: d.version || ''
    };
  } catch (e) {
    return { online: false };
  }
}

async function getServerStatus() {
  const now = Date.now();
  if (statusCache.data && now - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.data;
  }
  const target = `${MC_HOST}:${MC_PORT}`;
  const [java, bedrock] = await Promise.all([
    fetchEdition(`https://api.mcsrvstat.us/3/${encodeURIComponent(target)}`),
    fetchEdition(`https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(target)}`)
  ]);
  const data = {
    host: target,
    online: java.online || bedrock.online,
    java,
    bedrock,
    checkedAt: new Date().toISOString()
  };
  statusCache = { at: now, data };
  return data;
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1); // needed for req.ip to be correct behind a reverse proxy / HTTPS terminator
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  req.session = session;
  next();
}

// ---- auth ----
app.post('/api/register', rateLimit, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const usernameErr = validateUsername(username);
    if (usernameErr) return res.status(400).json({ error: usernameErr });
    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ error: passwordErr });

    const result = await mutateData(async (data) => {
      const exists = data.users.some(u => u.username.toLowerCase() === username.toLowerCase());
      if (exists) throw new Error('Username นี้ถูกใช้งานแล้ว');
      const user = {
        id: 'U' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
        username,
        passwordHash: await hashPassword(password),
        minecraft: '',
        createdAt: new Date().toISOString()
      };
      data.users.push(user);
      return user;
    });

    const sessionId = createSession(result.id);
    setSessionCookie(res, sessionId);
    res.json({ success: true, user: publicUser(result) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'สมัครสมาชิกไม่สำเร็จ' });
  }
});

app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const data = await readData();
    const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });

    const sessionId = createSession(user.id);
    setSessionCookie(res, sessionId);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'เข้าสู่ระบบไม่สำเร็จ' });
  }
});

app.post('/api/logout', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) destroySession(sid);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const data = await readData();
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
  res.json({ user: publicUser(user) });
});

// ---- live server status ----
app.get('/api/status', async (req, res) => {
  try {
    const status = await getServerStatus();
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: 'ไม่สามารถตรวจสอบสถานะเซิร์ฟเวอร์ได้', online: false });
  }
});

// ---- orders ----
app.get('/api/orders', requireAuth, async (req, res) => {
  const data = await readData();
  const orders = data.orders
    .filter(o => o.userId === req.session.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders });
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const product = String(req.body?.product || '').trim();
    const minecraft = String(req.body?.minecraft || '').trim();

    if (!Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, product)) {
      return res.status(400).json({ error: 'ไม่พบสินค้านี้ในร้านค้า' });
    }
    if (!minecraft || minecraft.length > 32) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ Minecraft ให้ถูกต้อง' });
    }

    // Price always comes from the server-side catalog, never the client.
    const price = SHOP_PRODUCTS[product];

    const order = await mutateData((data) => {
      const rec = {
        id: 'MARI-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
        userId: req.session.userId,
        product,
        price,
        minecraft,
        status: 'รอตรวจสอบ',
        createdAt: new Date().toISOString()
      };
      data.orders.push(rec);
      return rec;
    });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'สร้างคำสั่งซื้อไม่สำเร็จ' });
  }
});

// Fallback: serve index.html for anything else (single-page site with hash routing)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'ไม่พบคำสั่งที่ต้องการ' }));

app.listen(PORT, () => {
  console.log(`Mari JP SMP server running at http://localhost:${PORT}`);
});
