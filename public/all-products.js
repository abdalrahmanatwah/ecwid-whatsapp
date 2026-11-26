/* 499K — home page section with EVERY active product (Ecwid's own
 * "category products" section stops at 20). It copies the look of the first
 * products section on the page (same cards, same CSS) and fills it from
 * /social-proof/products.json (enabled + in stock, newest first). */
(function () {
  'use strict';
  if (window.__k499All) return;
  window.__k499All = true;

  var BASE = 'https://ecwid-whatsapp.onrender.com';
  var TITLE = 'كل المنتجات';
  var ID = 'tile-k499-all-products';
  var GATE = '__GATE__'; // replaced by the server: '' = live for everyone

  if (GATE && !(location.search.indexOf(GATE) >= 0)) return;

  function isHome() { return location.pathname === '/' || location.pathname === ''; }
  function money(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'EGP';
  }
  function setImgs(scope, src, alt) {
    if (!scope) return;
    scope.querySelectorAll('source').forEach(function (s) { s.parentNode.removeChild(s); });
    scope.querySelectorAll('.ins-picture--thumb').forEach(function (t) { t.parentNode.removeChild(t); });
    scope.querySelectorAll('img').forEach(function (i) {
      i.removeAttribute('srcset');
      i.removeAttribute('sizes');
      i.setAttribute('loading', 'lazy');
      i.src = src;
      if (alt) i.alt = alt;
    });
  }

  function card(tplItem, p) {
    var c = tplItem.cloneNode(true);
    var a = c.querySelector('a');
    if (a) { a.href = p.url; a.removeAttribute('data-product-id'); }
    setImgs(c.querySelector('.ins-tile__image--primary'), p.img, p.name);
    var second = c.querySelector('.ins-tile__image--secondary');
    if (second) {
      if (p.img2) setImgs(second, p.img2, p.name);
      else second.parentNode.removeChild(second);
    }
    var rib = c.querySelector('.ins-tile__product-label');
    if (rib) {
      var span = rib.querySelector('span') || rib;
      if (p.ribbon) span.textContent = p.ribbon; else rib.parentNode.removeChild(rib);
    }
    var name = c.querySelector('.ins-tile__product-name');
    if (name) name.textContent = p.name;
    var cur = c.querySelector('.ins-tile__product-current-price');
    if (cur) cur.textContent = money(p.price);
    var old = c.querySelector('.ins-tile__product-compare-price');
    if (old) { if (p.old) old.textContent = money(p.old); else old.parentNode.removeChild(old); }
    return c;
  }

  function build(products) {
    if (!isHome() || document.getElementById(ID)) return true;
    var tiles = document.querySelectorAll('section.ins-tile--category-products');
    if (!tiles.length) return false;
    var tpl = tiles[0];
    var last = tiles[tiles.length - 1];
    var tplItem = tpl.querySelector('.ins-tile__product-item');
    var list = tpl.querySelector('.ins-tile__products');
    if (!tplItem || !list) return false;

    var sec = tpl.cloneNode(true);
    var oldId = tpl.id;
    sec.id = ID;
    // The section's own <style> targets its id: point it at the copy.
    sec.querySelectorAll('style').forEach(function (st) { st.textContent = st.textContent.split(oldId).join(ID); });
    var h = sec.querySelector('.ins-tile__title');
    if (h) h.textContent = TITLE + ' (' + products.length + ')';
    var box = sec.querySelector('.ins-tile__products');
    while (box.firstChild) box.removeChild(box.firstChild);
    var frag = document.createDocumentFragment();
    products.forEach(function (p) { frag.appendChild(card(tplItem, p)); });
    box.appendChild(frag);
    // Ecwid animates sections in on scroll; show this one right away.
    sec.querySelectorAll('.section__animation').forEach(function (e) { e.style.opacity = '1'; e.style.transform = 'none'; });
    last.parentNode.insertBefore(sec, last.nextSibling);
    return true;
  }

  function start() {
    if (!isHome()) return;
    fetch(BASE + '/social-proof/products.json')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.products) || [];
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
