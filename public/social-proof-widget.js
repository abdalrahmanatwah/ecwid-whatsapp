/* 499K — "صور عملائنا" social proof strip under the product photos.
 * Served by /social-proof/widget.js; the server replaces the base URL below.
 * Loaded on the storefront by the 499K Ecwid app (storefront JS URL). */
(function () {
  'use strict';
  if (window.__k499SocialProof) return; // never load twice
  window.__k499SocialProof = true;

  var BASE = '__SOCIAL_PROOF_BASE__';
  // Copy — edit freely.
  var EYEBROW = 'REAL CUSTOMERS';
  var TITLE = 'شوفها على رجل عملائنا';
  var SUBTITLE = 'صور حقيقية من عملاء 499K بعد ما استلموا أوردراتهم';
  var CHIP = 'عميل 499K';
  // Sporty display face for Arabic + Latin headings (Google Fonts).
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=Changa:wght@500;600;700;800&display=swap';
  var FONT = "'Changa', inherit";
  var BOX_ID = 'k499-social-proof';

  // Where to put the strip, best match first. Ecwid's product page puts the
  // photos in .product-details__gallery; the others cover older/alternate layouts.
  var ANCHORS = ['.product-details__gallery', '.details-gallery', '.product-details-module__gallery'];
  var FALLBACKS = ['.product-details__description', '.product-details__product-description'];
  // On phones the page is one column (photos → title/price/options/description),
  // so the strip goes at the END of the details column, after the description.
  var MOBILE_ANCHORS = ['.product-details__sidebar', '.product-details-module__sidebar', '.product-details__product-description', '.product-details__description', '.product-details'];
  var mobileMQ = window.matchMedia('(max-width: 767px)');

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
    if (!document.getElementById('k499-sp-font')) {
      var lk = document.createElement('link');
      lk.id = 'k499-sp-font'; lk.rel = 'stylesheet'; lk.href = FONT_URL;
      document.head.appendChild(lk);
    }
    var css =
      // Sized to match the product photos: a 2-column grid of big tiles on desktop
      // (like Ecwid's 2-up gallery), a full-width swipe carousel on phones.
      '#' + BOX_ID + '{direction:rtl;margin:44px 0 36px;font-family:inherit;clear:both;width:100%;max-width:100%;box-sizing:border-box}' +
      // Heading: skewed black eyebrow tag, big condensed title with a speed stripe, quiet subtitle.
      '#' + BOX_ID + ' .k499-h{margin:0 0 20px;padding:0 3px;font-family:' + FONT + '}' +
      '#' + BOX_ID + ' .k499-e{display:inline-block;background:#111;color:#fff;font-size:12px;font-weight:700;' +
        'letter-spacing:.2em;padding:5px 12px 4px;transform:skewX(-12deg);margin:0 5px 12px;direction:ltr}' +
      '#' + BOX_ID + ' .k499-e span{display:inline-block;transform:skewX(12deg)}' +
      '#' + BOX_ID + ' .k499-t{font-family:' + FONT + ';font-size:34px;font-weight:800;line-height:1.1;margin:0;color:inherit;' +
        'letter-spacing:-.01em;display:flex;align-items:center;gap:12px}' +
      '#' + BOX_ID + ' .k499-t:after{content:"";flex:1;height:4px;min-width:40px;' +
        'background:repeating-linear-gradient(-60deg,currentColor 0 8px,transparent 8px 13px);opacity:.9}' +
      '#' + BOX_ID + ' .k499-s{display:block;margin-top:8px;font-size:16px;font-weight:500;opacity:.62}' +
      '#' + BOX_ID + ' .k499-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}' +
      '#' + BOX_ID + ' .k499-card{position:relative;border:0;padding:0;margin:0;width:100%;border-radius:0;overflow:hidden;' +
        'cursor:zoom-in;background:#eee;aspect-ratio:var(--k499-ar,1/1);display:block}' +
      '#' + BOX_ID + ' .k499-card img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s}' +
      '#' + BOX_ID + ' .k499-card:hover img{transform:scale(1.03)}' +
      '#' + BOX_ID + ' .k499-cap{position:absolute;inset:auto 0 0 0;padding:72px 16px 16px;color:#fff;font-family:' + FONT + ';' +
        'line-height:1.25;text-align:right;background:linear-gradient(transparent,rgba(0,0,0,.82))}' +
      '#' + BOX_ID + ' .k499-cap b{display:block;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}' +
      // Shoe model: white slanted label like a sneaker box tag.
      '#' + BOX_ID + ' .k499-shoe{display:inline-block;max-width:100%;background:#fff;color:#111;transform:skewX(-12deg);' +
        'padding:4px 10px 3px;margin:0 3px 10px;direction:ltr;box-shadow:3px 3px 0 rgba(0,0,0,.35)}' +
      '#' + BOX_ID + ' .k499-shoe span{display:block;transform:skewX(12deg);font-size:14px;font-weight:800;' +
        'text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + BOX_ID + ' .k499-city{display:flex;align-items:center;gap:5px;margin-top:4px;font-size:15px;font-weight:500;opacity:.9}' +
      '#' + BOX_ID + ' .k499-city svg{width:13px;height:13px;flex:none}' +
      '#' + BOX_ID + ' .k499-chip{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.94);color:#111;font-family:' + FONT + ';' +
        'font-size:12px;font-weight:700;padding:4px 10px;border-radius:2px;display:flex;align-items:center;gap:5px}' +
      '#' + BOX_ID + ' .k499-chip i{width:6px;height:6px;border-radius:50%;background:#1fbf5b;display:block}' +
      '#' + BOX_ID + ' .k499-more{display:block;margin:20px auto 0;padding:12px 32px;font-family:' + FONT + ';font-size:16px;font-weight:700;letter-spacing:.02em;' +
        'background:#111;color:#fff;border:0;border-radius:0;transform:skewX(-10deg);cursor:pointer}' +
      '#' + BOX_ID + ' .k499-card.k499-extra{display:none}' +
      '#' + BOX_ID + '.k499-open .k499-card.k499-extra{display:block}' +
      '#' + BOX_ID + '.k499-open .k499-more{display:none}' +
      '@media(max-width:767px){' +
        '#' + BOX_ID + '{margin:32px 0 28px}' +
        '#' + BOX_ID + ' .k499-t{font-size:27px}' +
        '#' + BOX_ID + ' .k499-s{font-size:14.5px}' +
        '#' + BOX_ID + ' .k499-cap b{font-size:20px}' +
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
      var pin = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
      var where = p.city ? '<span class="k499-city">' + pin + esc(p.city) + '</span>' : '';
      var shoe = p.shoe ? '<span class="k499-shoe"><span>' + esc(p.shoe) + '</span></span>' : '';
      var cap = who || where || shoe ? '<span class="k499-cap">' + shoe + who + where + '</span>' : '';
      return (
        '<button type="button" class="k499-card' + (i >= DESKTOP_LIMIT ? ' k499-extra' : '') + '" data-i="' + i + '" aria-label="صورة عميل ' + esc(p.name) + '">' +
        '<img loading="lazy" src="' + BASE + p.src + '" alt="' + esc((p.name || 'عميل') + ' ' + (p.city || '')) + '">' +
        '<span class="k499-chip"><i></i>' + CHIP + '</span>' + cap + '</button>'
      );
    }).join('');
    box.innerHTML =
      '<div class="k499-h"><div class="k499-e"><span>' + EYEBROW + '</span></div>' +
        '<h3 class="k499-t">' + TITLE + '</h3><span class="k499-s">' + SUBTITLE + '</span></div>' +
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
      cap.textContent = [p.shoe, p.name, p.city].filter(Boolean).join(' · ');
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
    if (mobileMQ.matches) {
      for (var m = 0; m < MOBILE_ANCHORS.length; m++) {
        var me = document.querySelector(MOBILE_ANCHORS[m]);
        if (me) return { el: me, where: /description/.test(MOBILE_ANCHORS[m]) ? 'after' : 'inside', gallery: document.querySelector(ANCHORS.join(',')) };
      }
    }
    // Put the strip INSIDE the gallery column (appended at its end), so it stays
    // under the product photos. Inserting it as a sibling of the gallery lands it
    // in the title/price column on Ecwid's two-column product layout.
    for (var a = 0; a < ANCHORS.length; a++) {
      var el = document.querySelector(ANCHORS[a]);
      if (el) return { el: el, where: 'inside', gallery: el };
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
      var box = build(photos, anchor.gallery || null);
      if (anchor.where === 'inside') anchor.el.appendChild(box);
      else if (anchor.where === 'after') anchor.el.insertAdjacentElement('afterend', box);
      else anchor.el.insertAdjacentElement('beforebegin', box);
    });
  }

  // Rotating a tablet / resizing across the phone breakpoint moves the strip.
  var onMQ = function () { if (onProduct) mount(0); };
  if (mobileMQ.addEventListener) mobileMQ.addEventListener('change', onMQ);
  else if (mobileMQ.addListener) mobileMQ.addListener(onMQ);

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
