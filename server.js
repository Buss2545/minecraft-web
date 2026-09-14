// Mari JP SMP - Full Production Backend Server (with Chat System)
'use strict';

const path = require('path');
const crypto = require('crypto');
const net = require('net');
const express = require('express');
const cookieParser = require('cookie-parser');
const { MongoClient } = require('mongodb');

// ---------- Configuration ----------
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'mari_sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IS_PROD = process.env.NODE_ENV === 'production';

const MONGODB_URI = process.env.MONGODB_URI || '';

const MC_HOST = process.env.MC_HOST || 'marijp2006.svmine.com';
const MC_PORT = process.env.MC_PORT || '11206';

const RCON_HOST = process.env.RCON_HOST || '';
const RCON_PORT = process.env.RCON_PORT ? Number(process.env.RCON_PORT) : 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD || '';
const RCON_ENABLED = !!(RCON_HOST && RCON_PASSWORD);

const PTERO_PANEL_URL = (process.env.PTERO_PANEL_URL || '').replace(/\/+$/, '');
const PTERO_SERVER_ID = process.env.PTERO_SERVER_ID || '';
const PTERO_API_KEY = process.env.PTERO_API_KEY || '';
const PTERO_ENABLED = !!(PTERO_PANEL_URL && PTERO_SERVER_ID && PTERO_API_KEY);
const GAME_CONSOLE_ENABLED = PTERO_ENABLED || RCON_ENABLED;

const ADMIN_KEY = process.env.ADMIN_KEY || '';

const SHOP_PRODUCTS = {
  'VIP': 50,
  'VIP+': 100,
  'MVP': 150,
  'MVP+': 200,
  'LEGEND': 500
};

const POINTS_PER_BAHT = Number(process.env.POINTS_PER_BAHT || 1);
const MIN_POINTS_REDEEM_BAHT = 1;
const MAX_POINTS_REDEEM_BAHT = 100000;

const DEFAULT_LUCKPERMS_GROUPS = {
  'VIP': 'vip',
  'VIP+': 'vipplus',
  'MVP': 'megavip',
  'MVP+': 'ultravip',
  'LEGEND': 'legend'
};
let LUCKPERMS_GROUPS = DEFAULT_LUCKPERMS_GROUPS;
if (process.env.LUCKPERMS_GROUPS) {
  try {
    LUCKPERMS_GROUPS = { ...DEFAULT_LUCKPERMS_GROUPS, ...JSON.parse(process.env.LUCKPERMS_GROUPS) };
  } catch (e) {
    console.error('LUCKPERMS_GROUPS env var is not valid JSON:', e.message);
  }
}
const LUCKPERMS_DURATION = process.env.LUCKPERMS_DURATION || '';

// ---------- MongoDB Initialization ----------
let db = null;
let mongoClient = null;

async function ensureIndex(collection, keys, options = {}) {
  try {
    await collection.createIndex(keys, options);
  } catch (err) {
    if (err.code === 85 || err.code === 86) {
      const name = options.name || Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
      console.warn(`[db] index "${name}" changed - recreating...`);
      await collection.dropIndex(name).catch(() => {});
      await collection.createIndex(keys, options);
    } else {
      throw err;
    }
  }
}

async function connectDB() {
  if (!MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is missing in environment variables.');
    process.exit(1);
  }
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const database = mongoClient.db();
  db = {
    users: database.collection('users'),
    orders: database.collection('orders'),
    topups: database.collection('topups'),
    messages: database.collection('messages')
  };
  await ensureIndex(db.users, { usernameLower: 1 }, { unique: true });
  await ensureIndex(db.orders, { userId: 1, createdAt: -1 });
  await ensureIndex(
    db.orders,
    { userId: 1, product: 1 },
    { unique: true, partialFilterExpression: { product: { $in: Object.keys(SHOP_PRODUCTS) } } }
  );
  await ensureIndex(db.topups, { userId: 1, createdAt: -1 });
  await ensureIndex(db.messages, { isPrivate: 1, createdAt: -1 });
  await ensureIndex(db.messages, { senderId: 1, recipientId: 1, createdAt: -1 });
  console.log('Successfully connected to MongoDB Atlas.');
}

function omitMongoId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

// ---------- Password Hashing ----------
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

// ---------- Sessions & Rate Limits ----------
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

const attempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 15) {
    return res.status(429).json({ error: 'คุณทำรายการถี่เกินไป กรุณารอ 1 นาที' });
  }
  next();
}

// ---------- Validation Helpers ----------
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
    balance: Number(user.balance || 0),
    rconAvailable: RCON_ENABLED
  };
}

// ---------- RCON & Pterodactyl Integration ----------
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

    const timer = setTimeout(() => finish(new Error('RCON Timeout')), timeoutMs);

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

    socket.on('connect', () => socket.write(buildPacket(1, 3, password)));

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
          if (type === 2) {
            if (id === -1) return finish(new Error('RCON Password ไม่ถูกต้อง'));
            authenticated = true;
            socket.write(buildPacket(2, 2, command));
          }
        } else {
          return finish(null, body);
        }
      }
    });

    socket.on('error', (err) => finish(err));
    socket.on('close', () => finish(new Error('RCON Connection Closed')));
  });
}

async function sendPterodactylCommand(command) {
  const url = `${PTERO_PANEL_URL}/api/client/servers/${PTERO_SERVER_ID}/command`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${PTERO_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'Application/vnd.pterodactyl.v1+json'
      },
      body: JSON.stringify({ command })
    });
    if (r.status === 204) return;
    if (r.status === 412) throw new Error('เซิร์ฟเวอร์ Minecraft ต้องออนไลน์อยู่');
    let detail = '';
    try { const d = await r.json(); detail = d?.errors?.[0]?.detail || ''; } catch (_) {}
    throw new Error(detail || `Pterodactyl Error (HTTP ${r.status})`);
  } finally {
    clearTimeout(timer);
  }
}

async function runConsoleCommand(command) {
  if (PTERO_ENABLED) return sendPterodactylCommand(command);
  if (RCON_ENABLED) return rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
  throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ Minecraft');
}

async function grantLuckPermsRank(username, product) {
  const group = LUCKPERMS_GROUPS[product];
  if (!group) throw new Error(`ไม่พบกลุ่ม LuckPerms ของยศ "${product}"`);
  const command = LUCKPERMS_DURATION
    ? `lp user ${username} parent add ${group} ${LUCKPERMS_DURATION}`
    : `lp user ${username} parent add ${group}`;
  return await runConsoleCommand(command);
}

// ---------- Server Status Cache ----------
let statusCache = { at: 0, data: null };

async function fetchMcEdition(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'mari-jp-smp' } });
    clearTimeout(timer);
    if (!r.ok) return { online: false };
    const d = await r.json();
    return {
      online: !!d.online,
      players: d.players ? { online: d.players.online ?? 0, max: d.players.max ?? 0 } : { online: 0, max: 0 },
      motd: Array.isArray(d.motd?.clean) ? d.motd.clean[0] : (d.motd?.clean || ''),
      version: d.version?.name_clean || d.version?.name || d.version || ''
    };
  } catch (e) {
    return { online: false };
  }
}

async function getServerStatus() {
  const now = Date.now();
  if (statusCache.data && now - statusCache.at < 15000) {
    return statusCache.data;
  }
  const target = `${MC_HOST}:${MC_PORT}`;
  const [java, bedrock] = await Promise.all([
    fetchMcEdition(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target)}`),
    fetchMcEdition(`https://api.mcstatus.io/v2/status/bedrock/${encodeURIComponent(target)}`)
  ]);
  const data = { host: target, online: java.online || bedrock.online, java, bedrock, checkedAt: new Date().toISOString() };
  statusCache = { at: now, data };
  return data;
}

const fsSync = require('fs');
function resolveHtml(filename) {
  const inPublic = path.join(PUBLIC_DIR, filename);
  const inRoot = path.join(__dirname, filename);
  return fsSync.existsSync(inPublic) ? inPublic : inRoot;
}
const INDEX_FILE = resolveHtml('index.html');

// ---------- Express App & Middleware ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนทำรายการ' });
  req.session = session;
  next();
}

// ---------- API Routes ----------

// Auth
app.post('/api/register', rateLimit, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const uErr = validateUsername(username);
    if (uErr) return res.status(400).json({ error: uErr });
    const pErr = validatePassword(password);
    if (pErr) return res.status(400).json({ error: pErr });

    const usernameLower = username.toLowerCase();
    const existing = await db.users.findOne({ usernameLower });
    if (existing) return res.status(400).json({ error: 'Username นี้มีผู้ใช้งานแล้ว' });

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

    await db.users.insertOne(user);
    const sid = createSession(user.id);
    setSessionCookie(res, sid);
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
    if (!user) return res.status(401).json({ error: 'Username หรือ รหัสผ่านไม่ถูกต้อง' });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Username หรือ รหัสผ่านไม่ถูกต้อง' });

    const sid = createSession(user.id);
    setSessionCookie(res, sid);
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
  if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้นี้' });
  res.json({ user: publicUser(user) });
});

// Account Settings
app.post('/api/account/password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const pErr = validatePassword(newPassword);
    if (pErr) return res.status(400).json({ error: pErr });

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });

    const newHash = await hashPassword(newPassword);
    await db.users.updateOne({ id: req.session.userId }, { $set: { passwordHash: newHash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
  }
});

app.post('/api/account/minecraft', requireAuth, async (req, res) => {
  try {
    const raw = String(req.body?.minecraft || '').trim();
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(raw)) {
      return res.status(400).json({ error: 'ชื่อ Minecraft ต้องมี 3-16 ตัวอักษร' });
    }

    const result = await db.users.findOneAndUpdate(
      { id: req.session.userId },
      { $set: { minecraft: raw, minecraftVerified: true } },
      { returnDocument: 'after' }
    );
    const user = result?.value || result;
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: 'ผูกไอดี Minecraft ไม่สำเร็จ' });
  }
});

// Server Status
app.get('/api/status', async (req, res) => {
  try {
    const status = await getServerStatus();
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: 'ดึงข้อมูลเซิร์ฟเวอร์ไม่สำเร็จ', online: false });
  }
});

// Shop & Orders
app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = await db.orders.find({ userId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  res.json({ orders: orders.map(omitMongoId) });
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const product = String(req.body?.product || '').trim();
    const minecraft = String(req.body?.minecraft || '').trim();

    if (!SHOP_PRODUCTS[product]) return res.status(400).json({ error: 'ไม่พบสินค้านี้ในระบบ' });
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(minecraft)) {
      return res.status(400).json({ error: 'ชื่อ Minecraft ไม่ถูกต้อง' });
    }

    const already = await db.orders.findOne({ userId: req.session.userId, product });
    if (already) {
      return res.status(409).json({ error: `คุณมียศ ${product} อยู่แล้ว` });
    }

    const price = SHOP_PRODUCTS[product];

    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: price } },
      { $inc: { balance: -price } },
      { returnDocument: 'after' }
    );
    const updatedUser = deducted?.value || deducted;
    if (!updatedUser) return res.status(402).json({ error: `ยอดเงินคงเหลือไม่พอ (ต้องการ ฿${price})` });

    const order = {
      id: 'MARI-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      product,
      price,
      minecraft,
      status: GAME_CONSOLE_ENABLED ? 'กำลังติดยศในเกม...' : 'สำเร็จ (รอแอดมิน)',
      createdAt: new Date().toISOString()
    };
    await db.orders.insertOne(order);

    if (GAME_CONSOLE_ENABLED) {
      try {
        await grantLuckPermsRank(minecraft, product);
        order.status = 'สำเร็จ (ติดยศในเกมเรียบร้อย)';
        await db.orders.updateOne({ id: order.id }, { $set: { status: order.status } });
      } catch (err) {
        await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: price } });
        await db.orders.deleteOne({ id: order.id });
        return res.status(502).json({ error: `ติดยศไม่สำเร็จ (${err.message}) คืนยอดเงินให้แล้ว` });
      }
    }

    res.json({ success: true, order: omitMongoId(order) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ทำรายการสั่งซื้อไม่สำเร็จ' });
  }
});

// Points Exchange
app.post('/api/points/redeem', requireAuth, async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_POINTS_REDEEM_BAHT || amount > MAX_POINTS_REDEEM_BAHT) {
    return res.status(400).json({ error: `จำนวนเงินต้องอยู่ระหว่าง ${MIN_POINTS_REDEEM_BAHT}-${MAX_POINTS_REDEEM_BAHT} บาท` });
  }

  const user = await db.users.findOne({ id: req.session.userId });
  if (!user?.minecraft) return res.status(400).json({ error: 'กรุณาผูกไอดี Minecraft ก่อนแลก Point' });

  const points = amount * POINTS_PER_BAHT;
  const deducted = await db.users.findOneAndUpdate(
    { id: req.session.userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { returnDocument: 'after' }
  );
  const afterUser = deducted?.value || deducted;
  if (!afterUser) return res.status(402).json({ error: 'ยอดเงินไม่พอ' });

  try {
    await runConsoleCommand(`points give ${user.minecraft} ${points}`);
  } catch (err) {
    await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: amount } });
    return res.status(502).json({ error: `ส่ง Point ไม่สำเร็จ: ${err.message}` });
  }

  const order = {
    id: 'PTS-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
    userId: req.session.userId,
    product: `PlayerPoints x${points}`,
    price: amount,
    minecraft: user.minecraft,
    status: 'สำเร็จ (ส่ง Point เข้าเกมแล้ว)',
    createdAt: new Date().toISOString()
  };
  await db.orders.insertOne(order);
  res.json({ success: true, order: omitMongoId(order), balance: afterUser.balance });
});

// Topups
app.post('/api/topups', requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const note = String(req.body?.note || '').slice(0, 200);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

    const topup = {
      id: 'TOP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      amount,
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

// ---------- Chat System Endpoints ----------
app.get('/api/chat/users', requireAuth, async (req, res) => {
  try {
    const users = await db.users
      .find({ id: { $ne: req.session.userId } })
      .project({ id: 1, username: 1, minecraft: 1 })
      .limit(100)
      .toArray();
    res.json({ users: users.map(omitMongoId) });
  } catch (err) {
    res.status(500).json({ error: 'ดึงรายชื่อผู้ใช้ไม่สำเร็จ' });
  }
});

app.get('/api/chat/messages', requireAuth, async (req, res) => {
  try {
    const recipientId = String(req.query.recipientId || 'global').trim();
    let filter = {};

    if (recipientId && recipientId !== 'global') {
      filter = {
        isPrivate: true,
        $or: [
          { senderId: req.session.userId, recipientId: recipientId },
          { senderId: recipientId, recipientId: req.session.userId }
        ]
      };
    } else {
      filter = { isPrivate: false };
    }

    const messages = await db.messages.find(filter).sort({ createdAt: -1 }).limit(60).toArray();
    res.json({ messages: messages.map(omitMongoId).reverse() });
  } catch (err) {
    res.status(500).json({ error: 'ดึงข้อความแชทไม่สำเร็จ' });
  }
});

app.post('/api/chat/send', requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const recipientId = String(req.body?.recipientId || 'global').trim();

    if (!text) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });
    if (text.length > 500) return res.status(400).json({ error: 'ข้อความยาวเกินไป (สูงสุด 500 ตัวอักษร)' });

    const sender = await db.users.findOne({ id: req.session.userId });
    if (!sender) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });

    const isPrivate = recipientId !== 'global';
    let recipientName = 'Global';

    if (isPrivate) {
      const recipient = await db.users.findOne({ id: recipientId });
      if (!recipient) return res.status(404).json({ error: 'ไม่พบผู้รับข้อความนี้' });
      recipientName = recipient.username;
    }

    const message = {
      id: 'MSG-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      senderId: sender.id,
      senderName: sender.username,
      recipientId: isPrivate ? recipientId : 'global',
      recipientName: isPrivate ? recipientName : 'Global',
      text,
      isPrivate,
      createdAt: new Date().toISOString()
    };

    await db.messages.insertOne(message);
    res.json({ success: true, message: omitMongoId(message) });
  } catch (err) {
    res.status(500).json({ error: 'ส่งข้อความไม่สำเร็จ' });
  }
});

// App Entry
app.get('/auth.html', (req, res) => res.sendFile(resolveHtml('auth.html')));
app.get('/admin.html', (req, res) => res.sendFile(resolveHtml('admin.html')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(INDEX_FILE, (err) => { if (err) next(err); });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Mari JP SMP Web Server is active on port ${PORT}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err);
  process.exit(1);
});
