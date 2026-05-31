import 'dotenv/config';
import express from 'express';
import { updateOrder } from './ecwid.js';
import { sendText } from './whatsapp.js';
import { store } from './store.js';
import { startPolling } from './poller.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CONFIRM_STATUS = process.env.CONFIRM_FULFILLMENT_STATUS || 'PROCESSING';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const MERCHANT = process.env.MERCHANT_WHATSAPP || '';

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
  const record = store.get(orderId);

  // Guard against double taps / replays.
  if (record?.status === 'confirmed' || record?.status === 'cancelled') {
    console.log(`[reply] order ${orderId} already ${record.status}, ignoring`);
    return;
  }

  if (action === 'confirm') {
    await updateOrder(orderId, { fulfillmentStatus: CONFIRM_STATUS });
    store.upsert(orderId, { status: 'confirmed', repliedBy: from });
    await sendText(from, '✅ Thank you! Your order is confirmed and we are preparing it now.');
    await notifyMerchant(`✅ Order ${orderId} was CONFIRMED by the customer.`);
    console.log(`[reply] order ${orderId} confirmed`);
  } else if (action === 'cancel') {
    await updateOrder(orderId, { paymentStatus: CANCEL_STATUS });
    store.upsert(orderId, { status: 'cancelled', repliedBy: from });
    await sendText(from, 'Your order has been cancelled. If this was a mistake, just place it again or reply here.');
    await notifyMerchant(`❌ Order ${orderId} was CANCELLED by the customer.`);
    console.log(`[reply] order ${orderId} cancelled`);
  }
}

async function notifyMerchant(text) {
  if (!MERCHANT) return;
  try {
    await sendText(MERCHANT, text);
  } catch (err) {
    console.warn('[merchant] notify skipped:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`Listening on :${PORT}`);
  const interval = Number(process.env.POLL_INTERVAL_SECONDS || 60);
  startPolling(interval);
});
