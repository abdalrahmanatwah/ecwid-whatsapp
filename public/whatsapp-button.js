/* 499K — small round WhatsApp button on the storefront.
 * Served together with the social-proof script (same Ecwid app, same URL), so
 * nothing new has to be installed on Ecwid. The server fills in the number from
 * STORE_WHATSAPP_NUMBER; without a number the button doesn't show.
 *
 * It stays out of the way:
 *  - a 56px circle in the corner, never a full-width bar;
 *  - it moves up above anything Ecwid pins to the bottom of the screen
 *    (the filter "Apply" bar, "Add to bag" bar, cart bar…);
 *  - it hides while a full-screen panel is open (filters, cart, menus)
 *    and on checkout pages. */
(function () {
  'use strict';
  if (window.__k499WhatsApp) return;
  window.__k499WhatsApp = true;

  var NUMBER = '__WA_NUMBER__';
  if (!/^\d{8,15}$/.test(NUMBER)) return;

  // Copy — edit freely.
  var MESSAGE = '\u0623\u0647\u0644\u0627\u064b 499K\u060c \u0639\u0646\u062f\u064a \u0633\u0624\u0627\u0644'; // أهلاً 499K، عندي سؤال
  var PRODUCT_MESSAGE = '\u0623\u0647\u0644\u0627\u064b 499K\u060c \u0639\u0646\u062f\u064a \u0633\u0624\u0627\u0644 \u0639\u0646: '; // أهلاً 499K، عندي سؤال عن: 
  var LABEL = '\u0643\u0644\u0651\u0645\u0646\u0627 \u0639\u0644\u0649 \u0648\u0627\u062a\u0633\u0627\u0628'; // كلّمنا على واتساب
  var SIDE = 'right'; // 'left' or 'right'
  var GAP = 16; // px from the screen edge and from anything pinned at the bottom
  var ID = 'k499-wa';

  var onCheckout = false;
  var productName = '';

  var ICON = '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false"><path fill="#fff" d="M16 3C8.82 3 3 8.82 3 16c0 2.29.6 4.53 1.74 6.5L3 29l6.68-1.71A12.94 12.94 0 0 0 16 29c7.18 0 13-5.82 13-13S23.18 3 16 3zm0 23.6c-1.98 0-3.92-.53-5.62-1.54l-.4-.24-3.96 1.02 1.05-3.86-.26-.4A10.56 10.56 0 0 1 5.4 16C5.4 10.15 10.16 5.4 16 5.4S26.6 10.15 26.6 16 21.85 26.6 16 26.6zm5.82-7.94c-.32-.16-1.88-.93-2.17-1.03-.29-.11-.5-.16-.71.16-.21.32-.82 1.03-1 1.24-.19.21-.37.24-.69.08-.32-.16-1.34-.49-2.55-1.57-.94-.84-1.58-1.88-1.76-2.2-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.71-1.71-.98-2.34-.26-.62-.52-.53-.71-.54h-.61c-.21 0-.56.08-.85.4-.29.32-1.11 1.09-1.11 2.65s1.14 3.07 1.3 3.28c.16.21 2.24 3.42 5.43 4.8.76.33 1.35.52 1.81.67.76.24 1.45.21 2 .13.61-.09 1.88-.77 2.14-1.51.27-.74.27-1.38.19-1.51-.08-.13-.29-.21-.61-.37z"/></svg>';

  function link() {
    var text = productName ? PRODUCT_MESSAGE + productName + '\n' + location.href : MESSAGE;
    return 'https://wa.me/' + NUMBER + '?text=' + encodeURIComponent(text);
  }

  function build() {
    if (document.getElementById(ID)) return document.getElementById(ID);
    var a = document.createElement('a');
    a.id = ID;
    a.href = link();
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', LABEL);
    a.title = LABEL;
    a.innerHTML = ICON;
    var s = a.style;
    s.position = 'fixed';
    s[SIDE] = GAP + 'px';
    s.bottom = GAP + 'px';
    s.width = '56px';
    s.height = '56px';
    s.borderRadius = '50%';
    s.background = '#25D366';
    s.boxShadow = '0 4px 14px rgba(0,0,0,.22)';
    s.display = 'flex';
    s.alignItems = 'center';
    s.justifyContent = 'center';
    s.zIndex = '9990';
    s.transition = 'bottom .2s ease, opacity .2s ease';
    s.boxSizing = 'border-box';
    a.addEventListener('click', function () { a.href = link(); });
    document.body.appendChild(a);
    return a;
  }

  // The fixed/sticky ancestor of a node (not our button, not the page itself).
  function pinnedParent(node, btn) {
    for (var e = node; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e === btn) return null;
      var pos = getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') return e;
    }
    return null;
  }

  function layout() {
    var btn = build();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    // A big panel over the middle of the screen (filters, cart, menu) → hide.
    var cover = false;
    var mid = document.elementsFromPoint(vw / 2, vh / 2);
    for (var i = 0; i < mid.length && !cover; i++) {
      var p = pinnedParent(mid[i], btn);
      if (p) {
        var r = p.getBoundingClientRect();
        if (r.height > vh * 0.6 && r.width > vw * 0.6) cover = true;
      }
    }

    // Bars pinned to the bottom (Apply, Add to bag…) → sit above the tallest one.
    var lift = 0;
    var xs = [vw * 0.1, vw * 0.5, vw * 0.9, SIDE === 'left' ? 44 : vw - 44];
    for (var j = 0; j < xs.length; j++) {
      var under = document.elementsFromPoint(xs[j], vh - 6);
      for (var k = 0; k < under.length; k++) {
        var bar = pinnedParent(under[k], btn);
        if (!bar) continue;
        var b = bar.getBoundingClientRect();
        if (b.bottom >= vh - 2 && b.height < vh * 0.6) lift = Math.max(lift, vh - b.top);
        break;
      }
    }

    btn.style.bottom = (lift ? lift + GAP : GAP) + 'px';
    var hide = cover || onCheckout;
    btn.style.opacity = hide ? '0' : '1';
    btn.style.pointerEvents = hide ? 'none' : 'auto';
  }

  function productTitle() {
    var t = document.querySelector('.product-details__product-title, .product-details-module__title, h1');
    return t ? t.textContent.trim().slice(0, 120) : '';
  }

  var started = false;
  function start() {
    if (started) return;
    if (!document.body) return setTimeout(start, 100);
    started = true;
    layout();
    setInterval(layout, 400);
    window.addEventListener('resize', layout);
    window.addEventListener('scroll', layout, { passive: true });
    hookEcwid(0);
  }

  // Ecwid's API may load after this script: keep checking for up to 30s.
  function hookEcwid(tries) {
    if (!(window.Ecwid && Ecwid.OnPageLoaded)) {
      if (tries < 60) setTimeout(function () { hookEcwid(tries + 1); }, 500);
      return;
    }
    Ecwid.OnPageLoaded.add(function (page) {
      var type = String((page && page.type) || '');
      onCheckout = /^CHECKOUT/.test(type);
      productName = type === 'PRODUCT' ? productTitle() : '';
      if (type === 'PRODUCT' && !productName) setTimeout(function () { productName = productTitle(); }, 800);
      layout();
    });
  }

  start();
})();
