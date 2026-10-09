import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateOrder } from './ecwid.js';
import { sendText, sendTemplate } from './whatsapp.js';
import { store } from './store.js';
import { startPolling } from './poller.js';
import { notifyMerchant, merchantNumber } from './notify.js';
import { dashboardRouter } from './dashboard.js';
import { requireAuth } from './auth.js';
import * as qpOrders from './qp_orders.js';
import { handleCartButton } from './abandoned_carts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const CONFIRM_STATUS = process.env.CONFIRM_FULFILLMENT_STATUS || 'PROCESSING';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const CANCEL_FULFILLMENT_STATUS = process.env.CANCEL_FULFILLMENT_STATUS || 'WILL_NOT_DELIVER';

const CONFIRM_MESSAGE =
  '🎉 تّمام يا صاحبي، تم تأكيد الأوردر بنجاح. ✅\n' +
  'وجاري تجهيزه دلوقتي علشان يجيلك طاير. 🚀 أول ما الشحنة تطلع مع شركة الشحن هتابع معاك علطول. 🚛💨\n' +
  'لو عوزت أي حاجة تانية أنا في الخدمة دايماً! 🫡✨';

const CANCEL_MESSAGE =
  'تم إلغاء الأوردر. لو حصل ده بالخطأ، تقدر تعمل الأوردر تاني أو ترد على الرسالة دي.';

const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
// This specific alert ("customer says shipping co. never contacted them") goes
// through an approved template instead of notifyMerchant's free text, since it
// must NOT depend on the 24h customer-service window on the owner's number —
// the whole point is telling the owner about a problem right away.
// Template body: exactly one variable, the order number, e.g.:
//   "تنبيه: العميل بتاع الأوردر رقم {{1}} قال إن شركة الشحن متواصلتش معاه بخصوص التأجيل."
const NOT_CONTACTED_ALERT_TEMPLATE = process.env.NOT_CONTACTED_ALERT_TEMPLATE_NAME || '';

// Replies to the Postponed template's "تم التواصل" / "لم يتم التواصل" buttons.
const CONTACTED_MESSAGE = 'تمام، شكرًا لتأكيدك 🙏 لو احتجت أي حاجة تانية أنا موجود.';
const NOT_CONTACTED_MESSAGE =
  'تمام، آسفين على الإزعاج 🙏 جاري حل المشكلة مع شركة الشحن دلوقتي وهنرجعلك بأقرب وقت.';

// Health check
app.get('/', (_req, res) => res.send('Ecwid → WhatsApp order confirmation: running'));

/* ------------------------------------------------------------------ *
 * Dashboard: Bosta delivery rate, earnings, undelivered orders, etc.  *
 * Both the page and its API are behind Basic Auth (DASHBOARD_PASSWORD)*
 * ------------------------------------------------------------------ */
app.use('/dashboard', requireAuth, dashboardRouter);
app.get('/dashboard', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

/* ------------------------------------------------------------------ *
 * QP Express: separate order-tracking section, not mixed with Bosta.  *
 * Ingest is called by our own local Playwright sync script only —     *
 * protected by a shared-secret bearer token (QP_INGEST_TOKEN), not    *
 * Basic Auth, since it's a machine-to-machine call, not a browser.    *
 * The read routes (list/summary) are unauthenticated for now, same    *
 * trust level as the rest of this service's internal API surface.     *
 * ------------------------------------------------------------------ */
app.post('/webhooks/qp-orders', express.json({ limit: '10mb' }), qpOrders.handleIngest);
app.get('/api/qp/orders', qpOrders.handleList);
app.get('/api/qp/summary', qpOrders.handleSummary);

/* ------------------------------------------------------------------ *
 * WhatsApp webhook verification (Meta calls this once during setup)   *
 * ------------------------------------------------------------------ */
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ------------------------------------------------------------------ *
 * WhatsApp webhook: customer tapped Confirm or Cancel                 *
 * ------------------------------------------------------------------ */
app.post('/webhooks/whatsapp', async (req, res) => {
  res.sendStatus(200); // ack immediately

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        // Delivery status updates (sent / delivered / read / failed). A "failed"
        // status carries the reason WhatsApp didn't deliver — quality limits, etc.
        for (const st of change.value?.statuses || []) {
          if (st.status === 'failed') {
            const errs = (st.errors || [])
              .map((e) => `${e.code} ${e.title}${e.error_data?.details ? ' — ' + e.error_data.details : ''}`)
              .join('; ');
            console.warn(`[whatsapp] to ${st.recipient_id} FAILED: ${errs || 'unknown reason'}`);
          } else if (st.status === 'sent' || st.status === 'delivered') {
            console.log(`[whatsapp] to ${st.recipient_id}: ${st.status}`);
          }
        }

        const messages = change.value?.messages || [];
        for (const msg of messages) {
          const payload = extractButtonPayload(msg);
          if (!payload) continue;

          // Abandoned-cart offer buttons (CART_CONFIRM_<cartId> / CART_CANCEL_<cartId>).
          // Handled in abandoned_carts.js; returns true when it recognized the payload.
          try {
            if (await handleCartButton(payload, msg.from)) continue;
          } catch (e) {
            console.error('[whatsapp] cart button handler error:', e.message);
            continue;
          }

          const { action, orderId } = parsePayload(payload);
          if (!action || !orderId) continue;

          await handleReply({ action, orderId, from: msg.from });
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] handler error:', err.message);
  }
});

// Template quick-reply buttons arrive as type "button"; interactive (non-template)
// buttons arrive as type "interactive" / button_reply. Handle both.
function extractButtonPayload(msg) {
  if (msg.type === 'button' && msg.button?.payload) return msg.button.payload;
  if (msg.type === 'interactive' && msg.interactive?.button_reply?.id) {
    return msg.interactive.button_reply.id;
  }
  return null;
}

// NOT_CONTACTED_ is checked before CONTACTED_ purely for clarity — their
// prefixes don't actually overlap (different first letters), so order here
// doesn't matter, but keeping the longer/more-specific one first avoids any
// future foot-gun if a payload naming scheme ever gets close to another.
function parsePayload(payload) {
  if (payload.startsWith('CONFIRM_')) return { action: 'confirm', orderId: payload.slice(8) };
  if (payload.startsWith('CANCEL_')) return { action: 'cancel', orderId: payload.slice(7) };
  if (payload.startsWith('NOT_CONTACTED_')) return { action: 'not_contacted', orderId: payload.slice(14) };
  if (payload.startsWith('CONTACTED_')) return { action: 'contacted', orderId: payload.slice(10) };
  return {};
}

async function handleReply({ action, orderId, from }) {
  const rec = store.get(orderId) || {};
  const status = rec.status;

  if (action === 'confirm') {
    // Confirm only acts on a fresh order. If already confirmed or cancelled, do nothing.
    if (status && status !== 'poll_sent') {
      console.log(`[reply] order ${orderId} is '${status}', ignoring confirm`);
      return;
    }
    await updateOrder(orderId, { fulfillmentStatus: CONFIRM_STATUS });
    store.upsert(orderId, { status: 'confirmed', confirmedAt: new Date().toISOString(), repliedBy: from });
    await sendText(from, CONFIRM_MESSAGE);
    await notifyMerchant(`✅ Order ${orderId} CONFIRMED — set to Processing.`);
    console.log(`[reply] order ${orderId} confirmed → Processing`);
    return;
  }

  if (action === 'cancel') {
    if (status === 'cancelled') {
      console.log(`[reply] order ${orderId} already cancelled, ignoring`);
      return;
    }
    // Cancel cleanly — including after a confirm (customer changed their mind).
    await updateOrder(orderId, { paymentStatus: CANCEL_STATUS, fulfillmentStatus: CANCEL_FULFILLMENT_STATUS });
    store.upsert(orderId, { status: 'cancelled', repliedBy: from });
    await sendText(from, CANCEL_MESSAGE);
    await notifyMerchant(`❌ Order ${orderId} was CANCELLED by the customer.`);
    console.log(`[reply] order ${orderId} cancelled`);
    return;
  }

  // Reply to the Postponed template: did the shipping company actually
  // contact the customer about the new delivery date? Doesn't touch the
  // order's tracking `status` — just records the answer and replies.
  if (action === 'contacted') {
    store.upsert(orderId, { postponedContact: 'contacted', postponedContactAt: new Date().toISOString(), repliedBy: from });
    await sendText(from, CONTACTED_MESSAGE);
    console.log(`[reply] order ${orderId} postponed-contact: customer confirms contacted`);
    return;
  }

  if (action === 'not_contacted') {
    store.upsert(orderId, { postponedContact: 'not_contacted', postponedContactAt: new Date().toISOString(), repliedBy: from });
    await sendText(from, NOT_CONTACTED_MESSAGE);

    // Approved template (order_postponed_owner_alert_1), not notifyMerchant's
    // free text — this alert must land right away regardless of whether the
    // owner's number has an open 24h window.
    if (NOT_CONTACTED_ALERT_TEMPLATE && merchantNumber) {
      try {
        await sendTemplate(merchantNumber, NOT_CONTACTED_ALERT_TEMPLATE, LANG, [rec.orderNumber || orderId]);
      } catch (e) {
        console.warn(`[reply] owner alert template failed for ${orderId}:`, e.message);
      }
    } else {
      // Fallback so nothing silently disappears if the template name/number isn't set yet.
      await notifyMerchant(`📞 Order ${orderId}: customer says the shipping company did NOT contact them about the postponement — please follow up with Bosta.`);
    }
    console.log(`[reply] order ${orderId} postponed-contact: customer says NOT contacted — merchant alerted`);
    return;
  }
}

app.listen(PORT, () => {
  console.log(`Listening on :${PORT}`);
  const interval = Number(process.env.POLL_INTERVAL_SECONDS || 60);
  startPolling(interval);
});
