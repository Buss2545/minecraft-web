// Mari JP SMP - real backend starter
// - salted scrypt password hashing
// - session cookies (in-memory session store)
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
// A 31-slot calendar keyed by the REAL calendar day-of-month (1-31, Asia/
// Bangkok) - not a rolling N-day cycle. That means it naturally resets
// itself on the 1st of every month with no "start date" to configure or
// drift out of sync: today (day-of-month X) always maps to slot X, next
// month starts back at slot 1 on its own, and short months simply never
// reach their unused high slots (e.g. slot 31 sits idle in a 30-day
// month) - exactly the "วันนี้ถึง 30 แล้วเริ่ม 1-31 ใหม่ วนไปเรื่อยๆ" behavior
// that was asked for.
//
// Delivery: each day can have its own commandTemplate (raw console
// command, {player} and {quantity} get substituted - same convention as
// DEFAULT_SHOP_ITEMS' commandTemplate). If GAME_CONSOLE_ENABLED and a day
// has a command set, claiming that day sends it automatically, exactly
// like the Item SHOP. If a day has no command (blank), or the console
// isn't configured at all, the claim is saved as "รอแอดมินส่งของ" for
// staff to hand-deliver from admin.html instead - same graceful fallback
// the Item SHOP already uses.
const DEFAULT_CHECKIN_REWARDS = Array.from({ length: 31 }, (_, i) => {
  const rotation = [
    { icon: '💎', label: 'เพชร', quantity: 2, commandTemplate: 'give {player} minecraft:diamond {quantity}' },
    { icon: '🟢', label: 'มรกต', quantity: 3, commandTemplate: 'give {player} minecraft:emerald {quantity}' },
    { icon: '🍎', label: 'แอปเปิลทอง', quantity: 1, commandTemplate: 'give {player} minecraft:golden_apple {quantity}' }
  ];
  const pick = rotation[i % rotation.length];
  return { day: i + 1, icon: pick.icon, label: pick.label, quantity: pick.quantity, commandTemplate: pick.commandTemplate };
});
// Hard cap on quantity per day - "แจกไม่เกิน 2-3 ชิ้นต่อไอเทม" from the admin.
const CHECKIN_MAX_QUANTITY_PER_DAY = 3;

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
    repeatable: item.repeatable !== false,
    pullOnListing: !!item.pullOnListing
  }));
}

// Reads the live, admin-editable Promotion Mari catalog from MongoDB -
// same pattern as itemShopCatalog above, but from the separate
// db.promoItems collection so promotions can't collide with or be bought
// through the regular Item SHOP.
async function promoShopCatalog() {
  const items = await db.promoItems.find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).toArray();
  return items.map(item => ({
    id: item.id,
    type: 'promo',
    price: item.price,
    label: item.label,
    icon: item.icon,
    features: item.features || [],
    repeatable: item.repeatable !== false,
    assignUid: !!item.assignUid
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

// Today's info for the daily-login calendar, all derived from the real
// Asia/Bangkok calendar date - dayOfMonth (1-31) is which reward slot
// applies today, monthKey (YYYY-MM) is what scopes "days already claimed
// this month" so the calendar view resets itself on the 1st automatically.
function checkinTodayInfo() {
  const dayKeyBangkok = todayKeyBangkok(); // YYYY-MM-DD
  const [y, m, d] = dayKeyBangkok.split('-').map(Number);
  return { dayKeyBangkok, monthKey: `${y}-${String(m).padStart(2, '0')}`, dayOfMonth: d };
}

function checkinRewardForDay(day) {
  const found = (gameSettings.checkinRewards || []).find(r => Number(r.day) === Number(day));
  return found || { day, icon: '🎁', label: 'ไอเทม', quantity: 1 };
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
let siteMediaBucket = null;
let chatMediaBucket = null;

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
    throw new Error('MONGODB_URI is not set. Configure MONGODB_URI as a Cloudflare Worker secret before using the API.');
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
    checkins: database.collection('checkins'),
    chatReads: database.collection('chatReads'),
    moderationActions: database.collection('moderationActions'),
    eventConfigs: database.collection('eventConfigs'),
    eventResults: database.collection('eventResults'),
    // V18 Chat Game — separate from the main player/order collections.
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
  // Sparse so it doesn't choke on accounts that predate this feature
  // until backfillUserUids() (below) fills them in.
  await ensureIndex(db.users, { uid: 1 }, { unique: true, sparse: true });
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
  // One "last read" marker per user per room - lets the notification badge
  // survive a page refresh / different device, instead of resetting to 0
  // every time the tab reloads (the old client-only unread counter did).
  await ensureIndex(db.chatReads, { userId: 1, roomId: 1 }, { unique: true });
  await ensureIndex(db.coupons, { code: 1 }, { unique: true });
  await ensureIndex(db.couponRedemptions, { couponId: 1, userId: 1 }, { unique: true });
  await ensureIndex(db.auditLogs, { createdAt: -1 });
  await ensureIndex(db.auditLogs, { actorId: 1, createdAt: -1 });
  await ensureIndex(db.moderationActions, { userId: 1, createdAt: -1 });
  await ensureIndex(db.moderationActions, { action: 1, createdAt: -1 });
  // Sessions now live in Mongo (not an in-memory Map) so a Render redeploy
  // no longer force-logs-out every user. expiresAt is a TTL index: Mongo
  // auto-deletes the doc the moment it's in the past, so expired sessions
  // clean themselves up with no cron job needed.
  await ensureIndex(db.sessions, { expiresAt: 1 }, { expireAfterSeconds: 0 });
  // Same reasoning as sessions above: an in-memory Map for auth rate
  // limiting only limits requests landing on the exact same Worker
  // isolate. Cloudflare runs many isolates across many edge locations, so
  // a Map-based limiter is trivially bypassed by hitting a different
  // isolate/region and gives a false sense of protection. Backed by Mongo
  // instead, with a TTL index so old windows clean themselves up.
  await ensureIndex(db.loginAttempts, { resetAt: 1 }, { expireAfterSeconds: 0 });
  // Blocks a second claim the same real calendar day - this IS the "รับได้
  // วันละครั้ง" enforcement, not just a query-speed optimization.
  await ensureIndex(db.checkins, { userId: 1, dayKeyBangkok: 1 }, { unique: true });
  await ensureIndex(db.checkins, { userId: 1, monthKey: 1 } );
  await ensureIndex(db.checkins, { status: 1, createdAt: -1 });
  await seedDefaultShopItems();
  await seedCheapStarterShopItems();
  await seedDefaultPromoItems();
  await backfillUserUids();
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

// A handful of cheap (฿1-5) starter items, added to an *existing* item-shop
// catalog so sites that already have the diamond/emerald/golden-apple set
// (from seedDefaultShopItems above) still get some low-price options. This
// runs once ever - guarded by a flag in db.settings, not by "is the
// collection empty" - so it never re-adds an item an admin deliberately
// deleted from admin.html afterwards.
const CHEAP_STARTER_SHOP_ITEMS = [
  {
    id: 'ITEM_STICK',
    price: 1,
    label: 'ไม้ (Stick) x4',
    icon: '🥢',
    features: ['ไม้ 4 ชิ้น', 'ราคาประหยัดที่สุดในร้าน'],
    commandTemplate: 'give {player} minecraft:stick 4',
    repeatable: true
  },
  {
    id: 'ITEM_APPLE',
    price: 1,
    label: 'แอปเปิล x3',
    icon: '🍏',
    features: ['แอปเปิล 3 ชิ้น', 'ใช้ทำอาหารหรือเติมความหิว'],
    commandTemplate: 'give {player} minecraft:apple 3',
    repeatable: true
  },
  {
    id: 'ITEM_TORCH',
    price: 2,
    label: 'คบเพลิง x16',
    icon: '🔥',
    features: ['คบเพลิง 16 อัน', 'จุดไฟส่องทางกันมอนสเตอร์'],
    commandTemplate: 'give {player} minecraft:torch 16',
    repeatable: true
  },
  {
    id: 'ITEM_BREAD',
    price: 3,
    label: 'ขนมปัง x4',
    icon: '🍞',
    features: ['ขนมปัง 4 ก้อน', 'เติมความหิวได้เยอะกว่าแอปเปิล'],
    commandTemplate: 'give {player} minecraft:bread 4',
    repeatable: true
  },
  {
    id: 'ITEM_ARROW',
    price: 5,
    label: 'ลูกธนู x16',
    icon: '🏹',
    features: ['ลูกธนู 16 ดอก', 'ใช้คู่กับธนูหรือหน้าไม้'],
    commandTemplate: 'give {player} minecraft:arrow 16',
    repeatable: true
  }
];

async function seedCheapStarterShopItems() {
  const flag = await db.settings.findOne({ id: 'cheapStarterShopItemsSeeded' });
  if (flag) return;
  const now = new Date().toISOString();
  for (const item of CHEAP_STARTER_SHOP_ITEMS) {
    try {
      await db.shopItems.insertOne({ ...item, enabled: true, createdAt: now });
    } catch (err) {
      if (err?.code !== 11000) throw err; // id already exists - fine, skip it
    }
  }
  await db.settings.updateOne(
    { id: 'cheapStarterShopItemsSeeded' },
    { $set: { id: 'cheapStarterShopItemsSeeded', seededAt: now } },
    { upsert: true }
  );
  console.log('[db] seeded cheap starter item-shop products (stick/apple/torch/bread/arrow, ฿1-5)');
}

// Same one-time-seed pattern as seedDefaultShopItems, for Promotion Mari.
// DEFAULT_PROMO_ITEMS starts empty, so this is a no-op until an admin adds
// promotions from admin.html - kept here purely for symmetry/future use.
async function seedDefaultPromoItems() {
  if (!DEFAULT_PROMO_ITEMS.length) return;
  const count = await db.promoItems.countDocuments();
  if (count > 0) return;
  const now = new Date().toISOString();
  await db.promoItems.insertMany(DEFAULT_PROMO_ITEMS.map(item => ({ ...item, enabled: true, createdAt: now })));
  console.log('[db] seeded default Promotion Mari catalog');
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
  resaleFloorPercent: DEFAULT_RESALE_FLOOR_PERCENT,
  checkinRewards: DEFAULT_CHECKIN_REWARDS.map(r => ({ ...r }))
};

// ---------- editable homepage, activities, and Japan weather ----------
// These settings are intentionally kept in MongoDB so homepage changes
// survive restarts and redeploys. Images are stored in GridFS instead of
// inside the settings document, avoiding MongoDB's 16 MB document limit.
const DEFAULT_SITE_SETTINGS = {
  id: 'siteSettings',
  globalUi: {
    musicBarEnabled: true,
    hideButtonEnabled: true,
    restoreButtonEnabled: true,
    rememberHidden: true,
    hideButtonLabel: '×',
    restoreButtonLabel: '🎵 แสดงเพลง'
  },
  home: {
    eyebrow: '⛏️ MINECRAFT SERVER',
    title: 'MARI',
    siteName: 'MARI JP SMP',
    subtitle: 'SURVIVAL • SMP • COMMUNITY',
    announcement: 'ยินดีต้อนรับสู่ Mari JP SMP — มาเล่นด้วยกันนะ 🌸',
    heroImageUrl: '',
    accent: '#ee7fa5'
  },
  discord: {
    label: 'Discord',
    subtitle: 'ชุมชน'
  },
  promo: {
    heading: 'โปรโมชั่นเด่น',
    subtitle: 'ไอเทม กิจกรรมและดาบพิเศษ',
    title: 'Mari PVP VIPP',
    buttonLabel: 'รายละเอียด',
    buttonUrl: '',
    imageUrl: ''
  },
  weather: {
    enabled: true,
    locationLabel: 'Tokyo, Japan',
    effectIntensity: 1
  },
  navigation: [
    { id: 'home', label: 'หน้าหลัก', icon: '🏠', target: '/index.html', enabled: true, order: 1 },
    { id: 'server', label: 'เซิร์ฟเวอร์', icon: '🖥️', target: '/index.html#server', enabled: true, order: 2 },
    { id: 'topup', label: 'เติมเงิน', icon: '💰', target: '/topup.html', enabled: true, order: 3 },
    { id: 'promo', label: 'โปรโมชั่น', icon: '🎁', target: '/promo.html', enabled: true, order: 4 },
    { id: 'vip', label: 'VIP', icon: '👑', target: '/vip.html', enabled: true, order: 5 },
    { id: 'rules', label: 'กฎ', icon: '📜', target: '/rules.html', enabled: true, order: 6 },
    { id: 'team', label: 'ทีมงาน', icon: '👥', target: '/team.html', enabled: true, order: 7 },
    { id: 'discord', label: 'Discord', icon: '💬', target: '/index.html#discord', enabled: true, order: 8 },
    { id: 'chat', label: 'แชท', icon: '💬', target: '/chat.html', enabled: true, order: 9 },
    { id: 'minigames', label: 'มินิเกม', icon: '🎮', target: '/minigames.html', enabled: true, order: 10 },
    { id: 'namecolor', label: 'สีชื่อ', icon: '🎨', target: '/namecolor.html', enabled: true, order: 11 }
  ]
};

let siteSettings = JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS));
let japanWeatherCache = { at: 0, data: null };

function publicSiteSettings() {
  return {
    globalUi: {
      musicBarEnabled: siteSettings.globalUi?.musicBarEnabled !== false,
      hideButtonEnabled: siteSettings.globalUi?.hideButtonEnabled !== false,
      restoreButtonEnabled: siteSettings.globalUi?.restoreButtonEnabled !== false,
      rememberHidden: siteSettings.globalUi?.rememberHidden !== false,
      hideButtonLabel: cleanSiteText(siteSettings.globalUi?.hideButtonLabel, 30) || DEFAULT_SITE_SETTINGS.globalUi.hideButtonLabel,
      restoreButtonLabel: cleanSiteText(siteSettings.globalUi?.restoreButtonLabel, 60) || DEFAULT_SITE_SETTINGS.globalUi.restoreButtonLabel
    },
    home: {
      eyebrow: siteSettings.home.eyebrow,
      title: siteSettings.home.title,
      siteName: siteSettings.home.siteName,
      subtitle: siteSettings.home.subtitle,
      announcement: siteSettings.home.announcement,
      heroImageUrl: siteSettings.home.heroImageUrl || '',
      accent: siteSettings.home.accent
    },
    discord: {
      label: siteSettings.discord.label,
      subtitle: siteSettings.discord.subtitle
    },
    promo: {
      heading: siteSettings.promo.heading,
      subtitle: siteSettings.promo.subtitle,
      title: siteSettings.promo.title,
      buttonLabel: siteSettings.promo.buttonLabel,
      buttonUrl: siteSettings.promo.buttonUrl,
      imageUrl: siteSettings.promo.imageUrl || ''
    },
    navigation: (siteSettings.navigation || [])
      .filter(item => item && item.enabled !== false)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map(item => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        target: item.target
      })),
    weather: { ...siteSettings.weather }
  };
}

async function loadSiteSettings() {
  const doc = await db.settings.findOne({ id: 'siteSettings' });
  if (!doc) return;
  if (doc.globalUi && typeof doc.globalUi === 'object') {
    siteSettings.globalUi = { ...siteSettings.globalUi, ...doc.globalUi };
  }
  if (doc.home && typeof doc.home === 'object') {
    siteSettings.home = { ...siteSettings.home, ...doc.home };
  }
  if (doc.weather && typeof doc.weather === 'object') {
    siteSettings.weather = { ...siteSettings.weather, ...doc.weather };
  }
  if (doc.discord && typeof doc.discord === 'object') {
    siteSettings.discord = { ...siteSettings.discord, ...doc.discord };
  }
  if (doc.promo && typeof doc.promo === 'object') {
    siteSettings.promo = { ...siteSettings.promo, ...doc.promo };
  }
  if (Array.isArray(doc.navigation)) {
    const savedById = new Map(doc.navigation
      .filter(item => item && item.id)
      .map((item, index) => [String(item.id), {
        ...item,
        order: Number(item.order || index + 1)
      }]));
    const builtIn = DEFAULT_SITE_SETTINGS.navigation.map((item, index) => ({
      ...item,
      ...(savedById.get(item.id) || {}),
      order: savedById.has(item.id)
        ? Number(savedById.get(item.id).order || index + 1)
        : Math.max(...[...savedById.values()].map(saved => Number(saved.order) || 0), 0) + index + 1
    }));
    const custom = [...savedById.values()]
      .filter(item => !DEFAULT_SITE_SETTINGS.navigation.some(defaultItem => defaultItem.id === item.id))
      .map((item, index) => ({ ...item, order: Number(item.order || builtIn.length + index + 1) }));
    siteSettings.navigation = [...builtIn, ...custom]
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({ ...item, order: index + 1 }));
  }
}

// ---------- generic per-page website editor (admin.html -> 🎨 แก้ไขเว็บ) ----------
// Same idea/UX as the 🏠 หน้าแรก/กิจกรรม editor above, generalized to every
// public page: an admin can set an eyebrow/title/subtitle, upload a banner
// image, and add an optional CTA button for promo.html and the rest -
// no raw code, just the same structured fields as the homepage hero.
// Stored as one document (id: 'pageEditor') in MongoDB, cached in memory,
// and served publicly (minus the admin key) so each page can fetch its own
// banner on load and render it client-side.
const PAGE_EDITOR_PAGES = ['index', 'promo', 'vip', 'rules', 'team', 'topup', 'minigames', 'chat', 'auth'];

function defaultPageBanner() {
  return { eyebrow: '', title: '', subtitle: '', bannerImageUrl: '', bannerImageId: '', buttonLabel: '', buttonUrl: '', enabled: true, authTitle: 'Mari JP SMP', authSubtitle: 'เข้าสู่ระบบเพื่อไปต่อ', accent: '#ee7fa5', backgroundImageUrl: '', backgroundImageId: '', animation: 'float', animationIntensity: 1, glass: true, particles: true };
}

let pageEditorSettings = Object.fromEntries(
  PAGE_EDITOR_PAGES.map(page => [page, defaultPageBanner()])
);

async function loadPageEditorSettings() {
  const doc = await db.settings.findOne({ id: 'pageEditor' });
  if (!doc || !doc.pages || typeof doc.pages !== 'object') return;
  for (const page of PAGE_EDITOR_PAGES) {
    const saved = doc.pages[page];
    if (saved && typeof saved === 'object') {
      pageEditorSettings[page] = { ...defaultPageBanner(), ...saved };
    }
  }
}

function publicPageBanner(page) {
  const p = pageEditorSettings[page] || defaultPageBanner();
  return {
    eyebrow: p.eyebrow, title: p.title, subtitle: p.subtitle,
    bannerImageUrl: p.bannerImageUrl || '',
    buttonLabel: p.buttonLabel, buttonUrl: cleanPageLink(p.buttonUrl),
    enabled: p.enabled !== false,
    ...(page === 'auth' ? {
      authTitle: cleanSiteText(p.authTitle, 100) || 'Mari JP SMP',
      authSubtitle: cleanSiteText(p.authSubtitle, 180) || 'เข้าสู่ระบบเพื่อไปต่อ',
      accent: /^#[0-9a-fA-F]{6}$/.test(String(p.accent||'')) ? p.accent : '#ee7fa5',
      backgroundImageUrl: p.backgroundImageUrl || '',
      animation: ['none','float','glow','particles','float-glow'].includes(p.animation) ? p.animation : 'float',
      animationIntensity: clamp(Number(p.animationIntensity) || 1, 0, 2),
      glass: p.glass !== false,
      particles: p.particles !== false
    } : {})
  };
}

// ---------- content editing for every page (admin.html -> 🏠 หน้าแรก/กิจกรรม -> 🌐 แก้ไขทุกหน้า) ----------
// Per page: replace any text or image, hide original cards, add extra blocks (card / text /
// banner), plus one announcement bar for all pages. Stored as one MongoDB document
// ({ id: 'pageContent' }), cached in memory, served to visitors by GET /api/site/pages and
// applied in the browser by page-blocks.js. (The banner at the top of each page is separate:
// see pageEditorSettings above.)
const PAGE_CONTENT_IDS = ['index', 'promo', 'vip', 'rules', 'team', 'topup', 'minigames'];
const PAGE_BLOCK_TYPES = new Set(['card', 'text', 'banner']);
const DEFAULT_PAGE_CONTENT = {
  global: { banner: { enabled: false, text: '', url: '', color: '#ee7fa5' } },
  pages: {}
};
let pageContent = JSON.parse(JSON.stringify(DEFAULT_PAGE_CONTENT));

// Links: https://..., internal /page or #anchor, or a bare domain (gets https://). Nothing else
// (javascript:, data:, //host) is ever stored or served.
function cleanPageLink(value) {
  const s = cleanSiteText(value, 500);
  if (!s) return '';
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  if (/^\/(?!\/)\S*$/.test(s) || /^#[A-Za-z0-9_-]+$/.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#]\S*)?$/i.test(s)) return 'https://' + s;
  return '';
}

// Images: one uploaded through the admin (/api/site/media/<id>) or any https:// image.
function cleanPageImageUrl(value) {
  const s = cleanSiteText(value, 500);
  if (/^\/api\/site\/media\/[A-Za-z0-9_-]+$/.test(s)) return s;
  if (/^https:\/\/\S+$/i.test(s)) return s;
  return '';
}

function ownImageId(url) {
  const m = String(url || '').match(/^\/api\/site\/media\/([A-Za-z0-9_-]+)$/);
  return m ? m[1] : '';
}

function cleanPageBlock(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanSiteText(raw.title, 120);
  const body = cleanSiteText(raw.body, 2000);
  const imageUrl = cleanPageImageUrl(raw.imageUrl);
  if (!title && !body && !imageUrl) return null; // an empty block is not saved
  const idRaw = String(raw.id || '');
  const id = /^[A-Za-z0-9_-]{1,50}$/.test(idRaw)
    ? idRaw
    : 'blk-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + index;
  return {
    id,
    type: PAGE_BLOCK_TYPES.has(raw.type) ? raw.type : 'card',
    position: raw.position === 'bottom' ? 'bottom' : 'top',
    title,
    body,
    imageUrl,
    imageId: ownImageId(imageUrl),
    buttonLabel: cleanSiteText(raw.buttonLabel, 60),
    buttonUrl: cleanPageLink(raw.buttonUrl),
    enabled: raw.enabled !== false
  };
}

function cleanPageContent(input) {
  const src = input && typeof input === 'object' ? input : {};
  const b = (src.global && src.global.banner) || {};
  const global = {
    banner: {
      enabled: b.enabled === true,
      text: cleanSiteText(b.text, 200),
      url: cleanPageLink(b.url),
      color: /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color) : '#ee7fa5'
    }
  };
  const pages = {};
  for (const id of PAGE_CONTENT_IDS) {
    const raw = src.pages && src.pages[id];
    if (!raw || typeof raw !== 'object') continue;
    const blocks = [];
    (Array.isArray(raw.blocks) ? raw.blocks : []).slice(0, 30).forEach((rawBlock, i) => {
      const block = cleanPageBlock(rawBlock, i);
      if (block) blocks.push(block);
    });
    const hiddenItems = [...new Set((Array.isArray(raw.hiddenItems) ? raw.hiddenItems : [])
      .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 200))]
      .sort((x, y) => x - y).slice(0, 100);
    // Text replacements: "when the page shows exactly <from>, show <to> instead".
    const textEdits = [];
    const seenText = new Set();
    for (const e of (Array.isArray(raw.textEdits) ? raw.textEdits : []).slice(0, 600)) {
      const from = cleanSiteText(e && e.from, 300).replace(/\s+/g, ' ');
      const to = cleanSiteText(e && e.to, 600);
      if (!from || !to || from === to || seenText.has(from)) continue;
      seenText.add(from);
      textEdits.push({ from, to });
    }
    // Image replacements: "the image whose fingerprint is <key> becomes <url>".
    const imageEdits = [];
    const seenKeys = new Set();
    for (const e of (Array.isArray(raw.imageEdits) ? raw.imageEdits : []).slice(0, 100)) {
      const key = cleanSiteText(e && e.key, 260);
      const url = cleanPageImageUrl(e && e.url);
      if (!key || !url || seenKeys.has(key)) continue;
      seenKeys.add(key);
      imageEdits.push({ key, url, imageId: ownImageId(url) });
    }
    pages[id] = {
      hideBuiltIn: raw.hideBuiltIn === true,
      hiddenItems,
      columns: clamp(Math.round(Number(raw.columns) || 2), 1, 3),
      textEdits,
      imageEdits,
      blocks
    };
  }
  return { global, pages };
}

function collectPageImageIds(content) {
  const ids = new Set();
  for (const page of Object.values((content && content.pages) || {})) {
    for (const block of page.blocks || []) if (block.imageId) ids.add(block.imageId);
    for (const edit of page.imageEdits || []) if (edit.imageId) ids.add(edit.imageId);
  }
  return ids;
}

// What visitors get: only enabled blocks, and no internal image ids.
function publicPageContent() {
  const pages = {};
  for (const [id, p] of Object.entries(pageContent.pages || {})) {
    pages[id] = {
      hideBuiltIn: p.hideBuiltIn,
      hiddenItems: p.hiddenItems,
      columns: p.columns,
      textEdits: p.textEdits || [],
      imageEdits: (p.imageEdits || []).map(({ key, url }) => ({ key, url })),
      blocks: (p.blocks || []).filter(x => x.enabled !== false).map(({ imageId, ...rest }) => rest)
    };
  }
  return { global: pageContent.global, pages };
}

async function loadPageContent() {
  const doc = await db.settings.findOne({ id: 'pageContent' });
  if (doc) pageContent = cleanPageContent(doc);
}

// ---------- page loading screen (admin: /loading-studio.html) ----------
// One MongoDB document ({ id: 'loader' }) describing the loading animation every public page
// shows while it loads. enabled=false (the default) keeps the built-in one. Visitors read it
// from GET /api/loader (see loader-runtime.js); only the admin can change it.
const LOADER_PRESETS = ['bathtub', 'slime', 'portal', 'boba', 'neon', 'sakura', 'custom'];
const LOADER_THEMES = new Set(['warm', 'pastel', 'sky', 'matcha', 'sunset', 'dark', 'custom']);
const DEFAULT_LOADER = {
  enabled: false,
  preset: 'slime',
  title: 'กำลังโหลด Mari JP SMP...',
  subtitle: 'โปรดรอสักครู่ ระบบกำลังเตรียมข้อมูลให้คุณ',
  tag: 'MARI SMP LOADING',
  titleJp: 'Mari JP SMPを読み込み中...',
  subtitleJp: 'しばらくお待ちください。ただいま準備中です',
  tagJp: 'MARI SMP LOADING',
  theme: 'warm',
  bg: '#fff6fa',
  accent: '#ee7fa5',
  text: '#2b2026',
  speed: 1,
  showBar: true,
  showPercent: true,
  particles: true,
  minMs: 900,
  oncePerSession: false,
  imageUrl: '',
  imageId: '',
  updatedAt: ''
};
let loaderSettings = { ...DEFAULT_LOADER };

function cleanLoader(input, updatedAt) {
  const s = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_LOADER;
  const hex = (v, def) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : def);
  const num = (v, min, max, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const text = (v, max, def) => (v === undefined || v === null ? def : cleanSiteText(v, max));
  const imageUrl = cleanPageImageUrl(s.imageUrl);
  return {
    enabled: s.enabled === true,
    preset: LOADER_PRESETS.includes(s.preset) ? s.preset : d.preset,
    title: text(s.title, 80, d.title),
    subtitle: text(s.subtitle, 140, d.subtitle),
    tag: text(s.tag, 40, d.tag),
    titleJp: text(s.titleJp, 80, d.titleJp),
    subtitleJp: text(s.subtitleJp, 140, d.subtitleJp),
    tagJp: text(s.tagJp, 40, d.tagJp),
    theme: LOADER_THEMES.has(s.theme) ? s.theme : 'custom',
    bg: hex(s.bg, d.bg),
    accent: hex(s.accent, d.accent),
    text: hex(s.text, d.text),
    speed: Math.round(num(s.speed, 0.4, 2.5, 1) * 10) / 10,
    showBar: s.showBar !== false,
    showPercent: s.showPercent !== false,
    particles: s.particles !== false,
    minMs: Math.round(num(s.minMs, 0, 6000, d.minMs)),
    oncePerSession: s.oncePerSession === true,
    imageUrl,
    imageId: ownImageId(imageUrl),
    updatedAt: updatedAt || ''
  };
}

function publicLoader() {
  const { imageId, ...rest } = loaderSettings;
  return rest;
}

async function loadLoaderSettings() {
  const doc = await db.settings.findOne({ id: 'loader' });
  if (doc) loaderSettings = cleanLoader(doc, String(doc.updatedAt || ''));
}

// ---------- Japanese translations typed by the admin (admin.html -> 🇯🇵 ภาษาญี่ปุ่น) ----------
// Everything an admin types in Thai (announcement, activities, banners, blocks, shop items...) has
// no built-in Japanese. The admin lists "Thai text -> Japanese" pairs here; the public pages load
// them from GET /api/site/i18n and i18n-jp.js swaps the text when a visitor reads Japanese.
// Stored as an array of {th, jp} in one document ({ id: 'i18nCustom' }) - Thai text can not be
// used as MongoDB field names safely, so it is never a key.
let i18nCustom = [];

function cleanI18nEntries(input) {
  const src = Array.isArray(input) ? input
    : (input && typeof input === 'object')
      ? Object.entries(input).map(([th, jp]) => ({ th, jp }))
      : [];
  const seen = new Set();
  const out = [];
  for (const e of src.slice(0, 3000)) {
    const th = cleanSiteText(e && e.th, 300).replace(/\s+/g, ' ');
    const jp = cleanSiteText(e && e.jp, 600);
    if (!th || !jp || seen.has(th)) continue;
    seen.add(th);
    out.push({ th, jp });
  }
  return out;
}

function i18nExactMap() {
  return Object.fromEntries(i18nCustom.map(e => [e.th, e.jp]));
}

async function loadI18nCustom() {
  const doc = await db.settings.findOne({ id: 'i18nCustom' });
  if (doc) i18nCustom = cleanI18nEntries(doc.entries);
}

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
  if (Array.isArray(doc.checkinRewards) && doc.checkinRewards.length) {
    gameSettings.checkinRewards = doc.checkinRewards;
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

// ---------- sessions (persisted in MongoDB) ----------
// sessionId -> { userId, createdAt, expiresAt }, stored in db.sessions.
// This used to be an in-memory Map, which meant every Render redeploy (or
// even the free plan spinning the process down after idling) wiped every
// logged-in user's session and force-logged them out. Storing sessions in
// Mongo alongside everything else means they survive restarts; the TTL
// index on expiresAt (see connectDB) handles cleanup automatically.
async function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  await db.sessions.insertOne({
    id,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS)
  });
  return id;
}

async function destroySession(id) {
  await db.sessions.deleteOne({ id });
}

async function getSession(req) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (!id) return null;
  const session = await db.sessions.findOne({ id });
  if (!session) return null;
  return { id, userId: session.userId, createdAt: session.createdAt };
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
// most obvious brute-force scripts. Backed by Mongo (not an in-memory
// Map) because Cloudflare Workers runs many isolates across many edge
// locations - a Map only ever sees requests that happen to land on the
// same isolate, so it would let a distributed script through.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

async function rateLimit(req, res, next) {
  try {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const result = await db.loginAttempts.findOneAndUpdate(
      { ip, resetAt: { $gt: now } },
      { $inc: { count: 1 }, $setOnInsert: { ip, resetAt: now + RATE_LIMIT_WINDOW_MS } },
      { upsert: true, returnDocument: 'after' }
    );
    const doc = result?.value || result;
    if (doc && doc.count > RATE_LIMIT_MAX) {
      return res.status(429).json({ error: 'พยายามมากเกินไป กรุณาลองใหม่ภายหลัง' });
    }
    next();
  } catch (err) {
    // If the rate-limit check itself fails (e.g. transient DB hiccup),
    // fail open rather than locking every visitor out of login/register.
    console.error('rateLimit error:', err.message);
    next();
  }
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

// A user counts as "online" if we've seen a request from their session within
// this window. lastActiveAt is refreshed opportunistically in requireAuth.
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
function isUserOnline(user) {
  if (!user || !user.lastActiveAt) return false;
  return (Date.now() - new Date(user.lastActiveAt).getTime()) < ONLINE_THRESHOLD_MS;
}

function publicUser(user) {
  const displayName = user.displayName || user.username;
  const titleId = ACCOUNT_TITLES[user.titleId] ? user.titleId : 'member';
  const title = ACCOUNT_TITLES[titleId];
  return {
    id: user.id,
    uid: user.uid || null,
    username: user.username,
    displayName,
    displayNameChangedAt: user.displayNameChangedAt || null,
    avatarUrl: user.avatarUrl || '',
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
    .replace(/\{player\}/g, username)
    .replace(/\{amount\}/g, String(amount));
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
// before any credit is touched. `vars` are extra {placeholder} substitutions
// beyond {player} - currently only {uid} for Promotion Mari items that have
// assignUid enabled (see generateUniquePromoUid).
async function grantShopItem(username, item, vars = {}) {
  if (!item || !item.commandTemplate) {
    throw new Error('ไม่พบคำสั่งส่งสินค้านี้เข้าเกม');
  }
  let command = item.commandTemplate.replace(/\{player\}/g, username);
  for (const [key, value] of Object.entries(vars)) {
    command = command.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return runConsoleCommand(command);
}

// Keywords that show up in common plugins' console output when a "take/
// remove" command finds nothing to remove (player doesn't actually have
// the item, wrong item id, etc). This list is necessarily a best-effort
// guess since every plugin phrases it differently - ExecutableItems'
// own "/ei take" wording hasn't been captured here, so if pulls are
// going through even when a player doesn't have the item (or the
// opposite - always getting rejected even when they do), tell an admin
// to run "/ei take <name> <id>" by hand in the Pterodactyl console and
// paste back the exact failure text so this list can be tightened.
const TAKE_FAILURE_KEYWORDS = /don'?t have|doesn'?t have|does not have|not found|no such|unable to find|0 (of|item)|insufficient|player.*offline/i;

// Attempts to physically remove one of `item` from `username`'s live
// inventory - used when listing a resale item that has pullOnListing
// enabled (see admin shop-items endpoints). Unlike grantShopItem/
// runConsoleCommand, this ALWAYS goes over RCON (never Pterodactyl),
// because Pterodactyl's command API is fire-and-forget and never returns
// output - with no way to read the result back, we'd have no way to tell
// a successful pull from a silent no-op, which risks duplicating items
// (player keeps the item AND a resale listing gets posted for it).
// Returns { success, detail }. Never throws for "the command ran but the
// item wasn't there" - only throws for connection-level failures.
async function pullShopItemFromPlayer(username, item) {
  if (!RCON_ENABLED) {
    throw new Error('สินค้านี้ต้องตั้งค่า RCON (ไม่ใช่แค่ Pterodactyl) ถึงจะลงขายต่อแบบดึงของจริงได้ เพราะต้องอ่านผลลัพธ์คำสั่งกลับมายืนยัน');
  }
  if (!item.takeCommandTemplate) {
    throw new Error('ไม่พบคำสั่งดึงคืนของสินค้านี้ (takeCommandTemplate)');
  }
  const command = item.takeCommandTemplate.replace(/\{player\}/g, username);
  const result = await rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
  const detail = typeof result === 'string' ? result.trim() : '';
  if (TAKE_FAILURE_KEYWORDS.test(detail)) {
    return { success: false, detail: detail || 'คำสั่งดึงคืนถูกปฏิเสธ' };
  }
  return { success: true, detail };
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

// ---------- app ----------
const app = express();
app.set('trust proxy', 1); // needed for req.ip to be correct behind a reverse proxy / HTTPS terminator
// Music uploads arrive as base64 JSON so the browser needs a larger request
// limit than the small account/order APIs. The upload endpoint still enforces
// a strict 15 MB decoded-file limit below.
app.use(express.json({ limit: '24mb' }));
app.use(cookieParser());

function activeModerationEntry(entry) {
  if (!entry) return null;
  if (entry.permanent === true) return { ...entry, active: true };
  const untilMs = entry.until ? new Date(entry.until).getTime() : NaN;
  if (Number.isFinite(untilMs) && untilMs > Date.now()) return { ...entry, active: true };
  return null;
}

function getModerationStatus(user) {
  const moderation = user?.moderation || {};
  const mute = activeModerationEntry(moderation.mute);
  const ban = activeModerationEntry(moderation.ban);
  return {
    muted: !!mute,
    banned: !!ban,
    mute: mute ? {
      until: mute.until || null,
      permanent: mute.permanent === true,
      reason: String(mute.reason || 'ไม่ได้ระบุเหตุผล'),
      startedAt: mute.startedAt || null
    } : null,
    ban: ban ? {
      until: ban.until || null,
      permanent: ban.permanent === true,
      reason: String(ban.reason || 'ไม่ได้ระบุเหตุผล'),
      startedAt: ban.startedAt || null
    } : null
  };
}

function moderationErrorMessage(type, entry) {
  const label = type === 'ban' ? 'ถูกแบน' : 'ถูกปิดแชท';
  const until = entry?.permanent === true
    ? 'ถาวร'
    : (entry?.until ? new Date(entry.until).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ระบุ');
  return `${label}\nเหตุผล: ${String(entry?.reason || 'ไม่ได้ระบุเหตุผล')}\n${type === 'ban' ? 'ปลดแบน' : 'ปลด mute'}: ${until}`;
}


async function writeAuditLog(req, action, targetId = null, details = {}) {
  try {
    if (!db?.auditLogs) return;
    await db.auditLogs.insertOne({
      id: 'AUD-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      actorId: req?.user?.id || req?.session?.userId || null,
      actorUsername: req?.user?.username || null,
      action: String(action || 'unknown'),
      targetId: targetId ? String(targetId) : null,
      details: details && typeof details === 'object' ? details : {},
      ip: String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 100),
      createdAt: new Date().toISOString()
    });
  } catch (_) {}
}

async function requireAuth(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    const user = await db.users.findOne({ id: session.userId });
    if (!user) {
      await destroySession(session.id);
      return res.status(401).json({ error: 'ไม่พบบัญชีนี้ กรุณาเข้าสู่ระบบใหม่' });
    }
    req.session = session;
    req.user = user;
    const moderation = getModerationStatus(user);
    if (moderation.banned) {
      await destroySession(session.id);
      clearSessionCookie(res);
      return res.status(403).json({
        error: moderationErrorMessage('ban', moderation.ban),
        code: 'ACCOUNT_BANNED',
        moderation
      });
    }
    // Fire-and-forget presence heartbeat: lets other users see this player as
    // "online" in chat without a dedicated polling endpoint. Not awaited so it
    // never slows down the actual request.
    db.users.updateOne(
      { id: session.userId },
      { $set: { lastActiveAt: new Date().toISOString() } }
    ).catch(() => {});
    next();
  } catch (err) {
    res.status(500).json({ error: 'ตรวจสอบสถานะบัญชีไม่สำเร็จ' });
  }
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
      uid: await generateUniqueAccountUid(),
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

    const sessionId = await createSession(user.id);
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
    const moderation = getModerationStatus(user);
    if (moderation.banned) {
      return res.status(403).json({
        error: moderationErrorMessage('ban', moderation.ban),
        code: 'ACCOUNT_BANNED',
        moderation
      });
    }

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'เข้าสู่ระบบไม่สำเร็จ' });
  }
});

app.post('/api/logout', async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) await destroySession(sid);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await db.users.findOne({ id: req.session.userId });
  if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
  res.json({ user: { ...publicUser(user), moderation: getModerationStatus(user) } });
});

// ---------- public player profile + web inventory ----------
app.get('/api/public/profile', async (req, res) => {
  try {
    const raw = String(req.query.uid || '').trim();
    if (!/^\d{1,9}$/.test(raw)) return res.status(400).json({ error: 'UID ไม่ถูกต้อง' });
    const user = await db.users.findOne({ uid: Number(raw) });
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้เล่น UID นี้' });
    const achievements = await db.userAchievements.find({ userId: user.id }).sort({ createdAt: -1 }).toArray();
    const ids = achievements.map(x => x.achievementId).filter(Boolean);
    const defs = ids.length ? await db.achievements.find({ id: { $in: ids }, enabled: { $ne: false } }).toArray() : [];
    const byId = Object.fromEntries(defs.map(x => [x.id, x]));
    const owned = await db.orders.countDocuments({ userId: user.id, status: { $nin: ['cancelled','rejected','failed'] } });
    res.json({
      user: {
        id: user.id, uid: user.uid, username: user.username, displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl || '', title: publicUser(user).title, minecraft: user.minecraft || '', minecraftVerified: !!user.minecraftVerified,
        online: isUserOnline(user), createdAt: user.createdAt || null
      },
      achievementCount: achievements.filter(x => byId[x.achievementId]).length,
      inventoryCount: owned,
      achievements: achievements.map(x => { const a=byId[x.achievementId]; return a ? { id:a.id,name:a.name,description:a.description,icon:a.icon,createdAt:x.createdAt } : null; }).filter(Boolean)
    });
  } catch (e) { res.status(500).json({ error: 'โหลดโปรไฟล์ไม่สำเร็จ' }); }
});

app.get('/api/inventory', requireAuth, async (req, res) => {
  try {
    const user = req.user || await db.users.findOne({ id: req.session.userId });
    const orders = await db.orders.find({ userId: user.id, status: { $nin: ['cancelled','rejected','failed'] } }).sort({ createdAt: -1 }).limit(200).toArray();
    const items = orders.map(o => ({
      id: o.id, product: o.product, label: o.productLabel || o.product, icon: o.icon || (o.productType === 'rank' ? '👑' : '🎁'),
      price: Number(o.price || 0), status: o.status || 'สำเร็จ', createdAt: o.createdAt, serial: o.promoUid || o.uid || ''
    }));
    res.json({ user: publicUser(user), items });
  } catch (e) { res.status(500).json({ error: 'โหลดคลังไม่สำเร็จ' }); }
});


// ---------- chat message retention (admin configurable) ----------
const CHAT_RETENTION_OPTIONS = [1, 3, 5, 7, 9, 20, 30];
const DEFAULT_CHAT_RETENTION_DAYS = 1;
let chatRetentionCleanupRunning = false;

function normalizeChatRetentionDays(value) {
  const n = Number(value);
  return CHAT_RETENTION_OPTIONS.includes(n) ? n : DEFAULT_CHAT_RETENTION_DAYS;
}

async function getChatRetentionDays() {
  const doc = await db.settings.findOne({ id: 'chatRetention' });
  return normalizeChatRetentionDays(doc?.days);
}

async function cleanupExpiredChatMessages() {
  if (!db || chatRetentionCleanupRunning) return;
  chatRetentionCleanupRunning = true;
  try {
    const days = await getChatRetentionDays();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    // Main community/private chat.
    const oldMediaMessages = await db.chatMessages.find(
      { createdAt: { $lt: cutoff }, imageId: { $exists: true } },
      { projection: { imageId: 1 } }
    ).limit(5000).toArray();
    const mediaIds = [...new Set(oldMediaMessages.map(x => x.imageId).filter(Boolean))];
    const deletedMain = await db.chatMessages.deleteMany({ createdAt: { $lt: cutoff } });

    if (mediaIds.length) {
      const mediaDocs = await db.chatMedia.find({ id: { $in: mediaIds } }).project({ id: 1, gridFsId: 1 }).toArray();
      await db.chatMedia.deleteMany({ id: { $in: mediaIds } });
      await Promise.all(mediaDocs.map(async m => {
        try { if (m.gridFsId && chatMediaBucket) await chatMediaBucket.delete(m.gridFsId); } catch (_) {}
      }));
    }

    // RPG is the Chat Adventure system; its chat log follows the same rule.
    const deletedRpg = await db.chatGameMessages.deleteMany({ createdAt: { $lt: cutoff } });
    await db.chatGameEvents.deleteMany({ createdAt: { $lt: cutoff } });

    if (deletedMain.deletedCount || deletedRpg.deletedCount) {
      console.log(`[chat-retention] removed ${deletedMain.deletedCount} main + ${deletedRpg.deletedCount} RPG messages older than ${days} day(s)`);
    }
  } catch (err) {
    console.error('[chat-retention] cleanup failed:', err?.message || err);
  } finally {
    chatRetentionCleanupRunning = false;
  }
}

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
    minecraft: user.minecraft || '',
    title: publicUser(user).title,
    avatarUrl: user.avatarUrl || '',
    online: isUserOnline(user)
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
    .project({ id: 1, username: 1, usernameLower: 1, displayName: 1, titleId: 1, minecraft: 1, avatarUrl: 1, lastActiveAt: 1 })
    .limit(q ? 20 : 50).toArray();
  res.json({ users: users.map(publicChatUser) });
});

app.get('/api/chat/rooms', requireAuth, async (req, res) => {
  const rooms = await db.chatRooms.find({
    participantIds: req.session.userId,
    // Rooms the player deleted stay hidden from their own list until new
    // activity happens (see the message handler, which clears hiddenFor).
    hiddenFor: { $ne: req.session.userId }
  }).sort({ updatedAt: -1 }).limit(50).toArray();
  const userIds = [...new Set(rooms.flatMap(room => room.participantIds || []))];
  const users = await db.users.find({ id: { $in: userIds } })
    .project({ id: 1, username: 1, displayName: 1, titleId: 1, minecraft: 1, avatarUrl: 1, lastActiveAt: 1 }).toArray();
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
      .project({ id: 1, username: 1, displayName: 1, titleId: 1, minecraft: 1, avatarUrl: 1, lastActiveAt: 1 }).toArray()
    : [];
  const senderById = Object.fromEntries(senders.map(sender => [sender.id, sender]));
  const publicMessages = messages.map(message => {
    const sender = senderById[message.senderId];
    return omitMongoId({
      ...message,
      senderName: sender?.displayName || sender?.username || message.senderName,
      senderTitle: sender ? publicUser(sender).title : message.senderTitle,
      senderAvatarUrl: sender?.avatarUrl || ''
    });
  });
  res.json({ room: room.id === 'public' ? PUBLIC_CHAT_ROOM : room, messages: publicMessages });
});

const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CHAT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function saveChatImage(encoded, mimeType, filename) {
  const mime = String(mimeType || '').toLowerCase();
  if (!CHAT_IMAGE_TYPES.has(mime)) throw new Error('รองรับรูป JPG, PNG, WEBP หรือ GIF เท่านั้น');
  const raw = String(encoded || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw || !/^[A-Za-z0-9+/=]+$/.test(raw)) throw new Error('ข้อมูลรูปภาพไม่ถูกต้อง');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('รูปในแชทต้องมีขนาดไม่เกิน 8 MB');
  }
  const id = 'chat-img-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
  const upload = chatMediaBucket.openUploadStream(String(filename || id).slice(0, 180), {
    contentType: mime,
    metadata: { chatMediaId: id }
  });
  await new Promise((resolve, reject) => {
    upload.on('error', reject);
    upload.on('finish', resolve);
    upload.end(buffer);
  });
  await db.chatMedia.insertOne({
    id,
    gridFsId: upload.id,
    mimeType: mime,
    filename: String(filename || id).slice(0, 180),
    length: buffer.length,
    createdAt: new Date().toISOString()
  });
  return { id, url: `/api/chat/media/${encodeURIComponent(id)}`, mimeType: mime };
}

app.get('/api/chat/media/:id', requireAuth, async (req, res) => {
  try {
    const media = await db.chatMedia.findOne({ id: req.params.id });
    if (!media || !media.gridFsId) return res.status(404).end();
    const message = await db.chatMessages.findOne({ imageId: media.id });
    if (!message || !(await getChatRoomForUser(message.roomId, req.session.userId))) {
      return res.status(403).end();
    }
    res.set({
      'Content-Type': media.mimeType || 'image/jpeg',
      'Content-Length': String(media.length || 0),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    chatMediaBucket.openDownloadStream(media.gridFsId).on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    }).pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

app.post('/api/chat/rooms/:id/messages', requireAuth, async (req, res) => {
  try {
    const room = await getChatRoomForUser(req.params.id, req.session.userId);
    if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ส่งข้อความในห้องนี้' });
    const content = String(req.body?.content || '').trim();
    const hasImage = !!req.body?.imageData;
    if (!content && !hasImage) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความหรือเลือกรูปก่อนส่ง' });
    if (content.length > 2000) return res.status(400).json({ error: 'ข้อความยาวเกินไป (ไม่เกิน 2,000 ตัวอักษร)' });
    const user = req.user || await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const moderation = getModerationStatus(user);
    if (moderation.muted) {
      return res.status(403).json({
        error: moderationErrorMessage('mute', moderation.mute),
        code: 'CHAT_MUTED',
        moderation
      });
    }
    const image = hasImage
      ? await saveChatImage(req.body.imageData, req.body.imageMimeType, req.body.imageFilename)
      : null;
    const message = {
      id: 'MSG-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      roomId: room.id,
      senderId: user.id,
      senderName: user.displayName || user.username,
      content,
      ...(image ? { type: 'image', imageId: image.id, imageUrl: image.url, imageMimeType: image.mimeType, imageName: image.filename } : {}),
      senderTitle: publicUser(user).title,
      createdAt: new Date().toISOString()
    };
    await db.chatMessages.insertOne(message);
    if (room.id !== PUBLIC_CHAT_ROOM.id) {
      await db.chatRooms.updateOne(
        { id: room.id },
        // New activity un-deletes the conversation for anyone who had
        // previously removed it from their own list (Messenger-style).
        { $set: { lastMessage: image ? '📷 รูปภาพ' + (content ? ` · ${content.slice(0, 100)}` : '') : content.slice(0, 120), updatedAt: message.createdAt, hiddenFor: [] } }
      );
    }
    // the avatar is not stored on the message (it can change); it is looked up when messages are read
    res.json({ success: true, message: omitMongoId({ ...message, senderAvatarUrl: user.avatarUrl || '' }) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ส่งข้อความไม่สำเร็จ' });
  }
});

// Marks a chat room "read" for the current user right now - used both when
// the player actually opens a room in chat.html and by the generic
// notifications/read endpoint below. Upsert so the first-ever read for a
// room doesn't need a separate "create" step.
app.post('/api/chat/rooms/:id/read', requireAuth, async (req, res) => {
  const room = await getChatRoomForUser(req.params.id, req.session.userId);
  if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้' });
  await db.chatReads.updateOne(
    { userId: req.session.userId, roomId: room.id },
    { $set: { userId: req.session.userId, roomId: room.id, lastReadAt: new Date().toISOString() } },
    { upsert: true }
  );
  res.json({ success: true });
});

// Deletes a message the current user sent. Soft-delete only (content wiped,
// deleted:true kept) so the thread's layout/order doesn't jump around for
// the other participant - the bubble just turns into a "message deleted"
// placeholder on both sides.
app.delete('/api/chat/rooms/:id/messages/:msgId', requireAuth, async (req, res) => {
  const room = await getChatRoomForUser(req.params.id, req.session.userId);
  if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้' });
  const message = await db.chatMessages.findOne({ id: req.params.msgId, roomId: room.id });
  if (!message) return res.status(404).json({ error: 'ไม่พบข้อความนี้' });
  if (message.senderId !== req.session.userId) {
    return res.status(403).json({ error: 'คุณลบได้เฉพาะข้อความของตัวเอง' });
  }
  await db.chatMessages.updateOne(
    { id: message.id },
    { $set: { content: '', deleted: true, deletedAt: new Date().toISOString() } }
  );
  res.json({ success: true });
});

// Deletes a chat room from the current user's own list. A direct room is
// only hidden for this user (hiddenFor) - the other participant keeps it
// until they also delete it, and any new message reopens it for everyone
// (see the send-message handler). The shared public room can't be deleted.
app.delete('/api/chat/rooms/:id', requireAuth, async (req, res) => {
  const roomId = req.params.id;
  if (roomId === PUBLIC_CHAT_ROOM.id) {
    return res.status(400).json({ error: 'ไม่สามารถลบห้องแชทรวมได้' });
  }
  const room = await getChatRoomForUser(roomId, req.session.userId);
  if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้' });

  const hiddenFor = Array.from(new Set([...(room.hiddenFor || []), req.session.userId]));
  const everyoneHidIt = (room.participantIds || []).every(id => hiddenFor.includes(id));

  if (everyoneHidIt) {
    // Nobody wants to see it anymore - actually delete the room and its
    // messages/read-state instead of leaving orphaned data around.
    await Promise.all([
      db.chatRooms.deleteOne({ id: room.id }),
      db.chatMessages.deleteMany({ roomId: room.id }),
      db.chatReads.deleteMany({ roomId: room.id })
    ]);
  } else {
    await db.chatRooms.updateOne({ id: room.id }, { $set: { hiddenFor } });
  }
  res.json({ success: true });
});


// ---- coupons / credit codes ----
function normalizeCouponCode(code) { return String(code || '').trim().toUpperCase().replace(/\s+/g, ''); }
app.post('/api/coupons/redeem', requireAuth, async (req, res) => {
  try {
    const code = normalizeCouponCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสคูปอง' });
    const coupon = await db.coupons.findOne({ code, enabled: { $ne: false } });
    if (!coupon) return res.status(404).json({ error: 'ไม่พบรหัสคูปองหรือคูปองถูกปิดใช้งาน' });
    const now = new Date();
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return res.status(400).json({ error: 'คูปองหมดอายุแล้ว' });
    if (coupon.startsAt && new Date(coupon.startsAt) > now) return res.status(400).json({ error: 'คูปองยังไม่เริ่มใช้งาน' });
    if (Number.isFinite(Number(coupon.maxRedemptions)) && Number(coupon.maxRedemptions) > 0 && Number(coupon.redeemedCount || 0) >= Number(coupon.maxRedemptions)) return res.status(400).json({ error: 'คูปองถูกใช้ครบจำนวนแล้ว' });
    const redemption = { id: 'CPR-' + Date.now().toString(36), couponId: coupon.id, userId: req.user.id, code, amount: Number(coupon.amount || 0), createdAt: now.toISOString() };
    try { await db.couponRedemptions.insertOne(redemption); } catch (e) { if (e?.code === 11000) return res.status(409).json({ error: 'บัญชีนี้ใช้คูปองนี้ไปแล้ว' }); throw e; }
    const updated = await db.users.findOneAndUpdate({ id: req.user.id }, { $inc: { balance: Number(coupon.amount || 0) } }, { returnDocument: 'after' });
    await db.coupons.updateOne({ id: coupon.id }, { $inc: { redeemedCount: 1 } });
    await db.notifications.insertOne({ id: 'NT-CP-' + redemption.id, userId: req.user.id, title: 'ได้รับเครดิตจากคูปอง 🎁', message: `ใช้คูปอง ${code} สำเร็จ ได้รับเครดิต ฿${Number(coupon.amount || 0).toLocaleString()}`, read: false, createdAt: now.toISOString() });
    res.json({ success: true, amount: Number(coupon.amount || 0), balance: Number(updated?.balance || 0) });
  } catch (err) { res.status(500).json({ error: err.message || 'ใช้คูปองไม่สำเร็จ' }); }
});
app.get('/api/admin/coupons', requireAdmin, async (req,res) => { res.json({ coupons: (await db.coupons.find({}).sort({createdAt:-1}).limit(200).toArray()).map(omitMongoId) }); });
app.post('/api/admin/coupons', requireAdmin, async (req,res) => {
  try {
    const code=normalizeCouponCode(req.body?.code); const amount=Math.max(0,Number(req.body?.amount||0));
    if(!code || amount<=0) return res.status(400).json({error:'กรุณาระบุรหัสและเครดิตให้ถูกต้อง'});
    const doc={id:'CPN-'+Date.now().toString(36),code,amount,maxRedemptions:Math.max(0,Number(req.body?.maxRedemptions||0)),redeemedCount:0,startsAt:req.body?.startsAt||null,expiresAt:req.body?.expiresAt||null,enabled:req.body?.enabled!==false,createdAt:new Date().toISOString()};
    await db.coupons.insertOne(doc); res.json({success:true,coupon:omitMongoId(doc)});
  } catch(e){ res.status(e?.code===11000?409:500).json({error:e?.code===11000?'รหัสคูปองนี้มีอยู่แล้ว':e.message}); }
});
app.patch('/api/admin/coupons/:id', requireAdmin, async (req,res) => { const set={}; for(const k of ['amount','maxRedemptions','startsAt','expiresAt','enabled']) if(req.body?.[k]!==undefined) set[k]=k==='amount'||k==='maxRedemptions'?Math.max(0,Number(req.body[k])):req.body[k]; await db.coupons.updateOne({id:req.params.id},{$set:set}); res.json({success:true}); });
app.delete('/api/admin/coupons/:id', requireAdmin, async (req,res) => { await db.coupons.deleteOne({id:req.params.id}); res.json({success:true}); });
app.get('/api/admin/audit-logs', requireAdmin, async (req,res) => { const rows=await db.auditLogs.find({}).sort({createdAt:-1}).limit(Math.min(500,Math.max(1,Number(req.query.limit||200)))).toArray(); res.json({logs:rows.map(omitMongoId)}); });

// ---- credit transfers ----
let creditTransferEnabled = true;
async function loadCreditTransferSetting() { const doc = await db.settings.findOne({id:'creditTransfer'}); if (doc && typeof doc.enabled === 'boolean') creditTransferEnabled = doc.enabled; }
function transferRules() {
  return { min: TRANSFER_MIN, max: TRANSFER_MAX, dailyMax: TRANSFER_DAILY_MAX, feePercent: TRANSFER_FEE_PERCENT };
}

async function getTransferTotalToday(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await db.creditTransfers.find({ senderId: userId, status: 'completed', createdAt: { $gte: start.toISOString() } }).toArray();
  return rows.reduce((sum, x) => sum + Number(x.amount || 0), 0);
}

app.get('/api/credits/transfer/rules', requireAuth, async (req, res) => {
  await loadCreditTransferSetting();
  res.json({ enabled: creditTransferEnabled, rules: transferRules(), dailyUsed: await getTransferTotalToday(req.session.userId) });
});

app.get('/api/credits/transfer/history', requireAuth, async (req, res) => {
  const rows = await db.creditTransfers.find({ $or: [{ senderId: req.session.userId }, { recipientId: req.session.userId }] })
    .sort({ createdAt: -1 }).limit(50).toArray();
  const ids = [...new Set(rows.flatMap(x => [x.senderId, x.recipientId]).filter(Boolean))];
  const users = ids.length ? await db.users.find({ id: { $in: ids } }).project({ id:1, username:1, displayName:1, avatarUrl:1, uid:1 }).toArray() : [];
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({ history: rows.map(x => ({ ...omitMongoId(x), sender: byId[x.senderId] || null, recipient: byId[x.recipientId] || null })) });
});

app.get('/api/credits/transfer/recipient', requireAuth, async (req, res) => {
  const q = String(req.query.uid || req.query.username || '').trim();
  if (!q) return res.status(400).json({ error: 'กรุณาระบุ UID หรือชื่อผู้ใช้' });
  const user = /^\d+$/.test(q)
    ? await db.users.findOne({ uid: Number(q) })
    : await db.users.findOne({ usernameLower: q.toLowerCase() });
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้รับ' });
  if (user.id === req.session.userId) return res.status(400).json({ error: 'ไม่สามารถโอนให้ตัวเองได้' });
  res.json({ user: { id:user.id, uid:user.uid || null, username:user.username, displayName:user.displayName || user.username, avatarUrl:user.avatarUrl || '' } });
});

app.post('/api/credits/transfer', requireAuth, async (req, res) => {
  try {
    await loadCreditTransferSetting();
    if (!creditTransferEnabled) return res.status(503).json({error:'ระบบโอนเครดิตถูกปิดชั่วคราวโดยแอดมิน'});
    const amount = Math.trunc(Number(req.body?.amount));
    const target = String(req.body?.recipientUid || req.body?.recipientUsername || '').trim();
    if (!Number.isInteger(amount) || amount < TRANSFER_MIN || amount > TRANSFER_MAX) return res.status(400).json({ error: `โอนได้ครั้งละ ฿${TRANSFER_MIN.toLocaleString()} - ฿${TRANSFER_MAX.toLocaleString()}` });
    if (!target) return res.status(400).json({ error: 'กรุณาระบุ UID หรือชื่อผู้รับ' });
    const sender = await db.users.findOne({ id: req.session.userId });
    const recipient = /^\d+$/.test(target) ? await db.users.findOne({ uid: Number(target) }) : await db.users.findOne({ usernameLower: target.toLowerCase() });
    if (!recipient) return res.status(404).json({ error: 'ไม่พบผู้รับ' });
    if (recipient.id === sender.id) return res.status(400).json({ error: 'ไม่สามารถโอนให้ตัวเองได้' });
    if (getModerationStatus(sender).banned) return res.status(403).json({ error: 'บัญชีถูกแบน ไม่สามารถโอนเครดิตได้' });
    if (getModerationStatus(recipient).banned) return res.status(400).json({ error: 'ผู้รับถูกแบน ไม่สามารถรับโอนได้' });
    const verified = !!sender.minecraftVerified;
    const ageOk = sender.createdAt && (Date.now() - new Date(sender.createdAt).getTime()) >= TRANSFER_ACCOUNT_AGE_MS;
    if (!verified && !ageOk) return res.status(403).json({ error: 'ต้องยืนยันไอดี Minecraft หรือบัญชีมีอายุครบ 3 วันก่อนโอนเครดิต' });
    const used = await getTransferTotalToday(sender.id);
    if (used + amount > TRANSFER_DAILY_MAX) return res.status(400).json({ error: `ยอดโอนต่อวันสูงสุด ฿${TRANSFER_DAILY_MAX.toLocaleString()} (ใช้ไปแล้ว ฿${used.toLocaleString()})` });
    const fee = Math.round(amount * TRANSFER_FEE_PERCENT) / 100;
    const received = amount - fee;
    const transferId = 'TR-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
    const debited = await db.users.findOneAndUpdate({ id: sender.id, balance: { $gte: amount } }, { $inc: { balance: -amount } }, { returnDocument:'after' });
    const freshSender = debited?.value || debited;
    if (!freshSender) return res.status(400).json({ error: `เครดิตไม่พอ (มี ฿${Number(sender.balance||0).toLocaleString()} ต้องใช้ ฿${amount.toLocaleString()})` });
    try {
      await db.users.updateOne({ id: recipient.id }, { $inc: { balance: received } });
      const record = { id:transferId, senderId:sender.id, recipientId:recipient.id, amount, fee, received, status:'completed', createdAt:new Date().toISOString() };
      await db.creditTransfers.insertOne(record);
      const when = new Date().toISOString();
      await db.notifications.insertOne({ id:'NT-' + transferId + '-R', userId:recipient.id, title:'ได้รับเครดิต', message:`คุณได้รับเครดิต ฿${received.toLocaleString()} จาก ${sender.displayName || sender.username}`, read:false, createdAt:when });
      await db.notifications.insertOne({ id:'NT-' + transferId + '-S', userId:sender.id, title:'โอนเครดิตสำเร็จ', message:`โอนเครดิต ฿${amount.toLocaleString()} ให้ ${recipient.displayName || recipient.username} สำเร็จ`, read:false, createdAt:when });
      const updatedRecipient = await db.users.findOne({ id: recipient.id });
      res.json({ success:true, transfer: omitMongoId(record), balance:Number(freshSender.balance||0), recipient:{ uid:recipient.uid, displayName:recipient.displayName || recipient.username, avatarUrl:recipient.avatarUrl || '' }, recipientBalance:Number(updatedRecipient?.balance||0) });
    } catch (e) {
      await db.users.updateOne({ id: sender.id }, { $inc: { balance: amount } });
      throw e;
    }
  } catch (err) { res.status(500).json({ error: err.message || 'โอนเครดิตไม่สำเร็จ' }); }
});

// Admin: transfer system switch, list, and reversal.
app.get('/api/admin/credit-transfers', requireAdmin, async (req,res) => {
  await loadCreditTransferSetting();
  const rows = await db.creditTransfers.find({}).sort({createdAt:-1}).limit(200).toArray();
  res.json({ enabled:true, rules:transferRules(), transfers:rows.map(omitMongoId) });
});
app.post('/api/admin/credit-transfers/toggle', requireAdmin, async (req,res) => {
  const enabled = req.body?.enabled === true;
  creditTransferEnabled = enabled;
  await db.settings.updateOne({id:'creditTransfer'}, {$set:{id:'creditTransfer',enabled,updatedAt:new Date().toISOString()}}, {upsert:true});
  res.json({success:true,enabled});
});

// Admin direct credit transfer: move credits between two player accounts.
// This is separate from the normal player-to-player limits and does not charge a fee.
app.post('/api/admin/credit-transfer', requireAdmin, async (req,res) => {
  try {
    const fromTarget = String(req.body?.fromUid || req.body?.fromUsername || '').trim();
    const toTarget = String(req.body?.toUid || req.body?.toUsername || '').trim();
    const amount = Math.trunc(Number(req.body?.amount));
    const reason = String(req.body?.reason || 'ADMIN_TRANSFER').trim().slice(0, 240);
    if (!fromTarget || !toTarget || !Number.isInteger(amount) || amount <= 0) return res.status(400).json({error:'กรุณาระบุผู้โอน ผู้รับ และจำนวนเครดิตให้ถูกต้อง'});
    const findUser = async target => /^\d+$/.test(target)
      ? db.users.findOne({uid:Number(target)})
      : db.users.findOne({usernameLower:target.toLowerCase()});
    const sender = await findUser(fromTarget);
    const recipient = await findUser(toTarget);
    if (!sender) return res.status(404).json({error:'ไม่พบบัญชีผู้โอน'});
    if (!recipient) return res.status(404).json({error:'ไม่พบบัญชีผู้รับ'});
    if (sender.id === recipient.id) return res.status(400).json({error:'ผู้โอนและผู้รับต้องเป็นคนละบัญชี'});
    const debited = await db.users.findOneAndUpdate({id:sender.id, balance:{$gte:amount}}, {$inc:{balance:-amount}}, {returnDocument:'after'});
    const freshSender = debited?.value || debited;
    if (!freshSender) return res.status(400).json({error:`เครดิตของผู้โอนไม่พอ (ต้องใช้ ฿${amount.toLocaleString()})`});
    const now = new Date().toISOString();
    try {
      await db.users.updateOne({id:recipient.id}, {$inc:{balance:amount}});
      const transferId = 'ATR-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
      const record = {id:transferId, senderId:sender.id, recipientId:recipient.id, amount, fee:0, received:amount, status:'completed', type:'admin_transfer', reason, createdAt:now, createdBy:'ADMIN'};
      await db.creditTransfers.insertOne(record);
      await db.notifications.insertOne({id:'NT-'+transferId+'-R', userId:recipient.id, title:'ได้รับเครดิตจากแอดมิน', message:`คุณได้รับเครดิต ฿${amount.toLocaleString()} จากการโอนโดยแอดมิน${reason && reason!=='ADMIN_TRANSFER'?` (${reason})`:''}`, read:false, createdAt:now});
      res.json({success:true, transfer:omitMongoId(record), senderBalance:Number(freshSender.balance||0), recipientBalance:Number((await db.users.findOne({id:recipient.id}))?.balance||0)});
    } catch (e) {
      await db.users.updateOne({id:sender.id}, {$inc:{balance:amount}});
      throw e;
    }
  } catch (err) { res.status(500).json({error:err.message || 'โอนเครดิตโดยแอดมินไม่สำเร็จ'}); }
});

app.post('/api/admin/credit-transfers/reverse/:id', requireAdmin, async (req,res) => {
  const t = await db.creditTransfers.findOne({ id:String(req.params.id) });
  if (!t || t.status !== 'completed') return res.status(400).json({error:'รายการนี้ไม่สามารถย้อนกลับได้'});
  const recipient = await db.users.findOneAndUpdate({id:t.recipientId, balance:{$gte:Number(t.received||0)}}, {$inc:{balance:-Number(t.received||0)}}, {returnDocument:'after'});
  const r = recipient?.value || recipient;
  if (!r) return res.status(400).json({error:'เครดิตของผู้รับไม่พอสำหรับย้อนรายการ'});
  await db.users.updateOne({id:t.senderId}, {$inc:{balance:Number(t.amount||0)}});
  await db.creditTransfers.updateOne({id:t.id}, {$set:{status:'reversed', reversedAt:new Date().toISOString(), reversedBy:'ADMIN'}});
  res.json({success:true});
});

// ---- unified notification bell (chat messages + admin account messages) ----
// Builds the Facebook-style bell's contents: one entry per chat room that
// has unread messages (grouped, not one row per message) plus one entry per
// unread admin->player account message. Read state for chat is persisted in
// db.chatReads so it survives a refresh or a different device/browser -
// unlike the old client-only unreadByRoom counter.
async function buildNotificationItems(userId) {
  const privateRooms = await db.chatRooms.find({ participantIds: userId })
    .project({ id: 1 }).limit(50).toArray();
  const roomIds = [PUBLIC_CHAT_ROOM.id, ...privateRooms.map(room => room.id)];
  const reads = await db.chatReads.find({ userId, roomId: { $in: roomIds } }).toArray();
  const lastReadByRoom = Object.fromEntries(reads.map(r => [r.roomId, r.lastReadAt]));

  const roomsById = {
    [PUBLIC_CHAT_ROOM.id]: PUBLIC_CHAT_ROOM,
    ...Object.fromEntries((await db.chatRooms.find({ id: { $in: roomIds } }).toArray()).map(r => [r.id, r]))
  };
  const userIds = [...new Set(privateRooms.flatMap(r => roomsById[r.id]?.participantIds || []))];
  const usersById = userIds.length
    ? Object.fromEntries((await db.users.find({ id: { $in: userIds } })
        .project({ id: 1, username: 1, displayName: 1 }).toArray()).map(u => [u.id, u]))
    : {};

  const chatItems = [];
  for (const roomId of roomIds) {
    const since = lastReadByRoom[roomId];
    const filter = { roomId, senderId: { $ne: userId } };
    if (since) filter.createdAt = { $gt: since };
    const unread = await db.chatMessages.find(filter).sort({ createdAt: -1 }).limit(50).toArray();
    if (!unread.length) continue;
    const latest = unread[0];
    const room = roomsById[roomId];
    const title = roomId === PUBLIC_CHAT_ROOM.id
      ? PUBLIC_CHAT_ROOM.name
      : (() => {
          const otherId = (room?.participantIds || []).find(id => id !== userId);
          const other = usersById[otherId];
          return other?.displayName || other?.username || 'แชทส่วนตัว';
        })();
    chatItems.push({
      id: 'chat:' + roomId,
      type: 'chat',
      roomId,
      title,
      message: latest.content.slice(0, 140),
      senderName: latest.senderName,
      unreadCount: unread.length,
      createdAt: latest.createdAt
    });
  }

  const nowIso = new Date().toISOString();
  const accountNotifs = await db.notifications.find({
    userId,
    read: { $ne: true },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: nowIso } }]
  }).sort({ createdAt: -1 }).limit(30).toArray();
  const accountItems = accountNotifs.map(n => ({
    id: 'account:' + n.id,
    type: 'account',
    notificationId: n.id,
    title: n.title || 'ข้อความจากทีมงาน',
    message: String(n.message || '').slice(0, 140),
    createdAt: n.createdAt
  }));

  const items = [...chatItems, ...accountItems].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const unreadCount = chatItems.reduce((sum, x) => sum + Number(x.unreadCount || 0), 0) + accountItems.length;
  return { unreadCount, items: items.slice(0, 30) };
}

app.get('/api/notifications/summary', requireAuth, async (req, res) => {
  try {
    const summary = await buildNotificationItems(req.session.userId);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message || 'โหลดการแจ้งเตือนไม่สำเร็จ' });
  }
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  try {
    const type = String(req.body?.type || '');
    if (type === 'chat') {
      const roomId = String(req.body?.roomId || '');
      const room = await getChatRoomForUser(roomId, req.session.userId);
      if (!room) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้' });
      await db.chatReads.updateOne(
        { userId: req.session.userId, roomId: room.id },
        { $set: { userId: req.session.userId, roomId: room.id, lastReadAt: new Date().toISOString() } },
        { upsert: true }
      );
    } else if (type === 'account') {
      const notificationId = String(req.body?.notificationId || '');
      await db.notifications.updateOne(
        { id: notificationId, userId: req.session.userId },
        { $set: { read: true } }
      );
    } else {
      return res.status(400).json({ error: 'ประเภทการแจ้งเตือนไม่ถูกต้อง' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ไม่สามารถอัปเดตการแจ้งเตือนได้' });
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

// ---- profile picture ("ใส่รูปอะไรก็ได้") ----
// Reuses the same saveSiteImage/deleteSiteImage helpers the admin's page
// images already use (GridFS-backed, defined further down in this file -
// safe to call here since these are hoisted/top-level and this route only
// ever runs after the whole module has finished loading). The frontend
// downsizes the photo to a small square before sending it, so this cap is
// just a hard backstop against someone bypassing that and posting a huge
// file directly to the API.
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

app.post('/api/account/avatar', requireAuth, async (req, res) => {
  try {
    const image = String(req.body?.image || '');
    const mimeType = String(req.body?.mimeType || 'image/jpeg').toLowerCase();
    if (!image) return res.status(400).json({ error: 'ไม่พบข้อมูลรูปภาพ' });

    const raw = image.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    const approxBytes = Math.ceil((raw.length * 3) / 4);
    if (approxBytes > AVATAR_MAX_BYTES) {
      return res.status(400).json({ error: 'รูปภาพใหญ่เกินไป กรุณาเลือกไฟล์ที่เล็กกว่านี้' });
    }

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });

    const saved = await saveSiteImage(image, mimeType, `avatar-${user.id}`);
    const updated = await db.users.findOneAndUpdate(
      { id: req.session.userId },
      { $set: { avatarUrl: saved.url, avatarImageId: saved.id } },
      { returnDocument: 'after' }
    );
    const updatedUser = updated?.value || updated;

    // Best-effort cleanup of the old picture so changing photos repeatedly
    // doesn't leave orphaned files behind. Never let this fail the request -
    // the new avatar is already saved and set at this point.
    if (user.avatarImageId && user.avatarImageId !== saved.id) {
      deleteSiteImage(user.avatarImageId).catch(() => {});
    }

    res.json({ success: true, user: publicUser(updatedUser) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ' });
  }
});

app.delete('/api/account/avatar', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    if (user.avatarImageId) deleteSiteImage(user.avatarImageId).catch(() => {});
    const updated = await db.users.findOneAndUpdate(
      { id: req.session.userId },
      { $unset: { avatarUrl: '', avatarImageId: '' } },
      { returnDocument: 'after' }
    );
    const updatedUser = updated?.value || updated;
    res.json({ success: true, user: publicUser(updatedUser) });
  } catch (err) {
    res.status(400).json({ error: 'ลบรูปโปรไฟล์ไม่สำเร็จ' });
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

// Promotion Mari (โปรโมชั่น มารี) - its own catalog endpoint, separate from
// both the VIP rank shop and the regular Item SHOP (see DEFAULT_PROMO_ITEMS).
app.get('/api/promo-shop', async (req, res) => {
  res.json({ products: await promoShopCatalog() });
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

app.get('/api/promo-orders', requireAuth, async (req, res) => {
  const orders = await db.orders.find({
    userId: req.session.userId,
    productType: 'promo'
  }).sort({ createdAt: -1 }).toArray();
  res.json({ orders: orders.map(omitMongoId) });
});

// For Promotion Mari items with assignUid enabled: picks a random integer
// in [1, 9999999] and makes sure no existing order for the same product
// already used it (best-effort - matches the "good enough" uniqueness
// pattern used elsewhere in this file, e.g. wheelSpins; ~10 million
// possible values makes a collision on retry vanishingly unlikely for
// this site's order volume).
async function generateUniquePromoUid(product) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const uid = 1 + Math.floor(Math.random() * 9999999);
    const exists = await db.orders.findOne({ product, promoUid: uid });
    if (!exists) return uid;
  }
  throw new Error('ไม่สามารถออกหมายเลขเฉพาะที่ไม่ซ้ำได้ กรุณาลองใหม่อีกครั้ง');
}

// Same idea as generateUniquePromoUid, but for account UIDs - a random
// 1-9999999 number assigned to every user account (see db.users.uid, the
// { uid: 1 } unique index, and backfillUserUids for existing accounts).
async function generateUniqueAccountUid() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const uid = 1 + Math.floor(Math.random() * 9999999);
    const exists = await db.users.findOne({ uid });
    if (!exists) return uid;
  }
  throw new Error('ไม่สามารถออกหมายเลขบัญชีที่ไม่ซ้ำได้ กรุณาลองใหม่อีกครั้ง');
}

// One-time migration: assigns a uid to any account created before this
// feature existed (new accounts get one straight from /api/register).
// Runs on every boot but is a no-op past the first time - only accounts
// still missing a uid are touched, and each one is set individually so a
// crash partway through just picks up where it left off on next restart.
async function backfillUserUids() {
  const missing = await db.users.find({ uid: { $exists: false } }).project({ id: 1 }).toArray();
  if (!missing.length) return;
  for (const u of missing) {
    const uid = await generateUniqueAccountUid();
    await db.users.updateOne({ id: u.id }, { $set: { uid } });
  }
  console.log(`[db] backfilled account uid for ${missing.length} existing user(s)`);
}

async function placeShopOrder(req, res, shopType) {
  try {
    const product = String(req.body?.product || '').trim();
    const minecraft = String(req.body?.minecraft || '').trim();

    const isRank = Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, product);
    // Item SHOP and Promotion Mari are separate catalogs/collections - a
    // product id only ever resolves against the collection matching this
    // request's shopType, so a promo id can't be bought through
    // /api/item-orders (or vice versa) even if the ids happened to collide.
    const catalogCollection = shopType === 'promo' ? db.promoItems : db.shopItems;
    const item = isRank ? null : await catalogCollection.findOne({ id: product, enabled: { $ne: false } });
    if (shopType === 'rank' && !isRank) {
      return res.status(400).json({ error: 'สินค้านี้ไม่ใช่สินค้าในร้านยศ VIP' });
    }
    if (shopType === 'item' && !item) {
      return res.status(400).json({ error: 'สินค้านี้ไม่ใช่สินค้าใน SHOP ไอเทม' });
    }
    if (shopType === 'promo' && !item) {
      return res.status(400).json({ error: 'สินค้านี้ไม่ใช่สินค้าในโปรโมชั่น มารี' });
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

    // Promotion Mari items can opt into a unique per-purchase serial number
    // (an admin-configurable option on any Promotion Mari item, via the
    // "ออกหมายเลขเฉพาะให้แต่ละชิ้น" checkbox in admin.html) - generated up front, before
    // any credit is touched, so a failure here never deducts a player's balance.
    const promoUid = (!isRank && item.assignUid) ? await generateUniquePromoUid(product) : null;

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
      productType: isRank ? 'rank' : shopType,
      ...(promoUid ? { promoUid } : {}),
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
          await grantShopItem(minecraft, item, promoUid ? { uid: promoUid } : {});
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

app.post('/api/promo-orders', requireAuth, async (req, res) => {
  await placeShopOrder(req, res, 'promo');
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

function publicResaleListing(listing, userById) {
  const seller = userById[listing.sellerId];
  return {
    ...omitMongoId(listing),
    sellerUsername: seller?.username || '(ไม่พบบัญชี)',
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
  res.json({ listings: listings.map(l => publicResaleListing(l, userById)) });
});

app.get('/api/resale/my-listings', requireAuth, async (req, res) => {
  const listings = await db.resaleListings.find({ sellerId: req.session.userId }).sort({ createdAt: -1 }).toArray();
  const userById = { [req.session.userId]: await db.users.findOne({ id: req.session.userId }) };
  res.json({ listings: listings.map(l => publicResaleListing(l, userById)) });
});

app.post('/api/resale/listings', requireAuth, async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || '').trim();
    if (!itemId) return res.status(400).json({ error: 'กรุณาเลือกไอเทมที่ต้องการลงขายต่อ' });

    const item = await db.shopItems.findOne({ id: itemId, enabled: { $ne: false } });
    if (!item) return res.status(400).json({ error: 'ไม่พบไอเทมนี้ใน Item SHOP กรุณาเลือกใหม่' });

    const user = await db.users.findOne({ id: req.session.userId });
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

    // Items marked pullOnListing (e.g. ExecutableItems custom items) get
    // physically removed from the seller's live inventory right now,
    // before the listing goes up - see pullShopItemFromPlayer. This turns
    // the listing from a "virtual coupon" into a real trade, so it needs
    // the seller online and requires RCON specifically (Pterodactyl can't
    // confirm the take actually happened).
    let pulled = false;
    let sellerMinecraft = '';
    if (item.pullOnListing) {
      sellerMinecraft = String(req.body?.minecraft || '').trim();
      if (!/^[A-Za-z0-9_ .]{3,16}$/.test(sellerMinecraft)) {
        return res.status(400).json({ error: 'ไอเทมนี้ต้องดึงของจริงจากตัวผู้เล่น กรุณากรอกชื่อ Minecraft ให้ถูกต้อง (3-16 ตัวอักษร a-z, 0-9, _)' });
      }
      const onlineCheck = await isPlayerOnlineViaRcon(sellerMinecraft);
      if (!onlineCheck.online) {
        return res.status(400).json({ error: `ไอเทมนี้ต้องดึงของจริงจากตัวผู้เล่น กรุณาเข้าเกมก่อนลงขาย (${onlineCheck.reason || 'ไม่พบผู้เล่นออนไลน์'})` });
      }
      const pull = await pullShopItemFromPlayer(sellerMinecraft, item);
      if (!pull.success) {
        return res.status(400).json({ error: `ดึงไอเทมจากผู้เล่นไม่สำเร็จ (${pull.detail}) - ตรวจสอบว่าคุณมีไอเทมนี้ในช่องเก็บของจริง` });
      }
      pulled = true;
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
      pulled,
      sellerMinecraft: pulled ? sellerMinecraft : undefined,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    if (pulled) {
      try {
        await db.resaleListings.insertOne(listing);
      } catch (err) {
        // Extremely unlikely (insert failure right after a real item was
        // already pulled from the player) - but if it happens, the
        // player is out the item with no listing to show for it, so this
        // needs to be loud rather than silently swallowed.
        console.error(`[resale] PULLED ${item.id} from ${sellerMinecraft} but failed to save the listing:`, err.message);
        throw err;
      }
    } else {
      await db.resaleListings.insertOne(listing);
    }
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

  // This listing physically pulled the item out of the seller's
  // inventory when it went up (pullOnListing) - cancelling it must give
  // that item back, or it just vanishes. Uses the normal give command
  // (grantShopItem), same as a fresh purchase, delivered to the same
  // username the item was pulled from.
  if (listing.pulled && listing.sellerMinecraft) {
    try {
      const item = await db.shopItems.findOne({ id: listing.itemId });
      if (!item) throw new Error('ไม่พบไอเทมนี้ใน Item SHOP แล้ว (อาจถูกลบออก) - กรุณาติดต่อแอดมินให้คืนของด้วยมือ');
      await grantShopItem(listing.sellerMinecraft, item);
    } catch (err) {
      // Don't block the cancellation on this - the listing is already
      // off the board either way - but flag it loudly since the seller
      // is now down one real item until someone gives it back by hand.
      console.error(`[resale] cancelled pulled listing ${listing.id} but failed to return the item to ${listing.sellerMinecraft}:`, err.message);
      return res.json({
        success: true,
        warning: `ยกเลิกรายการแล้ว แต่คืนไอเทมเข้าเกมให้ไม่สำเร็จ (${err.message}) กรุณาติดต่อแอดมินให้คืนของให้ด้วยมือ`
      });
    }
  }

  res.json({ success: true });
});

// Buys a resale listing at its current (decayed) price: reserves the
// listing atomically first (status active -> sold) so two buyers can't
// both grab it, computes the price at that exact moment, charges the
// buyer, credits the seller, then delivers the item to the buyer via
// console command - same "never charge for something that didn't arrive"
// contract as the rest of the site: any failure after the buyer is
// charged unwinds every step already taken.
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

    const price = currentResalePrice(listing);

    const reserved = await db.resaleListings.findOneAndUpdate(
      { id: listing.id, status: 'active' },
      { $set: { status: 'sold', buyerId: req.session.userId, soldPrice: price, soldAt: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    const soldListing = reserved?.value || reserved;
    if (!soldListing) return res.status(409).json({ error: 'รายการนี้เพิ่งถูกซื้อไปโดยผู้เล่นคนอื่น' });

    const deducted = await db.users.findOneAndUpdate(
      { id: req.session.userId, balance: { $gte: price } },
      { $inc: { balance: -price } },
      { returnDocument: 'after' }
    );
    const buyer = deducted?.value || deducted;
    if (!buyer) {
      await db.resaleListings.updateOne({ id: listing.id }, { $set: { status: 'active' }, $unset: { buyerId: '', soldPrice: '', soldAt: '' } });
      return res.status(402).json({ error: `ยอดเครดิตไม่พอ (ต้องใช้ ฿${price})` });
    }

    await db.users.updateOne({ id: listing.sellerId }, { $inc: { balance: price } });

    const item = await db.shopItems.findOne({ id: listing.itemId });
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

    if (GAME_CONSOLE_ENABLED) {
      try {
        if (!item) throw new Error('ไม่พบไอเทมนี้ใน Item SHOP แล้ว (อาจถูกลบออก)');
        await grantShopItem(minecraft, item);
        order.status = `สำเร็จ (ส่ง${item.label}เข้าเกมแล้ว)`;
        await db.orders.updateOne({ id: order.id }, { $set: { status: order.status } });
      } catch (err) {
        // Delivery failed - unwind everything: buyer's credit back, take
        // the payout back from the seller, drop the order, and reopen the
        // listing exactly as it was (same start/floor/decay, so the price
        // picks up where the decay curve says it should be - no free
        // re-roll of the timer).
        await db.users.updateOne({ id: req.session.userId }, { $inc: { balance: price } });
        await db.users.updateOne({ id: listing.sellerId }, { $inc: { balance: -price } });
        await db.orders.deleteOne({ id: order.id });
        await db.resaleListings.updateOne({ id: listing.id }, { $set: { status: 'active' }, $unset: { buyerId: '', soldPrice: '', soldAt: '' } });
        return res.status(502).json({
          error: `ตัดเครดิตแล้ว แต่ส่งสินค้าเข้าเกมไม่สำเร็จ (${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'}) ระบบคืนเครดิตให้แล้ว กรุณาลองใหม่อีกครั้ง`,
          code: 'GRANT_FAILED'
        });
      }
    }

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

// ---- daily login calendar: player endpoints ----
// GET is public-ish info (requires login so we can tell you what YOU'VE
// claimed) - the reward list itself has nothing sensitive in it, but the
// raw console commands stay server-side only (same as the Item SHOP's
// commandTemplate never appearing on GET /api/item-shop).
function publicCheckinReward(r) {
  return { day: r.day, icon: r.icon, label: r.label, quantity: r.quantity };
}
app.get('/api/checkin/status', requireAuth, async (req, res) => {
  const { dayKeyBangkok, monthKey, dayOfMonth } = checkinTodayInfo();
  const rewards = [...(gameSettings.checkinRewards || [])].sort((a, b) => a.day - b.day).map(publicCheckinReward);
  const monthClaims = await db.checkins
    .find({ userId: req.session.userId, monthKey })
    .sort({ dayOfMonth: 1 })
    .toArray();
  const claimedDays = monthClaims.map(c => c.dayOfMonth);
  const claimedToday = claimedDays.includes(dayOfMonth);
  res.json({
    dayOfMonth,
    monthKey,
    rewards,
    todayReward: publicCheckinReward(checkinRewardForDay(dayOfMonth)),
    autoDelivery: GAME_CONSOLE_ENABLED,
    claimedDays,
    claimedToday,
    myClaims: monthClaims.map(omitMongoId)
  });
});

app.post('/api/checkin/claim', requireAuth, async (req, res) => {
  try {
    const minecraft = String(req.body?.minecraft || '').trim();
    if (!/^[A-Za-z0-9_ .]{3,16}$/.test(minecraft)) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ Minecraft ให้ถูกต้อง (3-16 ตัวอักษร a-z, 0-9, _)' });
    }
    const { dayKeyBangkok, monthKey, dayOfMonth } = checkinTodayInfo();
    const reward = checkinRewardForDay(dayOfMonth);

    const claim = {
      id: 'CHK-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.session.userId,
      minecraft,
      dayKeyBangkok,
      monthKey,
      dayOfMonth,
      itemLabel: reward.label,
      icon: reward.icon,
      quantity: reward.quantity,
      status: 'รอแอดมินส่งของ',
      delivered: false,
      createdAt: new Date().toISOString()
    };
    try {
      await db.checkins.insertOne(claim);
    } catch (err) {
      // Unique index on (userId, dayKeyBangkok) caught a duplicate - already
      // claimed today (or two simultaneous clicks racing each other).
      if (err && err.code === 11000) {
        return res.status(409).json({ error: 'วันนี้คุณกดรับของแล้ว กรุณากลับมาใหม่พรุ่งนี้', code: 'ALREADY_CLAIMED' });
      }
      throw err;
    }

    // Auto-delivery, same contract as the Item SHOP: only attempted when
    // the console is reachable AND this specific day has a command set.
    // No wallet/rollback logic needed here (nothing was paid) - a failed
    // send just leaves the claim sitting as "รอแอดมินส่งของ" for staff to
    // finish by hand, same graceful fallback the Item SHOP already uses.
    if (GAME_CONSOLE_ENABLED && reward.commandTemplate) {
      try {
        const command = reward.commandTemplate
          .replace(/\{player\}/g, minecraft)
          .replace(/\{quantity\}/g, String(reward.quantity));
        await runConsoleCommand(command);
        claim.delivered = true;
        claim.status = `สำเร็จ (ส่ง${reward.label}เข้าเกมอัตโนมัติแล้ว)`;
        await db.checkins.updateOne({ id: claim.id }, { $set: { delivered: true, status: claim.status } });
      } catch (err) {
        claim.status = `รอแอดมินส่งของ (ส่งอัตโนมัติไม่สำเร็จ: ${err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'})`;
        await db.checkins.updateOne({ id: claim.id }, { $set: { status: claim.status } });
      }
    }

    res.json({ success: true, claim: omitMongoId(claim) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'รับของไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
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


// ---------- TikTok follower statistics (OAuth v2) ----------
function tiktokConfigured(){
  return !!(TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET && TIKTOK_REDIRECT_URI);
}
function tiktokSlotName(v){
  const s=String(v||'mari').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(s)?s:'mari';
}
async function tiktokTokenRequest(params){
  const body=new URLSearchParams({client_key:TIKTOK_CLIENT_KEY,client_secret:TIKTOK_CLIENT_SECRET,...params});
  const r=await fetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Cache-Control':'no-cache'},body});
  const data=await r.json().catch(()=>({}));
  if(!r.ok || data.error) throw new Error(data.error_description||data.error||`TikTok token error ${r.status}`);
  return data;
}
async function refreshTikTokAccount(account){
  if(!account?.refreshToken) throw new Error('TikTok ยังไม่ได้เชื่อมต่อ');
  const token=await tiktokTokenRequest({grant_type:'refresh_token',refresh_token:account.refreshToken});
  const now=Date.now();
  const updated={
    accessToken:token.access_token,
    refreshToken:token.refresh_token||account.refreshToken,
    accessExpiresAt:new Date(now+Number(token.expires_in||86400)*1000).toISOString(),
    refreshExpiresAt:new Date(now+Number(token.refresh_expires_in||31536000)*1000).toISOString(),
    scope:token.scope||account.scope||'',
    openId:token.open_id||account.openId,
    updatedAt:new Date().toISOString()
  };
  await db.tiktokAccounts.updateOne({slot:account.slot},{$set:updated});
  return {...account,...updated};
}
async function getFreshTikTokAccount(slot){
  let account=await db.tiktokAccounts.findOne({slot});
  if(!account) return null;
  if(!account.accessToken || !account.refreshToken) return null;
  const expires=Date.parse(account.accessExpiresAt||'');
  if(!expires || expires-Date.now()<10*60*1000){
    try { account=await refreshTikTokAccount(account); }
    catch(e){ console.warn(`[tiktok] refresh ${slot} failed:`,e.message); }
  }
  return account;
}
async function fetchTikTokStats(slot){
  const account=await getFreshTikTokAccount(slot);
  if(!account) return null;
  const fields='open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count,profile_deep_link,is_verified';
  const r=await fetch('https://open.tiktokapis.com/v2/user/info/?fields='+encodeURIComponent(fields),{headers:{Authorization:`Bearer ${account.accessToken}`,'Cache-Control':'no-cache'}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok || data.error?.code && data.error.code!=='ok'){
    const msg=data.error?.message||data.error?.code||`TikTok stats error ${r.status}`;
    if(r.status===401 && account.refreshToken){
      const fresh=await refreshTikTokAccount(account);
      const rr=await fetch('https://open.tiktokapis.com/v2/user/info/?fields='+encodeURIComponent(fields),{headers:{Authorization:`Bearer ${fresh.accessToken}`,'Cache-Control':'no-cache'}});
      const dd=await rr.json().catch(()=>({}));
      if(!rr.ok) throw new Error(dd.error?.message||`TikTok stats error ${rr.status}`);
      data.data=dd.data;
    }else throw new Error(msg);
  }
  const u=data.data?.user||{};
  const stats={slot,username:u.username||account.username||'',displayName:u.display_name||'',avatarUrl:u.avatar_url||'',profileUrl:u.profile_deep_link||'',isVerified:!!u.is_verified,followerCount:Number(u.follower_count||0),followingCount:Number(u.following_count||0),likesCount:Number(u.likes_count||0),videoCount:Number(u.video_count||0),updatedAt:new Date().toISOString()};
  await db.tiktokAccounts.updateOne({slot},{$set:{...stats,lastStatsAt:stats.updatedAt}});
  return stats;
}
app.get('/api/tiktok/stats', async (req,res)=>{
  try{
    const slot=tiktokSlotName(req.query?.slot);
    const account=await db.tiktokAccounts.findOne({slot},{projection:{accessToken:0,refreshToken:0}});
    if(!account) return res.json({connected:false,slot});
    const cachedAt=Date.parse(account.lastStatsAt||'');
    if(cachedAt && Date.now()-cachedAt<10*60*1000 && account.followerCount!==undefined){
      return res.json({connected:true,stats:{slot,username:account.username||'',displayName:account.displayName||'',avatarUrl:account.avatarUrl||'',profileUrl:account.profileUrl||'',isVerified:!!account.isVerified,followerCount:Number(account.followerCount||0),followingCount:Number(account.followingCount||0),likesCount:Number(account.likesCount||0),videoCount:Number(account.videoCount||0),updatedAt:account.lastStatsAt}});
    }
    const stats=await fetchTikTokStats(slot);
    if(!stats) return res.json({connected:false,slot});
    res.json({connected:true,stats});
  }catch(e){res.status(502).json({error:e.message||'ดึงข้อมูล TikTok ไม่สำเร็จ'});}
});
app.get('/api/admin/tiktok/connect', async (req,res)=>{
  try{
    const session=await getSession(req);
    if(!session) return res.status(401).send('กรุณาเข้าสู่ระบบ Admin ก่อน');
    const user=await db.users.findOne({id:session.userId});
    if(!user || !['admin','creator'].includes(user.titleId)) return res.status(403).send('ไม่มีสิทธิ์เชื่อมต่อ TikTok');
    if(!tiktokConfigured()) return res.status(503).send('ยังไม่ได้ตั้ง TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI บน Render');
    const slot=tiktokSlotName(req.query?.slot);
    const state=crypto.randomBytes(32).toString('hex');
    await db.tiktokOAuthStates.insertOne({state,slot,userId:user.id,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60*1000).toISOString()});
    const u=new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.searchParams.set('client_key',TIKTOK_CLIENT_KEY);
    u.searchParams.set('scope',TIKTOK_OAUTH_SCOPES);
    u.searchParams.set('response_type','code');
    u.searchParams.set('redirect_uri',TIKTOK_REDIRECT_URI);
    u.searchParams.set('state',state);
    res.redirect(u.toString());
  }catch(e){res.status(500).send('เริ่มเชื่อมต่อ TikTok ไม่สำเร็จ');}
});
app.get('/api/admin/tiktok/callback', async (req,res)=>{
  try{
    if(req.query?.error) return res.status(400).send(`TikTok ปฏิเสธการอนุญาต: ${String(req.query.error_description||req.query.error)}`);
    const state=String(req.query?.state||'');
    const code=String(req.query?.code||'');
    if(!state||!code) return res.status(400).send('TikTok callback ไม่ครบ');
    const row=await db.tiktokOAuthStates.findOne({state});
    if(!row || Date.parse(row.expiresAt)<Date.now()) return res.status(400).send('ลิงก์เชื่อมต่อ TikTok หมดอายุ กรุณาเริ่มใหม่');
    await db.tiktokOAuthStates.deleteOne({state});
    const token=await tiktokTokenRequest({grant_type:'authorization_code',code,redirect_uri:TIKTOK_REDIRECT_URI});
    if(!String(token.scope||'').split(',').includes('user.info.stats')) return res.status(400).send('TikTok ไม่ได้อนุญาตสิทธิ์ user.info.stats จึงอ่านจำนวนผู้ติดตามไม่ได้');
    const now=Date.now();
    await db.tiktokAccounts.updateOne({slot:row.slot},{$set:{slot:row.slot,userId:row.userId,openId:token.open_id,accessToken:token.access_token,refreshToken:token.refresh_token,scope:token.scope||'',accessExpiresAt:new Date(now+Number(token.expires_in||86400)*1000).toISOString(),refreshExpiresAt:new Date(now+Number(token.refresh_expires_in||31536000)*1000).toISOString(),updatedAt:new Date().toISOString()}}, {upsert:true});
    res.redirect('/admin.html?tiktok=connected&slot='+encodeURIComponent(row.slot));
  }catch(e){console.error('[tiktok] callback failed:',e);res.status(500).send('เชื่อมต่อ TikTok ไม่สำเร็จ: '+e.message);}
});
app.post('/api/admin/tiktok/refresh', requireAdmin, async (req,res)=>{
  try{const slot=tiktokSlotName(req.body?.slot);const stats=await fetchTikTokStats(slot);if(!stats)return res.status(404).json({error:'ยังไม่ได้เชื่อมต่อ TikTok'});res.json({success:true,stats});}catch(e){res.status(502).json({error:e.message});}
});
app.post('/api/admin/tiktok/disconnect', requireAdmin, async (req,res)=>{const slot=tiktokSlotName(req.body?.slot);await db.tiktokAccounts.deleteOne({slot});res.json({success:true});});

// ---------- Mari Community Center: Map / Tickets / Event Forms / Reports / Achievements ----------
const COMMUNITY_ALLOWED_TYPES = new Set(['player','place','event','shop','spawn']);
function cleanCommunityText(v,max=500){ return String(v??'').trim().slice(0,max); }
function makeCommunityId(prefix){ return prefix+'-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex'); }

app.get('/api/community/map', requireAuth, async (req,res)=>{
  const points=await db.mariMapPoints.find({enabled:{$ne:false}}).sort({order:1,createdAt:1}).limit(500).toArray();
  res.json({points:points.map(omitMongoId)});
});
app.post('/api/admin/community/map', requireAdmin, async (req,res)=>{
  const b=req.body||{}; const type=COMMUNITY_ALLOWED_TYPES.has(String(b.type))?String(b.type):'place';
  const point={id:makeCommunityId('MAP'),name:cleanCommunityText(b.name,80)||'จุดใหม่',description:cleanCommunityText(b.description,500),type,icon:cleanCommunityText(b.icon,8)||'📍',x:Number(b.x)||0,y:Number(b.y)||0,order:Number(b.order)||0,enabled:b.enabled!==false,createdAt:new Date().toISOString()};
  await db.mariMapPoints.insertOne(point); res.json({success:true,point:omitMongoId(point)});
});
app.put('/api/admin/community/map/:id', requireAdmin, async (req,res)=>{ const b=req.body||{}, set={}; for(const k of ['name','description','type','icon','x','y','order','enabled']) if(b[k]!==undefined) set[k]=k==='name'?cleanCommunityText(b[k],80):k==='description'?cleanCommunityText(b[k],500):k==='icon'?cleanCommunityText(b[k],8):k==='type'?(COMMUNITY_ALLOWED_TYPES.has(String(b[k]))?String(b[k]):'place'):k==='enabled'?!!b[k]:Number(b[k])||0; await db.mariMapPoints.updateOne({id:req.params.id},{$set:set}); res.json({success:true}); });
app.delete('/api/admin/community/map/:id', requireAdmin, async (req,res)=>{await db.mariMapPoints.deleteOne({id:req.params.id});res.json({success:true});});

app.post('/api/community/tickets', requireAuth, async (req,res)=>{ const b=req.body||{}, subject=cleanCommunityText(b.subject,120), message=cleanCommunityText(b.message,2000), category=cleanCommunityText(b.category,40)||'ทั่วไป'; if(!subject||!message)return res.status(400).json({error:'กรุณากรอกหัวข้อและรายละเอียด'}); const now=new Date().toISOString(); const t={id:makeCommunityId('TICKET'),userId:req.session.userId,subject,message,category,status:'open',createdAt:now,updatedAt:now,replies:[]}; await db.supportTickets.insertOne(t); res.json({success:true,ticket:omitMongoId(t)}); });
app.get('/api/community/tickets', requireAuth, async (req,res)=>{ const rows=await db.supportTickets.find({userId:req.session.userId}).sort({updatedAt:-1}).limit(100).toArray(); res.json({tickets:rows.map(omitMongoId)}); });
app.get('/api/admin/community/tickets', requireAdmin, async (req,res)=>{ const rows=await db.supportTickets.find({}).sort({updatedAt:-1}).limit(300).toArray(); res.json({tickets:rows.map(omitMongoId)}); });
app.patch('/api/admin/community/tickets/:id', requireAdmin, async (req,res)=>{ const b=req.body||{}, set={updatedAt:new Date().toISOString()}; if(['open','pending','closed'].includes(String(b.status)))set.status=String(b.status); if(b.reply){set.$dummy=undefined; await db.supportTickets.updateOne({id:req.params.id},{$push:{replies:{id:makeCommunityId('REP'),message:cleanCommunityText(b.reply,2000),createdAt:new Date().toISOString(),by:'admin'}},$set:set});}else await db.supportTickets.updateOne({id:req.params.id},{$set:set}); res.json({success:true}); });

app.get('/api/community/event-forms', requireAuth, async (req,res)=>{ const forms=await db.eventForms.find({enabled:{$ne:false}}).sort({createdAt:-1}).limit(100).toArray(); const mine=await db.eventFormSubmissions.find({userId:req.session.userId}).project({formId:1,status:1,createdAt:1}).toArray(); res.json({forms:forms.map(omitMongoId),mine:mine.map(omitMongoId)}); });
app.post('/api/community/event-forms/:id/submit', requireAuth, async (req,res)=>{ const form=await db.eventForms.findOne({id:req.params.id,enabled:{$ne:false}}); if(!form)return res.status(404).json({error:'ไม่พบกิจกรรม'}); const existing=await db.eventFormSubmissions.findOne({formId:form.id,userId:req.session.userId}); if(existing)return res.status(409).json({error:'คุณส่งใบสมัครกิจกรรมนี้แล้ว'}); const answers=(form.fields||[]).map(f=>({id:f.id||makeCommunityId('FIELD'),label:cleanCommunityText(f.label,120),value:cleanCommunityText(req.body?.answers?.[f.id],1000)})); const sub={id:makeCommunityId('FORM'),formId:form.id,userId:req.session.userId,answers,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; await db.eventFormSubmissions.insertOne(sub); res.json({success:true,submission:omitMongoId(sub)}); });
app.get('/api/admin/community/event-forms', requireAdmin, async (req,res)=>{ const forms=await db.eventForms.find({}).sort({createdAt:-1}).toArray(); const subs=await db.eventFormSubmissions.find({}).sort({createdAt:-1}).limit(500).toArray(); res.json({forms:forms.map(omitMongoId),submissions:subs.map(omitMongoId)}); });
app.post('/api/admin/community/event-forms', requireAdmin, async (req,res)=>{ const b=req.body||{}, form={id:makeCommunityId('FORMCFG'),title:cleanCommunityText(b.title,120)||'กิจกรรมใหม่',description:cleanCommunityText(b.description,1000),enabled:b.enabled!==false,createdAt:new Date().toISOString(),fields:Array.isArray(b.fields)?b.fields.slice(0,20).map((f,i)=>({id:cleanCommunityText(f.id,40)||'f'+i,label:cleanCommunityText(f.label,120)||'คำตอบ',required:f.required!==false})):[]}; await db.eventForms.insertOne(form); res.json({success:true,form:omitMongoId(form)}); });
app.put('/api/admin/community/event-forms/:id', requireAdmin, async (req,res)=>{ const b=req.body||{}, set={}; for(const k of ['title','description','enabled','fields']) if(b[k]!==undefined)set[k]=k==='title'?cleanCommunityText(b[k],120):k==='description'?cleanCommunityText(b[k],1000):k==='enabled'?!!b[k]:Array.isArray(b[k])?b[k].slice(0,20):[]; await db.eventForms.updateOne({id:req.params.id},{$set:set});res.json({success:true}); });
app.delete('/api/admin/community/event-forms/:id', requireAdmin, async (req,res)=>{await db.eventForms.deleteOne({id:req.params.id});await db.eventFormSubmissions.deleteMany({formId:req.params.id});res.json({success:true});});
app.patch('/api/admin/community/event-submissions/:id', requireAdmin, async (req,res)=>{ const status=['pending','approved','rejected'].includes(String(req.body?.status))?String(req.body.status):'pending'; await db.eventFormSubmissions.updateOne({id:req.params.id},{$set:{status,updatedAt:new Date().toISOString()}});res.json({success:true}); });

app.post('/api/community/reports', requireAuth, async (req,res)=>{ const b=req.body||{}, targetId=cleanCommunityText(b.targetId,100), reason=cleanCommunityText(b.reason,80), details=cleanCommunityText(b.details,1500); if(!targetId||!reason)return res.status(400).json({error:'กรุณาระบุผู้เล่นและเหตุผล'}); const target=await db.users.findOne({$or:[{id:targetId},{usernameLower:targetId.toLowerCase()}]}); if(!target)return res.status(404).json({error:'ไม่พบผู้เล่น'}); if(target.id===req.session.userId)return res.status(400).json({error:'ไม่สามารถรายงานตัวเองได้'}); const r={id:makeCommunityId('REPORT'),reporterId:req.session.userId,targetId:target.id,targetName:target.displayName||target.username,reason,details,status:'open',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; await db.playerReports.insertOne(r);res.json({success:true,report:omitMongoId(r)}); });
app.get('/api/community/reports/mine', requireAuth, async (req,res)=>{const rows=await db.playerReports.find({reporterId:req.session.userId}).sort({createdAt:-1}).limit(100).toArray();res.json({reports:rows.map(omitMongoId)});});
app.get('/api/admin/community/reports', requireAdmin, async (req,res)=>{const rows=await db.playerReports.find({}).sort({createdAt:-1}).limit(500).toArray();res.json({reports:rows.map(omitMongoId)});});
app.patch('/api/admin/community/reports/:id', requireAdmin, async (req,res)=>{const status=['open','reviewing','resolved','dismissed'].includes(String(req.body?.status))?String(req.body.status):'open';await db.playerReports.updateOne({id:req.params.id},{$set:{status,updatedAt:new Date().toISOString()}});res.json({success:true});});

app.get('/api/community/achievements', requireAuth, async (req,res)=>{const defs=await db.achievements.find({enabled:{$ne:false}}).sort({createdAt:1}).toArray();const mine=await db.userAchievements.find({userId:req.session.userId}).toArray();const got=new Set(mine.map(x=>x.achievementId));res.json({achievements:defs.map(a=>({...omitMongoId(a),unlocked:got.has(a.id)}))});});
app.get('/api/admin/community/achievements', requireAdmin, async (req,res)=>{const defs=await db.achievements.find({}).sort({createdAt:1}).toArray();const mine=await db.userAchievements.find({}).sort({createdAt:-1}).limit(1000).toArray();res.json({achievements:defs.map(omitMongoId),unlocked:mine.map(omitMongoId)});});
app.post('/api/admin/community/achievements', requireAdmin, async (req,res)=>{const b=req.body||{}, a={id:makeCommunityId('ACH'),name:cleanCommunityText(b.name,80)||'Achievement',description:cleanCommunityText(b.description,300),icon:cleanCommunityText(b.icon,8)||'🏅',enabled:b.enabled!==false,createdAt:new Date().toISOString()};await db.achievements.insertOne(a);res.json({success:true,achievement:omitMongoId(a)});});
app.put('/api/admin/community/achievements/:id', requireAdmin, async (req,res)=>{const b=req.body||{},set={};for(const k of ['name','description','icon','enabled'])if(b[k]!==undefined)set[k]=k==='name'?cleanCommunityText(b[k],80):k==='description'?cleanCommunityText(b[k],300):k==='icon'?cleanCommunityText(b[k],8):!!b[k];await db.achievements.updateOne({id:req.params.id},{$set:set});res.json({success:true});});
app.delete('/api/admin/community/achievements/:id', requireAdmin, async (req,res)=>{await db.achievements.deleteOne({id:req.params.id});await db.userAchievements.deleteMany({achievementId:req.params.id});res.json({success:true});});
app.post('/api/admin/community/achievements/:id/grant', requireAdmin, async (req,res)=>{const a=await db.achievements.findOne({id:req.params.id});if(!a)return res.status(404).json({error:'ไม่พบ Achievement'});const username=cleanCommunityText(req.body?.username,80);const u=await db.users.findOne({usernameLower:username.toLowerCase()});if(!u)return res.status(404).json({error:'ไม่พบผู้เล่น'});const exists=await db.userAchievements.findOne({userId:u.id,achievementId:a.id});if(!exists)await db.userAchievements.insertOne({id:makeCommunityId('UA'),userId:u.id,achievementId:a.id,createdAt:new Date().toISOString()});res.json({success:true});});

// ---- minimal admin API (gated by ADMIN_KEY, no session/cookie involved) ----
async function requireAdmin(req, res, next) {
  // Admin API access supports the original ADMIN_KEY and also the two
  // privileged website titles. The latter is tied to the normal login
  // session, so no admin key is exposed to the browser.
  const provided = String(req.headers['x-admin-key'] || '');
  if (ADMIN_KEY && provided) {
    const a = Buffer.from(provided);
    const b = Buffer.from(ADMIN_KEY);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (ok) return next();
  }
  try {
    const session = req.session || await getSession(req);
    const sessionUserId = session?.userId;
    if (sessionUserId && db?.users) {
      const user = await db.users.findOne({ id: sessionUserId });
      if (user && (user.titleId === 'admin' || user.titleId === 'creator')) return next();
    }
  } catch (e) {}
  if (!ADMIN_KEY) return res.status(403).json({ error: 'ยังไม่ได้ตั้งค่า ADMIN_KEY และบัญชีนี้ไม่มีฉายาสำหรับเข้าแอดมิน' });
  return res.status(401).json({ error: 'ต้องใช้รหัสแอดมิน หรือเข้าสู่ระบบด้วยฉายา แอดมิน/ผู้สร้างเซิร์ฟเวอร์และเว็บไซต์' });
}

const SITE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SITE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function cleanSiteText(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function publicActivity(activity) {
  return omitMongoId({
    ...activity,
    title: cleanSiteText(activity.title, 120),
    description: cleanSiteText(activity.description, 1000),
    date: cleanSiteText(activity.date, 80),
    location: cleanSiteText(activity.location, 120),
    imageUrl: cleanSiteText(activity.imageUrl, 500),
    ctaLabel: cleanSiteText(activity.ctaLabel, 50),
    ctaUrl: cleanSiteText(activity.ctaUrl, 500)
  });
}

// Public homepage content. It is intentionally separate from the admin
// settings route so visitors never receive the admin key or GridFS ids.
app.get('/api/site/settings', (req, res) => {
  res.json({ settings: publicSiteSettings() });
});

// Public per-page banner (custom hero an admin set from /admin.html -> 🎨
// แก้ไขเว็บ). No admin key required - every page fetches its own banner on
// load. Unknown page names just get the empty/disabled default.
app.get('/api/page-editor/:page', (req, res) => {
  const page = String(req.params.page || '');
  res.json({ page: publicPageBanner(page) });
});

app.get('/api/activities', async (req, res) => {
  try {
    const activities = await db.settings.find({ type: 'activity', enabled: { $ne: false } })
      .sort({ date: 1, createdAt: -1 }).limit(50).toArray();
    res.json({ activities: activities.map(publicActivity) });
  } catch (err) {
    res.status(500).json({ error: 'โหลดกิจกรรมไม่สำเร็จ' });
  }
});

app.get('/api/site/media/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const file = await db.settings.findOne({ type: 'siteMedia', id });
    if (!file || !file.gridFsId) return res.status(404).end();
    const meta = await db.settings.findOne({ type: 'siteMediaMeta', id: `${id}:meta` });
    const storedFile = await db.settings.findOne({ type: 'siteMediaFile', id: `${id}:file` });
    const total = Number(storedFile?.length || 0);
    res.set({
      'Content-Type': meta?.mimeType || 'image/jpeg',
      'Content-Length': String(total),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    });
    siteMediaBucket.openDownloadStream(file.gridFsId).on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    }).pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

const WEATHER_LABELS = {
  0: 'ท้องฟ้าแจ่มใส', 1: 'มีเมฆเล็กน้อย', 2: 'มีเมฆบางส่วน', 3: 'เมฆมาก',
  45: 'มีหมอก', 48: 'มีหมอกจับตัวเป็นน้ำแข็ง',
  51: 'ฝนปรอยเล็กน้อย', 53: 'ฝนปรอย', 55: 'ฝนปรอยหนัก',
  56: 'ฝนปรอยเยือกแข็ง', 57: 'ฝนปรอยเยือกแข็งหนัก',
  61: 'ฝนตกเล็กน้อย', 63: 'ฝนตก', 65: 'ฝนตกหนัก',
  66: 'ฝนเยือกแข็ง', 67: 'ฝนเยือกแข็งหนัก',
  71: 'หิมะตกเล็กน้อย', 73: 'หิมะตก', 75: 'หิมะตกหนัก', 77: 'เกล็ดหิมะ',
  80: 'ฝนซู่เล็กน้อย', 81: 'ฝนซู่', 82: 'ฝนซู่หนัก',
  85: 'หิมะซู่เล็กน้อย', 86: 'หิมะซู่หนัก',
  95: 'พายุฝนฟ้าคะนอง', 96: 'พายุฝนฟ้าคะนองมีลูกเห็บ', 99: 'พายุฝนฟ้าคะนองมีลูกเห็บหนัก'
};

const JAPAN_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FTokyo';
const JAPAN_WEATHER_FALLBACK_URL = 'https://wttr.in/Tokyo?format=j1';
const JAPAN_WEATHER_CACHE_MS = 30 * 60 * 1000;
const JAPAN_WEATHER_TIMEOUT_MS = 7000;
let japanWeatherFetchPromise = null;

function weatherLabel(code) {
  return WEATHER_LABELS[Number(code)] || 'ไม่ทราบสภาพอากาศ';
}

function normalizeOpenMeteoWeather(j) {
  const code = Number.isFinite(Number(j?.current?.weather_code)) ? Number(j.current.weather_code) : null;
  return {
    enabled: siteSettings.weather.enabled !== false,
    location: siteSettings.weather.locationLabel || 'Tokyo, Japan',
    temperature: j?.current?.temperature_2m ?? null,
    weatherCode: code,
    label: weatherLabel(code),
    windSpeed: j?.current?.wind_speed_10m ?? null,
    precipitation: j?.current?.precipitation ?? null,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeWttrWeather(j) {
  const now = j?.current_condition?.[0];
  if (!now) throw new Error('wttr returned no current weather');
  const temp = Number(now.temp_C);
  const wind = Number(now.windspeedKmph);
  const precip = Number(now.precipMM);
  const text = String(now.weatherDesc?.[0]?.value || '').toLowerCase();
  let code = 2;
  if (/thunder|storm/.test(text)) code = 95;
  else if (/snow|sleet|ice/.test(text)) code = 73;
  else if (/rain|drizzle|shower/.test(text)) code = 63;
  else if (/fog|mist/.test(text)) code = 45;
  else if (/clear|sunny/.test(text)) code = 0;
  return {
    enabled: siteSettings.weather.enabled !== false,
    location: siteSettings.weather.locationLabel || 'Tokyo, Japan',
    temperature: Number.isFinite(temp) ? temp : null,
    weatherCode: code,
    label: weatherLabel(code),
    windSpeed: Number.isFinite(wind) ? wind : null,
    precipitation: Number.isFinite(precip) ? precip : null,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JAPAN_WEATHER_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mari-JP-SMP/1.0' }
    });
    if (!upstream.ok) throw new Error(`weather upstream ${upstream.status}`);
    return await upstream.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJapanWeatherFresh() {
  try {
    return normalizeOpenMeteoWeather(await fetchJson(JAPAN_WEATHER_URL));
  } catch (openMeteoErr) {
    console.warn('[japan-weather] Open-Meteo unavailable:', openMeteoErr?.message || openMeteoErr);
    try {
      return normalizeWttrWeather(await fetchJson(JAPAN_WEATHER_FALLBACK_URL));
    } catch (wttrErr) {
      console.warn('[japan-weather] fallback provider unavailable:', wttrErr?.message || wttrErr);
      throw wttrErr;
    }
  }
}

async function saveJapanWeatherCache(data) {
  japanWeatherCache = { at: Date.now(), data };
  try {
    await db.settings.updateOne(
      { id: 'siteSettings' },
      { $set: { weatherLiveCache: { ...data, cachedAt: new Date().toISOString() } } },
      { upsert: true }
    );
  } catch (err) {
    console.warn('[japan-weather] could not persist cache:', err?.message || err);
  }
}

async function loadJapanWeatherCache() {
  try {
    const doc = await db.settings.findOne({ id: 'siteSettings' });
    const cached = doc?.weatherLiveCache;
    if (cached?.fetchedAt && cached?.temperature !== undefined) {
      const at = Date.parse(cached.cachedAt || cached.fetchedAt) || Date.now();
      japanWeatherCache = { at, data: { ...cached } };
      console.log('[japan-weather] restored cached weather from MongoDB.');
    }
  } catch (err) {
    console.warn('[japan-weather] could not restore cache:', err?.message || err);
  }
}

app.get('/api/japan-weather', async (req, res) => {
  const now = Date.now();
  if (japanWeatherCache.data && now - japanWeatherCache.at < JAPAN_WEATHER_CACHE_MS) {
    return res.json({ ...japanWeatherCache.data, cached: true, cachedAt: new Date(japanWeatherCache.at).toISOString() });
  }

  // Only ONE upstream request may be active at a time. This prevents every
  // browser tab/player from multiplying the provider's request count.
  if (!japanWeatherFetchPromise) {
    japanWeatherFetchPromise = fetchJapanWeatherFresh()
      .then(async data => {
        await saveJapanWeatherCache(data);
        return data;
      })
      .finally(() => { japanWeatherFetchPromise = null; });
  }

  try {
    const data = await japanWeatherFetchPromise;
    return res.json({ ...data, cached: false });
  } catch (err) {
    // A stale value is still useful and, importantly, gives the frontend a
    // normal 200 response instead of leaving it in a loading/retry loop.
    if (japanWeatherCache.data) {
      return res.json({
        ...japanWeatherCache.data,
        stale: true,
        cached: true,
        cachedAt: new Date(japanWeatherCache.at).toISOString(),
        warning: 'ใช้ข้อมูลสภาพอากาศล่าสุด เนื่องจากบริการสดไม่ตอบสนอง'
      });
    }
    return res.json({
      enabled: siteSettings.weather.enabled !== false,
      location: siteSettings.weather.locationLabel || 'Tokyo, Japan',
      temperature: null,
      weatherCode: null,
      label: 'ข้อมูลสดไม่พร้อมใช้งาน',
      windSpeed: null,
      precipitation: null,
      fetchedAt: null,
      unavailable: true
    });
  }
});

async function saveSiteImage(encoded, mimeType, filename) {
  const mime = String(mimeType || '').toLowerCase();
  if (!SITE_IMAGE_TYPES.has(mime)) throw new Error('รองรับรูป JPG, PNG, WEBP หรือ GIF เท่านั้น');
  const raw = String(encoded || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw || !/^[A-Za-z0-9+/=]+$/.test(raw)) throw new Error('ข้อมูลรูปภาพไม่ถูกต้อง');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > SITE_IMAGE_MAX_BYTES) {
    throw new Error('รูปภาพต้องมีขนาดไม่เกิน 8 MB');
  }
  const id = 'site-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
  const upload = siteMediaBucket.openUploadStream(String(filename || id).slice(0, 180), {
    contentType: mime,
    metadata: { siteMediaId: id }
  });
  await new Promise((resolve, reject) => {
    upload.on('error', reject);
    upload.on('finish', resolve);
    upload.end(buffer);
  });
  await db.settings.insertOne({
    id,
    type: 'siteMedia',
    gridFsId: upload.id,
    createdAt: new Date().toISOString()
  });
  await db.settings.insertOne({
    id: `${id}:meta`,
    type: 'siteMediaMeta',
    mimeType: mime,
    filename: String(filename || id).slice(0, 180),
    createdAt: new Date().toISOString()
  });
  await db.settings.insertOne({
    id: `${id}:file`,
    type: 'siteMediaFile',
    length: buffer.length,
    createdAt: new Date().toISOString()
  });
  return { id, url: `/api/site/media/${encodeURIComponent(id)}` };
}

async function deleteSiteImage(id) {
  if (!id) return;
  const file = await db.settings.findOne({ type: 'siteMedia', id });
  if (file?.gridFsId) await siteMediaBucket.delete(file.gridFsId).catch(() => {});
  await db.settings.deleteMany({
    type: { $in: ['siteMedia', 'siteMediaMeta', 'siteMediaFile'] },
    id: { $in: [id, `${id}:meta`, `${id}:file`] }
  });
}

app.get('/api/admin/global-ui', requireAdmin, async (req, res) => {
  res.json({ globalUi: publicSiteSettings().globalUi });
});

app.put('/api/admin/global-ui', requireAdmin, async (req, res) => {
  try {
    const input = req.body?.globalUi || req.body || {};
    siteSettings.globalUi = {
      ...DEFAULT_SITE_SETTINGS.globalUi,
      ...(siteSettings.globalUi || {}),
      musicBarEnabled: input.musicBarEnabled !== false,
      hideButtonEnabled: input.hideButtonEnabled !== false,
      restoreButtonEnabled: input.restoreButtonEnabled !== false,
      rememberHidden: input.rememberHidden !== false,
      hideButtonLabel: cleanSiteText(input.hideButtonLabel, 30) || DEFAULT_SITE_SETTINGS.globalUi.hideButtonLabel,
      restoreButtonLabel: cleanSiteText(input.restoreButtonLabel, 60) || DEFAULT_SITE_SETTINGS.globalUi.restoreButtonLabel
    };
    await db.settings.updateOne(
      { id: 'siteSettings' },
      { $set: { globalUi: siteSettings.globalUi } },
      { upsert: true }
    );
    res.json({ success: true, globalUi: publicSiteSettings().globalUi });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึก Global UI ไม่สำเร็จ' });
  }
});

app.get('/api/admin/site', requireAdmin, async (req, res) => {
  const activities = await db.settings.find({ type: 'activity' })
    .sort({ date: 1, createdAt: -1 }).limit(100).toArray();
  res.json({ settings: publicSiteSettings(), activities: activities.map(publicActivity) });
});

// Admin: generic per-page website editor (same fields/UX as the 🏠
// homepage hero editor above) for promo.html and every other public page.
// Gated by the same ADMIN_KEY as the rest of /api/admin/*.
app.get('/api/admin/page-editor', requireAdmin, (req, res) => {
  res.json({ pages: pageEditorSettings, availablePages: PAGE_EDITOR_PAGES });
});

app.put('/api/admin/page-editor/:page', requireAdmin, async (req, res) => {
  try {
    const page = String(req.params.page || '');
    if (!PAGE_EDITOR_PAGES.includes(page)) {
      return res.status(400).json({ error: 'ไม่รู้จักหน้าเว็บนี้' });
    }
    const body = req.body || {};
    const current = pageEditorSettings[page] || defaultPageBanner();
    const entry = {
      ...current,
      eyebrow: cleanSiteText(body.eyebrow, 80),
      title: cleanSiteText(body.title, 100),
      subtitle: cleanSiteText(body.subtitle, 180),
      buttonLabel: cleanSiteText(body.buttonLabel, 60),
      buttonUrl: cleanPageLink(body.buttonUrl),
      enabled: body.enabled !== false
    };
    if (page === 'auth') {
      entry.authTitle = cleanSiteText(body.authTitle, 100) || current.authTitle || 'Mari JP SMP';
      entry.authSubtitle = cleanSiteText(body.authSubtitle, 180) || current.authSubtitle || 'เข้าสู่ระบบเพื่อไปต่อ';
      entry.accent = /^#[0-9a-fA-F]{6}$/.test(String(body.accent || '')) ? String(body.accent) : (current.accent || '#ee7fa5');
      entry.animation = ['none','float','glow','particles','float-glow'].includes(body.animation) ? body.animation : (current.animation || 'float');
      entry.animationIntensity = clamp(Number(body.animationIntensity) || 1, 0, 2);
      entry.glass = body.glass !== false;
      entry.particles = body.particles !== false;
      entry.backgroundImageUrl = current.backgroundImageUrl || '';
      entry.backgroundImageId = current.backgroundImageId || '';
    }
    await db.settings.updateOne(
      { id: 'pageEditor' },
      { $set: { [`pages.${page}`]: entry } },
      { upsert: true }
    );
    pageEditorSettings[page] = entry; // only after the database accepted it
    res.json({ page: entry });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกแบนเนอร์ไม่สำเร็จ' });
  }
});

app.post('/api/admin/page-editor/:page/banner-image', requireAdmin, async (req, res) => {
  try {
    const page = String(req.params.page || '');
    if (!PAGE_EDITOR_PAGES.includes(page)) return res.status(400).json({ error: 'ไม่รู้จักหน้าเว็บนี้' });
    const current = pageEditorSettings[page] || defaultPageBanner();
    const oldId = current.bannerImageId;
    const image = await saveSiteImage(req.body?.data, req.body?.mimeType, req.body?.filename);
    const entry = { ...current, bannerImageId: image.id, bannerImageUrl: image.url };
    pageEditorSettings[page] = entry;
    await db.settings.updateOne({ id: 'pageEditor' }, { $set: { [`pages.${page}`]: entry } }, { upsert: true });
    if (oldId) await deleteSiteImage(oldId);
    res.json({ page: entry });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปไม่สำเร็จ' });
  }
});

app.delete('/api/admin/page-editor/:page/banner-image', requireAdmin, async (req, res) => {
  try {
    const page = String(req.params.page || '');
    if (!PAGE_EDITOR_PAGES.includes(page)) return res.status(400).json({ error: 'ไม่รู้จักหน้าเว็บนี้' });
    const current = pageEditorSettings[page] || defaultPageBanner();
    const oldId = current.bannerImageId;
    const entry = { ...current, bannerImageId: '', bannerImageUrl: '' };
    await db.settings.updateOne({ id: 'pageEditor' }, { $set: { [`pages.${page}`]: entry } }, { upsert: true });
    pageEditorSettings[page] = entry;
    if (oldId) await deleteSiteImage(oldId);
    res.json({ page: entry });
  } catch (err) {
    res.status(500).json({ error: 'ลบรูปแบนเนอร์ไม่สำเร็จ' });
  }
});

app.post('/api/admin/page-editor/auth/background-image', requireAdmin, async (req, res) => {
  try {
    const current = pageEditorSettings.auth || defaultPageBanner();
    const oldId = current.backgroundImageId;
    const image = await saveSiteImage(req.body?.data, req.body?.mimeType, req.body?.filename);
    const entry = { ...current, backgroundImageId: image.id, backgroundImageUrl: image.url };
    await db.settings.updateOne({ id: 'pageEditor' }, { $set: { 'pages.auth': entry } }, { upsert: true });
    pageEditorSettings.auth = entry;
    if (oldId) await deleteSiteImage(oldId);
    res.json({ page: entry });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปพื้นหลังไม่สำเร็จ' });
  }
});

app.delete('/api/admin/page-editor/auth/background-image', requireAdmin, async (req, res) => {
  try {
    const current = pageEditorSettings.auth || defaultPageBanner();
    const oldId = current.backgroundImageId;
    const entry = { ...current, backgroundImageId: '', backgroundImageUrl: '' };
    await db.settings.updateOne({ id: 'pageEditor' }, { $set: { 'pages.auth': entry } }, { upsert: true });
    pageEditorSettings.auth = entry;
    if (oldId) await deleteSiteImage(oldId);
    res.json({ page: entry });
  } catch (err) {
    res.status(500).json({ error: 'ลบรูปพื้นหลังไม่สำเร็จ' });
  }
});

app.put('/api/admin/site', requireAdmin, async (req, res) => {
  try {
    const homeInput = req.body?.home || {};
    const weatherInput = req.body?.weather || {};
    siteSettings.home = {
      ...siteSettings.home,
      eyebrow: cleanSiteText(homeInput.eyebrow, 80) || DEFAULT_SITE_SETTINGS.home.eyebrow,
      title: cleanSiteText(homeInput.title, 80) || DEFAULT_SITE_SETTINGS.home.title,
      siteName: cleanSiteText(homeInput.siteName, 100) || DEFAULT_SITE_SETTINGS.home.siteName,
      subtitle: cleanSiteText(homeInput.subtitle, 120) || DEFAULT_SITE_SETTINGS.home.subtitle,
      announcement: cleanSiteText(homeInput.announcement, 240),
      accent: /^#[0-9a-fA-F]{6}$/.test(String(homeInput.accent || '')) ? homeInput.accent : siteSettings.home.accent
    };
    siteSettings.discord = {
      ...siteSettings.discord,
      label: cleanSiteText(req.body?.discord?.label, 60) || DEFAULT_SITE_SETTINGS.discord.label,
      subtitle: cleanSiteText(req.body?.discord?.subtitle, 80) || DEFAULT_SITE_SETTINGS.discord.subtitle
    };
    siteSettings.promo = {
      ...siteSettings.promo,
      heading: cleanSiteText(req.body?.promo?.heading, 100) || DEFAULT_SITE_SETTINGS.promo.heading,
      subtitle: cleanSiteText(req.body?.promo?.subtitle, 180),
      title: cleanSiteText(req.body?.promo?.title, 120),
      buttonLabel: cleanSiteText(req.body?.promo?.buttonLabel, 60),
      buttonUrl: cleanSiteText(req.body?.promo?.buttonUrl, 500)
    };
    siteSettings.weather = {
      ...siteSettings.weather,
      enabled: weatherInput.enabled !== false,
      locationLabel: cleanSiteText(weatherInput.locationLabel, 80) || 'Tokyo, Japan',
      effectIntensity: clamp(Number(weatherInput.effectIntensity) || 1, 0.2, 2)
    };
    if (Array.isArray(req.body?.navigation)) {
      const navigation = [];
      const seen = new Set();
      for (const [index, raw] of req.body.navigation.slice(0, 20).entries()) {
        const id = String(raw?.id || `menu_${index + 1}`).trim().slice(0, 40);
        const label = cleanSiteText(raw?.label, 40);
        const icon = String(raw?.icon || '🔗').trim().slice(0, 8);
        const target = String(raw?.target || '').trim().slice(0, 200);
        if (!label || !target || seen.has(id)) continue;
        if (!/^#[A-Za-z0-9_-]+$/.test(target) && !/^\/[A-Za-z0-9_./?=&-]+$/.test(target) && !/^https?:\/\//i.test(target)) continue;
        seen.add(id);
        navigation.push({ id, label, icon, target, enabled: raw?.enabled !== false, order: index + 1 });
      }
      if (navigation.length) siteSettings.navigation = navigation;
    }
    await db.settings.updateOne({ id: 'siteSettings' }, { $set: { ...siteSettings } }, { upsert: true });
    res.json({ success: true, settings: publicSiteSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึกหน้าแรกไม่สำเร็จ' });
  }
});

app.post('/api/admin/site/hero-image', requireAdmin, async (req, res) => {
  try {
    const oldId = siteSettings.home.heroImageId;
    const image = await saveSiteImage(req.body?.data, req.body?.mimeType, req.body?.filename);
    siteSettings.home.heroImageId = image.id;
    siteSettings.home.heroImageUrl = image.url;
    await db.settings.updateOne({ id: 'siteSettings' }, { $set: { home: siteSettings.home, weather: siteSettings.weather } }, { upsert: true });
    if (oldId) await deleteSiteImage(oldId);
    res.json({ success: true, imageUrl: image.url, settings: publicSiteSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปไม่สำเร็จ' });
  }
});

app.delete('/api/admin/site/hero-image', requireAdmin, async (req, res) => {
  const oldId = siteSettings.home.heroImageId;
  siteSettings.home.heroImageId = '';
  siteSettings.home.heroImageUrl = '';
  await db.settings.updateOne({ id: 'siteSettings' }, { $set: { home: siteSettings.home, weather: siteSettings.weather } }, { upsert: true });
  if (oldId) await deleteSiteImage(oldId);
  res.json({ success: true, settings: publicSiteSettings() });
});

app.post('/api/admin/site/promo-image', requireAdmin, async (req, res) => {
  try {
    const oldId = siteSettings.promo.imageId;
    const image = await saveSiteImage(req.body?.data, req.body?.mimeType, req.body?.filename);
    siteSettings.promo.imageId = image.id;
    siteSettings.promo.imageUrl = image.url;
    await db.settings.updateOne({ id: 'siteSettings' }, { $set: { home: siteSettings.home, discord: siteSettings.discord, promo: siteSettings.promo, weather: siteSettings.weather } }, { upsert: true });
    if (oldId) await deleteSiteImage(oldId);
    res.json({ success: true, imageUrl: image.url, settings: publicSiteSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปโปรโมชั่นไม่สำเร็จ' });
  }
});

app.delete('/api/admin/site/promo-image', requireAdmin, async (req, res) => {
  const oldId = siteSettings.promo.imageId;
  siteSettings.promo.imageId = '';
  siteSettings.promo.imageUrl = '';
  await db.settings.updateOne({ id: 'siteSettings' }, { $set: { home: siteSettings.home, discord: siteSettings.discord, promo: siteSettings.promo, weather: siteSettings.weather } }, { upsert: true });
  if (oldId) await deleteSiteImage(oldId);
  res.json({ success: true, settings: publicSiteSettings() });
});

app.post('/api/admin/activities', requireAdmin, async (req, res) => {
  try {
    const title = cleanSiteText(req.body?.title, 120);
    if (!title) return res.status(400).json({ error: 'กรุณาใส่ชื่อกิจกรรม' });
    let image = { id: '', url: '' };
    if (req.body?.imageData) image = await saveSiteImage(req.body.imageData, req.body.imageMimeType, req.body.imageFilename);
    const activity = {
      id: 'ACT-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      type: 'activity',
      title,
      description: cleanSiteText(req.body?.description, 1000),
      date: cleanSiteText(req.body?.date, 80),
      location: cleanSiteText(req.body?.location, 120),
      imageUrl: image.url,
      imageId: image.id,
      ctaLabel: cleanSiteText(req.body?.ctaLabel, 50),
      ctaUrl: cleanSiteText(req.body?.ctaUrl, 500),
      enabled: req.body?.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await db.settings.insertOne(activity);
    res.json({ success: true, activity: publicActivity(activity) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'เพิ่มกิจกรรมไม่สำเร็จ' });
  }
});

app.put('/api/admin/activities/:id', requireAdmin, async (req, res) => {
  try {
    const old = await db.settings.findOne({ id: req.params.id, type: 'activity' });
    if (!old) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
    const next = {
      title: cleanSiteText(req.body?.title, 120) || old.title,
      description: cleanSiteText(req.body?.description, 1000),
      date: cleanSiteText(req.body?.date, 80),
      location: cleanSiteText(req.body?.location, 120),
      ctaLabel: cleanSiteText(req.body?.ctaLabel, 50),
      ctaUrl: cleanSiteText(req.body?.ctaUrl, 500),
      enabled: req.body?.enabled !== false,
      updatedAt: new Date().toISOString()
    };
    if (req.body?.imageData) {
      const image = await saveSiteImage(req.body.imageData, req.body.imageMimeType, req.body.imageFilename);
      next.imageUrl = image.url;
      next.imageId = image.id;
      if (old.imageId) await deleteSiteImage(old.imageId);
    }
    await db.settings.updateOne({ id: req.params.id, type: 'activity' }, { $set: next });
    res.json({ success: true, activity: publicActivity({ ...old, ...next }) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'แก้ไขกิจกรรมไม่สำเร็จ' });
  }
});

app.delete('/api/admin/activities/:id', requireAdmin, async (req, res) => {
  const old = await db.settings.findOne({ id: req.params.id, type: 'activity' });
  if (!old) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
  await db.settings.deleteOne({ id: req.params.id, type: 'activity' });
  if (old.imageId) await deleteSiteImage(old.imageId);
  res.json({ success: true });
});


// ---- leaderboard + raffle events (admin-configurable) ----
const DEFAULT_EVENT_CONFIG = {
  id: 'eventConfig',
  leaderboard: { enabled: true, title: '🏆 กระดานอันดับ', source: 'topup', periodType: 'month', periodValue: 1, periodDays: 30, startAt: '', endAt: '', topN: 10, rewards: [{ rank: 1, amount: 500 }, { rank: 2, amount: 300 }, { rank: 3, amount: 100 }] },
  raffle: { enabled: false, title: '🎟️ จับฉลาก', criterion: 'topup', minTopup: 0, periodType: 'month', periodValue: 1, periodDays: 30, startAt: '', endAt: '', winners: 1, rewards: [{ rank: 1, amount: 500 }], drawn: false, drawnAt: '' },
  updatedAt: new Date().toISOString()
};
function cleanRewards(value, max=20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,max).map((r,i)=>({ rank: Math.max(1, Math.trunc(Number(r?.rank)||i+1)), amount: Math.max(0, Math.trunc(Number(r?.amount)||0)), label: cleanSiteText(r?.label,120) })).filter(r=>r.amount>0);
}
function cleanEventPart(raw, fallback) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const periodType = ['days','month','custom'].includes(String(x.periodType)) ? String(x.periodType) : fallback.periodType;
  return {
    ...fallback,
    ...x,
    enabled: x.enabled !== false,
    title: cleanSiteText(x.title,120) || fallback.title,
    source: ['topup','race','wheel'].includes(String(x.source)) ? String(x.source) : fallback.source,
    criterion: String(x.criterion)==='topup' ? 'topup' : fallback.criterion,
    minTopup: Math.max(0, Math.trunc(Number(x.minTopup)||0)),
    periodType,
    periodValue: Math.max(1, Math.min(24, Math.trunc(Number(x.periodValue)||fallback.periodValue||1))),
    periodDays: Math.max(1, Math.min(365, Math.trunc(Number(x.periodDays)||fallback.periodDays||30))),
    startAt: cleanSiteText(x.startAt,40), endAt: cleanSiteText(x.endAt,40),
    topN: Math.max(1, Math.min(100, Math.trunc(Number(x.topN)||fallback.topN||10))),
    winners: Math.max(1, Math.min(50, Math.trunc(Number(x.winners)||fallback.winners||1))),
    rewards: cleanRewards(x.rewards).length ? cleanRewards(x.rewards) : fallback.rewards,
    drawn: !!x.drawn, drawnAt: cleanSiteText(x.drawnAt,40)
  };
}
function eventWindow(part, now=Date.now()) {
  if (part.periodType==='custom' && part.startAt && part.endAt) {
    const a=Date.parse(part.startAt), b=Date.parse(part.endAt); if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)return {start:a,end:b};
  }
  if (part.periodType==='days') return {start:now-part.periodDays*86400000,end:now};
  const d=new Date(now); const months=Math.max(1,part.periodValue||1); const start=new Date(d.getFullYear(),d.getMonth()-months+1,1).getTime(); return {start,end:now};
}
async function getEventConfig(){
  const saved=await db.eventConfigs.findOne({id:'eventConfig'});
  return saved ? { ...DEFAULT_EVENT_CONFIG, ...saved, leaderboard:cleanEventPart(saved.leaderboard,DEFAULT_EVENT_CONFIG.leaderboard), raffle:cleanEventPart(saved.raffle,DEFAULT_EVENT_CONFIG.raffle) } : DEFAULT_EVENT_CONFIG;
}
async function getTopupLeaderboard(part){
  const w=eventWindow(part); const startIso=new Date(w.start).toISOString(), endIso=new Date(w.end).toISOString();
  const sums=new Map();
  if(part.source==='race'){
    const rows=await db.raceMatches.find({status:'finished',finishedAt:{$gte:startIso,$lte:endIso},winnerId:{$ne:null}}).toArray();
    for(const r of rows){const id=String(r.winnerId||''); if(id)sums.set(id,(sums.get(id)||0)+1);}
  } else if(part.source==='wheel'){
    const rows=await db.wheelSpins.find({createdAt:{$gte:startIso,$lte:endIso}}).toArray();
    for(const r of rows){const id=String(r.userId||''); if(id)sums.set(id,(sums.get(id)||0)+Number(r.payout||0));}
  } else {
    const rows=await db.topups.find({status:'approved',createdAt:{$gte:startIso,$lte:endIso}}).toArray();
    for(const r of rows){const id=String(r.userId||r.uid||''); if(!id)continue; sums.set(id,(sums.get(id)||0)+Number(r.amount||r.creditAmount||0));}
  }
  const ids=[...sums.entries()].sort((a,b)=>b[1]-a[1]).slice(0,part.topN||10).map(x=>x[0]);
  const users=await db.users.find({id:{$in:ids}}).toArray(); const by=new Map(users.map(u=>[u.id,u]));
  return ids.map((id,i)=>({rank:i+1,userId:id,uid:by.get(id)?.uid||'',name:by.get(id)?.displayName||by.get(id)?.username||'ผู้เล่น',avatarUrl:by.get(id)?.avatarUrl||'',value:sums.get(id)||0,reward:(part.rewards||[]).find(r=>Number(r.rank)===i+1)?.amount||0}));
}
async function raffleCandidates(part){
  const w=eventWindow(part); const rows=await db.topups.find({status:'approved',createdAt:{$gte:new Date(w.start).toISOString(),$lte:new Date(w.end).toISOString()}}).toArray();
  const sums=new Map(); for(const r of rows){const id=String(r.userId||r.uid||''); if(id)sums.set(id,(sums.get(id)||0)+Number(r.amount||r.creditAmount||0));}
  const eligible=[...sums.entries()].filter(([,v])=>v>=Number(part.minTopup||0)).map(([id,v])=>({id,total:v}));
  const users=await db.users.find({id:{$in:eligible.map(x=>x.id)}}).toArray(); const by=new Map(users.map(u=>[u.id,u]));
  return eligible.filter(x=>by.has(x.id)).map(x=>({userId:x.id,total:x.total,uid:by.get(x.id).uid||'',name:by.get(x.id).displayName||by.get(x.id).username||'ผู้เล่น',avatarUrl:by.get(x.id).avatarUrl||''}));
}
app.get('/api/events', async (req,res)=>{
  try { const c=await getEventConfig(); const leaderboard=c.leaderboard.enabled?await getTopupLeaderboard(c.leaderboard):[]; const raffle={...c.raffle, rewards:undefined}; res.json({leaderboard,leaderboardConfig:c.leaderboard,raffleConfig:raffle}); } catch(e){res.status(500).json({error:'โหลดกิจกรรมไม่สำเร็จ'});}
});
app.get('/api/admin/events', requireAdmin, async (req,res)=>{ const c=await getEventConfig(); const leaderboard=c.leaderboard.enabled?await getTopupLeaderboard(c.leaderboard):[]; const candidates=c.raffle.enabled?await raffleCandidates(c.raffle):[]; res.json({config:c,leaderboard,candidates}); });
app.put('/api/admin/events', requireAdmin, async (req,res)=>{ try { const c=await getEventConfig(); const next={id:'eventConfig',leaderboard:cleanEventPart(req.body?.leaderboard,c.leaderboard),raffle:cleanEventPart(req.body?.raffle,c.raffle),updatedAt:new Date().toISOString()}; await db.eventConfigs.updateOne({id:'eventConfig'},{$set:next},{upsert:true}); res.json({success:true,config:next}); } catch(e){res.status(400).json({error:e.message||'บันทึกกิจกรรมไม่สำเร็จ'});} });
app.post('/api/admin/events/raffle/draw', requireAdmin, async (req,res)=>{ try { const c=await getEventConfig(); if(!c.raffle.enabled)return res.status(400).json({error:'ยังไม่ได้เปิดระบบจับฉลาก'}); if(c.raffle.drawn && !req.body?.force)return res.status(400).json({error:'กิจกรรมนี้สุ่มไปแล้ว หากต้องการสุ่มใหม่ให้ยืนยัน force'}); const pool=await raffleCandidates(c.raffle); if(!pool.length)return res.status(400).json({error:'ไม่มีผู้มีสิทธิ์ร่วมจับฉลาก'}); const winners=[]; const remaining=[...pool]; for(let i=0;i<Math.min(c.raffle.winners,remaining.length);i++){const idx=crypto.randomInt(0,remaining.length); const w=remaining.splice(idx,1)[0]; winners.push({...w,rank:i+1,reward:Number(c.raffle.rewards.find(r=>Number(r.rank)===i+1)?.amount||0)});} const now=new Date().toISOString(); for(const w of winners){ if(w.reward>0) await db.users.updateOne({id:w.userId},{$inc:{balance:w.reward}}); await db.notifications.insertOne({id:'NT-EVENT-'+Date.now().toString(36)+'-'+i18nSafeId(w.userId),userId:w.userId,title:'🎉 จับฉลากกิจกรรม',message:`คุณถูกรางวัลอันดับ ${w.rank} ได้รับเครดิต ฿${w.reward.toLocaleString()}`,read:false,createdAt:now}); await db.eventResults.insertOne({type:'raffle',userId:w.userId,uid:w.uid,name:w.name,reward:w.reward,rank:w.rank,drawnAt:now}); } await db.eventConfigs.updateOne({id:'eventConfig'},{$set:{'raffle.drawn':true,'raffle.drawnAt':now} }); res.json({success:true,winners}); } catch(e){res.status(500).json({error:e.message||'จับฉลากไม่สำเร็จ'});} });
function i18nSafeId(x){ return crypto.createHash('sha1').update(String(x)).digest('hex').slice(0,10); }
app.post('/api/admin/events/reset-raffle', requireAdmin, async (req,res)=>{ await db.eventConfigs.updateOne({id:'eventConfig'},{$set:{'raffle.drawn':false,'raffle.drawnAt':''}},{upsert:true}); res.json({success:true}); });

// ---- admin: content of every page (text/image edits, hidden cards, blocks, announcement bar) ----
app.get('/api/site/pages', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(publicPageContent());
});

app.get('/api/admin/pages', requireAdmin, (req, res) => {
  res.json({ ...pageContent, pageIds: PAGE_CONTENT_IDS });
});

// Uploads only store the image and hand back its URL; whatever uses it (a block or an image
// replacement) is saved by PUT /api/admin/pages below.
app.post('/api/admin/pages/image', requireAdmin, async (req, res) => {
  try {
    const image = await saveSiteImage(req.body?.data, req.body?.mimeType, req.body?.filename);
    res.json({ success: true, imageUrl: image.url, imageId: image.id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'อัปโหลดรูปไม่สำเร็จ' });
  }
});

app.put('/api/admin/pages', requireAdmin, async (req, res) => {
  try {
    const next = cleanPageContent(req.body);
    const oldIds = collectPageImageIds(pageContent);
    const newIds = collectPageImageIds(next);
    await db.settings.updateOne(
      { id: 'pageContent' },
      { $set: { id: 'pageContent', ...next, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    pageContent = next;
    // Remove images nothing uses any more - but never the hero/promo/banner/activity images,
    // in case a block pointed at one of them.
    for (const imageId of oldIds) {
      if (newIds.has(imageId)) continue;
      if (imageId === siteSettings.home.heroImageId || imageId === siteSettings.promo.imageId) continue;
      if (imageId === loaderSettings.imageId) continue;
      if (Object.values(pageEditorSettings).some(p => p && p.bannerImageId === imageId)) continue;
      if (await db.settings.findOne({ type: 'activity', imageId })) continue;
      await deleteSiteImage(imageId).catch(() => {});
    }
    res.json({ success: true, ...pageContent, pageIds: PAGE_CONTENT_IDS });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึกหน้าเว็บไม่สำเร็จ' });
  }
});

// ---- Japanese translations (public read, admin write) ----
app.get('/api/site/i18n', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ exact: i18nExactMap() });
});

app.get('/api/admin/i18n', requireAdmin, (req, res) => {
  res.json({ entries: i18nCustom });
});

app.put('/api/admin/i18n', requireAdmin, async (req, res) => {
  try {
    const entries = cleanI18nEntries(req.body && (req.body.entries || req.body.exact));
    await db.settings.updateOne(
      { id: 'i18nCustom' },
      { $set: { id: 'i18nCustom', entries, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    i18nCustom = entries;
    res.json({ success: true, entries: i18nCustom });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึกคำแปลไม่สำเร็จ' });
  }
});

// ---- page loading screen (loading-studio.html) ----
app.get('/api/loader', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ loader: publicLoader() });
});

app.get('/api/admin/loader', requireAdmin, (req, res) => {
  res.json({ loader: publicLoader() });
});

app.put('/api/admin/loader', requireAdmin, async (req, res) => {
  try {
    const next = cleanLoader(req.body, new Date().toISOString());
    await db.settings.updateOne({ id: 'loader' }, { $set: { id: 'loader', ...next } }, { upsert: true });
    const oldId = loaderSettings.imageId;
    loaderSettings = next;
    // drop the previous custom image once nothing uses it (never a hero/promo/banner/block image)
    if (oldId && oldId !== next.imageId
      && oldId !== siteSettings.home.heroImageId && oldId !== siteSettings.promo.imageId
      && !collectPageImageIds(pageContent).has(oldId)
      && !Object.values(pageEditorSettings).some(p => p && p.bannerImageId === oldId)
      && !(await db.settings.findOne({ type: 'activity', imageId: oldId }))) {
      await deleteSiteImage(oldId).catch(() => {});
    }
    res.json({ loader: publicLoader() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึกหน้าโหลดไม่สำเร็จ' });
  }
});

// ---- admin: win/lose rates for the race + wheel mini-games ----
// Read-only for everyone else - the wheel weights are deliberately never
// exposed on /api/wheel/config (see comment there), and the race bot rate
// isn't exposed to players at all.
app.get('/api/admin/chat-retention', requireAdmin, async (req, res) => {
  const days = await getChatRetentionDays();
  res.json({ days, options: CHAT_RETENTION_OPTIONS });
});

app.put('/api/admin/chat-retention', requireAdmin, async (req, res) => {
  const days = normalizeChatRetentionDays(req.body?.days);
  if (!CHAT_RETENTION_OPTIONS.includes(Number(req.body?.days))) {
    return res.status(400).json({ error: 'เลือกระยะเวลาได้เฉพาะ 1, 3, 5, 7, 9, 20 หรือ 30 วัน' });
  }
  await db.settings.updateOne(
    { id: 'chatRetention' },
    { $set: { id: 'chatRetention', days, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  await cleanupExpiredChatMessages();
  res.json({ success: true, days, options: CHAT_RETENTION_OPTIONS });
});

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

// ---- admin: daily login calendar config (31 slots, day-of-month based) ----
app.get('/api/admin/checkin/config', requireAdmin, (req, res) => {
  res.json({
    rewards: [...(gameSettings.checkinRewards || [])].sort((a, b) => a.day - b.day),
    maxQuantityPerDay: CHECKIN_MAX_QUANTITY_PER_DAY,
    autoDelivery: GAME_CONSOLE_ENABLED
  });
});

app.post('/api/admin/checkin/config', requireAdmin, async (req, res) => {
  try {
    const input = req.body?.rewards;
    if (!Array.isArray(input) || !input.length) {
      return res.status(400).json({ error: 'ต้องมีรางวัลอย่างน้อย 1 วัน' });
    }
    if (input.length > 31) {
      return res.status(400).json({ error: 'ตั้งได้สูงสุด 31 วัน (1 เดือน)' });
    }
    const seenDays = new Set();
    const rewards = [];
    for (const raw of input) {
      const day = Math.trunc(Number(raw?.day));
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        return res.status(400).json({ error: `วันที่ไม่ถูกต้อง: ${raw?.day} (ต้องเป็น 1-31)` });
      }
      if (seenDays.has(day)) return res.status(400).json({ error: `วันที่ ${day} ซ้ำกัน` });
      seenDays.add(day);

      const label = String(raw?.label || '').trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: `กรุณาใส่ชื่อของรางวัลวันที่ ${day}` });

      const icon = String(raw?.icon || '🎁').trim().slice(0, 8) || '🎁';

      // "แจกไม่เกิน 2-3 ชิ้นต่อไอเทม" - hard-capped here regardless of input.
      let quantity = Math.trunc(Number(raw?.quantity));
      if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
      quantity = clamp(quantity, 1, CHECKIN_MAX_QUANTITY_PER_DAY);

      // Optional - a raw console command with {player}/{quantity}
      // placeholders, exactly like the Item SHOP's commandTemplate. Left
      // blank = this day stays manual-delivery-only even when the
      // console is otherwise connected.
      const commandTemplate = String(raw?.commandTemplate || '').trim().slice(0, 200);

      rewards.push({ day, icon, label, quantity, commandTemplate });
    }
    rewards.sort((a, b) => a.day - b.day);

    gameSettings.checkinRewards = rewards;
    await db.settings.updateOne(
      { id: 'gameSettings' },
      { $set: { checkinRewards: rewards } },
      { upsert: true }
    );
    res.json({ success: true, rewards });
  } catch (err) {
    res.status(500).json({ error: err.message || 'บันทึกไม่สำเร็จ' });
  }
});

// ---- admin: view / deliver claims from the daily login calendar ----
// Delivery is manual by design (see note above db.checkins) - this list is
// how staff see who's owed what and mark it handed out.
app.get('/api/admin/checkin/claims', requireAdmin, async (req, res) => {
  const status = String(req.query?.status || 'pending'); // pending | delivered | all
  const filter = status === 'all' ? {} : { delivered: status === 'delivered' };
  const claims = await db.checkins.find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  const userIds = [...new Set(claims.map(c => c.userId))];
  const users = await db.users.find({ id: { $in: userIds } }).toArray();
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    claims: claims.map(c => ({
      ...omitMongoId(c),
      username: userById[c.userId]?.username || '(ไม่พบบัญชี)'
    }))
  });
});

app.post('/api/admin/checkin/claims/:id/deliver', requireAdmin, async (req, res) => {
  const updated = await db.checkins.findOneAndUpdate(
    { id: req.params.id },
    { $set: { delivered: true, status: 'ส่งของแล้ว (แอดมินยืนยัน)', deliveredAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  const claim = updated?.value || updated;
  if (!claim) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
  res.json({ success: true, claim: omitMongoId(claim) });
});

// Undo a claim entirely (e.g. wrong Minecraft name, mistaken click) - also
// frees up that calendar day so the player can claim it again, since the
// unique index is what blocked the second claim in the first place.
app.delete('/api/admin/checkin/claims/:id', requireAdmin, async (req, res) => {
  const deleted = await db.checkins.findOneAndDelete({ id: req.params.id });
  const claim = deleted?.value || deleted;
  if (!claim) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
  res.json({ success: true, claim: omitMongoId(claim) });
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
    // A purely numeric search also matches by account uid (exact), in
    // addition to the usual username substring match.
    filter.$or = [{ usernameLower: { $regex: escaped } }];
    if (/^\d+$/.test(search)) filter.$or.push({ uid: Number(search) });
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
    users: users.map(adminUserView)
  });
});

function adminUserView(user) {
  return {
    ...publicUser(user),
    createdAt: user.createdAt || '',
    moderation: getModerationStatus(user)
  };
}

const MODERATION_DURATIONS_MS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};
const MODERATION_DURATION_LABELS = {
  '1h': '1 ชั่วโมง',
  '1d': '1 วัน',
  '7d': '7 วัน',
  permanent: 'ถาวร'
};

function moderationDuration(duration) {
  const key = String(duration || '').trim().toLowerCase();
  if (key === 'permanent') return { key, permanent: true, until: null };
  if (!Object.prototype.hasOwnProperty.call(MODERATION_DURATIONS_MS, key)) return null;
  return { key, permanent: false, until: new Date(Date.now() + MODERATION_DURATIONS_MS[key]).toISOString() };
}

async function recordModerationAction({ user, action, adminLabel = 'ADMIN', reason = '', until = null, permanent = false, durationKey = '' }) {
  const record = {
    id: 'MOD-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase(),
    userId: user.id,
    username: user.username,
    uid: user.uid || null,
    action,
    reason: String(reason || '').slice(0, 500),
    duration: durationKey || (permanent ? 'permanent' : ''),
    until: until || null,
    permanent: permanent === true,
    admin: adminLabel,
    createdAt: new Date().toISOString()
  };
  await db.moderationActions.insertOne(record);
  return record;
}

app.post('/api/admin/users/:id/mute', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    const action = String(req.body?.action || 'mute').trim().toLowerCase();
    if (action === 'unmute') {
      const current = getModerationStatus(user);
      await db.users.updateOne({ id: user.id }, { $set: { 'moderation.mute': null } });
      await recordModerationAction({ user, action: 'unmute', reason: String(req.body?.reason || 'ปลด mute โดยแอดมิน').slice(0, 500), until: current.mute?.until || null, permanent: !!current.mute?.permanent });
      const fresh = await db.users.findOne({ id: user.id });
      return res.json({ success: true, user: adminUserView(fresh) });
    }
    const durationKey = String(req.body?.duration || '').trim().toLowerCase();
    const duration = moderationDuration(durationKey);
    if (!duration) return res.status(400).json({ error: 'ระยะเวลา mute ไม่ถูกต้อง ใช้ 1h, 1d, 7d หรือ permanent' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ปิดแชท' });
    const entry = {
      until: duration.until,
      permanent: duration.permanent,
      reason,
      startedAt: new Date().toISOString()
    };
    await db.users.updateOne({ id: user.id }, { $set: { 'moderation.mute': entry } });
    await recordModerationAction({ user, action: 'mute', reason, until: duration.until, permanent: duration.permanent, durationKey });
    const fresh = await db.users.findOne({ id: user.id });
    res.json({ success: true, user: adminUserView(fresh) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'อัปเดตสถานะปิดแชทไม่สำเร็จ' });
  }
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    if (user.titleId === 'admin') return res.status(403).json({ error: 'ไม่สามารถแบนบัญชีที่มีฉายาแอดมินได้' });
    const action = String(req.body?.action || 'ban').trim().toLowerCase();
    if (action === 'unban') {
      const current = getModerationStatus(user);
      await db.users.updateOne({ id: user.id }, { $set: { 'moderation.ban': null } });
      await recordModerationAction({ user, action: 'unban', reason: String(req.body?.reason || 'ปลดแบนโดยแอดมิน').slice(0, 500), until: current.ban?.until || null, permanent: !!current.ban?.permanent });
      const fresh = await db.users.findOne({ id: user.id });
      return res.json({ success: true, user: adminUserView(fresh) });
    }
    const durationKey = String(req.body?.duration || '').trim().toLowerCase();
    const duration = moderationDuration(durationKey);
    if (!duration) return res.status(400).json({ error: 'ระยะเวลาแบนไม่ถูกต้อง ใช้ 1h, 1d, 7d หรือ permanent' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่แบน' });
    const entry = {
      until: duration.until,
      permanent: duration.permanent,
      reason,
      startedAt: new Date().toISOString()
    };
    await db.users.updateOne({ id: user.id }, { $set: { 'moderation.ban': entry } });
    await db.sessions.deleteMany({ userId: user.id });
    await recordModerationAction({ user, action: 'ban', reason, until: duration.until, permanent: duration.permanent, durationKey });
    const fresh = await db.users.findOne({ id: user.id });
    res.json({ success: true, user: adminUserView(fresh) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'แบนบัญชีไม่สำเร็จ' });
  }
});

app.get('/api/admin/users/:id/moderation-history', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    const history = await db.moderationActions.find({ userId: user.id }).sort({ createdAt: -1 }).limit(100).toArray();
    res.json({
      user: { id: user.id, uid: user.uid || null, username: user.username },
      history: history.map(omitMongoId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'โหลดประวัติการลงโทษไม่สำเร็จ' });
  }
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
  const promoItems = await db.promoItems.find({}).toArray();
  const shopItemById = Object.fromEntries([...shopItems, ...promoItems].map(i => [i.id, i]));
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
  const item = isRank
    ? null
    : await (order.productType === 'promo' ? db.promoItems : db.shopItems).findOne({ id: order.product });
  if (!isRank && !item) {
    return res.status(400).json({ error: 'ไม่พบการตั้งค่าการส่งสินค้านี้ (อาจถูกลบออกจากร้านค้าไปแล้ว หรือเป็นรายการ PlayerPoints รุ่นเก่า)' });
  }
  if (!GAME_CONSOLE_ENABLED) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเซิร์ฟเวอร์ (Pterodactyl API หรือ RCON) บนเว็บนี้' });
  }
  try {
    if (isRank) await grantLuckPermsRank(order.minecraft, order.product);
    else await grantShopItem(order.minecraft, item, order.promoUid ? { uid: order.promoUid } : {});
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
    const features = parseFeatures(req.body?.features);
    const repeatable = req.body?.repeatable !== false;
    // pullOnListing: when true, listing this item for resale actually
    // removes it from the seller's live inventory (via takeCommandTemplate)
    // instead of the default "virtual coupon" behavior (see resale board
    // comment near RESALE_ID_PREFIX). Only meaningful for plugins that
    // expose a real take/remove command, e.g. ExecutableItems' "/ei take
    // {player} {id} [quantity]".
    const pullOnListing = !!req.body?.pullOnListing;
    const takeCommandTemplate = String(req.body?.takeCommandTemplate || '').trim();

    if (!id) return res.status(400).json({ error: 'กรุณาระบุ ID สินค้า (a-z, 0-9, _ เท่านั้น)' });
    if (!label) return res.status(400).json({ error: 'กรุณาระบุชื่อสินค้าที่จะแสดง' });
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'กรุณาระบุราคาที่ถูกต้อง (มากกว่า 0)' });
    if (!commandTemplate) return res.status(400).json({ error: 'กรุณาระบุคำสั่งที่จะส่งเข้าเกม (ใช้ {player} แทนชื่อผู้เล่น)' });
    if (pullOnListing && !takeCommandTemplate) {
      return res.status(400).json({ error: 'ถ้าเปิด "ดึงของจริงตอนลงขาย" ต้องระบุคำสั่งดึงคืนด้วย (ใช้ {player} แทนชื่อผู้เล่น)' });
    }
    if (Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, id)) {
      return res.status(409).json({ error: `ID "${id}" ชนกับยศในร้าน VIP กรุณาใช้ ID อื่น` });
    }

    const item = {
      id, label, icon, price, commandTemplate, features, repeatable,
      pullOnListing, takeCommandTemplate,
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
    if (req.body?.features !== undefined) update.features = parseFeatures(req.body.features);
    if (req.body?.repeatable !== undefined) update.repeatable = !!req.body.repeatable;
    if (req.body?.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (req.body?.takeCommandTemplate !== undefined) update.takeCommandTemplate = String(req.body.takeCommandTemplate).trim();
    if (req.body?.pullOnListing !== undefined) update.pullOnListing = !!req.body.pullOnListing;
    if (update.pullOnListing && !(update.takeCommandTemplate || '').length) {
      // Might already have a takeCommandTemplate saved from before - only
      // block the update if there'd be none at all after it's applied.
      const existing = await db.shopItems.findOne({ id: req.params.id });
      if (!existing?.takeCommandTemplate && !update.takeCommandTemplate) {
        return res.status(400).json({ error: 'ถ้าเปิด "ดึงของจริงตอนลงขาย" ต้องระบุคำสั่งดึงคืนด้วย' });
      }
    }
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

// ---- admin: manage the Promotion Mari (โปรโมชั่น มารี) catalog ----
// Same shape and behavior as the item-shop catalog endpoints above, kept
// in its own collection/endpoints so promotions can't collide with, be
// edited through, or be purchased through the regular Item SHOP.
app.get('/api/admin/promo-items', requireAdmin, async (req, res) => {
  const items = await db.promoItems.find({}).sort({ createdAt: 1 }).toArray();
  res.json({ items: items.map(omitMongoId) });
});

app.post('/api/admin/promo-items', requireAdmin, async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const label = String(req.body?.label || '').trim();
    const icon = String(req.body?.icon || '🎁').trim().slice(0, 8) || '🎁';
    const price = Math.trunc(Number(req.body?.price));
    const commandTemplate = String(req.body?.commandTemplate || '').trim();
    const features = parseFeatures(req.body?.features);
    const repeatable = req.body?.repeatable !== false;
    // When true, each purchase gets its own random serial number
    // (1-9999999, unique per product - see generateUniquePromoUid) that
    // can be dropped into commandTemplate via {uid}, e.g. to engrave it
    // onto a promo item's display name.
    const assignUid = !!req.body?.assignUid;

    if (!id) return res.status(400).json({ error: 'กรุณาระบุ ID โปรโมชั่น (a-z, 0-9, _ เท่านั้น)' });
    if (!label) return res.status(400).json({ error: 'กรุณาระบุชื่อโปรโมชั่นที่จะแสดง' });
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'กรุณาระบุราคาที่ถูกต้อง (มากกว่า 0)' });
    if (!commandTemplate) return res.status(400).json({ error: 'กรุณาระบุคำสั่งที่จะส่งเข้าเกม (ใช้ {player} แทนชื่อผู้เล่น)' });
    if (Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, id)) {
      return res.status(409).json({ error: `ID "${id}" ชนกับยศในร้าน VIP กรุณาใช้ ID อื่น` });
    }

    const item = {
      id, label, icon, price, commandTemplate, features, repeatable, assignUid,
      enabled: true,
      createdAt: new Date().toISOString()
    };
    await db.promoItems.insertOne(item);
    res.json({ success: true, item: omitMongoId(item) });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'มี ID โปรโมชั่นนี้อยู่แล้ว กรุณาใช้ ID อื่น' });
    res.status(500).json({ error: err.message || 'เพิ่มโปรโมชั่นไม่สำเร็จ' });
  }
});

app.put('/api/admin/promo-items/:id', requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body?.label !== undefined) update.label = String(req.body.label).trim();
    if (req.body?.icon !== undefined) update.icon = String(req.body.icon).trim().slice(0, 8) || '🎁';
    if (req.body?.price !== undefined) {
      const price = Math.trunc(Number(req.body.price));
      if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'ราคาต้องมากกว่า 0' });
      update.price = price;
    }
    if (req.body?.commandTemplate !== undefined) update.commandTemplate = String(req.body.commandTemplate).trim();
    if (req.body?.features !== undefined) update.features = parseFeatures(req.body.features);
    if (req.body?.repeatable !== undefined) update.repeatable = !!req.body.repeatable;
    if (req.body?.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (req.body?.assignUid !== undefined) update.assignUid = !!req.body.assignUid;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้อัปเดต' });

    const updated = await db.promoItems.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { returnDocument: 'after' }
    );
    const item = updated?.value || updated;
    if (!item) return res.status(404).json({ error: 'ไม่พบโปรโมชั่นนี้' });
    res.json({ success: true, item: omitMongoId(item) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'แก้ไขโปรโมชั่นไม่สำเร็จ' });
  }
});

app.delete('/api/admin/promo-items/:id', requireAdmin, async (req, res) => {
  const deleted = await db.promoItems.findOneAndDelete({ id: req.params.id });
  const item = deleted?.value || deleted;
  if (!item) return res.status(404).json({ error: 'ไม่พบโปรโมชั่นนี้' });
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

  // Same as the player-facing cancel above: a pulled listing already took
  // the real item out of the seller's inventory, so force-cancelling it
  // must give it back or it just disappears.
  if (listing.pulled && listing.sellerMinecraft) {
    try {
      const item = await db.shopItems.findOne({ id: listing.itemId });
      if (!item) throw new Error('ไม่พบไอเทมนี้ใน Item SHOP แล้ว');
      await grantShopItem(listing.sellerMinecraft, item);
    } catch (err) {
      console.error(`[resale] admin-cancelled pulled listing ${listing.id} but failed to return the item to ${listing.sellerMinecraft}:`, err.message);
      return res.json({
        success: true,
        warning: `ยกเลิกแล้ว แต่คืนไอเทมเข้าเกมให้ผู้ขายไม่สำเร็จ (${err.message}) กรุณาคืนของให้ด้วยมือ`
      });
    }
  }

  res.json({ success: true });
});

// =====================================================================
// 🎨 สีชื่อในเกม (Name colors - sold as 3 packages, applied via EssentialsX /nick)
// =====================================================================
// Follows the Mari SMP price list:
//   legacy  20฿  - 7 legacy colors (&c &d &a &6 &4 &b &e), one color for the name
//   thai    30฿  - all 16 named colors (Thai names), formats, optional colored tag
//   rgb     50฿  - any #RRGGBB, gradients, custom tag text + RGB tag color
// Prices are admin-editable. A package is bought once with wallet credit
// (upgrading pays the difference); after that the player can change colors
// freely (subject to a cooldown). Admins can also grant/deny a level per
// user or per website title from /admin.html -> 🎨 สีชื่อ.
//
// The name is the player's own bound Minecraft name. The rgb package can
// also choose a different display name: it must be unique (not another
// player's Minecraft/site name or display name), avoid the admin blocklist
// (admin, mod, owner ...), respect a max length, and - by default - wait
// for an admin to approve it before it appears in game.
// The optional "tag" ([ผู้เล่น], [V_V] ...) is a chat prefix set through a
// LuckPerms-style console command; it is OFF until an admin enables it
// (it only shows up if the server's chat format prints the prefix).
const NAMECOLOR_LEVELS = ['none', 'legacy', 'thai', 'rgb'];
const NAMECOLOR_RANK = { none: 0, legacy: 1, thai: 2, rgb: 3 };
const NAMECOLOR_PACKAGE_IDS = ['legacy', 'thai', 'rgb'];
const NAMECOLOR_PRESETS = [
  { id: '0', name: 'ดำ', en: 'black', hex: '#000000' },
  { id: '1', name: 'น้ำเงินเข้ม', en: 'dark_blue', hex: '#0000aa' },
  { id: '2', name: 'เขียวเข้ม', en: 'dark_green', hex: '#00aa00' },
  { id: '3', name: 'เขียวอมฟ้า', en: 'dark_aqua', hex: '#00aaaa' },
  { id: '4', name: 'แดงเข้ม', en: 'dark_red', hex: '#aa0000', legacy: true, legacyName: 'น้ำตาล', legacyEn: 'Brown' },
  { id: '5', name: 'ม่วงเข้ม', en: 'dark_purple', hex: '#aa00aa' },
  { id: '6', name: 'ส้ม', en: 'gold', hex: '#ffaa00', legacy: true, legacyName: 'ส้ม', legacyEn: 'Orange' },
  { id: '7', name: 'เทา', en: 'gray', hex: '#aaaaaa' },
  { id: '8', name: 'เทาเข้ม', en: 'dark_gray', hex: '#555555' },
  { id: '9', name: 'น้ำเงิน', en: 'blue', hex: '#5555ff' },
  { id: 'a', name: 'เขียว', en: 'green', hex: '#55ff55', legacy: true, legacyName: 'เขียว', legacyEn: 'Green' },
  { id: 'b', name: 'ฟ้า', en: 'aqua', hex: '#55ffff', legacy: true, legacyName: 'ฟ้า', legacyEn: 'Blue' },
  { id: 'c', name: 'แดง', en: 'red', hex: '#ff5555', legacy: true, legacyName: 'แดง', legacyEn: 'Red' },
  { id: 'd', name: 'ชมพูสว่าง', en: 'light_purple', hex: '#ff55ff', legacy: true, legacyName: 'ชมพู', legacyEn: 'Pink' },
  { id: 'e', name: 'เหลือง', en: 'yellow', hex: '#ffff55', legacy: true, legacyName: 'เหลือง', legacyEn: 'Yellow' },
  { id: 'f', name: 'ขาว', en: 'white', hex: '#ffffff' }
];
// key -> Minecraft formatting code letter
const NAMECOLOR_FORMATS = { bold: 'l', italic: 'o', underline: 'n', strike: 'm' };
const NAMECOLOR_HEX_FORMATS = ['hash', 'legacy']; // &#rrggbb  |  &x&r&r&g&g&b&b
const NAMECOLOR_DEFAULTS = {
  enabled: true,
  packages: {
    legacy: { label: '7 สีเลกาซี', price: 20, enabled: true, rentEnabled: true, rentPerDay: 2 },
    thai: { label: 'ชื่อสีภาษาไทย', price: 30, enabled: true, rentEnabled: true, rentPerDay: 3 },
    rgb: { label: 'ชื่อสี RGB กำหนดเอง', price: 50, enabled: true, rentEnabled: true, rentPerDay: 5 }
  },
  rentEnabled: true,   // master switch (the "การอนุญาต" toggle) for the whole 1-30 day rental system
  rentMinDays: 1,
  rentMaxDays: 30,
  defaultLevel: 'none',       // what everyone gets without buying
  titleLevels: {},            // { [titleId]: level } - free level for a website title
  allowFormats: true,         // bold / italic / underline / strikethrough (thai + rgb packages)
  disabledPresets: ['0'],     // preset ids hidden from players (black is unreadable in chat)
  minBrightness: 15,          // 0-60, % - floor for RGB colors
  cooldownMinutes: 10,        // between two "apply" actions per account
  requireVerified: false,     // require a verified Minecraft binding
  hexFormat: 'hash',
  applyCommand: 'nick {player} {nick}',
  resetCommand: 'nick {player} off',
  tagEnabled: false,          // colored chat tag ([ผู้เล่น], [V_V] ...)
  tagDefaultText: 'ผู้เล่น',  // fixed tag text for the thai package
  tagMaxLength: 8,            // custom tag text length for the rgb package
  tagApplyCommand: 'lp user {player} meta setprefix 100 "{prefix}"',
  tagResetCommand: 'lp user {player} meta removeprefix 100',
  customNameEnabled: true,    // rgb package may choose a display name
  customNameApproval: true,   // a new/changed display name waits for admin approval
  customNameMaxLength: 16,    // 3-32 (EssentialsX max-nick-length is 15 by default - raise it there too)
  customNameAllowThai: false, // EssentialsX only allows [A-Za-z0-9_] unless allowed-nick-regex is changed
  // Words reserved for staff. Nobody can put them in a display name or a tag unless
  // an admin ticks "may use reserved words" on that account. Short words (3 letters
  // or fewer, e.g. "mod") only match as a whole word / _-separated part, so "Model"
  // is fine but "Mod" and "Mari_Mod" are not; longer words match anywhere.
  customNameBlocked: [
    'admin', 'mod', 'owner', 'staff', 'moderator', 'helper', 'developer', 'founder', 'system', 'server', 'console',
    'แอดมิน', 'ผู้ดูแล', 'ผู้สร้าง', 'ม็อด', 'โมด', 'เจ้าของ', 'ทีมงาน', 'สตาฟ', 'ผู้พัฒนา', 'ผู้ก่อตั้ง'
  ],
  tagBlocked: [
    'admin', 'mod', 'owner', 'staff', 'moderator', 'helper', 'developer', 'founder', 'dev',
    'แอดมิน', 'ผู้ดูแล', 'ผู้สร้าง', 'ผู้สร้างเซิร์ฟเวอร์', 'ม็อด', 'โมด', 'เจ้าของ', 'ทีมงาน', 'สตาฟ', 'ผู้พัฒนา', 'ผู้ก่อตั้ง'
  ]
};
const NAMECOLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAMECOLOR_MC_RE = /^[A-Za-z0-9_.]{3,16}$/;       // no spaces: the name goes straight into a console command
const NAMECOLOR_TAG_RE = /^[A-Za-z0-9_\u0E01-\u0E5B]+$/; // letters, digits, _ and Thai only
const NAMECOLOR_NAME_RE = /^[A-Za-z0-9_]+$/;
const NAMECOLOR_NAME_THAI_RE = /^[A-Za-z0-9_\u0E01-\u0E5B]+$/;

function nameColorCleanTemplate(value, fallback, required, label) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\//, '').slice(0, 200);
  if (!text) return fallback;
  for (const token of required) {
    if (!text.includes(token)) throw new Error(`คำสั่ง${label}ต้องมี ${token}`);
  }
  return text;
}

// strict=true (admin save) throws on bad input; strict=false (reading from
// the DB) silently falls back to defaults so a bad document never breaks
// the player page.
function normalizeNameColorSettings(raw, strict) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const s = {
    ...NAMECOLOR_DEFAULTS,
    packages: JSON.parse(JSON.stringify(NAMECOLOR_DEFAULTS.packages)),
    titleLevels: {},
    disabledPresets: [...NAMECOLOR_DEFAULTS.disabledPresets]
  };
  if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
  for (const id of NAMECOLOR_PACKAGE_IDS) {
    const p = raw.packages && raw.packages[id];
    if (!p || typeof p !== 'object') continue;
    const label = String(p.label ?? '').trim().slice(0, 40);
    if (label) s.packages[id].label = label;
    if (Number.isFinite(Number(p.price))) s.packages[id].price = clamp(Math.round(Number(p.price)), 0, 100000);
    if (typeof p.enabled === 'boolean') s.packages[id].enabled = p.enabled;
    if (typeof p.rentEnabled === 'boolean') s.packages[id].rentEnabled = p.rentEnabled;
    if (Number.isFinite(Number(p.rentPerDay))) s.packages[id].rentPerDay = clamp(Math.round(Number(p.rentPerDay)), 0, 100000);
  }
  if (typeof raw.rentEnabled === 'boolean') s.rentEnabled = raw.rentEnabled;
  if (Number.isFinite(Number(raw.rentMinDays))) s.rentMinDays = clamp(Math.round(Number(raw.rentMinDays)), 1, 30);
  if (Number.isFinite(Number(raw.rentMaxDays))) s.rentMaxDays = clamp(Math.round(Number(raw.rentMaxDays)), 1, 30);
  if (s.rentMinDays > s.rentMaxDays) {
    if (strict) throw new Error('จำนวนวันเช่าต่ำสุดต้องไม่มากกว่าจำนวนวันเช่าสูงสุด');
    s.rentMaxDays = s.rentMinDays;
  }
  if (NAMECOLOR_LEVELS.includes(raw.defaultLevel)) s.defaultLevel = raw.defaultLevel;
  for (const [titleId, level] of Object.entries(raw.titleLevels || {})) {
    if (ACCOUNT_TITLES[titleId] && NAMECOLOR_LEVELS.includes(level)) s.titleLevels[titleId] = level;
  }
  if (typeof raw.allowFormats === 'boolean') s.allowFormats = raw.allowFormats;
  if (Array.isArray(raw.disabledPresets)) {
    const valid = new Set(NAMECOLOR_PRESETS.map(p => p.id));
    s.disabledPresets = [...new Set(raw.disabledPresets.map(String).filter(id => valid.has(id)))];
  }
  if (Number.isFinite(Number(raw.minBrightness))) s.minBrightness = clamp(Math.round(Number(raw.minBrightness)), 0, 60);
  if (Number.isFinite(Number(raw.cooldownMinutes))) s.cooldownMinutes = clamp(Math.round(Number(raw.cooldownMinutes)), 0, 1440);
  if (typeof raw.requireVerified === 'boolean') s.requireVerified = raw.requireVerified;
  if (NAMECOLOR_HEX_FORMATS.includes(raw.hexFormat)) s.hexFormat = raw.hexFormat;
  if (typeof raw.tagEnabled === 'boolean') s.tagEnabled = raw.tagEnabled;
  if (Number.isFinite(Number(raw.tagMaxLength))) s.tagMaxLength = clamp(Math.round(Number(raw.tagMaxLength)), 1, 32);
  if (typeof raw.tagDefaultText === 'string') {
    const t = raw.tagDefaultText.trim();
    if (t && t.length <= 16 && NAMECOLOR_TAG_RE.test(t)) s.tagDefaultText = t;
    else if (strict && t) throw new Error('ข้อความแท็กเริ่มต้นใช้ได้เฉพาะตัวอักษร ตัวเลข _ และภาษาไทย (ไม่เกิน 16 ตัว)');
  }
  if (typeof raw.customNameEnabled === 'boolean') s.customNameEnabled = raw.customNameEnabled;
  if (typeof raw.customNameApproval === 'boolean') s.customNameApproval = raw.customNameApproval;
  if (typeof raw.customNameAllowThai === 'boolean') s.customNameAllowThai = raw.customNameAllowThai;
  if (Number.isFinite(Number(raw.customNameMaxLength))) s.customNameMaxLength = clamp(Math.round(Number(raw.customNameMaxLength)), 3, 32);
  if (Array.isArray(raw.customNameBlocked)) {
    s.customNameBlocked = [...new Set(raw.customNameBlocked.map(w => String(w).trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 20))].slice(0, 200);
  } else {
    s.customNameBlocked = [...NAMECOLOR_DEFAULTS.customNameBlocked];
  }
  if (Array.isArray(raw.tagBlocked)) {
    s.tagBlocked = [...new Set(raw.tagBlocked.map(w => String(w).trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 30))].slice(0, 200);
  } else {
    s.tagBlocked = [...NAMECOLOR_DEFAULTS.tagBlocked];
  }
  try {
    s.applyCommand = nameColorCleanTemplate(raw.applyCommand, NAMECOLOR_DEFAULTS.applyCommand, ['{player}', '{nick}'], 'ตั้งสีชื่อ');
    s.resetCommand = nameColorCleanTemplate(raw.resetCommand, NAMECOLOR_DEFAULTS.resetCommand, ['{player}'], 'ล้างสีชื่อ');
    s.tagApplyCommand = nameColorCleanTemplate(raw.tagApplyCommand, NAMECOLOR_DEFAULTS.tagApplyCommand, ['{player}', '{prefix}'], 'ตั้งแท็ก');
    s.tagResetCommand = nameColorCleanTemplate(raw.tagResetCommand, NAMECOLOR_DEFAULTS.tagResetCommand, ['{player}'], 'ล้างแท็ก');
  } catch (err) {
    if (strict) throw err;
  }
  return s;
}

async function getNameColorSettings() {
  const doc = await db.settings.findOne({ id: 'nameColor' });
  return normalizeNameColorSettings(doc, false);
}

function nameColorHexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function nameColorRgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function nameColorBrightness(hex) {
  const [r, g, b] = nameColorHexToRgb(hex);
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100;
}
function nameColorHexCode(hex, format) {
  const h = hex.slice(1).toLowerCase();
  return format === 'legacy' ? '&x' + h.split('').map(c => '&' + c).join('') : '&#' + h;
}

function nameColorOwnedPackage(user) {
  return NAMECOLOR_PACKAGE_IDS.includes(user.nameColorPackage) ? user.nameColorPackage : null;
}

// Active 1-30 day rental, or null if none / expired. Expiry is just a
// timestamp comparison - nothing needs to actively "clean up" an expired
// rental, it simply stops counting as a candidate in resolveNameColorLevel.
function nameColorActiveRent(user) {
  if (!NAMECOLOR_PACKAGE_IDS.includes(user.nameColorRentPackage)) return null;
  const expiresAt = user.nameColorRentExpiresAt ? new Date(user.nameColorRentExpiresAt).getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now()) return null;
  return { package: user.nameColorRentPackage, expiresAt: user.nameColorRentExpiresAt };
}

// Which level does this account get, and where did that come from?
//   1. an admin override on the account wins outright (also used to block someone)
//   2. otherwise the best of: global default, website-title level, purchased
//      package, or an active 1-30 day rental
function resolveNameColorLevel(user, settings) {
  if (NAMECOLOR_LEVELS.includes(user.nameColorAccess)) {
    return { level: user.nameColorAccess, source: 'user' };
  }
  const titleId = ACCOUNT_TITLES[user.titleId] ? user.titleId : 'member';
  const candidates = [{ level: settings.defaultLevel, source: 'default' }];
  if (NAMECOLOR_LEVELS.includes(settings.titleLevels[titleId])) candidates.push({ level: settings.titleLevels[titleId], source: 'title' });
  const owned = nameColorOwnedPackage(user);
  if (owned) candidates.push({ level: owned, source: 'package' });
  const rent = nameColorActiveRent(user);
  if (rent) candidates.push({ level: rent.package, source: 'rent' });
  return candidates.reduce((best, c) => (NAMECOLOR_RANK[c.level] >= NAMECOLOR_RANK[best.level] ? c : best));
}

// Returns { minecraft, error, code } - error is set when the account can't
// receive a nickname yet (no/invalid/unverified Minecraft binding).
function nameColorMinecraft(user, settings) {
  const minecraft = String(user.minecraft || '').trim();
  if (!minecraft) {
    return { minecraft: '', error: 'กรุณาผูกไอดี Minecraft ในหน้าบัญชีก่อนใช้สีชื่อ', code: 'NEED_MINECRAFT' };
  }
  if (!NAMECOLOR_MC_RE.test(minecraft)) {
    return { minecraft, error: 'ชื่อ Minecraft ที่ผูกไว้มีช่องว่างหรืออักขระที่ใช้กับสีชื่อไม่ได้ กรุณาติดต่อแอดมิน', code: 'BAD_MINECRAFT' };
  }
  if (settings.requireVerified && !user.minecraftVerified) {
    return { minecraft, error: 'ต้องยืนยันไอดี Minecraft ก่อนจึงจะใช้สีชื่อได้ (เข้าเกมแล้วกดผูกไอดีอีกครั้ง)', code: 'NEED_VERIFIED' };
  }
  return { minecraft, error: '', code: '' };
}

function nameColorTagMax(user, settings) {
  const own = Math.round(Number(user.nameColorTagMax));
  return Number.isFinite(own) && own >= 1 ? clamp(own, 1, 32) : settings.tagMaxLength;
}

function nameColorCustomMax(user, settings) {
  const own = Math.round(Number(user.nameColorNameMax));
  return Number.isFinite(own) && own >= 3 ? clamp(own, 3, 32) : settings.customNameMaxLength;
}

// "@dm1n_" -> "admin": lowercase, drop separators, undo the common look-alikes,
// and drop Thai tone marks (แอดมิ้น -> แอดมิน) so the blocklist can't be dodged.
function nameColorFoldName(text) {
  return String(text).toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u0E47-\u0E4C]/g, '')
    .replace(/[_.\s]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a');
}

// Does the text contain a reserved word? See customNameBlocked in the defaults
// for the short-word rule.
function nameColorMatchesReserved(text, words) {
  const folded = nameColorFoldName(text);
  const parts = String(text).toLowerCase().split(/[_.\s]+/).filter(Boolean).map(nameColorFoldName);
  return words.some(word => {
    const w = nameColorFoldName(word);
    if (!w) return false;
    if ([...w].length <= 3) return folded === w || parts.includes(w);
    return folded.includes(w);
  });
}

// Syntax + blocklist + length. Uniqueness needs the DB, see nameColorNameTaken.
function validateNameColorCustomName(text, settings, user) {
  const re = settings.customNameAllowThai ? NAMECOLOR_NAME_THAI_RE : NAMECOLOR_NAME_RE;
  if (!re.test(text)) {
    return { error: settings.customNameAllowThai
      ? 'ชื่อใช้ได้เฉพาะตัวอักษร ตัวเลข _ และภาษาไทย (ห้ามเว้นวรรค)'
      : 'ชื่อใช้ได้เฉพาะ A-Z ตัวเลข และ _ (ห้ามเว้นวรรค)', status: 400, code: 'BAD_NAME' };
  }
  const length = [...text].length;
  const max = nameColorCustomMax(user, settings);
  if (length < 3) return { error: 'ชื่อสั้นเกินไป (อย่างน้อย 3 ตัว)', status: 400, code: 'BAD_NAME' };
  if (length > max) return { error: `ชื่อยาวเกินไป (ไม่เกิน ${max} ตัว)`, status: 400, code: 'NAME_TOO_LONG' };
  if (!user.nameColorReservedOk && nameColorMatchesReserved(text, settings.customNameBlocked)) {
    return { error: 'ชื่อนี้ใช้ไม่ได้ (คล้ายชื่อทีมงานหรือคำสงวน)', status: 400, code: 'NAME_BLOCKED' };
  }
  return { name: text };
}

// Taken = another account's Minecraft name, site username, applied display
// name, or a display name waiting for approval.
async function nameColorNameTaken(name, userId) {
  const lower = name.toLowerCase();
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clash = await db.users.findOne({
    id: { $ne: userId },
    $or: [
      { minecraft: { $regex: '^' + escaped + '$', $options: 'i' } },
      { usernameLower: lower },
      { 'nameColor.nameLower': lower },
      { 'nameColorPending.nameLower': lower }
    ]
  });
  return !!clash;
}

function publicNameColorPresets(settings) {
  const off = new Set(settings.disabledPresets);
  return NAMECOLOR_PRESETS.filter(p => !off.has(p.id));
}

// Validates what the player picked. Returns { selection } or
// { error, status, code }.
function parseNameColorSelection(body, settings, level, user) {
  const rank = NAMECOLOR_RANK[level] || 0;
  const mode = String(body?.mode || '');
  if (!['preset', 'rgb', 'gradient'].includes(mode)) {
    return { error: 'รูปแบบสีไม่ถูกต้อง', status: 400 };
  }
  if (rank < NAMECOLOR_RANK.legacy) {
    return { error: 'ยังไม่ได้ซื้อแพ็กเกจสีชื่อ', status: 403, code: 'NO_ACCESS' };
  }
  if (mode !== 'preset' && rank < NAMECOLOR_RANK.rgb) {
    return { error: 'สี RGB ต้องใช้แพ็กเกจชื่อสี RGB กำหนดเอง', status: 403, code: 'NEED_RGB' };
  }

  const formats = [...new Set((Array.isArray(body?.formats) ? body.formats : []).map(String))];
  if (formats.some(f => !(f in NAMECOLOR_FORMATS))) {
    return { error: 'รูปแบบตัวอักษรไม่ถูกต้อง', status: 400 };
  }
  if (formats.length && rank < NAMECOLOR_RANK.thai) {
    return { error: 'ตัวหนา/ตัวเอียง/ขีดเส้น ใช้ได้กับแพ็กเกจชื่อสีภาษาไทยขึ้นไป', status: 403, code: 'NEED_THAI' };
  }
  if (formats.length && !settings.allowFormats) {
    return { error: 'ตอนนี้ไม่เปิดให้ใช้ตัวหนา/ตัวเอียง/ขีดเส้น', status: 403 };
  }

  const checkPreset = (id) => {
    const preset = NAMECOLOR_PRESETS.find(p => p.id === String(id || ''));
    if (!preset || settings.disabledPresets.includes(preset.id)) return { error: 'ไม่พบสีนี้ หรือสีนี้ถูกปิดใช้งาน', status: 400 };
    if (rank < NAMECOLOR_RANK.thai && !preset.legacy) {
      return { error: 'สีนี้ต้องใช้แพ็กเกจชื่อสีภาษาไทยขึ้นไป', status: 403, code: 'NEED_THAI' };
    }
    return { preset };
  };
  const checkHex = (value) => {
    const hex = String(value || '').trim();
    if (!NAMECOLOR_HEX_RE.test(hex)) return { error: 'รหัสสี RGB ไม่ถูกต้อง (ต้องเป็นรูปแบบ #RRGGBB)', status: 400 };
    if (nameColorBrightness(hex) < settings.minBrightness) {
      return { error: `สีนี้มืดเกินไป อ่านยากในแชท (ต้องสว่างอย่างน้อย ${settings.minBrightness}%)`, status: 400, code: 'TOO_DARK' };
    }
    return { hex: hex.toLowerCase() };
  };

  const selection = { mode, formats };
  if (mode === 'preset') {
    const r = checkPreset(body?.preset);
    if (r.error) return r;
    selection.preset = r.preset.id;
  } else {
    for (const key of mode === 'gradient' ? ['hex', 'hex2'] : ['hex']) {
      const r = checkHex(body?.[key]);
      if (r.error) return r;
      selection[key] = r.hex;
    }
  }

  // optional display name (rgb package only)
  const wantedName = String(body?.name || '').trim();
  if (wantedName && wantedName.toLowerCase() !== String(user?.minecraft || '').toLowerCase()) {
    if (!settings.customNameEnabled) return { error: 'ตอนนี้ยังไม่เปิดให้ตั้งชื่อเอง', status: 403 };
    if (rank < NAMECOLOR_RANK.rgb) return { error: 'การตั้งชื่อเองต้องใช้แพ็กเกจชื่อสี RGB กำหนดเอง', status: 403, code: 'NEED_RGB' };
    const v = validateNameColorCustomName(wantedName, settings, user || {});
    if (v.error) return v;
    selection.name = v.name;
  }

  // optional colored tag
  if (body?.tag) {
    if (!settings.tagEnabled) return { error: 'ตอนนี้ยังไม่เปิดให้ใช้แท็ก', status: 403 };
    if (rank < NAMECOLOR_RANK.thai) return { error: 'แท็กใช้ได้กับแพ็กเกจชื่อสีภาษาไทยขึ้นไป', status: 403, code: 'NEED_THAI' };
    const t = body.tag;
    const tag = {};
    if (t.hex) {
      if (rank < NAMECOLOR_RANK.rgb) return { error: 'สี RGB ของแท็กต้องใช้แพ็กเกจชื่อสี RGB กำหนดเอง', status: 403, code: 'NEED_RGB' };
      const r = checkHex(t.hex);
      if (r.error) return r;
      tag.hex = r.hex;
    } else {
      const r = checkPreset(t.preset);
      if (r.error) return r;
      tag.preset = r.preset.id;
    }
    if (rank >= NAMECOLOR_RANK.rgb) {
      const text = String(t.text || '').trim();
      const max = nameColorTagMax(user || {}, settings);
      if (!text || !NAMECOLOR_TAG_RE.test(text)) return { error: 'ข้อความแท็กใช้ได้เฉพาะตัวอักษร ตัวเลข _ และภาษาไทย (ห้ามเว้นวรรค)', status: 400 };
      if (!user?.nameColorReservedOk && nameColorMatchesReserved(text, settings.tagBlocked)) {
        return { error: 'ข้อความแท็กนี้สงวนไว้สำหรับทีมงาน (แอดมิน / ม็อด / ผู้สร้างเซิร์ฟเวอร์ ฯลฯ) ใช้ไม่ได้', status: 403, code: 'TAG_RESERVED' };
      }
      if ([...text].length > max) return { error: `ข้อความแท็กยาวเกินไป (ไม่เกิน ${max} ตัว)`, status: 400, code: 'TAG_TOO_LONG' };
      tag.text = text;
    } else {
      tag.text = settings.tagDefaultText;
    }
    selection.tag = tag;
  }
  return { selection };
}

// Builds the Essentials nickname string: color code(s) + format code(s) +
// the player's own name. A color code resets formatting, so format codes
// always come AFTER each color code (matters for gradients: one color code
// per letter).
function buildNameColorNick(name, selection, settings) {
  const fmt = selection.formats.map(f => '&' + NAMECOLOR_FORMATS[f]).join('');
  if (selection.mode === 'preset') return '&' + selection.preset + fmt + name;
  if (selection.mode === 'rgb') return nameColorHexCode(selection.hex, settings.hexFormat) + fmt + name;
  const chars = [...name];
  const a = nameColorHexToRgb(selection.hex);
  const b = nameColorHexToRgb(selection.hex2);
  return chars.map((ch, i) => {
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    const hex = nameColorRgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    return nameColorHexCode(hex, settings.hexFormat) + fmt + ch;
  }).join('');
}

// "&c[V_V] " - colored tag plus a trailing space, sent as the chat prefix.
function buildNameColorPrefix(tag, settings) {
  const code = tag.hex ? nameColorHexCode(tag.hex, settings.hexFormat) : '&' + tag.preset;
  return `${code}[${tag.text}] `;
}

function fillNameColorCommand(template, vars) {
  // replacer functions so "$&"-style sequences in a value are never interpreted
  return template.replace(/\{(player|nick|prefix)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

// Runs a name-color console command. Throws when the server clearly
// rejected it (RCON returns the plugin's own text; Pterodactyl's API is
// fire-and-forget and returns nothing, so that path is trusted).
async function runNameColorCommand(command, ...sent) {
  const result = await runConsoleCommand(command);
  if (typeof result === 'string') {
    // strip the values we sent so a name like "ErrorMan" can't trip the check
    let text = result;
    for (const value of sent) if (value) text = text.split(value).join('');
    if (/unknown command|no permission|player not found|not online|too long|not allowed|invalid|illegal|unable to|error/i.test(text)) {
      throw new Error(`เซิร์ฟเวอร์ปฏิเสธคำสั่ง (${result.trim().slice(0, 120)})`);
    }
  }
  return result;
}

function publicNameColorCurrent(user) {
  const c = user.nameColor;
  if (!c) return null;
  return {
    mode: c.mode, preset: c.preset || null, hex: c.hex || null, hex2: c.hex2 || null,
    formats: c.formats || [], tag: c.tag || null, name: c.name || null, updatedAt: c.updatedAt || null
  };
}

function nameColorCooldownRemaining(user, settings) {
  if (!settings.cooldownMinutes || !user.nameColorChangedAt) return 0;
  const readyAt = new Date(user.nameColorChangedAt).getTime() + settings.cooldownMinutes * 60000;
  return Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
}

// price the player would pay for a package right now (upgrades pay the difference)
function nameColorPackageCost(user, settings, pkgId) {
  const owned = nameColorOwnedPackage(user);
  const ownedPrice = owned ? settings.packages[owned].price : 0;
  return Math.max(0, settings.packages[pkgId].price - ownedPrice);
}

function nameColorRentCost(settings, pkgId, days) {
  return Math.max(0, Math.round(settings.packages[pkgId].rentPerDay * days));
}

// ---- player API ----
app.get('/api/namecolor/status', requireAuth, async (req, res) => {
  try {
    const [user, settings] = await Promise.all([
      db.users.findOne({ id: req.session.userId }),
      getNameColorSettings()
    ]);
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const access = resolveNameColorLevel(user, settings);
    const mc = nameColorMinecraft(user, settings);
    res.json({
      enabled: settings.enabled,
      level: access.level,
      levelSource: access.source,
      username: user.username,
      balance: Number(user.balance || 0),
      minecraft: mc.minecraft,
      minecraftProblem: mc.error ? { message: mc.error, code: mc.code } : null,
      packages: NAMECOLOR_PACKAGE_IDS.map(id => ({
        id,
        label: settings.packages[id].label,
        price: settings.packages[id].price,
        enabled: settings.packages[id].enabled,
        cost: nameColorPackageCost(user, settings, id),
        // already covered by what the account has (bought, or given by title/admin)
        have: NAMECOLOR_RANK[access.level] >= NAMECOLOR_RANK[id],
        ownedPermanent: nameColorOwnedPackage(user) === id,
        rentEnabled: settings.rentEnabled && settings.packages[id].rentEnabled,
        rentPerDay: settings.packages[id].rentPerDay
      })),
      rent: {
        enabled: settings.rentEnabled,
        minDays: settings.rentMinDays,
        maxDays: settings.rentMaxDays,
        active: (() => {
          const r = nameColorActiveRent(user);
          return r ? { package: r.package, expiresAt: r.expiresAt } : null;
        })()
      },
      presets: publicNameColorPresets(settings),
      allowFormats: settings.allowFormats,
      minBrightness: settings.minBrightness,
      tag: { enabled: settings.tagEnabled, defaultText: settings.tagDefaultText, maxLength: nameColorTagMax(user, settings) },
      customName: {
        enabled: settings.customNameEnabled,
        approval: settings.customNameApproval,
        maxLength: nameColorCustomMax(user, settings),
        allowThai: settings.customNameAllowThai
      },
      rejected: user.nameColorReject || null,
      cooldownMinutes: settings.cooldownMinutes,
      cooldownRemaining: nameColorCooldownRemaining(user, settings),
      autoApply: GAME_CONSOLE_ENABLED,
      current: publicNameColorCurrent(user),
      pending: user.nameColorPending
        ? { action: user.nameColorPending.action, review: !!user.nameColorPending.review, name: user.nameColorPending.selection?.name || null, createdAt: user.nameColorPending.createdAt }
        : null
    });
  } catch (err) {
    res.status(500).json({ error: 'โหลดข้อมูลสีชื่อไม่สำเร็จ' });
  }
});

// Buy (or upgrade to) a package with wallet credit. Nothing is delivered to
// the game here - a package is just the right to use the colors - so there
// is nothing to roll back: the deduction and the ownership change happen in
// ONE atomic update that also re-checks the balance and the old ownership.
app.post('/api/namecolor/buy', requireAuth, async (req, res) => {
  try {
    const pkgId = String(req.body?.package || '');
    if (!NAMECOLOR_PACKAGE_IDS.includes(pkgId)) return res.status(400).json({ error: 'ไม่พบแพ็กเกจนี้' });
    const settings = await getNameColorSettings();
    if (!settings.enabled) return res.status(403).json({ error: 'ระบบสีชื่อปิดใช้งานอยู่ในขณะนี้' });
    const pkg = settings.packages[pkgId];
    if (!pkg.enabled) return res.status(403).json({ error: 'แพ็กเกจนี้ปิดขายชั่วคราว' });

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const access = resolveNameColorLevel(user, settings);
    if (access.source === 'user' && access.level === 'none') {
      return res.status(403).json({ error: 'บัญชีนี้ถูกปิดสิทธิ์สีชื่อ กรุณาติดต่อแอดมิน' });
    }
    if (NAMECOLOR_RANK[access.level] >= NAMECOLOR_RANK[pkgId]) {
      return res.status(400).json({ error: 'บัญชีนี้มีสิทธิ์ระดับนี้หรือสูงกว่าอยู่แล้ว' });
    }

    const owned = nameColorOwnedPackage(user);
    const cost = nameColorPackageCost(user, settings, pkgId);
    const now = new Date().toISOString();
    const updated = await db.users.findOneAndUpdate(
      { id: user.id, balance: { $gte: cost }, nameColorPackage: owned ? owned : { $exists: false } },
      { $inc: { balance: -cost }, $set: { nameColorPackage: pkgId, nameColorPurchasedAt: now } },
      { returnDocument: 'after' }
    );
    const after = updated?.value || updated;
    if (!after) {
      const fresh = await db.users.findOne({ id: user.id });
      if (Number(fresh?.balance || 0) < cost) {
        return res.status(402).json({ error: `เครดิตไม่พอ (มี ฿${Number(fresh?.balance || 0)} ต้องใช้ ฿${cost}) กรุณาเติมเงินก่อน`, code: 'INSUFFICIENT_BALANCE' });
      }
      return res.status(409).json({ error: 'สถานะบัญชีเปลี่ยนไประหว่างทำรายการ กรุณาลองใหม่' });
    }

    try {
      await db.orders.insertOne({
        id: 'NC-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
        userId: user.id,
        product: 'NAMECOLOR_' + pkgId.toUpperCase(),
        productLabel: `สีชื่อ: ${pkg.label}${owned ? ' (อัปเกรด)' : ''}`,
        productType: 'namecolor',
        price: cost,
        minecraft: user.minecraft || '',
        status: 'สำเร็จ (จ่ายด้วยเครดิต)',
        createdAt: now
      });
    } catch (err) {
      console.error('[namecolor] order log failed:', err.message); // purchase itself already succeeded
    }
    res.json({ success: true, package: pkgId, balance: Number(after.balance || 0) });
  } catch (err) {
    res.status(500).json({ error: 'ซื้อแพ็กเกจไม่สำเร็จ' });
  }
});

// Rent a package for 1-30 days instead of buying it permanently. Renting a
// package you already own permanently (or a lower/equal one) is pointless
// and blocked. Renting the SAME package you're already renting extends the
// existing expiry by the new day count; renting a DIFFERENT package while a
// rental is still active is blocked (ask the player to wait it out, or an
// admin can clear it) so nobody silently loses paid-for time.
app.post('/api/namecolor/rent', requireAuth, async (req, res) => {
  try {
    const pkgId = String(req.body?.package || '');
    if (!NAMECOLOR_PACKAGE_IDS.includes(pkgId)) return res.status(400).json({ error: 'ไม่พบแพ็กเกจนี้' });
    const days = Math.round(Number(req.body?.days));
    const settings = await getNameColorSettings();
    if (!settings.enabled) return res.status(403).json({ error: 'ระบบสีชื่อปิดใช้งานอยู่ในขณะนี้' });
    if (!settings.rentEnabled) return res.status(403).json({ error: 'ระบบเช่าสีชื่อยังไม่เปิดให้บริการในขณะนี้' });
    const pkg = settings.packages[pkgId];
    if (!pkg.enabled) return res.status(403).json({ error: 'แพ็กเกจนี้ปิดขายชั่วคราว' });
    if (!pkg.rentEnabled) return res.status(403).json({ error: 'แพ็กเกจนี้ไม่เปิดให้เช่า (ซื้อแบบถาวรได้)' });
    if (!Number.isFinite(days) || days < settings.rentMinDays || days > settings.rentMaxDays) {
      return res.status(400).json({ error: `กรุณาเลือกจำนวนวันเช่าระหว่าง ${settings.rentMinDays}-${settings.rentMaxDays} วัน` });
    }

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    const access = resolveNameColorLevel(user, settings);
    if (access.source === 'user' && access.level === 'none') {
      return res.status(403).json({ error: 'บัญชีนี้ถูกปิดสิทธิ์สีชื่อ กรุณาติดต่อแอดมิน' });
    }
    if (nameColorOwnedPackage(user) && NAMECOLOR_RANK[nameColorOwnedPackage(user)] >= NAMECOLOR_RANK[pkgId]) {
      return res.status(400).json({ error: 'บัญชีนี้ซื้อแพ็กเกจระดับนี้แบบถาวรไว้อยู่แล้ว ไม่จำเป็นต้องเช่า' });
    }
    const activeRent = nameColorActiveRent(user);
    if (activeRent && activeRent.package !== pkgId) {
      const untilTxt = new Date(activeRent.expiresAt).toLocaleString('th-TH');
      return res.status(400).json({ error: `บัญชีนี้กำลังเช่าแพ็กเกจอื่นอยู่ (ถึง ${untilTxt}) กรุณารอให้หมดอายุก่อน หรือติดต่อแอดมิน` });
    }

    const cost = nameColorRentCost(settings, pkgId, days);
    const baseFrom = activeRent ? new Date(activeRent.expiresAt).getTime() : Date.now();
    const newExpiresAt = new Date(baseFrom + days * 86400000).toISOString();
    const now = new Date().toISOString();

    const matchQuery = activeRent
      ? { id: user.id, balance: { $gte: cost }, nameColorRentExpiresAt: activeRent.expiresAt }
      : { id: user.id, balance: { $gte: cost } };
    const updated = await db.users.findOneAndUpdate(
      matchQuery,
      { $inc: { balance: -cost }, $set: { nameColorRentPackage: pkgId, nameColorRentExpiresAt: newExpiresAt, nameColorRentStartedAt: activeRent ? user.nameColorRentStartedAt || now : now } },
      { returnDocument: 'after' }
    );
    const after = updated?.value || updated;
    if (!after) {
      const fresh = await db.users.findOne({ id: user.id });
      if (Number(fresh?.balance || 0) < cost) {
        return res.status(402).json({ error: `เครดิตไม่พอ (มี ฿${Number(fresh?.balance || 0)} ต้องใช้ ฿${cost}) กรุณาเติมเงินก่อน`, code: 'INSUFFICIENT_BALANCE' });
      }
      return res.status(409).json({ error: 'สถานะบัญชีเปลี่ยนไประหว่างทำรายการ กรุณาลองใหม่' });
    }

    try {
      await db.orders.insertOne({
        id: 'NCR-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
        userId: user.id,
        product: 'NAMECOLOR_RENT_' + pkgId.toUpperCase(),
        productLabel: `เช่าสีชื่อ: ${pkg.label} (${days} วัน)`,
        productType: 'namecolor-rent',
        price: cost,
        minecraft: user.minecraft || '',
        status: `สำเร็จ (จ่ายด้วยเครดิต - หมดอายุ ${new Date(newExpiresAt).toLocaleString('th-TH')})`,
        createdAt: now
      });
    } catch (err) {
      console.error('[namecolor] rent order log failed:', err.message); // purchase itself already succeeded
    }
    res.json({ success: true, package: pkgId, days, expiresAt: newExpiresAt, balance: Number(after.balance || 0) });
  } catch (err) {
    res.status(500).json({ error: 'เช่าแพ็กเกจไม่สำเร็จ' });
  }
});

app.post('/api/namecolor/apply', requireAuth, async (req, res) => {
  let reservedFrom; // previous nameColorChangedAt, restored if delivery fails
  let reserved = false;
  const restoreCooldown = () => db.users.updateOne(
    { id: req.session.userId },
    reservedFrom ? { $set: { nameColorChangedAt: reservedFrom } } : { $unset: { nameColorChangedAt: '' } }
  );
  try {
    const settings = await getNameColorSettings();
    if (!settings.enabled) return res.status(403).json({ error: 'ระบบสีชื่อปิดใช้งานอยู่ในขณะนี้' });

    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });

    const mc = nameColorMinecraft(user, settings);
    if (mc.error) return res.status(400).json({ error: mc.error, code: mc.code });

    const access = resolveNameColorLevel(user, settings);
    const parsed = parseNameColorSelection(req.body, settings, access.level, user);
    if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error, code: parsed.code });
    const { selection } = parsed;

    // A display name that is new for this account must be unique.
    const nameChanged = !!selection.name && selection.name.toLowerCase() !== (user.nameColor?.nameLower || '');
    if (nameChanged && await nameColorNameTaken(selection.name, user.id)) {
      return res.status(409).json({ error: 'ชื่อนี้มีคนใช้แล้ว หรือซ้ำกับชื่อผู้เล่นคนอื่น', code: 'NAME_TAKEN' });
    }
    if (selection.name) selection.nameLower = selection.name.toLowerCase();
    const needsReview = nameChanged && settings.customNameApproval;

    // Reserve the cooldown atomically so two fast taps can't both go through.
    if (settings.cooldownMinutes > 0) {
      const threshold = new Date(Date.now() - settings.cooldownMinutes * 60000).toISOString();
      const before = await db.users.findOneAndUpdate(
        {
          id: user.id,
          $or: [
            { nameColorChangedAt: { $exists: false } },
            { nameColorChangedAt: null },
            { nameColorChangedAt: { $lte: threshold } }
          ]
        },
        { $set: { nameColorChangedAt: new Date().toISOString() } },
        { returnDocument: 'before' }
      );
      const prev = before?.value || before;
      if (!prev) {
        const fresh = await db.users.findOne({ id: user.id });
        const wait = nameColorCooldownRemaining(fresh || user, settings);
        return res.status(429).json({ error: `เปลี่ยนสีได้อีกครั้งในอีก ${Math.ceil(wait / 60)} นาที`, code: 'COOLDOWN', cooldownRemaining: wait });
      }
      reserved = true;
      reservedFrom = prev.nameColorChangedAt;
    }

    const nick = buildNameColorNick(selection.name || mc.minecraft, selection, settings);
    const commands = [fillNameColorCommand(settings.applyCommand, { player: mc.minecraft, nick })];
    const prevTag = user.nameColor?.tag || null;
    let prefix = '';
    if (selection.tag) {
      prefix = buildNameColorPrefix(selection.tag, settings);
      commands.push(fillNameColorCommand(settings.tagApplyCommand, { player: mc.minecraft, prefix }));
    } else if (prevTag) {
      commands.push(fillNameColorCommand(settings.tagResetCommand, { player: mc.minecraft }));
    }
    const now = new Date().toISOString();

    // New/changed display name: park it for an admin instead of touching the game.
    if (needsReview) {
      await db.users.updateOne(
        { id: user.id },
        {
          $set: { nameColorPending: { action: 'apply', review: true, selection, nameLower: selection.nameLower, nick, commands, createdAt: now } },
          $unset: { nameColorReject: '' }
        }
      );
      return res.json({ success: true, status: 'review' });
    }

    if (GAME_CONSOLE_ENABLED) {
      try {
        await runNameColorCommand(commands[0], mc.minecraft, nick);
      } catch (err) {
        if (reserved) await restoreCooldown();
        return res.status(502).json({ error: `ตั้งสีชื่อในเกมไม่สำเร็จ: ${err.message}` });
      }
      // The name is set; the tag is a second command that may fail on its own.
      let warning = '';
      if (commands[1]) {
        try {
          await runNameColorCommand(commands[1], mc.minecraft, prefix);
        } catch (err) {
          warning = `ตั้งสีชื่อแล้ว แต่ตั้งแท็กไม่สำเร็จ: ${err.message}`;
          if (prevTag) selection.tag = prevTag; else delete selection.tag;
        }
      }
      const saved = { ...selection, nick, updatedAt: now };
      await db.users.updateOne({ id: user.id }, { $set: { nameColor: saved }, $unset: { nameColorPending: '', nameColorReject: '' } });
      return res.json({ success: true, status: 'applied', warning, current: publicNameColorCurrent({ nameColor: saved }) });
    }

    // No console configured: keep the request for an admin to run by hand.
    await db.users.updateOne(
      { id: user.id },
      { $set: { nameColorPending: { action: 'apply', selection, nameLower: selection.nameLower, nick, commands, createdAt: now } }, $unset: { nameColorReject: '' } }
    );
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    if (reserved) await restoreCooldown().catch(() => {});
    res.status(500).json({ error: 'ตั้งสีชื่อไม่สำเร็จ' });
  }
});

// Reset is always allowed (even if the feature was switched off or the
// account lost its level) so nobody gets stuck with a color they can't remove.
app.post('/api/namecolor/reset', requireAuth, async (req, res) => {
  try {
    const settings = await getNameColorSettings();
    const user = await db.users.findOne({ id: req.session.userId });
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีนี้' });
    if (!user.nameColor && !user.nameColorPending) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งสีชื่อ' });
    }
    const minecraft = String(user.minecraft || '').trim();
    if (!NAMECOLOR_MC_RE.test(minecraft)) {
      return res.status(400).json({ error: 'ชื่อ Minecraft ที่ผูกไว้ใช้ไม่ได้ กรุณาติดต่อแอดมิน', code: 'BAD_MINECRAFT' });
    }
    const commands = [fillNameColorCommand(settings.resetCommand, { player: minecraft })];
    if (user.nameColor?.tag) commands.push(fillNameColorCommand(settings.tagResetCommand, { player: minecraft }));
    const now = new Date().toISOString();

    if (GAME_CONSOLE_ENABLED) {
      try {
        for (const command of commands) await runNameColorCommand(command, minecraft);
      } catch (err) {
        return res.status(502).json({ error: `ล้างสีชื่อในเกมไม่สำเร็จ: ${err.message}` });
      }
      await db.users.updateOne({ id: user.id }, { $unset: { nameColor: '', nameColorPending: '', nameColorReject: '' } });
      return res.json({ success: true, status: 'applied' });
    }
    await db.users.updateOne({ id: user.id }, { $set: { nameColorPending: { action: 'reset', commands, createdAt: now } } });
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: 'ล้างสีชื่อไม่สำเร็จ' });
  }
});

// ---- admin API (ADMIN_KEY) ----
function adminNameColorUser(user, settings) {
  const access = resolveNameColorLevel(user, settings);
  const titleId = ACCOUNT_TITLES[user.titleId] ? user.titleId : 'member';
  return {
    id: user.id,
    uid: user.uid || null,
    username: user.username,
    minecraft: user.minecraft || '',
    titleLabel: `${ACCOUNT_TITLES[titleId].icon} ${ACCOUNT_TITLES[titleId].label}`,
    owned: nameColorOwnedPackage(user),
    rent: nameColorActiveRent(user),
    override: NAMECOLOR_LEVELS.includes(user.nameColorAccess) ? user.nameColorAccess : 'default',
    level: access.level,
    levelSource: access.source,
    tagMax: Number.isFinite(Number(user.nameColorTagMax)) ? Number(user.nameColorTagMax) : null,
    nameMax: Number.isFinite(Number(user.nameColorNameMax)) ? Number(user.nameColorNameMax) : null,
    reservedOk: !!user.nameColorReservedOk,
    current: publicNameColorCurrent(user),
    pending: user.nameColorPending
      ? {
        action: user.nameColorPending.action,
        review: !!user.nameColorPending.review,
        name: user.nameColorPending.selection?.name || null,
        commands: user.nameColorPending.commands || [],
        createdAt: user.nameColorPending.createdAt
      }
      : null
  };
}

app.get('/api/admin/namecolor', requireAdmin, async (req, res) => {
  try {
    const settings = await getNameColorSettings();
    const pending = await db.users.find({ nameColorPending: { $exists: true } }).sort({ 'nameColorPending.createdAt': 1 }).limit(100).toArray();
    res.json({
      settings,
      presets: NAMECOLOR_PRESETS,
      titles: Object.entries(ACCOUNT_TITLES).map(([id, t]) => ({ id, label: t.label, icon: t.icon })),
      consoleEnabled: GAME_CONSOLE_ENABLED,
      pending: pending.map(u => adminNameColorUser(u, settings))
    });
  } catch (err) {
    res.status(500).json({ error: 'โหลดตั้งค่าสีชื่อไม่สำเร็จ' });
  }
});

app.put('/api/admin/namecolor/settings', requireAdmin, async (req, res) => {
  try {
    const settings = normalizeNameColorSettings(req.body, true);
    await db.settings.updateOne({ id: 'nameColor' }, { $set: { ...settings } }, { upsert: true });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(400).json({ error: err.message || 'บันทึกตั้งค่าสีชื่อไม่สำเร็จ' });
  }
});

// Without a search: accounts that already use the feature (own a package, have
// a color, a pending request, or an override). With a search: username / UID.
app.get('/api/admin/namecolor/users', requireAdmin, async (req, res) => {
  try {
    const settings = await getNameColorSettings();
    const search = String(req.query.search || '').trim();
    let filter;
    if (search) {
      const escaped = search.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const or = [{ usernameLower: { $regex: escaped } }];
      if (/^\d+$/.test(search)) or.push({ uid: Number(search) });
      filter = { $or: or };
    } else {
      filter = { $or: [
        { nameColorPackage: { $exists: true } }, { nameColor: { $exists: true } },
        { nameColorPending: { $exists: true } }, { nameColorAccess: { $exists: true } }, { nameColorReservedOk: { $exists: true } }
      ] };
    }
    const users = await db.users.find(filter).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ users: users.map(u => adminNameColorUser(u, settings)) });
  } catch (err) {
    res.status(500).json({ error: 'ค้นหาผู้ใช้ไม่สำเร็จ' });
  }
});

// Admin grant/deny: level = none | legacy | thai | rgb, or 'default' to go
// back to the normal rules (package they bought, title, global default).
app.post('/api/admin/namecolor/users/:id/access', requireAdmin, async (req, res) => {
  try {
    const level = String(req.body?.level || '');
    if (level !== 'default' && !NAMECOLOR_LEVELS.includes(level)) {
      return res.status(400).json({ error: 'ระดับสิทธิ์ไม่ถูกต้อง' });
    }
    const update = level === 'default' ? { $unset: { nameColorAccess: '' } } : { $set: { nameColorAccess: level } };
    const result = await db.users.findOneAndUpdate({ id: req.params.id }, update, { returnDocument: 'after' });
    const user = result?.value || result;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: adminNameColorUser(user, await getNameColorSettings()) });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกสิทธิ์ไม่สำเร็จ' });
  }
});

// "แอดมินช่วยปรับความยาวให้ยาวขึ้น": per-account max length of the custom tag text.
app.post('/api/admin/namecolor/users/:id/tag-max', requireAdmin, async (req, res) => {
  try {
    const raw = Math.round(Number(req.body?.max));
    const update = Number.isFinite(raw) && raw >= 1
      ? { $set: { nameColorTagMax: clamp(raw, 1, 32) } }
      : { $unset: { nameColorTagMax: '' } };
    const result = await db.users.findOneAndUpdate({ id: req.params.id }, update, { returnDocument: 'after' });
    const user = result?.value || result;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: adminNameColorUser(user, await getNameColorSettings()) });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกความยาวแท็กไม่สำเร็จ' });
  }
});

// Authorize one account to use the staff-reserved words (admin / mod / owner ...)
// in its display name and tag. Grant this to staff only.
app.post('/api/admin/namecolor/users/:id/reserved', requireAdmin, async (req, res) => {
  try {
    const allowed = req.body?.allowed === true;
    const update = allowed ? { $set: { nameColorReservedOk: true } } : { $unset: { nameColorReservedOk: '' } };
    const result = await db.users.findOneAndUpdate({ id: req.params.id }, update, { returnDocument: 'after' });
    const user = result?.value || result;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: adminNameColorUser(user, await getNameColorSettings()) });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกสิทธิ์ไม่สำเร็จ' });
  }
});

app.post('/api/admin/namecolor/users/:id/name-max', requireAdmin, async (req, res) => {
  try {
    const raw = Math.round(Number(req.body?.max));
    const update = Number.isFinite(raw) && raw >= 3
      ? { $set: { nameColorNameMax: clamp(raw, 3, 32) } }
      : { $unset: { nameColorNameMax: '' } };
    const result = await db.users.findOneAndUpdate({ id: req.params.id }, update, { returnDocument: 'after' });
    const user = result?.value || result;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: adminNameColorUser(user, await getNameColorSettings()) });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกความยาวชื่อไม่สำเร็จ' });
  }
});

// Approve a display-name request: run the stored commands now and commit.
// (Without a game console, run them by hand and press "ตั้งค่าแล้ว" instead.)
app.post('/api/admin/namecolor/users/:id/approve', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    const pending = user?.nameColorPending;
    if (!pending || !pending.review) return res.status(404).json({ error: 'ไม่มีชื่อที่รออนุมัติ' });
    if (!GAME_CONSOLE_ENABLED) {
      return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Pterodactyl API หรือ RCON — รันคำสั่งเองแล้วกด “ตั้งค่าแล้ว”' });
    }
    const minecraft = String(user.minecraft || '').trim();
    if (!NAMECOLOR_MC_RE.test(minecraft)) return res.status(400).json({ error: 'บัญชีนี้ไม่มีชื่อ Minecraft ที่ใช้ได้' });
    if (pending.selection?.name && await nameColorNameTaken(pending.selection.name, user.id)) {
      return res.status(409).json({ error: 'ชื่อนี้ถูกใช้ไปแล้วระหว่างรออนุมัติ กรุณาปฏิเสธคำขอ' });
    }
    try {
      await runNameColorCommand(pending.commands[0], minecraft, pending.nick);
    } catch (err) {
      return res.status(502).json({ error: `ตั้งชื่อในเกมไม่สำเร็จ: ${err.message}` });
    }
    const selection = { ...pending.selection };
    let warning = '';
    if (pending.commands[1]) {
      try {
        await runNameColorCommand(pending.commands[1], minecraft, selection.tag ? buildNameColorPrefix(selection.tag, await getNameColorSettings()) : '');
      } catch (err) {
        warning = `ตั้งชื่อแล้ว แต่ตั้งแท็กไม่สำเร็จ: ${err.message}`;
        if (user.nameColor?.tag) selection.tag = user.nameColor.tag; else delete selection.tag;
      }
    }
    const saved = { ...selection, nick: pending.nick, updatedAt: new Date().toISOString() };
    await db.users.updateOne({ id: user.id }, { $set: { nameColor: saved }, $unset: { nameColorPending: '', nameColorReject: '' } });
    res.json({ success: true, warning });
  } catch (err) {
    res.status(500).json({ error: 'อนุมัติไม่สำเร็จ' });
  }
});

// Reject: nothing was sent to the game; the player sees the reason and the
// cooldown is given back so they can try another name straight away.
app.post('/api/admin/namecolor/users/:id/reject', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    const pending = user?.nameColorPending;
    if (!pending || !pending.review) return res.status(404).json({ error: 'ไม่มีชื่อที่รออนุมัติ' });
    const reason = String(req.body?.reason || '').trim().slice(0, 200) || 'ชื่อนี้ไม่ผ่านการอนุมัติ';
    await db.users.updateOne(
      { id: user.id },
      {
        $set: { nameColorReject: { name: pending.selection?.name || '', reason, at: new Date().toISOString() } },
        $unset: { nameColorPending: '', nameColorChangedAt: '' }
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ปฏิเสธไม่สำเร็จ' });
  }
});

// Admin clears a player's colored name in game (e.g. after removing their access).
app.post('/api/admin/namecolor/users/:id/reset', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    const minecraft = String(user.minecraft || '').trim();
    if (!NAMECOLOR_MC_RE.test(minecraft)) return res.status(400).json({ error: 'บัญชีนี้ไม่มีชื่อ Minecraft ที่ใช้ได้' });
    if (!GAME_CONSOLE_ENABLED) {
      return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Pterodactyl API หรือ RCON — รันคำสั่งล้างชื่อในเกมด้วยตัวเอง' });
    }
    const settings = await getNameColorSettings();
    const commands = [fillNameColorCommand(settings.resetCommand, { player: minecraft })];
    if (user.nameColor?.tag) commands.push(fillNameColorCommand(settings.tagResetCommand, { player: minecraft }));
    try {
      for (const command of commands) await runNameColorCommand(command, minecraft);
    } catch (err) {
      return res.status(502).json({ error: `ล้างสีชื่อในเกมไม่สำเร็จ: ${err.message}` });
    }
    await db.users.updateOne({ id: user.id }, { $unset: { nameColor: '', nameColorPending: '', nameColorReject: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ล้างสีชื่อไม่สำเร็จ' });
  }
});

// Clear an account's active rental early (support / refund cases). Does not
// touch their permanent package or their current in-game color, so the
// admin should combine this with a manual refund and/or the color reset
// button above as the situation calls for.
app.post('/api/admin/namecolor/users/:id/rent-clear', requireAdmin, async (req, res) => {
  try {
    const result = await db.users.findOneAndUpdate(
      { id: req.params.id },
      { $unset: { nameColorRentPackage: '', nameColorRentExpiresAt: '', nameColorRentStartedAt: '' } },
      { returnDocument: 'after' }
    );
    const user = result?.value || result;
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    res.json({ success: true, user: adminNameColorUser(user, await getNameColorSettings()) });
  } catch (err) {
    res.status(500).json({ error: 'ล้างสถานะเช่าไม่สำเร็จ' });
  }
});

// The admin ran the pending commands by hand -> commit them.
app.post('/api/admin/namecolor/users/:id/done', requireAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ id: req.params.id });
    const pending = user?.nameColorPending;
    if (!pending) return res.status(404).json({ error: 'ไม่มีรายการที่รอตั้งค่า' });
    if (pending.action === 'reset') {
      await db.users.updateOne({ id: user.id }, { $unset: { nameColor: '', nameColorPending: '', nameColorReject: '' } });
    } else {
      const saved = { ...pending.selection, nick: pending.nick, updatedAt: new Date().toISOString() };
      await db.users.updateOne({ id: user.id }, { $set: { nameColor: saved }, $unset: { nameColorPending: '', nameColorReject: '' } });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

// Static pages and browser-side scripts are served by Workers Static Assets.
// The Worker entrypoint routes only /api/* requests into Express, so these
// legacy Node filesystem-backed page routes are intentionally not registered
// in the Workers runtime.

app.use((req, res) => res.status(404).json({ error: 'ไม่พบคำสั่งที่ต้องการ' }));

// ---------- startup ----------
// On normal Node hosting (e.g. local development), keep the original
// long-running Express server behavior. On Cloudflare Workers, the Worker
// entry point imports { app, ready } and bridges Express through
// cloudflare:node/httpServerHandler instead.
const IS_CLOUDFLARE_WORKERS = process.env.CLOUDFLARE_WORKERS === '1';

const ready = connectDB()
  .then(() => ensureChatGameNpcs())
  .then(() => loadGameSettings())
  .then(() => loadSiteSettings())
  .then(() => loadJapanWeatherCache())
  .then(() => loadPageEditorSettings())
  .then(() => loadPageContent())
  .then(() => loadLoaderSettings())
  .then(() => loadI18nCustom())
  .then(() => {
    // Clean old chat messages periodically. The admin setting controls both
    // chat.html and RPG chat. These timers are retained for the Node runtime;
    // Workers may suspend an isolate between requests, so request-time
    // cleanup remains the authoritative behavior where applicable.
    setTimeout(() => cleanupExpiredChatMessages(), 5000);
    setInterval(() => cleanupExpiredChatMessages(), 60 * 60 * 1000);
  });

if (!IS_CLOUDFLARE_WORKERS) {
  ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Mari JP SMP server running at http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('FATAL: could not connect to MongoDB:', err.message);
      process.exit(1);
    });
} else {
  ready.catch((err) => {
    console.error('Cloudflare Worker startup/database error:', err.message);
  });
}

// Cloudflare's Worker adapter imports these exports. Keeping the same Express
// app also means the normal Node deployment remains available.
module.exports = { app, ready };
