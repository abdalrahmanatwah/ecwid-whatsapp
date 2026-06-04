// WATCH-ONLY follow-ups. For merchants who create Bosta shipments themselves
// (AUTO_SHIP off) but still want the post-delivery messages. It polls Bosta's
// recent deliveries and, when one turns Delivered or Exception, sends the
// matching template straight to that delivery's receiver phone — no shipment is
// created by the system, and no Ecwid-order matching is needed (the templates
// have no order-specific details).
//
// Safety: on the FIRST run it "seeds" — every delivery already in a terminal
// state is marked as seen WITHOUT messaging, so past customers are never
// blasted. Only deliveries that reach Delivered/Exception afterwards trigger a
// message. Each delivery is messaged once (deduped by its id). Never throws.

import { listRecentDeliveries } from './bosta.js';
import { sendTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const WATCH = String(process.env.BOSTA_WATCH || '').toLowerCase() === 'true';
const DELIVERED_TEMPLATE = process.env.DELIVERED_TEMPLATE_NAME || '';
const REJECTED_TEMPLATE = process.env.REJECTED_TEMPLATE_NAME || '';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '20';
const CHECK_EVERY_MS = Number(process.env.BOSTA_STATUS_INTERVAL_MINUTES || 20) * 60_000;
const LIST_LIMIT = Number(process.env.BOSTA_WATCH_LIMIT || 50);

function stateValue(d) {
  return d?.state?.value || d?.maskedState || (typeof d?.state === 'string' ? d.state : '') || '';
}
function isDelivered(v) {
  return /\bdelivered\b/i.test(v);
}
function needsAction(v) {
  return /\bexception\b|awaiting/i.test(v);
}
// Only "Send"/package-delivery shipments (type 10) should get these messages —
// not cash collections, returns, or exchanges.
function isSendType(d) {
  const t = d?.type;
  if (t == null) return true; // if absent, don't exclude
  if (typeof t === 'number') return t === 10;
  if (typeof t === 'object') return t.code === 10 || /package|forward|send|deliver/i.test(t.value || '');
  return /package|forward|send|deliver/i.test(String(t));
}

export async function watchBostaDeliveries() {
  if (!WATCH) return;
  if (!DELIVERED_TEMPLATE && !REJECTED_TEMPLATE) return;

  // Throttle.
  const last = store.getMeta('lastBostaWatch');
  if (last && Date.now() - new Date(last).getTime() < CHECK_EVERY_MS) return;

  let deliveries;
  try {
    deliveries = await listRecentDeliveries(LIST_LIMIT);
  } catch (err) {
    console.warn('[watch] listing deliveries failed:', err.message);
    return;
  }
  store.setMeta('lastBostaWatch', new Date().toISOString());

  const seeded = store.getMeta('bostaWatchSeeded');
  if (!seeded && deliveries.length) {
    // Log one raw delivery so the exact field shape can be confirmed.
    console.log('[watch] sample delivery for field check:', JSON.stringify(deliveries[0]).slice(0, 900));
  }

  let sent = 0;
  for (const d of deliveries) {
    const id = d?._id || d?.id || d?.trackingNumber;
    if (!id || !isSendType(d)) continue;

    const sv = stateValue(d);
    const kind = isDelivered(sv) ? 'delivered' : needsAction(sv) ? 'exception' : null;
    if (!kind) continue;

    const key = `bd_${id}`;
    if (store.has(key)) continue; // already handled

    if (!seeded) {
      store.upsert(key, { status: 'seeded', state: sv }); // first run: remember, don't message
      continue;
    }

    const phone = normalizePhone(d?.receiver?.phone || d?.receiver?.phoneNumber || '', COUNTRY);
    if (!phone) {
      store.upsert(key, { status: 'no_phone', state: sv });
      continue;
    }

    try {
      if (kind === 'delivered' && DELIVERED_TEMPLATE) await sendTemplate(phone, DELIVERED_TEMPLATE, TEMPLATE_LANG);
      if (kind === 'exception' && REJECTED_TEMPLATE) await sendTemplate(phone, REJECTED_TEMPLATE, TEMPLATE_LANG);
      store.upsert(key, { status: `sent_${kind}`, state: sv, phone });
      sent++;
      console.log(`[watch] ${kind} delivery ${id} -> message sent to ${phone}`);
    } catch (err) {
      console.warn(`[watch] send failed for delivery ${id}:`, err.message);
    }
  }

  if (!seeded) {
    store.setMeta('bostaWatchSeeded', true);
    console.log(`[watch] seeded ${deliveries.length} existing deliveries (no messages sent). Future status changes will trigger messages.`);
    await notifyMerchant('🔔 Bosta watch is on. Existing deliveries were noted silently; new Delivered/Exception updates will now message customers.');
  } else if (sent) {
    console.log(`[watch] sent ${sent} follow-up message(s) this cycle`);
  }
}
