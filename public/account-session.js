/* Mari JP SMP — persistent account UI + resilient profile entry point. */
(function(){
  'use strict';
  var KEY='mariAccountCache_v3';
  var state={user:null,checked:false,renderQueued:false};

  function cacheUser(user){
    state.user=user||null;
    state.checked=true;
    try{ if(user)localStorage.setItem(KEY,JSON.stringify(user)); else localStorage.removeItem(KEY); }catch(e){}
  }
  function cachedUser(){
    try{
      var raw=localStorage.getItem(KEY);
      if(raw){var u=JSON.parse(raw);if(u&&u.username)return u;}
      raw=localStorage.getItem('mariAccountCache_v2');
      if(raw){var old=JSON.parse(raw);if(old&&old.username){localStorage.setItem(KEY,raw);return old;}}
    }catch(e){}
    return null;
  }
  function nameOf(u){return String((u&&u.displayName)||(u&&u.username)||'');}
  function esc(x){return String(x==null?'':x).replace(/[&<>\"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]);});}
  function updateExisting(root){
    var nodes=(root||document).querySelectorAll('.account-chip');
    nodes.forEach(function(chip){var n=chip.querySelector('.account-name,b');if(n&&state.user)n.textContent=nameOf(state.user);});
  }
  function render(){
    if(!state.user)return;
    updateExisting(document);
    document.querySelectorAll('.authbar').forEach(function(bar){
      if(bar.querySelector('.account-chip'))return;
      var wrap=document.createElement('div');
      wrap.className='account-chip mari-account-session-chip';
      wrap.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small>เข้าสู่ระบบแล้ว</small></span>';
      wrap.querySelector('.account-name').textContent=nameOf(state.user);bar.insertBefore(wrap,bar.firstChild);
    });
  }
  function cachedResponse(user){return new Response(JSON.stringify({user:user}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Mari-Auth-Fallback':'1'}});}
  async function refresh(){
    try{
      var r=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      if(r.status===401){var keep=cachedUser();if(keep){state.user=keep;state.checked=true;render();return keep;}state.checked=true;return null;}
      if(!r.ok)throw new Error('auth-check-failed');
      var d=await r.json();if(!d||!d.user)throw new Error('not-authenticated');cacheUser(d.user);render();return d.user;
    }catch(e){var u=cachedUser();if(u){state.user=u;state.checked=true;render();return u;}return null;}
  }
  function installAuthFetchHook(){
    if(window.__mariAccountFetchHook)return;
    var original=window.fetch;if(typeof original!=='function')return;window.__mariAccountFetchHook=true;
    window.fetch=function(input,init){
      var method=String((init&&init.method)||((input&&input.method)||'GET')).toUpperCase();var url='';
      try{url=typeof input==='string'?input:(input&&input.url)||'';}catch(e){}
      var pathname=url;try{pathname=new URL(url,location.href).pathname;}catch(e){}
      var isAuthWrite=/^\/api\/(login|register|logout)$/.test(pathname);var isMe=method==='GET'&&pathname==='/api/me';var result=original.apply(this,arguments);
      if(isMe)return Promise.resolve(result).then(function(response){if(response&&response.ok)return response;var keep=cachedUser();if(keep&&response&&(response.status===401||response.status>=500))return cachedResponse(keep);return response;}).catch(function(){var keep=cachedUser();if(keep)return cachedResponse(keep);throw new Error('auth-check-failed');});
      if(!isAuthWrite)return result;
      return Promise.resolve(result).then(function(response){
        if(!response||!response.ok)return response;
        if(method==='POST'&&(pathname==='/api/login'||pathname==='/api/register'))response.clone().json().then(function(data){if(data&&data.user){cacheUser(data.user);render();}}).catch(function(){});
        else if(method==='POST'&&pathname==='/api/logout'){cacheUser(null);try{localStorage.removeItem('mariAccountCache_v2');}catch(e){};state.user=null;document.querySelectorAll('.mari-account-session-chip').forEach(function(el){el.remove();});}
        return response;
      });
    };
  }
  function fallbackProfile(){
    var user=state.user||cachedUser();if(!user){if(typeof window.authOpen==='function')window.authOpen('login');else location.href='/auth.html';return;}
    var old=document.getElementById('mariFallbackProfile');if(old)old.remove();
    var ov=document.createElement('div');ov.id='mariFallbackProfile';ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(25,15,22,.62);display:flex;align-items:center;justify-content:center;padding:18px;';
    ov.innerHTML='<div style="width:min(440px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:24px;padding:22px;box-shadow:0 20px 70px rgba(0,0,0,.3);font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#2b2026"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><h2 style="margin:0">👤 บัญชีของฉัน</h2><button id="mariFallbackClose" type="button" style="border:0;background:#f7e7ed;border-radius:12px;padding:8px 12px;font-size:18px">×</button></div><div style="display:flex;align-items:center;gap:14px;margin:18px 0;padding:14px;border-radius:18px;background:#fff5f9">'+(user.avatarUrl?'<img src="'+esc(user.avatarUrl)+'" style="width:64px;height:64px;border-radius:18px;object-fit:cover">':'<div style="width:64px;height:64px;border-radius:18px;background:#ee7fa5;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:900">M</div>')+'<div><div style="font-size:12px;color:#806b75">ชื่อแสดงผล</div><b style="font-size:20px">'+esc(nameOf(user))+'</b><div style="font-size:13px;color:#806b75">@'+esc(user.username||'')+(user.uid?' · UID '+esc(user.uid):'')+'</div></div></div><div style="display:grid;gap:10px"><div style="padding:12px;border:1px solid #efd6e0;border-radius:14px">💰 เครดิตคงเหลือ <b>฿'+Number(user.balance||0).toLocaleString('th-TH')+'</b></div><div style="padding:12px;border:1px solid #efd6e0;border-radius:14px">🎮 Minecraft <b>'+esc(user.minecraft||'ยังไม่ได้ผูกไอดี')+'</b></div><div style="padding:12px;border:1px solid #efd6e0;border-radius:14px">🏆 ยศ <b>'+esc((user.title&&user.title.id)||user.titleId||'member')+'</b></div></div><div style="margin-top:16px;color:#806b75;font-size:13px">โปรไฟล์หลักกำลังโหลดรายละเอียดเพิ่มเติม หากหน้าบัญชีเดิมมีปัญหา คุณยังใช้ข้อมูลบัญชีพื้นฐานตรงนี้ได้</div></div>';
    document.body.appendChild(ov);ov.querySelector('#mariFallbackClose').onclick=function(){ov.remove();};ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
  }
  function installProfileBridge(){
    if(window.__mariProfileBridge)return;window.__mariProfileBridge=true;
    var original=window.openAccount;
    if(typeof original==='function'&&!original.__mariWrapped){
      var wrapped=function(){try{var result=original.apply(this,arguments);return Promise.resolve(result).catch(function(){fallbackProfile();});}catch(e){fallbackProfile();return Promise.resolve();}};
      wrapped.__mariWrapped=true;window.openAccount=wrapped;
    }
    document.addEventListener('click',function(e){
      var el=e.target&&e.target.closest?e.target.closest('button,a,.account-chip'):null;if(!el)return;
      var text=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if(text==='บัญชีของฉัน'||el.classList.contains('mari-account-session-chip')){
        if(typeof window.openAccount==='function')Promise.resolve().then(function(){return window.openAccount();}).catch(function(){fallbackProfile();});else fallbackProfile();
      }
    },true);
  }
  function start(){
    installAuthFetchHook();var u=cachedUser();if(u){state.user=u;state.checked=true;render();}refresh();installProfileBridge();
    if(window.MutationObserver){var observer=new MutationObserver(function(){if(state.user)queueRender();});observer.observe(document.documentElement,{childList:true,subtree:true});}
    window.addEventListener('popstate',function(){setTimeout(refresh,0);});window.addEventListener('pageshow',function(){setTimeout(refresh,0);});
  }
  function queueRender(){if(state.renderQueued)return;state.renderQueued=true;requestAnimationFrame(function(){state.renderQueued=false;render();});}
  window.MariAccountSession={refresh:refresh,getUser:function(){return state.user||cachedUser();},clear:function(){cacheUser(null);try{localStorage.removeItem('mariAccountCache_v2');}catch(e){};state.user=null;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
