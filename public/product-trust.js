/* 499K — trust block under the "Add to bag" button on every product page:
 * delivery time, four promises (quality, exchange, cash on delivery,
 * installments) and the ways to pay. Served with the social-proof script
 * (same Ecwid app, same URL). Edit the copy below freely. */
(function () {
  'use strict';
  if (window.__k499Trust) return;
  window.__k499Trust = true;

  // ---- Copy -----------------------------------------------------------------
  var DELIVERY_BOLD = 'التوصيل خلال 2 إلى 7 أيام.';
  var DELIVERY_REST = 'المندوب هيكلمك قبل التوصيل.';
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
    st.textContent =
      '.k499-trust{container-type:inline-size;direction:rtl;font-family:' + FONT + ';color:#2b2a27;margin:18px 0 6px;clear:both}' +
      '.k499-trust .tb{display:flex;align-items:center;gap:12px;background:#f3eee6;border-radius:16px;padding:14px 18px;font-size:15px;line-height:1.6}' +
      '.k499-trust .tb svg{flex:none;color:#2b2a27}' +
      '.k499-trust .tb b{font-weight:700}' +
      '.k499-trust .bd{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 6px;margin:16px 0 4px;font-size:15px;font-weight:600}' +
      '.k499-trust .bd span{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:4px;white-space:nowrap}' +
      '.k499-trust .bd svg{color:#55524b}' +
      '.k499-trust .pt{text-align:center;color:#8a857b;font-size:13px;margin:14px 0 8px}' +
      '.k499-trust .pm{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}' +
      '.k499-trust .pm span{border:1px solid #e4dfd3;background:#fff;border-radius:10px;padding:6px 11px;font-size:13px;font-weight:600;color:#3d3a34;white-space:nowrap}' +
      '@container (max-width:640px){.k499-trust .bd{grid-template-columns:1fr 1fr}}' +
      '@media (max-width:640px){.k499-trust .bd{grid-template-columns:1fr 1fr;font-size:14px}.k499-trust .tb{font-size:14px}}';
    document.head.appendChild(st);
  }

  function build() {
    var el = document.createElement('div');
    el.className = 'k499-trust';
    el.innerHTML =
      '<div class="tb">' + icon('truck', 30) + '<div><b>' + esc(DELIVERY_BOLD) + '</b> ' + esc(DELIVERY_REST) + '</div></div>' +
      '<div class="bd">' + BADGES.map(function (b) { return '<span>' + icon(b[0], 20) + esc(b[1]) + '</span>'; }).join('') + '</div>' +
      '<div class="pt">' + esc(PAY_TITLE) + '</div>' +
      '<div class="pm">' + PAY.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('') + '</div>';
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

  var onProduct = false, obs = null;
  function watch() {
    if (obs) obs.disconnect();
    // Ecwid re-renders parts of the page (size picked, etc.): put the block back if it goes.
    obs = new MutationObserver(function () { if (onProduct && !document.querySelector('.k499-trust')) place(); });
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
      if (!onProduct) return;
      var n = 0;
      (function tryPlace() { if (!place() && n++ < 20) setTimeout(tryPlace, 250); })();
    });
    watch();
  }
  hook(0);
})();
