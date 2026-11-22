import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitByDay, profitRow, salaryRow, planUpserts } from '../src/money_daily.js';
import { serialToDate } from '../src/purchases.js';

test('daily profit sums column J per day and skips returned rows', () => {
  const rows = [[46342, 'b', 'x', '', 0, 2900, 160, 2740, 1850, 890], [46342, 'b', 'y', '', 0, 3000, 100, 2900, 1000, 1900],
    [46343, 'b', 'z', '', 0, '-', '-', '-', '-', '-'], ['', '', 'الإجمالي']];
  assert.deepEqual(profitByDay(rows, serialToDate), { '2026-11-16': 2790 });
});

test('upsert: same id and amount → nothing; changed amount → update; new → append', () => {
  const existing = [profitRow('2026-11-16', 2790), profitRow('2026-11-17', 100), salaryRow('2026-11', 1, 24000)];
  const wanted = [profitRow('2026-11-16', 2790), profitRow('2026-11-17', 500), profitRow('2026-11-18', 900), salaryRow('2026-11', 1, 24000)];
  const { updates, appends } = planUpserts(existing, wanted);
  assert.deepEqual(updates.map((u) => u.row), [3]);
  assert.deepEqual(appends.map((a) => a[10]), ['499k:2026-11-18']);
});

test('partners row is an expense and is updated when the share changes', async () => {
  const { partnersRow } = await import('../src/money_daily.js');
  const r = partnersRow('2026-11', '2026-11-22', 5164);
  assert.deepEqual([r[3], r[5], r[7], r[10]], ['مصروف', 5164, 'نصيب الشركاء', 'partners:2026-11']);
  const { updates } = planUpserts([r], [partnersRow('2026-11', '2026-11-23', 5300)]);
  assert.equal(updates.length, 1);
});
