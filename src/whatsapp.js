// WhatsApp Cloud API (Meta Graph) client.
// - sendPollTemplate: the business-initiated message with Confirm/Cancel buttons.
//   It MUST use an approved template because the customer hasn't messaged us yet.
//   We attach a dynamic payload to each button so the reply carries the order ID.
// - sendText: a free-form follow-up. Allowed because tapping a button opens the
//   24-hour customer-service window.
// - sendTemplate: any approved template by name, no buttons — for follow-ups
//   that go out days later (outside the 24h window), where only templates work.
// - sendTemplateWithButtons: same as sendTemplate, but for templates that HAVE
//   quick-reply buttons (e.g. the Postponed template's "تم التواصل" / "لم يتم
//   التواصل"). Generalizes the payload-per-button pattern sendPollTemplate uses,
//   for templates where the button set/count isn't fixed.

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

// Sends any approved template by name, with optional body {{1}},{{2}}… params.
// Used for follow-ups (delivered offer, return reason) that go out days later —
// outside the 24h window — where only templates are allowed.
export async function sendTemplate(to, name, lang, bodyParams = []) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim() || '-';
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((t) => ({ type: 'text', text: clean(t) })),
    });
  }
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name, language: { code: lang }, components },
  });
}

// Sends any approved template that has quick-reply buttons, attaching a
// payload to each button in order (button 0 gets buttonPayloads[0], etc.) so
// the reply tells us which button was tapped and for which order — same idea
// as sendPollTemplate, but for templates whose button set isn't fixed/known
// ahead of time (e.g. the Postponed template: "تم التواصل" / "لم يتم التواصل").
export async function sendTemplateWithButtons(to, name, lang, { bodyParams = [], buttonPayloads = [] } = {}) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim() || '-';
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((t) => ({ type: 'text', text: clean(t) })),
    });
  }
  buttonPayloads.forEach((payload, index) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload }],
    });
  });
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name, language: { code: lang }, components },
  });
}
