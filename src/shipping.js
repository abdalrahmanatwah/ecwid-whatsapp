// Ships a confirmed order via Bosta, then marks it Shipped in Ecwid.
// Called by the poller once an order has passed the confirmation grace period.
//
// Safety rules:
//  - Re-checks the order is STILL 'confirmed' right before shipping, so an order
//    the customer cancelled during the grace window is never shipped.
//  - Only single-product orders (1 item, qty 1) auto-ship; others are left for
//    manual handling and marked so they aren't re-checked every minute.
//  - Never throws: any failure is recorded + the merchant is alerted, and the
//    order stays in Processing. Failures are terminal (no auto-retry) to avoid
//    creating duplicate shipments.

import { getOrder, updateOrder } from './ecwid.js';
import { createDeliveryFromOrder, bostaConfigured } from './bosta.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const SHIPPED_STATUS = process.env.SHIPPED_FULFILLMENT_STATUS || 'SHIPPED';

export async function shipOrderViaBosta(orderId) {
  if (!bostaConfigured()) return;

  // Re-read state at ship time — the customer may have cancelled during the grace period.
  const rec = store.get(orderId);
  if (!rec || rec.status !== 'confirmed') {
    console.log(`[bosta] order ${orderId} is '${rec?.status}', not 'confirmed' — not shipping`);
    return;
  }

  try {
    const order = await getOrder(orderId);
    const items = Array.isArray(order.items) ? order.items : [];

    // Single product = exactly one line item with quantity 1.
    const isSingleProduct = items.length === 1 && Number(items[0]?.quantity) === 1;
    if (!isSingleProduct) {
      store.upsert(orderId, { status: 'ship_skipped_multi' });
      console.log(`[bosta] order ${orderId} is not single-product (${items.length} items) — left for manual shipping`);
      return;
    }

    const { trackingNumber, deliveryId, dryRun } = await createDeliveryFromOrder(order);

    // Dry run: we built and logged the payload but created no real shipment.
    // Don't mark Ecwid shipped — just record it so we don't loop, and alert.
    if (dryRun) {
      store.upsert(orderId, { status: 'dry_run' });
      await notifyMerchant(`🧪 DRY RUN: order ${orderId} would ship via Bosta (no real shipment created). Check the logs to verify the address/COD.`);
      console.log(`[bosta] DRY RUN complete for order ${orderId} — no shipment created`);
      return;
    }

    await updateOrder(orderId, {
      fulfillmentStatus: SHIPPED_STATUS,
      trackingNumber: trackingNumber || undefined,
    });
    store.upsert(orderId, { status: 'shipped', bostaTracking: trackingNumber, bostaId: deliveryId });
    await notifyMerchant(`🚚 Order ${orderId} shipped via Bosta. Tracking: ${trackingNumber || deliveryId || 'created'}`);
    console.log(`[bosta] order ${orderId} shipped, tracking ${trackingNumber}`);
  } catch (err) {
    store.upsert(orderId, { status: 'ship_failed', shipError: err.message });
    await notifyMerchant(`⚠️ Order ${orderId} confirmed but Bosta shipment FAILED — please create it manually. Reason: ${err.message}`);
    console.error(`[bosta] order ${orderId} ship failed:`, err.message);
  }
}
