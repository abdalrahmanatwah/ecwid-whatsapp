/* 499K — "صور عملائنا" social proof strip under the product photos.
 * Served by /social-proof/widget.js; the server replaces the base URL below.
 * Loaded on the storefront by the 499K Ecwid app (storefront JS URL). */
(function () {
  'use strict';
  if (window.__k499SocialProof) return; // never load twice
  window.__k499SocialProof = true;

  var BASE = '__SOCIAL_PROOF_BASE__';
  var TITLE = 'صور من عملائنا 📸';
  var SUBTITLE = 'عملاء حقيقيين استلموا أوردراتهم من 499K';
  var BOX_ID = 'k499-social-proof';

  // Where to put the strip, best match first. Ecwid's product page puts the
  // photos in .product-details__gallery; the others cover older/alternate layouts.
  var ANCHORS = ['.product-details__gallery', '.details-gallery', '.product-details-module__gallery'];
  var FALLBACKS = ['.product-details__description', '.product-details__product-description'];

  var photosPromise = null;
  function getPhotos() {
    if (!photosPromise) {
      photosPromise = fetch(BASE + '/social-proof/photos.json')
        .then(function (r) { return r.ok ? r.json() : { photos: [] }; })
        .then(function (d) { return d.photos || []; })
        .catch(function () { photosPromise = null; return []; });
    }
    return photosPromise;
  }

  /* ----------------------------- styles ----------------------------- */
  function injectStyles() {
    if (document.getElementById('k499-sp-css')) return;
    var css =
      '#' + BOX_ID + '{direction:rtl;margin:18px 0 6px;font-family:inherit;clear:both}' +
      '#' + BOX_ID + ' .k499-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 10px}' +
      '#' + BOX_ID + ' .k499-t{font-size:17px;font-weight:700;margin:0;color:inherit}' +
      '#' + BOX_ID + ' .k499-s{font-size:12.5px;opacity:.65}' +
      '#' + BOX_ID + ' .k499-row{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;' +
        '-webkit-overflow-scrolling:touch;padding-bottom:6px;scrollbar-width:thin}' +
      '#' + BOX_ID + ' .k499-card{flex:0 0 132px;scroll-snap-align:start;position:relative;border:0;padding:0;' +
        'border-radius:12px;overflow:hidden;cursor:pointer;background:#eee;aspect-ratio:3/4;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.12)}' +
      '#' + BOX_ID + ' .k499-card img{width:100%;height:100%;object-fit:cover;display:block}' +
      '#' + BOX_ID + ' .k499-cap{position:absolute;inset:auto 0 0 0;padding:18px 8px 7px;color:#fff;' +
        'font-size:12px;line-height:1.3;text-align:right;background:linear-gradient(transparent,rgba(0,0,0,.72))}' +
      '#' + BOX_ID + ' .k499-cap b{display:block;font-size:13px}' +
      '@media(min-width:768px){#' + BOX_ID + ' .k499-card{flex-basis:150px}}' +
      '.k499-lb{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.92);display:flex;' +
        'align-items:center;justify-content:center;flex-direction:column;direction:rtl}' +
      '.k499-lb img{max-width:94vw;max-height:78vh;border-radius:10px;object-fit:contain}' +
      '.k499-lb .k499-lc{color:#fff;margin-top:12px;font-size:15px;text-align:center}' +
      '.k499-lb button{position:absolute;background:rgba(255,255,255,.14);color:#fff;border:0;' +
        'width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer;line-height:44px;padding:0}' +
      '.k499-lb .k499-x{top:14px;left:14px}' +
      '.k499-lb .k499-prev{right:10px;top:50%;transform:translateY(-50%)}' +
      '.k499-lb .k499-next{left:10px;top:50%;transform:translateY(-50%)}';
    var st = document.createElement('style');
    st.id = 'k499-sp-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------ render ----------------------------- */
  function build(photos) {
    var box = document.createElement('div');
    box.id = BOX_ID;
    var cards = photos.map(function (p, i) {
      var who = p.name ? '<b>' + esc(p.name) + '</b>' : '';
      var where = p.city ? esc(p.city) : '';
      var cap = who || where ? '<span class="k499-cap">' + who + where + '</span>' : '';
      return (
        '<button type="button" class="k499-card" data-i="' + i + '" aria-label="صورة عميل ' + esc(p.name) + '">' +
        '<img loading="lazy" src="' + BASE + p.src + '" alt="' + esc((p.name || 'عميل') + ' ' + (p.city || '')) + '">' +
        cap + '</button>'
      );
    }).join('');
    box.innerHTML =
      '<div class="k499-h"><h3 class="k499-t">' + TITLE + '</h3><span class="k499-s">' + SUBTITLE + '</span></div>' +
      '<div class="k499-row">' + cards + '</div>';
    box.addEventListener('click', function (e) {
      var card = e.target.closest('.k499-card');
      if (card) openLightbox(photos, Number(card.getAttribute('data-i')));
    });
    return box;
  }

  function openLightbox(photos, start) {
    var i = start;
    var lb = document.createElement('div');
    lb.className = 'k499-lb';
    lb.innerHTML =
      '<button class="k499-x" aria-label="إغلاق">✕</button>' +
      (photos.length > 1 ? '<button class="k499-prev" aria-label="السابق">›</button><button class="k499-next" aria-label="التالي">‹</button>' : '') +
      '<img alt=""><div class="k499-lc"></div>';
    var img = lb.querySelector('img');
    var cap = lb.querySelector('.k499-lc');
    function show() {
      var p = photos[i];
      img.src = BASE + p.src;
      cap.textContent = [p.name, p.city].filter(Boolean).join(' – ');
    }
    function go(d) { i = (i + d + photos.length) % photos.length; show(); }
    function close() { document.removeEventListener('keydown', onKey); lb.remove(); }
    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') go(1);
      if (e.key === 'ArrowRight') go(-1);
    }
    lb.addEventListener('click', function (e) {
      if (e.target === lb || e.target.classList.contains('k499-x')) close();
      else if (e.target.classList.contains('k499-next')) go(1);
      else if (e.target.classList.contains('k499-prev')) go(-1);
    });
    var x0 = null;
    lb.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(dx > 0 ? 1 : -1); // RTL: swipe right = next
      x0 = null;
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(lb);
    show();
  }

  function findAnchor() {
    for (var a = 0; a < ANCHORS.length; a++) {
      var el = document.querySelector(ANCHORS[a]);
      if (el) return { el: el, where: 'after' };
    }
    for (var f = 0; f < FALLBACKS.length; f++) {
      var fb = document.querySelector(FALLBACKS[f]);
      if (fb) return { el: fb, where: 'before' };
    }
    return null;
  }

  // The product page renders after OnPageLoaded fires in some themes, so retry briefly.
  function mount(tries) {
    getPhotos().then(function (photos) {
      if (!photos.length) return;
      var old = document.getElementById(BOX_ID);
      if (old) old.remove();
      var anchor = findAnchor();
      if (!anchor) {
        if (tries < 20) setTimeout(function () { mount(tries + 1); }, 250);
        return;
      }
      injectStyles();
      var box = build(photos);
      if (anchor.where === 'after') anchor.el.insertAdjacentElement('afterend', box);
      else anchor.el.insertAdjacentElement('beforebegin', box);
    });
  }

  function init() {
    Ecwid.OnPageLoaded.add(function (page) {
      if (page.type === 'PRODUCT') mount(0);
      else {
        var old = document.getElementById(BOX_ID);
        if (old) old.remove();
      }
    });
  }

  // Wait for the Ecwid storefront API to exist.
  (function waitForEcwid(n) {
    if (window.Ecwid && Ecwid.OnAPILoaded) Ecwid.OnAPILoaded.add(init);
    else if (n < 200) setTimeout(function () { waitForEcwid(n + 1); }, 100);
  })(0);
})();
