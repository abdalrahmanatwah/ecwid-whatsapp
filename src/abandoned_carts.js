// abandoned_carts.js
// Polls Ecwid /carts every CART_CHECK_INTERVAL_MINUTES.
// Sends a WhatsApp "last piece" scarcity nudge ONLY when:
//   1. Cart has a phone number
//   2. Cart age is between MIN_AGE and MAX_AGE
//   3. At least one item in the cart has stock == 1 (genuine scarcity)
//   4. Customer has NOT already placed a real order for the same product+size
//   5. We haven't already messaged this cart before

import { getProduct } from './ecwid.js';
import { sendTemplate } from './whatsapp.js';
import { store } from './store.js';
import { normalizePhone } from './notify.js';

const STORE_ID   = process.env.ECWID_STORE_ID;
const TOKEN      = process.env.ECWID_API_TOKEN;
const TEMPLATE   = process.env.CART_TEMPLATE_NAME   || '';
const LANG       = process.env.CART_TEMPLATE_LANG   || 'ar';
const INTERVAL   = Number(process.env.CART_CHECK_INTERVAL_MINUTES ?? 30) * 60 * 1000;
const THRESHOLD  = Number(process.env.CART_LOW_STOCK_THRESHOLD ?? 1);
const MIN_AGE_MS = Number(process.env.CART_MIN_AGE_HOURS ?? 1) * 60 * 60 * 1000;
const MAX_AGE_MS = Number(process.env.CART_MAX_AGE_DAYS  ?? 3) * 24 * 60 * 60 * 1000;
const DEFAULT_CC = '20';
const DEBUG      = process.env.DEBUG === 'true';

let lastRun = 0;

// ─── Ecwid helpers ───────────────────────────────────────────────────────────

async function fetchCarts() {
  const url = `https://app.ecwid.com/api/v3/${STORE_ID}/carts?token=${TOKEN}&numResults=100`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Ecwid carts ${r.status}`);
  const data = await r.json();
  return data.items || [];
}

// Returns recent PAID/AWAITING_PROCESSING orders for a given phone number
async function fetchOrdersByPhone(phone) {
  const url = `https://app.ecwid.com/api/v3/${STORE_ID}/orders?token=${TOKEN}&customer=${encodeURIComponent(phone)}&paymentStatus=AWAITING_PAYMENT,PAID&fulfillmentStatus=AWAITING_PROCESSING,PROCESSING,SHIPPED&numResults=100`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return data.items || [];
}

function cartPhone(cart) {
  return cart?.shippingPerson?.phone
    || cart?.billingPerson?.phone
    || cart?.email
    || null;
}

// ─── Check if customer already ordered same product+size ─────────────────────

async function customerAlreadyOrdered(phone, productId, size) {
  try {
    const orders = await fetchOrdersByPhone(phone);
    for (const order of orders) {
      for (const item of order.items || []) {
        if (String(item.productId) !== String(productId)) continue;
        // Check size option
        const sizeOption = (item.selectedOptions || []).find(
          o => o.name?.toLowerCase() === 'size' || o.name?.toLowerCase() === 'مقاس'
        );
        const orderSize = sizeOption?.value ?? null;
        if (orderSize && String(orderSize) === String(size)) {
          if (DEBUG) console.log(`[cart][debug] customer ${phone} already ordered ${productId} size ${size} — skipping`);
          return true;
        }
      }
    }
  } catch (e) {
    console.warn(`[cart] order-check failed for ${phone}:`, e.message);
  }
  return false;
}

// ─── Find a genuinely scarce item in the cart ─────────────────────────────────

async function findLastPieceItem(cart) {
  for (const item of cart.items || []) {
    const productId = item.productId;
    if (!productId) continue;

    // Get real stock from Ecwid
    let product;
    try {
      product = await getProduct(productId);
    } catch {
      continue;
    }

    // Find the size option the customer selected
    const sizeOption = (item.selectedOptions || []).find(
      o => o.name?.toLowerCase() === 'size' || o.name?.toLowerCase() === 'مقاس'
    );
    const selectedSize = sizeOption?.value ?? null;

    if (!selectedSize) {
      // No size variation — check top-level stock
      const qty = product?.quantity ?? null;
      if (qty === THRESHOLD) {
        return { name: product.name, size: '—', qty };
      }
      continue;
    }

    // Find the matching variation
    const variation = (product?.combinations || []).find(c => {
      const opt = (c.options || []).find(
        o => o.name?.toLowerCase() === 'size' || o.name?.toLowerCase() === 'مقاس'
      );
      return opt && String(opt.value) === String(selectedSize);
    });

    if (!variation) continue;

    const qty = variation.quantity ?? null;
    if (qty === null || qty <= 0) continue; // sold out — don't lie
    if (qty === THRESHOLD) {
      return { name: product.name, size: selectedSize, qty, productId };
    }
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function checkAbandonedCarts() {
  if (!TEMPLATE) return; // feature disabled
  if (Date.now() - lastRun < INTERVAL) return; // too soon
  lastRun = Date.now();

  let carts;
  try {
    carts = await fetchCarts();
  } catch (e) {
    console.warn('[cart] fetch failed:', e.message);
    return;
  }

  const messaged = store.getMeta('cartOffers') || {};

  for (const cart of carts) {
    const cartId = cart.id;
    if (!cartId) continue;

    // Already messaged this cart
    if (messaged[cartId]) {
      if (DEBUG) console.log(`[cart][debug] ${cartId}: already messaged — skipped`);
      continue;
    }

    // Age check
    const created = cart.createDate ? new Date(cart.createDate).getTime() : null;
    const age = created != null ? Date.now() - created : null;
    if (age == null || age < MIN_AGE_MS || age > MAX_AGE_MS) continue;

    // Phone check
    const phone = normalizePhone(cartPhone(cart), DEFAULT_CC);
    if (!phone) {
      if (DEBUG) console.log(`[cart][debug] ${cartId}: no phone — skipped`);
      continue;
    }

    // Find scarce item
    const hit = await findLastPieceItem(cart);
    if (!hit) continue;

    // ✅ NEW: Check if customer already placed an order for this product+size
    const alreadyOrdered = await customerAlreadyOrdered(phone, hit.productId, hit.size);
    if (alreadyOrdered) {
      if (DEBUG) console.log(`[cart][debug] ${cartId}: customer already ordered ${hit.name} size ${hit.size} — skipped`);
      continue;
    }

    // Send WhatsApp message
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
