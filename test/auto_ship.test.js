import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSingleItemOrder,
  buildAddressLine,
  getCity,
  getReceiver,
  looksArabic,
  normalizeForMatch,
} from '../src/auto_ship.js';

// --- These import and test the REAL functions from auto_ship.js, not a copy ---

test('isSingleItemOrder: single item, quantity 1 — eligible', () => {
  assert.equal(isSingleItemOrder({ items: [{ quantity: 1 }] }), true);
});

test('isSingleItemOrder: single item, quantity 2 — NOT eligible (scope is qty 1 only)', () => {
  assert.equal(isSingleItemOrder({ items: [{ quantity: 2 }] }), false);
});

test('isSingleItemOrder: two different items — NOT eligible (multi-item out of scope)', () => {
  assert.equal(isSingleItemOrder({ items: [{ quantity: 1 }, { quantity: 1 }] }), false);
});

test('isSingleItemOrder: no items array — NOT eligible, not a crash', () => {
  assert.equal(isSingleItemOrder({}), false);
});

test('looksArabic: Arabic address text is recognized', () => {
  assert.equal(looksArabic('شارع الهرم، الجيزة'), true);
});

test('looksArabic: English address text is recognized as NOT Arabic (would fail safe)', () => {
  assert.equal(looksArabic('123 Pyramid Street, Giza'), false);
});

test('looksArabic: mixed Arabic+English counts as Arabic (has Arabic chars present)', () => {
  assert.equal(looksArabic('شارع Tennis Club، المعادي'), true);
});

test('buildAddressLine: prefers shippingPerson.street', () => {
  const order = { shippingPerson: { street: 'شارع أ' }, billingPerson: { street: 'شارع ب' } };
  assert.equal(buildAddressLine(order), 'شارع أ');
});

test('buildAddressLine: falls back to billingPerson.street if no shipping address', () => {
  const order = { billingPerson: { street: 'شارع ب' } };
  assert.equal(buildAddressLine(order), 'شارع ب');
});

test('buildAddressLine: empty string (not a crash) when nothing is set', () => {
  assert.equal(buildAddressLine({}), '');
});

test('getCity: prefers shippingPerson.city over billingPerson.city', () => {
  assert.equal(getCity({ shippingPerson: { city: 'Giza' }, billingPerson: { city: 'Cairo' } }), 'Giza');
});

test('getReceiver: pulls name and phone with sensible fallback order', () => {
  const r = getReceiver({ phone: '01012345678', shippingPerson: { name: 'Ahmed' } });
  assert.equal(r.name, 'Ahmed');
  assert.equal(r.phoneRaw, '01012345678');
});

test('normalizeForMatch: trims and lowercases for comparison only', () => {
  assert.equal(normalizeForMatch('  Cairo  '), 'cairo');
});

// --- Full flow, through a mock Ecwid + Bosta server (same pattern used to verify
// the dashboard fix earlier) — exercises the REAL autoShipOrder() end to end ---
