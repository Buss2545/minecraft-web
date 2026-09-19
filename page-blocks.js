/* Mari JP SMP - page content runtime
 *
 * Loaded by every public page (index, promo, vip, rules, team, topup, minigames) with
 *   <script src="/page-blocks.js" defer></script>
 * Reads what the admin saved in admin.html -> 🏠 หน้าแรก/กิจกรรม -> 🌐 แก้ไขทุกหน้า
 * (GET /api/site/pages) and applies it to the page:
 *   - the announcement bar (all pages)
 *   - replaced texts and images
 *   - hidden original cards
 *   - extra blocks (card / text / banner) at the top or bottom of the page
 * If the request fails or nothing was saved, the page stays exactly as it was.
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };

  // Same link rules as the server: https:// links, internal /pages, #anchors, and bare
  // domains typed without https://. Anything else (javascript:, data:, //host) is dropped.
  var safeUrl = function (u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/(?!\/)/.test(s) || s.charAt(0) === '#') return s;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#]|$)/i.test(s)) return 'https://' + s;
    return '';
  };
  var isExternal = function (u) { return /^https?:\/\//i.test(String(u || '')); };

  // Identifies an image without storing it: short srcs are used as-is, long ones (inline
  // base64) become length + three small samples. admin.html uses the identical function.
  function imgKey(src) {
    src = String(src || '');
    if (src.length <= 200) return src;
    var n = src.length, a = Math.floor(n * 0.3), b = Math.floor(n * 0.6);
    return n + ':' + src.slice(a, a + 24) + src.slice(b, b + 24) + src.slice(-16);
  }

  function pageId() {
    var m = location.pathname.match(/\/([A-Za-z0-9_-]+)\.html$/);
    return m ? m[1] : 'index';
  }
  var PAGE = pageId();

  var SKIP = 'script,style,textarea,noscript,.jp,[hidden],#adminPageBanner,.mari-blocks,#mariGlobalBanner';

  function injectStyle() {
    if (document.getElementById('mari-page-blocks-style')) return;
    var st = document.createElement('style');
    st.id = 'mari-page-blocks-style';
    st.textContent =
      '#mariGlobalBanner{display:block;text-align:center;padding:10px 14px;color:#fff;font-weight:800;font-size:14px;line-height:1.5;text-decoration:none;text-shadow:0 1px 2px rgba(0,0,0,.25)}' +
      'a#mariGlobalBanner:hover{filter:brightness(1.06)}' +
      '.mari-blocks{display:grid;gap:16px;margin:18px 0}' +
      '.mari-blocks[data-cols="1"]{grid-template-columns:minmax(0,1fr)}' +
      '.mari-blocks[data-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.mari-blocks[data-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}' +
      '.mari-block{padding:0;overflow:hidden;display:flex;flex-direction:column}' +
      '.mari-block>img{display:block;width:100%;max-height:320px;object-fit:cover}' +
      '.mari-block-copy{padding:16px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}' +
      '.mari-block-copy h3{margin:0}' +
      '.mari-block-copy p{margin:0;color:var(--mut,#806b75);line-height:1.65;white-space:pre-line;overflow-wrap:anywhere}' +
      '.mari-block-banner{grid-column:1/-1}' +
      '.mari-block-banner>img{max-height:380px}' +
      '@media(max-width:820px){.mari-blocks[data-cols="3"]{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '@media(max-width:560px){.mari-blocks{grid-template-columns:minmax(0,1fr)!important}}';
    document.head.appendChild(st);
  }

  function renderBanner(b) {
    var old = document.getElementById('mariGlobalBanner');
    if (old) old.remove();
    if (!b || !b.enabled || !b.text) return;
    var link = safeUrl(b.url);
    var el = document.createElement(link ? 'a' : 'div');
    el.id = 'mariGlobalBanner';
    if (link) {
      el.href = link;
      if (isExternal(link)) { el.target = '_blank'; el.rel = 'noopener'; }
    }
    el.textContent = b.text;
    el.style.background = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#ee7fa5';
    var header = document.querySelector('header.nav') || document.querySelector('.nav');
    if (header) header.insertAdjacentElement('afterend', el);
    else document.body.insertBefore(el, document.body.firstChild);
  }

  function blockHtml(b) {
    var img = b.type === 'text' ? '' : safeUrl(b.imageUrl);
    var link = safeUrl(b.buttonUrl);
    var btn = link
      ? '<a class="btn" href="' + esc(link) + '"' + (isExternal(link) ? ' target="_blank" rel="noopener"' : '') + '>' +
        esc(b.buttonLabel || 'รายละเอียด') + '</a>'
      : '';
    return '<article class="card mari-block mari-block-' + esc(b.type || 'card') + '">' +
      (img ? '<img src="' + esc(img) + '" alt="' + esc(b.title || '') + '" loading="lazy">' : '') +
      '<div class="mari-block-copy">' +
      (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') +
      (b.body ? '<p>' + esc(b.body) + '</p>' : '') +
      btn + '</div></article>';
  }

  function makeBox(list, cols, pos) {
    var box = document.createElement('div');
    box.className = 'mari-blocks mari-blocks-' + pos;
    box.setAttribute('data-cols', String([1, 2, 3].indexOf(Number(cols)) >= 0 ? Number(cols) : 2));
    box.innerHTML = list.map(blockHtml).join('');
    return box;
  }

  // ---- text + image replacement (re-run when the page's own scripts add content) ----
  function eachText(root, fn) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return norm(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var node;
    while ((node = walker.nextNode())) fn(node);
  }

  function applyEdits(cfg) {
    var texts = {}, hasText = false, imgs = {}, hasImg = false;
    (cfg.textEdits || []).forEach(function (e) { texts[e.from] = e.to; hasText = true; });
    (cfg.imageEdits || []).forEach(function (e) { imgs[e.key] = safeUrl(e.url); hasImg = true; });
    if (!hasText && !hasImg) return;
    [document.querySelector('main'), document.querySelector('footer')].forEach(function (root) {
      if (!root) return;
      if (hasText) {
        eachText(root, function (n) {
          var k = norm(n.nodeValue);
          if (Object.prototype.hasOwnProperty.call(texts, k)) {
            var lead = n.nodeValue.match(/^\s*/)[0], trail = n.nodeValue.match(/\s*$/)[0];
            n.nodeValue = lead + texts[k] + trail;
          }
        });
      }
      if (hasImg) {
        Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
          if (img.closest('.mari-blocks,#adminPageBanner')) return;
          var to = imgs[imgKey(img.getAttribute('src'))];
          if (to) img.setAttribute('src', to);
        });
      }
    });
  }

  function applyPage(cfg) {
    var home = PAGE === 'index';
    var main = document.querySelector('main');
    var section = home ? main : document.querySelector('main section.section');
    if (!section) return;
    Array.prototype.forEach.call(document.querySelectorAll('.mari-blocks'), function (n) { n.remove(); });

    if (!home) {
      var kids = Array.prototype.filter.call(section.children, function (el) {
        return !el.classList.contains('title') && !el.classList.contains('mari-blocks');
      });
      // The top-up form is the whole point of /topup.html, so it is never hidden.
      if (cfg.hideBuiltIn && PAGE !== 'topup') {
        kids.forEach(function (el) { el.style.display = 'none'; });
      } else if (PAGE !== 'topup' && cfg.hiddenItems && cfg.hiddenItems.length && kids[0]) {
        var items = kids[0].children;
        cfg.hiddenItems.forEach(function (i) { if (items[i]) items[i].style.display = 'none'; });
      }
    }

    var blocks = (cfg.blocks || []).filter(function (b) { return b && b.enabled !== false; });
    var top = blocks.filter(function (b) { return b.position !== 'bottom'; });
    var bottom = blocks.filter(function (b) { return b.position === 'bottom'; });

    if (top.length) {
      var topBox = makeBox(top, cfg.columns, 'top');
      if (home) {
        // after the hero (and the promo / announcement the homepage adds under it)
        var quick = document.getElementById('mediaQuickActions');
        var hero = section.querySelector('.hero');
        if (quick && quick.parentElement === section) quick.insertAdjacentElement('beforebegin', topBox);
        else if (hero) hero.insertAdjacentElement('afterend', topBox);
        else section.insertBefore(topBox, section.firstChild);
      } else {
        var title = section.querySelector(':scope > .title');
        if (title) title.insertAdjacentElement('afterend', topBox);
        else section.insertBefore(topBox, section.firstChild);
      }
    }
    if (bottom.length) section.appendChild(makeBox(bottom, cfg.columns, 'bottom'));
  }

  function run() {
    injectStyle();
    fetch('/api/site/pages', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        renderBanner(d.global && d.global.banner);
        var cfg = d.pages && d.pages[PAGE];
        if (!cfg) return;
        applyPage(cfg);
        applyEdits(cfg);
        // The page's own scripts fill in more content after load (shop, server status...);
        // apply the replacements again to anything new, a handful of times at most.
        if ((cfg.textEdits && cfg.textEdits.length) || (cfg.imageEdits && cfg.imageEdits.length)) {
          var runs = 0, timer = null;
          var again = function () {
            clearTimeout(timer);
            timer = setTimeout(function () { if (++runs <= 25) applyEdits(cfg); }, 250);
          };
          var roots = [document.querySelector('main'), document.querySelector('footer')];
          if (window.MutationObserver) {
            roots.forEach(function (r) { if (r) new MutationObserver(again).observe(r, { childList: true, subtree: true }); });
          }
        }
      })
      .catch(function () { /* leave the page as it is */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
