// Thin wrapper around the Ecwid REST API for the two calls we need:
// fetching an order's details, and updating its status.

const STORE_ID = process.env.ECWID_STORE_ID;
const TOKEN = process.env.ECWID_API_TOKEN;
const BASE = `https://app.ecwid.com/api/v3/${STORE_ID}`;

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// GET /orders/{orderId} — full order, including customer name/phone and items.
export async function getOrder(orderId) {
  const res = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ecwid getOrder ${orderId} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// PUT /orders/{orderId} — partial update. Pass e.g. { fulfillmentStatus: 'PROCESSING' }
// or { paymentStatus: 'CANCELLED' }. Ecwid emails the customer about status changes
// according to the store's notification settings.
export async function updateOrder(orderId, body) {
  const res = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ecwid updateOrder ${orderId} failed: ${res.status} ${text}`);
  }
  return res.json(); // { updateCount: 1 }
}

// GET /orders?createdFrom=... — orders created at/after a UNIX timestamp (seconds).
// Pages through results so we never miss an order in a busy minute.
export async function searchOrders(createdFromUnix) {
  const limit = 100;
  let offset = 0;
  const all = [];
  while (true) {
    const url =
      `${BASE}/orders?createdFrom=${createdFromUnix}&limit=${limit}&offset=${offset}` +
      `&sortBy=DATE_ASC`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ecwid searchOrders failed: ${res.status} ${text}`);
    }
    const page = await res.json();
    const items = page.items || [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

// Pull a usable phone, name, number and total out of an Ecwid order object.
export function extractOrderInfo(order) {
  const phone =
    order.phone ||
    order.billingPerson?.phone ||
    order.shippingPerson?.phone ||
    order.contactPhone ||
    null;

  const name =
    order.billingPerson?.name ||
    order.shippingPerson?.name ||
    order.customerName ||
    'there';

  const orderNumber = order.orderNumber || order.vendorOrderNumber || order.id;
  const currency = order.currency ? ` ${order.currency}` : '';
  const total = `${order.total != null ? order.total : ''}${currency}`.trim();

  // Build a scannable product list. WhatsApp forbids newlines inside template
  // variables, so each item is prefixed with a bullet on one wrapping line.
  const items = Array.isArray(order.items) ? order.items : [];
  const lines = items.map((it) => {
    const opts = Array.isArray(it.selectedOptions) ? it.selectedOptions : [];
    const optText = opts.length
      ? ' (' + opts.map((o) => `${o.name}: ${o.value}`).join(', ') + ')'
      : '';
    const qty = ` ×${it.quantity || 1}`;
    return `• ${it.name}${optText}${qty}`;
  });
  let products = lines.join('  ') || '-';

  // Safety: keep well within WhatsApp's body length limit. If an order is huge,
  // list as much as fits and note the rest (the total still covers everything).
  const MAX = 900;
  if (products.length > MAX) {
    products = products.slice(0, MAX).replace(/\s+\S*$/, '') + ' …وأصناف أخرى';
  }

  return { phone, name: String(name).split(' ')[0], orderNumber, total, products };
}
