/* MariLoader library - draws the page-loading screen.
 * Used by /loader-runtime.js (every public page) and by loading-studio.html (admin preview),
 * so what you see in the studio is exactly what visitors get. */
(function (root) {
  'use strict';

  var PRESETS = [
    { id: 'bathtub', name: 'Chibi Bathtub', icon: '🛁' },
    { id: 'slime', name: 'Minecraft Slime', icon: '🟩' },
    { id: 'portal', name: 'Magic Portal', icon: '🪄' },
    { id: 'boba', name: 'Neko Boba', icon: '🧋' },
    { id: 'neon', name: 'Modern Neon', icon: '⚡' },
    { id: 'sakura', name: 'Sakura', icon: '🌸' },
    { id: 'custom', name: 'รูป / GIF ของคุณ', icon: '🖼️' }
  ];

  var THEMES = {
    warm:   { name: '🌸 ชมพูอุ่น',  bg: '#fff6fa', accent: '#ee7fa5', text: '#2b2026' },
    pastel: { name: '🎀 พาสเทล',    bg: '#fdf0ff', accent: '#c084fc', text: '#3b2450' },
    sky:    { name: '🌊 ฟ้าสดใส',   bg: '#f0f9ff', accent: '#38bdf8', text: '#0c4a6e' },
    matcha: { name: '🍵 มัทฉะ',     bg: '#f3f9ee', accent: '#7cb342', text: '#2f4a1d' },
    sunset: { name: '🌇 พระอาทิตย์ตก', bg: '#fff4e6', accent: '#ff8a4c', text: '#4a2410' },
    dark:   { name: '🌙 มืด',        bg: '#1b1320', accent: '#ff7eb6', text: '#f7e8f2' }
  };

  var DEFAULTS = {
    enabled: false,
    preset: 'slime',
    title: 'กำลังโหลด Mari JP SMP...',
    subtitle: 'โปรดรอสักครู่ ระบบกำลังเตรียมข้อมูลให้คุณ',
    tag: 'MARI SMP LOADING',
    titleJp: 'Mari JP SMPを読み込み中...',
    subtitleJp: 'しばらくお待ちください。ただいま準備中です',
    tagJp: 'MARI SMP LOADING',
    theme: 'warm',
    bg: '#fff6fa',
    accent: '#ee7fa5',
    text: '#2b2026',
    speed: 1,
    showBar: true,
    showPercent: true,
    particles: true,
    minMs: 900,
    oncePerSession: false,
    imageUrl: '',
    updatedAt: ''
  };

  function storedJp() { try { return localStorage.getItem('mari_lang') === 'jp'; } catch (e) { return false; } }
  var hex = function (v, d) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d; };
  var num = function (v, min, max, d) {
    var n = Number(v);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  // https:// image or a path on this site. Anything else (javascript:, data:, //host) is refused.
  var safeImg = function (u) {
    u = String(u == null ? '' : u).trim();
    if (/^https:\/\/\S+$/i.test(u)) return u;
    if (/^\/(?!\/)\S*$/.test(u)) return u;
    return '';
  };

  function normalize(c) {
    c = c && typeof c === 'object' ? c : {};
    var d = DEFAULTS, ids = PRESETS.map(function (p) { return p.id; });
    return {
      enabled: c.enabled === true,
      preset: ids.indexOf(c.preset) >= 0 ? c.preset : d.preset,
      title: String(c.title == null ? d.title : c.title).slice(0, 80),
      subtitle: String(c.subtitle == null ? d.subtitle : c.subtitle).slice(0, 140),
      tag: String(c.tag == null ? d.tag : c.tag).slice(0, 40),
      titleJp: String(c.titleJp == null ? d.titleJp : c.titleJp).slice(0, 80),
      subtitleJp: String(c.subtitleJp == null ? d.subtitleJp : c.subtitleJp).slice(0, 140),
      tagJp: String(c.tagJp == null ? d.tagJp : c.tagJp).slice(0, 40),
      theme: THEMES[c.theme] ? c.theme : 'custom',
      bg: hex(c.bg, d.bg),
      accent: hex(c.accent, d.accent),
      text: hex(c.text, d.text),
      speed: num(c.speed, 0.4, 2.5, 1),
      showBar: c.showBar !== false,
      showPercent: c.showPercent !== false,
      particles: c.particles !== false,
      minMs: Math.round(num(c.minMs, 0, 6000, d.minMs)),
      oncePerSession: c.oncePerSession === true,
      imageUrl: safeImg(c.imageUrl),
      updatedAt: String(c.updatedAt || '')
    };
  }

  var CSS = [
    '.mlx{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:var(--ml-bg);color:var(--ml-text);font-family:Segoe UI,Tahoma,"Noto Sans Thai",Arial,sans-serif;font-size:16px;line-height:1.4;text-align:center;overflow:hidden;transition:opacity .5s ease}',
    '.mlx.mlx-inline{position:absolute;z-index:1}',
    '.mlx .mlx-title,.mlx .mlx-sub{background:none;border:0;padding:0;text-shadow:none}',
    '.mlx.mlx-out{opacity:0;pointer-events:none}',
    '.mlx *{box-sizing:border-box}',
    '.mlx-stage{position:relative;width:min(56vw,220px);height:min(56vw,220px);display:flex;align-items:center;justify-content:center;z-index:2}',
    '.mlx-inline .mlx-stage{width:176px;height:176px}',
    '.mlx-title{margin:8px 0 0;color:var(--ml-text);font-family:inherit;font-size:clamp(17px,4.8vw,23px);font-weight:900;letter-spacing:.4px;line-height:1.3;text-transform:none;z-index:2;max-width:92vw;overflow-wrap:anywhere}',
    '.mlx-inline .mlx-title{font-size:18px}',
    '.mlx-sub{margin:6px 0 0;color:var(--ml-text);font-family:inherit;font-size:clamp(12px,3.4vw,14px);font-weight:400;line-height:1.5;opacity:.72;z-index:2;max-width:34ch}',
    '.mlx-bar{width:min(78vw,340px);height:14px;border-radius:99px;background:rgba(127,127,127,.22);margin-top:18px;overflow:hidden;position:relative;z-index:2}',
    '.mlx-bar>.mlx-fill{display:block;height:100%;width:0;border-radius:99px;background:var(--ml-accent);position:relative;overflow:hidden;transition:width .18s ease-out}',
    '.mlx-bar>.mlx-fill:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);background-size:200% 100%;animation:mlx-shimmer calc(1.4s/var(--ml-speed)) linear infinite}',
    '.mlx-meta{width:min(78vw,340px);display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:11px;font-weight:800;letter-spacing:1px;opacity:.85;z-index:2}',
    '.mlx-meta .mlx-pct{color:var(--ml-accent);font-weight:900}',
    '.mlx-hide{display:none!important}',
    /* particles */
    '.mlx-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1}',
    '.mlx-fx span{position:absolute;bottom:-24px;display:block;border-radius:50%;border:1.5px solid var(--ml-accent);background:rgba(255,255,255,.35);opacity:0;animation:mlx-rise linear infinite}',
    '.mlx-fx.petals span{bottom:auto;top:-24px;border:0;border-radius:150% 0 150% 0;background:var(--ml-accent);animation-name:mlx-fall}',
    /* slime */
    '.ml-slime{position:relative;width:70%;height:70%}',
    '.ml-slime-shadow{position:absolute;left:14%;right:14%;bottom:6%;height:9%;border-radius:50%;background:rgba(0,0,0,.18);animation:mlx-shadow calc(1.1s/var(--ml-speed)) cubic-bezier(.3,.8,.4,1) infinite}',
    '.ml-slime-body{position:absolute;left:10%;right:10%;bottom:11%;height:66%;background:#7ddc62;border:4px solid #3c9a3a;border-radius:14px;box-shadow:inset 0 -12px 0 rgba(0,0,0,.12),inset 0 9px 0 rgba(255,255,255,.28);transform-origin:50% 100%;animation:mlx-bounce calc(1.1s/var(--ml-speed)) cubic-bezier(.3,.8,.4,1) infinite}',
    '.ml-slime-body:before{content:"";position:absolute;left:20%;right:20%;top:24%;bottom:14%;border-radius:8px;background:rgba(255,255,255,.14)}',
    '.ml-slime-body .e{position:absolute;top:30%;width:14%;height:20%;background:#1f3d1b;border-radius:3px}',
    '.ml-slime-body .e.l{left:24%}.ml-slime-body .e.r{right:24%}',
    '.ml-slime-body .m{position:absolute;left:44%;top:60%;width:14%;height:9%;background:#1f3d1b;border-radius:3px}',
    /* portal */
    '.ml-portal{position:relative;width:82%;height:82%}',
    '.ml-portal .r{position:absolute;border-radius:50%;border:4px solid transparent}',
    '.ml-portal .r:nth-child(1){inset:0;border-top-color:var(--ml-accent);border-bottom-color:var(--ml-accent);box-shadow:0 0 18px var(--ml-accent);animation:mlx-spin calc(1.7s/var(--ml-speed)) linear infinite}',
    '.ml-portal .r:nth-child(2){inset:13%;border-left-color:var(--ml-accent);border-right-color:var(--ml-accent);opacity:.8;animation:mlx-spin calc(1.2s/var(--ml-speed)) linear infinite reverse}',
    '.ml-portal .r:nth-child(3){inset:27%;border-top-color:var(--ml-accent);opacity:.65;animation:mlx-spin calc(.9s/var(--ml-speed)) linear infinite}',
    '.ml-portal .core{position:absolute;inset:38%;border-radius:50%;background:radial-gradient(circle,#fff 0,var(--ml-accent) 55%,transparent 72%);animation:mlx-pulse calc(1.4s/var(--ml-speed)) ease-in-out infinite}',
    /* neon */
    '.ml-neon{position:relative;width:74%;height:74%}',
    '.ml-neon .r{position:absolute;border-radius:50%;border:6px solid rgba(127,127,127,.2)}',
    '.ml-neon .r:nth-child(1){inset:0;border-top-color:var(--ml-accent);box-shadow:0 0 22px var(--ml-accent),inset 0 0 12px rgba(127,127,127,.15);animation:mlx-spin calc(1s/var(--ml-speed)) linear infinite}',
    '.ml-neon .r:nth-child(2){inset:18%;border-bottom-color:var(--ml-accent);box-shadow:0 0 14px var(--ml-accent);animation:mlx-spin calc(1.5s/var(--ml-speed)) linear infinite reverse}',
    '.ml-neon .core{position:absolute;inset:41%;border-radius:50%;background:var(--ml-accent);box-shadow:0 0 22px var(--ml-accent);animation:mlx-pulse calc(1s/var(--ml-speed)) ease-in-out infinite}',
    /* svg presets */
    '.ml-svg{width:100%;height:100%;overflow:visible}',
    '.ml-wobble{transform-origin:100px 184px;animation:mlx-wobble calc(2s/var(--ml-speed)) ease-in-out infinite}',
    '.ml-pearl{animation:mlx-pearl calc(1.1s/var(--ml-speed)) ease-in-out infinite}',
    '.ml-pearl.p2{animation-delay:-.3s}.ml-pearl.p3{animation-delay:-.6s}.ml-pearl.p4{animation-delay:-.85s}',
    '.ml-wave{animation:mlx-wave calc(2.2s/var(--ml-speed)) linear infinite}',
    '.ml-duck{animation:mlx-duck calc(1.6s/var(--ml-speed)) ease-in-out infinite;transform-origin:100px 110px}',
    '.ml-bub{animation:mlx-bub calc(2.2s/var(--ml-speed)) ease-in infinite;opacity:0}',
    '.ml-bub.b2{animation-delay:-.7s}.ml-bub.b3{animation-delay:-1.4s}',
    '.ml-flower{transform-origin:100px 100px;animation:mlx-spin calc(9s/var(--ml-speed)) linear infinite}',
    '.ml-flowerwrap{transform-origin:100px 100px;animation:mlx-pulse calc(2s/var(--ml-speed)) ease-in-out infinite}',
    '.ml-custom{max-width:100%;max-height:100%;object-fit:contain;animation:mlx-float calc(2.6s/var(--ml-speed)) ease-in-out infinite;filter:drop-shadow(0 8px 14px rgba(0,0,0,.18))}',
    /* keyframes */
    '@keyframes mlx-bounce{0%,100%{transform:translateY(0) scale(1.12,.86)}45%{transform:translateY(-42%) scale(.92,1.1)}90%{transform:translateY(0) scale(1.14,.84)}}',
    '@keyframes mlx-shadow{0%,100%{transform:scale(1.1);opacity:.9}45%{transform:scale(.55);opacity:.4}}',
    '@keyframes mlx-spin{to{transform:rotate(360deg)}}',
    '@keyframes mlx-pulse{0%,100%{transform:scale(.9);opacity:.85}50%{transform:scale(1.12);opacity:1}}',
    '@keyframes mlx-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}',
    '@keyframes mlx-wobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}',
    '@keyframes mlx-pearl{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}',
    '@keyframes mlx-wave{from{transform:translateX(0)}to{transform:translateX(-80px)}}',
    '@keyframes mlx-duck{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}',
    '@keyframes mlx-bub{0%{transform:translateY(0) scale(.5);opacity:0}30%{opacity:.9}100%{transform:translateY(-52px) scale(1.15);opacity:0}}',
    '@keyframes mlx-float{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-10px) rotate(1.5deg)}}',
    '@keyframes mlx-rise{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:.85}100%{transform:translateY(-110vh) scale(1.1);opacity:0}}',
    '@keyframes mlx-fall{0%{transform:translate(0,0) rotate(0);opacity:0}12%{opacity:.9}100%{transform:translate(60px,110vh) rotate(420deg);opacity:0}}',
    '@media(prefers-reduced-motion:reduce){.mlx *{animation-duration:6s!important}}'
  ].join('\n');

  var ART = {
    slime: '<div class="ml-slime"><div class="ml-slime-shadow"></div><div class="ml-slime-body"><span class="e l"></span><span class="e r"></span><span class="m"></span></div></div>',
    portal: '<div class="ml-portal"><span class="r"></span><span class="r"></span><span class="r"></span><span class="core"></span></div>',
    neon: '<div class="ml-neon"><span class="r"></span><span class="r"></span><span class="core"></span></div>',
    boba:
      '<svg class="ml-svg" viewBox="0 0 200 200"><g class="ml-wobble">' +
      '<rect x="128" y="10" width="9" height="66" rx="4" fill="var(--ml-accent)" transform="rotate(14 132 76)"/>' +
      '<path d="M52 72 L148 72 L137 172 Q135 182 125 182 L75 182 Q65 182 63 172 Z" fill="rgba(255,255,255,.6)" stroke="var(--ml-accent)" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M57 104 Q100 92 143 104 L137 172 Q135 178 125 178 L75 178 Q65 178 63 172 Z" fill="var(--ml-accent)" opacity=".8"/>' +
      '<circle class="ml-pearl" cx="82" cy="166" r="7" fill="#3b2a2f"/><circle class="ml-pearl p2" cx="100" cy="168" r="7" fill="#3b2a2f"/><circle class="ml-pearl p3" cx="118" cy="166" r="7" fill="#3b2a2f"/><circle class="ml-pearl p4" cx="91" cy="153" r="6" fill="#3b2a2f"/>' +
      '<path d="M46 74 L154 74 Q154 62 100 62 Q46 62 46 74Z" fill="var(--ml-accent)"/>' +
      '<path d="M56 64 L60 38 L82 60Z M144 64 L140 38 L118 60Z" fill="var(--ml-accent)" stroke="var(--ml-accent)" stroke-width="3" stroke-linejoin="round"/>' +
      '<ellipse cx="86" cy="118" rx="4" ry="5.5" fill="#3b2a2f"/><ellipse cx="114" cy="118" rx="4" ry="5.5" fill="#3b2a2f"/>' +
      '<ellipse cx="76" cy="130" rx="6" ry="3.5" fill="#fff" opacity=".55"/><ellipse cx="124" cy="130" rx="6" ry="3.5" fill="#fff" opacity=".55"/>' +
      '<path d="M94 128 Q97 133 100 128 Q103 133 106 128" fill="none" stroke="#3b2a2f" stroke-width="2.4" stroke-linecap="round"/>' +
      '</g></svg>',
    bathtub:
      '<svg class="ml-svg" viewBox="0 0 200 200">' +
      '<g class="ml-duck"><ellipse cx="100" cy="92" rx="26" ry="20" fill="#ffd84d"/><circle cx="118" cy="66" r="15" fill="#ffd84d"/><path d="M131 66 Q142 66 141 72 Q133 74 130 71Z" fill="#ff9f43"/><circle cx="122" cy="62" r="2.6" fill="#3b2a2f"/><path d="M84 92 Q94 86 100 96" fill="none" stroke="#f0b400" stroke-width="3" stroke-linecap="round"/></g>' +
      '<circle class="ml-bub" cx="60" cy="112" r="6" fill="none" stroke="var(--ml-accent)" stroke-width="2.5"/>' +
      '<circle class="ml-bub b2" cx="146" cy="108" r="8" fill="none" stroke="var(--ml-accent)" stroke-width="2.5"/>' +
      '<circle class="ml-bub b3" cx="98" cy="104" r="5" fill="none" stroke="var(--ml-accent)" stroke-width="2.5"/>' +
      '<clipPath id="mlTub"><path d="M28 112 H172 V132 Q172 168 136 168 H64 Q28 168 28 132Z"/></clipPath>' +
      '<path d="M28 112 H172 V132 Q172 168 136 168 H64 Q28 168 28 132Z" fill="#fff" stroke="var(--ml-accent)" stroke-width="5" stroke-linejoin="round"/>' +
      '<g clip-path="url(#mlTub)"><g class="ml-wave"><path d="M0 122 Q20 112 40 122 T80 122 T120 122 T160 122 T200 122 T240 122 V172 H0Z" fill="var(--ml-accent)" opacity=".55"/></g></g>' +
      '<rect x="20" y="106" width="160" height="12" rx="6" fill="var(--ml-accent)"/>' +
      '<rect x="52" y="168" width="14" height="12" rx="4" fill="var(--ml-accent)"/><rect x="134" y="168" width="14" height="12" rx="4" fill="var(--ml-accent)"/>' +
      '</svg>',
    sakura:
      '<svg class="ml-svg" viewBox="0 0 200 200"><g class="ml-flowerwrap"><g class="ml-flower">' +
      [0, 72, 144, 216, 288].map(function (a) {
        return '<path d="M100 100 C78 78 82 38 100 30 C118 38 122 78 100 100Z" fill="var(--ml-accent)" transform="rotate(' + a + ' 100 100)"/>' +
               '<path d="M100 92 C92 76 94 54 100 46" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round" transform="rotate(' + a + ' 100 100)"/>';
      }).join('') +
      '<circle cx="100" cy="100" r="9" fill="#ffd84d"/></g></g></svg>'
  };

  function injectCss(doc) {
    doc = doc || document;
    if (doc.getElementById('mlx-css')) return;
    var s = doc.createElement('style');
    s.id = 'mlx-css';
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function particles(el, cfg) {
    var fx = el.querySelector('.mlx-fx');
    if (!fx) return;
    fx.innerHTML = '';
    fx.className = 'mlx-fx' + (cfg.preset === 'sakura' ? ' petals' : '');
    if (!cfg.particles) return;
    var i, s, size, seed = 7;
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (i = 0; i < 16; i++) {
      s = document.createElement('span');
      size = 8 + Math.round(rnd() * 14);
      s.style.width = size + 'px';
      s.style.height = (cfg.preset === 'sakura' ? Math.round(size * 0.75) : size) + 'px';
      s.style.left = Math.round(rnd() * 96) + '%';
      s.style.animationDuration = (5 + rnd() * 5).toFixed(2) + 's';
      s.style.animationDelay = '-' + (rnd() * 8).toFixed(2) + 's';
      fx.appendChild(s);
    }
  }

  // Draws the loading screen into `el` (replacing whatever was there).
  function render(el, cfg, opts) {
    cfg = normalize(cfg);
    opts = opts || {};
    injectCss(el.ownerDocument);
    el.className = 'mlx' + (opts.inline ? ' mlx-inline' : '');
    el.style.setProperty('--ml-bg', cfg.bg);
    el.style.setProperty('--ml-accent', cfg.accent);
    el.style.setProperty('--ml-text', cfg.text);
    el.style.setProperty('--ml-speed', String(cfg.speed));
    el.innerHTML =
      '<div class="mlx-fx"></div><div class="mlx-stage"></div>' +
      '<div class="mlx-title"></div><div class="mlx-sub"></div>' +
      '<div class="mlx-bar"><span class="mlx-fill"></span></div>' +
      '<div class="mlx-meta"><span class="mlx-tag"></span><span class="mlx-pct">0%</span></div>';
    var stage = el.querySelector('.mlx-stage');
    if (cfg.preset === 'custom' && cfg.imageUrl) {
      var img = document.createElement('img');
      img.className = 'ml-custom';
      img.alt = '';
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.src = cfg.imageUrl;
      stage.appendChild(img);
    } else {
      stage.innerHTML = ART[cfg.preset] || ART.slime;
    }
    var set = function (sel, txt) { var n = el.querySelector(sel); if (n) n.textContent = txt; };
    // Japanese visitors (button on the site, remembered as mari_lang) get the Japanese texts
    var jp = opts.lang ? opts.lang === 'jp' : storedJp();
    var T = jp ? cfg.titleJp : cfg.title, S = jp ? cfg.subtitleJp : cfg.subtitle, G = jp ? cfg.tagJp : cfg.tag;
    set('.mlx-title', T);
    set('.mlx-sub', S);
    set('.mlx-tag', G);
    if (!T) el.querySelector('.mlx-title').classList.add('mlx-hide');
    if (!S) el.querySelector('.mlx-sub').classList.add('mlx-hide');
    if (!cfg.showBar) el.querySelector('.mlx-bar').classList.add('mlx-hide');
    if (!cfg.showBar && !G) el.querySelector('.mlx-meta').classList.add('mlx-hide');
    if (!cfg.showPercent || !cfg.showBar) el.querySelector('.mlx-pct').classList.add('mlx-hide');
    particles(el, cfg);
    return el;
  }

  function setProgress(el, pct) {
    pct = Math.max(0, Math.min(100, pct));
    var bar = el.querySelector('.mlx-bar>.mlx-fill'), p = el.querySelector('.mlx-pct');
    if (bar) bar.style.width = pct + '%';
    if (p) p.textContent = Math.round(pct) + '%';
  }

  root.MariLoader = {
    PRESETS: PRESETS, THEMES: THEMES, DEFAULTS: DEFAULTS,
    normalize: normalize, injectCss: injectCss, render: render, setProgress: setProgress, safeImg: safeImg
  };
})(window);


/* ---- automatic part: runs on every public page, right after the built-in #mariLoader ---- */
(function () {
  'use strict';
  var L = window.MariLoader;
  if (!L || window.__MARI_LOADER_STUDIO) return;
  var orig = document.getElementById('mariLoader');
  if (!orig) return; // page without the built-in loader

  var KEY = 'mariLoaderCfg', SEEN = 'mariLoaderSeen';
  var st = { el: null, cfg: null, start: Date.now(), ready: false, finishing: false, done: false, p: 0, timer: null };

  function cached() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function seen() { try { return !!sessionStorage.getItem(SEEN); } catch (e) { return false; } }
  function skip(c) { return !c || !c.enabled || (c.oncePerSession && seen()); }
  function origAlive() { return document.body && document.body.contains(orig); }

  function stop() { clearInterval(st.timer); st.timer = null; }

  function remove() {
    stop();
    if (st.el) { st.el.remove(); st.el = null; }
  }

  function show(raw) {
    var cfg = L.normalize(raw);
    remove();
    var el = document.createElement('div');
    el.id = 'mariLoaderX';
    el.setAttribute('aria-hidden', 'true');
    L.render(el, cfg);
    L.setProgress(el, st.p);
    document.body.appendChild(el);
    if (origAlive()) orig.style.display = 'none';
    st.el = el; st.cfg = cfg;
    // progress creeps towards ~92% while the page loads, then jumps to 100% when it is ready
    st.timer = setInterval(function () {
      if (st.finishing) return;
      st.p += (92 - st.p) * 0.05 * cfg.speed;
      L.setProgress(el, st.p);
    }, 60);
    if (st.ready) finish();
  }

  function revert() {
    remove();
    if (origAlive()) orig.style.display = '';
  }

  function finish() {
    if (!st.el || st.finishing || st.done) return;
    st.finishing = true;
    var el = st.el, wait = Math.max(0, st.cfg.minMs - (Date.now() - st.start));
    setTimeout(function () {
      stop();
      L.setProgress(el, 100);
      setTimeout(function () {
        el.classList.add('mlx-out');
        setTimeout(function () {
          el.remove();
          if (st.el === el) st.el = null;
          st.done = true;
          try { sessionStorage.setItem(SEEN, '1'); } catch (e) {}
        }, 550);
      }, 220);
    }, wait);
  }

  function onReady() { st.ready = true; if (st.el) finish(); }
  if (document.readyState === 'complete') onReady();
  else window.addEventListener('load', onReady);
  // never trap a visitor behind the loading screen
  setTimeout(function () { st.ready = true; if (st.el && !st.finishing) { st.cfg.minMs = 0; finish(); } }, 15000);

  var first = cached();
  if (!skip(first)) show(first);

  // Refresh the saved settings; changes made in the studio reach the very next page view.
  fetch('/api/loader', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var n = d && d.loader;
      if (!n) return;
      try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) {}
      if (st.done || st.finishing) return;
      if (skip(n)) { if (st.el) revert(); return; }
      if (!st.el || st.cfg.updatedAt !== n.updatedAt) show(n);
    })
    .catch(function () {});
})();
