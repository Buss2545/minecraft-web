/* Mari JP SMP — persist and rehydrate the logged-in account across page changes. */
(function(){
  'use strict';
  var KEY='mariAccountCache_v2';
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
    }catch(e){}
    return null;
  }
  function nameOf(u){return String((u&&u.displayName)||u&&u.username||'');}

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

  function queueRender(){
    if(state.renderQueued)return;
    state.renderQueued=true;
    requestAnimationFrame(function(){state.renderQueued=false;render();});
  }

  async function refresh(){
    try{
      var r=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      if(r.status===401){
        cacheUser(null);
        document.querySelectorAll('.mari-account-session-chip').forEach(function(el){el.remove();});
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
      if(u){state.user=u;state.checked=true;render();}
      return null;
    }
  }

  function start(){
    var u=cachedUser();
    if(u){state.user=u;state.checked=true;render();}
    refresh();
    if(window.MutationObserver){
      var observer=new MutationObserver(function(){if(state.user)queueRender();});
      observer.observe(document.documentElement,{childList:true,subtree:true});
    }
    /* Re-check after SPA/page-fragment navigation without requiring a full reload. */
    window.addEventListener('popstate',function(){setTimeout(refresh,0);});
    window.addEventListener('pageshow',function(){setTimeout(refresh,0);});
  }

  window.MariAccountSession={refresh:refresh,getUser:function(){return state.user||cachedUser();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
