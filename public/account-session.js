/* Mari JP SMP — persistent account UI + resilient profile entry point. */
(function(){
  'use strict';
  var KEY='mariAccountCache_v4';
  var OLD_KEYS=['mariAccountCache_v3','mariAccountCache_v2'];
  var state={user:null,checked:false,renderQueued:false};

  function syncPageUser(user){
    // index.html owns the real `currentUser` variable. When this helper loads
    // after the page scripts, seed it from the persistent cache so a normal
    // page navigation does not briefly turn a logged-in account into a guest.
    try{
      if(user && typeof currentUser!=='undefined'){
        currentUser=user;
        if(typeof renderAuth==='function')renderAuth();
        if(typeof renderTopupSection==='function')renderTopupSection();
        if(window.chatSetNotificationUser)window.chatSetNotificationUser(user);
      }
    }catch(e){}
  }

  function cacheUser(user){
    state.user=user||null;
    state.checked=true;
    try{
      if(user)localStorage.setItem(KEY,JSON.stringify(user));
      else{
        localStorage.removeItem(KEY);
        OLD_KEYS.forEach(function(k){localStorage.removeItem(k);});
      }
    }catch(e){}
    if(user)syncPageUser(user);
  }

  function cachedUser(){
    try{
      var keys=[KEY].concat(OLD_KEYS);
      for(var i=0;i<keys.length;i++){
        var raw=localStorage.getItem(keys[i]);
        if(!raw)continue;
        var u=JSON.parse(raw);
        if(u&&u.username){
          if(keys[i]!==KEY)localStorage.setItem(KEY,raw);
          return u;
        }
      }
    }catch(e){}
    return null;
  }

  function nameOf(u){return String((u&&u.displayName)||(u&&u.username)||'');}
  function esc(x){return String(x==null?'':x).replace(/[&<>\"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]);});}

  function updateExisting(root){
    var nodes=(root||document).querySelectorAll('.account-chip');
    nodes.forEach(function(chip){
      var n=chip.querySelector('.account-name,b');
      if(n&&state.user)n.textContent=nameOf(state.user);
    });
  }

  function render(){
    if(!state.user)return;
    updateExisting(document);
    document.querySelectorAll('.authbar').forEach(function(bar){
      if(bar.querySelector('.mari-account-session-chip'))return;
      // Only add this fallback chip when the page's own auth UI has not
      // rendered an account chip yet. Never add a second "บัญชีของฉัน"
      // click handler: the old bridge listened in capture phase and caused
      // the real button's inline onclick to fire twice.
      if(bar.querySelector('.auth-btn'))return;
      var wrap=document.createElement('div');
      wrap.className='account-chip mari-account-session-chip';
      wrap.setAttribute('role','button');
      wrap.setAttribute('tabindex','0');
      wrap.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small>เข้าสู่ระบบแล้ว</small></span>';
      wrap.querySelector('.account-name').textContent=nameOf(state.user);
      var open=function(){
        try{
          if(typeof window.openAccount==='function')return Promise.resolve(window.openAccount());
          if(typeof window.authOpen==='function')return window.authOpen('login');
        }catch(e){}
      };
      wrap.addEventListener('click',open);
      wrap.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
      bar.insertBefore(wrap,bar.firstChild);
    });
  }

  function cachedResponse(user){
    return new Response(JSON.stringify({user:user}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Mari-Auth-Fallback':'1'}});
  }

  async function refresh(){
    try{
      var r=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      if(r.status===401){
        var keep=cachedUser();
        if(keep){state.user=keep;state.checked=true;syncPageUser(keep);render();return keep;}
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
      if(u){state.user=u;state.checked=true;syncPageUser(u);render();return u;}
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
      var isMe=method==='GET'&&pathname==='/api/me';
      var result=original.apply(this,arguments);
      if(isMe){
        return Promise.resolve(result).then(function(response){
          if(response&&response.ok)return response;
          var keep=cachedUser();
          if(keep&&response&&(response.status===401||response.status>=500))return cachedResponse(keep);
          return response;
        }).catch(function(){
          var keep=cachedUser();
          if(keep)return cachedResponse(keep);
          throw new Error('auth-check-failed');
        });
      }
      if(!isAuthWrite)return result;
      return Promise.resolve(result).then(function(response){
        if(!response||!response.ok)return response;
        if(method==='POST'&&(pathname==='/api/login'||pathname==='/api/register')){
          response.clone().json().then(function(data){
            if(data&&data.user){cacheUser(data.user);render();}
          }).catch(function(){});
        }else if(method==='POST'&&pathname==='/api/logout'){
          cacheUser(null);
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
    if(u){
      state.user=u;
      state.checked=true;
      syncPageUser(u);
      render();
    }
    // Do not install a document-level capture click listener. Page buttons
    // already have their own onclick handlers; duplicating those clicks was
    // the reason "บัญชีของฉัน" could open twice or immediately close/fail.
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
    clear:function(){cacheUser(null);state.user=null;}
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
