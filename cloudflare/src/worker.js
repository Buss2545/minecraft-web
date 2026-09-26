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

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') || '';
  if (request.method === 'GET' && response.ok && type.includes('text/html')) {
    return new HTMLRewriter()
      .on('body', {
        element(element) {
          element.append('<script src="/account-session.js?v=3" defer></script>', { html: true });
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

    if (url.pathname === '/api/register' || url.pathname === '/api/login' || url.pathname === '/api/logout' || url.pathname === '/api/me') {
      try {
        const response = await handleAuth2(url.pathname, request, env);
        if (response) return response;
      } catch (error) {
        console.error('[cloudflare-auth-top-level]', error);
        return json({ ok: false, error: `ระบบบัญชีขัดข้องชั่วคราว (worker:${String(error?.message || error)})`, code: 'AUTH_INTERNAL_ERROR' }, 500);
      }
    }

    // Account/profile APIs used by the "บัญชีของฉัน" panel.
    // These used to fall through to the old Render backend. They now read
    // directly from the same MongoDB/session store used by Cloudflare auth.
    if (url.pathname === '/api/orders' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const orders = await db.collection('orders')
          .find({ userId: user.id })
          .sort({ createdAt: -1 })
          .toArray();
        return json({ orders: orders.map(({ _id, ...order }) => order) });
      } catch (error) {
        console.error('[cloudflare-account-orders]', error);
        return json({ error: 'โหลดประวัติคำสั่งซื้อไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/topups' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;
        const topups = await db.collection('topups')
          .find({ userId: user.id })
          .sort({ createdAt: -1 })
          .toArray();
        return json({ topups: topups.map(({ _id, ...topup }) => topup) });
      } catch (error) {
        console.error('[cloudflare-account-topups]', error);
        return json({ error: 'โหลดประวัติเติมเงินไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api/inventory' && request.method === 'GET') {
      try {
        const db = await getDatabase(env);
        const user = await requireAccount(request, db);
        if (user instanceof Response) return user;

        const orders = await db.collection('orders')
          .find({ userId: user.id, status: { $nin: ['cancelled', 'rejected', 'failed'] } })
          .sort({ createdAt: -1 })
          .limit(200)
          .toArray();

        const items = orders.map((order) => ({
          id: order.id,
          product: order.product,
          label: order.productLabel || order.product,
          icon: order.icon || (order.productType === 'rank' ? '👑' : '🎁'),
          price: Number(order.price || 0),
          status: order.status || 'สำเร็จ',
          createdAt: order.createdAt,
          serial: order.promoUid || order.uid || ''
        }));

        return json({ user: publicUser(user), items });
      } catch (error) {
        console.error('[cloudflare-account-inventory]', error);
        return json({ error: 'โหลดคลังไม่สำเร็จ' }, 500);
      }
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API นี้ยังอยู่ระหว่างการย้ายไป Cloudflare', migration: 'phase-1-auth' }, 501);
    }

    return serveAssets(request, env);
  }
};
