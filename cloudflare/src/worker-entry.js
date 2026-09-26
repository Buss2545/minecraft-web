import worker from './worker.js';

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);
    const type = response.headers.get('content-type') || '';

    // Keep the existing page structure. Only refresh the account bridge URL.
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
