import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneKeys, matchOrders, qpOutcome } from '../src/qp_ecwid.js';

const ecwid = (over) => ({
  id: 'ABC12', orderNumber: 'ABC12', total: 3399, paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'SHIPPED',
  createTimestamp: Date.parse('2026-11-01T10:00:00Z') / 1000, shippingPerson: { phone: '+20 115 722 0030' }, ...over,
});
const qp = (over) => ({ serial: 1, phone: '01157220030', total_amount: 3399, order_date: '2026-11-02', status: 'Delivered', collected: '2026-11-04', status_note: '', ...over });

test('phone: +20, a leading 0, spaces and Arabic digits are the same number', () => {
  assert.deepEqual([...phoneKeys('+20 122 335 0550')], ['1223350550']);
  assert.deepEqual([...phoneKeys('0 122 335 0550')], ['1223350550']);
  assert.deepEqual([...phoneKeys('01223350550')], ['1223350550']);
  assert.deepEqual([...phoneKeys('٠١٢٢٣٣٥٠٥٥٠')], ['1223350550']);
  assert.equal(phoneKeys('01157220030 / 01066609451').size, 2);
});

test('match by phone only — price and products are ignored (the NBAVU case)', () => {
  const nbavu = ecwid({ id: 'NBAVU', total: 3448, shippingPerson: { phone: '+20 122 335 0550' } });
  const m = matchOrders(qp({ phone: '0 122 335 0550', total_amount: 6800, order_date: '2026-11-05' }), [nbavu, ecwid()]);
  assert.deepEqual(m.orders.map((o) => o.id), ['NBAVU']);
});

test('every open order on the phone is included; finished ones and old ones are not', () => {
  const m = matchOrders(qp(), [
    ecwid({ id: 'A' }), ecwid({ id: 'B', total: 999 }),
    ecwid({ id: 'C', fulfillmentStatus: 'DELIVERED' }), ecwid({ id: 'D', paymentStatus: 'CANCELLED' }),
    ecwid({ id: 'E', createTimestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 }),
  ]);
  assert.deepEqual(m.orders.map((o) => o.id), ['A', 'B']);
  assert.ok(matchOrders(qp(), [ecwid({ fulfillmentStatus: 'RETURNED' })]).closed);
  assert.ok(matchOrders(qp({ phone: '' }), [ecwid()]).reason);
  assert.ok(matchOrders(qp(), [ecwid({ shippingPerson: { phone: '01000000000' } })]).reason);
});

test('QP outcomes: delivered, refused/cancelled/returned, still in progress', () => {
  assert.deepEqual(qpOutcome(qp()), { kind: 'delivered', day: '2026-11-04' });
  assert.equal(qpOutcome(qp({ status: 'Undelivered', collected: null, returned: '2026-11-05', status_note: 'رفض الاستلام ودفع الشحن100' })).kind, 'returned');
  assert.equal(qpOutcome(qp({ status: 'Undelivered', collected: null, returned: null, status_note: 'لاغى' })).kind, 'returned');
  assert.equal(qpOutcome(qp({ status: 'Delivered', total_amount: 0, returned: '2026-11-06' })).kind, 'returned');
  assert.equal(qpOutcome(qp({ status: 'Undelivered', collected: null, status_note: 'مجاش من الشركة' })), null);
  assert.equal(qpOutcome(qp({ status: 'Pending', collected: null })), null);
  assert.equal(qpOutcome(qp({ status: 'Undelivered', collected: null, returned: null, status_note: 'تاجيل غدا' })), null);
});

test('QP customers get the same messages as Bosta: offer when delivered, reason question when refused — once, from the start day', async () => {
  const { messagesToSend, qpCustomerNumber } = await import('../src/qp_ecwid.js');
  assert.equal(qpCustomerNumber('01012345678 / 01122223333'), '201012345678');
  assert.equal(qpCustomerNumber('+20 101 234 5678'), '201012345678');
  assert.equal(qpCustomerNumber(''), null);
  const orders = [
    { serial: 1, status: 'Delivered', collected: '2026-11-10', total_amount: 3400, phone: '01012345678' },
    { serial: 2, status: 'Undelivered', returned: '2026-11-10', status_note: 'رفض الاستلام', phone: '01122223333' },
    { serial: 3, status: 'Delivered', collected: '2026-11-08', total_amount: 3400, phone: '01000000000' }, // before start
    { serial: 4, status: 'Delivered', collected: '2026-11-10', total_amount: 3400, phone: '01055555555' }, // already messaged
  ];
  const out = messagesToSend(orders, { 4: { kind: 'delivered' } }, '2026-11-10');
  assert.deepEqual(out.map((m) => [m.serial, m.kind, m.to]), [['1', 'delivered', '201012345678'], ['2', 'returned', '201122223333']]);
});
