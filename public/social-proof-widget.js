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
      // Sized to match the product photos: a 2-column grid of big tiles on desktop
      // (like Ecwid's 2-up gallery), a full-width swipe carousel on phones.
      '#' + BOX_ID + '{direction:rtl;margin:44px 0 36px;font-family:inherit;clear:both;width:100%;max-width:100%;box-sizing:border-box}' +
      '#' + BOX_ID + ' .k499-h{display:flex;align-items:baseline;gap:6px 12px;flex-wrap:wrap;margin:0 0 18px}' +
      '#' + BOX_ID + ' .k499-t{font-size:24px;font-weight:800;line-height:1.3;margin:0;color:inherit}' +
      '#' + BOX_ID + ' .k499-s{font-size:15px;opacity:.7}' +
      '#' + BOX_ID + ' .k499-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}' +
      '#' + BOX_ID + ' .k499-card{position:relative;border:0;padding:0;margin:0;width:100%;border-radius:0;overflow:hidden;' +
        'cursor:zoom-in;background:#eee;aspect-ratio:var(--k499-ar,1/1);display:block}' +
      '#' + BOX_ID + ' .k499-card img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s}' +
      '#' + BOX_ID + ' .k499-card:hover img{transform:scale(1.03)}' +
      '#' + BOX_ID + ' .k499-cap{position:absolute;inset:auto 0 0 0;padding:44px 16px 14px;color:#fff;' +
        'font-size:15px;line-height:1.35;text-align:right;background:linear-gradient(transparent,rgba(0,0,0,.75))}' +
      '#' + BOX_ID + ' .k499-cap b{display:block;font-size:19px;font-weight:700}' +
      '#' + BOX_ID + ' .k499-more{display:block;margin:18px auto 0;padding:12px 28px;font:inherit;font-size:16px;font-weight:600;' +
        'background:transparent;color:inherit;border:1.5px solid currentColor;border-radius:999px;cursor:pointer}' +
      '#' + BOX_ID + ' .k499-card.k499-extra{display:none}' +
      '#' + BOX_ID + '.k499-open .k499-card.k499-extra{display:block}' +
      '#' + BOX_ID + '.k499-open .k499-more{display:none}' +
      '@media(max-width:767px){' +
        '#' + BOX_ID + '{margin:32px 0 28px}' +
        '#' + BOX_ID + ' .k499-t{font-size:21px}' +
        '#' + BOX_ID + ' .k499-row{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;' +
          'scrollbar-width:none;gap:8px}' +
        '#' + BOX_ID + ' .k499-row::-webkit-scrollbar{display:none}' +
        '#' + BOX_ID + ' .k499-card,#' + BOX_ID + ' .k499-card.k499-extra{display:block;flex:0 0 86%;scroll-snap-align:center}' +
        '#' + BOX_ID + ' .k499-more{display:none}' +
        '#' + BOX_ID + ' .k499-dots{display:flex;justify-content:center;gap:6px;margin-top:12px}' +
        '#' + BOX_ID + ' .k499-dots i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.25;transition:opacity .2s}' +
        '#' + BOX_ID + ' .k499-dots i.on{opacity:.85}' +
      '}' +
      '@media(min-width:768px){#' + BOX_ID + ' .k499-dots{display:none}}' +
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
  var DESKTOP_LIMIT = 6; // show this many on desktop, rest behind "عرض المزيد"

  function build(photos, galleryEl) {
    var box = document.createElement('div');
    box.id = BOX_ID;
    var ar = productAspect(galleryEl);
    if (ar) box.style.setProperty('--k499-ar', ar);
    var cards = photos.map(function (p, i) {
      var who = p.name ? '<b>' + esc(p.name) + '</b>' : '';
      var where = p.city ? esc(p.city) : '';
      var cap = who || where ? '<span class="k499-cap">' + who + where + '</span>' : '';
      return (
        '<button type="button" class="k499-card' + (i >= DESKTOP_LIMIT ? ' k499-extra' : '') + '" data-i="' + i + '" aria-label="صورة عميل ' + esc(p.name) + '">' +
        '<img loading="lazy" src="' + BASE + p.src + '" alt="' + esc((p.name || 'عميل') + ' ' + (p.city || '')) + '">' +
        cap + '</button>'
      );
    }).join('');
    box.innerHTML =
      '<div class="k499-h"><h3 class="k499-t">' + TITLE + '</h3><span class="k499-s">' + SUBTITLE + '</span></div>' +
      '<div class="k499-row">' + cards + '</div>' +
      (photos.length > 1 ? '<div class="k499-dots">' + photos.map(function (_p, i) { return '<i' + (i ? '' : ' class="on"') + '></i>'; }).join('') + '</div>' : '') +
      (photos.length > DESKTOP_LIMIT ? '<button type="button" class="k499-more">عرض المزيد (' + (photos.length - DESKTOP_LIMIT) + ')</button>' : '');

    // Phone carousel: light up the dot for the card in view.
    var row = box.querySelector('.k499-row');
    var dots = box.querySelectorAll('.k499-dots i');
    row.addEventListener('scroll', function () {
      var cards = row.children, mid = row.getBoundingClientRect().left + row.clientWidth / 2, best = 0, bestD = Infinity;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      for (var j = 0; j < dots.length; j++) dots[j].className = j === best ? 'on' : '';
    }, { passive: true });

    box.addEventListener('click', function (e) {
      if (e.target.closest('.k499-more')) { box.classList.add('k499-open'); return; }
      var card = e.target.closest('.k499-card');
      if (card) openLightbox(photos, Number(card.getAttribute('data-i')));
    });
    return box;
  }

  // Same shape as the store's own product photos (width / height of the first one).
  function productAspect(galleryEl) {
    var img = galleryEl && galleryEl.querySelector('img');
    if (!img) return '';
    var r = img.getBoundingClientRect();
    var w = r.width || img.naturalWidth, h = r.height || img.naturalHeight;
    if (!w || !h) return '';
    var ratio = w / h;
    if (ratio < 0.6 || ratio > 1.6) return ''; // ignore odd thumbnails; keep square
    return (Math.round(ratio * 1000) / 1000) + ' / 1';
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
    // Put the strip INSIDE the gallery column (appended at its end), so it stays
    // under the product photos. Inserting it as a sibling of the gallery lands it
    // in the title/price column on Ecwid's two-column product layout.
    for (var a = 0; a < ANCHORS.length; a++) {
      var el = document.querySelector(ANCHORS[a]);
      if (el) return { el: el, where: 'inside' };
    }
    for (var f = 0; f < FALLBACKS.length; f++) {
      var fb = document.querySelector(FALLBACKS[f]);
      if (fb) return { el: fb, where: 'before' };
    }
    return null;
  }

  var onProduct = false;
  var cachedPhotos = null;

  // The product page renders after OnPageLoaded fires in some themes, so retry briefly.
  function mount(tries) {
    getPhotos().then(function (photos) {
      if (!photos.length || !onProduct) return;
      cachedPhotos = photos;
      var old = document.getElementById(BOX_ID);
      if (old) old.remove();
      var anchor = findAnchor();
      if (!anchor) {
        if (tries < 20) setTimeout(function () { mount(tries + 1); }, 250);
        return;
      }
      injectStyles();
      var box = build(photos, anchor.where === 'inside' ? anchor.el : null);
      if (anchor.where === 'inside') anchor.el.appendChild(box);
      else anchor.el.insertAdjacentElement('beforebegin', box);
    });
  }

  // Ecwid re-renders the gallery (e.g. when a size/colour option changes) and can
  // wipe the strip; put it back if it disappears while we're on a product page.
  var watchTimer = null;
  new MutationObserver(function () {
    if (!onProduct || !cachedPhotos || document.getElementById(BOX_ID)) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(function () { if (!document.getElementById(BOX_ID)) mount(0); }, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });

  function init() {
    Ecwid.OnPageLoaded.add(function (page) {
      onProduct = page.type === 'PRODUCT';
      if (onProduct) mount(0);
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
