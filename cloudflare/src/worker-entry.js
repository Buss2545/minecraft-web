import worker from './worker.js';
import { handleMusic } from './music.js';

export default {
  async fetch(request, env, ctx) {
    // Music API was originally implemented by Express/server.js. Handle the
    // same URLs here so the existing HTML player does not need to change.
    const musicResponse = await handleMusic(request, env);
    if (musicResponse) return musicResponse;

    const response = await worker.fetch(request, env, ctx);
    const type = response.headers.get('content-type') || '';

    // The legacy worker injects account-session.js?v=4. Force browsers to
    // load the current account bridge without rewriting the page structure.
    if (request.method === 'GET' && response.ok && type.includes('text/html')) {
      const html = await response.text();
      const patched = html.replaceAll('/account-session.js?v=4', '/account-session.js?v=7');
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store, no-cache, must-revalidate');
      return new Response(patched, { status: response.status, statusText: response.statusText, headers });
    }

    return response;
  }
};
