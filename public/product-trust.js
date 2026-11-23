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
    ['bolt', 'توصيل في نفس اليوم', 'القاهرة والجيزة'],
    ['truck', 'باقي المحافظات خلال 2 – 7 أيام', 'المندوب هيكلمك قبل التوصيل'],
  ];
  var BADGES = [
    ['shield', 'ضمان الجودة'],
    ['swap', 'استبدال 14 يوم'],
    ['cash', 'الدفع عند الاستلام'],
    ['calendar', 'تقسيط لحد 6 شهور'],
  ];
  var PAY_TITLE = 'ادفع بأمان عن طريق';
  var PAY = ['كاش عند الاستلام', 'فودافون كاش', 'InstaPay', 'Visa', 'Mastercard', 'ميزة', 'valU', 'تقسيط مع أي بنك'];
  // ---------------------------------------------------------------------------

  var FONT = "'Changa', inherit"; // loaded by the social-proof script
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
    var st = document.createElement('style');
    st.id = 'k499-trust-css';
    var R = '.k499-trust ';
    st.textContent =
      // Reset whatever the store theme puts on divs/spans inside the product column.
      '.k499-trust,.k499-trust *{box-sizing:border-box;margin:0;padding:0;line-height:1.45;letter-spacing:normal;text-transform:none;font-family:' + FONT + '}' +
      '.k499-trust{direction:rtl;text-align:right;color:#24221e;margin:26px 0 8px;clear:both;display:flex;flex-direction:column;gap:22px}' +
      // Delivery card: two clean rows with a hairline between.
      R + '.dl{background:#f5f1ea;border:1px solid #ece5d9;border-radius:18px;padding:6px 18px}' +
      R + '.row{display:flex;align-items:center;gap:14px;padding:14px 0}' +
      R + '.row+.row{border-top:1px solid #e6dfd2}' +
      R + '.ic{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#fff;color:#24221e;border:1px solid #ece5d9}' +
      R + '.row.hot .ic{background:#1f7a4d;border-color:#1f7a4d;color:#fff}' +
      R + '.tt{display:block;font-size:15.5px;font-weight:700}' +
      R + '.row.hot .tt{color:#1f7a4d}' +
      R + '.dd{display:block;font-size:13.5px;color:#7a7468;margin-top:2px}' +
      // Promises: 2×2 tiles.
      R + '.bd{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      R + '.bd div{display:flex;align-items:center;gap:10px;border:1px solid #ece5d9;border-radius:14px;padding:12px 14px;font-size:14.5px;font-weight:600;background:#fff}' +
      R + '.bd svg{flex:none;color:#6b665c}' +
      // Ways to pay.
      R + '.pt{display:flex;align-items:center;gap:12px;color:#8a857b;font-size:13px;font-weight:600}' +
      R + '.pt:before,' + R + '.pt:after{content:"";flex:1;height:1px;background:#ece5d9}' +
      R + '.pm{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px}' +
      R + '.pm span{display:inline-block;border:1px solid #e6e1d6;background:#fff;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;color:#3d3a34;white-space:nowrap}' +
      '@media (max-width:420px){' + R + '.bd div{font-size:13.5px;padding:11px 10px;gap:8px}' + R + '.tt{font-size:14.5px}}';
    document.head.appendChild(st);
  }

  function build() {
    var el = document.createElement('div');
    el.className = 'k499-trust';
    el.innerHTML =
      '<div class="dl">' + DELIVERY.map(function (d, i) {
        return '<div class="row' + (i === 0 ? ' hot' : '') + '"><span class="ic">' + icon(d[0], 20) + '</span>' +
          '<span><span class="tt">' + esc(d[1]) + '</span><span class="dd">' + esc(d[2]) + '</span></span></div>';
      }).join('') + '</div>' +
      '<div class="bd">' + BADGES.map(function (b) { return '<div>' + icon(b[0], 20) + '<span>' + esc(b[1]) + '</span></div>'; }).join('') + '</div>' +
      '<div><div class="pt">' + esc(PAY_TITLE) + '</div>' +
      '<div class="pm">' + PAY.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('') + '</div></div>';
    return el;
  }

  // Under the purchase area of Ecwid's product page (first selector that exists).
  var ANCHORS = ['.product-details__action-panel', '.details-product-purchase', '.product-details-module__btn-addmore',
    '.product-details__product-price', '.product-details__product-title'];
  function place() {
    if (document.querySelector('.k499-trust')) return true;
    for (var i = 0; i < ANCHORS.length; i++) {
      var a = document.querySelector(ANCHORS[i]);
      if (a && a.parentNode) { css(); a.parentNode.insertBefore(build(), a.nextSibling); return true; }
    }
    return false;
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
