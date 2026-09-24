const CACHE='mari-pwa-v27-floating-music';
const SHELL=['/index.html','/i18n-jp.js?v=6','/mari-global-ui.js?v=11','/page-blocks.js','/manifest.webmanifest','/rpg.html'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/')||u.pathname==='/sw.js') return;
  // Admin and RPG HTML must always come from the server so a new deploy is visible immediately.
  if(u.pathname==='/admin.html'||u.pathname==='/rpg.html'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const copy=r.clone(); caches.open(CACHE).then(x=>x.put(e.request,copy)); return r}).catch(()=>caches.match('/index.html'))));
});
