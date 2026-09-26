const CACHE='mari-pwa-v31-cloudflare';
const SHELL=['/i18n-jp.js?v=6','/mari-global-ui.js?v=11','/page-blocks.js','/manifest.webmanifest','/account-session.js?v=7'];
const HTML_PATHS=new Set(['/','/index.html','/auth.html','/admin.html','/rpg.html','/chat.html','/community.html','/minigames.html','/namecolor.html','/promo.html','/topup.html','/vip.html','/rules.html','/team.html']);

async function freshHtml(request){
  const response=await fetch(request,{cache:'no-store'});
  if(!response.ok)return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let html=await response.text();
  html=html.replace(/\/account-session\.js\?v=(?:2|3|4|5|6|7)/g,'/account-session.js?v=7');
  if(!html.includes('/account-session.js')){
    const tag='<script src="/account-session.js?v=7" defer></script>';
    if(/<\/body>/i.test(html)) html=html.replace(/<\/body>/i,tag+'</body>');
    else html+=tag;
  }
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store,no-cache,must-revalidate');
  headers.set('X-Mari-Session-Loader','v31-cloudflare');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/')||u.pathname==='/sw.js')return;

  if(u.pathname==='/account-session.js'){
    e.respondWith(fetch(e.request,{cache:'no-store'}));
    return;
  }

  if(HTML_PATHS.has(u.pathname)||u.pathname.endsWith('.html')){
    e.respondWith(freshHtml(e.request).catch(()=>fetch(e.request).catch(()=>caches.match(e.request))));
    return;
  }

  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{
    const copy=r.clone();
    caches.open(CACHE).then(x=>x.put(e.request,copy));
    return r;
  }).catch(()=>caches.match(e.request))));
});
