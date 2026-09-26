/* Mari JP SMP — persistent account/session bridge for Cloudflare Workers. */
(function () {
  'use strict';
  if (window.__MARI_ACCOUNT_SESSION_V7__) return;
  window.__MARI_ACCOUNT_SESSION_V7__ = true;

  var KEY = 'mariAccountCache_v7';
  var OLD_KEYS = ['mariAccountCache_v6','mariAccountCache_v5','mariAccountCache_v4','mariAccountCache_v3','mariAccountCache_v2'];
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
      if (user) localStorage.setItem(KEY, JSON.stringify(user));
      else [KEY].concat(OLD_KEYS).forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
    if (user) syncPage(user);
    try { window.dispatchEvent(new CustomEvent('mari:account-updated', { detail: user || null })); } catch (_) {}
  }

  function syncPage(user) {
    try {
      if (typeof window.currentUser !== 'undefined') window.currentUser = user;
      if (typeof window.renderAuth === 'function') window.renderAuth();
      if (typeof window.renderTopupSection === 'function') window.renderTopupSection();
      if (typeof window.chatSetNotificationUser === 'function') window.chatSetNotificationUser(user);
      var name = String(user.displayName || user.username || '');
      document.querySelectorAll('.account-name,[data-account-name]').forEach(function (el) { el.textContent = name; });
    } catch (_) {}
  }

  function safeName(user) { return String((user && (user.displayName || user.username)) || ''); }

  function cachedResponse(user) {
    return new Response(JSON.stringify({ user: user }), { status: 200, headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Mari-Auth-Fallback': '1'
    }});
  }

  function closeFallbackModal() {
    var old = document.getElementById('mariAccountFallbackModal');
    if (old) old.remove();
  }

  function openFallbackModal() {
    if (!state.user) { window.location.href = '/auth.html'; return; }
    closeFallbackModal();
    var u = state.user;
    var overlay = document.createElement('div');
    overlay.id = 'mariAccountFallbackModal';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(20,12,17,.62);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;backdrop-filter:blur(5px)';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(440px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:22px;padding:22px;box-shadow:0 20px 70px rgba(0,0,0,.28);font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#2b2026;box-sizing:border-box';
    var title = u.displayName || u.username || 'สมาชิก';
    var rows = [
      ['ชื่อผู้ใช้', u.username || '-'],
      ['UID', u.uid || u.id || '-'],
      ['ยศ', u.titleId || 'member'],
      ['Minecraft', u.minecraft || 'ยังไม่ได้ตั้ง'],
      ['ยอดเงิน', '฿' + Number(u.balance || 0).toLocaleString('th-TH')]
    ];
    card.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div><div style="font-size:12px;color:#806b75">บัญชีของฉัน</div><h2 style="margin:3px 0 0;font-size:24px">' + escapeHtml(title) + '</h2></div><button type="button" data-close style="border:0;background:#f4e8ed;border-radius:12px;width:40px;height:40px;font-size:22px;cursor:pointer">×</button></div><div data-rows style="margin-top:16px;display:grid;gap:9px"></div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:18px"><a href="/topup.html" style="flex:1;min-width:130px;text-align:center;text-decoration:none;padding:12px;border-radius:12px;background:#ee7fa5;color:#fff;font-weight:800">เติมเงิน</a><button type="button" data-refresh style="flex:1;min-width:130px;padding:12px;border:0;border-radius:12px;background:#2b2026;color:#fff;font-weight:800;cursor:pointer">รีเฟรชบัญชี</button></div>';
    var rowsEl = card.querySelector('[data-rows]');
    rows.forEach(function (row) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:11px 13px;background:#fff5f8;border:1px solid #efd6e0;border-radius:12px';
      div.innerHTML = '<span style="color:#806b75">' + escapeHtml(row[0]) + '</span><b style="text-align:right;word-break:break-word">' + escapeHtml(String(row[1])) + '</b>';
      rowsEl.appendChild(div);
    });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('[data-close]').addEventListener('click', closeFallbackModal);
    card.querySelector('[data-refresh]').addEventListener('click', function () { refresh().then(function () { openFallbackModal(); }); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFallbackModal(); });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]); });
  }

  function openAccount() {
    try {
      if (typeof window.showAccount === 'function') return window.showAccount();
      if (typeof window.showAccountModal === 'function') return window.showAccountModal();
      if (typeof window.openProfile === 'function') return window.openProfile();
      if (typeof window.openAccountModal === 'function') return window.openAccountModal();
    } catch (_) {}
    openFallbackModal();
  }

  function looksLikeAccountButton(el) {
    if (!el || el.nodeType !== 1) return false;
    var hay = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.id, el.className].join(' ');
    return /บัญชีของฉัน|profile|account|โปรไฟล์/i.test(String(hay || ''));
  }

  function handleAccountClick(event) {
    var el = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
    if (!el || !looksLikeAccountButton(el)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    openAccount();
    return true;
  }

  function installAccountButtons() {
    var selectors = '.auth-btn,[data-account-open],[data-profile-open],#accountBtn,#profileBtn,[aria-label*="บัญชี"],[aria-label*="profile"],[aria-label*="account"]';
    document.querySelectorAll(selectors).forEach(function (btn) {
      if (btn.__mariAccountBridgeV7) return;
      btn.__mariAccountBridgeV7 = true;
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        openAccount();
      }, true);
    });
  }

  function installDocumentAccountClick() {
    if (window.__mariAccountDocumentClickV7) return;
    window.__mariAccountDocumentClickV7 = true;
    document.addEventListener('click', handleAccountClick, true);
  }

  function patchFetch() {
    if (window.__mariAccountFetchV7) return;
    var original = window.fetch;
    if (typeof original !== 'function') return;
    window.__mariAccountFetchV7 = true;
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
      if (isMe) return Promise.resolve(promise).then(function (response) {
        if (response && response.ok) { response.clone().json().then(function (data) { if (data && data.user) writeCache(data.user); }).catch(function () {}); return response; }
        var keep = readCache();
        if (keep && response && (response.status === 401 || response.status >= 500)) { state.user = keep; state.checked = true; syncPage(keep); return cachedResponse(keep); }
        return response;
      }).catch(function (error) {
        var keep = readCache();
        if (keep) { state.user = keep; state.checked = true; syncPage(keep); return cachedResponse(keep); }
        throw error;
      });
      if (isLogin) return Promise.resolve(promise).then(function (response) { if (response && response.ok) response.clone().json().then(function (data) { if (data && data.user) writeCache(data.user); }).catch(function () {}); return response; });
      if (isLogout) return Promise.resolve(promise).then(function (response) { if (response && response.ok) writeCache(null); return response; });
      return promise;
    };
  }

  async function refresh() {
    try {
      var response = await fetch('/api/me', { method:'GET', credentials:'include', cache:'no-store' });
      if (response.ok) { var data = await response.json(); if (data && data.user) { writeCache(data.user); return data.user; } }
      var keep = readCache();
      if (keep) { state.user = keep; state.checked = true; syncPage(keep); return keep; }
    } catch (_) {
      var cached = readCache();
      if (cached) { state.user = cached; state.checked = true; syncPage(cached); return cached; }
    }
    state.checked = true;
    return null;
  }

  function renderSessionChip() {
    if (!state.user) return;
    document.querySelectorAll('.authbar').forEach(function (bar) {
      if (bar.querySelector('.mari-account-session-chip')) return;
      var chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'account-chip mari-account-session-chip';
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;background:transparent;color:inherit;font:inherit';
      chip.innerHTML = '<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#ee7fa5;color:#fff;font-weight:900">M</span><span><b class="account-name"></b><small style="display:block;opacity:.7">เข้าสู่ระบบแล้ว</small></span>';
      chip.querySelector('.account-name').textContent = safeName(state.user);
      chip.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); openAccount(); }, true);
      bar.insertBefore(chip, bar.firstChild);
    });
  }

  function start() {
    patchFetch();
    var cached = readCache();
    if (cached) { state.user = cached; state.checked = true; syncPage(cached); renderSessionChip(); }
    installAccountButtons();
    installDocumentAccountClick();
    refresh().then(function () { renderSessionChip(); installAccountButtons(); });
    if (window.MutationObserver) {
      new MutationObserver(function () { if (state.user) renderSessionChip(); installAccountButtons(); }).observe(document.documentElement, { childList:true, subtree:true });
    }
    window.addEventListener('pageshow', function () { refresh().then(renderSessionChip); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
