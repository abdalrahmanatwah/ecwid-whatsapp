import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, unitsInRow, parseDate, serialToDate, speed } from '../src/purchases.js';

test('dates as typed in the sheet', () => {
  assert.equal(parseDate('1/11', 2026), '2026-11-01');
  assert.equal(parseDate('3/11/2026'), '2026-11-03');
  assert.equal(parseDate(46327), '2026-11-01');
  assert.equal(serialToDate(46309), '2026-10-14');
});

test('model name matches however it is written; one-brand rows use the pair count', () => {
  assert.equal(unitsInRow('Adidas HYPERBOOST EDGE Running Shoes Size: 42', 'Hyperboost', [0, 1, 0, 0, 0]), 1);
  assert.equal(unitsInRow('Adidas Hyper Boost Edge - Black 44', 'Hyperboost', [0, 1, 0, 0, 0]), 1);
  assert.equal(unitsInRow('Adidas Hyperboost 42 / 43', 'hyperboost', [0, 2, 0, 0, 0]), 2);
  assert.equal(unitsInRow('Hyperboost 44 + Nike Vomero 44', 'Hyperboost', [0, 1, 1, 0, 0]), 1);
  assert.equal(unitsInRow('ASICS Court FF 3', 'Hyperboost', [1, 0, 0, 0, 0]), 0);
});

test('sales count from the purchase date, oldest purchase first, never more than bought', () => {
  const purchases = [
    { row: 5, date: '2026-11-01', key: 'Hyperboost', qty: 2 },
    { row: 6, date: '2026-11-10', key: 'Hyperboost', qty: 5 },
  ];
  const sales = [
    { date: '2026-10-30', name: 'Hyperboost 42', pairs: [0, 1, 0, 0, 0] }, // before any purchase
    { date: '2026-11-02', name: 'Hyperboost 43', pairs: [0, 1, 0, 0, 0] },
    { date: '2026-11-05', name: 'Hyperboost 44', pairs: [0, 1, 0, 0, 0] },
    { date: '2026-11-06', name: 'Hyperboost 45', pairs: [0, 1, 0, 0, 0] }, // first lot sold out, second not bought yet
    { date: '2026-11-12', name: 'Hyperboost 42 / 43', pairs: [0, 2, 0, 0, 0] },
  ];
  const r = allocate(purchases, sales);
  assert.equal(r[5].sold, 2); assert.equal(r[5].last, '2026-11-05');
  assert.equal(r[6].sold, 2); assert.equal(r[6].last, '2026-11-12');
});

test('a row with two different models of the same brand counts only the named one', () => {
  assert.equal(unitsInRow('Adidas Adizero EVO SL ATR Size: 43 + Adidas HYPERBOOST EDGE Size: 41', 'Hyperboost', [0, 2, 0, 0, 0]), 1);
  assert.equal(unitsInRow('Adidas HYPERBOOST PRO 2 Size: 43 + Adidas HYPERBOOST Waterproof PRO Size: 43', 'Hyperboost', [0, 2, 0, 0, 0]), 2);
});

test('a row with two bought models counts against both; "Adidas EDGE" is not "Hyperboost EDGE"', () => {
  const purchases = [
    { row: 5, date: '2026-11-01', key: 'Hyperboost', qty: 10 },
    { row: 6, date: '2026-11-01', key: 'Adidas EDGE', qty: 10 },
  ];
  const sales = [
    { date: '2026-11-03', name: 'Adidas HYPERBOOST EDGE Running Shoes 42', pairs: [0, 1, 0, 0, 0] },
    { date: '2026-11-04', name: 'Adidas HYPERBOOST PRO 43 + Adidas EDGE Limited Edition 43', pairs: [0, 2, 0, 0, 0] },
  ];
  const r = allocate(purchases, sales);
  assert.equal(r[5].sold, 2);
  assert.equal(r[6].sold, 1);
});

test('other spellings of a model after "|"', () => {
  assert.equal(unitsInRow('rebook 43', 'Reebok Float | rebook', [0, 0, 0, 0, 1]), 1);
  assert.equal(unitsInRow('Reebok Float Ride Energy X Size: 43', 'Reebok Float | rebook', [0, 0, 0, 0, 1]), 1);
  const r = allocate([{ row: 9, date: '2026-11-01', key: 'Reebok Float | rebook', qty: 15 }],
    [{ date: '2026-11-09', name: 'rebook 43', pairs: [0, 0, 0, 0, 1] }]);
  assert.equal(r[9].sold, 1);
});

test('cash view: money collected pays back the invoice first, then it is profit, reported every 2 months', async () => {
  const { cashCycles, addMonths } = await import('../src/purchases.js');
  assert.equal(addMonths('2026-09-15', 2), '2026-11-15');
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28');
  // 5 pairs for 6,000; 3 sold for 3,000 each (after shipping)
  const p = { date: '2026-09-15', price: 1200, qty: 5 };
  const units = [{ date: '2026-09-20', revenue: 3000 }, { date: '2026-10-10', revenue: 3000 }, { date: '2026-12-01', revenue: 3000 }];
  const r = cashCycles(p, units, '2026-12-05', 2);
  assert.equal(r.collected, 9000);
  assert.equal(r.paidBackOn, '2026-10-10');
  assert.equal(r.cycles.length, 2);
  assert.deepEqual(r.cycles[0], { n: 1, from: '2026-09-15', to: '2026-11-14', sold: 2, collected: 6000, cum: 6000, recovered: 6000, left: 0, profit: 0 });
  assert.deepEqual(r.cycles[1], { n: 2, from: '2026-11-15', to: '2027-01-14', sold: 1, collected: 3000, cum: 9000, recovered: 6000, left: 0, profit: 3000 });
});

test('a row\'s money is split over its pairs', () => {
  const r = allocate([{ row: 5, date: '2026-11-01', key: 'Hyperboost', qty: 10 }],
    [{ date: '2026-11-02', name: 'Adidas Hyperboost 42 + Nike Vomero 43', pairs: [0, 1, 1, 0, 0], net: 6000 }]);
  assert.equal(r[5].units[0].revenue, 3000);
});

test('a hand count adjusts the money: extra pairs at the average, fewer pairs drop the latest', async () => {
  const { adjustUnits } = await import('../src/purchases.js');
  const u = [{ date: '2026-10-01', revenue: 3000 }, { date: '2026-10-05', revenue: 3400 }];
  assert.equal(adjustUnits(u, 1, '2026-11-09').map((x) => x.revenue).join(), '3000');
  const more = adjustUnits(u, 4, '2026-11-09');
  assert.equal(more.length, 4);
  assert.equal(more[3].revenue, 3200);
  assert.equal(more[3].date, '2026-10-05');
  assert.equal(adjustUnits(u, null, '2026-11-09'), u);
});

test('stock older than two months with pairs left → alert once, then weekly', async () => {
  const { staleStock, staleMessage } = await import('../src/purchases.js');
  const items = [
    { key: 'HOKA Speed', date: '2026-11-10', qty: 15, price: 1300, sold: 8, liquidated: 0, last: '2027-01-02' },
    { key: 'Soul Stride', date: '2026-09-15', qty: 10, price: 950, sold: 10 }, // sold out
    { key: 'Reebok Float | rebook', date: '2026-09-15', qty: 15, price: 900, sold: 8, liquidated: 7 }, // sold off
    { key: 'Hyperboost', date: '2026-12-01', qty: 80, price: 1460, sold: 50 }, // too new
  ];
  const s = staleStock(items, '2027-01-10', {});
  assert.deepEqual(s.map((x) => [x.name, x.age, x.left, x.value, x.due]), [['HOKA Speed', 61, 7, 9100, true]]);
  assert.equal(staleStock(items, '2027-01-12', { 'HOKA Speed|2026-11-10': '2027-01-10' })[0].due, false);
  assert.equal(staleStock(items, '2027-01-17', { 'HOKA Speed|2026-11-10': '2027-01-10' })[0].due, true);
  assert.match(staleMessage(s), /HOKA Speed — من 10\/11 \(61 يوم\) — فاضل 7 من 15/);
});

test('model + colour keys need every part, in any order', () => {
  const row = 'Adidas HYPERBOOST PRO 2 Running Shoe - Brown 2 Size: 44';
  assert.equal(unitsInRow(row, 'Hyperboost & Brown', [0, 1, 0, 0, 0]), 1);
  assert.equal(unitsInRow(row, 'Brown & Hyperboost', [0, 1, 0, 0, 0]), 1);
  assert.equal(unitsInRow('Adidas HYPERBOOST PRO 2 - Red Black 43', 'Hyperboost & Brown', [0, 1, 0, 0, 0]), 0);
  assert.equal(unitsInRow('ASICS METARISE 2 PARIS Safety Yellow Black 41', 'metarise & yellow | metarise & اصفر', [1, 0, 0, 0, 0]), 1);
});

test('sell speed and what to do', () => {
  const t = '2026-11-13';
  assert.equal(speed({ date: '2026-11-01', qty: 7, sold: 1 }, t).verdict, 'لسه بدري');
  assert.equal(speed({ date: '2026-10-01', qty: 7, sold: 7 }, t).verdict, 'خلص — زوّد الكمية');
  const fast = speed({ date: '2026-10-14', qty: 10, sold: 5 }, t);
  assert.equal(fast.perMonth, 5);
  assert.equal(fast.verdict, 'زوّد');
  assert.equal(speed({ date: '2026-10-14', qty: 10, sold: 2 }, t).verdict, 'ماشي');
  assert.equal(speed({ date: '2026-09-01', qty: 10, sold: 1 }, t).verdict, 'وقّف وصفّي');
  assert.equal(speed({ date: '2026-09-01', qty: 10, sold: 1, cleared: 7 }, t).verdict, 'وقّف');
});
