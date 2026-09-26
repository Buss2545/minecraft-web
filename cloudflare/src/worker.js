const API_PREFIX = '/api/';

function normalizeBackendUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith(API_PREFIX);
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function apiUnavailable() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'Cloudflare frontend is online, but BACKEND_URL is not configured.'
  }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function proxyApi(request, env) {
  const backend = normalizeBackendUrl(env.BACKEND_URL);
  if (!backend) return apiUnavailable();

  const incoming = new URL(request.url);
  const target = new URL(backend + incoming.pathname + incoming.search);
  const headers = new Headers(request.headers);
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
    return withCors(new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    }));
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Backend is unreachable from Cloudflare.',
      detail: String(error?.message || error)
    }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && isApiRequest(url)) {
      return withCors(new Response(null, { status: 204 }));
    }

    if (isApiRequest(url)) {
      return proxyApi(request, env);
    }

    // Static files are handled by the Cloudflare Assets binding.
    // Returning 404 here lets the asset layer serve the actual site.
    return env.ASSETS.fetch(request);
  }
};
