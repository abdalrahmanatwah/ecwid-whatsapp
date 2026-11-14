/* 499K — the home page's header (Shop · Policy & Terms · Contact | logo | search, bag)
 * on every page of the store. The header on the home page is a section that
 * exists only there, so this adds the same header everywhere else; on pages
 * that already show it (the home page), this stays hidden.
 * Served together with the social-proof script (same Ecwid app, same URL). */
(function () {
  'use strict';
  if (window.__k499Header) return;
  window.__k499Header = true;

  // Links — edit freely.
  var LINKS = [
    { label: 'Shop', href: '/products' },
    { label: 'Policy & Terms', href: '/Policy-Terms' },
    { label: 'Contact', href: '/Contact' },
  ];
  var HOME = '/';
  var LOGO = 'data:image/png;base64,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';
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@700&display=swap';
  var ID = 'k499-header';

  function css() {
    if (document.getElementById(ID + '-css')) return;
    if (!document.querySelector('link[href="' + FONT_URL + '"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_URL; document.head.appendChild(l);
    }
    var st = document.createElement('style');
    st.id = ID + '-css';
    st.textContent =
      '#' + ID + '{position:relative;z-index:900;background:#fff;border-bottom:1px solid #eee;font-family:"DM Sans",system-ui,sans-serif;direction:ltr}' +
      '#' + ID + ' .in{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:80px;padding:0 48px;box-sizing:border-box}' +
      '#' + ID + ' nav{display:flex;gap:44px}' +
      '#' + ID + ' nav a{color:#111;font-weight:700;font-size:17px;text-decoration:none;letter-spacing:.2px}' +
      '#' + ID + ' nav a:hover{opacity:.65}' +
      '#' + ID + ' .logo img{display:block;height:40px;width:auto}' +
      '#' + ID + ' .icons{display:flex;justify-content:flex-end;gap:26px;align-items:center}' +
      '#' + ID + ' button{background:none;border:0;padding:6px;cursor:pointer;color:#111;position:relative;line-height:0}' +
      '#' + ID + ' .badge{position:absolute;top:-2px;right:-4px;min-width:17px;height:17px;border-radius:9px;background:#3b8fe0;color:#fff;font:700 11px/17px "DM Sans",sans-serif;text-align:center;padding:0 4px;box-sizing:border-box}' +
      '#' + ID + ' .burger{display:none}' +
      '#' + ID + ' .drop{display:none;flex-direction:column;border-top:1px solid #eee;padding:8px 20px 14px}' +
      '#' + ID + ' .drop a{color:#111;font-weight:700;font-size:17px;text-decoration:none;padding:12px 0;border-bottom:1px solid #f2f2f2}' +
      '#' + ID + '.open .drop{display:flex}' +
      '@media (max-width:767px){#' + ID + ' .in{height:64px;padding:0 12px}#' + ID + ' nav{display:none}#' + ID + ' .burger{display:block;justify-self:start}#' + ID + ' .logo img{height:34px}#' + ID + ' .icons{gap:10px}}';
    document.head.appendChild(st);
  }

  var SEARCH = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M15.5 15.5 21 21"/></svg>';
  var BAG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
  var MENU = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

  function go(page, fallback) {
    if (window.Ecwid && Ecwid.openPage) { try { Ecwid.openPage(page); return; } catch (e) {} }
    location.href = fallback;
  }

  function build() {
    var hd = document.getElementById(ID);
    if (hd) return hd;
    css();
    hd = document.createElement('header');
    hd.id = ID;
    var links = LINKS.map(function (l) { return '<a href="' + l.href + '">' + l.label + '</a>'; }).join('');
    hd.innerHTML =
      '<div class="in">' +
        '<div><nav aria-label="Main">' + links + '</nav><button class="burger" aria-label="Menu" aria-expanded="false">' + MENU + '</button></div>' +
        '<a class="logo" href="' + HOME + '" aria-label="499K home"><img src="' + LOGO + '" alt="499K"></a>' +
        '<div class="icons"><button class="search" aria-label="Search">' + SEARCH + '</button><button class="bag" aria-label="Bag">' + BAG + '<span class="badge" hidden></span></button></div>' +
      '</div>' +
      '<div class="drop">' + links + '</div>';
    hd.querySelector('.search').addEventListener('click', function () { go('search', '/products/search'); });
    hd.querySelector('.bag').addEventListener('click', function () { go('cart', '/products/cart'); });
    var burger = hd.querySelector('.burger');
    burger.addEventListener('click', function () {
      var open = hd.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    hd.querySelectorAll('.drop a').forEach(function (a) { a.addEventListener('click', function () { hd.classList.remove('open'); }); });
    document.body.insertBefore(hd, document.body.firstChild);
    return hd;
  }

  // Does the page already show this header (the home page's own section)?
  function pageHasHeader(hd) {
    var a = document.querySelectorAll('a[href*="Policy-Terms"]');
    for (var i = 0; i < a.length; i++) {
      if (hd.contains(a[i])) continue;
      var r = a[i].getBoundingClientRect();
      if (r.width && r.height && r.top + window.scrollY < 400) return true;
    }
    return false;
  }

  function update() {
    var hd = build();
    var show = !pageHasHeader(hd);
    hd.style.display = show ? '' : 'none';
  }

  function badge(n) {
    var b = document.querySelector('#' + ID + ' .badge');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || '');
  }

  function hook(tries) {
    if (!(window.Ecwid && Ecwid.OnPageLoaded)) {
      if (tries < 60) setTimeout(function () { hook(tries + 1); }, 500);
      return;
    }
    Ecwid.OnPageLoaded.add(function () { setTimeout(update, 50); setTimeout(update, 800); });
    if (Ecwid.OnCartChanged) Ecwid.OnCartChanged.add(function (c) { badge(c && c.productsQuantity); });
    if (Ecwid.Cart && Ecwid.Cart.get) Ecwid.Cart.get(function (c) { badge(c && c.productsQuantity); });
  }

  function start() {
    if (!document.body) return setTimeout(start, 50);
    update();
    setInterval(update, 1500); // the site swaps pages without reloading
    hook(0);
  }
  start();
})();
