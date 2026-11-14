// Ecwid orders marked Delivered by hand → "مندوب خاص" sales rows, in the hourly
// sheet sync. Bosta and QP shipments are left alone (the sync adds those from the
// carriers), so an order only counts here when:
//   - its fulfillment status is DELIVERED, changed on or after PRIVATE_AUTO_START;
//   - the automation didn't set it (Bosta / QP delivered, cancellations…);
//   - it has no Bosta tracking number (on Ecwid or in our order records);
//   - no QP shipment went to the same phone number.
// Courier cost per order: PRIVATE_COURIER_FEE (default 230). A row already in the
// sheet (same ecwid:<number>) is never added twice.

import { phoneKeys, ecwidPhones } from './phones.js';

export const PRIVATE_AUTO_START = process.env.PRIVATE_AUTO_START || '2026-11-14';
export const PRIVATE_COURIER_FEE = Number(process.env.PRIVATE_COURIER_FEE ?? 230);
const DELIVERED = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const LOOKBACK_DAYS = 14;

// Cairo calendar day (YYYY-MM-DD) of an Ecwid date ("2026-11-14 13:05:00 +0000") or unix seconds.
export function cairoDay(v) {
  const t = typeof v === 'number' ? v * 1000 : Date.parse(String(v || '').replace(' ', 'T').replace(' +0000', 'Z'));
  if (Number.isNaN(t)) return null;
  return new Date(t + 2 * 3600e3).toISOString().slice(0, 10);
}

// Pure filter, so it can be tested: which orders are hand-marked private deliveries.
export function pickManualPrivate(orders, { start = PRIVATE_AUTO_START, auto = () => false, bosta = () => false, qpPhones = new Set() } = {}) {
  const picked = [];
  const skipped = [];
  for (const o of orders) {
    if (String(o.fulfillmentStatus) !== DELIVERED) continue;
    const day = cairoDay(o.updateTimestamp || o.updateDate);
    if (!day || day < start) continue;
    const id = String(o.id ?? o.orderNumber);
    const label = o.orderNumber || o.id;
    if (auto(id) || auto(String(o.orderNumber))) continue; // closed by Bosta / QP automation
    if (String(o.trackingNumber || '').trim() || bosta(id)) { skipped.push({ id: label, reason: 'عليه رقم شحنة بوسطة' }); continue; }
    if ([...ecwidPhones(o)].some((k) => qpPhones.has(k))) { skipped.push({ id: label, reason: 'نفس رقم تليفون شحنة QP' }); continue; }
    picked.push({ order: o, day });
  }
  return { picked, skipped };
}

export async function manualPrivateSales(priceTable) {
  const [{ searchOrders }, { isAuto }, { store }, { allQpOrders }, { privateSale }] = await Promise.all([
    import('./ecwid.js'), import('./auto_marks.js'), import('./store.js'), import('./qp_orders.js'), import('./sales_rows.js'),
  ]);
  const fromDay = Date.parse(PRIVATE_AUTO_START + 'T00:00:00+02:00');
  const from = Math.floor(Math.max(fromDay, Date.now() - LOOKBACK_DAYS * 864e5) / 1000);
  const orders = await searchOrders(from, null, 'updated');
  const qpPhones = new Set();
  for (const q of allQpOrders()) for (const k of phoneKeys(q.phone)) qpPhones.add(k);
  const { picked, skipped } = pickManualPrivate(orders, {
    auto: isAuto,
    bosta: (id) => Boolean(store.get(id)?.bostaTracking),
    qpPhones,
  });
  const sales = picked.map(({ order, day }) => privateSale(order, priceTable, day, PRIVATE_COURIER_FEE));
  return { sales, skipped };
}
