/* 499K — trust block under the "Add to bag" button on every product page:
 * delivery time, four promises (quality, exchange, cash on delivery,
 * installments) and the ways to pay. Served with the social-proof script
 * (same Ecwid app, same URL). Edit the copy below freely. */
(function () {
  'use strict';
  if (window.__k499Trust) return;
  window.__k499Trust = true;

  // ---- Copy -----------------------------------------------------------------
  var DELIVERY = [
    // [icon, title, detail]
    ['bolt', 'متاح التوصيل في نفس اليوم', 'في القاهرة والجيزة'],
    ['truck', 'التوصيل لكل المحافظات خلال 2 – 5 أيام', 'المندوب هيكلمك قبل التوصيل'],
  ];
  var BADGES = [
    ['shield', 'ضمان الجودة'],
    ['swap', 'استبدال 14 يوم'],
    ['cash', 'الدفع عند الاستلام'],
    ['calendar', 'تقسيط لحد 6 شهور'],
  ];
  var PAY_TITLE = 'ادفع بأمان عن طريق';
  // [label, logo file name in public/pay/ without extension]. A method shows its
  // logo once the official file is there; until then, its name.
  var PAY = [['كاش عند الاستلام', 'cod'], ['فودافون كاش', 'vodafone-cash'], ['InstaPay', 'instapay'], ['Visa', 'visa'],
    ['Mastercard', 'mastercard'], ['ميزة', 'meeza'], ['valU', 'valu'], ['تقسيط مع أي بنك', 'installments']];
  var BASE = 'https://ecwid-whatsapp.onrender.com';
  // ---------------------------------------------------------------------------

  // Same look as the store: DM Sans (the theme font) + a matching Arabic face,
  // near-black on white, hairline borders, 4px corners like the Add to Bag button.
  var FONT = '"DM Sans","IBM Plex Sans Arabic",system-ui,sans-serif';
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';
  var INK = '#1b1b1b', MUTED = '#707070', LINE = '#e6e6e6', SOFT = '#f6f6f6';
  var ICONS = {
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    truck: '<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    swap: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  };
  function icon(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function css() {
    if (document.getElementById('k499-trust-css')) return;
    if (!document.querySelector('link[href="' + FONT_URL + '"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_URL; document.head.appendChild(l);
    }
    var st = document.createElement('style');
    st.id = 'k499-trust-css';
    var R = '.k499-trust ';
    st.textContent =
      // Reset whatever the store theme puts on divs/spans inside the product column.
      '.k499-trust,.k499-trust *{box-sizing:border-box;margin:0;padding:0;line-height:1.5;letter-spacing:normal;text-transform:none;font-family:' + FONT + '}' +
      '.k499-trust{direction:rtl;text-align:right;color:' + INK + ';margin:28px 0 36px!important;padding:0!important;container-type:inline-size;clear:both;display:flex;flex-direction:column;gap:16px}' +
      // Delivery: one bordered box, two rows.
      R + '.dl{border:1px solid ' + LINE + ';border-radius:4px}' +
      R + '.row{display:flex;align-items:center;justify-content:center;gap:14px;padding:16px 18px;text-align:center}' +
      R + '.row+.row{border-top:1px solid ' + LINE + '}' +
      R + '.ic{flex:none;width:38px;height:38px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:' + SOFT + ';color:' + INK + '}' +
      R + '.row.hot .ic{background:' + INK + ';color:#fff}' +
      R + '.tt{display:block;font-size:15px;font-weight:700}' +
      R + '.dd{display:block;font-size:13px;color:' + MUTED + ';margin-top:1px}' +
      // Promises: a 2×2 table with hairlines.
      R + '.bd{display:grid;grid-template-columns:1fr 1fr;border:1px solid ' + LINE + ';border-radius:4px;overflow:hidden}' +
      R + '.bd div{display:flex;align-items:center;justify-content:center;gap:9px;padding:15px 10px;font-size:14px;font-weight:600;text-align:center}' +
      R + '.bd div:nth-child(odd){border-left:1px solid ' + LINE + '}' +
      R + '.bd div:nth-child(-n+2){border-bottom:1px solid ' + LINE + '}' +
      R + '.bd svg{flex:none;color:' + INK + '}' +
      // Ways to pay.
      R + '.pay{padding-top:8px}' +
      R + '.pt{display:flex;align-items:center;gap:12px;color:' + MUTED + ';font-size:12.5px;font-weight:500}' +
      R + '.pt:before,' + R + '.pt:after{content:"";flex:1;height:1px;background:' + LINE + '}' +
      R + '.pm{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:12px}' +
      R + '.pm span{display:inline-block;border:1px solid ' + LINE + ';border-radius:3px;padding:5px 11px;font-size:12.5px;font-weight:500;color:#3a3a3a;white-space:nowrap;background:#fff}' +
      // Narrow product column (the theme's sidebar is ~300px): icon above the label.
      R + '.pm span.lg{padding:4px 8px;display:inline-flex;align-items:center;height:32px}' +
      R + '.pm span.lg img{display:block;height:20px;width:auto;max-width:64px;object-fit:contain}' +
      '@container (max-width:380px){' + R + '.bd div{flex-direction:column;gap:6px;padding:14px 6px;font-size:13px}' + R + '.row{padding:14px}' + R + '.tt{font-size:14px}}' +
      '@media (max-width:420px){' + R + '.bd div{font-size:13px;gap:7px;padding:14px 6px}' + R + '.row{padding:14px}}';
    document.head.appendChild(st);
  }

  function build() {
    var el = document.createElement('div');
    el.className = 'k499-trust';
    el.innerHTML =
      '<div class="dl">' + DELIVERY.map(function (d, i) {
        return '<div class="row' + (i === 0 ? ' hot' : '') + '"><span class="ic">' + icon(d[0], 20) + '</span>' +
          '<span><span class="tt">' + esc(d[1]) + '</span> <span class="dd">' + esc(d[2]) + '</span></span></div>';
      }).join('') + '</div>' +
      '<div class="bd">' + BADGES.map(function (b) { return '<div>' + icon(b[0], 20) + '<span>' + esc(b[1]) + '</span></div>'; }).join('') + '</div>' +
      '<div class="pay"><div class="pt">' + esc(PAY_TITLE) + '</div>' +
      '<div class="pm">' + PAY.map(function (p) { return '<span data-logo="' + p[1] + '">' + esc(p[0]) + '</span>'; }).join('') + '</div></div>';
    swapLogos(el);
    return el;
  }

  // Replace a method's name with its logo when the file exists on the server.
  var logos = null;
  function swapLogos(el) {
    if (!logos) logos = fetch(BASE + '/social-proof/pay.json').then(function (r) { return r.json(); }).then(function (d) { return d.files || []; }).catch(function () { return []; });
    logos.then(function (files) {
      var spans = el.querySelectorAll('.pm span[data-logo]');
      for (var i = 0; i < spans.length; i++) {
        var key = spans[i].getAttribute('data-logo');
        var f = files.filter(function (x) { return x.replace(/\.[^.]+$/, '') === key; })[0];
        if (!f) continue;
        var label = spans[i].textContent;
        spans[i].classList.add('lg');
        spans[i].innerHTML = '<img src="' + BASE + '/social-proof/pay/' + f + '" alt="' + esc(label) + '" title="' + esc(label) + '">';
      }
    });
  }

  // Under the purchase area of Ecwid's product page (first selector that exists).
  var ANCHORS = ['.product-details__action-panel', '.details-product-purchase', '.product-details-module__btn-addmore',
    '.product-details__product-price', '.product-details__product-title'];
  function place() {
    if (document.querySelector('.k499-trust')) return true;
    for (var i = 0; i < ANCHORS.length; i++) {
      var a = document.querySelector(ANCHORS[i]);
      if (a && a.parentNode) {
        css();
        var el = build();
        // Same width as the Add to Bag button, so the column lines up.
        a.parentNode.insertBefore(el, a.nextSibling);
        matchButtonWidth(a, el);
        return true;
      }
    }
    return false;
  }
  // Keep the block exactly as wide as the Add to Bag button, also when the
  // layout changes (phone ↔ desktop, rotating, the theme finishing its layout).
  var sizer = null;
  function widest(a) {
    var w = 0, btns = a.querySelectorAll('button, .form-control__button');
    for (var j = 0; j < btns.length; j++) w = Math.max(w, btns[j].getBoundingClientRect().width);
    return w;
  }
  function matchButtonWidth(a, el) {
    function apply() { var w = widest(a); el.style.maxWidth = w > 160 ? Math.round(w) + 'px' : ''; }
    apply();
    if (sizer) sizer.disconnect();
    if (window.ResizeObserver) {
      sizer = new ResizeObserver(apply);
      var b = a.querySelector('.form-control__button') || a.querySelector('button');
      if (b) sizer.observe(b);
      sizer.observe(a);
    }
    window.addEventListener('resize', apply);
  }

  function clear() { var x = document.querySelector('.k499-trust'); if (x) x.remove(); }

  // Ecwid re-renders parts of the page (size picked, etc.) and can drop the
  // block. Put it back — but debounced and at most a few times per page, so an
  // insert/remove fight with Ecwid's renderer can never lock up the page.
  var onProduct = false, obs = null, timer = null, reinserts = 0, MAX_REINSERTS = 4;
  function stopWatching() { if (obs) { obs.disconnect(); obs = null; } clearTimeout(timer); }
  function watch() {
    stopWatching();
    obs = new MutationObserver(function () {
      if (!onProduct || timer) return;
      timer = setTimeout(function () {
        timer = null;
        if (!onProduct || document.querySelector('.k499-trust')) return;
        if (++reinserts > MAX_REINSERTS) { stopWatching(); return; }
        place();
      }, 400);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function hook(tries) {
    if (!(window.Ecwid && Ecwid.OnPageLoaded)) {
      if (tries < 60) setTimeout(function () { hook(tries + 1); }, 500);
      return;
    }
    Ecwid.OnPageLoaded.add(function (page) {
      onProduct = String((page && page.type) || '') === 'PRODUCT';
      clear();
      stopWatching();
      reinserts = 0;
      if (!onProduct) return;
      var n = 0;
      (function tryPlace() {
        if (place()) { watch(); return; }
        if (n++ < 20) setTimeout(tryPlace, 250);
      })();
    });
  }
  hook(0);
})();
