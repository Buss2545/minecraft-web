/* Mari JP SMP — persist and rehydrate the logged-in account across page changes. */
(function(){
  'use strict';
  var KEY='mariAccountCache_v3';
  var state={user:null,checked:false,renderQueued:false};

  function cacheUser(user){
    state.user=user||null;
    state.checked=true;
    try{
      if(user) localStorage.setItem(KEY,JSON.stringify(user));
      else localStorage.removeItem(KEY);
    }catch(e){}
  }
  function cachedUser(){
    try{
      var raw=localStorage.getItem(KEY);
      if(raw){var u=JSON.parse(raw);if(u&&u.username)return u;}
      /* Migrate the previous cache key once. */
      raw=localStorage.getItem('mariAccountCache_v2');
      if(raw){var old=JSON.parse(raw);if(old&&old.username){localStorage.setItem(KEY,raw);return old;}}
    }catch(e){}
    return null;
  }
  function nameOf(u){return String((u&&u.displayName)||(u&&u.username)||'');}

  function updateExisting(root){
    var nodes=(root||document).querySelectorAll('.account-chip');
    nodes.forEach(function(chip){
      var n=chip.querySelector('.account-name,b');
      if(n && state.user)n.textContent=nameOf(state.user);
    });
  }

  function render(){
    if(!state.user)return;
    updateExisting(document);
    var bars=document.querySelectorAll('.authbar');
    bars.forEach(function(bar){
      if(bar.querySelector('.account-chip'))return;
      var wrap=document.createElement('div');
      wrap.className='account-chip mari-account-session-chip';
      wrap.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small>เข้าสู่ระบบแล้ว</small></span>';
      wrap.querySelector('.account-name').textContent=nameOf(state.user);
      bar.insertBefore(wrap,bar.firstChild);
    });
  }

  function cachedResponse(user){
    return new Response(JSON.stringify({user:user}),{
      status:200,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Mari-Auth-Fallback':'1'}
    });
  }

  async function refresh(){
    try{
      var r=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      if(r.status===401){
        /* Keep the UI stable during a transient auth/cookie race. */
        var keep=cachedUser();
        if(keep){state.user=keep;state.checked=true;render();return keep;}
        state.checked=true;
        return null;
      }
      if(!r.ok)throw new Error('auth-check-failed');
      var d=await r.json();
      if(!d||!d.user)throw new Error('not-authenticated');
      cacheUser(d.user);
      render();
      return d.user;
    }catch(e){
      var u=cachedUser();
      if(u){state.user=u;state.checked=true;render();return u;}
      return null;
    }
  }

  function installAuthFetchHook(){
    if(window.__mariAccountFetchHook)return;
    var original=window.fetch;
    if(typeof original!=='function')return;
    window.__mariAccountFetchHook=true;
    window.fetch=function(input,init){
      var method=String((init&&init.method)||((input&&input.method)||'GET')).toUpperCase();
      var url='';
      try{url=typeof input==='string'?input:(input&&input.url)||'';}catch(e){}
      var pathname=url;
      try{pathname=new URL(url,location.href).pathname;}catch(e){}
      var isAuthWrite=/^\/api\/(login|register|logout)$/.test(pathname);
      var isMe=method==='GET' && pathname==='/api/me';
      var result=original.apply(this,arguments);
      if(isMe){
        return Promise.resolve(result).then(function(response){
          if(response && response.ok)return response;
          var keep=cachedUser();
          /* A cached account is only a UI fallback. The real backend session remains authoritative. */
          if(keep && response && (response.status===401 || response.status>=500))return cachedResponse(keep);
          return response;
        }).catch(function(){
          var keep=cachedUser();
          if(keep)return cachedResponse(keep);
          throw new Error('auth-check-failed');
        });
      }
      if(!isAuthWrite)return result;
      return Promise.resolve(result).then(function(response){
        if(!response || !response.ok)return response;
        if(method==='POST' && (pathname==='/api/login'||pathname==='/api/register')){
          response.clone().json().then(function(data){
            if(data&&data.user){cacheUser(data.user);render();}
          }).catch(function(){});
        }else if(method==='POST' && pathname==='/api/logout'){
          cacheUser(null);
          try{localStorage.removeItem('mariAccountCache_v2');}catch(e){}
          state.user=null;
          document.querySelectorAll('.mari-account-session-chip').forEach(function(el){el.remove();});
        }
        return response;
      });
    };
  }

  function start(){
    installAuthFetchHook();
    var u=cachedUser();
    if(u){state.user=u;state.checked=true;render();}
    refresh();
    if(window.MutationObserver){
      var observer=new MutationObserver(function(){if(state.user)queueRender();});
      observer.observe(document.documentElement,{childList:true,subtree:true});
    }
    window.addEventListener('popstate',function(){setTimeout(refresh,0);});
    window.addEventListener('pageshow',function(){setTimeout(refresh,0);});
  }

  function queueRender(){
    if(state.renderQueued)return;
    state.renderQueued=true;
    requestAnimationFrame(function(){state.renderQueued=false;render();});
  }

  window.MariAccountSession={
    refresh:refresh,
    getUser:function(){return state.user||cachedUser();},
    clear:function(){cacheUser(null);try{localStorage.removeItem('mariAccountCache_v2');}catch(e){};state.user=null;}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
