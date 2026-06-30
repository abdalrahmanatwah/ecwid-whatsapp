// Auto-ship: turns a confirmed Ecwid order into a Bosta shipment, after the grace
// window has passed with no cancellation. This is the restored auto-ship feature —
// see README "Auto-ship" section for the full behavior and why each fail-safe exists.
//
// PRINCIPLE: shipping automation has real-world cost if it's wrong. Every check below
// either succeeds cleanly or throws with a specific reason — it never guesses. The
// caller (poller.js) treats any throw as "leave the order alone, alert the merchant,
// let it fall through to the existing manual-tracking-number path."

import { getOrder, updateOrder } from './ecwid.js';
import { createDelivery, getCities } from './bosta.js';
import { normalizePhone } from './phone.js';

const COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '20';

const ARABIC_RE = /[\u0600-\u06FF]/;

// Conservative on purpose: only normalizes whitespace/case for matching, never
// rewrites the city itself. A near-miss should fail safe, not get force-matched.
export function normalizeForMatch(s) {
  return String(s || '').trim().toLowerCase();
}

export async function matchBostaCity(orderCityRaw) {
  const target = normalizeForMatch(orderCityRaw);
  if (!target) throw new Error(`order has no city set`);

  const cities = await getCities();
  const match = cities.find((c) => normalizeForMatch(c.name) === target);
  if (!match) {
    throw new Error(`city "${orderCityRaw}" not found in Bosta's city list — not shipping blind`);
  }
  return match.name; // Bosta's own canonical spelling, not the raw Ecwid string
}

// Single line item, quantity 1 — the originally agreed auto-ship scope. Anything
// else (multi-item, or quantity > 1) is left for manual shipping, same as before.
export function isSingleItemOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.length === 1 && (Number(items[0].quantity) || 1) === 1;
}

export function buildAddressLine(order) {
  const line =
    order.shippingPerson?.street ||
    order.shippingPerson?.address ||
    order.billingPerson?.street ||
    '';
  return String(line).trim();
}

export function getCity(order) {
  return order.shippingPerson?.city || order.billingPerson?.city || '';
}

export function getReceiver(order) {
  const name =
    order.shippingPerson?.name || order.billingPerson?.name || order.customerName || 'Customer';
  const phoneRaw =
    order.phone || order.shippingPerson?.phone || order.billingPerson?.phone || order.contactPhone || '';
  return { name, phoneRaw };
}

export function looksArabic(addressLine) {
  return ARABIC_RE.test(addressLine);
}

// Throws with a specific, human-readable reason on ANY problem — never ships with
// a guess. Returns { trackingNumber } on success.
export async function autoShipOrder(orderId) {
  const order = await getOrder(orderId);

  if (!isSingleItemOrder(order)) {
    throw new Error('multi-item order — outside auto-ship scope, ship manually');
  }

  const addressLine = buildAddressLine(order);
  if (!addressLine) {
    throw new Error('no street address found on the order');
  }

  // Translation: if the address is already Arabic script, use it as-is. If it
  // looks like English/Latin, this build does NOT attempt automatic translation —
  // that was explicitly flagged as an open question rather than guessed at, since
  // a wrong translation causes a real failed delivery. Fails safe to manual instead.
  if (!looksArabic(addressLine)) {
    throw new Error('address appears to be non-Arabic — translation not configured, shipping manually');
  }

  const rawCity = getCity(order);
  const bostaCity = await matchBostaCity(rawCity); // throws on no match

  const { name: receiverName, phoneRaw } = getReceiver(order);
  const receiverPhone = normalizePhone(phoneRaw, COUNTRY);
  if (!receiverPhone) {
    throw new Error('no usable phone number on the order');
  }

  const codAmount = Number(order.total);
  if (!codAmount || codAmount <= 0) {
    throw new Error(`order total looks wrong for COD: ${order.total}`);
  }

  const { trackingNumber } = await createDelivery({
    cod: codAmount,
    city: bostaCity,
    addressLine,
    receiverName,
    receiverPhone,
    businessReference: orderId,
  });

  // Write the tracking number back onto the SAME field the bridge already checks
  // first (extractTracking() in ecwid_tracking.js) — Ecwid's documented top-level
  // "Shipping tracking code" field, not a guessed-at shipments[] structure.
  await updateOrder(orderId, { trackingNumber });

  return { trackingNumber };
}
