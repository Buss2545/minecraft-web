/* Clear service workers/caches left by the legacy frontend before the v2 site takes over. */
(function(){
  'use strict';
  if (window.__MARI_V2_RESET__) return;
  window.__MARI_V2_RESET__ = true;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function(list){
        list.forEach(function(reg){ reg.unregister().catch(function(){}); });
      }).catch(function(){});
    }
    if (window.caches && caches.keys) {
      caches.keys().then(function(keys){ keys.forEach(function(k){ caches.delete(k).catch(function(){}); }); }).catch(function(){});
    }
  } catch (_) {}
})();
