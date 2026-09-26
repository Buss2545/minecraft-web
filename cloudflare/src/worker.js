import { handleAuth2 } from './auth2.js';
import { getDatabase } from './db.js';

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

async function getAuthenticatedUser(request, db) {
  const sid = getCookie(request, 'mari_sid');
  if (!sid) return null;
  const session = await db.collection('sessions').findOne({ id: sid });
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return db.collection('users').findOne({ id: session.userId });
}

function publicUser(user) {
  const titleId = user?.titleId || 'member';
  return {
    id: user?.id,
    uid: user?.uid || null,
    username: user?.username,
    displayName: user?.displayName || user?.username,
    displayNameChangedAt: user?.displayNameChangedAt || null,
    avatarUrl: user?.avatarUrl || '',
    titleId,
    title: { id: titleId },
    minecraft: user?.minecraft || '',
    minecraftVerified: !!user?.minecraftVerified,
    balance: Number(user?.balance || 0),
    rconAvailable: false
  };
}

async function requireAccount(request, db) {
  const user = await getAuthenticatedUser(request, db);
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
  return user;
}

function cleanDoc(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

const RANK_PRODUCTS = [
  { id: 'VIP', type: 'rank', price: 50, label: 'VIP', icon: '💎', features: ['/kit vip', 'สีแชท'], repeatable: false },
  { id: 'VIP+', type: 'rank', price: 100, label: 'VIP+', icon: '🌟', features: ['/kit vip+', 'Ender Chest'], repeatable: false },
  { id: 'MVP', type: 'rank', price: 150, label: 'MVP', icon: '👑', features: ['/kit mvp', '/sethome 3'], repeatable: false },
  { id: 'MVP+', type: 'rank', price: 200, label: 'MVP+', icon: '🛡️', features: ['/kit mvp+', 'สัตว์เลี้ยงพิเศษ'], repeatable: false },
  { id: 'LEGEND', type: 'rank', price: 500, label: 'LEGEND', icon: '💠', features: ['/kit legend', 'เข้าเซิร์ฟเต็ม'], repeatable: false }
];
const DEFAULT_ITEMS = [
  { id: 'ITEM_DIAMOND', type: 'item', price: 10, label: 'เพชร x1', icon: '💎', features: ['เพชร 1 ชิ้น', 'ซื้อซ้ำได้'], repeatable: true },
  { id: 'ITEM_EMERALD', type: 'item', price: 15, label: 'มรกต x16', icon: '🟢', features: ['มรกต 16 ชิ้น', 'ซื้อซ้ำได้'], repeatable: true },
  { id: 'ITEM_GOLDEN_APPLE', type: 'item', price: 25, label: 'แอปเปิลทอง x1', icon: '🍎', features: ['Golden Apple 1 ชิ้น', 'ซื้อซ้ำได้'], repeatable: true }
];

async function catalogFromDb(db, collectionName, fallback) {
  try {
    const rows = await db.collection(collectionName).find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).toArray();
    if (rows.length) return rows.map(cleanDoc).map(x => ({ ...x, type: x.type || (collectionName === 'promoItems' ? 'promo' : 'item') }));
  } catch (_) {}
  return fallback;
}

async function createPaidOrder({ db, user, collection, catalog, body, type }) {
  const product = String(body?.product || '').trim();
  const mc = String(body?.minecraft || '').trim();
  const item = catalog.find(x => x.id === product);
  if (!item) return json({ error: 'ไม่พบสินค้านี้' }, 400);
  if (mc.length < 3 || mc.length > 40) return json({ error: 'ชื่อ Minecraft ไม่ถูกต้อง' }, 400);
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return json({ error: 'ราคาสินค้าไม่ถูกต้อง' }, 400);
  if (Number(user.balance || 0) < price) return json({ error: 'เครดิตไม่เพียงพอ' }, 400);

  if (type === 'rank') {
    const already = await db.collection('orders').findOne({ userId: user.id, product, status: { $nin: ['cancelled', 'rejected', 'failed'] } });
    if (already) return json({ error: 'คุณมียศนี้อยู่แล้ว' }, 400);
  }

  const now = new Date().toISOString();
  const order = {
    id: 'O' + Date.now().toString(36) + Math.random().toString(16).slice(2, 8),
    userId: user.id,
    username: user.username,
    product,
    productType: type,
    productLabel: item.label || product,
    icon: item.icon || '🎁',
    price,
    minecraft: mc,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };

  const debit = await db.collection('users').updateOne(
    { id: user.id, balance: { $gte: price } },
    { $inc: { balance: -price }, $set: { updatedAt: now } }
  );
  if (debit.modifiedCount !== 1) return json({ error: 'เครดิตมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่' }, 409);

  try {
    await db.collection(collection).insertOne(order);
  } catch (error) {
    await db.collection('users').updateOne({ id: user.id }, { $inc: { balance: price } });
    throw error;
  }

  return json({ success: true, balance: Number(user.balance || 0) - price, order });
}

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') || '';
  if (request.method === 'GET' && response.ok && type.includes('text/html')) {
    return new HTMLRewriter()
      .on('body', {
        element(element) {
          element.append('<script src="/account-session.js?v=4" defer></script>', { html: true });
        }
      })
      .transform(response);
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__cloudflare/health') {
      try {
        const db = await getDatabase(env);
        await db.command({ ping: 1 });
        return json({ ok: true, service: 'mari-jp-smp-cloudflare', mongodb: true, database: 'marijpsmp', backendProxy: false });
      } catch (error) {
        return json({ ok: false, service: 'mari-jp-smp-cloudflare', mongodb: false, database: 'marijpsmp', error: String(error?.message || error) }, 503);
      }
    }

    if (url.pathname === '/__cloudflare/auth-debug' && request.method === 'GET') {
      try {
        const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
        if (!username) return json({ ok: false, error: 'missing username' }, 400);
        const db = await getDatabase(env);
        const user = await db.collection('users').findOne({ usernameLower: username });
        if (!user) return json({ ok: true, found: false });
        const hash = String(user.passwordHash || '');
        const [saltHex, hashHex] = hash.split(':');
        const sessionCount = await db.collection('sessions').countDocuments({ userId: user.id });
        return json({ ok: true, found: true, idType: typeof user.id, hasPasswordHash: !!hash, passwordHashParts: hash.split(':').length, saltHexLength: saltHex?.length || 0, hashHexLength: hashHex?.length || 0, uid: user.uid ?? null, sessionCount });
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 500);
      }
    }

    if (url.pathname === '/api/register' || url.pathname === '/api/login' || url.pathname === '/api/logout' || url.pathname === '/api/me' || url.pathname === '/api/account/password') {
      try {
        const response = await handleAuth2(url.pathname, request, env);
        if (response) return response;
      } catch (error) {
        console.error('[cloudflare-auth-top-level]', error);
        return json({ ok: false, error: `ระบบบัญชีขัดข้องชั่วคราว (worker:${String(error?.message || error)})`, code: 'AUTH_INTERNAL_ERROR' }, 500);
      }
    }

    if (url.pathname === '/api/orders' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const orders = await db.collection('orders').find({ userId: user.id }).sort({ createdAt: -1 }).toArray();
        return json({ orders: orders.map(cleanDoc) });
      } catch (error) {
        console.error('[cloudflare-account-orders]', error);
        return json({ error: 'โหลดประวัติคำสั่งซื้อไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/orders' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        return createPaidOrder({ db, user, collection: 'orders', catalog: RANK_PRODUCTS, body, type: 'rank' });
      } catch (error) {
        console.error('[cloudflare-rank-order]', error);
        return json({ error: 'สร้างคำสั่งซื้อไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/item-orders' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const catalog = await catalogFromDb(db, 'shopItems', DEFAULT_ITEMS);
        return createPaidOrder({ db, user, collection: 'orders', catalog, body, type: 'item' });
      } catch (error) {
        console.error('[cloudflare-item-order]', error);
        return json({ error: 'สร้างคำสั่งซื้อไอเทมไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/promo-orders' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const catalog = await catalogFromDb(db, 'promoItems', []);
        return createPaidOrder({ db, user, collection: 'orders', catalog, body, type: 'promo' });
      } catch (error) {
        console.error('[cloudflare-promo-order]', error);
        return json({ error: 'สร้างคำสั่งซื้อโปรโมชั่นไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/topups' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const topups = await db.collection('topups').find({ userId: user.id }).sort({ createdAt: -1 }).toArray();
        return json({ topups: topups.map(cleanDoc) });
      } catch (error) {
        console.error('[cloudflare-account-topups]', error);
        return json({ error: 'โหลดประวัติเติมเงินไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/topups' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const amount = Math.trunc(Number(body?.amount));
        const note = String(body?.note || '').slice(0, 500);
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return json({ error: 'จำนวนเงินต้องอยู่ระหว่าง ฿1 ถึง ฿100,000' }, 400);
        const topup = { id: 'T' + Date.now().toString(36) + Math.random().toString(16).slice(2, 7), userId: user.id, username: user.username, amount, note, status: 'pending', createdAt: new Date().toISOString() };
        await db.collection('topups').insertOne(topup);
        return json({ success: true, topup });
      } catch (error) {
        console.error('[cloudflare-topup-create]', error);
        return json({ error: 'แจ้งเติมเงินไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/inventory' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const orders = await db.collection('orders').find({ userId: user.id, status: { $nin: ['cancelled', 'rejected', 'failed'] } }).sort({ createdAt: -1 }).limit(200).toArray();
        const items = orders.map(order => ({ id: order.id, product: order.product, label: order.productLabel || order.product, icon: order.icon || (order.productType === 'rank' ? '👑' : '🎁'), price: Number(order.price || 0), status: order.status || 'สำเร็จ', createdAt: order.createdAt, serial: order.promoUid || order.uid || '' }));
        return json({ user: publicUser(user), items });
      } catch (error) {
        console.error('[cloudflare-account-inventory]', error);
        return json({ error: 'โหลดคลังไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/shop' && request.method === 'GET') return json({ products: RANK_PRODUCTS });
    if (url.pathname === '/api/item-shop' && request.method === 'GET') {
      try { const db = await getDatabase(env); return json({ products: await catalogFromDb(db, 'shopItems', DEFAULT_ITEMS) }); }
      catch (_) { return json({ products: DEFAULT_ITEMS }); }
    }
    if (url.pathname === '/api/promo-shop' && request.method === 'GET') {
      try { const db = await getDatabase(env); return json({ products: await catalogFromDb(db, 'promoItems', []) }); }
      catch (_) { return json({ products: [] }); }
    }
    if (url.pathname === '/api/resale/config' && request.method === 'GET') return json({ decayHours: 72, floorPercent: 20 });

    if (url.pathname === '/api/account/minecraft' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const minecraft = String(body?.minecraft || '').trim();
        if (!/^[A-Za-z0-9_]{3,40}$/.test(minecraft)) return json({ error: 'ชื่อ Minecraft ต้องมี 3-40 ตัวอักษรและใช้ A-Z, a-z, 0-9, _ เท่านั้น' }, 400);
        await db.collection('users').updateOne({ id: user.id }, { $set: { minecraft, minecraftVerified: false, updatedAt: new Date().toISOString() } });
        return json({ success: true, user: publicUser({ ...user, minecraft, minecraftVerified: false }) });
      } catch (error) {
        console.error('[cloudflare-account-minecraft]', error);
        return json({ error: 'ผูกไอดี Minecraft ไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/account/display-name' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const displayName = String(body?.displayName || '').trim();
        if (!/^[A-Za-z0-9_ก-๙-]{3,24}$/.test(displayName)) return json({ error: 'ชื่อแสดงผลต้องมี 3-24 ตัวอักษร และใช้ได้เฉพาะภาษาไทย/อังกฤษ/ตัวเลข _ และ -' }, 400);
        if (displayName === (user.displayName || user.username)) return json({ error: 'ชื่อใหม่ต้องไม่ซ้ำกับชื่อเดิม' }, 400);
        const changedAt = Date.parse(user.displayNameChangedAt || '');
        if (Number.isFinite(changedAt) && changedAt + 30 * 24 * 60 * 60 * 1000 > Date.now()) return json({ error: 'ยังไม่ครบ 30 วันสำหรับการเปลี่ยนชื่ออีกครั้ง' }, 400);
        const cost = 2000;
        if (Number(user.balance || 0) < cost) return json({ error: 'เครดิตไม่พอ ต้องใช้ ฿2,000' }, 400);
        const now = new Date().toISOString();
        const result = await db.collection('users').updateOne({ id: user.id, balance: { $gte: cost } }, { $set: { displayName, displayNameChangedAt: now, updatedAt: now }, $inc: { balance: -cost } });
        if (result.modifiedCount !== 1) return json({ error: 'ยอดเครดิตมีการเปลี่ยนแปลง กรุณาลองใหม่' }, 409);
        return json({ success: true, user: publicUser({ ...user, displayName, displayNameChangedAt: now, balance: Number(user.balance || 0) - cost }) });
      } catch (error) {
        console.error('[cloudflare-account-display-name]', error);
        return json({ error: 'เปลี่ยนชื่อแสดงผลไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/account/avatar' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const body = await request.json().catch(() => ({}));
        const image = String(body?.image || '');
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) return json({ error: 'รูปโปรไฟล์ต้องเป็น JPEG, PNG หรือ WebP' }, 400);
        if (image.length > 400000) return json({ error: 'รูปโปรไฟล์ใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง' }, 400);
        await db.collection('users').updateOne({ id: user.id }, { $set: { avatarUrl: image, updatedAt: new Date().toISOString() } });
        return json({ success: true, user: publicUser({ ...user, avatarUrl: image }) });
      } catch (error) {
        console.error('[cloudflare-account-avatar]', error);
        return json({ error: 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/account/avatar' && request.method === 'DELETE') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        await db.collection('users').updateOne({ id: user.id }, { $set: { avatarUrl: '', updatedAt: new Date().toISOString() } });
        return json({ success: true, user: publicUser({ ...user, avatarUrl: '' }) });
      } catch (error) {
        console.error('[cloudflare-account-avatar-delete]', error);
        return json({ error: 'ลบรูปโปรไฟล์ไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/credits/transfer/recipient' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const me = await requireAccount(request, db);
        if (me instanceof Response) return me;
        const uid = String(url.searchParams.get('uid') || '').trim();
        const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
        const query = uid ? { uid: Number(uid) } : { usernameLower: username };
        const recipient = await db.collection('users').findOne(query);
        if (!recipient || recipient.id === me.id) return json({ error: 'ไม่พบผู้รับหรือผู้รับเป็นบัญชีเดียวกับคุณ' }, 404);
        return json({ user: publicUser(recipient) });
      } catch (error) {
        console.error('[cloudflare-transfer-recipient]', error);
        return json({ error: 'ตรวจสอบผู้รับไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/credits/transfer' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const sender = await requireAccount(request, db);
        if (sender instanceof Response) return sender;
        const body = await request.json().catch(() => ({}));
        const amount = Math.trunc(Number(body?.amount));
        const recipientUid = Number(body?.recipientUid);
        if (!Number.isInteger(amount) || amount < 10 || amount > 1000) return json({ error: 'โอนได้ครั้งละ ฿10-฿1,000' }, 400);
        if (!Number.isInteger(recipientUid)) return json({ error: 'UID ผู้รับไม่ถูกต้อง' }, 400);
        if (Number(sender.balance || 0) < amount) return json({ error: 'เครดิตไม่เพียงพอ' }, 400);
        const recipient = await db.collection('users').findOne({ uid: recipientUid });
        if (!recipient || recipient.id === sender.id) return json({ error: 'ไม่พบผู้รับ' }, 404);
        const now = new Date().toISOString();
        const debit = await db.collection('users').updateOne({ id: sender.id, balance: { $gte: amount } }, { $inc: { balance: -amount }, $set: { updatedAt: now } });
        if (debit.modifiedCount !== 1) return json({ error: 'ยอดเครดิตมีการเปลี่ยนแปลง กรุณาลองใหม่' }, 409);
        try {
          await db.collection('users').updateOne({ id: recipient.id }, { $inc: { balance: amount }, $set: { updatedAt: now } });
        } catch (error) {
          await db.collection('users').updateOne({ id: sender.id }, { $inc: { balance: amount } });
          throw error;
        }
        const transfer = { id: 'TR' + Date.now().toString(36) + Math.random().toString(16).slice(2, 8), senderId: sender.id, recipientId: recipient.id, amount, received: amount, status: 'completed', createdAt: now, sender: publicUser(sender), recipient: publicUser(recipient) };
        await db.collection('creditTransfers').insertOne(transfer);
        return json({ success: true, balance: Number(sender.balance || 0) - amount, transfer });
      } catch (error) {
        console.error('[cloudflare-credit-transfer]', error);
        return json({ error: 'โอนเครดิตไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/credits/transfer/history' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const rows = await db.collection('creditTransfers').find({ $or: [{ senderId: user.id }, { recipientId: user.id }] }).sort({ createdAt: -1 }).limit(50).toArray();
        const ids = [...new Set(rows.flatMap(x => [x.senderId, x.recipientId]).filter(Boolean))];
        const users = await db.collection('users').find({ id: { $in: ids } }).project({ _id: 0, id: 1, uid: 1, username: 1, displayName: 1, avatarUrl: 1 }).toArray();
        const byId = new Map(users.map(x => [x.id, x]));
        return json({ history: rows.map(x => ({ ...cleanDoc(x), sender: byId.get(x.senderId) || null, recipient: byId.get(x.recipientId) || null })) });
      } catch (error) {
        console.error('[cloudflare-credit-transfer-history]', error);
        return json({ history: [] });
      }
    }

    if (url.pathname === '/api/account/messages' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const messages = await db.collection('accountMessages').find({ userId: user.id, $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }] }).sort({ createdAt: -1 }).limit(50).toArray();
        return json({ messages: messages.map(cleanDoc) });
      } catch (error) {
        console.error('[cloudflare-account-messages]', error);
        return json({ messages: [] });
      }
    }

    if (url.pathname === '/api/account/messages/read-all' && request.method === 'POST') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        await db.collection('accountMessages').updateMany({ userId: user.id, read: { $ne: true } }, { $set: { read: true, readAt: new Date().toISOString() } });
        return json({ success: true });
      } catch (error) {
        return json({ success: false });
      }
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API นี้ยังอยู่ระหว่างการย้ายไป Cloudflare', migration: 'phase-2-account-core' }, 501);
    }

    return serveAssets(request, env);
  }
};
