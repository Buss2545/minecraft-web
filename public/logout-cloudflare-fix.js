/* Mari JP SMP — reliable logout bridge for legacy UI buttons. */
(function(){
  'use strict';
  if(window.__MARI_LOGOUT_CF_FIX_V1__) return;
  window.__MARI_LOGOUT_CF_FIX_V1__=true;
  var keys=['mariAccountCache_v8','mariAccountCache_v7','mariAccountCache_v6','mariAccountCache_v5','mariAccountCache_v4','mariAccountCache_v3','mariAccountCache_v2'];
  function clearLocal(){try{keys.forEach(function(k){localStorage.removeItem(k);});}catch(_){} try{sessionStorage.clear();}catch(_){} }
  async function logout(e){
    if(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}
    try{await fetch('/api/logout',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'}});}catch(_){try{await fetch('/api/logout',{method:'GET',credentials:'include',cache:'no-store'});}catch(_){}}
    clearLocal();
    try{window.currentUser=null;window.dispatchEvent(new CustomEvent('mari:account-updated',{detail:null}));if(typeof window.renderAuth==='function')window.renderAuth();}catch(_){}
    location.href='/auth.html';
  }
  function isLogout(el){
    if(!el||el.nodeType!==1)return false;
    var s=[el.textContent,el.getAttribute('aria-label'),el.getAttribute('title'),el.id,el.className,el.getAttribute('href')].join(' ');
    return /ออกจากระบบ|logout|sign[ -]?out/i.test(String(s||''));
  }
  function start(){document.addEventListener('click',function(e){var el=e.target&&e.target.closest?e.target.closest('button,a,[role="button"]'):null;if(isLogout(el))logout(e);},true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
