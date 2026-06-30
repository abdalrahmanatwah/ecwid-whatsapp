import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, computeMetrics } from '../src/metrics.js';

// --- Cairo day-boundary correctness (the part most likely to be subtly wrong) ---

test('resolveWindow: "today" boundary is midnight Cairo-local, not UTC midnight', () => {
  const { fromUnix } = resolveWindow('today');
  const asCairoTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fromUnix * 1000));
  assert.equal(asCairoTime, '00:00', `expected 00:00 Cairo-local, got ${asCairoTime}`);
});

test('resolveWindow: 7d window spans exactly 7 calendar days including today', () => {
  const { fromUnix, toUnix } = resolveWindow('7d');
  const spanDays = (toUnix - fromUnix) / 86400;
  // Should be ~6 days + however far into today we are (0 to <1 extra day)
  assert.ok(spanDays >= 6 && spanDays < 8, `expected 6-8 days span, got ${spanDays}`);
});

test('resolveWindow: custom range is DST-correct in both winter (EET) and summer (EEST)', () => {
  // Winter: Jan 15 2026, Cairo is UTC+2 (EET, no DST in January per 2026 schedule)
  const winter = resolveWindow('custom', '2026-01-15', '2026-01-15');
  const winterStartUTC = new Date(winter.fromUnix * 1000).toISOString();
  assert.equal(winterStartUTC, '2026-01-14T22:00:00.000Z', 'Jan 15 00:00 Cairo should be Jan 14 22:00 UTC (UTC+2)');

  // Summer: Jul 15 2026, Cairo is UTC+3 (EEST, DST active per 2026 schedule Apr 24–Oct 29)
  const summer = resolveWindow('custom', '2026-07-15', '2026-07-15');
  const summerStartUTC = new Date(summer.fromUnix * 1000).toISOString();
  assert.equal(summerStartUTC, '2026-07-14T21:00:00.000Z', 'Jul 15 00:00 Cairo should be Jul 14 21:00 UTC (UTC+3)');
});

test('resolveWindow: custom single-day range covers the full day (start to start+~24h)', () => {
  const { fromUnix, toUnix } = resolveWindow('custom', '2026-03-01', '2026-03-01');
  const spanHours = (toUnix - fromUnix) / 3600;
  assert.ok(spanHours > 23.9 && spanHours <= 24, `expected ~24h span, got ${spanHours}h`);
});

// --- computeMetrics: bucketing and aggregation ---

const fixtureOrders = [
  {
    total: 1200, currency: 'EGP', fulfillmentStatus: 'DELIVERED',
    items: [{ name: 'Asics GreenBlack', quantity: 1, price: 1200, selectedOptions: [{ name: 'Size', value: '42' }] }],
  },
  {
    total: 950, currency: 'EGP', fulfillmentStatus: 'DELIVERED',
    items: [{ name: 'Asics Pink Running', quantity: 1, price: 950, selectedOptions: [{ name: 'Size', value: '38' }] }],
  },
  {
    total: 800, currency: 'EGP', fulfillmentStatus: 'RETURNED',
    items: [{ name: 'Tennis Pro Court Shoe', quantity: 1, price: 800 }],
  },
  {
    total: 1100, currency: 'EGP', fulfillmentStatus: 'WILL_NOT_DELIVER',
    items: [{ name: 'Padel Grip Trainer', quantity: 1, price: 1100 }],
  },
  {
    total: 700, currency: 'EGP', fulfillmentStatus: 'PROCESSING',
    items: [{ name: 'Fitness Gym Trainer', quantity: 2, price: 350 }],
  },
];

test('computeMetrics: buckets orders correctly by fulfillmentStatus', () => {
  const m = computeMetrics(fixtureOrders);
  assert.equal(m.counts.delivered, 2);
  assert.equal(m.counts.undelivered, 2); // RETURNED + WILL_NOT_DELIVER
  assert.equal(m.counts.inTransit, 1); // PROCESSING
  assert.equal(m.counts.totalPlaced, 5);
});

test('computeMetrics: delivery rate excludes in-transit orders from the denominator', () => {
  const m = computeMetrics(fixtureOrders);
  // 2 delivered / (2 delivered + 2 undelivered) = 0.5 — the 1 in-transit order doesn't count either way
  assert.equal(m.deliveryRate, 0.5);
});

test('computeMetrics: delivery rate is null when nothing has resolved yet', () => {
  const m = computeMetrics([{ total: 500, fulfillmentStatus: 'PROCESSING', items: [] }]);
  assert.equal(m.deliveryRate, null);
});

test('computeMetrics: earnings = sum of delivered totals only', () => {
  const m = computeMetrics(fixtureOrders);
  assert.equal(m.earnings, 1200 + 950); // delivered orders only, not returned/cancelled/in-transit
});

test('computeMetrics: AOV = earnings / delivered count', () => {
  const m = computeMetrics(fixtureOrders);
  assert.equal(m.aov, (1200 + 950) / 2);
});

test('computeMetrics: cash collected = earnings, cash pending = in-transit totals', () => {
  const m = computeMetrics(fixtureOrders);
  assert.equal(m.cash.collected, 1200 + 950);
  assert.equal(m.cash.pending, 700);
});

test('computeMetrics: top products counted from delivered orders only, with size in the label', () => {
  const m = computeMetrics(fixtureOrders);
  const names = m.topProducts.map((p) => p.name);
  assert.ok(names.includes('Asics GreenBlack — 42'));
  assert.ok(names.includes('Asics Pink Running — 38'));
  // Returned/cancelled/in-transit items should NOT appear — only 2 delivered items exist
  assert.equal(m.topProducts.length, 2);
});

test('computeMetrics: category split classifies by keyword and only counts delivered revenue', () => {
  const m = computeMetrics(fixtureOrders);
  // Only delivered items count: GreenBlack (no keyword match → Other), Pink Running (→ Running & Fitness)
  const other = m.categorySplit.find((c) => c.category === 'Other');
  const running = m.categorySplit.find((c) => c.category === 'Running & Fitness');
  assert.ok(other, 'expected an Other bucket for the unclassified GreenBlack item');
  assert.ok(running, 'expected Running & Fitness from "Asics Pink Running"');
  assert.equal(other.revenue, 1200);
  assert.equal(running.revenue, 950);
});

test('computeMetrics: handles an empty order list without throwing', () => {
  const m = computeMetrics([]);
  assert.equal(m.counts.totalPlaced, 0);
  assert.equal(m.deliveryRate, null);
  assert.equal(m.earnings, 0);
  assert.equal(m.topProducts.length, 0);
});
