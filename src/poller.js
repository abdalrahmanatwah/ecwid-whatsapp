// Polls Ecwid for newly placed orders (no webhook needed) and sends each one
// the WhatsApp Confirm/Cancel poll. Idempotency is handled by the store, so an
// order is never messaged twice. Failed sends are tracked and retried every
// cycle until they succeed or hit a safety cap.

import { searchOrders, getOrder, extractOrderInfo } from './ecwid.js';
import { sendPollTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { store } from './store.js';
import { trackFromEcwid } from './ecwid_tracking.js';
import { checkAbandonedCarts } from './abandoned_carts.js';
import { autoShipOrder } from './auto_ship.js';
import { notifyMerchant } from './notify.js';

const COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '20';
const OVERLAP_SEC = 120;            // re-scan a little into the past when discovering new orders
const MAX_RETRY_HOURS = Number(process.env.MAX_RETRY_HOURS || 24); // stop retrying a stuck order after this
const AUTO_SHIP = String(process.env.AUTO_SHIP ?? 'true').toLowerCase() !== 'false';
const SHIP_DELAY_MIN = Number(process.env.SHIP_DELAY_MIN || 15); // grace window after confirm

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

  // 3) Auto-ship: confirmed orders past their grace window, shipped via Bosta
  //    automatically — unless something about the order makes that unsafe to do
  //    blind, in which case it's left exactly where the fully-manual flow leaves
  //    it (status 'ship_failed', which the bridge below already knows to treat
  //    as "waiting for someone to paste a tracking number").
  if (AUTO_SHIP) {
    for (const rec of store.list()) {
      if (rec.status !== 'confirmed') continue;
      const elapsedMin = (Date.now() - new Date(rec.confirmedAt || 0).getTime()) / 60_000;
      if (elapsedMin < SHIP_DELAY_MIN) continue; // still inside the cancellation window

      try {
        const { trackingNumber } = await autoShipOrder(rec.orderId);
        store.upsert(rec.orderId, {
          status: 'tracking',
          bostaTracking: trackingNumber,
          trackingFoundAt: new Date().toISOString(),
        });
        await notifyMerchant(`🚚 Order ${rec.orderId} auto-shipped via Bosta — tracking ${trackingNumber}.`);
        console.log(`[autoship] order ${rec.orderId} shipped, tracking ${trackingNumber}`);
      } catch (err) {
        store.upsert(rec.orderId, { status: 'ship_failed', shipError: err.message });
        await notifyMerchant(`⚠️ Order ${rec.orderId} auto-ship skipped (${err.message}) — needs a manual tracking number.`);
        console.warn(`[autoship] order ${rec.orderId} not shipped: ${err.message}`);
      }
    }
  }

  // 4) Bridge: pick up Bosta tracking numbers (auto-ship above, or pasted in
  //    manually) and poll their delivery status to send Delivered/Exception messages.
  await trackFromEcwid();

  // 5) Abandoned-cart "last piece" nudges (self-throttled to its own interval).
  await checkAbandonedCarts();
}

export function startPolling(intervalSec) {
  const ms = Math.max(15, intervalSec) * 1000;
  const tick = () =>
    pollOnce().catch((err) => console.error('[poll] cycle error:', err.message));
  tick(); // run immediately on boot
  setInterval(tick, ms);
  console.log(`[poll] polling Ecwid every ${ms / 1000}s`);
}
