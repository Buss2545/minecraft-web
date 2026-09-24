/* Mari JP SMP — shared UI helpers.
 * Admin-configurable behavior is loaded from /api/site/settings.
 * This file never creates a music player or starts playback; it only
 * enhances an already-existing bar on pages that intentionally provide one.
 */
(function(){
  'use strict';
  var DEFAULTS={
    musicBarEnabled:true,
    hideButtonEnabled:true,
    restoreButtonEnabled:true,
    rememberHidden:true,
    hideButtonLabel:'×',
    restoreButtonLabel:'🎵 แสดงเพลง'
  };
  var settings=Object.assign({},DEFAULTS);
  var HIDDEN_KEY='mariMusicBarHidden_v3';
  var OLD_HIDDEN_KEY='mariMusicBarHidden';
  var BAR_ID='autoMusicBar';
  var RESTORE_ID='mariMusicRestore';

  function isRemembering(){return settings.rememberHidden!==false;}
  function isHidden(){
    if(!isRemembering()) return false;
    try{return localStorage.getItem(HIDDEN_KEY)==='1';}catch(e){return false;}
  }
  function setHidden(value){
    if(!isRemembering()) return;
    try{localStorage.setItem(HIDDEN_KEY,value?'1':'0');}catch(e){}
  }
  function clearLegacyHiddenState(){try{localStorage.removeItem(OLD_HIDDEN_KEY);}catch(e){}}
  function addStyles(){
    if(document.getElementById('mari-global-ui-style'))return;
    var style=document.createElement('style');style.id='mari-global-ui-style';
    style.textContent=`
      .auto-music-bar.mari-ui-hidden{display:none!important}
      /* Shared floating music player: always detached from page flow. */
      .auto-music-bar{position:fixed!important;left:50%!important;right:auto!important;bottom:calc(12px + env(safe-area-inset-bottom))!important;transform:translateX(-50%)!important;z-index:2147483000!important;width:min(760px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;box-sizing:border-box!important}
      .mari-music-hide{position:absolute!important;top:8px!important;right:8px!important;border:0!important;border-radius:8px!important;min-width:31px!important;width:31px!important;height:31px!important;padding:0!important;background:#ffffff1c!important;color:#fff!important;cursor:pointer!important;font:900 20px/31px Arial,sans-serif!important;text-align:center!important;z-index:4!important;display:grid!important;place-items:center!important}.mari-music-hide:hover{background:#ffffff33!important}
      #${RESTORE_ID}{position:fixed!important;right:12px!important;bottom:calc(12px + env(safe-area-inset-bottom))!important;z-index:2147482999!important;display:none;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 13px;background:#21171df5;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.24);backdrop-filter:blur(10px);font:800 12px/1.2 Segoe UI,Tahoma,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
      #${RESTORE_ID}.show{display:block!important}
      /* Keep the Mari Online Music modal visually consistent on every page. */
      .music-modal .modalbox{width:min(760px,95vw)!important;max-width:95vw!important;max-height:min(88vh,820px)!important;border-radius:18px!important;overflow:hidden!important}
      .music-modal .music-player{padding:18px!important;box-sizing:border-box!important}
      .music-modal .music-now{min-height:82px!important;box-sizing:border-box!important}
      @media(max-width:600px){
        .auto-music-bar{left:8px!important;right:8px!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;transform:none!important;width:calc(100vw - 16px)!important;max-width:none!important;min-height:52px!important;padding:7px 43px 7px 7px!important;border-radius:14px!important;gap:5px!important;box-sizing:border-box!important}
        .auto-music-bar .auto-music-copy{min-width:0!important;flex:1 1 calc(100% - 102px)!important;max-width:calc(100% - 102px)!important}
        .auto-music-bar .auto-music-controls{flex:0 0 auto!important;gap:3px!important}
        .auto-music-bar .auto-music-controls button{min-width:30px!important;width:30px!important;height:30px!important;font-size:13px!important}
        .auto-music-bar .auto-music-controls input{width:52px!important}
        .auto-music-bar .auto-music-time{display:none!important}
        .auto-music-enable{font-size:11px!important;padding:7px 8px!important}
        .mari-music-hide{top:6px!important;right:6px!important;min-width:29px!important;width:29px!important;height:29px!important;font-size:18px!important;line-height:29px!important}
        #${RESTORE_ID}{right:10px!important;bottom:calc(10px + env(safe-area-inset-bottom))!important;padding:9px 11px!important;font-size:11px!important}
        .music-modal .modalbox{width:calc(100vw - 24px)!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - 32px)!important;margin:16px auto!important;border-radius:16px!important}
        .music-modal .modalbox>h3{padding:13px 15px!important;font-size:18px!important}
        .music-modal .modalbox>p#mx{max-height:calc(100dvh - 90px)!important}
        .music-modal .music-player{padding:10px!important}
        .music-modal .music-now{padding:10px!important;gap:9px!important;min-height:74px!important}
        .music-modal .music-now .music-now-copy{min-width:0!important}
        .music-modal .music-now .music-now-copy b,.music-modal .music-now .music-now-copy small{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      }
    `;
    document.head.appendChild(style);
  }
  function getRestore(){
    var r=document.getElementById(RESTORE_ID);
    if(r)return r;
    r=document.createElement('button');r.id=RESTORE_ID;r.type='button';
    r.textContent=settings.restoreButtonLabel;r.title='แสดงแถบเพลงอีกครั้ง';
    r.onclick=function(){showMusicBar();};document.body.appendChild(r);return r;
  }
  function updateVisibility(){
    var bar=document.getElementById(BAR_ID);
    var restore=document.getElementById(RESTORE_ID);
    if(!restore && settings.restoreButtonEnabled!==false && settings.musicBarEnabled!==false) restore=getRestore();
    if(!bar){
      if(restore)restore.classList.toggle('show',settings.musicBarEnabled!==false&&settings.restoreButtonEnabled!==false&&isHidden());
      return;
    }
    if(settings.musicBarEnabled===false){
      bar.style.display='none';
      if(restore)restore.classList.remove('show');
      return;
    }
    bar.style.removeProperty('display');
    bar.classList.toggle('mari-ui-hidden',isHidden());
    if(restore)restore.classList.toggle('show',settings.restoreButtonEnabled!==false&&isHidden());
  }
  function hideMusicBar(){setHidden(true);updateVisibility();}
  function showMusicBar(){
    setHidden(false);
    // The restore control can be clicked before the page's async music player
    // has finished creating its bar. In that case, create the bar first so the
    // button never disappears into an empty screen.
    if(!document.getElementById(BAR_ID) && typeof window.MariMusicEnsureBar==='function'){
      try{window.MariMusicEnsureBar();}catch(e){}
    }
    updateVisibility();
  }
  function enhanceBar(bar){
    if(!bar)return;
    // Always install the hide control on every page that has the shared music bar.
    // Do this BEFORE the admin visibility setting is applied; otherwise a bar that
    // was already rendered by the page can appear without any way to hide it.
    if(bar.querySelector('.mari-music-hide')){
      bar.dataset.mariHideReady='1';
    } else if(settings.hideButtonEnabled!==false && bar.dataset.mariHideReady!=='1'){
      bar.dataset.mariHideReady='1';
      var btn=document.createElement('button');btn.type='button';btn.className='mari-music-hide';
      btn.textContent=settings.hideButtonLabel||'×';
      btn.title='ซ่อนแถบเพลง';btn.setAttribute('aria-label','ซ่อนแถบเพลง');
      btn.onclick=hideMusicBar;
      bar.appendChild(btn);
    }
    updateVisibility();
  }
  function scan(){
    addStyles();
    var bar=document.getElementById(BAR_ID);
    if(bar)enhanceBar(bar);
    if(settings.restoreButtonEnabled!==false && settings.musicBarEnabled!==false)getRestore();
    updateVisibility();
  }
  async function loadSettings(){
    try{
      var r=await fetch('/api/site/settings',{cache:'no-store'});
      if(r.ok){
        var d=await r.json();
        if(d&&d.settings&&d.settings.globalUi)settings=Object.assign({},DEFAULTS,d.settings.globalUi);
        // RPG page: music is disabled on this route only. Other pages keep the Admin setting.
        if(location.pathname === '/rpg.html'){
          settings.musicBarEnabled=false;
          settings.restoreButtonEnabled=false;
          settings.hideButtonEnabled=false;
        }
      }
    }catch(e){}
  }
  var adminAccountAllowed=null;
  var adminAccountPermissionPromise=null;
  function loadAdminAccountPermission(){
    if(adminAccountAllowed!==null) return Promise.resolve(adminAccountAllowed);
    if(adminAccountPermissionPromise) return adminAccountPermissionPromise;
    adminAccountPermissionPromise=fetch('/api/me',{credentials:'same-origin',cache:'no-store'})
      .then(function(r){
        if(!r.ok) return false;
        return r.json().then(function(d){
          var tid=d&&d.user&&d.user.titleId;
          return tid==='admin'||tid==='creator';
        });
      })
      .catch(function(){return false;})
      .then(function(allowed){
        adminAccountAllowed=!!allowed;
        adminAccountPermissionPromise=null;
        return adminAccountAllowed;
      });
    return adminAccountPermissionPromise;
  }
  function ensureAdminAccountButton(){
    var shell=document.querySelector('.account-shell');
    if(!shell) return;
    loadAdminAccountPermission().then(function(allowed){
      if(!allowed){
        shell.querySelector('.mari-admin-account-panel')?.remove();
        return;
      }
      if(shell.querySelector('.mari-admin-account-panel')) return;
      var quick=shell.querySelector('.account-quick-actions');
      var panel=document.createElement('section');
      panel.className='account-panel mari-admin-account-panel';
      panel.innerHTML='<div class=\"account-panel-heading\"><span class=\"account-panel-icon\">🛡️</span><div><h4>Admin</h4><p>จัดการระบบเว็บไซต์และเครื่องมือสำหรับทีมงาน</p></div></div><button type=\"button\" class=\"btn account-wide-button\" style=\"width:100%;margin-top:10px\" onclick=\"location.href=\'/admin.html\'\">เปิด Admin</button>';
      if(quick&&quick.parentNode) quick.parentNode.insertBefore(panel,quick.nextSibling);
      else shell.insertBefore(panel,shell.firstChild);
    });
  }
  function watchAccountAdmin(){
    ensureAdminAccountButton();
    var root=document.body;
    if(!root || root.__mariAdminAccountObserver) return;
    var ob=new MutationObserver(function(){ensureAdminAccountButton();});
    ob.observe(root,{childList:true,subtree:true});
    root.__mariAdminAccountObserver=ob;
  }
  async function init(){
    clearLegacyHiddenState();
    await loadSettings();scan();
    watchAccountAdmin();
    // watchAccountAdmin() already owns the account-panel observer; keep this
    // second observer focused on the music/global UI scan to avoid duplicate
    // admin-panel insertion attempts while /api/me is still pending.
    new MutationObserver(function(){scan();}).observe(document.documentElement,{childList:true,subtree:true});
  }
  window.MariMusicBar={hide:hideMusicBar,show:showMusicBar,isHidden:isHidden,refresh:updateVisibility,getSettings:function(){return Object.assign({},settings)}};
  if(document.body)init();else document.addEventListener('DOMContentLoaded',init);
})();