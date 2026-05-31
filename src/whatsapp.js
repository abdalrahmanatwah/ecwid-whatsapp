// WhatsApp Cloud API (Meta Graph) client.
// - sendPollTemplate: the business-initiated message with Confirm/Cancel buttons.
//   It MUST use an approved template because the customer hasn't messaged us yet.
//   We attach a dynamic payload to each button so the reply carries the order ID.
// - sendText: a free-form follow-up. Allowed because tapping a button opens the
//   24-hour customer-service window.

const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const TEMPLATE = process.env.WHATSAPP_TEMPLATE_NAME || 'order_confirmation';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

const ENDPOINT = `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`;

async function send(payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// Sends the Confirm/Cancel poll. Body has 2 variables: {{1}} products, {{2}} total.
// Button 0 = Confirm, Button 1 = Cancel. Payloads carry the order ID back to us.
export async function sendPollTemplate(to, { products, total, orderId }) {
  // WhatsApp rejects parameters with line breaks/tabs/long spaces, so collapse them.
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim() || '-';
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE,
      language: { code: LANG },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: clean(products) },
            { type: 'text', text: clean(total) },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `CONFIRM_${orderId}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: `CANCEL_${orderId}` }],
        },
      ],
    },
  });
}

export async function sendText(to, body) {
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body },
  });
}
