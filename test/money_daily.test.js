import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitByDay, profitRow, salaryRow, planUpserts, dayNet } from '../src/money_daily.js';
import { serialToDate } from '../src/purchases.js';

test('daily profit sums column J per day and skips returned rows', () => {
  const rows = [[46342, 'b', 'x', '', 0, 2900, 160, 2740, 1850, 890], [46342, 'b', 'y', '', 0, 3000, 100, 2900, 1000, 1900],
    [46343, 'b', 'z', '', 0, '-', '-', '-', '-', '-'], ['', '', 'الإجمالي']];
  assert.deepEqual(profitByDay(rows, serialToDate), { '2026-11-16': 2790 });
});

test('day net = profit − ads − partners %', () => {
  assert.deepEqual(dayNet(10000, 2000, 0.245), { before: 8000, partners: 1960, net: 6040 });
  assert.deepEqual(dayNet(10000, 2000, 0), { before: 8000, partners: 0, net: 8000 });
  const r = profitRow('2026-11-20', 10000, 2000, 0.245);
  assert.deepEqual([r[3], r[4], r[7], r[10]], ['دخل', 6040, 'صافي 499K', '499k:2026-11-20']);
  const loss = profitRow('2026-11-21', 500, 3000, 0.245);
  assert.deepEqual([loss[3], loss[5]], ['مصروف', 1887.5]);
});

test('upsert: same id and amount → nothing; changed amount → update; new → append', () => {
  const existing = [profitRow('2026-11-16', 2790), profitRow('2026-11-17', 100), salaryRow('2026-11', 1, 24000)];
  const wanted = [profitRow('2026-11-16', 2790), profitRow('2026-11-17', 500), profitRow('2026-11-18', 900), salaryRow('2026-11', 1, 24000)];
  const { updates, appends } = planUpserts(existing, wanted);
  assert.deepEqual(updates.map((u) => u.row), [3]);
  assert.deepEqual(appends.map((a) => a[10]), ['499k:2026-11-18']);
});
