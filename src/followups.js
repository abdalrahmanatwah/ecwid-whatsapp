// Post-delivery follow-ups. For each shipped order, polls Bosta for the delivery
// state and, once terminal, sends the customer the matching approved template:
//   - Delivered → "delivered offer" template (100 EGP off for a photo)
//   - Awaiting action → "reason" template (ask why + offer size fix) — sent at
//     the problem stage so the sale can still be saved, not after a final return.
//
// These go out days after the order, OUTSIDE WhatsApp's 24h window, so they must
// be approved TEMPLATES (free text is not allowed there). Each order is checked
// at most once every BOSTA_STATUS_INTERVAL_MINUTES and stops once terminal or
// after FOLLOWUP_MAX_DAYS. Never throws.

import { getDeliveryState } from './bosta.js';
import { sendTemplate } from './whatsapp.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const DELIVERED_TEMPLATE = process.env.DELIVERED_TEMPLATE_NAME || '';
const REJECTED_TEMPLATE = process.env.REJECTED_TEMPLATE_NAME || '';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const CHECK_EVERY_MS = Number(process.env.BOSTA_STATUS_INTERVAL_MINUTES || 20) * 60_000;
const MAX_DAYS = Number(process.env.FOLLOWUP_MAX_DAYS || 14);

// Bosta state matching. We match on the human-readable value AND known codes,
// and the real strings are logged so they can be confirmed on the first live
// deliveries. "Delivered" (past tense) is matched carefully so it doesn't catch
// "Out for delivery".
function isDelivered(value, code) {
  if (code === 45) return true;
  return /\bdelivered\b/i.test(value);
}
// Bosta's API reports a problem delivery with the state "Exception" (the
// dashboard groups these under its "Awaiting your action" tab). That's the
// moment to reach out. We also keep "awaiting" in case the API ever surfaces
// the dashboard wording. We deliberately do NOT trigger on the final
// "Returned to business" state.
function needsAction(value, code) {
  return /\bexception\b|awaiting/i.test(value);
}

export async function checkDeliveryStatuses() {
  if (!DELIVERED_TEMPLATE && !REJECTED_TEMPLATE) return; // feature not configured

  for (const rec of store.list()) {
    if (rec.status !== 'shipped' || !rec.bostaTracking) continue;

    // Stop following up after MAX_DAYS to avoid polling forever.
    const shippedAge = rec.shippedAt ? (Date.now() - new Date(rec.shippedAt).getTime()) / 86_400_000 : 0;
    if (shippedAge > MAX_DAYS) {
      store.upsert(rec.orderId, { status: 'followup_timeout' });
      continue;
    }

    // Throttle per order.
    const since = rec.lastStatusCheck ? Date.now() - new Date(rec.lastStatusCheck).getTime() : Infinity;
    if (since < CHECK_EVERY_MS) continue;

    try {
      const st = await getDeliveryState(rec.bostaTracking);
      store.upsert(rec.orderId, { lastStatusCheck: new Date().toISOString(), lastState: st?.value, lastStateCode: st?.code });
      if (!st) continue;
      console.log(`[followup] order ${rec.orderId} Bosta state: "${st.value}" (code ${st.code})`);

      const customer = rec.repliedBy; // customer's WhatsApp number (from their confirm tap)

      if (isDelivered(st.value, st.code)) {
        if (DELIVERED_TEMPLATE && customer) {
          await sendTemplate(customer, DELIVERED_TEMPLATE, TEMPLATE_LANG);
        }
        store.upsert(rec.orderId, { status: 'delivered' });
        await notifyMerchant(`📦 Order ${rec.orderId} DELIVERED — sent the customer the 100 EGP photo offer.`);
        console.log(`[followup] order ${rec.orderId} delivered — offer sent`);
      } else if (needsAction(st.value, st.code)) {
        if (REJECTED_TEMPLATE && customer) {
          await sendTemplate(customer, REJECTED_TEMPLATE, TEMPLATE_LANG);
        }
        store.upsert(rec.orderId, { status: 'awaiting_action' });
        await notifyMerchant(`⚠️ Order ${rec.orderId} needs action (delivery problem) — asked the customer the reason / size fix.`);
        console.log(`[followup] order ${rec.orderId} awaiting action — reason message sent`);
      }
      // otherwise still in transit — leave as 'shipped' and check again later
    } catch (err) {
      console.warn(`[followup] status check failed for ${rec.orderId}:`, err.message);
    }
  }
}
