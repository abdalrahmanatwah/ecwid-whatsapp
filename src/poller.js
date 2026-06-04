// Polls Ecwid for newly placed orders (no webhook needed) and sends each one
// the WhatsApp Confirm/Cancel poll. Idempotency is handled by the store, so an
// order is never messaged twice. Failed sends are tracked and retried every
// cycle until they succeed or hit a safety cap.

import { searchOrders, getOrder, extractOrderInfo } from './ecwid.js';
import { sendPollTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { store } from './store.js';
import { shipOrderViaBosta } from './shipping.js';
import { checkDeliveryStatuses } from './followups.js';
import { watchBostaDeliveries } from './bosta_watch.js';

const COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '20';
const SHIP_DELAY_MS = Number(process.env.SHIP_DELAY_MINUTES || 60) * 60_000;
const OVERLAP_SEC = 120;            // re-scan a little into the past when discovering new orders
const MAX_RETRY_HOURS = Number(process.env.MAX_RETRY_HOURS || 24); // stop retrying a stuck order after this

const nowUnix = () => Math.floor(Date.now() / 1000);

// Try to send the poll for one order. Records the outcome in the store.
// Returns true on success. `isRetry` only affects logging.
async function attemptSend(orderId, prev = {}, isRetry = false) {
  try {
    const order = await getOrder(orderId);
    const { phone, orderNumber, total, products } = extractOrderInfo(order);

    const to = normalizePhone(phone, COUNTRY);
    if (!to) {
      console.warn(`[poll] order ${orderId} has no usable phone, skipping`);
      store.upsert(orderId, { status: 'no_phone', orderNumber });
      return false;
    }

    await sendPollTemplate(to, { products, total, orderId });
    store.upsert(orderId, { status: 'poll_sent', to, orderNumber });
    console.log(`[poll] ${isRetry ? 'retry succeeded' : 'poll sent'} for order ${orderId} to ${to}`);
    return true;
  } catch (err) {
    const attempts = (prev.attempts || 0) + 1;
    store.upsert(orderId, {
      status: 'send_failed',
      attempts,
      // keep the first-failure timestamp so the cap is measured from the start
      firstFailedAt: prev.firstFailedAt || new Date().toISOString(),
      lastError: err.message,
    });
    console.error(`[poll] send failed for order ${orderId} (attempt ${attempts}):`, err.message);
    return false;
  }
}

async function pollOnce() {
  let lastCheck = store.getMeta('lastCheckUnix');

  // First ever run: remember "now" and do NOT message pre-existing orders.
  if (!lastCheck) {
    store.setMeta('lastCheckUnix', nowUnix());
    console.log('[poll] initialized — will handle orders placed from now on');
    return;
  }

  // 1) Discover newly placed orders (narrow window so we never touch old orders).
  const createdFrom = lastCheck - OVERLAP_SEC;
  const orders = await searchOrders(createdFrom);

  for (const summary of orders) {
    const orderId = String(summary.id ?? summary.orderId ?? summary.orderNumber);
    if (!orderId || orderId === 'undefined') continue;
    if (store.has(orderId)) continue; // already seen (sent, failed, no_phone, etc.)
    await attemptSend(orderId, {}, false);
  }

  // Advance the discovery cursor now that new orders are recorded.
  store.setMeta('lastCheckUnix', nowUnix());

  // 2) Retry every order still stuck in "send_failed", until it works or ages out.
  for (const rec of store.list()) {
    if (rec.status !== 'send_failed') continue;

    const startedAt = new Date(rec.firstFailedAt || rec.updatedAt || Date.now()).getTime();
    const ageHours = (Date.now() - startedAt) / 3_600_000;
    if (ageHours > MAX_RETRY_HOURS) {
      store.upsert(rec.orderId, { status: 'send_failed_giveup' });
      console.warn(`[poll] giving up on order ${rec.orderId} after ${MAX_RETRY_HOURS}h (${rec.attempts} attempts)`);
      continue;
    }
    await attemptSend(rec.orderId, rec, true);
  }

  // 3) Ship confirmed single-product orders once the grace period has passed.
  //    Orders cancelled during the window are no longer 'confirmed', so skipped.
  for (const rec of store.list()) {
    if (rec.status !== 'confirmed' || !rec.confirmedAt) continue;
    const age = Date.now() - new Date(rec.confirmedAt).getTime();
    if (age >= SHIP_DELAY_MS) {
      await shipOrderViaBosta(rec.orderId);
    }
  }

  // 4) Check Bosta delivery status of shipped orders and send the post-delivery
  //    follow-up messages (delivered offer / return reason). Self-throttled.
  await checkDeliveryStatuses();

  // 5) Watch-only mode: for merchants shipping manually (AUTO_SHIP off), poll
  //    Bosta deliveries and send the same follow-ups. Self-throttled; no-op
  //    unless BOSTA_WATCH=true.
  await watchBostaDeliveries();
}

export function startPolling(intervalSec) {
  const ms = Math.max(15, intervalSec) * 1000;
  const tick = () =>
    pollOnce().catch((err) => console.error('[poll] cycle error:', err.message));
  tick(); // run immediately on boot
  setInterval(tick, ms);
  console.log(`[poll] polling Ecwid every ${ms / 1000}s`);
}
