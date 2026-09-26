import { handleAuth } from './auth.js';
import { getDatabase } from './db.js';

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
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

    if (url.pathname === '/api/register' || url.pathname === '/api/login' ||
        url.pathname === '/api/logout' || url.pathname === '/api/me') {
      try {
        const response = await handleAuth(url.pathname, request, env);
        if (response) return response;
      } catch (error) {
        console.error('[cloudflare-auth]', error);
        return json({ ok: false, error: 'ระบบบัญชีขัดข้องชั่วคราว' }, 500);
      }
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API นี้ยังอยู่ระหว่างการย้ายไป Cloudflare', migration: 'phase-1-auth' }, 501);
    }

    return env.ASSETS.fetch(request);
  }
};
