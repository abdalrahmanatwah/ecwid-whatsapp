import 'dotenv/config';
import express from 'express';
import { updateOrder } from './ecwid.js';
import { sendText } from './whatsapp.js';
import { store } from './store.js';
import { startPolling } from './poller.js';
import { notifyMerchant } from './notify.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CONFIRM_STATUS = process.env.CONFIRM_FULFILLMENT_STATUS || 'PROCESSING';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const SHIP_DELAY_MIN = Number(process.env.SHIP_DELAY_MINUTES || 60);

const CONFIRM_MESSAGE =
  '🎉 تّمام يا صاحبي، تم تأكيد الأوردر بنجاح. ✅\n' +
  'وجاري تجهيزه دلوقتي علشان يجيلك طاير. 🚀 أول ما الشحنة تطلع مع شركة الشحن هتابع معاك علطول. 🚛💨\n' +
  'لو عوزت أي حاجة تانية أنا في الخدمة دايماً! 🫡✨';

const CANCEL_MESSAGE =
'يا خسارة يا صاحبي، تم إلغاء الأوردر بناءً على طلبك. 😔❌\n' +
'لو في أي مشكلة حصلت أو حابب تشاركنا إيه السبب، ياريت تقولنا علشان نصلحها علطول! 🤝💬\n' +
'ولو الإلغاء ده حصل بالخطأ، تقدر تعمل الأوردر تاني أو ترد على الرسالة دي وهنساعدك فوراً. 📲✨';

// Health check
app.get('/', (_req, res) => res.send('Ecwid → WhatsApp order confirmation: running'));

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
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          const payload = extractButtonPayload(msg);
          if (!payload) continue;

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

function parsePayload(payload) {
  if (payload.startsWith('CONFIRM_')) return { action: 'confirm', orderId: payload.slice(8) };
  if (payload.startsWith('CANCEL_')) return { action: 'cancel', orderId: payload.slice(7) };
  return {};
}

async function handleReply({ action, orderId, from }) {
  const status = store.get(orderId)?.status;

  if (action === 'confirm') {
    // Confirm only acts on a fresh (un-acted) order. If it's already confirmed,
    // shipped, or cancelled, do nothing — avoids re-shipping or un-cancelling.
    if (status && status !== 'poll_sent') {
      console.log(`[reply] order ${orderId} is '${status}', ignoring confirm`);
      return;
    }
    await updateOrder(orderId, { fulfillmentStatus: CONFIRM_STATUS });
    // Record confirmedAt — the poller ships single-product orders SHIP_DELAY_MIN later,
    // giving the customer a window to cancel after confirming.
    store.upsert(orderId, { status: 'confirmed', confirmedAt: new Date().toISOString(), repliedBy: from });
    await sendText(from, CONFIRM_MESSAGE);
    await notifyMerchant(`✅ Order ${orderId} CONFIRMED (ships via Bosta in ${SHIP_DELAY_MIN} min unless cancelled).`);
    console.log(`[reply] order ${orderId} confirmed — will ship in ${SHIP_DELAY_MIN} min unless cancelled`);
    return;
  }

  if (action === 'cancel') {
    if (status === 'cancelled' || status === 'cancelled_after_ship') {
      console.log(`[reply] order ${orderId} already cancelled, ignoring`);
      return;
    }

    // Already shipped via Bosta — too late to auto-cancel the shipment.
    if (status === 'shipped') {
      await updateOrder(orderId, { paymentStatus: CANCEL_STATUS });
      store.upsert(orderId, { status: 'cancelled_after_ship', repliedBy: from });
      await sendText(from, CANCEL_MESSAGE);
      await notifyMerchant(`⚠️ Order ${orderId} was ALREADY SHIPPED via Bosta but the customer just cancelled — cancel the Bosta shipment manually.`);
      console.log(`[reply] order ${orderId} cancelled AFTER shipping — merchant alerted`);
      return;
    }

    // Not yet shipped (poll_sent / confirmed / ship_failed / ship_skipped_multi /
    // none): cancel cleanly. If it was 'confirmed', this stops the pending Bosta ship,
    // because the poller and shipper only act on orders still in 'confirmed' state.
    await updateOrder(orderId, { paymentStatus: CANCEL_STATUS });
    store.upsert(orderId, { status: 'cancelled', repliedBy: from });
    await sendText(from, CANCEL_MESSAGE);
    await notifyMerchant(`❌ Order ${orderId} was CANCELLED by the customer${status === 'confirmed' ? ' (after confirming — shipment stopped)' : ''}.`);
    console.log(`[reply] order ${orderId} cancelled${status === 'confirmed' ? ' (was confirmed; shipment stopped)' : ''}`);
    return;
  }
}

app.listen(PORT, () => {
  console.log(`Listening on :${PORT}`);
  const interval = Number(process.env.POLL_INTERVAL_SECONDS || 60);
  startPolling(interval);
});
