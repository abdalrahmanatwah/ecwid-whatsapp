// abandoned_carts.js
// Polls Ecwid /carts every CART_CHECK_INTERVAL_MINUTES and sends EVERY abandoned
// cart (that has a phone number) one WhatsApp template with two quick-reply
// buttons:
//   ✅ تأكيد الأوردر + هدية فرش طبي مجاناً   → payload CART_CONFIRM_<cartId>
//   ❌ إلغاء الأوردر                          → payload CART_CANCEL_<cartId>
//
// When the customer taps a button, server.js must call handleCartButton(payload, from)
// (exported below). CONFIRM places the abandoned cart as a real Ecwid order,
// notes the free gift on it, and hands it to the normal pipeline (auto-ship /
// tracking). CANCEL just closes the offer.
//
// A cart is skipped when:
//   - it has no phone number, or it's older/younger than the age window
//   - it was already recovered (an order exists for it)
//   - the same phone already has an active order in the store
//   - we already messaged it (or failed 3 times)

import { extractOrderInfo, updateOrder } from './ecwid.js';
import { sendTemplateWithButtons, sendText } from './whatsapp.js';
import { store } from './store.js';
import { normalizePhone } from './phone.js';
import { notifyMerchant } from './notify.js';

const STORE_ID   = process.env.ECWID_STORE_ID;
const TOKEN      = process.env.ECWID_API_TOKEN;
const BASE       = `https://app.ecwid.com/api/v3/${STORE_ID}`;

const TEMPLATE   = process.env.CART_TEMPLATE_NAME || '';   // empty = feature disabled
const LANG       = process.env.CART_TEMPLATE_LANG || 'ar';
const INTERVAL   = Number(process.env.CART_CHECK_INTERVAL_MINUTES ?? 30) * 60_000;
const MIN_AGE_MS = Number(process.env.CART_MIN_AGE_HOURS ?? 1) * 3_600_000;
const MAX_AGE_MS = Number(process.env.CART_MAX_AGE_DAYS ?? 3) * 86_400_000;
const MAX_PER_RUN = Number(process.env.CART_MAX_PER_RUN ?? 30);   // safety cap per cycle
const SEND_GAP_MS = Number(process.env.CART_SEND_GAP_MS ?? 1500); // pause between sends
const MAX_ATTEMPTS = 3;
const COUNTRY    = process.env.DEFAULT_COUNTRY_CODE || '20';
// TEST MODE: when set, offers go ONLY to this phone number (everyone else is
// skipped). Leave empty in production to send to all abandoned carts.
const ONLY_PHONE = normalizePhone(process.env.CART_ONLY_PHONE || '', process.env.DEFAULT_COUNTRY_CODE || '20');
const DEBUG      = process.env.DEBUG === 'true';
const GIFT_NOTE  = process.env.CART_GIFT_NOTE || '🎁 هدية مع الأوردر: فرش طبي مجاناً (عرض السلة المتروكة) — لا تنسَ إضافته في الشحنة';

// Statuses of orders in the store that mean "this customer already has a live order".
const ACTIVE_ORDER_STATUSES = new Set(['poll_sent', 'confirmed', 'confirmed_noship', 'tracking', 'ship_failed']);

let lastRun = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Ecwid helper (Bearer header, same as ecwid.js) ──────────────────────────
// Throws with the response body included, so a 403 explains itself in the logs.
async function ecwid(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ecwid ${opts.method || 'GET'} ${path.split('?')[0]} → ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchCarts() {
  const from = Math.floor((Date.now() - MAX_AGE_MS) / 1000);
  const data = await ecwid(`/carts?limit=100&showHidden=false&createdFrom=${from}`);
  return data.items || [];
}

// ─── Offer bookkeeping (kept in store meta) ──────────────────────────────────
// cartOffers: { [cartId]: { status, sentAt, phone, attempts, orderId } }
// status: sent | confirmed | cancelled | failed | confirm_failed
function loadOffers() {
  const raw = store.getMeta('cartOffers') || {};
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    // older versions stored just an ISO string
    out[id] = typeof v === 'string' ? { status: 'sent', sentAt: v } : v;
  }
  return out;
}
const saveOffers = (o) => store.setMeta('cartOffers', o);

// ─── Small helpers ───────────────────────────────────────────────────────────
const cartIdOf = (cart) => cart?.cartId || cart?.id || null;

function cartPhone(cart) {
  return cart?.shippingPerson?.phone || cart?.billingPerson?.phone || null;
}

function hasActiveOrder(phone) {
  return store.list().some((r) => r.to === phone && ACTIVE_ORDER_STATUSES.has(r.status));
}

function hasShippingAddress(cart) {
  const s = cart?.shippingPerson || {};
  return Boolean(s.street && (s.city || s.stateOrProvinceName));
}

// ─── Main: send the offer to every abandoned cart ────────────────────────────
export async function checkAbandonedCarts() {
  if (!TEMPLATE) {                              // feature disabled
    if (!globalThis.__cartDisabledLogged) {
      globalThis.__cartDisabledLogged = true;
      console.log('[cart] disabled — CART_TEMPLATE_NAME is empty');
    }
    return;
  }
  if (Date.now() - lastRun < INTERVAL) return;  // too soon
  lastRun = Date.now();

  let carts;
  try {
    carts = await fetchCarts();
  } catch (e) {
    console.warn('[cart] fetch failed:', e.message);
    return;
  }

  const offers = loadOffers();

  // Offers that FAILED (e.g. template name/language was wrong) are retried
  // automatically once the template name or language changes. You can also
  // force it by setting CART_RESET_FAILED=true (remove it afterwards, otherwise
  // failed carts are retried on every cycle).
  const sig = `${TEMPLATE}|${LANG}`;
  if (process.env.CART_RESET_FAILED === 'true' || store.getMeta('cartTemplateSig') !== sig) {
    let n = 0;
    for (const [id, o] of Object.entries(offers)) {
      if (o.status === 'failed') { delete offers[id]; n++; }
    }
    if (n) {
      saveOffers(offers);
      console.log(`[cart] reset ${n} failed offer(s) — they will be retried`);
    }
    store.setMeta('cartTemplateSig', sig);
  }

  let sent = 0;
  const skip = { handled: 0, recovered: 0, noItems: 0, ageWindow: 0, noPhone: 0, testMode: 0, activeOrder: 0 };
  const handledBy = {};      // breakdown of the already-handled carts by their stored status
  let sampleError = '';      // last stored send error, if any, to explain failures

  // One-time hint about which fields Ecwid actually returns for a cart
  // (keys only — no customer data), so a missing phone is easy to diagnose.
  if (carts.length && !globalThis.__cartShapeLogged) {
    globalThis.__cartShapeLogged = true;
    const c = carts[0];
    console.log('[cart] sample cart keys:', Object.keys(c).join(','),
      '| shippingPerson keys:', Object.keys(c.shippingPerson || {}).join(',') || '(none)',
      '| billingPerson keys:', Object.keys(c.billingPerson || {}).join(',') || '(none)');
  }

  for (const cart of carts) {
    const cartId = cartIdOf(cart);
    if (!cartId) continue;

    const prev = offers[cartId];
    if (prev && (prev.status !== 'failed' || (prev.attempts || 0) >= MAX_ATTEMPTS)) {
      skip.handled++;
      handledBy[prev.status] = (handledBy[prev.status] || 0) + 1;
      if (prev.lastError && !sampleError) sampleError = prev.lastError;
      continue;
    }

    // Already recovered into a real order
    // Ecwid sets `recoveredOrderId` only when the cart was already turned into an order
    if (cart.recoveredOrderId || cart.orderId || cart.order?.id) { skip.recovered++; continue; }

    const items = Array.isArray(cart.items) ? cart.items : [];
    if (!items.length) { skip.noItems++; continue; }

    // Age window
    const createdRaw = cart.createDate || cart.updateDate;
    const created = createdRaw ? new Date(createdRaw).getTime() : NaN;
    const age = Date.now() - created;
    if (!Number.isFinite(age) || age < MIN_AGE_MS || age > MAX_AGE_MS) { skip.ageWindow++; continue; }

    // Phone
    const phone = normalizePhone(cartPhone(cart), COUNTRY);
    if (!phone) {
      skip.noPhone++;
      if (DEBUG) console.log(`[cart][debug] ${cartId}: no phone — skipped`);
      continue;
    }

    // Test mode: only the designated phone gets an offer
    if (ONLY_PHONE && phone !== ONLY_PHONE) { skip.testMode++; continue; }

    // Customer already has a live order → don't nag
    if (!ONLY_PHONE && hasActiveOrder(phone)) {
      skip.activeOrder++;
      if (DEBUG) console.log(`[cart][debug] ${cartId}: ${phone} already has an active order — skipped`);
      continue;
    }

    if (sent >= MAX_PER_RUN) break; // rest goes out next cycle

    const { products } = extractOrderInfo({ items });

    try {
      await sendTemplateWithButtons(phone, TEMPLATE, LANG, {
        bodyParams: [products],
        buttonPayloads: [`CART_CONFIRM_${cartId}`, `CART_CANCEL_${cartId}`],
      });
      offers[cartId] = { status: 'sent', sentAt: new Date().toISOString(), phone };
      saveOffers(offers);
      sent++;
      console.log(`[cart] offer sent to ${phone} for cart ${cartId}`);
      await sleep(SEND_GAP_MS);
    } catch (e) {
      const attempts = (prev?.attempts || 0) + 1;
      offers[cartId] = { status: 'failed', phone, attempts, lastError: e.message.slice(0, 200) };
      saveOffers(offers);
      console.warn(`[cart] send failed for ${cartId} (attempt ${attempts}):`, e.message);
      if (/132001|132000|132012|132015/.test(e.message)) {
        console.warn(`[cart] hint: check the template name "${TEMPLATE}" AND its language code "${LANG}" (CART_TEMPLATE_LANG) exactly as shown in WhatsApp Manager, and that its status is Active.`);
      }
    }
  }

  // Always log a summary, so a quiet cycle is explained instead of silent.
  console.log(
    `[cart] cycle done — ${carts.length} cart(s) fetched, ${sent} offer(s) sent | skipped:`,
    JSON.stringify(skip),
    ONLY_PHONE ? `| TEST MODE (only ${ONLY_PHONE})` : ''
  );
  if (skip.handled) console.log('[cart] already-handled breakdown:', JSON.stringify(handledBy), sampleError ? `| last error: ${sampleError}` : '');
}

// ─── Button handler — call this from server.js's WhatsApp webhook ────────────
// Returns true if the payload was a cart button (handled), false otherwise.
export async function handleCartButton(payload, from) {
  const m = /^CART_(CONFIRM|CANCEL)_(.+)$/.exec(String(payload || ''));
  if (!m) return false;
  const [, action, cartId] = m;

  const offers = loadOffers();
  const offer = offers[cartId] || {};
  const phone = offer.phone || normalizePhone(from, COUNTRY) || from;

  // Double-tap protection
  if (offer.status === 'confirmed' || offer.status === 'cancelled') {
    try {
      await sendText(phone, offer.status === 'confirmed'
        ? 'طلبك اتأكد قبل كده ✅ هيتواصل معاك المندوب قريب.'
        : 'الطلب ده اتلغى قبل كده. لو حابب تطلب تاني كلمنا في أي وقت 🌷');
    } catch { /* ignore */ }
    return true;
  }

  // ── Cancel ──
  if (action === 'CANCEL') {
    offers[cartId] = { ...offer, status: 'cancelled', respondedAt: new Date().toISOString() };
    saveOffers(offers);
    try { await sendText(phone, 'تمام، تم إلغاء الطلب. لو غيّرت رأيك إحنا في خدمتك دايماً 🌷'); }
    catch (e) { console.warn(`[cart] cancel reply failed for ${cartId}:`, e.message); }
    console.log(`[cart] cart ${cartId} cancelled by customer ${phone}`);
    return true;
  }

  // ── Confirm: place the abandoned cart as a real order ──
  try {
    const cart = await ecwid(`/carts/${encodeURIComponent(cartId)}`);
    const placed = await ecwid(`/carts/${encodeURIComponent(cartId)}/place`, { method: 'POST' });
    const orderId = String(placed.id ?? placed.orderId ?? '');
    if (!orderId) throw new Error(`place returned no order id: ${JSON.stringify(placed).slice(0, 150)}`);

    const orderNumber = placed.orderNumber || placed.vendorOrderNumber || orderId;
    const addressOk = hasShippingAddress(cart);

    // Register in the store FIRST so the poller never sends this order the
    // Confirm/Cancel poll again. 'confirmed' → auto-ship picks it up after the
    // grace window; 'confirmed_noship' → waits for a manual tracking number.
    store.upsert(orderId, {
      status: addressOk ? 'confirmed' : 'confirmed_noship',
      to: phone,
      orderNumber,
      confirmedAt: new Date().toISOString(),
      fromCart: true,
      gift: 'orthopedic-insole',
    });

    offers[cartId] = { ...offer, status: 'confirmed', orderId, respondedAt: new Date().toISOString() };
    saveOffers(offers);

    try { await updateOrder(orderId, { privateAdminNotes: GIFT_NOTE }); }
    catch (e) { console.warn(`[cart] couldn't write gift note on order ${orderId}:`, e.message); }

    try {
      await sendText(phone, addressOk
        ? 'تم تأكيد أوردرك ✅ ومعاه هدية فرش طبي مجاناً 🎁 هيتواصل معاك المندوب قريب.'
        : 'تم تأكيد أوردرك ✅ ومعاه هدية فرش طبي مجاناً 🎁 ابعتلنا العنوان بالتفصيل (المحافظة والمنطقة والشارع) عشان نشحنلك.');
    } catch (e) { console.warn(`[cart] confirm reply failed for ${cartId}:`, e.message); }

    await notifyMerchant(
      `🛒✅ أوردر من سلة متروكة #${orderNumber} (${phone}) — العميل أكد + هدية فرش طبي.` +
      (addressOk ? '' : ' ⚠️ العنوان ناقص — لازم تكلمه وتضيفه يدوياً.')
    );
    console.log(`[cart] cart ${cartId} confirmed → order ${orderId} (${addressOk ? 'ready to ship' : 'address missing'})`);
  } catch (e) {
    console.warn(`[cart] confirm failed for cart ${cartId}:`, e.message);
    offers[cartId] = { ...offer, status: 'confirm_failed', lastError: e.message.slice(0, 200) };
    saveOffers(offers);
    try { await sendText(phone, 'وصلنا طلبك ✅ هنتواصل معاك خلال دقائق لتأكيد التفاصيل والهدية 🎁'); }
    catch { /* ignore */ }
    await notifyMerchant(`🛒⚠️ عميل (${phone}) ضغط تأكيد على سلة ${cartId} لكن إنشاء الأوردر فشل (${e.message.slice(0, 120)}) — كلمه يدوياً.`);
  }
  return true;
}
