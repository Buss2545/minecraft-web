/* Mari JP SMP — Cloudflare music compatibility bridge. */
(function(){
  'use strict';
  if(window.__MARI_MUSIC_CF_FIX_V1__) return;
  window.__MARI_MUSIC_CF_FIX_V1__=true;

  function rewrite(value){
    if(!value) return value;
    try{
      var u=new URL(String(value),location.href);
      if(/onrender\.com$/i.test(u.hostname) && /^\/api\/music/i.test(u.pathname)) return u.pathname+u.search;
      return value;
    }catch(_){ return value; }
  }

  function fixMedia(el){
    if(!el || el.__mariMusicFixed) return;
    el.__mariMusicFixed=true;
    try{
      var src=el.getAttribute('src');
      var next=rewrite(src);
      if(next && next!==src) el.setAttribute('src',next);
      el.querySelectorAll('source[src]').forEach(function(s){var v=s.getAttribute('src'),n=rewrite(v);if(n&&n!==v)s.setAttribute('src',n);});
      el.preload=el.preload||'metadata';
      el.addEventListener('error',function(){var current=el.currentSrc||el.src||el.getAttribute('src'),n=rewrite(current);if(n&&n!==current){el.src=n;try{el.load();}catch(_){} }});
    }catch(_){}
  }

  function scan(root){
    if(!root) return;
    if(root.matches && root.matches('audio,video')) fixMedia(root);
    if(root.querySelectorAll) root.querySelectorAll('audio,video').forEach(fixMedia);
  }

  var originalFetch=window.fetch;
  if(originalFetch && !window.__mariMusicFetchFixed){
    window.__mariMusicFetchFixed=true;
    window.fetch=function(input,init){
      try{
        var url=typeof input==='string'?input:(input&&input.url)||'',rewritten=rewrite(url);
        if(rewritten!==url){if(typeof input==='string') input=rewritten;else input=new Request(rewritten,input);}
      }catch(_){}
      return originalFetch.call(this,input,init);
    };
  }

  function start(){
    scan(document);
    if(window.MutationObserver)new MutationObserver(function(muts){muts.forEach(function(m){m.addedNodes&&m.addedNodes.forEach(scan);});}).observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('button,[role="button"],a'):null;
      if(!b)return;
      var text=(b.textContent||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.title||'');
      if(!/เล่น|play|เพลง|music/i.test(text))return;
      setTimeout(function(){scan(document);},60);
    },true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
