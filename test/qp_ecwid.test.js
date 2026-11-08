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
  assert.equal(matchOrder(qp(), [ecwid(), ecwid({ id: 'X', shippingPerson: { phone: '01000000000' } })]).order.id, 'ABC12');
});

test('several orders on one phone: the closest total wins, otherwise left for the merchant', () => {
  const two = [ecwid({ id: 'A', total: 6550 }), ecwid({ id: 'B', total: 3399 })];
  assert.equal(matchOrder(qp(), two).order.id, 'B');
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
