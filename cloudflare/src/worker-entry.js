import worker from './worker.js';
import { handleMusic } from './music.js';

function errorJson(error, path) {
  return new Response(JSON.stringify({
    ok: false,
    error: `Worker error: ${String(error?.message || error)}`,
    path
  }), {
    status: 500,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/music') || url.pathname.startsWith('/api/admin/music')) {
        const musicResponse = await handleMusic(request, env);
        if (musicResponse) return musicResponse;
      }

      const response = await worker.fetch(request, env, ctx);
      const type = response.headers.get('content-type') || '';

      if (request.method === 'GET' && response.ok && type.includes('text/html')) {
        const html = await response.text();
        const patched = html
          .replaceAll('/account-session.js?v=4', '/account-session.js?v=9')
          .replaceAll('/account-session.js?v=7', '/account-session.js?v=9')
          .replaceAll('/account-session.js?v=8', '/account-session.js?v=9')
          .replace('</body>', '<script src="/logout-cloudflare-fix.js?v=1" defer></script><script src="/music-cloudflare-fix.js?v=1" defer></script></body>');
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store, no-cache, must-revalidate');
        return new Response(patched, { status: response.status, statusText: response.statusText, headers });
      }
      return response;
    } catch (error) {
      console.error('[minecraft-web-worker-entry]', url.pathname, error);
      if (url.pathname.startsWith('/api/')) return errorJson(error, url.pathname);
      return new Response('<!doctype html><meta charset="utf-8"><title>Mari JP SMP</title><body style="font-family:system-ui;padding:24px"><h2>ระบบกำลังขัดข้องชั่วคราว</h2><p>Worker error: ' + String(error?.message || error).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</p><p>กรุณารีเฟรชอีกครั้ง</p></body>', { status: 500, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
  }
};
