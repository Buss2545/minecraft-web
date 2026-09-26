/* Mari JP SMP — persistent account/session bridge for Cloudflare Workers. */
(function () {
  'use strict';

  var KEY = 'mariAccountCache_v5';
  var OLD_KEYS = ['mariAccountCache_v4', 'mariAccountCache_v3', 'mariAccountCache_v2'];
  var state = { user: null, checked: false };

  function readCache() {
    try {
      var keys = [KEY].concat(OLD_KEYS);
      for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var user = JSON.parse(raw);
        if (user && user.username) {
          if (keys[i] !== KEY) localStorage.setItem(KEY, raw);
          return user;
        }
      }
    } catch (_) {}
    return null;
  }

  function writeCache(user) {
    state.user = user || null;
    state.checked = true;
    try {
      if (user) {
        localStorage.setItem(KEY, JSON.stringify(user));
      } else {
        [KEY].concat(OLD_KEYS).forEach(function (k) { localStorage.removeItem(k); });
      }
    } catch (_) {}
    if (user) syncPage(user);
  }

  function syncPage(user) {
    try {
      if (typeof window.currentUser !== 'undefined') window.currentUser = user;
      if (typeof window.renderAuth === 'function') window.renderAuth();
      if (typeof window.renderTopupSection === 'function') window.renderTopupSection();
      if (typeof window.chatSetNotificationUser === 'function') window.chatSetNotificationUser(user);
      document.querySelectorAll('.account-name,[data-account-name]').forEach(function (el) {
        el.textContent = user.displayName || user.username || '';
      });
    } catch (_) {}
  }

  function safeName(user) {
    return String((user && (user.displayName || user.username)) || '');
  }

  function cachedResponse(user) {
    return new Response(JSON.stringify({ user: user }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Mari-Auth-Fallback': '1'
      }
    });
  }

  function openAccount() {
    try {
      if (typeof window.showAccount === 'function') return window.showAccount();
      if (typeof window.showAccountModal === 'function') return window.showAccountModal();
      if (typeof window.openProfile === 'function') return window.openProfile();
      if (typeof window.openAccountModal === 'function') return window.openAccountModal();
    } catch (_) {}
    window.location.href = '/auth.html';
  }

  function installAccountButtons() {
    var selectors = '.auth-btn,[data-account-open],[data-profile-open],#accountBtn,#profileBtn';
    document.querySelectorAll(selectors).forEach(function (btn) {
      if (btn.__mariAccountBridge) return;
      btn.__mariAccountBridge = true;
      btn.addEventListener('click', function () {
        setTimeout(function () {
          // Existing handlers get first chance. If they did nothing, provide a safe entry point.
          var text = String(btn.textContent || '').trim();
          if (/บัญชีของฉัน|profile|account/i.test(text) && !document.querySelector('.account-modal,[role="dialog"]')) openAccount();
        }, 80);
      });
    });
  }

  function patchFetch() {
    if (window.__mariAccountFetchV5) return;
    var original = window.fetch;
    if (typeof original !== 'function') return;
    window.__mariAccountFetchV5 = true;

    window.fetch = function (input, init) {
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
      var path = url;
      try { path = new URL(url, location.href).pathname; } catch (_) {}

      var isMe = method === 'GET' && path === '/api/me';
      var isLogin = method === 'POST' && (path === '/api/login' || path === '/api/register');
      var isLogout = method === 'POST' && path === '/api/logout';

      var requestInit = init ? Object.assign({}, init) : {};
      if (path.indexOf('/api/') === 0) requestInit.credentials = 'include';

      var promise = original.call(this, input, requestInit);

      if (isMe) {
        return Promise.resolve(promise).then(function (response) {
          if (response && response.ok) {
            response.clone().json().then(function (data) {
              if (data && data.user) writeCache(data.user);
            }).catch(function () {});
            return response;
          }
          var keep = readCache();
          if (keep && response && (response.status === 401 || response.status >= 500)) {
            state.user = keep;
            state.checked = true;
            syncPage(keep);
            return cachedResponse(keep);
          }
          return response;
        }).catch(function (error) {
          var keep = readCache();
          if (keep) {
            state.user = keep;
            state.checked = true;
            syncPage(keep);
            return cachedResponse(keep);
          }
          throw error;
        });
      }

      if (isLogin) {
        return Promise.resolve(promise).then(function (response) {
          if (response && response.ok) {
            response.clone().json().then(function (data) {
              if (data && data.user) writeCache(data.user);
            }).catch(function () {});
          }
          return response;
        });
      }

      if (isLogout) {
        return Promise.resolve(promise).then(function (response) {
          if (response && response.ok) writeCache(null);
          return response;
        });
      }

      return promise;
    };
  }

  async function refresh() {
    try {
      var response = await fetch('/api/me', { method: 'GET', credentials: 'include', cache: 'no-store' });
      if (response.ok) {
        var data = await response.json();
        if (data && data.user) {
          writeCache(data.user);
          return data.user;
        }
      }
      var keep = readCache();
      if (keep) {
        state.user = keep;
        state.checked = true;
        syncPage(keep);
        return keep;
      }
    } catch (_) {
      var cached = readCache();
      if (cached) {
        state.user = cached;
        state.checked = true;
        syncPage(cached);
        return cached;
      }
    }
    state.checked = true;
    return null;
  }

  function renderSessionChip() {
    if (!state.user) return;
    document.querySelectorAll('.authbar').forEach(function (bar) {
      if (bar.querySelector('.mari-account-session-chip')) return;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'account-chip mari-account-session-chip';
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;background:transparent;color:inherit;font:inherit';
      chip.innerHTML = '<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small style="display:block;opacity:.7">เข้าสู่ระบบแล้ว</small></span>';
      chip.querySelector('.account-name').textContent = safeName(state.user);
      chip.addEventListener('click', openAccount);
      bar.insertBefore(chip, bar.firstChild);
    });
  }

  function start() {
    patchFetch();
    var cached = readCache();
    if (cached) {
      state.user = cached;
      state.checked = true;
      syncPage(cached);
      renderSessionChip();
    }
    installAccountButtons();
    refresh().then(function () {
      renderSessionChip();
      installAccountButtons();
    });

    if (window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (state.user) {
          syncPage(state.user);
          renderSessionChip();
        }
        installAccountButtons();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
