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
const { MongoClient, GridFSBucket } = require('mongodb');

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

// Alternative to RCON: send console commands through the game host's
// Pterodactyl panel API instead. This goes over normal HTTPS (port 443),
// so it works even when the host firewalls off the raw RCON port - which
// is common on shared/budget Minecraft hosts.
const PTERO_PANEL_URL = (process.env.PTERO_PANEL_URL || '').replace(/\/+$/, '');
const PTERO_SERVER_ID = process.env.PTERO_SERVER_ID || '';
const PTERO_API_KEY = process.env.PTERO_API_KEY || '';
const PTERO_ENABLED = !!(PTERO_PANEL_URL && PTERO_SERVER_ID && PTERO_API_KEY);
// True if we have ANY way to reach the actual Minecraft server console.
const GAME_CONSOLE_ENABLED = PTERO_ENABLED || RCON_ENABLED;

// Secret key that gates /admin.html + the /api/admin/* endpoints (approving
// top-up requests). Set this as an env var on Render - if it's left unset,
// the admin endpoints are disabled entirely (safer default than an open
// admin panel with no password).
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Website titles (ฉายาเว็บไซต์) are display labels assigned by an admin.
// They are separate from Minecraft/shop ranks and permission checks:
// ADMIN_KEY still protects the admin APIs.
const ACCOUNT_TITLES = {
  member: { label: 'สมาชิกใหม่', icon: '🌱', color: '#35a95c' },
  admin: { label: 'แอดมิน', icon: '🛡️', color: '#d94b63' },
  trader: { label: 'ผู้ซื้อขาย', icon: '💰', color: '#c98a1c' },
  creator: { label: 'ผู้สร้างเซิร์ฟเวอร์และเว็บไซต์', icon: '🌸', color: '#ee7fa5' },
  moderator: { label: 'ผู้ดูแลชุมชน', icon: '💬', color: '#4d8bd8' },
  builder: { label: 'นักสร้างโลก', icon: '🧱', color: '#a66b3d' },
  supporter: { label: 'ผู้สนับสนุนเซิร์ฟเวอร์', icon: '💎', color: '#6d68d9' },
  veteran: { label: 'ผู้เล่นรุ่นบุกเบิก', icon: '⚔️', color: '#8c5bc7' },
  tester: { label: 'นักทดสอบระบบ', icon: '🔧', color: '#2f9e9e' },
  event_host: { label: 'ผู้จัดกิจกรรม', icon: '🎉', color: '#e7832b' }
};

// Canonical shop catalog. NEVER trust price/product from the client -
// always look it up here before writing an order.
const SHOP_PRODUCTS = {
  'VIP': 50,
  'VIP+': 100,
  'MVP': 150,
  'MVP+': 200,
  'LEGEND': 500
};
// ELITE and EMPEROR were pulled from the shop for now - there's no matching
// LuckPerms group on the server yet. Add them back to SHOP_PRODUCTS (with a
// price) once the groups exist, and add their mapping to
// DEFAULT_LUCKPERMS_GROUPS below.

// Repeatable vanilla-item products. This used to be the hardcoded catalog,
// but it's now DB-backed (db.shopItems) so an admin can add/edit/delete
// items - including ones from other plugins, not just vanilla /give -
// straight from admin.html without touching code or redeploying. This
// list only seeds the DB the very first time the server connects to a
// fresh database (see seedDefaultShopItems); after that, admin.html is
// the source of truth and this constant is never read again.
const DEFAULT_SHOP_ITEMS = [
  {
    id: 'ITEM_DIAMOND',
    price: 10,
    label: 'เพชร x1',
    icon: '💎',
    features: ['เพชร 1 ชิ้น', 'ใช้สร้างของหรือแลกเปลี่ยนได้'],
    commandTemplate: 'give {player} minecraft:diamond 1',
    // Used only by the resale board, to pull the item back out of the
    // seller's inventory before handing a copy to the buyer. Optional -
    // an item with no takeCommandTemplate simply can't be listed for resale.
    takeCommandTemplate: 'clear {player} minecraft:diamond 1',
    repeatable: true
  },
  {
    id: 'ITEM_EMERALD',
    price: 15,
    label: 'มรกต x16',
    icon: '🟢',
    features: ['มรกต 16 ชิ้น', 'เหมาะสำหรับแลกกับชาวบ้าน'],
    commandTemplate: 'give {player} minecraft:emerald 16',
    takeCommandTemplate: 'clear {player} minecraft:emerald 16',
    repeatable: true
  },
  {
    id: 'ITEM_GOLDEN_APPLE',
    price: 25,
    label: 'แอปเปิลทอง x1',
    icon: '🍎',
    features: ['Golden Apple 1 ชิ้น', 'ไอเทมช่วยเอาตัวรอดในเกม'],
    commandTemplate: 'give {player} minecraft:golden_apple 1',
    takeCommandTemplate: 'clear {player} minecraft:golden_apple 1',
    repeatable: true
  }
];

function rankShopCatalog() {
  return Object.entries(SHOP_PRODUCTS).map(([id, price]) => ({
    id,
    type: 'rank',
    price,
    label: id,
    icon: '👑',
    features: [],
    repeatable: false
  }));
}

// Reads the live, admin-editable item catalog straight from MongoDB -
// never cached, so an admin.html add/edit/delete takes effect immediately
// for every player without a restart.
async function itemShopCatalog() {
  const items = await db.shopItems.find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).toArray();
  return items.map(item => ({
    id: item.id,
    type: 'item',
    price: item.price,
    label: item.label,
    icon: item.icon,
    features: item.features || [],
    repeatable: item.repeatable !== false
  }));
}

// Exchange rate for converting wallet credit into in-game PlayerPoints.
// 1 baht = this many points. Change this one number to adjust the rate.
const POINTS_PER_BAHT = Number(process.env.POINTS_PER_BAHT || 1);
const MIN_POINTS_REDEEM_BAHT = 1;
const MAX_POINTS_REDEEM_BAHT = 100000;

// Exchange rate for converting wallet credit into in-game /money (the
// server's economy plugin balance, e.g. EssentialsX). 1 บาทเครดิต = this
// many in-game money. Override with MONEY_PER_BAHT.
const MONEY_PER_BAHT = Number(process.env.MONEY_PER_BAHT || 1000);
const MIN_MONEY_REDEEM_BAHT = 1;
// Daily cap counted in NUMBER OF REDEEM REQUESTS (not amount of money or
// บาทเครดิตที่จ่าย), per account, resetting at midnight Asia/Bangkok time.
// Override with MAX_MONEY_REDEEM_COUNT_PER_DAY.
const MAX_MONEY_REDEEM_COUNT_PER_DAY = Number(process.env.MAX_MONEY_REDEEM_COUNT_PER_DAY || 90);

// Item-shop resale board (ขายต่อไอเทมจาก Item Shop ราคาลดตามเวลา): cap on
// how many listings a single account can have "active" at the same time,
// mainly to keep the board from being spammed by one player.
const MAX_ACTIVE_RESALE_LISTINGS_PER_USER = Number(process.env.MAX_ACTIVE_RESALE_LISTINGS_PER_USER || 10);
// Accounts holding one of these website titles can list any Item SHOP item
// at any starting price up to that item's Item SHOP price (see
// RESALE_UNTRUSTED_MAX_PRICE below). Titles are granted by an admin via
// the "เปลี่ยนฉายาเว็บไซต์" button.
const RESALE_SELLER_TITLE_IDS = ['trader', 'admin', 'creator'];
// Everyone else (regular "สมาชิกใหม่" accounts included) can still list
// items for resale, just capped at this starting price - keeps a brand
// new/unverified account's exposure small while still letting them
// participate, without needing a special title first.
const RESALE_UNTRUSTED_MAX_PRICE = Number(process.env.RESALE_UNTRUSTED_MAX_PRICE || 7);
// Console command template sent to grant in-game money - {player} and
// {amount} are substituted before sending. Defaults to the TNE (The New
// Economy) plugin's `economy give` command, confirmed as the command this
// server's economy plugin actually uses; override with MONEY_GIVE_COMMAND
// if that ever changes (e.g. "eco give {player} {amount}" for EssentialsX).
const MONEY_GIVE_COMMAND_TEMPLATE = process.env.MONEY_GIVE_COMMAND || 'economy give {player} {amount}';

// Calendar-day key (YYYY-MM-DD) in Asia/Bangkok time - used to reset the
// daily /money redemption quota at local midnight regardless of what
// timezone the server process itself is running in.
function todayKeyBangkok() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

// Maps each SHOP_PRODUCTS key to the LuckPerms group it grants. These are
// just defaults - override any/all of them without touching code by setting
// LUCKPERMS_GROUPS on Render to a JSON object, e.g.:
//   LUCKPERMS_GROUPS={"VIP":"vip","VIP+":"vip_plus"}
// Only the keys you want to override need to be included; the rest fall
// back to the defaults below. Group names must match exactly what's set up
// in your server's luckperms/groups/ folder (case-sensitive).
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
    console.error('LUCKPERMS_GROUPS env var is not valid JSON - using built-in defaults instead:', e.message);
  }
}
// Optional: how long the LuckPerms grant should last, e.g. "30d", "1y". Leave
// unset for a permanent grant. Passed straight to `lp ... parent add <group> <duration>`.
const LUCKPERMS_DURATION = process.env.LUCKPERMS_DURATION || '';

// ---------- MongoDB connection ----------
// Documents keep the same app-level "id" field (not Mongo's _id) so the
// rest of the code barely changed from the file-based version. A unique
// index on usernameLower does the case-insensitive uniqueness check that
// used to be a manual .find() over the whole users array.
let db = null; // set by connectDB(): { users, orders, topups, chatRooms, chatMessages, musicTracks, musicFiles } collections
let mongoClient = null;
let musicBucket = null;

// createIndex throws if an index with the same auto-generated name already
// exists but with different options (e.g. SHOP_PRODUCTS' keys changed, so
// the partialFilterExpression list is different from what's actually
// stored in Atlas from a previous deploy). Rather than crash the whole
// server over that, drop the stale index and recreate it with the current
// definition - safe because these are just performance/uniqueness aids,
// not data, so dropping and rebuilding one loses nothing.
async function ensureIndex(collection, keys, options = {}) {
  try {
    await collection.createIndex(keys, options);
  } catch (err) {
    if (err.code === 85 || err.code === 86) { // IndexOptionsConflict / IndexKeySpecsConflict
      const name = options.name || Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
      console.warn(`[db] index "${name}" definition changed - dropping and recreating`);
      await collection.dropIndex(name).catch((dropErr) => {
        console.warn(`[db] could not drop index "${name}" (continuing anyway):`, dropErr.message);
      });
      await collection.createIndex(keys, options);
    } else {
      throw err;
    }
  }
}

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
    topups: database.collection('topups'),
    chatRooms: database.collection('chatRooms'),
    chatMessages: database.collection('chatMessages'),
    musicTracks: database.collection('musicTracks'),
    musicFiles: database.collection('music.files'),
    raceMatches: database.collection('raceMatches'),
    wheelSpins: database.collection('wheelSpins'),
    settings: database.collection('settings'),
    shopItems: database.collection('shopItems'),
    resaleListings: database.collection('resaleListings'),
    notifications: database.collection('notifications')
  };
  musicBucket = new GridFSBucket(database, { bucketName: 'music' });
  await ensureIndex(db.users, { usernameLower: 1 }, { unique: true });
  await ensureIndex(db.orders, { userId: 1, createdAt: -1 });
  // One order per rank per account - this is what actually enforces
  // "ซื้อยศได้ครั้งเดียวต่อยศ" against races (two clicks at once can't both
  // insert). Scoped to rank names only (via $in) because this same
  // collection also stores PlayerPoints redemptions, which legitimately
  // reuse the same product string ("PlayerPoints x100") more than once.
  // If an admin needs to let someone re-buy a rank that was lost in-game,
  // delete their old order via DELETE /api/admin/orders/:id first.
  await ensureIndex(
    db.orders,
    { userId: 1, product: 1 },
    { unique: true, partialFilterExpression: { product: { $in: Object.keys(SHOP_PRODUCTS) } } }
  );
  await ensureIndex(db.topups, { userId: 1, createdAt: -1 });
  await ensureIndex(db.topups, { status: 1, createdAt: -1 });
  await ensureIndex(db.chatRooms, { participantIds: 1, updatedAt: -1 });
  await ensureIndex(db.chatRooms, { directKey: 1 }, { unique: true, sparse: true });
  await ensureIndex(db.chatMessages, { roomId: 1, createdAt: 1 });
  await ensureIndex(db.musicTracks, { active: 1, order: 1, uploadedAt: -1 });
  await ensureIndex(db.raceMatches, { status: 1, createdAt: -1 });
  await ensureIndex(db.raceMatches, { playerAId: 1, createdAt: -1 });
  await ensureIndex(db.raceMatches, { playerBId: 1, createdAt: -1 });
  await ensureIndex(db.wheelSpins, { userId: 1, createdAt: -1 });
  await ensureIndex(db.settings, { id: 1 }, { unique: true });
  await ensureIndex(db.shopItems, { id: 1 }, { unique: true });
  await ensureIndex(db.resaleListings, { status: 1, createdAt: -1 });
  await ensureIndex(db.resaleListings, { sellerId: 1, createdAt: -1 });
  await ensureIndex(db.notifications, { userId: 1, createdAt: -1 });
  await seedDefaultShopItems();
  console.log('Connected to MongoDB - data will now survive redeploys.');
}

// One-time migration: seeds the item-shop catalog from DEFAULT_SHOP_ITEMS
// above, but ONLY when the collection is completely empty (a fresh
// database on first-ever deploy). This exists purely so upgrading to the
// DB-backed catalog doesn't make an existing site's 3 starting items
// vanish; once anything is in db.shopItems (including admin edits/deletes
// down to zero items), this never runs again and admin.html is the only
// source of truth from then on.
async function seedDefaultShopItems() {
  const count = await db.shopItems.countDocuments();
  if (count > 0) return;
  const now = new Date().toISOString();
  await db.shopItems.insertMany(DEFAULT_SHOP_ITEMS.map(item => ({ ...item, enabled: true, createdAt: now })));
  console.log('[db] seeded default item-shop catalog (diamond / emerald / golden apple)');
}

// ---------- game settings (admin-adjustable win/lose rates) ----------
// A single document (id: 'gameSettings') in MongoDB holds the numbers that
// control how often players win the race mini-game against the bot and
// what each slice of the prize wheel pays out. Cached in memory so every
// request reads gameSettings.* directly (no extra DB round-trip); the
// cache is refreshed the moment an admin saves new values from
// /admin.html, and reloaded from MongoDB on every server restart so
// changes survive redeploys. Only /api/admin/settings/* (gated by
// ADMIN_KEY, same as the rest of /api/admin/*) can change these - regular
// players never see or touch them.
const DEFAULT_RACE_BOT_WIN_RATE = 50; // % chance the bot wins a race match. Real player-vs-player matches are always decided fairly by actual scores and are never affected by this setting.
const DEFAULT_WHEEL_PRIZES = [
  { id: 'x5', label: '🎉 แจ็คพอต x5', multiplier: 5, weight: 2, color: '#ffd54a' },
  { id: 'x3', label: '✨ x3', multiplier: 3, weight: 6, color: '#ff9f6b' },
  { id: 'x2', label: '🔥 x2', multiplier: 2, weight: 15, color: '#ff6b81' },
  { id: 'x1_5', label: '👍 x1.5', multiplier: 1.5, weight: 20, color: '#6bc5ff' },
  { id: 'refund', label: '↩️ คืนทุน', multiplier: 1, weight: 20, color: '#7ee08b' },
  { id: 'half', label: '😐 คืนครึ่ง', multiplier: 0.5, weight: 10, color: '#c6a6ff' },
  { id: 'miss1', label: '😢 เสียใจด้วย', multiplier: 0, weight: 25, color: '#b9c0c7' },
  { id: 'miss2', label: '💨 โชคดีรอบหน้า', multiplier: 0, weight: 22, color: '#9aa4ad' }
];

// Resale board (ขายต่อไอเทมจาก Item Shop): how many hours it takes a
// listing's price to fall from the seller's starting price down to the
// floor, and the floor itself as a % of the starting price. Both are
// snapshotted onto each listing when it's created, so changing these
// later never affects listings already posted.
const DEFAULT_RESALE_DECAY_HOURS = 72; // 3 วัน
const DEFAULT_RESALE_FLOOR_PERCENT = 20; // ราคาต่ำสุด = 20% ของราคาเริ่มต้น

let gameSettings = {
  raceBotWinRate: DEFAULT_RACE_BOT_WIN_RATE,
  wheelPrizes: DEFAULT_WHEEL_PRIZES.map(p => ({ ...p })),
  resaleDecayHours: DEFAULT_RESALE_DECAY_HOURS,
  resaleFloorPercent: DEFAULT_RESALE_FLOOR_PERCENT
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Loads saved settings from MongoDB into the in-memory cache. Falls back to
// the defaults above (already in gameSettings) for anything missing, so a
// fresh database or a partially-written doc never crashes the server.
async function loadGameSettings() {
  const doc = await db.settings.findOne({ id: 'gameSettings' });
  if (!doc) return;
  if (Number.isFinite(doc.raceBotWinRate)) {
    gameSettings.raceBotWinRate = clamp(doc.raceBotWinRate, 0, 100);
  }
  if (Array.isArray(doc.wheelPrizes) && doc.wheelPrizes.length) {
    gameSettings.wheelPrizes = doc.wheelPrizes;
  }
  if (Number.isFinite(doc.resaleDecayHours) && doc.resaleDecayHours > 0) {
    gameSettings.resaleDecayHours = doc.resaleDecayHours;
  }
  if (Number.isFinite(doc.resaleFloorPercent)) {
    gameSettings.resaleFloorPercent = clamp(doc.resaleFloorPercent, 0, 100);
  }
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

function validateDisplayName(displayName) {
  if (typeof displayName !== 'string') return 'ชื่อแสดงผลไม่ถูกต้อง';
  const trimmed = displayName.trim();
  if (trimmed.length < 3 || trimmed.length > 24) return 'ชื่อแสดงผลต้องมี 3-24 ตัวอักษร';
  if (!/^[A-Za-z0-9_ก-๙-]+$/.test(trimmed)) return 'ชื่อแสดงผลใช้ได้เฉพาะตัวอักษร ตัวเลข _ และ -';
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) return 'Password ต้องมีอย่างน้อย 6 ตัวอักษร';
  if (password.length > 200) return 'Password ยาวเกินไป';
  return null;
}

function publicUser(user) {
  const displayName = user.displayName || user.username;
  const titleId = ACCOUNT_TITLES[user.titleId] ? user.titleId : 'member';
  const title = ACCOUNT_TITLES[titleId];
  return {
    id: user.id,
    username: user.username,
    displayName,
    displayNameChangedAt: user.displayNameChangedAt || null,
    titleId,
    title: {
      id: titleId,
      label: title.label,
      icon: title.icon,
      color: title.color
    },
    minecraft: user.minecraft || '',
    minecraftVerified: !!user.minecraftVerified,
    balance: Number(user.balance || 0),
    // Lets the frontend tell the difference between "not verified yet, join
    // the game and re-bind" vs "verification isn't set up on this server at
    // all" - without this, the unverified warning looks stuck forever on
    // deployments that only have Pterodactyl configured (no RCON).
    rconAvailable: RCON_ENABLED
  };
}

// ---------- RCON (talks directly to the Minecraft server's console) ----------
// Implemented by hand against the standard Source RCON protocol (the same
// one Minecraft uses) instead of pulling in a third-party package - it's a
// short, stable binary protocol and this keeps behavior fully predictable.
// Packet layout: int32 size | int32 requestId | int32 type | body\0 | \0
function rconCommand(host, port, password, command, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let settled = false;
    // Tracks whether we actually wrote the EXECCOMMAND packet to the
    // socket. If a failure happens AFTER this is true, the Minecraft
    // server may well have already run the command (e.g. we just never
    // got/received the confirmation reply) - callers must NOT treat that
    // as "definitely didn't happen" the way they can for failures before
    // this point (bad password, connection never established, etc.).
    let commandSent = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) {
        err.commandSent = commandSent;
        reject(err);
      } else resolve(value);
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
            if (id === -1) return finish(new Error('RCON password ไม่ถูกต้อง')); // never sent - safe
            authenticated = true;
            socket.write(buildPacket(2, 2, command)); // 2 = SERVERDATA_EXECCOMMAND
            commandSent = true; // from here on, a failure is ambiguous, not a clean miss
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

// Sends a console command through the Pterodactyl Client API.
// Docs: POST /api/client/servers/{id}/command -> 204 on success, empty body.
// Note: this is fire-and-forget - Pterodactyl doesn't hand back the
// command's actual output, only whether it was accepted. The server must
// be online or this returns HTTP 412.
async function sendPterodactylCommand(command) {
  const url = `${PTERO_PANEL_URL}/api/client/servers/${PTERO_SERVER_ID}/command`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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
    if (r.status === 412) {
      const e = new Error('เซิร์ฟเวอร์ Minecraft ต้องออนไลน์อยู่ถึงจะส่งคำสั่งได้');
      e.commandSent = false; // panel explicitly refused - never reached the game
      throw e;
    }
    let detail = '';
    try { const d = await r.json(); detail = d?.errors?.[0]?.detail || ''; } catch (_) { /* ignore */ }
    const e = new Error(detail || `Pterodactyl API error (HTTP ${r.status})`);
    e.commandSent = false; // panel gave a clear rejection response - never reached the game
    throw e;
  } catch (err) {
    if (typeof err.commandSent === 'boolean') throw err; // already tagged above
    if (err.name === 'AbortError') {
      // We don't know if the panel received and queued the command before
      // our wait timed out - Pterodactyl is fire-and-forget, so treat this
      // as ambiguous rather than a clean miss.
      const e = new Error('Pterodactyl API หมดเวลารอการตอบกลับ (คำสั่งอาจถูกส่งไปแล้ว ยืนยันไม่ได้)');
      e.commandSent = true;
      throw e;
    }
    // Network-level failure (DNS, connection refused, TLS error, etc.)
    // before any response - the request never reached the panel.
    err.commandSent = false;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Sends the PlayerPoints plugin's console command to credit a player.
// Prefers the Pterodactyl API (works through normal HTTPS, no firewall
// issues); falls back to RCON if that's what's configured instead.
// Works for offline players too (PlayerPoints resolves UUIDs itself), so
// we don't require the target to be online like the /list check does.
// Throws on any failure - callers must treat that as "did not necessarily
// happen" and are responsible for refunding the wallet.
async function giveRconPoints(username, amount) {
  const command = `points give ${username} ${amount}`;
  if (PTERO_ENABLED) return sendPterodactylCommand(command);
  if (RCON_ENABLED) return rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
  throw new Error('ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเซิร์ฟเวอร์ (Pterodactyl API หรือ RCON)');
}

// Sends the server economy plugin's console command to credit a player's
// in-game /money balance. Same Pterodactyl-first, RCON-fallback delivery
// contract as giveRconPoints above - throws on any failure, caller must
// refund the wallet.
async function giveRconMoney(username, amount) {
  const command = MONEY_GIVE_COMMAND_TEMPLATE
    .replace('{player}', username)
    .replace('{amount}', String(amount));
  if (PTERO_ENABLED) return sendPterodactylCommand(command);
  if (RCON_ENABLED) return rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
  throw new Error('ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเซิร์ฟเวอร์ (Pterodactyl API หรือ RCON)');
}

// Shared "send this console command however we're able to" dispatcher -
// same Pterodactyl-first, RCON-fallback logic giveRconPoints uses above.
async function runConsoleCommand(command) {
  if (PTERO_ENABLED) return sendPterodactylCommand(command);
  if (RCON_ENABLED) return rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
  throw new Error('ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเซิร์ฟเวอร์ (Pterodactyl API หรือ RCON)');
}

// Grants the LuckPerms group tied to a shop rank, right after payment
// clears. Throws on any failure (unknown group, command rejected, server
// unreachable, etc.) - callers must treat that as "the rank did NOT
// necessarily get delivered" and refund/undo the purchase, same contract
// as giveRconPoints above.
async function grantLuckPermsRank(username, product) {
  const group = LUCKPERMS_GROUPS[product];
  if (!group) throw new Error(`ไม่มีการตั้งค่ากลุ่ม LuckPerms สำหรับยศ "${product}" (ตรวจสอบ LUCKPERMS_GROUPS)`);
  const command = LUCKPERMS_DURATION
    ? `lp user ${username} parent add ${group} ${LUCKPERMS_DURATION}`
    : `lp user ${username} parent add ${group}`;
  const result = await runConsoleCommand(command);
  // RCON hands back LuckPerms' own response text - a quick sanity check so
  // an unknown group name (typo in LUCKPERMS_GROUPS, or LuckPerms not even
  // installed) surfaces as a failure instead of a silent "success".
  // Pterodactyl's API doesn't return command output at all (fire-and-forget),
  // so this check only ever runs on the RCON path - result is undefined
  // there and we just trust the command was accepted.
  if (typeof result === 'string' && /unable to find|unknown group|not found|no such/i.test(result)) {
    throw new Error(`LuckPerms ปฏิเสธคำสั่ง (${result.trim()})`);
  }
  return result;
}

// Delivers a dynamic item-shop item. `item` is the DB doc (db.shopItems) -
// callers fetch it themselves so the "product not found" check happens
// before any credit is touched.
async function grantShopItem(username, item) {
  if (!item || !item.commandTemplate) {
    throw new Error('ไม่พบคำสั่งส่งสินค้านี้เข้าเกม');
  }
  const command = item.commandTemplate.replace(/\{player\}/g, username);
  return runConsoleCommand(command);
}

// Pulls a resale item back out of the SELLER's inventory (e.g. a /clear
// command) before a copy is granted to the buyer. Only used by the resale
// board - a normal Item SHOP purchase never touches this. Throws if the
// item has no takeCommandTemplate configured, same "must succeed or the
// whole transaction unwinds" contract as grantShopItem.
async function takeShopItem(username, item) {
  if (!item || !item.takeCommandTemplate) {
    throw new Error('ไอเทมนี้ยังไม่ได้ตั้งคำสั่งดึงของสำหรับระบบขายต่อ (แอดมินต้องตั้งค่าก่อน)');
  }
  const command = item.takeCommandTemplate.replace(/\{player\}/g, username);
  return runConsoleCommand(command);
}

// Checks the live `/list` output for an exact (case-insensitive) username
// match. Returns false (never throws) if RCON isn't configured or fails -
// callers should treat that as "couldn't verify", not "definitely offline".
// Returns { online, reason } instead of a plain boolean - the reason is
// shown directly to the user on the website, since digging through Render
// logs on a phone is painful. reason is only meaningful when online=false.
async function isPlayerOnlineViaRcon(username) {
  if (!RCON_ENABLED) {
    return { online: false, reason: 'ยังไม่ได้ตั้งค่า RCON_HOST/RCON_PORT/RCON_PASSWORD บนเซิร์ฟเวอร์เว็บ' };
  }
  try {
    const result = await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, 'list');
    // Vanilla format: "There are 2 of a max of 25 players online: Alice, Bob"
    const afterColon = result.includes(':') ? result.split(':').slice(1).join(':') : '';
    const names = afterColon.split(',').map(s => s.trim()).filter(Boolean);
    const found = names.some(n => n.toLowerCase() === username.toLowerCase());
    console.log(`[rcon] /list raw="${result}" parsedNames=${JSON.stringify(names)} lookingFor="${username}" matched=${found}`);
    if (found) return { online: true };
    return {
      online: false,
      reason: names.length
        ? `เชื่อมต่อ RCON สำเร็จ แต่ไม่พบชื่อนี้ในเซิร์ฟเวอร์ ตอนนี้มีคนออนไลน์: ${names.join(', ')}`
        : 'เชื่อมต่อ RCON สำเร็จ แต่ไม่มีใครออนไลน์อยู่เลยตอนนี้'
    };
  } catch (e) {
    console.error(`[rcon] connection/command failed while checking "${username}":`, e.message);
    return { online: false, reason: `เชื่อมต่อ RCON ไม่สำเร็จ: ${e.message}` };
  }
}

// Same live /list lookup as isPlayerOnlineViaRcon, but fetched ONCE and
// handed back as a lowercase Set so the resale listings endpoint can check
// every seller's online status against a single RCON round-trip instead of
// one per listing. Returns null (== "can't tell") if RCON isn't configured
// or the call fails - callers should treat null as "unknown", not offline.
async function fetchOnlinePlayerNameSet() {
  if (!RCON_ENABLED) return null;
  try {
    const result = await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, 'list');
    const afterColon = result.includes(':') ? result.split(':').slice(1).join(':') : '';
    const names = afterColon.split(',').map(s => s.trim()).filter(Boolean);
    return new Set(names.map(n => n.toLowerCase()));
  } catch (e) {
    console.error('[rcon] /list failed while checking resale seller online status:', e.message);
    return null;
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
// Music uploads arrive as base64 JSON so the browser needs a larger request
// limit than the small account/order APIs. The upload endpoint still enforces
// a strict 15 MB decoded-file limit below.
app.use(express.json({ limit: '24mb' }));
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
      displayName: username,
      titleId: 'member',
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

// ---- community chat ----
// The public room is deliberately a fixed id so it does not need a special
// seed document. Private rooms are stored with a deterministic directKey,
// which prevents two users clicking "เริ่มแชท" at the same time from creating
// duplicate conversations.
const PUBLIC_CHAT_ROOM = {
  id: 'public',
  type: 'public',
  name: 'รวมทั้งหมด',
  avatar: '🌏'
};

function publicChatUser(user) {
  return user ? {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    minecraft: user.minecraft || ''
  } : null;
}

function chatRoomView(room, userById = {}, currentUserId = '') {
  if (room.id === PUBLIC_CHAT_ROOM.id) return {
    ...PUBLIC_CHAT_ROOM,
    lastMessage: '',
    updatedAt: ''
  };
  const otherId = (room.participantIds || []).find(id => id !== currentUserId) || room.ownerId;
  const other = userById[otherId] || {};
  return {
    id: room.id,
    type: 'direct',
    name: other.displayName || other.username || room.name || 'แชทส่วนตัว',
    avatar: '👤',
    otherUser: publicChatUser(other),
    lastMessage: room.lastMessage || '',
    updatedAt: room.updatedAt || room.createdAt || ''
  };
}

async function getChatRoomForUser(roomId, userId) {
  if (roomId === PUBLIC_CHAT_ROOM.id) return PUBLIC_CHAT_ROOM;
  return db.chatRooms.findOne({ id: roomId, participantIds: userId });
}

app.get('/api/chat/users', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = { id: { $ne: req.session.userId } };
  if (q) {
    const escaped = q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.usernameLower = { $regex: escaped };
  }
  // With no query, return a compact member directory so users can start a
  // private chat by tapping a name instead of having to type one first.
  const users = await db.users.find(filter)
    .sort({ createdAt: -1 })
    .project({ id: 1, username: 1, usernameLower: 1, displayName: 1, minecraft: 1 })
    .limit(q ? 20 : 50).toArray();
  res.json({ users: users.map(publicChatUser) });
});

app.get('/api/chat/rooms', requireAuth, async (req, res) => {
  const rooms = await db.chatRooms.find({
    participantIds: req.session.userId
  }).sort({ updatedAt: -1 }).limit(50).toArray();
  const userIds = [...new Set(rooms.flatMap(room => room.participantIds || []))];
  const users = await db.users.find({ id: { $in: userIds } })
    .project({ id: 1, username: 1, displayName: 1, minecraft: 1 }).toArray();
  const userById = Object.fromEntries(users.map(user => [user.id, user]));
  res.json({
    rooms: [
      chatRoomView(PUBLIC_CHAT_ROOM),
      ...rooms.map(room => chatRoomView(room, userById, req.session.userId))
    ]
  });
});

// Lightweight polling endpoint used by the website's notification badge.
// It returns only messages created after the browser's cursor, across the
// public room and the private rooms this user belongs to.
app.get('/api/chat/notifications', requireAuth, async (req, res) => {
  const since = String(req.query.since || '').trim();
  const privateRooms = await db.chatRooms.find({
    participantIds: req.session.userId
  }).project({ id: 1 }).limit(50).toArray();
  const roomIds = [PUBLIC_CHAT_ROOM.id, ...privateRooms.map(room => room.id)];
  const filter = { roomId: { $in: roomIds } };
  if (since) filter.createdAt = { $gt: since };
  const messages = await db.chatMessages.find(filter)
    .sort({ createdAt: 1 }).limit(100).toArray();
  const senderIds = [...new Set(messages.map(message => message.senderId).filter(Boolean))];
  const senders = senderIds.length
    ? await db.users.find({ id: { $in: senderIds } })
      .project({ id: 1, username: 1, displayName: 1 }).toArray()
    : [];
  const senderById = Object.fromEntries(senders.map(sender => [sender.id, sender]));
  res.json({
    messages: messages.map(message => {
      const sender = senderById[message.senderId];
      return omitMongoId({
        ...message,
        senderName: sender?.displayName || sender?.username || message.senderName
      });
    })
  });
});

app.post('/api/chat/rooms/direct', requireAuth, async (req, res) => {
  try {
    const targetId = String(req.body?.userId || '').trim();
    const username = String(req.body?.username || '').trim();
    const target = targetId
      ? await db.users.findOne({ id: targetId })
      : await db.users.findOne({ usernameLower: username.toLowerCase() });
    if (!target) return res.status(404).json({ error: 'ไม่พบสมาชิกคนนี้' });
    if (target.id === req.session.userId) return res.status(400).json({ error: 'ไม่สามารถเริ่มแชทกับตัวเองได้' });

    const participantIds = [req.session.userId, target.id].sort();
    const directKey = participantIds.join(':');
    let room = await db.chatRooms.findOne({ directKey });
    if (!room) {
      const now = new Date().toISOString();
      room = {
        id: 'CHAT-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
        type: 'direct',
        directKey,
        participantIds,
        ownerId: req.session.userId,
        createdAt: now,
        updatedAt: now,
        lastMessage: ''
      };
      try {
        await db.chatRooms.insertOne(room);
      } catch (err) {
        if (err?.code !== 11000) throw err;
        room = await db.chatRooms.findOne({ directKey });
      }
    }
    res.json({
      success: true,
      room: chatRoomView(room, {
        [target.id]: target,
        [req.session.userId]: await db.users.findOne({ id: req.session.userId })
      }, req.session.userId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'เปิดแชทส่วนตัวไม่สำเร็จ' });
  }
});

app.get('/api/chat/rooms/:id/messages', requireAuth, async (req, res) => {
  const room = await getChatRoomForUser(req.params.id, req.session.userId);
  if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const since = String(req.query.since || '').trim();
  const filter = { roomId: room.id };
  if (since) filter.createdAt = { $gt: since };
  const messages = await db.chatMessages.find(filter)
    .sort({ createdAt: since ? 1 : -1 }).limit(limit).toArray();
  if (!since) messages.reverse();
  const senderIds = [...new Set(messages.map(message => message.senderId).filter(Boolean))];
  const senders = senderIds.length
    ? await db.users.find({ id: { $in: senderIds } })
      .project({ id: 1, username: 1, displayName: 1 }).toArray()
    : [];
  const senderById = Object.fromEntries(senders.map(sender => [sender.id, sender]));
  const publicMessages = messages.map(message => {
    const sender = senderById[message.senderId];
    return omitMongoId({
      ...message,
      senderName: sender?.displayName || sender?.username || message.senderName
    });
  });
  res.json({ room: room.id === 'public' ? PUBLIC_CHAT_ROOM : room, messages: publicMessages });
});

app.post('/api/chat/rooms/:id/messages', requireAuth, async (req, res) => {
  try {
    const room = await getChatRoomForUser(req.params.id, req.session.userId);
    if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ส่งข้อความในห้องนี้' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความก่อนส่ง' });
    if (content.length > 2000) return res.status(400).json({ error: 'ข้อความยาวเกินไป (ไม่เกิน 2,000 ตัวอักษร)' });
    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const message = {
      id: 'MSG-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      roomId: room.id,
      senderId: user.id,
      senderName: user.displayName || user.username,
      content,
      createdAt: new Date().toISOString()
    };
    await db.chatMessages.insertOne(message);
    if (room.id !== PUBLIC_CHAT_ROOM.id) {
      await db.chatRooms.updateOne(
        { id: room.id },
        { $set: { lastMessage: content.slice(0, 120), updatedAt: message.createdAt } }
      );
    }
    res.json({ success: true, message: omitMongoId(message) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ส่งข้อความไม่สำเร็จ' });
  }
});

// ---- music player ----
const MUSIC_MAX_BYTES = 15 * 1024 * 1024;
const MUSIC_TYPES = new Map([
  ['audio/mpeg', '.mp3'],
  ['audio/ogg', '.ogg'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav']
]);

function publicMusicTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist || '',
    filename: track.filename,
    mimeType: track.mimeType,
    size: track.size,
    uploadedAt: track.uploadedAt,
    order: Number(track.order || 0),
    streamUrl: `/api/music/tracks/${encodeURIComponent(track.id)}/stream`
  };
}

app.get('/api/music/tracks', async (req, res) => {
  const tracks = await db.musicTracks.find({ active: { $ne: false } })
    .sort({ order: 1, uploadedAt: -1 }).limit(200).toArray();
  res.json({ tracks: tracks.map(publicMusicTrack) });
});

app.get('/api/music/tracks/:id/stream', async (req, res) => {
  const track = await db.musicTracks.findOne({ id: req.params.id, active: { $ne: false } });
  if (!track || !track.gridFsId) return res.status(404).json({ error: 'ไม่พบเพลงนี้' });

  const file = await db.musicFiles.findOne({ _id: track.gridFsId });
  if (!file) return res.status(404).json({ error: 'ไม่พบไฟล์เพลงนี้ในพื้นที่จัดเก็บ' });

  const total = Number(file.length || track.size || 0);
  const range = String(req.headers.range || '');
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = Math.max(total - 1, 0);
  if (match) {
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      return res.status(416).set('Content-Range', `bytes */${total}`).end();
    }
    end = Math.min(end, total - 1);
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${total}`);
  }
  res.set({
    'Content-Type': track.mimeType || 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  const download = musicBucket.openDownloadStream(track.gridFsId, { start, end: end + 1 });
  download.on('error', (err) => {
    if (!res.headersSent) res.status(404).json({ error: 'อ่านไฟล์เพลงไม่สำเร็จ' });
    else res.destroy(err);
  });
  download.pipe(res);
});

app.post('/api/admin/music', requireAdmin, async (req, res) => {
  let gridFsId = null;
  try {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const artist = String(req.body?.artist || '').trim().slice(0, 120);
    const filename = String(req.body?.filename || '').trim().slice(0, 180);
    const mimeType = String(req.body?.mimeType || '').toLowerCase();
    const encoded = String(req.body?.data || '');
    const expectedExtension = MUSIC_TYPES.get(mimeType);
    if (!title) return res.status(400).json({ error: 'กรุณาระบุชื่อเพลง' });
    if (!expectedExtension || !filename.toLowerCase().endsWith(expectedExtension)) {
      return res.status(400).json({ error: 'รองรับเฉพาะไฟล์ MP3, OGG หรือ WAV ที่มีชนิดไฟล์ถูกต้อง' });
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(encoded) || !encoded) {
      return res.status(400).json({ error: 'ข้อมูลไฟล์เพลงไม่ถูกต้อง' });
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > MUSIC_MAX_BYTES) {
      return res.status(400).json({ error: 'ไฟล์เพลงต้องมีขนาดไม่เกิน 15 MB' });
    }

    const now = new Date().toISOString();
    const trackId = 'MUSIC-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
    const upload = musicBucket.openUploadStream(filename, {
      contentType: mimeType,
      metadata: { trackId, title, artist }
    });
    gridFsId = upload.id;
    await new Promise((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(buffer);
    });
    const lastTrack = await db.musicTracks.find({ active: { $ne: false } })
      .sort({ order: -1, uploadedAt: -1 }).limit(1).next();
    const track = {
      id: trackId,
      title,
      artist,
      filename,
      mimeType,
      size: buffer.length,
      gridFsId,
      order: lastTrack ? Number(lastTrack.order || 0) + 1 : 0,
      active: true,
      uploadedAt: now
    };
    await db.musicTracks.insertOne(track);
    res.json({ success: true, track: publicMusicTrack(track) });
  } catch (err) {
    if (gridFsId) await musicBucket.delete(gridFsId).catch(() => {});
    res.status(500).json({ error: err.message || 'อัปโหลดเพลงไม่สำเร็จ' });
  }
});

async function updateMusicOrder(req, res) {
  try {
    const requested = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const requestedIds = requested
      .map(item => String(item?.id || '').trim())
      .filter(Boolean);
    if (!requestedIds.length || new Set(requestedIds).size !== requestedIds.length) {
      return res.status(400).json({ error: 'รายการลำดับเพลงไม่ถูกต้อง' });
    }

    const existing = await db.musicTracks.find({ active: { $ne: false } })
      .sort({ order: 1, uploadedAt: -1 }).toArray();
    const existingIds = new Set(existing.map(track => track.id));
    const orderedIds = [
      ...requestedIds.filter(id => existingIds.has(id)),
      ...existing.map(track => track.id).filter(id => !requestedIds.includes(id))
    ];
    if (!orderedIds.length) return res.status(400).json({ error: 'ยังไม่มีเพลงให้จัดลำดับ' });

    await db.musicTracks.bulkWrite(orderedIds.map((id, order) => ({
      updateOne: { filter: { id }, update: { $set: { order } } }
    })));

    const tracks = await db.musicTracks.find({ active: { $ne: false } })
      .sort({ order: 1, uploadedAt: -1 }).toArray();
    res.json({ success: true, tracks: tracks.map(publicMusicTrack) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'บันทึกลำดับเพลงไม่สำเร็จ' });
  }
}

// POST is kept alongside PATCH because some hosting/proxy setups handle
// ordinary form-style API writes more reliably than PATCH requests.
app.patch('/api/admin/music/order', requireAdmin, updateMusicOrder);
app.post('/api/admin/music/order', requireAdmin, updateMusicOrder);

app.delete('/api/admin/music/:id', requireAdmin, async (req, res) => {
  const track = await db.musicTracks.findOne({ id: req.params.id });
  if (!track) return res.status(404).json({ error: 'ไม่พบเพลงนี้' });
  await db.musicTracks.deleteOne({ id: track.id });
  if (track.gridFsId) await musicBucket.delete(track.gridFsId).catch(() => {});
  res.json({ success: true, track: publicMusicTrack(track) });
});

// ---- change your own password (requires knowing the current one) ----
app.post('/api/account/password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) return res.status(400).json({ error: passwordErr });

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });

    const newHash = await hashPassword(newPassword);
    await db.users.updateOne({ id: req.session.userId }, { $set: { passwordHash: newHash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
  }
});

// ---- change the public display name (the immutable username stays the login ID) ----
const DISPLAY_NAME_CHANGE_COST = 2000;
const DISPLAY_NAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

app.post('/api/account/display-name', requireAuth, async (req, res) => {
  try {
    const displayName = String(req.body?.displayName || '').trim();
    const displayNameErr = validateDisplayName(displayName);
    if (displayNameErr) return res.status(400).json({ error: displayNameErr });

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });

    const currentDisplayName = user.displayName || user.username;
    if (displayName === currentDisplayName) {
      return res.status(400).json({ error: 'ชื่อแสดงผลใหม่ต้องไม่ซ้ำกับชื่อเดิม' });
    }

    const now = Date.now();
    const changedAt = Date.parse(user.displayNameChangedAt || '');
    const nextChangeAt = Number.isFinite(changedAt)
      ? changedAt + DISPLAY_NAME_COOLDOWN_MS
      : 0;
    if (nextChangeAt > now) {
      return res.status(429).json({
        error: `เปลี่ยนชื่อแสดงผลได้อีกครั้งวันที่ ${new Date(nextChangeAt).toLocaleDateString('th-TH')}`,
        nextChangeAt: new Date(nextChangeAt).toISOString()
      });
    }

    const changed = await db.users.findOneAndUpdate(
      {
        id: req.session.userId,
        balance: { $gte: DISPLAY_NAME_CHANGE_COST },
        $or: [
          { displayNameChangedAt: { $exists: false } },
          { displayNameChangedAt: null },
          { displayNameChangedAt: { $lte: new Date(now).toISOString() } }
        ]
      },
      {
        $inc: { balance: -DISPLAY_NAME_CHANGE_COST },
        $set: {
          displayName,
          displayNameChangedAt: new Date(now).toISOString()
        }
      },
      { returnDocument: 'after' }
    );
    const updatedUser = changed?.value || changed;

    if (!updatedUser) {
      const latest = await db.users.findOne({ id: req.session.userId });
      if (!latest) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
      if (Number(latest.balance || 0) < DISPLAY_NAME_CHANGE_COST) {
        return res.status(402).json({
          error: `เครดิตไม่พอ ต้องใช้ ฿${DISPLAY_NAME_CHANGE_COST} (ยอดคงเหลือ ฿${Number(latest.balance || 0)})`,
          code: 'INSUFFICIENT_BALANCE'
        });
      }
      const latestChangedAt = Date.parse(latest.displayNameChangedAt || '');
      const latestNextChangeAt = Number.isFinite(latestChangedAt)
        ? latestChangedAt + DISPLAY_NAME_COOLDOWN_MS
        : 0;
      if (latestNextChangeAt > Date.now()) {
        return res.status(429).json({
          error: `เปลี่ยนชื่อแสดงผลได้อีกครั้งวันที่ ${new Date(latestNextChangeAt).toLocaleDateString('th-TH')}`,
          nextChangeAt: new Date(latestNextChangeAt).toISOString()
        });
      }
      return res.status(409).json({ error: 'ไม่สามารถเปลี่ยนชื่อแสดงผลได้ กรุณาลองใหม่อีกครั้ง' });
    }

    res.json({
      success: true,
      cost: DISPLAY_NAME_CHANGE_COST,
      nextChangeAt: new Date(now + DISPLAY_NAME_COOLDOWN_MS).toISOString(),
      user: publicUser(updatedUser)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'เปลี่ยนชื่อแสดงผลไม่สำเร็จ' });
  }
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
      const check = await isPlayerOnlineViaRcon(raw);
      if (!check.online) {
        return res.status(400).json({
          error: `ผูกไอดีไม่สำเร็จ: ${check.reason}`
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

// ---- messages/notifications sent by admin to a specific player ----
// One-way board: an admin writes a title + reason/message to an account
// (e.g. explaining why a Minecraft-ID verification, topup, or resale
// listing was approved/rejected/removed), the player reads it from their
// account page.
app.get('/api/account/messages', requireAuth, async (req, res) => {
  const nowIso = new Date().toISOString();
  const messages = await db.notifications.find({
    userId: req.session.userId,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: nowIso } }]
  }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({ messages: messages.map(omitMongoId) });
});

app.post('/api/account/messages/read-all', requireAuth, async (req, res) => {
  await db.notifications.updateMany(
    { userId: req.session.userId, read: { $ne: true } },
    { $set: { read: true } }
  );
  res.json({ success: true });
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
// VIP/rank shop and the separate item shop intentionally have separate
// catalogs and purchase endpoints. Existing mixed orders remain readable so
// old purchase history is not lost.
app.get('/api/shop', (req, res) => {
  res.json({ products: rankShopCatalog() });
});

app.get('/api/item-shop', async (req, res) => {
  res.json({ products: await itemShopCatalog() });
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = await db.orders.find({ userId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  res.json({ orders: orders.map(omitMongoId) });
});

app.get('/api/item-orders', requireAuth, async (req, res) => {
  const orders = await db.orders.find({
    userId: req.session.userId,
    productType: 'item'
  }).sort({ createdAt: -1 }).toArray();
  res.json({ orders: orders.map(omitMongoId) });
});

async function placeShopOrder(req, res, shopType) {
  try {
    const product = String(req.body?.product || '').trim();
    const minecraft = String(req.body?.minecraft || '').trim();

    const isRank = Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, product);
    const item = isRank ? null : await db.shopItems.findOne({ id: product, enabled: { $ne: false } });
    if (shopType === 'rank' && !isRank) {
      return res.status(400).json({ error: 'สินค้านี้ไม่ใช่สินค้าในร้านยศ VIP' });
    }
    if (shopType === 'item' && !item) {
      return res.status(400).json({ error: 'สินค้านี้ไม่ใช่สินค้าใน SHOP ไอเทม' });
    }
    if (!isRank && !item) return res.status(400).json({ error: 'ไม่พบสินค้านี้ในร้านค้า' });
    // Same strict charset as /api/account/minecraft - this name gets passed
    // straight into a console command (`lp user <name> parent add ...`)
    // when auto-grant is on, so it can't be allowed to contain spaces/quotes.
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(minecraft)) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ Minecraft ให้ถูกต้อง (3-16 ตัวอักษร a-z, 0-9, _)' });
    }

    // ซื้อยศได้ครั้งเดียวต่อยศ - เช็คก่อนตัดเครดิตว่าบัญชีนี้มียศนี้อยู่แล้วหรือยัง.
    // ถ้ายศหายในเกม แอดมินลบ order เดิมผ่าน DELETE /api/admin/orders/:id
    // เพื่อปลดล็อกให้ซื้อใหม่ได้.
    if (isRank) {
      const already = await db.orders.findOne({ userId: req.session.userId, product });
      if (already) {
        return res.status(409).json({
          error: `คุณมียศ ${product} อยู่แล้ว ซื้อได้เพียงครั้งเดียวต่อยศ หากยศหายในเกม กรุณาติดต่อแอดมินเพื่อแก้ไขให้`,
          code: 'ALREADY_OWNED'
        });
      }
    }

    // Price always comes from the correct server-side catalog, never the client.
    const price = isRank ? SHOP_PRODUCTS[product] : item.price;

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
      productLabel: isRank ? product : item.label,
      price,
      minecraft,
      productType: isRank ? 'rank' : 'item',
      status: GAME_CONSOLE_ENABLED
        ? (isRank ? 'กำลังติดยศในเกม...' : 'กำลังส่งสินค้าเข้าเกม...')
        : (isRank
          ? 'สำเร็จ (จ่ายด้วยเครดิต - รอแอดมินติดยศให้)'
          : 'สำเร็จ (จ่ายด้วยเครดิต - รอแอดมินส่งสินค้าให้)'),
      createdAt: new Date().toISOString()
    };
    try {
      await db.orders.insertOne(order);
    } catch (err) {
      // The unique index caught a duplicate that slipped past the pre-check
      // above (two simultaneous clicks) - refund the deduction so the
      // player isn't charged for a rank they didn't end up getting.
      if (err && err.code === 11000) {
        await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: price } });
        return res.status(409).json({
          error: `คุณมียศ ${product} อยู่แล้ว ซื้อได้เพียงครั้งเดียวต่อยศ ระบบคืนเครดิตให้แล้ว`,
          code: 'ALREADY_OWNED'
        });
      }
      throw err;
    }

    // Step 2: actually hand out the LuckPerms group in-game. Only attempted
    // when we have a way to reach the server console at all (Pterodactyl API
    // or RCON) - without that, the order sits as "รอแอดมินติดยศให้" and staff
    // grant it by hand, same as before this feature existed.
    if (GAME_CONSOLE_ENABLED) {
      try {
        if (isRank) {
          await grantLuckPermsRank(minecraft, product);
          order.status = 'สำเร็จ (ติดยศอัตโนมัติแล้ว)';
        } else {
          await grantShopItem(minecraft, item);
          order.status = `สำเร็จ (ส่ง${item.label}เข้าเกมแล้ว)`;
        }
        await db.orders.updateOne({ id: order.id }, { $set: { status: order.status } });
      } catch (err) {
        // Rank didn't necessarily land - refund the wallet and drop the
        // order entirely (its unique index slot frees up) so the player can
        // just try again once the server/console issue is sorted out.
        await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: price } });
        await db.orders.deleteOne({ id: order.id });
        return res.status(502).json({
          error: `ตัดเครดิตแล้ว แต่ส่งสินค้าเข้าเกมไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ระบบคืนเครดิตให้แล้ว กรุณาลองใหม่อีกครั้ง หรือแจ้งแอดมิน`,
          code: 'GRANT_FAILED'
        });
      }
    }

    res.json({ success: true, order: omitMongoId(order), balance: Number(updatedUser.balance || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'สร้างคำสั่งซื้อไม่สำเร็จ' });
  }
}

app.post('/api/orders', requireAuth, async (req, res) => {
  await placeShopOrder(req, res, 'rank');
});

app.post('/api/item-orders', requireAuth, async (req, res) => {
  await placeShopOrder(req, res, 'item');
});

// ---- item-shop resale board (ขายต่อไอเทมจาก Item Shop ราคาลดตามเวลา) ----
// Players list an item that's already in the Item SHOP catalog for resale
// at a starting price they choose (capped at that item's normal Item Shop
// price). From the moment it's listed, the price falls in a straight line
// down to a floor (a % of the starting price) over an admin-configured
// number of hours, then holds at the floor until it sells or is cancelled.
// The site has no way to see real Minecraft inventories, so this does NOT
// move a physical item out of the seller's inventory - buying a listing
// delivers a fresh copy of the item to the BUYER the same way the Item
// SHOP itself does (console command), and the (decayed) price is credited
// to the seller's wallet. In effect the seller is offering a personal
// discount on that item and collects the payout when someone takes it -
// there is no admin-confirm/escrow step because delivery is automatic,
// same as the regular Item SHOP.
const RESALE_ID_PREFIX = 'RS-';

// Straight-line price between the listing's snapshotted startPrice (at
// t=0) and floorPrice (at t>=decayHours). Always recomputed from
// createdAt - never stored as a mutable "current price" field - so it's
// always correct regardless of when it's read.
function currentResalePrice(listing) {
  const elapsedMs = Date.now() - new Date(listing.createdAt).getTime();
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  if (elapsedHours <= 0) return listing.startPrice;
  if (elapsedHours >= listing.decayHours) return listing.floorPrice;
  const progress = elapsedHours / listing.decayHours;
  const price = listing.startPrice - (listing.startPrice - listing.floorPrice) * progress;
  return Math.max(listing.floorPrice, Math.round(price));
}

// sellerOnlineSet is a lowercase Set of currently-online in-game names (from
// fetchOnlinePlayerNameSet), or null if online status couldn't be checked
// (RCON not configured/reachable). sellerOnline on the returned object is
// true/false when we could check, or null when we genuinely don't know -
// the client treats null the same as "assume buyable" since there's no way
// to tell either way.
function publicResaleListing(listing, userById, sellerOnlineSet) {
  const seller = userById[listing.sellerId];
  const sellerMc = String(seller?.minecraft || '').trim().toLowerCase();
  const sellerOnline = sellerOnlineSet ? (!!sellerMc && sellerOnlineSet.has(sellerMc)) : null;
  return {
    ...omitMongoId(listing),
    sellerUsername: seller?.username || '(ไม่พบบัญชี)',
    sellerOnline,
    currentPrice: listing.status === 'active' ? currentResalePrice(listing) : (listing.soldPrice ?? listing.startPrice)
  };
}

// GET /api/resale/config - decay duration + floor % so the client can draw
// a countdown/progress bar without guessing the server's numbers.
app.get('/api/resale/config', (req, res) => {
  res.json({
    decayHours: gameSettings.resaleDecayHours,
    floorPercent: gameSettings.resaleFloorPercent
  });
});

app.get('/api/resale/listings', async (req, res) => {
  const listings = await db.resaleListings.find({ status: 'active' }).sort({ createdAt: -1 }).limit(300).toArray();
  const sellerIds = [...new Set(listings.map(l => l.sellerId))];
  const sellers = await db.users.find({ id: { $in: sellerIds } }).toArray();
  const userById = Object.fromEntries(sellers.map(u => [u.id, u]));
  // One RCON /list round-trip covers every listing on the board, instead of
  // checking each seller individually.
  const onlineSet = GAME_CONSOLE_ENABLED ? await fetchOnlinePlayerNameSet() : null;
  res.json({ listings: listings.map(l => publicResaleListing(l, userById, onlineSet)) });
});

app.get('/api/resale/my-listings', requireAuth, async (req, res) => {
  const listings = await db.resaleListings.find({ sellerId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  const userById = { [req.session.userId]: await db.users.findOne({ id: req.session.userId }) };
  const onlineSet = GAME_CONSOLE_ENABLED ? await fetchOnlinePlayerNameSet() : null;
  res.json({ listings: listings.map(l => publicResaleListing(l, userById, onlineSet)) });
});

app.post('/api/resale/listings', requireAuth, async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || '').trim();
    if (!itemId) return res.status(400).json({ error: 'กรุณาเลือกไอเทมที่ต้องการลงขายต่อ' });

    const item = await db.shopItems.findOne({ id: itemId, enabled: { $ne: false } });
    if (!item) return res.status(400).json({ error: 'ไม่พบไอเทมนี้ใน Item SHOP กรุณาเลือกใหม่' });
    // The buy flow needs to pull the item back out of the seller's
    // inventory before handing a copy to the buyer - can't list an item
    // that has no take command configured.
    if (GAME_CONSOLE_ENABLED && !item.takeCommandTemplate) {
      return res.status(400).json({ error: 'ไอเทมนี้ยังไม่รองรับระบบขายต่อ (แอดมินยังไม่ตั้งคำสั่งดึงของ) กรุณาติดต่อแอดมิน' });
    }

    const user = await db.users.findOne({ id: req.session.userId });
    if (GAME_CONSOLE_ENABLED && !String(user?.minecraft || '').trim()) {
      return res.status(400).json({ error: 'กรุณาผูกไอดี Minecraft ของคุณก่อนลงขายต่อ (ต้องใช้ตอนดึงไอเทมจากตัวคุณไปให้ผู้ซื้อ)' });
    }
    const isTrustedSeller = RESALE_SELLER_TITLE_IDS.includes(user?.titleId);

    const activeCount = await db.resaleListings.countDocuments({ sellerId: req.session.userId, status: 'active' });
    if (activeCount >= MAX_ACTIVE_RESALE_LISTINGS_PER_USER) {
      return res.status(400).json({ error: `ลงขายต่อได้สูงสุด ${MAX_ACTIVE_RESALE_LISTINGS_PER_USER} รายการพร้อมกัน กรุณายกเลิกรายการเก่าก่อน` });
    }

    const startPrice = Math.trunc(Number(req.body?.price));
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุราคาเริ่มต้นที่ถูกต้อง (มากกว่า 0)' });
    }
    if (startPrice > item.price) {
      return res.status(400).json({ error: `ราคาเริ่มต้นต้องไม่เกินราคา Item SHOP ของไอเทมนี้ (฿${item.price})` });
    }
    // Accounts without a trusted title (still "สมาชิกใหม่") can list too,
    // just capped at a small starting price - keeps their exposure low
    // without requiring them to get a title from an admin first.
    if (!isTrustedSeller && startPrice > RESALE_UNTRUSTED_MAX_PRICE) {
      return res.status(403).json({ error: `บัญชี "สมาชิกใหม่" ลงขายต่อได้ในราคาเริ่มต้นไม่เกิน ฿${RESALE_UNTRUSTED_MAX_PRICE} เท่านั้น (ขอฉายา "ผู้ซื้อขาย" จากแอดมินเพื่อลงขายราคาสูงกว่านี้ได้)` });
    }

    // Snapshot the current decay config onto the listing - an admin
    // changing the global decayHours/floorPercent later never reaches
    // back and changes a listing that's already posted.
    const decayHours = gameSettings.resaleDecayHours;
    const floorPrice = Math.max(1, Math.round(startPrice * (gameSettings.resaleFloorPercent / 100)));

    const listing = {
      id: RESALE_ID_PREFIX + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      sellerId: req.session.userId,
      itemId: item.id,
      itemLabel: item.label,
      itemIcon: item.icon,
      shopPrice: item.price,
      startPrice,
      floorPrice,
      decayHours,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    await db.resaleListings.insertOne(listing);
    res.json({ success: true, listing: publicResaleListing(listing, { [user.id]: user }) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ลงขายต่อไม่สำเร็จ' });
  }
});

app.delete('/api/resale/listings/:id', requireAuth, async (req, res) => {
  const updated = await db.resaleListings.findOneAndUpdate(
    { id: req.params.id, sellerId: req.session.userId, status: 'active' },
    { $set: { status: 'cancelled', cancelledAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  const listing = updated?.value || updated;
  if (!listing) return res.status(404).json({ error: 'ไม่พบรายการนี้ หรือถูกซื้อ/ยกเลิกไปแล้ว' });
  res.json({ success: true });
});

// Buys a resale listing at its current (decayed) price. Order of
// operations (in this order on purpose, so nothing is ever minted or
// charged for a copy that doesn't physically leave the seller first):
//   1. confirm the seller is online right now, so the take command below
//      actually has a target
//   2. reserve the listing atomically (status active -> sold) so two
//      buyers can't both grab it
//   3. pull the item OUT of the seller's inventory (take command)
//   4. charge the buyer
//   5. deliver a copy of the item TO the buyer (give command)
//   6. credit the seller
// A failure at any step unwinds every step already taken before it -
// including giving the item back to the seller if it was already taken
// but delivery to the buyer then failed.
app.post('/api/resale/listings/:id/buy', requireAuth, async (req, res) => {
  try {
    const minecraft = String(req.body?.minecraft || '').trim();
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(minecraft)) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ Minecraft ให้ถูกต้อง (3-16 ตัวอักษร a-z, 0-9, _)' });
    }

    const listing = await db.resaleListings.findOne({ id: req.params.id });
    if (!listing || listing.status !== 'active') {
      return res.status(400).json({ error: 'รายการนี้ไม่พร้อมใช้งาน (อาจถูกซื้อหรือยกเลิกไปแล้ว)' });
    }
    if (listing.sellerId === req.session.userId) {
      return res.status(400).json({ error: 'ไม่สามารถซื้อรายการของตัวเองได้' });
    }

    const item = await db.shopItems.findOne({ id: listing.itemId });
    if (GAME_CONSOLE_ENABLED && (!item || !item.takeCommandTemplate)) {
      return res.status(400).json({ error: 'ไอเทมนี้ยังไม่พร้อมสำหรับระบบขายต่อ (แอดมินยังไม่ตั้งคำสั่งดึงของ) กรุณาติดต่อแอดมิน' });
    }

    const seller = await db.users.findOne({ id: listing.sellerId });
    const sellerMc = String(seller?.minecraft || '').trim();

    // Step 1: the seller must be online for the take command to have
    // anyone to run against - otherwise this would just mint a free extra
    // copy for the buyer with nothing actually leaving the seller.
    if (GAME_CONSOLE_ENABLED) {
      if (!sellerMc) {
        return res.status(409).json({ error: 'ผู้ขายยังไม่ได้ผูกไอดี Minecraft ไม่สามารถซื้อรายการนี้ได้ในขณะนี้', code: 'SELLER_OFFLINE' });
      }
      const onlineCheck = await isPlayerOnlineViaRcon(sellerMc);
      if (!onlineCheck.online) {
        return res.status(409).json({ error: 'ผู้ขายออฟไลน์อยู่ในขณะนี้ ซื้อไม่ได้ชั่วคราว กรุณาลองใหม่ตอนผู้ขายออนไลน์', code: 'SELLER_OFFLINE' });
      }
    }

    const price = currentResalePrice(listing);

    // Step 2: reserve the listing.
    const reserved = await db.resaleListings.findOneAndUpdate(
      { id: listing.id, status: 'active' },
      { $set: { status: 'sold', buyerId: req.session.userId, soldPrice: price, soldAt: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    const soldListing = reserved?.value || reserved;
    if (!soldListing) return res.status(409).json({ error: 'รายการนี้เพิ่งถูกซื้อไปโดยผู้เล่นคนอื่น' });

    // Step 3: pull the item out of the seller's inventory first.
    if (GAME_CONSOLE_ENABLED) {
      try {
        await takeShopItem(sellerMc, item);
      } catch (err) {
        await db.resaleListings.updateOne({ id: listing.id }, { $set: { status: 'active' }, $unset: { buyerId: '', soldPrice: '', soldAt: '' } });
        return res.status(502).json({
          error: `ดึงไอเทมจากผู้ขายไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ยังไม่มีการตัดเครดิตใดๆ กรุณาลองใหม่อีกครั้ง`,
          code: 'TAKE_FAILED'
        });
      }
    }

    // Step 4: charge the buyer.
    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: price } },
      { $inc: { balance: -price } },
      { returnDocument: 'after' }
    );
    const buyer = deducted?.value || deducted;
    if (!buyer) {
      // Undo the take before reopening the listing - give the item back
      // to the seller the same way the Item SHOP would.
      if (GAME_CONSOLE_ENABLED) {
        try { await grantShopItem(sellerMc, item); } catch (e) { console.error('[resale] failed to restore item to seller after insufficient buyer credit:', e.message); }
      }
      await db.resaleListings.updateOne({ id: listing.id }, { $set: { status: 'active' }, $unset: { buyerId: '', soldPrice: '', soldAt: '' } });
      return res.status(402).json({ error: `ยอดเครดิตไม่พอ (ต้องใช้ ฿${price})` });
    }

    const order = {
      id: 'MARI-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      product: listing.itemId,
      productLabel: listing.itemLabel,
      price,
      minecraft,
      productType: 'item',
      fromResale: true,
      resaleListingId: listing.id,
      resaleSellerId: listing.sellerId,
      status: GAME_CONSOLE_ENABLED ? 'กำลังส่งสินค้าเข้าเกม...' : 'สำเร็จ (จ่ายด้วยเครดิต - รอแอดมินส่งสินค้าให้)',
      createdAt: new Date().toISOString()
    };
    await db.orders.insertOne(order);

    // Step 5: deliver a copy to the buyer.
    if (GAME_CONSOLE_ENABLED) {
      try {
        if (!item) throw new Error('ไม่พบไอเทมนี้ใน Item SHOP แล้ว (อาจถูกลบออก)');
        await grantShopItem(minecraft, item);
        order.status = `สำเร็จ (ส่ง${item.label}เข้าเกมแล้ว)`;
        await db.orders.updateOne({ id: order.id }, { $set: { status: order.status } });
      } catch (err) {
        // Delivery to the buyer failed - unwind everything: refund the
        // buyer, give the item back to the seller (the take already
        // happened), drop the order, and reopen the listing exactly as it
        // was (same start/floor/decay - no free re-roll of the timer).
        // The seller hasn't been credited yet at this point (that's step 6,
        // after delivery succeeds), so there's no payout to reverse.
        await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: price } });
        if (GAME_CONSOLE_ENABLED) {
          try { await grantShopItem(sellerMc, item); } catch (e) { console.error('[resale] failed to restore item to seller after failed delivery to buyer:', e.message); }
        }
        await db.orders.deleteOne({ id: order.id });
        await db.resaleListings.updateOne({ id: listing.id }, { $set: { status: 'active' }, $unset: { buyerId: '', soldPrice: '', soldAt: '' } });
        return res.status(502).json({
          error: `ดึงของจากผู้ขายไปแล้ว แต่ส่งให้ผู้ซื้อไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ระบบคืนเครดิตและคืนไอเทมให้ผู้ขายแล้ว กรุณาลองใหม่อีกครั้ง`,
          code: 'GRANT_FAILED'
        });
      }
    }

    // Step 6: credit the seller now that delivery to the buyer succeeded.
    await db.users.updateOne({ id: listing.sellerId }, { $inc: { balance: price } });

    res.json({ success: true, order: omitMongoId(order), price, balance: Number(buyer.balance || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ซื้อไม่สำเร็จ' });
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
  if (!GAME_CONSOLE_ENABLED) {
    return res.status(503).json({ error: 'ระบบแลก Point ยังไม่พร้อมใช้งาน (แอดมินยังไม่ได้ตั้งค่า Pterodactyl API หรือ RCON)' });
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

// ---- redeem wallet credit for in-game /money (server economy, via RCON) ----
// Same "deduct first, refund on failure" contract as the PlayerPoints
// redeem above, plus a per-account daily quota (MAX_MONEY_REDEEM_COUNT_PER_DAY,
// counted in NUMBER OF REDEEM REQUESTS, not money amount) that resets at
// midnight Asia/Bangkok time. The quota is reserved atomically before the
// wallet is touched, and rolled back if the wallet deduction or the
// in-game delivery fails, so a failed/insufficient-balance attempt never
// eats into the player's daily allowance.
app.get('/api/money/status', requireAuth, async (req, res) => {
  const user = await db.users.findOne({ id: req.session.userId });
  const today = todayKeyBangkok();
  const usedToday = user?.moneyRedeemDay === today ? Number(user.moneyRedeemCountToday || 0) : 0;
  res.json({
    enabled: GAME_CONSOLE_ENABLED,
    rate: MONEY_PER_BAHT,
    dailyLimit: MAX_MONEY_REDEEM_COUNT_PER_DAY,
    usedToday,
    remainingToday: Math.max(0, MAX_MONEY_REDEEM_COUNT_PER_DAY - usedToday)
  });
});

app.post('/api/money/redeem', requireAuth, async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount)); // บาทเครดิตที่ต้องการแลก
  if (!Number.isFinite(amount) || amount < MIN_MONEY_REDEEM_BAHT) {
    return res.status(400).json({ error: `กรุณากรอกจำนวนเงินอย่างน้อย ${MIN_MONEY_REDEEM_BAHT} บาท` });
  }
  if (!GAME_CONSOLE_ENABLED) {
    return res.status(503).json({ error: 'ระบบแลกเงินในเกมยังไม่พร้อมใช้งาน (แอดมินยังไม่ได้ตั้งค่า Pterodactyl API หรือ RCON)' });
  }

  const moneyAmount = amount * MONEY_PER_BAHT;

  const user = await db.users.findOne({ id: req.session.userId });
  const minecraft = String(user?.minecraft || '').trim();
  if (!minecraft) {
    return res.status(400).json({ error: 'กรุณาผูกไอดี Minecraft ในหน้าบัญชีก่อนแลกเงินในเกม' });
  }

  const today = todayKeyBangkok();

  // Step 1: reserve today's quota atomically - counts NUMBER OF REDEEM
  // REQUESTS today (max MAX_MONEY_REDEEM_COUNT_PER_DAY), regardless of the
  // amount redeemed in each one. Try incrementing an existing same-day
  // counter first (only succeeds if it won't exceed the cap)...
  let reservedDoc = await db.users.findOneAndUpdate(
    { id: req.session.userId, moneyRedeemDay: today, moneyRedeemCountToday: { $lt: MAX_MONEY_REDEEM_COUNT_PER_DAY } },
    { $inc: { moneyRedeemCountToday: 1 } },
    { returnDocument: 'after' }
  );
  let reserved = reservedDoc?.value || reservedDoc;
  if (!reserved) {
    // ...otherwise this must be the first redemption of a new day (or
    // ever) - reset the counter. Only matches when moneyRedeemDay is
    // actually stale, so it can never double-apply alongside the
    // increment above.
    reservedDoc = await db.users.findOneAndUpdate(
      { id: req.session.userId, moneyRedeemDay: { $ne: today } },
      { $set: { moneyRedeemDay: today, moneyRedeemCountToday: 1 } },
      { returnDocument: 'after' }
    );
    reserved = reservedDoc?.value || reservedDoc;
  }
  if (!reserved) {
    // Same day, but this request would push the count over the daily cap.
    const fresh = await db.users.findOne({ id: req.session.userId });
    const usedToday = fresh?.moneyRedeemDay === today ? Number(fresh.moneyRedeemCountToday || 0) : 0;
    const remaining = Math.max(0, MAX_MONEY_REDEEM_COUNT_PER_DAY - usedToday);
    return res.status(400).json({
      error: `เกินโควตาแลกเงินในเกมของวันนี้แล้ว (แลกได้สูงสุด ${MAX_MONEY_REDEEM_COUNT_PER_DAY} ครั้ง/วัน เหลือแลกได้อีก ${remaining} ครั้งวันนี้)`,
      code: 'DAILY_LIMIT_EXCEEDED'
    });
  }

  // Step 2: atomically deduct wallet credit - fails cleanly if balance is
  // insufficient. Roll back the quota reservation above if so.
  const deducted = await db.users.findOneAndUpdate(
    { id: req.session.userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { returnDocument: 'after' }
  );
  const afterDeduct = deducted?.value || deducted;
  if (!afterDeduct) {
    await db.users.updateOne({ id: req.session.userId, moneyRedeemDay: today }, { $inc: { moneyRedeemCountToday: -1 } });
    return res.status(402).json({
      error: `ยอดเงินไม่พอ (มี ฿${Number(user?.balance || 0)} ต้องใช้ ฿${amount})`,
      code: 'INSUFFICIENT_BALANCE'
    });
  }

  // Step 3: try to actually deliver the money in-game.
  try {
    await giveRconMoney(minecraft, moneyAmount);
  } catch (err) {
    if (err.commandSent) {
      // Ambiguous outcome - the command may have actually reached and run
      // on the game server, we just couldn't confirm it. Do NOT refund
      // automatically here: if the money really was delivered, refunding
      // too would let the player double-dip. Keep the wallet debit and
      // quota reservation as-is, log the order as pending, and let an
      // admin verify and resolve it manually (refund or mark complete).
      const order = {
        id: 'MNY-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
        userId: req.session.userId,
        product: `เงินในเกม (/money) x${moneyAmount}`,
        price: amount,
        minecraft,
        status: 'รอตรวจสอบ (ไม่ยืนยันว่าส่งเข้าเกมสำเร็จหรือไม่ - แอดมินต้องเช็ก)',
        note: err.message,
        createdAt: new Date().toISOString()
      };
      await db.orders.insertOne(order);
      return res.status(202).json({
        success: false,
        pending: true,
        order: omitMongoId(order),
        error: `ไม่สามารถยืนยันได้ว่าเงินเข้าเกมสำเร็จหรือไม่ (${err.message}) เครดิตของคุณยังไม่ถูกคืนเพื่อป้องกันการได้เงินซ้ำ กรุณาตรวจสอบยอดเงินในเกม แล้วติดต่อแอดมินพร้อมเลขออเดอร์ ${order.id} หากไม่ได้รับเงิน`
      });
    }
    // Command definitely never reached the game (bad RCON password,
    // server offline, syntax rejected, connection never established) -
    // safe to fully undo the wallet debit and quota reservation.
    await db.users.updateOne(
      { id: req.session.userId, moneyRedeemDay: today },
      { $inc: { balance: amount, moneyRedeemCountToday: -1 } }
    );
    return res.status(502).json({
      error: `ส่งเงินเข้าเกมไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ระบบคืนเครดิตให้แล้ว กรุณาลองใหม่อีกครั้ง`
    });
  }

  const order = {
    id: 'MNY-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
    userId: req.session.userId,
    product: `เงินในเกม (/money) x${moneyAmount}`,
    price: amount,
    minecraft,
    status: 'สำเร็จ (ส่งเงินเข้าเกมแล้ว)',
    createdAt: new Date().toISOString()
  };
  await db.orders.insertOne(order);

  const remainingToday = Math.max(0, MAX_MONEY_REDEEM_COUNT_PER_DAY - Number(reserved.moneyRedeemCountToday || 1));

  res.json({
    success: true,
    order: omitMongoId(order),
    money: moneyAmount,
    balance: afterDeduct.balance,
    remainingToday
  });
});

// ---- มินิเกมแข่งรถ (จังหวะ) ----
// กติกา: ผู้เล่นจ่ายค่าเข้าร่วม RACE_STAKE บาท ระบบจับคู่กับผู้เล่นจริงคนอื่นที่
// กำลังรอ ถ้าไม่มีคนจริงมาต่อคิวภายใน RACE_BOT_WAIT_MS จะเติมบอทให้แทน
// ทั้งสองฝั่งเล่นจังหวะเดียวกัน (beatPattern) แล้วส่งค่าความแม่นยำ (ค่าเบี่ยงเบน
// เฉลี่ยหน่วย ms ยิ่งน้อยยิ่งดี) กลับมาให้เซิร์ฟเวอร์ตัดสิน
// ผู้ชนะได้เงินกองกลางทั้งหมด (RACE_STAKE*2) แบบไม่หักค่าธรรมเนียม ส่วนผู้แพ้
// ได้เงินปลอบใจคืน RACE_CONSOLATION บาท
// หมายเหตุสำคัญ: เกมนี้ตัดสินจากเวลาที่ฝั่ง "ไคลเอนต์" (เบราว์เซอร์ผู้เล่น) วัดเอง
// แล้วส่งผลมาให้ ไม่ได้วัดเวลาแบบ server-authoritative เต็มรูปแบบ (เพราะเว็บนี้
// ไม่มี websocket/real-time engine) จึงมีช่องให้โกงได้ในทางเทคนิคถ้าผู้เล่นแก้โค้ด
// ฝั่งตัวเอง เหมาะกับใช้งานเดิมพันเล็กๆ เท่านั้น ถ้าจะใช้เดิมพันจำนวนมากขึ้น
// ควรทำระบบแบบ server-authoritative จริงจัง (เช่นผ่าน websocket) แทน
const RACE_STAKE = Number(process.env.RACE_STAKE || 5); // ค่าเข้าร่วมต่อคน (บาท)
const RACE_CONSOLATION = Number(process.env.RACE_CONSOLATION || 2); // เงินปลอบใจฝั่งแพ้ (บาท)
const RACE_BOT_WAIT_MS = 8000; // รอคนจริงกี่ ms ก่อนเติมบอท
const RACE_BEAT_COUNT = 6; // จำนวนจังหวะต่อแมตช์
const RACE_MATCH_TIMEOUT_MS = 45000; // เกินเวลานี้แล้วยังไม่ส่งผล ถือว่ายอมแพ้

// สุ่มจังหวะ (ms หลังจาก startAt) ให้ผู้เล่นทั้งสองฝั่งเห็นจังหวะเดียวกัน
function generateBeatPattern() {
  const beats = [];
  let t = 1200 + Math.floor(Math.random() * 400); // จังหวะแรกมาใน 1.2-1.6 วิ
  for (let i = 0; i < RACE_BEAT_COUNT; i++) {
    beats.push(t);
    t += 700 + Math.floor(Math.random() * 600); // ห่างกันจังหวะละ 0.7-1.3 วิ
  }
  return beats;
}

// สุ่มคะแนนบอทให้พอสู้ได้ (ไม่เก่งเกินไป ไม่ห่วยเกินไป) ค่าเบี่ยงเบนเฉลี่ย ms
function generateBotScore() {
  return 60 + Math.random() * 140; // เฉลี่ยพลาดจังหวะ 60-200ms ต่อจังหวะ
}

function raceMatchView(match, userId) {
  const youAreA = match.playerAId === userId;
  return {
    id: match.id,
    status: match.status,
    stake: match.stake,
    isBot: match.playerBId === 'BOT',
    youAre: youAreA ? 'A' : 'B',
    startAt: match.startAt || null,
    beatPattern: match.status === 'ready' || match.status === 'finished' ? match.beatPattern : null,
    opponentName: youAreA ? (match.playerBName || null) : match.playerAName,
    yourScore: youAreA ? match.playerAScore : match.playerBScore,
    opponentScore: youAreA ? match.playerBScore : match.playerAScore,
    winner: match.status === 'finished' ? (match.winnerId === userId ? 'you' : (match.winnerId ? 'opponent' : 'draw')) : null,
    balanceChange: match.status === 'finished'
      ? (match.winnerId === userId ? (match.stake * 2) - match.stake : RACE_CONSOLATION - match.stake)
      : null
  };
}

// ตัดสินผลและโอนเงินแบบ atomic เมื่อคะแนนของทั้งสองฝั่งพร้อมแล้ว (หรือหมดเวลา)
async function settleRaceMatch(match) {
  if (match.status === 'finished') return match;

  const aTimedOut = match.playerAScore == null && Date.now() > match.startAt + RACE_MATCH_TIMEOUT_MS;
  const bTimedOut = match.playerBId !== 'BOT' && match.playerBScore == null && Date.now() > match.startAt + RACE_MATCH_TIMEOUT_MS;
  const bothIn = match.playerAScore != null && match.playerBScore != null;
  if (!bothIn && !aTimedOut && !bTimedOut) return match; // ยังรอผลอยู่ ยังตัดสินไม่ได้

  let aScore = match.playerAScore == null ? Infinity : match.playerAScore;
  let bScore = match.playerBScore == null ? Infinity : match.playerBScore;
  let winnerId = null;

  // แมตช์ที่คู่แข่งเป็นบอท: ผลจะถูกกำหนดโดยเรทที่แอดมินตั้งไว้
  // (gameSettings.raceBotWinRate) ไม่ใช่เทียบคะแนนดิบตรงๆ - ถ้าผู้เล่นจริง
  // ส่งคะแนนมาแล้ว จะสุ่มเลือกฝั่งชนะตามเรทก่อน แล้วค่อยปรับคะแนนบอทให้
  // สอดคล้องกับผลที่สุ่มได้ (ฝั่งชนะได้ค่าเบี่ยงเบนน้อยกว่าเสมอ) เพื่อให้สิ่งที่
  // แสดงบนหน้าจอตรงกับผลจริง ส่วนแมตช์ระหว่างผู้เล่นจริงสองคน (PvP) ยังคง
  // ตัดสินจากคะแนนจริงล้วนๆ ไม่ถูกแตะต้องโดยการตั้งค่านี้
  if (match.playerBId === 'BOT' && !aTimedOut && match.playerAScore != null) {
    const botWins = Math.random() * 100 < gameSettings.raceBotWinRate;
    winnerId = botWins ? match.playerBId : match.playerAId;
    bScore = botWins
      ? Math.max(25, match.playerAScore - (5 + Math.random() * 60))
      : match.playerAScore + (5 + Math.random() * 80);
  } else if (aScore < bScore) {
    winnerId = match.playerAId;
  } else if (bScore < aScore) {
    winnerId = match.playerBId;
  }
  // คะแนนเท่ากันเป๊ะ (พบยาก) หรือ timeout ทั้งคู่ ถือว่าเสมอ - คืนค่าเดิมพันให้ทั้งคู่คนละเท่าตัวที่จ่ายไป

  const pot = match.stake * 2;
  const isDraw = winnerId === null;

  const ops = [];
  if (isDraw) {
    ops.push(db.users.updateOne({ id: match.playerAId }, { $inc: { balance: match.stake } }));
    if (match.playerBId !== 'BOT') ops.push(db.users.updateOne({ id: match.playerBId }, { $inc: { balance: match.stake } }));
  } else {
    const loserId = winnerId === match.playerAId ? match.playerBId : match.playerAId;
    ops.push(db.users.updateOne({ id: winnerId }, { $inc: { balance: pot } }));
    if (loserId !== 'BOT') ops.push(db.users.updateOne({ id: loserId }, { $inc: { balance: RACE_CONSOLATION } }));
  }
  await Promise.all(ops);

  const setFields = { status: 'finished', winnerId: isDraw ? null : winnerId, finishedAt: new Date().toISOString() };
  // บันทึกคะแนนบอทที่ถูกปรับ (ถ้ามี) ไว้ด้วย เพื่อให้ครั้งต่อไปที่ฝั่งไคลเอนต์
  // อ่านแมตช์นี้ เห็นคะแนนที่ตรงกับผลจริง
  if (match.playerBId === 'BOT' && Number.isFinite(bScore)) {
    setFields.playerBScore = bScore;
  }

  const updated = await db.raceMatches.findOneAndUpdate(
    { id: match.id, status: { $ne: 'finished' } },
    { $set: setFields },
    { returnDocument: 'after' }
  );
  return updated?.value || updated || match;
}

// เข้าคิวหา/เข้าร่วมแมตช์ - หักค่าเข้าร่วมทันทีตอนนี้
app.post('/api/race/join', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });

    // หาแมตช์ที่กำลังรอคู่แข่งอยู่ (ยังไม่ใช่ของตัวเอง และยังไม่เกินเวลารอบอท)
    const waiting = await db.raceMatches.findOne({
      status: 'waiting',
      playerAId: { $ne: req.session.userId }
    }, { sort: { createdAt: 1 } });

    // หักเงินก่อนเสมอ (อะตอมมิก กันเงินไม่พอ)
    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: RACE_STAKE } },
      { $inc: { balance: -RACE_STAKE } },
      { returnDocument: 'after' }
    );
    const afterDeduct = deducted?.value || deducted;
    if (!afterDeduct) {
      return res.status(402).json({
        error: `เครดิตไม่พอสำหรับเข้าเล่น (ต้องใช้ ฿${RACE_STAKE})`,
        code: 'INSUFFICIENT_BALANCE'
      });
    }

    if (waiting) {
      // เจอคนจริงกำลังรออยู่ - จับคู่ทันที
      const beatPattern = generateBeatPattern();
      const startAt = Date.now() + 3000;
      const joined = await db.raceMatches.findOneAndUpdate(
        { id: waiting.id, status: 'waiting' },
        {
          $set: {
            playerBId: req.session.userId,
            playerBName: user.displayName || user.username,
            beatPattern,
            startAt,
            status: 'ready'
          }
        },
        { returnDocument: 'after' }
      );
      const match = joined?.value || joined;
      if (match) return res.json({ success: true, match: raceMatchView(match, req.session.userId) });
      // เผื่อเคสชนกันพอดี (คนอื่นจับคู่ไปก่อน) - ตกไปสร้างแมตช์ใหม่ของตัวเองแทน
    }

    const match = {
      id: 'RACE-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      playerAId: req.session.userId,
      playerAName: user.displayName || user.username,
      playerBId: null,
      playerBName: null,
      stake: RACE_STAKE,
      status: 'waiting',
      beatPattern: null,
      startAt: null,
      playerAScore: null,
      playerBScore: null,
      winnerId: null,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now()
    };
    await db.raceMatches.insertOne(match);
    res.json({ success: true, match: raceMatchView(match, req.session.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'เข้าร่วมเกมไม่สำเร็จ' });
  }
});

// เช็คสถานะแมตช์ (ฝั่งไคลเอนต์ poll ทุก 1 วิ) - ถ้ารอนานเกินไปจะเติมบอทให้อัตโนมัติ
app.get('/api/race/match/:id', requireAuth, async (req, res) => {
  let match = await db.raceMatches.findOne({ id: req.params.id });
  if (!match) return res.status(404).json({ error: 'ไม่พบแมตช์นี้' });
  if (match.playerAId !== req.session.userId && match.playerBId !== req.session.userId) {
    return res.status(403).json({ error: 'ไม่ใช่แมตช์ของคุณ' });
  }

  // ยังไม่มีคู่แข่งและรอเกิน RACE_BOT_WAIT_MS แล้ว - เติมบอท
  if (match.status === 'waiting' && Date.now() - match.createdAtMs > RACE_BOT_WAIT_MS) {
    const beatPattern = generateBeatPattern();
    const startAt = Date.now() + 3000;
    const updated = await db.raceMatches.findOneAndUpdate(
      { id: match.id, status: 'waiting' },
      {
        $set: {
          playerBId: 'BOT',
          playerBName: 'บอท 🤖',
          beatPattern,
          startAt,
          status: 'ready',
          playerBScore: generateBotScore()
        }
      },
      { returnDocument: 'after' }
    );
    match = updated?.value || updated || match;
  }

  if (match.status === 'ready' && match.startAt && Date.now() > match.startAt + RACE_MATCH_TIMEOUT_MS) {
    match = await settleRaceMatch(match);
  } else if (match.status === 'ready' && match.playerAScore != null && match.playerBScore != null) {
    match = await settleRaceMatch(match);
  }

  res.json({ success: true, match: raceMatchView(match, req.session.userId) });
});

// ส่งผลคะแนนความแม่นยำของตัวเอง (ค่าเบี่ยงเบนเฉลี่ย ms - ยิ่งน้อยยิ่งดี)
app.post('/api/race/match/:id/submit', requireAuth, async (req, res) => {
  const deviationMs = Number(req.body?.deviationMs);
  if (!Number.isFinite(deviationMs) || deviationMs < 0) {
    return res.status(400).json({ error: 'ผลคะแนนไม่ถูกต้อง' });
  }
  const match = await db.raceMatches.findOne({ id: req.params.id });
  if (!match) return res.status(404).json({ error: 'ไม่พบแมตช์นี้' });
  if (match.status !== 'ready') return res.status(400).json({ error: 'แมตช์นี้จบไปแล้วหรือยังไม่พร้อม' });

  const isA = match.playerAId === req.session.userId;
  const isB = match.playerBId === req.session.userId;
  if (!isA && !isB) return res.status(403).json({ error: 'ไม่ใช่แมตช์ของคุณ' });

  const field = isA ? 'playerAScore' : 'playerBScore';
  const updated = await db.raceMatches.findOneAndUpdate(
    { id: match.id, [field]: null },
    { $set: { [field]: deviationMs } },
    { returnDocument: 'after' }
  );
  let fresh = updated?.value || updated || match;
  fresh = await settleRaceMatch(fresh);
  res.json({ success: true, match: raceMatchView(fresh, req.session.userId) });
});

app.get('/api/race/config', (req, res) => {
  res.json({ stake: RACE_STAKE, consolation: RACE_CONSOLATION, beatCount: RACE_BEAT_COUNT });
});

// ---- มินิเกมวงล้อ (หมุนวงล้อสุ่มรางวัล) ----
// กติกา: ผู้เล่นจ่ายค่าเล่น WHEEL_STAKE บาทต่อครั้ง เซิร์ฟเวอร์เป็นคนสุ่มผลเอง
// (server-authoritative) ตามน้ำหนัก (weight) ของแต่ละช่อง แล้วคืนเครดิตตาม
// ตัวคูณ (multiplier) ของช่องที่สุ่มได้ทันที - ฝั่งไคลเอนต์ได้แค่ "ดัชนีช่องที่
// ถูก" กลับไปหมุนวงล้อให้ไปหยุดตรงช่องนั้นเฉยๆ ไม่ได้เป็นคนตัดสินผลเอง จึงโกง
// ไม่ได้ (เหมือนกับมินิเกมแข่งรถด้านบน ควรใช้เดิมพันจำนวนน้อยเท่านั้น)
const WHEEL_STAKE = Number(process.env.WHEEL_STAKE || 5); // ค่าเล่นต่อครั้ง (บาท)
// Prize list + odds (weight) now live in gameSettings.wheelPrizes (admin-
// editable from /admin.html, see the "game settings" section above) instead
// of a hardcoded constant. DEFAULT_WHEEL_PRIZES above is only the starting
// point the first time the server runs.

function pickWheelPrize() {
  const prizes = gameSettings.wheelPrizes;
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < prizes.length; i++) {
    r -= prizes[i].weight;
    if (r <= 0) return { index: i, prize: prizes[i] };
  }
  return { index: prizes.length - 1, prize: prizes[prizes.length - 1] };
}

// ให้ฝั่งไคลเอนต์รู้ลำดับ/สี/ป้ายชื่อของแต่ละช่อง เพื่อวาดวงล้อให้ตรงกับฝั่งเซิร์ฟเวอร์
// (ไม่ส่ง weight ออกไป กันคนคำนวณโอกาสแล้วเอาไปใช้ประโยชน์)
app.get('/api/wheel/config', (req, res) => {
  res.json({
    stake: WHEEL_STAKE,
    prizes: gameSettings.wheelPrizes.map(p => ({ id: p.id, label: p.label, color: p.color }))
  });
});

app.post('/api/wheel/spin', requireAuth, async (req, res) => {
  try {
    // หักเงินก่อนเสมอ (อะตอมมิก กันเงินไม่พอ / กันกดรัวๆ แย่งเดิมพันเดียวกัน)
    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: WHEEL_STAKE } },
      { $inc: { balance: -WHEEL_STAKE } },
      { returnDocument: 'after' }
    );
    const afterDeduct = deducted?.value || deducted;
    if (!afterDeduct) {
      return res.status(402).json({
        error: `เครดิตไม่พอสำหรับเล่น (ต้องใช้ ฿${WHEEL_STAKE})`,
        code: 'INSUFFICIENT_BALANCE'
      });
    }

    const { index, prize } = pickWheelPrize();
    const payout = Math.round(WHEEL_STAKE * prize.multiplier * 100) / 100;

    let finalUser = afterDeduct;
    if (payout > 0) {
      const credited = await db.users.findOneAndUpdate(
        { id: req.session.userId },
        { $inc: { balance: payout } },
        { returnDocument: 'after' }
      );
      finalUser = credited?.value || credited || afterDeduct;
    }

    // เก็บ log แบบ best-effort ไว้ดูย้อนหลังเฉยๆ (เขียนไม่สำเร็จก็ไม่กระทบผลลัพธ์ที่ผู้เล่นได้)
    db.wheelSpins.insertOne({
      userId: req.session.userId,
      prizeId: prize.id,
      stake: WHEEL_STAKE,
      payout,
      balanceAfter: finalUser.balance,
      createdAt: new Date().toISOString()
    }).catch(() => {});

    res.json({
      success: true,
      index,
      prizeId: prize.id,
      label: prize.label,
      stake: WHEEL_STAKE,
      payout,
      balanceChange: Math.round((payout - WHEEL_STAKE) * 100) / 100,
      balance: finalUser.balance
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'หมุนวงล้อไม่สำเร็จ' });
  }
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

// ---- admin: win/lose rates for the race + wheel mini-games ----
// Read-only for everyone else - the wheel weights are deliberately never
// exposed on /api/wheel/config (see comment there), and the race bot rate
// isn't exposed to players at all.
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    raceBotWinRate: gameSettings.raceBotWinRate,
    wheelPrizes: gameSettings.wheelPrizes
  });
});

app.post('/api/admin/settings/race', requireAdmin, async (req, res) => {
  try {
    const rate = Number(req.body?.raceBotWinRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ error: 'เรทชนะของบอทต้องเป็นตัวเลข 0-100' });
    }
    gameSettings.raceBotWinRate = rate;
    await db.settings.updateOne(
      { id: 'gameSettings' },
      { $set: { raceBotWinRate: rate } },
      { upsert: true }
    );
    res.json({ success: true, raceBotWinRate: rate });
  } catch (err) {
    res.status(500).json({ error: err.message || 'บันทึกไม่สำเร็จ' });
  }
});

app.post('/api/admin/settings/wheel', requireAdmin, async (req, res) => {
  try {
    const prizesInput = req.body?.prizes;
    if (!Array.isArray(prizesInput) || prizesInput.length < 1) {
      return res.status(400).json({ error: 'ต้องมีอย่างน้อย 1 ช่องรางวัล' });
    }
    if (prizesInput.length > 20) {
      return res.status(400).json({ error: 'มีช่องรางวัลได้ไม่เกิน 20 ช่อง' });
    }
    const prizes = [];
    const seenIds = new Set();
    for (const raw of prizesInput) {
      const label = String(raw?.label || '').trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: 'ทุกช่องต้องมีป้ายชื่อ' });

      let id = String(raw?.id || '').trim().slice(0, 40);
      if (!id) id = 'prize_' + (prizes.length + 1);
      if (seenIds.has(id)) return res.status(400).json({ error: `รหัสช่องรางวัลซ้ำ: ${id}` });
      seenIds.add(id);

      const multiplier = Number(raw?.multiplier);
      if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 100) {
        return res.status(400).json({ error: `ตัวคูณของ "${label}" ไม่ถูกต้อง (0-100)` });
      }
      const weight = Number(raw?.weight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 10000) {
        return res.status(400).json({ error: `น้ำหนัก/โอกาสของ "${label}" ต้องมากกว่า 0` });
      }
      const color = /^#[0-9a-fA-F]{6}$/.test(String(raw?.color || '')) ? raw.color : '#cccccc';

      prizes.push({ id, label, multiplier, weight, color });
    }

    gameSettings.wheelPrizes = prizes;
    await db.settings.updateOne(
      { id: 'gameSettings' },
      { $set: { wheelPrizes: prizes } },
      { upsert: true }
    );
    res.json({ success: true, wheelPrizes: prizes });
  } catch (err) {
    res.status(500).json({ error: err.message || 'บันทึกไม่สำเร็จ' });
  }
});

// ---- admin: test any console command and see the raw response ----
// Mainly meant for figuring out the right economy-plugin command for the
// /money redeem feature (giveRconMoney / MONEY_GIVE_COMMAND) when the admin
// isn't sure which plugin their server runs. This runs the command for
// real on the live Minecraft server - it is NOT a dry run and does not
// touch any player's wallet credit or daily /money quota on this website,
// so use a small test amount and/or your own account. Only works with
// RCON (returns the server's actual response text); with Pterodactyl-only
// setups the command still runs but there is no response text to show, so
// check the result with /balance in-game instead.
app.post('/api/admin/test-console-command', requireAdmin, async (req, res) => {
  const command = String(req.body?.command || '').trim().slice(0, 200);
  if (!command) return res.status(400).json({ error: 'กรุณาใส่คำสั่งที่ต้องการทดสอบ' });
  if (!GAME_CONSOLE_ENABLED) {
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า RCON หรือ Pterodactyl บนเซิร์ฟเวอร์นี้' });
  }
  try {
    if (RCON_ENABLED) {
      const response = await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
      return res.json({ success: true, via: 'rcon', response: String(response || '').trim() || '(เซิร์ฟเวอร์ไม่ส่งข้อความตอบกลับ - แต่คำสั่งถูกส่งไปแล้ว ลองเช็คในเกม)' });
    }
    await sendPterodactylCommand(command);
    return res.json({
      success: true,
      via: 'pterodactyl',
      response: '(Pterodactyl ไม่ส่งข้อความตอบกลับมาให้ - คำสั่งถูกส่งไปแล้ว กรุณาเช็คผลด้วย /balance ในเกมแทน)'
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'รันคำสั่งไม่สำเร็จ - อาจเป็นเพราะคำสั่ง/ไวยากรณ์ผิด หรือเซิร์ฟเวอร์ออฟไลน์' });
  }
});

// ---- admin: look up a player account by username, reset password if lost ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const filter = {};
  if (search) {
    const escaped = search.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.usernameLower = { $regex: escaped };
  }
  const [users, total] = await Promise.all([
    db.users.find(filter)
      .sort({ createdAt: -1 })
      .limit(search ? 50 : 200)
      .toArray(),
    db.users.countDocuments(filter)
  ]);
  res.json({
    total,
    users: users.map(user => ({
      ...publicUser(user),
      createdAt: user.createdAt || ''
    }))
  });
});

// Admin-only website-title assignment. These labels are shown on profiles and
// the account bar; this endpoint never grants Minecraft ranks or admin/API
// permissions.
app.post('/api/admin/users/:id/title', requireAdmin, async (req, res) => {
  try {
    const titleId = String(req.body?.titleId || '').trim();
    if (!ACCOUNT_TITLES[titleId]) {
      return res.status(400).json({ error: 'ไม่พบฉายานี้ในระบบ' });
    }
    const updated = await db.users.findOneAndUpdate(
      { id: req.params.id },
      {
        $set: {
          titleId,
          titleUpdatedAt: new Date().toISOString()
        }
      },
      { returnDocument: 'after' }
    );
    const user = updated?.value || updated;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'เปลี่ยนฉายาไม่สำเร็จ' });
  }
});

// Manual credit correction - e.g. refunding a mistaken PlayerPoints
// redemption (that feature is instant/final by design, so this is the
// only way to undo one). delta can be negative to deduct instead.
app.post('/api/admin/users/:id/adjust-balance', requireAdmin, async (req, res) => {
  try {
    const delta = Math.trunc(Number(req.body?.delta));
    const reason = String(req.body?.reason || '').slice(0, 200);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนที่จะปรับ (ไม่เป็น 0)' });
    }
    const updated = await db.users.findOneAndUpdate(
      { id: req.params.id },
      { $inc: { balance: delta } },
      { returnDocument: 'after' }
    );
    const user = updated?.value || updated;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    console.log(`[admin] balance adjusted for ${user.username}: ${delta > 0 ? '+' : ''}${delta} (reason: ${reason || '-'}) -> new balance ${user.balance}`);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'ปรับยอดเครดิตไม่สำเร็จ' });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) return res.status(400).json({ error: passwordErr });
    const newHash = await hashPassword(newPassword);
    const result = await db.users.updateOne({ id: req.params.id }, { $set: { passwordHash: newHash } });
    if (!result.matchedCount) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'รีเซ็ตรหัสผ่านไม่สำเร็จ' });
  }
});

// Manually accept/revoke a player's Minecraft-ID binding. Mainly for
// servers without RCON configured (RCON_ENABLED === false), where
// /api/account/minecraft always saves the name as unverified and staff
// have to confirm by hand (e.g. after seeing the player in-game) - same
// idea as the auto-verify RCON already does, just triggered by a click
// here instead of a live /list check.
app.post('/api/admin/users/:id/minecraft-verify', requireAdmin, async (req, res) => {
  try {
    const verified = !!req.body?.verified;
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    if (verified && !user.minecraft) {
      return res.status(400).json({ error: 'บัญชีนี้ยังไม่ได้ผูกไอดี Minecraft ไว้ ไม่มีอะไรให้ยืนยัน' });
    }
    const updated = await db.users.findOneAndUpdate(
      { id: req.params.id },
      { $set: { minecraftVerified: verified } },
      { returnDocument: 'after' }
    );
    const result = updated?.value || updated;
    res.json({ success: true, user: publicUser(result) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'อัปเดตสถานะไม่สำเร็จ' });
  }
});

// Send a one-way message/notification to a specific player's account -
// mainly used to explain the reason behind an admin decision (rejected
// topup, cancelled resale listing, Minecraft-ID verification, etc.) but works
// for any free-text note staff want a player to see on their account page.
// `days` sets how long it stays visible (clamped to 1-30 days) before it's
// treated as expired and no longer shown to the player.
const MIN_MESSAGE_DAYS = 1;
const MAX_MESSAGE_DAYS = 30;
const DEFAULT_MESSAGE_DAYS = 7;
app.post('/api/admin/users/:id/message', requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 100) || 'ข้อความจากทีมงาน';
    const message = String(req.body?.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'กรุณากรอกเนื้อหาข้อความ' });
    let days = Math.round(Number(req.body?.days));
    if (!Number.isFinite(days)) days = DEFAULT_MESSAGE_DAYS;
    days = Math.max(MIN_MESSAGE_DAYS, Math.min(MAX_MESSAGE_DAYS, days));
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    const now = new Date();
    const notification = {
      id: 'NOTI-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.params.id,
      title, message,
      days,
      read: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * 86400000).toISOString()
    };
    await db.notifications.insertOne(notification);
    res.json({ success: true, notification: omitMongoId(notification) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ส่งข้อความไม่สำเร็จ' });
  }
});

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
  const shopItems = await db.shopItems.find({}).toArray();
  const shopItemById = Object.fromEntries(shopItems.map(i => [i.id, i]));
  res.json({
    orders: orders.map(o => ({
      ...omitMongoId(o),
      productLabel: o.productLabel || shopItemById[o.product]?.label || o.product,
      username: userById[o.userId]?.username || '(ไม่พบบัญชี)'
    }))
  });
});

// Manually (re)run the LuckPerms grant for an existing order - for orders
// placed while GAME_CONSOLE_ENABLED was off (staff were granting by hand),
// or to retry one that's stuck after a server/RCON hiccup. Does not touch
// the wallet - this only re-sends the in-game command.
app.post('/api/admin/orders/:id/grant', requireAdmin, async (req, res) => {
  const order = await db.orders.findOne({ id: req.params.id });
  if (!order) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อนี้' });
  const isRank = Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, order.product);
  const item = isRank ? null : await db.shopItems.findOne({ id: order.product });
  if (!isRank && !item) {
    return res.status(400).json({ error: 'ไม่พบการตั้งค่าการส่งสินค้านี้ (อาจถูกลบออกจากร้านค้าไปแล้ว หรือเป็นรายการ PlayerPoints รุ่นเก่า)' });
  }
  if (!GAME_CONSOLE_ENABLED) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเซิร์ฟเวอร์ (Pterodactyl API หรือ RCON) บนเว็บนี้' });
  }
  try {
    if (isRank) await grantLuckPermsRank(order.minecraft, order.product);
    else await grantShopItem(order.minecraft, item);
    const updated = await db.orders.findOneAndUpdate(
      { id: order.id },
      { $set: { status: isRank ? 'สำเร็จ (ติดยศอัตโนมัติแล้ว)' : `สำเร็จ (ส่ง${item.label}เข้าเกมแล้ว)` } },
      { returnDocument: 'after' }
    );
    res.json({ success: true, order: omitMongoId(updated?.value || updated || order) });
  } catch (err) {
    res.status(502).json({ error: `ส่งสินค้าไม่สำเร็จ: ${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}` });
  }
});

// Resolve a "รอตรวจสอบ" money-redeem order left over from an ambiguous
// giveRconMoney failure (see /api/money/redeem) - admin has manually
// checked the player's in-game balance and tells us which way it went.
// action 'confirm': money DID arrive - just relabel the order, no wallet
// change. action 'refund': money did NOT arrive - give the wallet credit
// back. Only valid on orders still sitting in the pending state, so this
// can't accidentally double-refund an order already resolved.
app.post('/api/admin/orders/:id/resolve', requireAdmin, async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['confirm', 'refund'].includes(action)) {
    return res.status(400).json({ error: 'action ต้องเป็น confirm หรือ refund' });
  }
  const order = await db.orders.findOne({ id: req.params.id });
  if (!order) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อนี้' });
  if (!String(order.status || '').startsWith('รอตรวจสอบ')) {
    return res.status(400).json({ error: 'ออเดอร์นี้ไม่ได้อยู่ในสถานะรอตรวจสอบ' });
  }

  if (action === 'refund') {
    await db.users.updateOne({ id: order.userId }, { $inc: { balance: order.price } });
  }

  const updated = await db.orders.findOneAndUpdate(
    { id: order.id },
    { $set: { status: action === 'confirm'
      ? 'สำเร็จ (แอดมินยืนยันว่าเข้าเกมแล้ว)'
      : 'คืนเครดิตแล้ว (แอดมินตรวจสอบแล้วว่าไม่เข้าเกม)' } },
    { returnDocument: 'after' }
  );
  res.json({ success: true, order: omitMongoId(updated?.value || updated || order) });
});

// ยศหายในเกม -> แอดมินลบ order เดิมของบัญชีนั้นเพื่อปลดล็อกให้ซื้อยศเดิมซ้ำได้อีกครั้ง
// (unique index บน orders(userId,product) คือตัวที่บล็อกการซื้อซ้ำ ลบ order แล้วก็ซื้อใหม่ได้ทันที)
app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const deleted = await db.orders.findOneAndDelete({ id: req.params.id });
  const order = deleted?.value || deleted;
  if (!order) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อนี้' });
  res.json({ success: true, order: omitMongoId(order) });
});

// ---- admin: manage the item-shop catalog (add/edit/delete without touching
// code or redeploying) ----
// The "command" field is a raw console command with {player} standing in
// for the buyer's Minecraft username - exactly like MONEY_GIVE_COMMAND_TEMPLATE
// above, so it works for ANY plugin's command syntax, not just vanilla
// /give (e.g. "give {player} minecraft:saddle 1", "crate give {player} vip 1",
// "eco give {player} 5000", "lp user {player} parent add trial 7d" ...).
app.get('/api/admin/shop-items', requireAdmin, async (req, res) => {
  const items = await db.shopItems.find({}).sort({ createdAt: 1 }).toArray();
  res.json({ items: items.map(omitMongoId) });
});

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw.map(f => String(f).trim()).filter(Boolean);
  return String(raw || '').split('\n').map(f => f.trim()).filter(Boolean);
}

app.post('/api/admin/shop-items', requireAdmin, async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const label = String(req.body?.label || '').trim();
    const icon = String(req.body?.icon || '📦').trim().slice(0, 8) || '📦';
    const price = Math.trunc(Number(req.body?.price));
    const commandTemplate = String(req.body?.commandTemplate || '').trim();
    // Optional - only needed if this item should be listable on the resale
    // board (that flow pulls the item back out of the seller first).
    const takeCommandTemplate = String(req.body?.takeCommandTemplate || '').trim();
    const features = parseFeatures(req.body?.features);
    const repeatable = req.body?.repeatable !== false;

    if (!id) return res.status(400).json({ error: 'กรุณาระบุ ID สินค้า (a-z, 0-9, _ เท่านั้น)' });
    if (!label) return res.status(400).json({ error: 'กรุณาระบุชื่อสินค้าที่จะแสดง' });
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'กรุณาระบุราคาที่ถูกต้อง (มากกว่า 0)' });
    if (!commandTemplate) return res.status(400).json({ error: 'กรุณาระบุคำสั่งที่จะส่งเข้าเกม (ใช้ {player} แทนชื่อผู้เล่น)' });
    if (Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, id)) {
      return res.status(409).json({ error: `ID "${id}" ชนกับยศในร้าน VIP กรุณาใช้ ID อื่น` });
    }

    const item = {
      id, label, icon, price, commandTemplate, takeCommandTemplate, features, repeatable,
      enabled: true,
      createdAt: new Date().toISOString()
    };
    await db.shopItems.insertOne(item);
    res.json({ success: true, item: omitMongoId(item) });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'มี ID สินค้านี้อยู่แล้ว กรุณาใช้ ID อื่น' });
    res.status(500).json({ error: err.message || 'เพิ่มสินค้าไม่สำเร็จ' });
  }
});

app.put('/api/admin/shop-items/:id', requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body?.label !== undefined) update.label = String(req.body.label).trim();
    if (req.body?.icon !== undefined) update.icon = String(req.body.icon).trim().slice(0, 8) || '📦';
    if (req.body?.price !== undefined) {
      const price = Math.trunc(Number(req.body.price));
      if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'ราคาต้องมากกว่า 0' });
      update.price = price;
    }
    if (req.body?.commandTemplate !== undefined) update.commandTemplate = String(req.body.commandTemplate).trim();
    if (req.body?.takeCommandTemplate !== undefined) update.takeCommandTemplate = String(req.body.takeCommandTemplate).trim();
    if (req.body?.features !== undefined) update.features = parseFeatures(req.body.features);
    if (req.body?.repeatable !== undefined) update.repeatable = !!req.body.repeatable;
    if (req.body?.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้อัปเดต' });

    const updated = await db.shopItems.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { returnDocument: 'after' }
    );
    const item = updated?.value || updated;
    if (!item) return res.status(404).json({ error: 'ไม่พบสินค้านี้' });
    res.json({ success: true, item: omitMongoId(item) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'แก้ไขสินค้าไม่สำเร็จ' });
  }
});

app.delete('/api/admin/shop-items/:id', requireAdmin, async (req, res) => {
  const deleted = await db.shopItems.findOneAndDelete({ id: req.params.id });
  const item = deleted?.value || deleted;
  if (!item) return res.status(404).json({ error: 'ไม่พบสินค้านี้' });
  res.json({ success: true, item: omitMongoId(item) });
});

// ---- admin: resale board config + moderation ----
app.get('/api/admin/resale/config', requireAdmin, (req, res) => {
  res.json({
    decayHours: gameSettings.resaleDecayHours,
    floorPercent: gameSettings.resaleFloorPercent
  });
});

app.post('/api/admin/resale/config', requireAdmin, async (req, res) => {
  try {
    const decayHours = Number(req.body?.decayHours);
    const floorPercent = Number(req.body?.floorPercent);
    if (!Number.isFinite(decayHours) || decayHours <= 0 || decayHours > 24 * 60) {
      return res.status(400).json({ error: 'ระยะเวลาลดราคาต้องเป็นชั่วโมง มากกว่า 0 และไม่เกิน 1440 (60 วัน)' });
    }
    if (!Number.isFinite(floorPercent) || floorPercent < 0 || floorPercent > 100) {
      return res.status(400).json({ error: 'ราคาต่ำสุดต้องเป็น % ระหว่าง 0-100' });
    }
    gameSettings.resaleDecayHours = decayHours;
    gameSettings.resaleFloorPercent = floorPercent;
    await db.settings.updateOne(
      { id: 'gameSettings' },
      { $set: { resaleDecayHours: decayHours, resaleFloorPercent: floorPercent } },
      { upsert: true }
    );
    res.json({ success: true, decayHours, floorPercent });
  } catch (err) {
    res.status(500).json({ error: err.message || 'บันทึกไม่สำเร็จ' });
  }
});

app.get('/api/admin/resale/listings', requireAdmin, async (req, res) => {
  const listings = await db.resaleListings.find({}).sort({ createdAt: -1 }).limit(300).toArray();
  const userIds = [...new Set(listings.flatMap(l => [l.sellerId, l.buyerId].filter(Boolean)))];
  const users = await db.users.find({ id: { $in: userIds } }).toArray();
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    listings: listings.map(l => ({
      ...omitMongoId(l),
      currentPrice: l.status === 'active' ? currentResalePrice(l) : (l.soldPrice ?? l.startPrice),
      sellerUsername: userById[l.sellerId]?.username || '(ไม่พบบัญชี)',
      buyerUsername: l.buyerId ? (userById[l.buyerId]?.username || '(ไม่พบบัญชี)') : ''
    }))
  });
});

// Admin force-cancels an active listing (moderation, e.g. price abuse or
// inappropriate item). No refund needed - active listings haven't taken
// anyone's credit yet (that only happens atomically at purchase time).
app.delete('/api/admin/resale/listings/:id', requireAdmin, async (req, res) => {
  const deleted = await db.resaleListings.findOneAndUpdate(
    { id: req.params.id, status: 'active' },
    { $set: { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledByAdmin: true } },
    { returnDocument: 'after' }
  );
  const listing = deleted?.value || deleted;
  if (!listing) return res.status(404).json({ error: 'ไม่พบรายการนี้ หรือไม่ใช่รายการที่กำลังลงขายอยู่' });
  res.json({ success: true });
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
  .then(() => loadGameSettings())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Mari JP SMP server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('FATAL: could not connect to MongoDB:', err.message);
    process.exit(1);
  });
