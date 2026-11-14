import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickManualPrivate, cairoDay } from '../src/private_delivered.js';

const o = (x) => ({ id: 'A1', orderNumber: 101, fulfillmentStatus: 'DELIVERED', updateTimestamp: Date.parse('2026-11-14T10:00:00Z') / 1000, phone: '01011112222', items: [], ...x });

test('Cairo day of an Ecwid date', () => {
  assert.equal(cairoDay('2026-11-14 23:30:00 +0000'), '2026-11-15');
  assert.equal(cairoDay(Date.parse('2026-11-14T10:00:00Z') / 1000), '2026-11-14');
});

test('hand-marked private deliveries only', () => {
  const orders = [
    o({}),
    o({ id: 'B2', orderNumber: 102, fulfillmentStatus: 'PROCESSING' }),
    o({ id: 'C3', orderNumber: 103, updateTimestamp: Date.parse('2026-11-10T10:00:00Z') / 1000 }),
    o({ id: 'D4', orderNumber: 104 }),
    o({ id: 'E5', orderNumber: 105, trackingNumber: '12345' }),
    o({ id: 'F6', orderNumber: 106, phone: '+20 109 999 8888' }),
    o({ id: 'G7', orderNumber: 107 }),
  ];
  const { picked, skipped } = pickManualPrivate(orders, {
    start: '2026-11-14',
    auto: (id) => id === 'D4',
    bosta: (id) => id === 'G7',
    qpPhones: new Set(['1099998888']),
  });
  assert.deepEqual(picked.map((p) => p.order.id), ['A1']);
  assert.equal(picked[0].day, '2026-11-14');
  assert.deepEqual(skipped.map((s) => s.id).sort(), [105, 106, 107]);
});
