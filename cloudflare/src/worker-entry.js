const DEFAULT_BACKEND = 'https://mari-jp-smp.onrender.com';

function safeHeaderCopy(source, target) {
  for (const [key, value] of source.entries()) {
    const lower = key.toLowerCase();
    if (['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'].includes(lower)) continue;
    if (lower === 'set-cookie') continue;
    target.set(key, value);
  }
}

function copySetCookies(source, target) {
  try {
    if (typeof source.getSetCookie === 'function') {
      for (const cookie of source.getSetCookie()) target.append('Set-Cookie', cookie);
      return;
    }
  } catch (_) {}
  const one = source.get('set-cookie');
  if (one) target.append('Set-Cookie', one);
}

function backendUrl(env, request) {
  const base = String(env?.BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');
  const incoming = new URL(request.url);
  return base + incoming.pathname + incoming.search;
}

async function proxyApi(request, env) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length') continue;
    headers.set(key, value);
  }
  headers.set('X-Forwarded-Host', new URL(request.url).host);
  headers.set('X-Forwarded-Proto', 'https');
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

  const upstream = await fetch(backendUrl(env, request), init);
  const responseHeaders = new Headers();
  safeHeaderCopy(upstream.headers, responseHeaders);
  copySetCookies(upstream.headers, responseHeaders);

  if (upstream.headers.has('location')) {
    try {
      const loc = new URL(upstream.headers.get('location'), new URL(request.url).origin);
      const base = new URL(String(env?.BACKEND_URL || DEFAULT_BACKEND));
      if (loc.host === base.host) {
        responseHeaders.set('Location', loc.pathname + loc.search + loc.hash);
      }
    } catch (_) {}
  }

  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Mari-Backend', 'render-compat');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  if (request.method === 'GET' && response.ok) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) {
        return await proxyApi(request, env);
      }

      // All public HTML/assets are served from the same public directory.
      // The new homepage/login/profile are v2; existing RPG/chat/admin/etc.
      // pages remain available unchanged while their API calls use the proxy.
      return await serveAssets(request, env);
    } catch (error) {
      console.error('[minecraft-web]', url.pathname, error);
      if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'ระบบเชื่อมต่อ backend ไม่สำเร็จ',
          detail: String(error?.message || error)
        }), {
          status: 502,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mari JP SMP</title><body style="font-family:system-ui;padding:24px"><h2>เว็บไซต์กำลังขัดข้องชั่วคราว</h2><p>กรุณารีเฟรชอีกครั้ง</p></body>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
      });
    }
  }
};
