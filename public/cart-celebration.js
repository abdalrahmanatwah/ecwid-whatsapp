/* 499K — "added to bag" celebration on the storefront.
 * Same look as the sales page's "order delivered" moment: a confetti burst and a
 * card that bounces in. Plays when a shopper adds a product to the bag from a
 * product page or a category/search grid (not when quantities change in the cart).
 * Served together with the social-proof script (same Ecwid app, same URL). */
(function () {
  'use strict';
  if (window.__k499CartParty) return;
  window.__k499CartParty = true;

  // Copy — edit freely.
  var TITLE = 'Added to your bag!';
  var VIEW_BAG = 'View bag';
  var CELEBRATE_ON = ['PRODUCT', 'CATEGORY', 'SEARCH'];
  var COLORS = ['#d9480f', '#3b5bdb', '#2f7d4f', '#b7791f', '#ff7a3d'];
  var FONT = "'Changa', inherit"; // loaded by the social-proof script
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var pageType = '';
  var before = null; // item key → quantity, from the last cart we saw
  var tap = null; // where the shopper last tapped, so the confetti starts at the button

  document.addEventListener('pointerdown', function (e) { tap = { x: e.clientX, y: e.clientY, at: Date.now() }; }, true);

  function css() {
    if (document.getElementById('k499-party-css')) return;
    var st = document.createElement('style');
    st.id = 'k499-party-css';
    st.textContent =
      '#k499-party{position:fixed;inset:0;pointer-events:none;z-index:2147483000}' +
      '.k499-toasts{position:fixed;left:0;right:0;top:16px;display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2147483001;pointer-events:none;padding:0 16px}' +
      '.k499-toast{pointer-events:auto;display:flex;align-items:center;gap:14px;max-width:440px;width:100%;box-sizing:border-box;background:#fff;color:#1b1a17;border:1px solid #e4dfd3;border-left:5px solid #2f7d4f;border-radius:16px;padding:12px 14px;box-shadow:0 18px 40px -18px rgba(0,0,0,.45);font-family:' + FONT + ';animation:k499in .6s cubic-bezier(.2,1.4,.4,1) both}' +
      '.k499-toast.out{animation:k499out .4s ease-in forwards}' +
      '.k499-toast .ico{font-size:28px;line-height:1;animation:k499bounce 1s ease-in-out 3}' +
      '.k499-toast img{width:46px;height:46px;border-radius:10px;object-fit:cover;flex:none}' +
      '.k499-toast .tx{min-width:0;flex:1}' +
      '.k499-toast .t1{font-weight:700;font-size:15px}' +
      '.k499-toast .t2{color:#6f6a60;font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.k499-toast button{flex:none;border:0;border-radius:999px;background:#1b1a17;color:#fff;font:600 13px ' + FONT + ';padding:8px 14px;cursor:pointer}' +
      '@keyframes k499in{from{opacity:0;transform:translateY(-30px) scale(.9)}to{opacity:1;transform:none}}' +
      '@keyframes k499out{to{opacity:0;transform:translateY(-24px)}}' +
      '@keyframes k499bounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px) rotate(-8deg)}70%{transform:translateY(0) rotate(6deg)}}' +
      '@media (prefers-reduced-motion: reduce){.k499-toast,.k499-toast .ico{animation:none!important}}';
    document.head.appendChild(st);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(item) {
    css();
    var box = document.querySelector('.k499-toasts');
    if (!box) { box = el('div', 'k499-toasts'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    while (box.firstChild) box.removeChild(box.firstChild); // one card at a time
    var t = el('div', 'k499-toast');
    var img = item && item.image;
    if (img) { var i = el('img'); i.src = img; i.alt = ''; t.appendChild(i); } else t.appendChild(el('div', 'ico', '🎉'));
    var tx = el('div', 'tx');
    tx.appendChild(el('div', 't1', TITLE + (img ? ' 🎉' : '')));
    if (item && item.name) tx.appendChild(el('div', 't2', item.name));
    t.appendChild(tx);
    var b = el('button', null, VIEW_BAG);
    b.addEventListener('click', function () { if (window.Ecwid && Ecwid.openPage) Ecwid.openPage('cart'); });
    t.appendChild(b);
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 450); }, 4500);
  }

  function confetti() {
    if (reduce.matches) return;
    css();
    var c = document.getElementById('k499-party');
    if (!c) { c = document.createElement('canvas'); c.id = 'k499-party'; c.setAttribute('aria-hidden', 'true'); document.body.appendChild(c); }
    var ctx = c.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var fromTap = tap && Date.now() - tap.at < 4000;
    var ox = fromTap ? tap.x : W / 2, oy = fromTap ? tap.y : H * 0.75;
    var parts = [];
    for (var n = 0; n < 140; n++) {
      parts.push({
        x: ox + (Math.random() - 0.5) * 60, y: oy,
        vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 7,
        s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        col: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    var t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (t - t0 < 2800) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  function keyOf(it) {
    return String((it.product && it.product.id) || it.id) + '|' + JSON.stringify(it.options || (it.product && it.product.selectedOptions) || '');
  }
  function snapshot(cart) {
    var m = {};
    (cart && cart.items || []).forEach(function (it) { m[keyOf(it)] = (m[keyOf(it)] || 0) + (Number(it.quantity) || 0); });
    return m;
  }

  function onCart(cart) {
    var now = snapshot(cart);
    var prev = before;
    before = now;
    if (!prev || CELEBRATE_ON.indexOf(pageType) < 0) return;
    var added = null;
    (cart.items || []).forEach(function (it) { if ((now[keyOf(it)] || 0) > (prev[keyOf(it)] || 0)) added = it; });
    if (!added) return;
    var p = added.product || {};
    toast({ name: p.name || '', image: p.imageUrl || p.smallThumbnailUrl || p.thumbnailUrl || '' });
    confetti();
  }

  function hook(tries) {
    if (!(window.Ecwid && Ecwid.OnCartChanged && Ecwid.OnPageLoaded)) {
      if (tries < 60) setTimeout(function () { hook(tries + 1); }, 500);
      return;
    }
    Ecwid.OnPageLoaded.add(function (page) { pageType = String((page && page.type) || ''); });
    // Start from the cart as it is now, so opening the site never celebrates.
    if (Ecwid.Cart && Ecwid.Cart.get) Ecwid.Cart.get(function (cart) { if (!before) before = snapshot(cart); });
    Ecwid.OnCartChanged.add(onCart);
  }
  hook(0);

  // For checking the look without buying: add #k499-party-test to any store URL.
  if (/k499-party-test/.test(location.hash)) {
    setTimeout(function () { toast({ name: 'ASICS COURT FF 3 — Size 43' }); confetti(); }, 1200);
  }
})();
