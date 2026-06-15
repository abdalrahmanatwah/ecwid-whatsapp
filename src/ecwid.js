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

// GET /carts — abandoned carts (incomplete checkouts). Returns an array.
export async function searchAbandonedCarts(createdFromUnix) {
  const params = new URLSearchParams({ limit: '100' });
  if (createdFromUnix) params.set('createdFrom', String(createdFromUnix));
  const res = await fetch(`${BASE}/carts?${params.toString()}`, { headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ecwid searchCarts failed: ${res.status} ${t.slice(0, 150)}`);
  }
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

// GET /products/{id} — used to read a size variation's current stock.
export async function getProduct(productId) {
  const res = await fetch(`${BASE}/products/${productId}`, { headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ecwid getProduct ${productId} failed: ${res.status} ${t.slice(0, 120)}`);
  }
  return res.json();
}

// POST /products/{productId}/inventory (or .../combinations/{combinationId}/inventory)
// Adjusts stock by a RELATIVE delta. For a size variation pass its combinationId;
// for a base product pass combinationId = 0/null. Ecwid ignores this for items whose
// stock is "Unlimited", so it's safe to call regardless.
export async function adjustInventory(productId, combinationId, quantityDelta) {
  const path = combinationId
    ? `${BASE}/products/${productId}/combinations/${combinationId}/inventory`
    : `${BASE}/products/${productId}/inventory`;
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ quantityDelta }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Ecwid adjustInventory ${productId}${combinationId ? '/' + combinationId : ''} failed: ${res.status} ${text}`
    );
  }
  return res.json(); // { updateCount: 1 }
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
