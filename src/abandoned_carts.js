// Abandoned-cart "last piece" recovery (scarcity, no discount).
//
// Periodically pulls abandoned carts from Ecwid and, for each one:
//   • skips it if there's no phone number (can't WhatsApp them),
//   • skips it if we already messaged it, or it's too new / too old,
//   • checks the REAL stock of the cart's size in Ecwid,
//   • and only messages when that size is genuinely down to the last piece(s).
// Truthful scarcity → few, relevant messages → no margin lost, low spam risk.
// Never throws.

import { searchAbandonedCarts, getProduct } from './ecwid.js';
import { sendTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { store } from './store.js';

const TEMPLATE = process.env.CART_TEMPLATE_NAME || '';
const LANG = process.env.CART_TEMPLATE_LANG || process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '20';
const CHECK_EVERY_MS = Number(process.env.CART_CHECK_INTERVAL_MINUTES || 30) * 60_000;
const THRESHOLD = Number(process.env.CART_LOW_STOCK_THRESHOLD || 1); // "last piece" = 1
const MIN_AGE_MS = Number(process.env.CART_MIN_AGE_HOURS || 1) * 3_600_000;
const MAX_AGE_MS = Number(process.env.CART_MAX_AGE_DAYS || 3) * 86_400_000;
const DEBUG = process.env.CART_DEBUG === 'true';

const cartPhone = (cart) =>
  cart.billingPerson?.phone || cart.shippingPerson?.phone || cart.phone || cart.contactPhone || '';

function cartCreatedMs(cart) {
  if (cart.createTimestamp) return Number(cart.createTimestamp) * 1000;
  if (cart.createDate) return Date.parse(cart.createDate);
  if (cart.updateTimestamp) return Number(cart.updateTimestamp) * 1000;
  return null;
}

// Find the lowest-stock tracked item in a cart whose size is at/below threshold.
// Returns { name, size, qty } or null. Stock comes from the product's matching combination.
async function findLastPieceItem(cart) {
  const items = Array.isArray(cart.items) ? cart.items : [];
  for (const it of items) {
    if (!it.productId) continue;
    let product;
    try { product = await getProduct(it.productId); }
    catch (e) { console.warn(`[cart] couldn't read product ${it.productId}:`, e.message); continue; }

    const opts = Array.isArray(it.selectedOptions) ? it.selectedOptions : [];
    const combos = Array.isArray(product.combinations) ? product.combinations : [];
    let combo = null;
    if (it.combinationId) combo = combos.find((c) => c.id === it.combinationId) || null;
    if (!combo && opts.length) {
      combo = combos.find((c) =>
        opts.every((so) => (c.options || []).some((o) => o.name === so.name && String(o.value) === String(so.value)))
      ) || null;
    }
    const qty = combo ? combo.quantity : product.quantity; // null/undefined ⇒ unlimited
    const size = (opts.find((o) => /size|مقاس/i.test(o.name)) || opts[0])?.value || '';
    if (DEBUG) console.log(`[cart][debug] item "${it.name}" size=${size} combo=${combo ? combo.id : 'none'} qty=${qty}`);
    if (qty != null && qty >= 1 && qty <= THRESHOLD) {
      return { name: product.name || it.name, size, qty };
    }
  }
  return null;
}

export async function checkAbandonedCarts() {
  if (!TEMPLATE) return; // feature off until a template is configured
  if (Date.now() - Number(store.getMeta('lastCartCheck') || 0) < CHECK_EVERY_MS) return;
  store.setMeta('lastCartCheck', Date.now());

  let carts;
  try {
    carts = await searchAbandonedCarts(Math.floor((Date.now() - MAX_AGE_MS) / 1000));
  } catch (e) {
    console.warn('[cart] search failed:', e.message);
    return;
  }
  const messaged = store.getMeta('cartOffers') || {};
  if (DEBUG) console.log(`[cart][debug] ${carts.length} abandoned carts pulled`);

  for (const cart of carts) {
    const cartId = cart.id || cart.cartId;
    if (!cartId || messaged[cartId]) continue;

    const created = cartCreatedMs(cart);
    const age = created ? Date.now() - created : null;
    if (age == null || age < MIN_AGE_MS || age > MAX_AGE_MS) continue;

    const phone = normalizePhone(cartPhone(cart), DEFAULT_CC);
    if (!phone) {
      if (DEBUG) console.log(`[cart][debug] ${cartId}: no phone — skipped`);
      continue;
    }

    const hit = await findLastPieceItem(cart);
    if (!hit) continue; // nothing genuinely low — say nothing

    try {
      await sendTemplate(phone, TEMPLATE, LANG, [String(hit.name), String(hit.size)]);
      messaged[cartId] = new Date().toISOString();
      store.setMeta('cartOffers', messaged);
      console.log(`[cart] last-piece nudge sent to ${phone} — ${hit.name} (size ${hit.size}, ${hit.qty} left)`);
    } catch (e) {
      console.warn(`[cart] send failed for ${cartId}:`, e.message);
    }
  }
}
