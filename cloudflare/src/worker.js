const API_PREFIX = '/api/';

function normalizeBackendUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith(API_PREFIX);
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

async function proxyApi(request, env) {
  const backend = normalizeBackendUrl(env.BACKEND_URL);
  if (!backend) {
    return json({
      ok: false,
      error: 'Cloudflare frontend is online, but BACKEND_URL is not configured.'
    }, 503);
  }

  const incoming = new URL(request.url);
  const target = new URL(backend + incoming.pathname + incoming.search);
  const headers = new Headers(request.headers);

  // The browser talks to Cloudflare on the same origin, so there is no need
  // to expose permissive CORS headers. Keep the original cookies/auth headers
  // so the existing Express session system continues to work.
  headers.delete('host');
  headers.set('X-Forwarded-Host', incoming.host);
  headers.set('X-Forwarded-Proto', incoming.protocol.replace(':', ''));

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual'
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-length');
    responseHeaders.set('X-Edge-Proxy', 'mari-jp-smp-cloudflare');

    // Backend session cookies must remain usable through the Cloudflare host.
    // Do not rewrite their values; only remove a backend Domain attribute when
    // one is present so the browser stores the cookie for the public hostname.
    const setCookies = responseHeaders.getSetCookie?.() || [];
    if (setCookies.length) {
      responseHeaders.delete('set-cookie');
      for (const cookie of setCookies) {
        responseHeaders.append('set-cookie', cookie.replace(/;\s*Domain=[^;]+/gi, ''));
      }
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return json({
      ok: false,
      error: 'Backend is unreachable from Cloudflare.',
      detail: String(error?.message || error)
    }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && isApiRequest(url)) {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/__cloudflare/health') {
      return json({
        ok: true,
        service: 'mari-jp-smp-cloudflare',
        backendConfigured: !!normalizeBackendUrl(env.BACKEND_URL)
      });
    }

    if (isApiRequest(url)) {
      return proxyApi(request, env);
    }

    // Static files are served by the Cloudflare Assets binding.
    return env.ASSETS.fetch(request);
  }
};
