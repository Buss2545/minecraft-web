// Mari JP SMP - real backend starter
// - salted scrypt password hashing
// - session cookies persisted in MongoDB
// - accounts, wallet balances, orders, and top-ups persisted to MongoDB Atlas
// - /api/status proxies mcstatus.io so the browser never needs to hit a
//   third-party API directly (avoids CORS issues + keeps things simple)
'use strict';

const crypto = require('crypto');
const net = require('net');
const express = require('express');
const cookieParser = require('cookie-parser');
const { MongoClient, GridFSBucket } = require('mongodb');

// ---------- config ----------
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'mari_sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IS_PROD = process.env.NODE_ENV === 'production';
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || '';
const TIKTOK_OAUTH_SCOPES = 'user.info.basic,user.info.profile,user.info.stats';

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

// Credit transfer rules (admin-adjustable later).
const TRANSFER_MIN = 10;
const TRANSFER_MAX = 1000;
const TRANSFER_DAILY_MAX = 3000;
const TRANSFER_FEE_PERCENT = 0;
const TRANSFER_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

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
    repeatable: true
  },
  {
    id: 'ITEM_EMERALD',
    price: 15,
    label: 'มรกต x16',
    icon: '🟢',
    features: ['มรกต 16 ชิ้น', 'เหมาะสำหรับแลกกับชาวบ้าน'],
    commandTemplate: 'give {player} minecraft:emerald 16',
    repeatable: true
  },
  {
    id: 'ITEM_GOLDEN_APPLE',
    price: 25,
    label: 'แอปเปิลทอง x1',
    icon: '🍎',
    features: ['Golden Apple 1 ชิ้น', 'ไอเทมช่วยเอาตัวรอดในเกม'],
    commandTemplate: 'give {player} minecraft:golden_apple 1',
    repeatable: true
  }
];

// Promotion Mari (โปรโมชั่น มารี) catalog - a separate promotional item
// board, distinct from both the VIP rank shop and the regular Item SHOP.
// Same shape/behavior as DEFAULT_SHOP_ITEMS (DB-backed via db.promoItems,
// admin.html is the source of truth after first boot) but kept in its own
// collection and its own endpoints so promo items never mix with, overwrite,
// or get purchased through the regular Item SHOP catalog. Starts empty -
// add promotions any time from admin.html -> 🎁 โปรโมชั่น มารี.
//
// Any promo item can turn on assignUid (checkbox in admin.html) to give
// every purchase its own random serial number (1-9999999, unique per
// product - see generateUniquePromoUid) substituted into the command via
// {uid}, alongside {player} - e.g. to engrave it onto an item's display
// name. Not specific to any one item; usable for whatever promo needs it.
const DEFAULT_PROMO_ITEMS = [];

// ---- daily login calendar (ล็อกอินรับของรายวัน) ----
const DEFAULT_CHECKIN_REWARDS = Array.from({ length: 31 }, (_, i) => {
  const rotation = [
    { icon: '💎', label: 'เพชร', quantity: 2, commandTemplate: 'give {player} minecraft:diamond {quantity}' },
    { icon: '🟢', label: 'มรกต', quantity: 3, commandTemplate: 'give {player} minecraft:emerald {quantity}' },
    { icon: '🍎', label: 'แอปเปิลทอง', quantity: 1, commandTemplate: 'give {player} minecraft:golden_apple {quantity}' }
  ];
  const pick = rotation[i % rotation.length];
  return { day: i + 1, icon: pick.icon, label: pick.label, quantity: pick.quantity, commandTemplate: pick.commandTemplate };
});
const CHECKIN_MAX_QUANTITY_PER_DAY = 3;

function rankShopCatalog() {
  return Object.entries(SHOP_PRODUCTS).map(([id, price]) => ({ id, type: 'rank', price, label: id, icon: '👑', features: [], repeatable: false }));
}

async function itemShopCatalog() {
  const items = await db.shopItems.find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).toArray();
  return items.map(item => ({ id: item.id, type: 'item', price: item.price, label: item.label, icon: item.icon, features: item.features || [], repeatable: item.repeatable !== false, pullOnListing: !!item.pullOnListing }));
}

async function promoShopCatalog() {
  const items = await db.promoItems.find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).toArray();
  return items.map(item => ({ id: item.id, type: 'promo', price: item.price, label: item.label, icon: item.icon, features: item.features || [], repeatable: item.repeatable !== false, assignUid: !!item.assignUid }));
}

const POINTS_PER_BAHT = Number(process.env.POINTS_PER_BAHT || 1);
const MIN_POINTS_REDEEM_BAHT = 1;
const MAX_POINTS_REDEEM_BAHT = 100000;
const MONEY_PER_BAHT = Number(process.env.MONEY_PER_BAHT || 1000);
const MIN_MONEY_REDEEM_BAHT = 1;
const MAX_MONEY_REDEEM_COUNT_PER_DAY = Number(process.env.MAX_MONEY_REDEEM_COUNT_PER_DAY || 90);
const MAX_ACTIVE_RESALE_LISTINGS_PER_USER = Number(process.env.MAX_ACTIVE_RESALE_LISTINGS_PER_USER || 10);
const RESALE_SELLER_TITLE_IDS = ['trader', 'admin', 'creator'];
const RESALE_UNTRUSTED_MAX_PRICE = Number(process.env.RESALE_UNTRUSTED_MAX_PRICE || 7);
const MONEY_GIVE_COMMAND_TEMPLATE = process.env.MONEY_GIVE_COMMAND || 'economy give {player} {amount}';

function todayKeyBangkok() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function checkinTodayInfo() {
  const dayKeyBangkok = todayKeyBangkok();
  const [y, m, d] = dayKeyBangkok.split('-').map(Number);
  return { dayKeyBangkok, monthKey: `${y}-${String(m).padStart(2, '0')}`, dayOfMonth: d };
}

function checkinRewardForDay(day) {
  const found = (gameSettings.checkinRewards || []).find(r => Number(r.day) === Number(day));
  return found || { day, icon: '🎁', label: 'ไอเทม', quantity: 1 };
}

const DEFAULT_LUCKPERMS_GROUPS = { 'VIP': 'vip', 'VIP+': 'vipplus', 'MVP': 'megavip', 'MVP+': 'ultravip', 'LEGEND': 'legend' };
let LUCKPERMS_GROUPS = DEFAULT_LUCKPERMS_GROUPS;
if (process.env.LUCKPERMS_GROUPS) {
  try { LUCKPERMS_GROUPS = { ...DEFAULT_LUCKPERMS_GROUPS, ...JSON.parse(process.env.LUCKPERMS_GROUPS) }; }
  catch (e) { console.error('LUCKPERMS_GROUPS env var is not valid JSON - using built-in defaults instead:', e.message); }
}
const LUCKPERMS_DURATION = process.env.LUCKPERMS_DURATION || '';

// ---------- MongoDB connection ----------
let db = null;
let mongoClient = null;
let musicBucket = null;
let siteMediaBucket = null;
let chatMediaBucket = null;

async function ensureIndex(collection, keys, options = {}) {
  if (!collection) throw new Error('MongoDB collection is not configured');
  try {
    await collection.createIndex(keys, options);
  } catch (err) {
    if (err.code === 85 || err.code === 86) {
      const name = options.name || Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
      console.warn(`[db] index "${name}" definition changed - dropping and recreating`);
      await collection.dropIndex(name).catch(() => {});
      await collection.createIndex(keys, options);
    } else throw err;
  }
}

async function connectDB() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set. Configure MONGODB_URI on the Render backend.');
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const database = mongoClient.db();
  db = {
    users: database.collection('users'),
    orders: database.collection('orders'),
    topups: database.collection('topups'),
    chatRooms: database.collection('chatRooms'),
    chatMessages: database.collection('chatMessages'),
    chatMedia: database.collection('chatMedia'),
    musicTracks: database.collection('musicTracks'),
    musicFiles: database.collection('music.files'),
    raceMatches: database.collection('raceMatches'),
    wheelSpins: database.collection('wheelSpins'),
    settings: database.collection('settings'),
    shopItems: database.collection('shopItems'),
    promoItems: database.collection('promoItems'),
    resaleListings: database.collection('resaleListings'),
    notifications: database.collection('notifications'),
    creditTransfers: database.collection('creditTransfers'),
    sessions: database.collection('sessions'),
    loginAttempts: database.collection('loginAttempts'),
    checkins: database.collection('checkins'),
    chatReads: database.collection('chatReads'),
    moderationActions: database.collection('moderationActions'),
    eventConfigs: database.collection('eventConfigs'),
    eventResults: database.collection('eventResults'),
    chatGameRooms: database.collection('chatGameRooms'),
    chatGameMessages: database.collection('chatGameMessages'),
    chatGamePresence: database.collection('chatGamePresence'),
    chatGameEvents: database.collection('chatGameEvents'),
    chatGameNpcProgress: database.collection('chatGameNpcProgress'),
    chatGameNpcs: database.collection('chatGameNpcs'),
    chatGameAiMessages: database.collection('chatGameAiMessages'),
    chatGameUserAis: database.collection('chatGameUserAis'),
    chatGameAiNotes: database.collection('chatGameAiNotes'),
    rpgCharacters: database.collection('rpgCharacters'),
    coupons: database.collection('coupons'),
    couponRedemptions: database.collection('couponRedemptions'),
    auditLogs: database.collection('auditLogs'),
    mariMapPoints: database.collection('mariMapPoints'),
    tiktokAccounts: database.collection('tiktokAccounts'),
    tiktokOAuthStates: database.collection('tiktokOAuthStates'),
    supportTickets: database.collection('supportTickets'),
    eventForms: database.collection('eventForms'),
    eventFormSubmissions: database.collection('eventFormSubmissions'),
    playerReports: database.collection('playerReports'),
    achievements: database.collection('achievements'),
    userAchievements: database.collection('userAchievements')
  };
  musicBucket = new GridFSBucket(database, { bucketName: 'music' });
  siteMediaBucket = new GridFSBucket(database, { bucketName: 'siteMedia' });
  chatMediaBucket = new GridFSBucket(database, { bucketName: 'chatMedia' });
  await ensureIndex(db.users, { usernameLower: 1 }, { unique: true });
  await ensureIndex(db.users, { uid: 1 }, { unique: true, sparse: true });
  await ensureIndex(db.orders, { userId: 1, createdAt: -1 });
  await ensureIndex(db.orders, { userId: 1, product: 1 }, { unique: true, partialFilterExpression: { product: { $in: Object.keys(SHOP_PRODUCTS) } } });
  await ensureIndex(db.topups, { userId: 1, createdAt: -1 });
  await ensureIndex(db.topups, { status: 1, createdAt: -1 });
  await ensureIndex(db.chatRooms, { participantIds: 1, updatedAt: -1 });
  await ensureIndex(db.chatRooms, { directKey: 1 }, { unique: true, sparse: true });
  await ensureIndex(db.chatMessages, { roomId: 1, createdAt: 1 });
  await ensureIndex(db.chatGameAiMessages, { userId: 1, npcId: 1, createdAt: -1 });
  await ensureIndex(db.chatGameAiMessages, { userId: 1, aiId: 1, createdAt: -1 });
  await ensureIndex(db.chatGameUserAis, { userId: 1, createdAt: -1 });
  await ensureIndex(db.chatGameUserAis, { id: 1 }, { unique: true });
  await ensureIndex(db.chatGameAiNotes, { userId: 1, aiId: 1 }, { unique: true });
  await ensureIndex(db.rpgCharacters, { userId: 1 }, { unique: true });
  await ensureIndex(db.chatMedia, { id: 1 }, { unique: true });
  await ensureIndex(db.musicTracks, { active: 1, order: 1, uploadedAt: -1 });
  await ensureIndex(db.raceMatches, { status: 1, createdAt: -1 });
  await ensureIndex(db.raceMatches, { playerAId: 1, createdAt: -1 });
  await ensureIndex(db.raceMatches, { playerBId: 1, createdAt: -1 });
  await ensureIndex(db.wheelSpins, { userId: 1, createdAt: -1 });
  await ensureIndex(db.settings, { id: 1 }, { unique: true });
  await ensureIndex(db.shopItems, { id: 1 }, { unique: true });
  await ensureIndex(db.promoItems, { id: 1 }, { unique: true });
  await ensureIndex(db.resaleListings, { status: 1, createdAt: -1 });
  await ensureIndex(db.resaleListings, { sellerId: 1, createdAt: -1 });
  await ensureIndex(db.notifications, { userId: 1, createdAt: -1 });
  await ensureIndex(db.creditTransfers, { senderId: 1, createdAt: -1 });
  await ensureIndex(db.creditTransfers, { recipientId: 1, createdAt: -1 });
  await ensureIndex(db.creditTransfers, { id: 1 }, { unique: true });
  await ensureIndex(db.sessions, { expiresAt: 1 }, { expireAfterSeconds: 0 });
  await ensureIndex(db.loginAttempts, { resetAt: 1 }, { expireAfterSeconds: 0 });
  await ensureIndex(db.checkins, { userId: 1, dayKeyBangkok: 1 }, { unique: true });
  await ensureIndex(db.checkins, { userId: 1, monthKey: 1 });
  await ensureIndex(db.checkins, { status: 1, createdAt: -1 });
  await seedDefaultShopItems();
  await seedCheapStarterShopItems();
  await seedDefaultPromoItems();
  await backfillUserUids();
  console.log('Connected to MongoDB - data will now survive redeploys.');
}
