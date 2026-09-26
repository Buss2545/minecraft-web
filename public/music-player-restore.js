/* Mari JP SMP — music player emergency restore.
 * Keeps the existing player/UI. Does not replace the music system.
 * It only prevents the shared player from being hidden by stale UI settings
 * or an old localStorage hide flag after the Cloudflare migration.
 */
(function(){
  'use strict';
  if(window.__MARI_MUSIC_RESTORE_V1__) return;
  window.__MARI_MUSIC_RESTORE_V1__=true;
  if(location.pathname === '/rpg.html') return;

  var BAR_ID='autoMusicBar';
  var RESTORE_ID='mariMusicRestore';
  var oldKeys=['mariMusicBarHidden','mariMusicBarHidden_v3'];

  function clearOldHiddenFlags(){
    try{oldKeys.forEach(function(k){localStorage.removeItem(k);});}catch(e){}
  }

  function ensure(){
    clearOldHiddenFlags();
    var bar=document.getElementById(BAR_ID);
    if(!bar && typeof window.MariMusicEnsureBar==='function'){
      try{window.MariMusicEnsureBar();}catch(e){}
      bar=document.getElementById(BAR_ID);
    }
    if(bar){
      bar.classList.remove('mari-ui-hidden');
      bar.style.removeProperty('display');
      bar.style.setProperty('display','flex','important');
      bar.style.setProperty('position','fixed','important');
      bar.style.setProperty('z-index','2147483000','important');
    }
    var restore=document.getElementById(RESTORE_ID);
    if(restore) restore.classList.remove('show');
  }

  function start(){
    ensure();
    setTimeout(ensure,250);
    setTimeout(ensure,1000);
    setTimeout(ensure,2500);
    setTimeout(ensure,5000);
    if(window.MutationObserver){
      new MutationObserver(function(){
        var bar=document.getElementById(BAR_ID);
        if(bar && (bar.classList.contains('mari-ui-hidden') || bar.style.display==='none')) ensure();
      }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
