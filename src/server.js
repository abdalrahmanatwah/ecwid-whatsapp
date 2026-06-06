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

const CONFIRM_MESSAGE =
  '🎉 تّمام يا صاحبي، تم تأكيد الأوردر بنجاح. ✅\n' +
  'وجاري تجهيزه دلوقتي علشان يجيلك طاير. 🚀 أول ما الشحنة تطلع مع شركة الشحن هتابع معاك علطول. 🚛💨\n' +
  'لو عوزت أي حاجة تانية أنا في الخدمة دايماً! 🫡✨';

const CANCEL_MESSAGE =
  'تم إلغاء الأوردر. لو حصل ده بالخطأ، تقدر تعمل الأوردر تاني أو ترد على الرسالة دي.';

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
    await updateOrder(orderId, { paymentStatus: CANCEL_STATUS });
    store.upsert(orderId, { status: 'cancelled', repliedBy: from });
    await sendText(from, CANCEL_MESSAGE);
    await notifyMerchant(`❌ Order ${orderId} was CANCELLED by the customer.`);
    console.log(`[reply] order ${orderId} cancelled`);
    return;
  }
}

app.listen(PORT, () => {
  console.log(`Listening on :${PORT}`);
  const interval = Number(process.env.POLL_INTERVAL_SECONDS || 60);
  startPolling(interval);
});
