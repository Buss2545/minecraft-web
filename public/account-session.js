/* Mari JP SMP — Cloudflare-safe account/session bridge. */
(function(){
  'use strict';
  if(window.__MARI_ACCOUNT_SESSION_V8__) return;
  window.__MARI_ACCOUNT_SESSION_V8__=true;
  var KEY='mariAccountCache_v8';
  var OLD=['mariAccountCache_v7','mariAccountCache_v6','mariAccountCache_v5','mariAccountCache_v4','mariAccountCache_v3','mariAccountCache_v2'];
  var state={user:null,checked:false};

  function readCache(){
    try{
      var keys=[KEY].concat(OLD);
      for(var i=0;i<keys.length;i++){
        var raw=localStorage.getItem(keys[i]);
        if(!raw) continue;
        var user=JSON.parse(raw);
        if(user&&user.username){if(keys[i]!==KEY)localStorage.setItem(KEY,raw);return user;}
      }
    }catch(_){ }
    return null;
  }

  function sync(user,clear){
    state.user=user||null; state.checked=true;
    try{
      if(user) localStorage.setItem(KEY,JSON.stringify(user));
      else if(clear) [KEY].concat(OLD).forEach(function(k){localStorage.removeItem(k);});
    }catch(_){ }
    try{
      if(typeof window.currentUser!=='undefined') window.currentUser=user||null;
      if(typeof window.renderAuth==='function') window.renderAuth();
      if(typeof window.renderTopupSection==='function') window.renderTopupSection();
      if(typeof window.chatSetNotificationUser==='function') window.chatSetNotificationUser(user||null);
      document.querySelectorAll('.account-name,[data-account-name]').forEach(function(el){el.textContent=user?(user.displayName||user.username||''):'';});
      window.dispatchEvent(new CustomEvent('mari:account-updated',{detail:user||null}));
    }catch(_){ }
  }

  function escapeHtml(v){return String(v).replace(/[&<>\"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]);});}

  function openFallback(){
    if(!state.user){window.location.href='/auth.html';return;}
    var old=document.getElementById('mariAccountFallbackModal'); if(old)old.remove();
    var u=state.user,o=document.createElement('div');o.id='mariAccountFallbackModal';
    o.style.cssText='position:fixed;inset:0;z-index:2147483001;background:rgba(20,12,17,.62);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box';
    var c=document.createElement('div');c.style.cssText='width:min(440px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:22px;padding:22px;color:#2b2026;font-family:Arial,sans-serif';
    c.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><div><small>บัญชีของฉัน</small><h2 style="margin:4px 0">'+escapeHtml(u.displayName||u.username||'สมาชิก')+'</h2></div><button type="button" data-x style="border:0;background:#f4e8ed;border-radius:10px;width:40px;height:40px;font-size:22px">×</button></div><div data-r style="display:grid;gap:8px;margin-top:14px"></div><button type="button" data-refresh style="margin-top:14px;width:100%;padding:12px;border:0;border-radius:12px;background:#2b2026;color:#fff;font-weight:700">ตรวจสอบบัญชี</button>';
    var r=c.querySelector('[data-r]');
    [['ชื่อผู้ใช้',u.username||'-'],['UID',u.uid||u.id||'-'],['ยศ',u.titleId||'member'],['Minecraft',u.minecraft||'ยังไม่ได้ตั้ง'],['ยอดเงิน','฿'+Number(u.balance||0).toLocaleString('th-TH')]].forEach(function(x){var d=document.createElement('div');d.style.cssText='display:flex;justify-content:space-between;gap:10px;padding:10px;background:#fff5f8;border-radius:10px';d.innerHTML='<span>'+escapeHtml(x[0])+'</span><b>'+escapeHtml(String(x[1]))+'</b>';r.appendChild(d);});
    o.appendChild(c);document.body.appendChild(o);
    c.querySelector('[data-x]').onclick=function(){o.remove();};
    c.querySelector('[data-refresh]').onclick=function(){refresh().then(openFallback);};
    o.onclick=function(e){if(e.target===o)o.remove();};
  }

  function openAccount(){
    try{
      if(typeof window.showAccount==='function')return window.showAccount();
      if(typeof window.showAccountModal==='function')return window.showAccountModal();
      if(typeof window.openProfile==='function')return window.openProfile();
      if(typeof window.openAccountModal==='function')return window.openAccountModal();
    }catch(_){ }
    openFallback();
  }

  function looksLikeAccount(el){
    if(!el||el.nodeType!==1)return false;
    var s=[el.textContent,el.getAttribute('aria-label'),el.getAttribute('title'),el.id,el.className].join(' ');
    return /บัญชีของฉัน|profile|account|โปรไฟล์/i.test(String(s||''));
  }
  function documentClick(e){
    var el=e.target&&e.target.closest?e.target.closest('button,a,[role="button"]'):null;
    if(!looksLikeAccount(el))return;
    e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();openAccount();
  }
  function installButtons(){
    var sel='.auth-btn,[data-account-open],[data-profile-open],#accountBtn,#profileBtn,[aria-label*="บัญชี"],[aria-label*="profile"],[aria-label*="account"]';
    document.querySelectorAll(sel).forEach(function(btn){
      if(btn.__mariAccountV8)return;btn.__mariAccountV8=true;
      btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();openAccount();},true);
    });
  }

  function patchFetch(){
    if(window.__mariFetchV8||typeof window.fetch!=='function')return;
    var original=window.fetch;window.__mariFetchV8=true;
    window.fetch=function(input,init){
      var opts=init?Object.assign({},init):{};var method=String(opts.method||(input&&input.method)||'GET').toUpperCase();var url='';
      try{url=typeof input==='string'?input:(input&&input.url)||'';}catch(_){ }
      var path=url;try{path=new URL(url,location.href).pathname;}catch(_){ }
      if(path.indexOf('/api/')===0)opts.credentials='include';
      var isMe=method==='GET'&&path==='/api/me',isLogin=method==='POST'&&(path==='/api/login'||path==='/api/register'),isLogout=method==='POST'&&path==='/api/logout';
      var p=original.call(this,input,opts);
      if(isMe)return Promise.resolve(p).then(function(r){if(r.ok)r.clone().json().then(function(d){if(d&&d.user)sync(d.user,false);}).catch(function(){});else if(r.status===401)sync(null,true);return r;});
      if(isLogin)return Promise.resolve(p).then(function(r){if(r.ok)r.clone().json().then(function(d){if(d&&d.user)sync(d.user,false);}).catch(function(){});return r;});
      if(isLogout)return Promise.resolve(p).then(function(r){if(r.ok)sync(null,true);return r;});
      return p;
    };
  }

  async function refresh(){
    try{
      var r=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      if(r.ok){var d=await r.json();if(d&&d.user){sync(d.user,false);return d.user;}}
      if(r.status===401){sync(null,true);return null;}
      var cached=readCache();if(cached){state.user=cached;state.checked=true;return cached;}
    }catch(_){var cached2=readCache();if(cached2){state.user=cached2;state.checked=true;return cached2;}}
    state.checked=true;return null;
  }

  function chip(){
    if(!state.user)return;
    document.querySelectorAll('.authbar').forEach(function(bar){
      if(bar.querySelector('.mari-account-session-chip'))return;
      var b=document.createElement('button');b.type='button';b.className='account-chip mari-account-session-chip';b.style.cssText='display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer';
      b.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small style="display:block;opacity:.7">เข้าสู่ระบบแล้ว</small></span>';
      b.querySelector('.account-name').textContent=state.user.displayName||state.user.username||'';b.onclick=function(e){e.preventDefault();openAccount();};bar.insertBefore(b,bar.firstChild);
    });
  }

  function start(){
    patchFetch();var cached=readCache();if(cached){state.user=cached;sync(cached,false);chip();}
    installButtons();document.addEventListener('click',documentClick,true);refresh().then(function(){chip();installButtons();});
    if(window.MutationObserver)new MutationObserver(function(){chip();installButtons();}).observe(document.documentElement,{childList:true,subtree:true});
    window.addEventListener('pageshow',function(){refresh().then(chip);});document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
