// Ecwid orders marked Delivered by hand → "مندوب خاص" sales rows, in the hourly
// sheet sync. An order counts here when:
//   - its fulfillment status is DELIVERED, changed on or after PRIVATE_AUTO_START;
//   - the automation didn't set it (Bosta / QP delivered, cancellations…) —
//     those are added from the carriers.
// Courier cost per order: PRIVATE_COURIER_FEE (default 230). A row already in the
// sheet (same ecwid:<number>) is never added twice.


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
export function pickManualPrivate(orders, { start = PRIVATE_AUTO_START, auto = () => false } = {}) {
  const picked = [];
  const skipped = [];
  for (const o of orders) {
    if (String(o.fulfillmentStatus) !== DELIVERED) continue;
    const day = cairoDay(o.updateTimestamp || o.updateDate);
    if (!day || day < start) continue;
    const id = String(o.id ?? o.orderNumber);
    if (auto(id) || auto(String(o.orderNumber))) continue; // closed by Bosta / QP automation
    picked.push({ order: o, day });
  }
  return { picked, skipped };
}

export async function manualPrivateSales(priceTable) {
  const [{ searchOrders }, { isAuto }, { privateSale }] = await Promise.all([
    import('./ecwid.js'), import('./auto_marks.js'), import('./sales_rows.js'),
  ]);
  const fromDay = Date.parse(PRIVATE_AUTO_START + 'T00:00:00+02:00');
  const from = Math.floor(Math.max(fromDay, Date.now() - LOOKBACK_DAYS * 864e5) / 1000);
  const orders = await searchOrders(from, null, 'updated');
  const { picked, skipped } = pickManualPrivate(orders, { auto: isAuto });
  const sales = picked.map(({ order, day }) => privateSale(order, priceTable, day, PRIVATE_COURIER_FEE));
  return { sales, skipped };
}
