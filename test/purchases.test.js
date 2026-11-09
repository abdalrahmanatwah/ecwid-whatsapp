import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, unitsInRow, parseDate, serialToDate } from '../src/purchases.js';

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
  assert.deepEqual(r[5], { sold: 2, last: '2026-11-05' });
  assert.deepEqual(r[6], { sold: 2, last: '2026-11-12' });
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
