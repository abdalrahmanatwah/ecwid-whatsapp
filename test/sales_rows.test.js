import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countInsoles, shoeItems, lookupModelPrice, normalizeBosta, normalizeQp, classify,
  saleRowValues, sheetSerial, cairoDate,
} from '../src/sales_rows.js';

const PRICES = [
  { key: 'hyperboost ephr', price: 1450 },
  { key: 'edge xt', price: 1300 },
  { key: 'adizero evo sl', price: 1100 },
];

const bosta = (over) => normalizeBosta({
  trackingNumber: '111', type: 'SEND', state: { value: 'Delivered' }, cod: 3400,
  description: 'ADIDAS HYPERBOOST EPHR - Core Black Size: 43⅓',
  createdAt: '2026-10-19T11:00:00+03:00', deliveredAt: '2026-10-20T15:00:00+03:00', ...over,
});

const qp = (over) => normalizeQp({
  serial: 222, total_amount: 3000, total_fees: 100, status: 'Delivered', collected: '2026-10-21',
  returned: null, order_date: '2026-10-17', shipment_contents: 'Adidas Adizero EVO SL ATR - Blue Black Size: 42',
  status_note: '', ...over,
});

test('insole counts come from every wording the carriers use, never from the size', () => {
  assert.equal(countInsoles('X Size: 41 // 2 Comfort Foam Insoles'), 2);
  assert.equal(countInsoles('X Size: 40 Comfort Foam Insoles / فرش طبي: 1'), 1);
  assert.equal(countInsoles('X Size: 42 // 1 فرش'), 1);
  assert.equal(countInsoles('X Size: 44 Comfort Foam Insoles 1 item'), 1);
  assert.equal(countInsoles('X Size: 44 Comfort Foam Insoles'), 0); // 44 is a size
  assert.equal(countInsoles('X Size 45⅓'), 0);
});

test('items: "//" and " + " split items, a single "/" between sizes does not', () => {
  assert.equal(shoeItems('Nike Vomero Premium Size: 42 // Adidas HYPERBOOST Size: 42').length, 2);
  assert.equal(shoeItems('ASICS COURT FF 3 Size: 40½ / 40 // 1 Comfort Foam Insoles').length, 1);
  assert.equal(shoeItems('asics 43 / on cloud 43').length, 2);
  assert.deepEqual(shoeItems('Tennis Bag'), []);
});

test('model price: longest matching key wins, unknown models fall back to brand default', () => {
  assert.equal(lookupModelPrice('Adidas EDGE XT Limited Edition', [...PRICES, { key: 'edge', price: 999 }]).price, 1300);
  assert.equal(lookupModelPrice('Adidas HYPERBOOST PRO 2', PRICES), null);
});

test('a delivered Bosta order with money collected becomes a sale on its delivery date', () => {
  const c = classify(bosta(), PRICES);
  assert.equal(c.action, 'sale');
  assert.equal(c.date, '2026-10-20');
  assert.equal(c.brand, 'ADIDAS');
  assert.deepEqual(c.costs, [{ price: 1450 }]);
  assert.match(c.note, /شحن تقديري/);
});

test('zero collection, non-shoes and unclear descriptions go to review, not the sales log', () => {
  assert.equal(classify(bosta({ cod: 0 }), PRICES).action, 'review');
  assert.equal(classify(bosta({ description: 'Tennis Bag', cod: 3600 }), PRICES).action, 'review');
  assert.equal(classify(bosta({ description: 'shoe 40', cod: 2850 }), PRICES).action, 'review');
  assert.equal(classify(bosta({ description: 'Comfort Foam Insole', cod: 350 }), PRICES).action, 'review');
});

test('two pairs listed but one pair paid → review as a partial delivery', () => {
  const c = classify(qp({ total_amount: 2900, shipment_contents: 'asics 43 / on cloud 43', status_note: 'حسابه 2900ومرتجع' }), PRICES);
  assert.equal(c.action, 'review');
});

test('refused and returned shipments are counted as returns by their creation date', () => {
  const r1 = classify(bosta({ type: 'RTO', oldType: 'SEND', state: { value: 'Returned to origin' }, cod: 0 }), PRICES);
  assert.equal(r1.action, 'return');
  assert.equal(r1.date, '2026-10-19');
  const r2 = classify(qp({ status: 'Undelivered', collected: null, returned: '2026-10-20', status_note: 'رفض الاستلام ودفع الشحن100' }), PRICES);
  assert.equal(r2.action, 'return');
  // never picked up from the warehouse → not a return
  assert.equal(classify(qp({ status: 'Undelivered', collected: null, status_note: 'مجاش من الشركة' }), PRICES).action, 'skip');
  // delivered with nothing collected and then returned → a return
  assert.equal(classify(qp({ total_amount: 0, returned: '2026-10-20' }), PRICES).action, 'return');
});

test('QP fee lines and return-pickup lines are ignored', () => {
  assert.equal(classify(qp({ shipment_contents: 'رسوم', total_amount: 0 }), PRICES).action, 'skip');
  assert.equal(classify(bosta({ type: 'CUSTOMER_RETURN_PICKUP', state: { value: 'Returned' } }), PRICES).action, 'skip');
});

test('sale row: live formulas, real QP fee, Bosta estimate cell, shipment id in column Q', () => {
  const rowQ = saleRowValues(classify(qp(), PRICES), 70);
  assert.equal(rowQ[0], sheetSerial('2026-10-21'));
  assert.equal(rowQ[6], 100);
  assert.equal(rowQ[7], '=F70-G70');
  assert.equal(rowQ[8], "=1100+E70*'الافتراضات'!$B$8");
  assert.equal(rowQ[16], 'qp:222');
  const rowB = saleRowValues(classify(bosta({ description: 'Adidas HYPERBOOST PRO 2 Size: 45' }), PRICES), 71);
  assert.equal(rowB[6], "='الافتراضات'!$B$9");
  assert.equal(rowB[8], "='الافتراضات'!$B$4+E71*'الافتراضات'!$B$8");
});

test('dates: Cairo calendar day and Sheets serial', () => {
  assert.equal(cairoDate('2026-10-20T22:30:00Z'), '2026-10-21'); // after midnight in Cairo
  assert.equal(sheetSerial('2026-10-14'), 46309); // matches the existing sheet
});

test('QP Delivered before the collected date is filled: dated by when we saw it change', () => {
  const seen = { status: 'Delivered', collected: null, first_seen_at: '2026-10-24T09:00:00Z', status_changed_at: '2026-10-25T15:10:00Z' };
  const c = classify(qp(seen), PRICES);
  assert.equal(c.action, 'sale');
  assert.equal(c.date, '2026-10-25');
  // imported already Delivered with no date → not guessed
  const imported = { status: 'Delivered', collected: null, first_seen_at: '2026-10-23T13:14:00Z', status_changed_at: '2026-10-23T13:14:00Z' };
  assert.equal(classify(qp(imported), PRICES).action, 'skip');
});

test('ON The Roger Pro is recognised however it is written', async () => {
  const { detectBrand } = await import('../src/sales_rows.js');
  for (const t of ['on fire 44', 'On The Roger Pro Fire Currant Blue Horizon Size: 45', 'on roger 45', 'ON Cloud Tilt Remix All Day Trainers']) {
    assert.equal(detectBrand(t), 'ON', t);
  }
  assert.equal(detectBrand('Nike Court Air Zoom Vapor 11'), 'NIKE');
  assert.equal(detectBrand('3 T-shirts'), null);
});

test('"on fire 44" becomes an ON The Roger Pro sale the supplier section can count', () => {
  const c = classify(bosta({ description: 'on fire 44', cod: 3000 }), [{ key: 'roger pro', price: 1850 }]);
  assert.equal(c.action, 'sale');
  assert.equal(c.brand, 'ON');
  assert.match(c.name, /Roger Pro/);
  assert.deepEqual(c.costs, [{ price: 1850 }]);
});
