// Check: are Bosta deliveries marked Delivered on Ecwid?
//
// GET /dashboard/bosta-ecwid/check?days=21        → report only
// GET /dashboard/bosta-ecwid/check?days=21&fix=1  → also set Delivered + Paid on
//     the Ecwid orders Bosta says were delivered (marked as done by the
//     automation, so the sheet doesn't count them as private-courier sales).
//
// Matching: tracking number on the Ecwid order first, then the receiver's phone.

import { listRecentDeliveries } from './bosta_list.js';
import { searchOrders, updateOrder } from './ecwid.js';
import { ecwidPhones, phoneKeys } from './phones.js';
import { markAuto } from './auto_marks.js';
import { store } from './store.js';

const DELIVERED = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const PAID = process.env.PAID_PAYMENT_STATUS || 'PAID';
const isDelivered = (d) => /\bdelivered\b/i.test(String(d?.state?.value ?? d?.state ?? ''));

function trackingOf(order) {
  const t = String(order.trackingNumber || '').trim();
  if (t) return t;
  for (const s of order.shipments || []) {
    const x = String(s?.trackingNumber || s?.tracking_number || '').trim();
    if (x) return x;
  }
  return '';
}

function deliveredAt(d) {
  const st = d.state || {};
  return String(d.deliveredAt || (typeof st.deliveryTime === 'string' ? st.deliveryTime : '') || d.updatedAt || '').slice(0, 10);
}

export async function checkBostaEcwid({ days = 21, fix = false } = {}) {
  const { deliveries } = await listRecentDeliveries({ sinceDays: days + 10 });
  const since = Date.now() - days * 86_400_000;
  const delivered = deliveries.filter((d) => isDelivered(d) && new Date(deliveredAt(d) || 0).getTime() >= since - 86_400_000);

  const orders = await searchOrders(Math.floor((Date.now() - (days + 30) * 86_400_000) / 1000));
  const byTracking = new Map();
  const byPhone = new Map();
  for (const o of orders) {
    const t = trackingOf(o);
    if (t) byTracking.set(t, o);
    for (const k of ecwidPhones(o)) (byPhone.get(k) || byPhone.set(k, []).get(k)).push(o);
  }
  const recs = new Map(store.list().map((r) => [String(r.orderId), r]));

  const ok = [], notMarked = [], noOrder = [];
  for (const d of delivered) {
    let o = byTracking.get(String(d.trackingNumber));
    let how = 'tracking';
    if (!o) {
      const keys = phoneKeys([d.receiver?.phone, d.receiver?.secondPhone, d.receiverPhone].filter(Boolean).join(' '));
      const cands = [...keys].flatMap((k) => byPhone.get(k) || []);
      // The newest order from that phone created before the delivery.
      o = cands.filter((c) => new Date(c.createDate || c.createTimestamp * 1000 || 0) <= new Date(deliveredAt(d) || Date.now()))
        .sort((a, b) => String(b.createDate).localeCompare(String(a.createDate)))[0];
      how = 'phone';
    }
    const row = { tracking: d.trackingNumber, delivered: deliveredAt(d), cod: d.cod ?? null };
    if (!o) { noOrder.push(row); continue; }
    const rec = recs.get(String(o.id));
    const item = { ...row, order: o.orderNumber || o.id, orderId: o.id, matchedBy: how, ecwid: o.fulfillmentStatus, payment: o.paymentStatus,
      watcher: rec ? rec.status : 'not watched', trackingOnEcwid: trackingOf(o) || null };
    if (o.fulfillmentStatus === DELIVERED) ok.push(item);
    else notMarked.push(item);
  }

  const fixed = [];
  if (fix) {
    for (const it of notMarked) {
      if (['RETURNED', 'WILL_NOT_DELIVER'].includes(it.ecwid)) continue; // never overwrite a manual return/cancel
      try {
        markAuto(it.orderId, 'delivered');
        await updateOrder(it.orderId, { fulfillmentStatus: DELIVERED, paymentStatus: PAID });
        fixed.push(it.order);
      } catch (e) { it.fixError = e.message; }
    }
  }

  // Why the watcher missed them, in one line each.
  const reasons = {};
  for (const it of notMarked) {
    const r = !it.trackingOnEcwid ? 'مفيش رقم تتبع بوسطة على أوردر Ecwid'
      : it.watcher === 'not watched' ? 'الأوردر مش في متابعة السيستم (اتأكد من غير رسالة التأكيد)'
      : `حالة المتابعة: ${it.watcher}`;
    reasons[r] = (reasons[r] || 0) + 1;
  }

  return {
    days, bostaDelivered: delivered.length,
    markedOnEcwid: ok.length, notMarked: notMarked.length, noEcwidOrder: noOrder.length,
    reasons, fixed, notMarkedList: notMarked, noEcwidOrderList: noOrder,
  };
}
