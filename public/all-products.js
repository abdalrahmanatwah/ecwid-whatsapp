/* 499K — home page section with EVERY active product (Ecwid's own
 * "category products" section stops at 20). Self-contained markup and CSS in
 * the store's card style, so it works even when the Ecwid product sections are
 * hidden. Data: /social-proof/products.json (enabled + in stock, newest first),
 * newest added first. (sortByBrand below is kept for later use.) */
(function () {
  'use strict';
  if (window.__k499All) return;
  window.__k499All = true;

  var BASE = 'https://ecwid-whatsapp.onrender.com';
  var TITLE = 'Black Friday Offers 🔥🔥🔥';
  var ID = 'tile-k499-all-products';
  var COLS = 5; // per row on desktop (3 on tablets, 2 on phones)
  var GATE = '__GATE__'; // replaced by the server: '' = live for everyone

  if (GATE && !(location.search.indexOf(GATE) >= 0)) return;

  var BRANDS = [
    ['adidas', /adidas|adizero|hyperboost|hyper boost|ubersonic|soul stride|adistar|easy star|terrex|dropset|\bedge\b/i],
    ['asics', /asics|gel[- ]|novablast|superblast|super blast|kinsei|court ff/i],
    ['nike', /nike|jordan|vomero|vaporfly|pegasus|air max|dunk/i],
    ['on', /^\s*on\b|\bon cloud|\bcloud\w*|the roger|\bon running/i],
  ];
  function brandRank(name) {
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i][1].test(name || '')) return i;
    return BRANDS.length;
  }
  function sortByBrand(items) {
    return items.map(function (p, i) { return { p: p, i: i, r: brandRank(p.name) }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.p; });
  }

  function isHome() { return location.pathname === '/' || location.pathname === ''; }
  function money(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'EGP';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var S = '#' + ID;
  var CSS = [
    S + '{background:#0b0b0b;color:#fff;padding:56px 16px 64px;font-family:inherit;}',
    S + ' .k4a-wrap{max-width:1440px;margin:0 auto;}',
    S + ' .k4a-title{font-size:clamp(28px,4vw,48px);font-weight:700;text-align:center;margin:0 0 36px;color:#fff;line-height:1.15;}',
    S + ' .k4a-grid{display:grid;grid-template-columns:repeat(' + COLS + ',minmax(0,1fr));gap:28px 20px;}',
    '@media (max-width:1100px){' + S + ' .k4a-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}',
    '@media (max-width:640px){' + S + ' .k4a-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px;}' + S + '{padding:40px 12px 48px;}}',
    S + ' a.k4a-card{display:block;color:inherit;text-decoration:none;}',
    S + ' .k4a-img{position:relative;aspect-ratio:1/1;border-radius:28px 28px 0 0;overflow:hidden;background:#fff;}',
    S + ' .k4a-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .35s ease;}',
    S + ' .k4a-img img.k4a-2{opacity:0;}',
    '@media (hover:hover){' + S + ' a.k4a-card:hover .k4a-img img.k4a-2{opacity:1;}}',
    S + ' .k4a-rib{position:absolute;top:14px;right:0;background:#0b0b0b;color:#fff;font-size:11px;line-height:1;padding:6px 10px;border-radius:6px 0 0 6px;max-width:85%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    S + ' .k4a-body{display:flex;gap:10px;align-items:flex-start;padding:12px 2px 0;}',
    S + ' .k4a-txt{flex:1;min-width:0;}',
    S + ' .k4a-name{font-size:15px;line-height:1.35;color:#fff;margin:0 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    S + ' .k4a-old{font-size:13px;color:#8a8a8a;text-decoration:line-through;}',
    S + ' .k4a-price{font-size:15px;font-weight:700;color:#fff;}',
    S + ' .k4a-plus{flex:none;width:34px;height:34px;border:1.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;}',
    S + ' .k4a-plus svg{width:14px;height:14px;stroke:#fff;stroke-width:2;}',
    '@media (max-width:640px){' + S + ' .k4a-name{font-size:13px;}' + S + ' .k4a-plus{width:28px;height:28px;}' + S + ' .k4a-img{border-radius:20px 20px 0 0;}}',
  ].join('\n');

  function card(p) {
    var a = el('a', 'k4a-card');
    a.href = p.url;
    var box = el('div', 'k4a-img');
    var i1 = el('img', 'k4a-1');
    i1.loading = 'lazy'; i1.alt = p.name; i1.src = p.img;
    box.appendChild(i1);
    if (p.img2) {
      var i2 = el('img', 'k4a-2');
      i2.loading = 'lazy'; i2.alt = ''; i2.src = p.img2;
      box.appendChild(i2);
    }
    if (p.ribbon) box.appendChild(el('div', 'k4a-rib', p.ribbon));
    a.appendChild(box);
    var body = el('div', 'k4a-body');
    var txt = el('div', 'k4a-txt');
    txt.appendChild(el('div', 'k4a-name', p.name));
    if (p.old) txt.appendChild(el('div', 'k4a-old', money(p.old)));
    txt.appendChild(el('div', 'k4a-price', money(p.price)));
    body.appendChild(txt);
    var plus = el('span', 'k4a-plus');
    plus.innerHTML = '<svg viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12"/></svg>';
    body.appendChild(plus);
    a.appendChild(body);
    return a;
  }

  // Where to put it: after the "Shop By" gallery, else after the first
  // product/feature section on the page.
  function anchor() {
    return document.querySelector('section.ins-tile__logo-gallery, section[id^="tile-logo-gallery"]')
      || document.querySelector('section.ins-tile--category-products')
      || document.querySelector('section.ins-tile--feature-list');
  }

  function build(products) {
    if (!isHome() || document.getElementById(ID)) return true;
    var after = anchor();
    if (!after) return false;
    if (!document.getElementById('k499-all-css')) {
      var st = el('style'); st.id = 'k499-all-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var sec = el('section', 'k4a');
    sec.id = ID;
    var wrap = el('div', 'k4a-wrap');
    wrap.appendChild(el('h2', 'k4a-title', TITLE));
    var grid = el('div', 'k4a-grid');
    var frag = document.createDocumentFragment();
    products.forEach(function (p) { frag.appendChild(card(p)); });
    grid.appendChild(frag);
    wrap.appendChild(grid);
    sec.appendChild(wrap);
    after.parentNode.insertBefore(sec, after.nextSibling);
    return true;
  }

  function start() {
    if (!isHome()) return;
    fetch(BASE + '/social-proof/products.json')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.products) || []; // offers first, then the rest; newest first in each (server order)
        if (!items.length) return;
        var tries = 0;
        (function attempt() {
          if (build(items) || ++tries > 20) return;
          setTimeout(attempt, 500);
        })();
      })
      .catch(function () { /* keep the page as it is */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
