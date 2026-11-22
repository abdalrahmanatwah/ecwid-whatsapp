import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
process.env.STORE_FILE = join(dir, 'orders.json');
process.env.AUTO_MARKS_FILE = join(dir, 'marks.json');

test('shipped orders with a tracking number get watched even if the poll was never answered', async () => {
  const { store } = await import('../src/store.js');
  const { adoptShippedOrders } = await import('../src/ecwid_tracking.js');
  store.upsert('A1', { status: 'poll_sent', to: '201000000001', orderNumber: 11 });
  store.upsert('B2', { status: 'tracking', bostaTracking: '999' });
  store.upsert('C3', { status: 'delivered' });
  const orders = [
    { id: 'A1', orderNumber: 11, fulfillmentStatus: 'SHIPPED', trackingNumber: '5306148228' },
    { id: 'B2', orderNumber: 12, fulfillmentStatus: 'SHIPPED', trackingNumber: '999' },
    { id: 'C3', orderNumber: 13, fulfillmentStatus: 'SHIPPED', trackingNumber: '777' },
    { id: 'D4', orderNumber: 14, fulfillmentStatus: 'SHIPPED', trackingNumber: '888', billingPerson: { phone: '01012345678' } },
    { id: 'E5', orderNumber: 15, fulfillmentStatus: 'DELIVERED', trackingNumber: '555' },
    { id: 'F6', orderNumber: 16, fulfillmentStatus: 'PROCESSING' },
  ];
  const adopted = await adoptShippedOrders({ now: Date.now(), search: async () => orders });
  assert.deepEqual(adopted, [11, 14]);
  const recs = Object.fromEntries(store.list().map((r) => [r.orderId, r]));
  assert.equal(recs.A1.status, 'tracking'); assert.equal(recs.A1.bostaTracking, '5306148228'); assert.equal(recs.A1.to, '201000000001');
  assert.equal(recs.D4.bostaTracking, '888'); assert.ok(recs.D4.to.endsWith('1012345678'));
  assert.equal(recs.C3.status, 'delivered');
  // Throttled: a second call right away does nothing.
  assert.deepEqual(await adoptShippedOrders({ now: Date.now(), search: async () => orders }), []);
});
