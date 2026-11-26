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

// GET /orders?createdFrom=...&createdTo=... (or updatedFrom/updatedTo) — orders in a
// window (UNIX seconds). toUnix is optional (omit for "from X to now"). dateField picks
// which Ecwid date filter to use: 'created' = order placement date (default, used by the
// poller), 'updated' = last status change date (used by the dashboard to find orders that
// RESOLVED — delivered/returned/cancelled — within a window, regardless of when they were
// originally placed). Pages through results so a busy window never gets truncated at 100.
export async function searchOrders(fromUnix, toUnix, dateField = 'created') {
  const fromKey = dateField === 'updated' ? 'updatedFrom' : 'createdFrom';
  const toKey = dateField === 'updated' ? 'updatedTo' : 'createdTo';
  const limit = 100;
  let offset = 0;
  const all = [];
  while (true) {
    const params = new URLSearchParams({
      [fromKey]: String(fromUnix),
      limit: String(limit),
      offset: String(offset),
      sortBy: 'DATE_ASC',
    });
    if (toUnix) params.set(toKey, String(toUnix));
    const res = await fetch(`${BASE}/orders?${params.toString()}`, { headers: authHeaders() });
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

// Read-only: all products with price, old (compare-to) price and stock.
export async function listProductPrices() {
  const out = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const res = await fetch(`${BASE}/products?limit=100&offset=${offset}&responseFields=total,count,items(id,name,price,compareToPrice,quantity,unlimited,inStock,enabled,updated,categoryIds,combinations(quantity,inStock,price,compareToPrice,defaultDisplayedPrice))`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Ecwid products failed: ${res.status}`);
    const j = await res.json();
    for (const p of j.items || []) {
      const combos = p.combinations || [];
      const stock = combos.length ? combos.reduce((s, c) => s + (Number(c.quantity) || 0), 0) : (p.unlimited ? null : p.quantity ?? null);
      const comboPrices = [...new Set(combos.map((c) => c.price).filter((v) => v != null))];
      out.push({ id: p.id, name: p.name, price: p.price, oldPrice: p.compareToPrice || null, stock, enabled: p.enabled, inStock: p.inStock, updated: p.updated, cats: p.categoryIds || [], combos: combos.length, comboPrices });
    }
    if (offset + (j.count || 0) >= (j.total || 0) || !j.count) break;
  }
  return out;
}

// Storefront list: every enabled, in-stock product, for the home page "all
// products" section. Cached for 10 minutes.
let storefrontCache = { at: 0, items: null };
export async function storefrontProducts() {
  if (storefrontCache.items && Date.now() - storefrontCache.at < 10 * 60_000) return storefrontCache.items;
  const out = [];
  for (let offset = 0; offset < 3000; offset += 100) {
    const res = await fetch(`${BASE}/products?enabled=true&inStock=true&limit=100&offset=${offset}&sortBy=ADDED_TIME_DESC&responseFields=total,count,items(id,name,url,price,compareToPrice,hdThumbnailUrl,thumbnailUrl,imageUrl,ribbon,galleryImages(url,hdThumbnailUrl),inStock,enabled)`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Ecwid products failed: ${res.status}`);
    const j = await res.json();
    for (const p of j.items || []) {
      if (!p.enabled || p.inStock === false) continue;
      const g = (p.galleryImages || [])[0];
      out.push({ id: p.id, name: p.name, url: p.url, price: p.price, old: p.compareToPrice > p.price ? p.compareToPrice : null,
        img: p.hdThumbnailUrl || p.imageUrl || p.thumbnailUrl || '', img2: g ? (g.hdThumbnailUrl || g.url) : '', ribbon: p.ribbon?.text || '' });
    }
    if (offset + (j.count || 0) >= (j.total || 0) || !j.count) break;
  }
  storefrontCache = { at: Date.now(), items: out };
  return out;
}

// Read-only: categories (id, name, parent).
export async function listCategories() {
  const res = await fetch(`${BASE}/categories?limit=100&responseFields=items(id,name,parentId,enabled)`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Ecwid categories failed: ${res.status}`);
  return (await res.json()).items || [];
}
