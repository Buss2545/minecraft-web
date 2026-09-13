// Mari JP SMP - real backend starter
// - salted scrypt password hashing
// - session cookies (in-memory session store)
// - accounts, wallet balances, orders, and top-ups persisted to MongoDB Atlas
// - /api/status proxies mcstatus.io so the browser never needs to hit a
//   third-party API directly (avoids CORS issues + keeps things simple)
'use strict';

const path = require('path');
const crypto = require('crypto');
const net = require('net');
const express = require('express');
const cookieParser = require('cookie-parser');
const { MongoClient } = require('mongodb');

// ---------- config ----------
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'mari_sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IS_PROD = process.env.NODE_ENV === 'production';

// MongoDB Atlas (free tier) - required. Without persistent storage,
// everyone's account/credit would get wiped on every deploy (Render's free
// plan has no permanent disk), which is the whole reason this exists.
const MONGODB_URI = process.env.MONGODB_URI || '';

// The Minecraft server the site advertises. Override with env vars if you
// ever move host/port without touching code.
const MC_HOST = process.env.MC_HOST || 'marijp2006.svmine.com';
const MC_PORT = process.env.MC_PORT || '11206';

// RCON lets the website send commands to your actual Minecraft server -
// used here to verify "ผูกไอดี Minecraft" by checking the live player list.
// Leave these unset if you don't have RCON access; the bind feature just
// falls back to unverified (saves the name without checking).
// IMPORTANT: RCON's own port is almost always different from the port
// players connect on (MC_PORT above) - check your host's control panel.
const RCON_HOST = process.env.RCON_HOST || '';
const RCON_PORT = process.env.RCON_PORT ? Number(process.env.RCON_PORT) : 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD || '';
const RCON_ENABLED = !!(RCON_HOST && RCON_PASSWORD);

// Secret key that gates /admin.html + the /api/admin/* endpoints (approving
// top-up requests). Set this as an env var on Render - if it's left unset,
// the admin endpoints are disabled entirely (safer default than an open
// admin panel with no password).
const ADMIN_KEY = process.env.ADMIN_KEY || '';

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

// Exchange rate for converting wallet credit into in-game PlayerPoints.
// 1 baht = this many points. Change this one number to adjust the rate.
const POINTS_PER_BAHT = Number(process.env.POINTS_PER_BAHT || 1);
const MIN_POINTS_REDEEM_BAHT = 1;
const MAX_POINTS_REDEEM_BAHT = 100000;

// ---------- MongoDB connection ----------
// Documents keep the same app-level "id" field (not Mongo's _id) so the
// rest of the code barely changed from the file-based version. A unique
// index on usernameLower does the case-insensitive uniqueness check that
// used to be a manual .find() over the whole users array.
let db = null; // set by connectDB(): { users, orders, topups } collections
let mongoClient = null;

async function connectDB() {
  if (!MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is not set. Get a free connection string from MongoDB Atlas and set it as an env var.');
    process.exit(1);
  }
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const database = mongoClient.db(); // uses the database name embedded in the URI
  db = {
    users: database.collection('users'),
    orders: database.collection('orders'),
    topups: database.collection('topups')
  };
  await db.users.createIndex({ usernameLower: 1 }, { unique: true });
  await db.orders.createIndex({ userId: 1, createdAt: -1 });
  await db.topups.createIndex({ userId: 1, createdAt: -1 });
  await db.topups.createIndex({ status: 1, createdAt: -1 });
  console.log('Connected to MongoDB - data will now survive redeploys.');
}

// Strips MongoDB's internal _id before sending any document back out.
function omitMongoId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
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
  return {
    id: user.id,
    username: user.username,
    minecraft: user.minecraft || '',
    minecraftVerified: !!user.minecraftVerified,
    balance: Number(user.balance || 0)
  };
}

// ---------- RCON (talks directly to the Minecraft server's console) ----------
// Implemented by hand against the standard Source RCON protocol (the same
// one Minecraft uses) instead of pulling in a third-party package - it's a
// short, stable binary protocol and this keeps behavior fully predictable.
// Packet layout: int32 size | int32 requestId | int32 type | body\0 | \0
function rconCommand(host, port, password, command, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err); else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('RCON timeout ต่อเซิร์ฟเวอร์ไม่สำเร็จ')), timeoutMs);

    function buildPacket(id, type, body) {
      const bodyBuf = Buffer.from(body, 'utf8');
      const size = 4 + 4 + bodyBuf.length + 2;
      const packet = Buffer.alloc(4 + size);
      packet.writeInt32LE(size, 0);
      packet.writeInt32LE(id, 4);
      packet.writeInt32LE(type, 8);
      bodyBuf.copy(packet, 12);
      packet.writeInt8(0, 12 + bodyBuf.length);
      packet.writeInt8(0, 12 + bodyBuf.length + 1);
      return packet;
    }

    socket.on('connect', () => socket.write(buildPacket(1, 3, password))); // 3 = SERVERDATA_AUTH

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readInt32LE(0);
        if (buffer.length < 4 + size) break;
        const packet = buffer.subarray(0, 4 + size);
        buffer = buffer.subarray(4 + size);
        const id = packet.readInt32LE(4);
        const type = packet.readInt32LE(8);
        const body = packet.subarray(12, packet.length - 2).toString('utf8');

        if (!authenticated) {
          if (type === 2) { // SERVERDATA_AUTH_RESPONSE
            if (id === -1) return finish(new Error('RCON password ไม่ถูกต้อง'));
            authenticated = true;
            socket.write(buildPacket(2, 2, command)); // 2 = SERVERDATA_EXECCOMMAND
          }
        } else {
          return finish(null, body);
        }
      }
    });

    socket.on('error', (err) => finish(err));
    socket.on('close', () => finish(new Error('RCON การเชื่อมต่อถูกปิดกะทันหัน')));
  });
}

// Sends the PlayerPoints plugin's console command to credit a player.
// Works for offline players too (PlayerPoints resolves UUIDs itself), so
// we don't require the target to be online like the /list check does.
// Throws on any RCON failure - callers must treat that as "did not
// necessarily happen" and are responsible for refunding the wallet.
async function giveRconPoints(username, amount) {
  if (!RCON_ENABLED) throw new Error('ยังไม่ได้ตั้งค่า RCON บนเซิร์ฟเวอร์');
  await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, `points give ${username} ${amount}`);
}

// Checks the live `/list` output for an exact (case-insensitive) username
// match. Returns false (never throws) if RCON isn't configured or fails -
// callers should treat that as "couldn't verify", not "definitely offline".
async function isPlayerOnlineViaRcon(username) {
  if (!RCON_ENABLED) return false;
  try {
    const result = await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, 'list');
    // Vanilla format: "There are 2 of a max of 25 players online: Alice, Bob"
    const afterColon = result.includes(':') ? result.split(':').slice(1).join(':') : '';
    const names = afterColon.split(',').map(s => s.trim()).filter(Boolean);
    return names.some(n => n.toLowerCase() === username.toLowerCase());
  } catch (e) {
    return false;
  }
}

// ---------- /api/status caching ----------
// mcstatus.io caches results for ~1 minute upstream (mcsrvstat.us, which we
// used to call here, caches for 5 minutes - too slow for a "live" counter).
// We add a short cache of our own on top just to avoid hammering it if
// several browser tabs poll at once.
let statusCache = { at: 0, data: null };
const STATUS_CACHE_MS = 15 * 1000;

async function fetchEdition(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'mari-jp-smp-website (status widget)' }
    });
    clearTimeout(timer);
    if (!r.ok) return { online: false };
    const d = await r.json();
    const motdClean = Array.isArray(d.motd?.clean) ? d.motd.clean[0] : d.motd?.clean;
    return {
      online: !!d.online,
      players: d.players ? { online: d.players.online ?? 0, max: d.players.max ?? 0 } : { online: 0, max: 0 },
      motd: motdClean || '',
      version: d.version?.name_clean || d.version?.name || d.version || ''
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
    fetchEdition(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target)}`),
    fetchEdition(`https://api.mcstatus.io/v2/status/bedrock/${encodeURIComponent(target)}`)
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

// Some deploy setups end up with html files at the repo root instead of
// inside public/ (e.g. uploaded to the wrong folder on GitHub).
// Auto-detect whichever location actually has each file, instead of hard
// failing with ENOENT. Only ever serves these specific known filenames -
// never the whole root directory (that would expose server.js/data.json).
const fsSync = require('fs');
function resolveHtml(filename) {
  const inPublic = path.join(PUBLIC_DIR, filename);
  const inRoot = path.join(__dirname, filename);
  return fsSync.existsSync(inPublic) ? inPublic : inRoot;
}
const INDEX_FILE = resolveHtml('index.html');
if (!fsSync.existsSync(INDEX_FILE)) {
  console.warn('WARNING: could not find index.html in public/ or the project root.');
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1); // needed for req.ip to be correct behind a reverse proxy / HTTPS terminator
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR)); // serves anything in public/ (safe even if that folder doesn't exist)

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

    const usernameLower = username.toLowerCase();
    const existing = await db.users.findOne({ usernameLower });
    if (existing) return res.status(400).json({ error: 'Username นี้ถูกใช้งานแล้ว' });

    const user = {
      id: 'U' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      username,
      usernameLower,
      passwordHash: await hashPassword(password),
      minecraft: '',
      minecraftVerified: false,
      balance: 0,
      createdAt: new Date().toISOString()
    };

    try {
      await db.users.insertOne(user);
    } catch (err) {
      // 11000 = duplicate key - someone else registered the same name a
      // split second earlier; the unique index is the real source of truth.
      if (err.code === 11000) return res.status(400).json({ error: 'Username นี้ถูกใช้งานแล้ว' });
      throw err;
    }

    const sessionId = createSession(user.id);
    setSessionCookie(res, sessionId);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'สมัครสมาชิกไม่สำเร็จ' });
  }
});

app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const user = await db.users.findOne({ usernameLower: username.toLowerCase() });
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
  const user = await db.users.findOne({ id: req.session.userId });
  if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
  res.json({ user: publicUser(user) });
});

// ---- bind a Minecraft username to the website account ----
// If RCON is configured (RCON_HOST + RCON_PASSWORD env vars), this checks
// the live /list output on the actual server and only marks the bind as
// "verified" if that exact name is online right now. Ask the player to
// join the server first, then press "ผูกไอดี" while they're in-game.
// Without RCON configured, it still saves the name, just unverified -
// good enough for staff to manually double check before granting a rank.
app.post('/api/account/minecraft', requireAuth, async (req, res) => {
  try {
    const raw = String(req.body?.minecraft || '').trim();
    // Keep this strict: it may end up inside RCON/game commands later, so
    // only allow characters real Java/Bedrock usernames actually use.
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(raw)) {
      return res.status(400).json({ error: 'ชื่อ Minecraft ต้องมี 3-16 ตัวอักษร (a-z, 0-9, _ เท่านั้น)' });
    }

    let verified = false;
    if (RCON_ENABLED) {
      const online = await isPlayerOnlineViaRcon(raw);
      if (!online) {
        return res.status(400).json({
          error: `ไม่พบชื่อ "${raw}" ออนไลน์อยู่ในเซิร์ฟเวอร์ตอนนี้ กรุณาเข้าเกมก่อนแล้วค่อยกดผูกไอดีอีกครั้ง`
        });
      }
      verified = true;
    }

    const result = await db.users.findOneAndUpdate(
      { id: req.session.userId },
      { $set: { minecraft: raw, minecraftVerified: verified } },
      { returnDocument: 'after' }
    );
    const user = result?.value || result; // driver version differences
    if (!user) return res.status(400).json({ error: 'ไม่พบบัญชีนี้' });

    res.json({ success: true, user: publicUser(user), rconChecked: RCON_ENABLED });
  } catch (err) {
    res.status(400).json({ error: err.message || 'ผูกไอดีไม่สำเร็จ' });
  }
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
  const orders = await db.orders.find({ userId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  res.json({ orders: orders.map(omitMongoId) });
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

    // Atomic "pay if you can afford it" update - the balance>=price filter
    // means this only matches (and only deducts) when there's enough
    // credit, so two simultaneous purchases can't both succeed off the
    // same balance. No transaction needed for a single-document update.
    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: price } },
      { $inc: { balance: -price } },
      { returnDocument: 'after' }
    );
    const updatedUser = deducted?.value || deducted;
    if (!updatedUser) {
      const user = await db.users.findOne({ id: req.session.userId });
      const balance = Number(user?.balance || 0);
      return res.status(402).json({
        error: `ยอดเงินไม่พอ (มี ฿${balance} ต้องใช้ ฿${price}) กรุณาเติมเงินก่อน`,
        code: 'INSUFFICIENT_BALANCE'
      });
    }

    const order = {
      id: 'MARI-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      product,
      price,
      minecraft,
      status: 'สำเร็จ (จ่ายด้วยเครดิต)',
      createdAt: new Date().toISOString()
    };
    await db.orders.insertOne(order);

    res.json({ success: true, order: omitMongoId(order) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'สร้างคำสั่งซื้อไม่สำเร็จ' });
  }
});

// ---- redeem wallet credit for in-game PlayerPoints (via RCON) ----
// Unlike the SHOP above, this sends a live command to the actual Minecraft
// server. If the RCON command fails after the wallet's already been
// deducted, the deduction is reversed - the player should never lose
// credit for points that didn't actually arrive in-game.
app.post('/api/points/redeem', requireAuth, async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_POINTS_REDEEM_BAHT || amount > MAX_POINTS_REDEEM_BAHT) {
    return res.status(400).json({ error: `กรุณากรอกจำนวนเงินระหว่าง ${MIN_POINTS_REDEEM_BAHT}-${MAX_POINTS_REDEEM_BAHT} บาท` });
  }
  if (!RCON_ENABLED) {
    return res.status(503).json({ error: 'ระบบแลก Point ยังไม่พร้อมใช้งาน (แอดมินยังไม่ได้ตั้งค่า RCON)' });
  }

  const user = await db.users.findOne({ id: req.session.userId });
  const minecraft = String(user?.minecraft || '').trim();
  if (!minecraft) {
    return res.status(400).json({ error: 'กรุณาผูกไอดี Minecraft ในหน้าบัญชีก่อนแลก Point' });
  }

  const points = amount * POINTS_PER_BAHT;

  // Step 1: atomically deduct - fails cleanly if balance is insufficient.
  const deducted = await db.users.findOneAndUpdate(
    { id: req.session.userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { returnDocument: 'after' }
  );
  const afterDeduct = deducted?.value || deducted;
  if (!afterDeduct) {
    return res.status(402).json({
      error: `ยอดเงินไม่พอ (มี ฿${Number(user?.balance || 0)} ต้องใช้ ฿${amount})`,
      code: 'INSUFFICIENT_BALANCE'
    });
  }

  // Step 2: try to actually deliver the points in-game.
  try {
    await giveRconPoints(minecraft, points);
  } catch (err) {
    // Refund - the wallet debit above didn't produce a real result.
    await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: amount } });
    return res.status(502).json({
      error: `ส่ง Point เข้าเกมไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ระบบคืนเครดิตให้แล้ว กรุณาลองใหม่อีกครั้ง`
    });
  }

  const order = {
    id: 'PTS-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
    userId: req.session.userId,
    product: `PlayerPoints x${points}`,
    price: amount,
    minecraft,
    status: 'สำเร็จ (ส่ง Point เข้าเกมแล้ว)',
    createdAt: new Date().toISOString()
  };
  await db.orders.insertOne(order);

  res.json({ success: true, order: omitMongoId(order), points, balance: afterDeduct.balance });
});

// ---- wallet top-ups ----
// The site never touches real money directly - a top-up just creates a
// "pending" request. Tell the player to send the transfer slip through
// Discord (or however you take payments) and approve it from /admin.html
// once you've actually verified the money arrived. Approving credits the
// wallet; nothing is credited automatically.
function validateTopupAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'จำนวนเงินไม่ถูกต้อง';
  if (n > 100000) return 'จำนวนเงินต่อครั้งต้องไม่เกิน 100,000 บาท';
  if (!Number.isInteger(n)) return 'กรุณาใส่จำนวนเงินเป็นจำนวนเต็ม';
  return null;
}

app.post('/api/topups', requireAuth, async (req, res) => {
  try {
    const amount = req.body?.amount;
    const note = String(req.body?.note || '').slice(0, 200);
    const err = validateTopupAmount(amount);
    if (err) return res.status(400).json({ error: err });

    const topup = {
      id: 'TOP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      amount: Number(amount),
      note,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    await db.topups.insertOne(topup);

    res.json({ success: true, topup: omitMongoId(topup) });
  } catch (err) {
    res.status(500).json({ error: 'แจ้งเติมเงินไม่สำเร็จ' });
  }
});

app.get('/api/topups', requireAuth, async (req, res) => {
  const topups = await db.topups.find({ userId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  res.json({ topups: topups.map(omitMongoId) });
});

// ---- minimal admin API (gated by ADMIN_KEY, no session/cookie involved) ----
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(403).json({ error: 'ยังไม่ได้ตั้งค่า ADMIN_KEY บนเซิร์ฟเวอร์' });
  const provided = String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_KEY);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'รหัสแอดมินไม่ถูกต้อง' });
  next();
}

app.get('/api/admin/topups', requireAdmin, async (req, res) => {
  const status = String(req.query.status || 'pending');
  const filter = status === 'all' ? {} : { status };
  const topups = await db.topups.find(filter).sort({ createdAt: -1 }).toArray();
  const userIds = [...new Set(topups.map(t => t.userId))];
  const users = await db.users.find({ id: { $in: userIds } }).toArray();
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    topups: topups.map(t => ({
      ...omitMongoId(t),
      username: userById[t.userId]?.username || '(ไม่พบบัญชี)',
      minecraft: userById[t.userId]?.minecraft || ''
    }))
  });
});

app.post('/api/admin/topups/:id/approve', requireAdmin, async (req, res) => {
  const session = mongoClient.startSession();
  try {
    // Mark the topup approved (only if it's still pending - findOneAndUpdate
    // with status:'pending' in the filter makes this the "claim" step, so
    // double-clicking Approve twice can't double-credit the wallet) then
    // credit the balance. Both run in a transaction so a crash between the
    // two steps can't credit without marking approved or vice versa.
    const runApprove = async (sess) => {
      const opts = sess ? { session: sess } : {};
      const updated = await db.topups.findOneAndUpdate(
        { id: req.params.id, status: 'pending' },
        { $set: { status: 'approved', decidedAt: new Date().toISOString() } },
        { returnDocument: 'after', ...opts }
      );
      const topup = updated?.value || updated;
      if (!topup) throw new Error('รายการนี้ไม่พบ หรือถูกดำเนินการไปแล้ว');
      const userUpdate = await db.users.findOneAndUpdate(
        { id: topup.userId },
        { $inc: { balance: Number(topup.amount) } },
        { returnDocument: 'after', ...opts }
      );
      const user = userUpdate?.value || userUpdate;
      if (!user) throw new Error('ไม่พบบัญชีผู้ใช้');
      return { topup: omitMongoId(topup), balance: user.balance };
    };

    let result;
    if (session) {
      await session.withTransaction(async () => { result = await runApprove(session); });
    } else {
      result = await runApprove(null);
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อนุมัติไม่สำเร็จ' });
  } finally {
    if (session) await session.endSession();
  }
});

app.post('/api/admin/topups/:id/reject', requireAdmin, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').slice(0, 200);
    const updated = await db.topups.findOneAndUpdate(
      { id: req.params.id, status: 'pending' },
      { $set: { status: 'rejected', decidedAt: new Date().toISOString(), reason } },
      { returnDocument: 'after' }
    );
    const topup = updated?.value || updated;
    if (!topup) return res.status(400).json({ error: 'รายการนี้ไม่พบ หรือถูกดำเนินการไปแล้ว' });
    res.json({ success: true, topup: omitMongoId(topup) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'ปฏิเสธไม่สำเร็จ' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const orders = await db.orders.find({}).sort({ createdAt: -1 }).toArray();
  const userIds = [...new Set(orders.map(o => o.userId))];
  const users = await db.users.find({ id: { $in: userIds } }).toArray();
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({ ...omitMongoId(o), username: userById[o.userId]?.username || '(ไม่พบบัญชี)' }))
  });
});

app.get('/auth.html', (req, res) => res.sendFile(resolveHtml('auth.html')));
app.get('/admin.html', (req, res) => res.sendFile(resolveHtml('admin.html')));

// Fallback: serve index.html for anything else (single-page site with hash routing)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(INDEX_FILE, (err) => {
    if (err) next(err);
  });
});

app.use((req, res) => res.status(404).json({ error: 'ไม่พบคำสั่งที่ต้องการ' }));

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Mari JP SMP server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('FATAL: could not connect to MongoDB:', err.message);
    process.exit(1);
  });
