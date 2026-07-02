// Ecwid → Bosta tracking bridge (for manual shipping).
//
// You create the Bosta shipment yourself and put its tracking number on the
// Ecwid order. This watches your confirmed (Processing) orders, picks up that
// tracking number from Ecwid, then polls Bosta for the delivery's status and
// sends the follow-up messages:
//   Delivered → 100 EGP photo offer
//   Exception → rejection-reason (size fix, etc.)
//
// Two throttled phases per order, and it gives up after a cap so it never polls
// forever. Never throws.

import { getOrder, updateOrder, adjustInventory } from './ecwid.js';
import { getDeliveryState, bostaConfigured } from './bosta.js';
import { sendTemplate } from './whatsapp.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const DELIVERED_TEMPLATE = process.env.DELIVERED_TEMPLATE_NAME || '';
const REJECTED_TEMPLATE = process.env.REJECTED_TEMPLATE_NAME || '';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const LOOK_EVERY_MS = Number(process.env.TRACK_LOOK_INTERVAL_MINUTES || 10) * 60_000;
const STATUS_EVERY_MS = Number(process.env.BOSTA_STATUS_INTERVAL_MINUTES || 20) * 60_000;
const LOOK_MAX_DAYS = Number(process.env.TRACK_LOOK_MAX_DAYS || 14); // stop waiting for a tracking number
const STATUS_MAX_DAYS = Number(process.env.FOLLOWUP_MAX_DAYS || 21); // stop polling status
const DELIVERED_STATUS = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const RETURNED_STATUS = process.env.RETURNED_FULFILLMENT_STATUS || 'RETURNED';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const CANCEL_FULFILLMENT_STATUS = process.env.CANCEL_FULFILLMENT_STATUS || 'WILL_NOT_DELIVER';

// How often to send the "orders still waiting for a tracking number" digest,
// and how old a confirmed order must be before it shows up in that digest
// (so brand-new confirmations don't nag you within minutes).
const TRACKING_REMINDER_EVERY_MS = Number(process.env.TRACKING_REMINDER_INTERVAL_HOURS || 24) * 3_600_000;
const TRACKING_REMINDER_MIN_AGE_HOURS = Number(process.env.TRACKING_REMINDER_MIN_AGE_HOURS || 12);

const ms = (iso) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);
const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0);
const hours = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0);

// Statuses meaning "confirmed, still waiting for a tracking number" — includes
// leftovers from the old auto-ship version (ship_failed, dry_run, ship_skipped_multi).
const AWAITING_TRACKING = new Set(['confirmed', 'confirmed_noship', 'ship_failed', 'dry_run', 'ship_skipped_multi']);
const isDelivered = (v) => /\bdelivered\b/i.test(v);
const isCanceled = (v) => /\bcancel/i.test(v);

// Ecwid stores tracking on the order's `shipments` array (newer model) and/or the
// legacy top-level `trackingNumber`. Check both.
function extractTracking(order) {
  let tn = String(order.trackingNumber || '').trim();
  if (tn) return tn;
  if (Array.isArray(order.shipments)) {
    for (const s of order.shipments) {
      const t = String(s?.trackingNumber || s?.tracking_number || '').trim();
      if (t) return t;
    }
  }
  return '';
}

// Send a template but never throw — a failed/unapproved template must not block
// the order from being marked done (otherwise it retries forever).
async function trySend(customer, template, lang, orderId) {
  if (!template || !customer) return false;
  try { await sendTemplate(customer, template, lang); return true; }
  catch (e) { console.warn(`[track] message send failed for ${orderId} (template ${template}):`, e.message); return false; }
}

// On a return, add every line item's quantity back to its size's stock in Ecwid.
// Uses the order's own data (product + selected size), so no package text is parsed.
// Never throws — a stock hiccup must not block the order from being marked returned.
async function restockOrder(orderId) {
  let order;
  try {
    order = await getOrder(orderId);
  } catch (e) {
    console.warn(`[stock] couldn't read order ${orderId} to restock:`, e.message);
    return;
  }
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    const pid = it.productId;
    const cid = it.combinationId || 0; // variation id; 0 ⇒ base product
    const qty = it.quantity || 1;
    if (!pid) continue;
    const where = (it.selectedOptions || []).map((o) => `${o.name}: ${o.value}`).join(', ');
    try {
      await adjustInventory(pid, cid || null, qty);
      console.log(`[stock] restocked +${qty} → ${it.name}${where ? ' (' + where + ')' : ''}${cid ? ' [comb ' + cid + ']' : ' [base product]'}`);
    } catch (e) {
      console.warn(`[stock] restock failed for "${it.name}"${where ? ' (' + where + ')' : ''} in ${orderId}:`, e.message);
    }
  }
}
const isReturned = (v) => /\breturned\b/i.test(v);
const needsAction = (v) => /\bexception\b|awaiting/i.test(v);

// ---------------------------------------------------------------------------
// Daily digest: orders that are confirmed but still have no Bosta tracking
// number on the Ecwid order. These are the ones that silently fall through
// the cracks (delivered in Bosta but never linked here because no tracking
// was assigned). Self-throttled to run once per TRACKING_REMINDER_EVERY_MS.
// ---------------------------------------------------------------------------
export async function remindAwaitingTracking() {
  const lastSent = store.getMeta('lastTrackingReminderUnix');
  const nowUnix = Math.floor(Date.now() / 1000);
  if (lastSent && (nowUnix - lastSent) * 1000 < TRACKING_REMINDER_EVERY_MS) return;

  // Collect every order still waiting for a tracking number:
  //  - AWAITING_TRACKING statuses with no bostaTracking yet, older than the
  //    min-age grace window (so a just-confirmed order doesn't nag immediately)
  //  - orders that already gave up waiting ('no_tracking')
  const waiting = [];
  for (const rec of store.list()) {
    const isAwaiting = AWAITING_TRACKING.has(rec.status) && !rec.bostaTracking;
    const gaveUp = rec.status === 'no_tracking';
    if (!isAwaiting && !gaveUp) continue;

    // Age from confirmation (fall back to any timestamp we have).
    const ageRef = rec.confirmedAt || rec.updatedAt || rec.firstFailedAt;
    if (isAwaiting && hours(ageRef) < TRACKING_REMINDER_MIN_AGE_HOURS) continue;

    waiting.push({
      orderId: rec.orderId,
      orderNumber: rec.orderNumber || rec.orderId,
      ageDays: Math.floor(days(ageRef)),
      gaveUp,
    });
  }

  // Always advance the timer so we send at most once per interval, even when
  // there's nothing to report (we simply skip the message in that case).
  store.setMeta('lastTrackingReminderUnix', nowUnix);

  if (waiting.length === 0) {
    console.log('[track] daily tracking reminder: nothing awaiting a tracking number');
    return;
  }

  // Sort oldest first — those are the most urgent.
  waiting.sort((a, b) => b.ageDays - a.ageDays);

  const lines = waiting.map((w) => {
    const tag = w.gaveUp ? ' (gave up waiting — needs attention)' : '';
    const age = w.ageDays > 0 ? ` — ${w.ageDays}d waiting` : '';
    return `• Order ${w.orderNumber}${age}${tag}`;
  });

  const header = `📋 ${waiting.length} order${waiting.length === 1 ? '' : 's'} still need a Bosta tracking number on Ecwid:`;
  const footer = '\nAdd the tracking number on each Ecwid order so delivery status can be followed automatically.';
  await notifyMerchant(`${header}\n${lines.join('\n')}\n${footer}`);
  console.log(`[track] daily tracking reminder sent for ${waiting.length} order(s)`);
}

export async function trackFromEcwid() {
  if (!bostaConfigured()) return;

  if (process.env.TRACK_DEBUG === 'true') {
    const summary = store.list().map(r => `${r.orderId}:${r.status}${r.bostaTracking ? '(' + r.bostaTracking + ')' : ''}`).join(' ');
    console.log(`[track][debug] store has ${store.list().length} orders: ${summary || '(none)'}`);
  }

  for (const rec of store.list()) {
    // --- Phase A: confirmed order, no tracking yet → look for one on the Ecwid order ---
    if (AWAITING_TRACKING.has(rec.status) && !rec.bostaTracking) {
      if (ms(rec.lastTrackLook) < LOOK_EVERY_MS) continue;
      store.upsert(rec.orderId, { lastTrackLook: new Date().toISOString() });

      if (days(rec.confirmedAt) > LOOK_MAX_DAYS) {
        store.upsert(rec.orderId, { status: 'no_tracking' }); // gave up waiting for a tracking number
        continue;
      }
      try {
        const order = await getOrder(rec.orderId);
        const tn = extractTracking(order);
        if (process.env.TRACK_DEBUG === 'true') {
          console.log(`[track][debug] ${rec.orderId}: extracted tracking="${tn}" | fulfillmentStatus="${order.fulfillmentStatus || ''}" | shipments=${JSON.stringify(order.shipments || [])}`);
        }
        if (tn) {
          store.upsert(rec.orderId, { status: 'tracking', bostaTracking: tn, trackingFoundAt: new Date().toISOString() });
          await notifyMerchant(`📦 Order ${rec.orderId}: tracking ${tn} picked up from Ecwid — now watching delivery status.`);
          console.log(`[track] order ${rec.orderId} tracking ${tn} found in Ecwid`);
        }
      } catch (err) {
        if (/not found|order_not_found|\b404\b/i.test(err.message)) {
          store.upsert(rec.orderId, { status: 'order_gone', shipError: err.message });
          console.warn(`[track] order ${rec.orderId} no longer exists in Ecwid — stopped looking`);
        } else {
          console.warn(`[track] look-up failed for ${rec.orderId}:`, err.message);
        }
      }
      continue;
    }

    // --- Phase B: tracked order → poll Bosta status ---
    if (rec.status === 'tracking' && rec.bostaTracking) {
      if (days(rec.trackingFoundAt) > STATUS_MAX_DAYS) {
        store.upsert(rec.orderId, { status: 'tracking_timeout' });
        continue;
      }
      if (ms(rec.lastStatusCheck) < STATUS_EVERY_MS) continue;
      store.upsert(rec.orderId, { lastStatusCheck: new Date().toISOString() });

      try {
        const st = await getDeliveryState(rec.bostaTracking);
        if (!st) continue;
        store.upsert(rec.orderId, { lastState: st.value, lastStateCode: st.code });
        console.log(`[track] order ${rec.orderId} Bosta state: "${st.value}" (code ${st.code})`);

        const customer = rec.repliedBy || rec.to;
        if (isDelivered(st.value)) {
          try { await updateOrder(rec.orderId, { fulfillmentStatus: DELIVERED_STATUS }); }
          catch (e) { console.warn(`[track] couldn't set Ecwid ${DELIVERED_STATUS} for ${rec.orderId}:`, e.message); }
          await trySend(customer, DELIVERED_TEMPLATE, LANG, rec.orderId);
          store.upsert(rec.orderId, { status: 'delivered' });
          await notifyMerchant(`📦 Order ${rec.orderId} DELIVERED — marked Delivered on Ecwid and sent the 100 EGP offer.`);
          console.log(`[track] order ${rec.orderId} delivered — Ecwid updated + offer sent`);
        } else if (isReturned(st.value)) {
          const askNow = REJECTED_TEMPLATE && customer && !rec.exceptionNotified;
          if (askNow) await trySend(customer, REJECTED_TEMPLATE, LANG, rec.orderId);
          await restockOrder(rec.orderId); // put the returned size(s) back into stock
          try { await updateOrder(rec.orderId, { fulfillmentStatus: RETURNED_STATUS }); }
          catch (e) { console.warn(`[track] couldn't set Ecwid ${RETURNED_STATUS} for ${rec.orderId}:`, e.message); }
          store.upsert(rec.orderId, { status: 'returned', exceptionNotified: true });
          await notifyMerchant(`↩️ Order ${rec.orderId} RETURNED — restocked items and marked Returned on Ecwid${askNow ? ', asked the customer the reason' : ''}.`);
          console.log(`[track] order ${rec.orderId} returned — restocked + Ecwid updated${askNow ? ' + reason message sent' : ''}`);
        } else if (isCanceled(st.value)) {
          try { await updateOrder(rec.orderId, { paymentStatus: CANCEL_STATUS, fulfillmentStatus: CANCEL_FULFILLMENT_STATUS }); }
          catch (e) { console.warn(`[track] couldn't set Ecwid cancelled for ${rec.orderId}:`, e.message); }
          store.upsert(rec.orderId, { status: 'shipment_canceled' });
          await notifyMerchant(`🚫 Order ${rec.orderId} shipment CANCELED in Bosta — marked Cancelled on Ecwid.`);
          console.log(`[track] order ${rec.orderId} shipment canceled — Ecwid updated`);
        } else if (needsAction(st.value) && !rec.exceptionNotified) {
          await trySend(customer, REJECTED_TEMPLATE, LANG, rec.orderId);
          store.upsert(rec.orderId, { exceptionNotified: true }); // keep status 'tracking' — keep watching
          await notifyMerchant(`⚠️ Order ${rec.orderId} hit a delivery problem — asked the customer the reason / size fix. Still watching for delivered or returned.`);
          console.log(`[track] order ${rec.orderId} exception — reason message sent (still tracking)`);
        }
        // otherwise still in transit (or exception already handled) — keep checking next interval
      } catch (err) {
        if (/not found|\b400\b|\b404\b/i.test(err.message)) {
          store.upsert(rec.orderId, { status: 'tracking_gone', shipError: err.message });
          console.warn(`[track] ${rec.orderId} not found in Bosta — stopped checking`);
        } else {
          console.warn(`[track] status check failed for ${rec.orderId}:`, err.message);
        }
      }
      continue;
    }
  }

  // Daily digest of orders still missing a tracking number (self-throttled).
  await remindAwaitingTracking();
}
