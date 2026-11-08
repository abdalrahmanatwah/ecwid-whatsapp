import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneKeys, matchOrder } from '../src/qp_ecwid.js';

const ecwid = (over) => ({
  id: 'ABC12', orderNumber: 'ABC12', total: 3399, paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'SHIPPED',
  createTimestamp: Date.parse('2026-11-01T10:00:00Z') / 1000, shippingPerson: { phone: '+20 115 722 0030' }, ...over,
});
const qp = (over) => ({ serial: 1, phone: '01157220030', total_amount: 3399, order_date: '2026-11-02', status: 'Delivered', collected: '2026-11-04', ...over });

test('phone keys ignore +20 / 0 prefixes, spaces and Arabic digits; several numbers in one field', () => {
  assert.deepEqual([...phoneKeys('+20 115 722 0030')], ['1157220030']);
  assert.deepEqual([...phoneKeys('01157220030')], ['1157220030']);
  assert.deepEqual([...phoneKeys('٠١١٥٧٢٢٠٠٣٠')], ['1157220030']);
  assert.equal(phoneKeys('01157220030 / 01066609451').size, 2);
  assert.equal(phoneKeys('').size, 0);
});

test('matches the open Ecwid order with the same phone', () => {
  assert.equal(matchOrder(qp(), [ecwid(), ecwid({ id: 'X', shippingPerson: { phone: '01000000000' } })]).orders[0].id, 'ABC12');
});

test('several orders on one phone: the closest total wins, otherwise left for the merchant', () => {
  const two = [ecwid({ id: 'A', total: 6550 }), ecwid({ id: 'B', total: 3399 })];
  assert.deepEqual(matchOrder(qp(), two).orders.map((o) => o.id), ['B']);
  const tie = [ecwid({ id: 'A', total: 3300 }), ecwid({ id: 'B', total: 3300 })];
  assert.ok(matchOrder(qp({ total_amount: 3300 }), tie).reason);
  assert.ok(matchOrder(qp({ total_amount: 9000 }), two).reason);
});

test('cancelled / already delivered / too old / no phone are never marked', () => {
  assert.ok(matchOrder(qp(), [ecwid({ paymentStatus: 'CANCELLED' })]).reason);
  assert.ok(matchOrder(qp(), [ecwid({ fulfillmentStatus: 'DELIVERED' })]).alreadyDelivered);
  assert.ok(matchOrder(qp(), [ecwid({ createTimestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 })]).reason);
  assert.ok(matchOrder(qp({ phone: '' }), [ecwid()]).reason);
});

test('+20 and a leading 0 are the same number (the NBAVU example)', () => {
  assert.deepEqual([...phoneKeys('+20 122 335 0550')], [...phoneKeys('0 122 335 0550')]);
});

test('two Ecwid orders shipped together in one QP shipment are both marked', () => {
  const a = ecwid({ id: 'A', total: 3448 });
  const b = ecwid({ id: 'B', total: 3350 });
  const m = matchOrder(qp({ total_amount: 6800 }), [a, b]);
  assert.deepEqual(m.orders.map((o) => o.id).sort(), ['A', 'B']);
});

test('totals differ (pair added outside Ecwid) but the products are in the QP contents → marked', () => {
  const nbavu = ecwid({ id: 'NBAVU', total: 3448, shippingPerson: { phone: '+20 122 335 0550' }, items: [{ name: 'Adidas HYPERBOOST EDGE Running Shoes - Blue White' }] });
  const shipment = qp({ phone: '0 122 335 0550', total_amount: 6800, order_date: '2026-11-05',
    shipment_contents: 'Adidas Adizero EVO SL ATR - Blue Black Size: 43⅓ // Adidas HYPERBOOST EDGE Running Shoes - Blue White Size: 41 // 2 Comfort Foam Insoles' });
  assert.deepEqual(matchOrder(shipment, [nbavu]).orders.map((o) => o.id), ['NBAVU']);
  // a different product on the same phone is not marked
  const other = ecwid({ id: 'Z', total: 3448, shippingPerson: { phone: '+20 122 335 0550' }, items: [{ name: 'Nike Vomero Premium' }] });
  assert.ok(matchOrder(shipment, [other]).reason);
});
