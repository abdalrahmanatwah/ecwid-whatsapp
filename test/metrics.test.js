import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, inTransitLookbackWindow, computeMetrics } from '../src/metrics.js';

// --- Cairo day-boundary correctness (unchanged from before, still load-bearing) ---

test('resolveWindow: "today" boundary is midnight Cairo-local, not UTC midnight', () => {
  const { fromUnix } = resolveWindow('today');
  const asCairoTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(fromUnix * 1000));
  assert.equal(asCairoTime, '00:00');
});

test('resolveWindow: custom range is DST-correct in both winter (EET) and summer (EEST)', () => {
  const winter = resolveWindow('custom', '2026-01-15', '2026-01-15');
  assert.equal(new Date(winter.fromUnix * 1000).toISOString(), '2026-01-14T22:00:00.000Z');
  const summer = resolveWindow('custom', '2026-07-15', '2026-07-15');
  assert.equal(new Date(summer.fromUnix * 1000).toISOString(), '2026-07-14T21:00:00.000Z');
});

test('inTransitLookbackWindow: fixed 45-day window ending now, independent of any period', () => {
  const w = inTransitLookbackWindow();
  const spanDays = (w.toUnix - w.fromUnix) / 86400;
  assert.equal(Math.round(spanDays), 45);
});

// --- THE BUG THIS REBUILD FIXES: placement date vs resolution date ---
// An order placed days ago but DELIVERED today must show up in TODAY's resolved
// metrics — even though it has nothing to do with today's *placed* orders. This is
// exactly the Bosta-vs-dashboard mismatch reported against real data.

test('computeMetrics: an order placed long ago but resolved in-window counts toward earnings', () => {
  const placedLongAgoButDeliveredNow = {
    total: 3400, currency: 'EGP', fulfillmentStatus: 'DELIVERED',
    items: [{ name: 'Court Shoe', quantity: 1, price: 3400 }],
  };
  // resolvedOrders = what the 'updated' query returned for the window (this is the
  // whole point: it's queried by update date, so an old order can legitimately be in
  // here). inTransitOrders = empty. placedCount = 0 (nothing was actually PLACED
  // today in this scenario — mirrors "1 placed" but 8 delivered from the real report).
  const m = computeMetrics([placedLongAgoButDeliveredNow], [], 0);
  assert.equal(m.counts.delivered, 1);
  assert.equal(m.earnings, 3400);
  assert.equal(m.counts.placed, 0, 'placed count stays separate and accurate even though delivered count is 1');
});

test('computeMetrics: in-transit count comes from the live snapshot, not the resolved-window query', () => {
  const stillMoving = { total: 1600, fulfillmentStatus: 'PROCESSING', items: [] };
  // Passed via the SECOND argument (live snapshot), not the first (resolved window) —
  // matches how dashboard.js actually calls this with two separate Ecwid queries.
  const m = computeMetrics([], [stillMoving], 1);
  assert.equal(m.counts.inTransit, 1);
  assert.equal(m.cash.pending, 1600);
  assert.equal(m.counts.delivered, 0);
});

test('computeMetrics: resolved-window query results are still filtered to actually-resolved statuses', () => {
  // Defensive: even if the 'updated' query returns a PROCESSING order (e.g. it was
  // touched for some unrelated reason during the window), it must not be miscounted
  // as delivered or undelivered.
  const touchedButNotResolved = { total: 500, fulfillmentStatus: 'PROCESSING', items: [] };
  const m = computeMetrics([touchedButNotResolved], [], 1);
  assert.equal(m.counts.delivered, 0);
  assert.equal(m.counts.undelivered, 0);
  assert.equal(m.earnings, 0);
});

// --- Bucketing, delivery rate, cash — same expectations as before, new call shape ---

const delivered1 = { total: 1200, currency: 'EGP', fulfillmentStatus: 'DELIVERED', items: [{ name: 'Asics GreenBlack', quantity: 1, price: 1200, selectedOptions: [{ name: 'Size', value: '42' }] }] };
const delivered2 = { total: 950, currency: 'EGP', fulfillmentStatus: 'DELIVERED', items: [{ name: 'Asics Pink Running', quantity: 1, price: 950, selectedOptions: [{ name: 'Size', value: '38' }] }] };
const returned1 = { total: 800, currency: 'EGP', fulfillmentStatus: 'RETURNED', items: [{ name: 'Tennis Pro Court Shoe', quantity: 1, price: 800 }] };
const cancelled1 = { total: 1100, currency: 'EGP', fulfillmentStatus: 'WILL_NOT_DELIVER', items: [{ name: 'Padel Grip Trainer', quantity: 1, price: 1100 }] };
const transit1 = { total: 700, currency: 'EGP', fulfillmentStatus: 'PROCESSING', items: [{ name: 'Fitness Gym Trainer', quantity: 2, price: 350 }] };

test('computeMetrics: buckets resolved orders correctly', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  assert.equal(m.counts.delivered, 2);
  assert.equal(m.counts.undelivered, 2);
  assert.equal(m.counts.inTransit, 1);
  assert.equal(m.counts.placed, 5);
});

test('computeMetrics: delivery rate = delivered / (delivered + undelivered), in-transit irrelevant', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  assert.equal(m.deliveryRate, 0.5);
});

test('computeMetrics: delivery rate is null when nothing resolved', () => {
  const m = computeMetrics([], [transit1], 1);
  assert.equal(m.deliveryRate, null);
});

test('computeMetrics: earnings/AOV/cash collected from delivered only', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  assert.equal(m.earnings, 1200 + 950);
  assert.equal(m.aov, (1200 + 950) / 2);
  assert.equal(m.cash.collected, 1200 + 950);
});

test('computeMetrics: cash pending from the live in-transit snapshot', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  assert.equal(m.cash.pending, 700);
});

test('computeMetrics: top products from delivered only, size in label', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  const names = m.topProducts.map((p) => p.name);
  assert.ok(names.includes('Asics GreenBlack — 42'));
  assert.ok(names.includes('Asics Pink Running — 38'));
  assert.equal(m.topProducts.length, 2);
});

test('computeMetrics: category split classifies delivered items by keyword', () => {
  const m = computeMetrics([delivered1, delivered2, returned1, cancelled1], [transit1], 5);
  const other = m.categorySplit.find((c) => c.category === 'Other');
  const running = m.categorySplit.find((c) => c.category === 'Running & Fitness');
  assert.equal(other.revenue, 1200);
  assert.equal(running.revenue, 950);
});

test('computeMetrics: handles all-empty inputs without throwing', () => {
  const m = computeMetrics([], [], 0);
  assert.equal(m.counts.placed, 0);
  assert.equal(m.deliveryRate, null);
  assert.equal(m.earnings, 0);
  assert.equal(m.topProducts.length, 0);
});
