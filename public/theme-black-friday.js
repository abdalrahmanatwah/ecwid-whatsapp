/* 499K — Black Friday colours on top of the normal theme: black, red and
 * gold. Turn off with STORE_THEME=normal on Render (no code change). */
(function () {
  'use strict';
  if (window.__k499Theme) return;
  window.__k499Theme = true;
  var GATE = '__GATE__';
  if (GATE && !(location.search.indexOf(GATE) >= 0)) return;

  var RED = '#e5202e', GOLD = '#ffc83d', BLACK = '#0b0b0b';
  var css = [
    // Home page sections
    'section.ins-tile--announcement-bar{background:' + BLACK + ' !important;}',
    'section.ins-tile--announcement-bar *{color:' + GOLD + ' !important;}',
    'section.ins-tile--feature-list{background:' + RED + ' !important;}',
    'section.ins-tile--feature-list *{color:#fff !important;}',
    'section.ins-tile--category-products,section.ins-tile--video-list{background:' + BLACK + ' !important;}',
    '.ins-tile__title em,.ins-tile__title strong{color:' + GOLD + ' !important;}',
    // Product cards (home sections + store grid)
    '.ins-tile__product-current-price,.grid-product__price-value,.grid-product__price-amount{color:' + GOLD + ' !important;font-weight:700 !important;}',
    '.ins-tile__product-compare-price,.grid-product__price-compare{color:#8a8a8a !important;text-decoration:line-through !important;}',
    '.ins-tile__product-label--ribbon,.grid-product__label .label__text,.product-details__label .label__text{background:' + RED + ' !important;color:#fff !important;}',
    '.ins-tile__product-label--ribbon span{color:#fff !important;}',
    // Product page
    '.details-product-price__value,.product-details__product-price .details-product-price__value{color:' + RED + ' !important;}',
    '.details-product-purchase__add-to-bag .form-control__button,.details-product-purchase__add-buttons .form-control--primary .form-control__button{background:' + RED + ' !important;border-color:' + RED + ' !important;color:#fff !important;}',
    '.details-product-purchase__add-to-bag .form-control__button *{color:#fff !important;}',
    // Cart / checkout main button
    '.ec-cart__button--checkout .form-control__button,.ec-cart .form-control--primary .form-control__button{background:' + RED + ' !important;border-color:' + RED + ' !important;color:#fff !important;}',
  ].join('\n');

  function add() {
    if (document.getElementById('k499-theme-bf')) return;
    var s = document.createElement('style');
    s.id = 'k499-theme-bf';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  add();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
})();
