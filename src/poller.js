// Polls Ecwid for newly placed orders (no webhook needed) and sends each one
// the WhatsApp Confirm/Cancel poll. Idempotency is handled by the store, so an
// order is never messaged twice even though we re-query with a time overlap.

import { searchOrders, getOrder, extractOrderInfo } from './ecwid.js';
import { sendPollTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { store } from './store.js';

const COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '20';
const OVERLAP_SEC = 120; // re-scan a little into the past so nothing slips through

const nowUnix = () => Math.floor(Date.now() / 1000);

async function pollOnce() {
  let lastCheck = store.getMeta('lastCheckUnix');

  // First ever run: remember "now" and do NOT message pre-existing orders.
  if (!lastCheck) {
    store.setMeta('lastCheckUnix', nowUnix());
    console.log('[poll] initialized — will handle orders placed from now on');
    return;
  }

  const createdFrom = lastCheck - OVERLAP_SEC;
  const orders = await searchOrders(createdFrom);

  for (const summary of orders) {
    const orderId = String(summary.id ?? summary.orderId ?? summary.orderNumber);
    if (!orderId || orderId === 'undefined') continue;
    if (store.has(orderId)) continue; // already polled

    try {
      // The search result already has most fields, but fetch the full order to be safe.
      const order = await getOrder(orderId);
      const { phone, name, orderNumber, total, products } = extractOrderInfo(order);

      const to = normalizePhone(phone, COUNTRY);
      if (!to) {
        console.warn(`[poll] order ${orderId} has no usable phone, skipping`);
        store.upsert(orderId, { status: 'no_phone', orderNumber });
        continue;
      }

      await sendPollTemplate(to, { products, total, orderId });
      store.upsert(orderId, { status: 'poll_sent', to, orderNumber });
      console.log(`[poll] poll sent for order ${orderId} to ${to}`);
    } catch (err) {
      console.error(`[poll] failed for order ${orderId}:`, err.message);
    }
  }

  store.setMeta('lastCheckUnix', nowUnix());
}

export function startPolling(intervalSec) {
  const ms = Math.max(15, intervalSec) * 1000;
  const tick = () =>
    pollOnce().catch((err) => console.error('[poll] cycle error:', err.message));
  tick(); // run immediately on boot
  setInterval(tick, ms);
  console.log(`[poll] polling Ecwid every ${ms / 1000}s`);
}
