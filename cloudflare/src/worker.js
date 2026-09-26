import { handleAuth2 } from './auth2.js';
import { getDatabase } from './db.js';

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') || '';
  if (request.method === 'GET' && response.ok && type.includes('text/html')) {
    return new HTMLRewriter()
      .on('body', {
        element(element) {
          element.append('<script src="/account-session.js" defer></script>', { html: true });
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

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API นี้ยังอยู่ระหว่างการย้ายไป Cloudflare', migration: 'phase-1-auth' }, 501);
    }

    return serveAssets(request, env);
  }
};
