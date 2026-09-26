/* Mari JP SMP — keep the logged-in account visible across page navigation. */
(function(){
  'use strict';
  var KEY='mariAccountCache_v1';
  var state={user:null,checked:false};

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

  function me(){
    return fetch('/api/me',{method:'GET',credentials:'same-origin',cache:'no-store'})
      .then(function(r){
        if(!r.ok) throw new Error('not-authenticated');
        return r.json();
      })
      .then(function(d){
        if(!d||!d.user) throw new Error('not-authenticated');
        cacheUser(d.user);
        render();
        return d.user;
      })
      .catch(function(){
        /* A cached user is only a visual fallback; the server remains authoritative. */
        var u=cachedUser();
        if(u){state.user=u;state.checked=true;render();}
        return null;
      });
  }

  function render(){
    var user=state.user;
    if(!user)return;
    var bars=document.querySelectorAll('.authbar');
    bars.forEach(function(bar){
      var chip=bar.querySelector('.account-chip');
      if(chip){
        var name=chip.querySelector('b,.account-name');
        if(name) name.textContent=user.displayName||user.username||'';
        return;
      }
      /* Do not destroy existing navigation controls. Only add the missing account chip. */
      var wrap=document.createElement('div');
      wrap.className='account-chip mari-account-session-chip';
      wrap.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small>เข้าสู่ระบบแล้ว</small></span>';
      var name=wrap.querySelector('.account-name');
      name.textContent=user.displayName||user.username||'';
      bar.insertBefore(wrap,bar.firstChild);
    });
  }

  function start(){
    var u=cachedUser();
    if(u){state.user=u;render();}
    me();
    if(window.MutationObserver){
      var observer=new MutationObserver(function(){
        if(state.user) render();
      });
      observer.observe(document.documentElement,{childList:true,subtree:true});
    }
  }

  window.MariAccountSession={refresh:me,getUser:function(){return state.user||cachedUser()};};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
