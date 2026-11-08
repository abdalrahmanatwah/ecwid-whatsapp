// QP outcome → the Ecwid order.
//   QP Delivered                 → Ecwid DELIVERED + PAID
//   QP refused / cancelled / back → Ecwid RETURNED + CANCELLED (stock put back)
//
// QP orders aren't linked to Ecwid orders, so they're matched by the
// customer's phone number only (last 10 digits, so +20 / 0 / spaces don't
// matter): every open Ecwid order on that phone, placed up to
// QP_ECWID_LOOKBACK_DAYS before the QP shipment, gets the outcome. "Open"
// means not already delivered, returned or cancelled. Each QP order is
// handled once (remembered in /var/data/qp_ecwid.json).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Router } from 'express';
import { allQpOrders } from './qp_orders.js';
import { searchOrders, updateOrder } from './ecwid.js';
import { restockOrder } from './ecwid_tracking.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const ENABLED = String(process.env.QP_ECWID_SYNC ?? 'true').toLowerCase() !== 'false';
const STATE_FILE = process.env.QP_ECWID_FILE || '/var/data/qp_ecwid.json';
const EVERY_MS = Number(process.env.QP_ECWID_INTERVAL_MINUTES || 10) * 60_000;
// QP orders resolved before this day are never touched.
const START = process.env.QP_ECWID_START || '2026-11-01';
const LOOKBACK_DAYS = Number(process.env.QP_ECWID_LOOKBACK_DAYS || 14);
const DELIVERED_STATUS = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const PAID_STATUS = process.env.PAID_PAYMENT_STATUS || 'PAID';
const RETURNED_STATUS = process.env.RETURNED_FULFILLMENT_STATUS || 'RETURNED';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const CANCEL_FULFILLMENT_STATUS = process.env.CANCEL_FULFILLMENT_STATUS || 'WILL_NOT_DELIVER';
const CLOSED_FULFILLMENT = new Set([DELIVERED_STATUS, RETURNED_STATUS, CANCEL_FULFILLMENT_STATUS]);

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    console.warn('[qp-ecwid] state unreadable, starting fresh:', e.message);
  }
  return { handled: {}, lastRunAt: null, lastResult: null };
}

function saveState(s) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// All phone numbers in a string, as their last 10 digits (Egyptian mobiles:
// 01xxxxxxxxx / +201xxxxxxxxx / 0 122 … → 1xxxxxxxxx). Arabic-Indic digits included.
export function phoneKeys(text) {
  const western = String(text || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const keys = new Set();
  for (const m of western.matchAll(/\+?\d[\d\s-]{8,}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10) keys.add(digits.slice(-10));
  }
  return keys;
}

function ecwidPhones(order) {
  const keys = new Set();
  for (const p of [order.phone, order.billingPerson?.phone, order.shippingPerson?.phone, order.contactPhone]) {
    for (const k of phoneKeys(p)) keys.add(k);
  }
  return keys;
}

const dayMs = 86_400_000;
const day = (v) => (v ? String(v).slice(0, 10) : null);

// What happened to a QP order, and on which day. null = not finished yet.
export function qpOutcome(o) {
  const note = String(o.status_note || '');
  if (/^\s*(رسوم|استرجاع)/.test(String(o.shipment_contents || ''))) return null;
  if (o.status === 'Delivered') {
    const seen = o.status_changed_at && o.first_seen_at && o.status_changed_at > o.first_seen_at ? day(o.status_changed_at) : null;
    const when = day(o.collected) || seen;
    if (!when) return null;
    // delivered with nothing collected and then returned = refused
    if (!(Number(o.total_amount) > 0) && o.returned) return { kind: 'returned', day: day(o.returned) };
    return { kind: 'delivered', day: when };
  }
  if (o.status === 'Undelivered') {
    if (/مجاش من الشركة/.test(note)) return null; // never left the warehouse
    const refused = /رفض|لاغى|لاغي|ملغ/.test(note);
    if (!o.returned && !refused) return null;
    const seen = o.status_changed_at && o.first_seen_at && o.status_changed_at > o.first_seen_at ? day(o.status_changed_at) : null;
    return { kind: 'returned', day: day(o.returned) || seen || day(o.order_date) };
  }
  return null;
}

// Every open Ecwid order on the QP order's phone, placed within the window.
// Returns { orders } | { closed } (all already finished) | { reason }.
export function matchOrders(qp, ecwidOrders) {
  const phones = phoneKeys(qp.phone);
  if (!phones.size) return { reason: 'no phone on the QP order' };
  const qpDay = new Date(String(qp.order_date || qp.collected || '').slice(0, 10) + 'T12:00:00Z').getTime();
  const earliest = Number.isNaN(qpDay) ? 0 : qpDay - LOOKBACK_DAYS * dayMs;

  const samePhone = ecwidOrders.filter((o) => {
    const placed = o.createTimestamp ? o.createTimestamp * 1000 : new Date(o.createDate || 0).getTime();
    if (placed && placed < earliest) return false;
    for (const k of ecwidPhones(o)) if (phones.has(k)) return true;
    return false;
  });
  if (!samePhone.length) return { reason: 'no Ecwid order with this phone' };
  const open = samePhone.filter((o) => o.paymentStatus !== CANCEL_STATUS && !CLOSED_FULFILLMENT.has(o.fulfillmentStatus));
  if (!open.length) return { closed: samePhone };
  return { orders: open };
}

let running = false;

export async function runQpEcwidSync({ force = false, dryRun = false } = {}) {
  if (!ENABLED) return { skipped: 'disabled' };
  if (running) return { skipped: 'already running' };
  const state = loadState();
  if (!force && state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < EVERY_MS) return { skipped: 'throttled' };

  running = true;
  try {
    const todo = [];
    for (const o of allQpOrders()) {
      const out = qpOutcome(o);
      if (out && out.day >= START && !state.handled[String(o.serial)]) todo.push({ qp: o, out });
    }
    const result = { at: new Date().toISOString(), dryRun, checked: todo.length, delivered: [], returned: [], alreadyClosed: [], unmatched: [] };

    if (todo.length) {
      const oldest = todo.reduce((m, { qp }) => {
        const t = new Date(String(qp.order_date || qp.collected || '').slice(0, 10) + 'T00:00:00Z').getTime();
        return Number.isNaN(t) ? m : Math.min(m, t);
      }, Date.now());
      const ecwidOrders = await searchOrders(Math.floor((oldest - LOOKBACK_DAYS * dayMs) / 1000));

      for (const { qp, out } of todo) {
        const serial = String(qp.serial);
        const m = matchOrders(qp, ecwidOrders);
        if (m.orders) {
          const ids = m.orders.map((o) => String(o.id ?? o.orderNumber));
          const labels = m.orders.map((o) => o.orderNumber || o.id);
          const body = out.kind === 'delivered'
            ? { fulfillmentStatus: DELIVERED_STATUS, paymentStatus: PAID_STATUS }
            : { fulfillmentStatus: RETURNED_STATUS, paymentStatus: CANCEL_STATUS };
          if (!dryRun) {
            try {
              for (const [i, o] of m.orders.entries()) {
                if (out.kind === 'returned') await restockOrder(ids[i]);
                await updateOrder(ids[i], body);
                o.fulfillmentStatus = body.fulfillmentStatus; // don't match it again this run
                o.paymentStatus = body.paymentStatus;
                if (store.has(ids[i])) store.upsert(ids[i], { status: out.kind, closedVia: 'qp', qpSerial: serial });
              }
              state.handled[serial] = { kind: out.kind, ecwid: ids, at: result.at };
            } catch (e) {
              result.unmatched.push({ serial, reason: `Ecwid update failed: ${e.message}` });
              continue;
            }
          }
          result[out.kind].push({ serial, ecwid: labels });
        } else if (m.closed) {
          if (!dryRun) state.handled[serial] = { kind: out.kind, already: m.closed.map((o) => String(o.id)), at: result.at };
          result.alreadyClosed.push({ serial, ecwid: m.closed.map((o) => o.orderNumber || o.id) });
        } else {
          result.unmatched.push({ serial, kind: out.kind, reason: m.reason, phone: qp.phone, amount: qp.total_amount });
          // Retried on later runs (the Ecwid order may show up late); given up after 7 days.
          if (!dryRun && (Date.now() - new Date(out.day + 'T12:00:00Z').getTime()) / dayMs > 7) {
            state.handled[serial] = { kind: out.kind, unmatched: m.reason, at: result.at };
          }
        }
      }
    }

    state.lastRunAt = result.at;
    state.lastResult = result;

    if (!dryRun) {
      const lines = [];
      if (result.delivered.length) lines.push(`✅ Delivered + Paid على Ecwid: ${result.delivered.flatMap((x) => x.ecwid.map((e) => `#${e}`)).join('، ')}`);
      if (result.returned.length) lines.push(`↩️ Returned + Cancelled على Ecwid (واترجع المخزون): ${result.returned.flatMap((x) => x.ecwid.map((e) => `#${e}`)).join('، ')}`);
      const fresh = result.unmatched.filter((u) => u.kind && !state.notified?.[u.serial]);
      if (fresh.length) {
        lines.push(`⚠️ أوردرات QP خلصت ومفيش أوردر Ecwid مفتوح على نفس الرقم (اعملها بإيدك): ${fresh.map((u) => `${u.serial} ${u.kind === 'delivered' ? 'اتسلّم' : 'مرتجع'} — ${u.phone}`).join('، ')}`);
        state.notified = { ...(state.notified || {}), ...Object.fromEntries(fresh.map((u) => [u.serial, result.at])) };
      }
      saveState(state);
      if (lines.length) await notifyMerchant(`📦 QP → Ecwid\n${lines.join('\n')}`);
    }
    if (result.checked) {
      console.log(`[qp-ecwid] ${result.delivered.length} delivered, ${result.returned.length} returned, ${result.alreadyClosed.length} already closed, ${result.unmatched.length} unmatched${dryRun ? ' (dry run)' : ''}`);
    }
    return result;
  } finally {
    running = false;
  }
}

export async function maybeRunQpEcwidSync() {
  try {
    await runQpEcwidSync();
  } catch (e) {
    console.error('[qp-ecwid] failed:', e.message);
    const s = loadState();
    s.lastRunAt = new Date().toISOString();
    s.lastError = { at: s.lastRunAt, message: e.message };
    saveState(s);
  }
}

export const qpEcwidRouter = Router();

qpEcwidRouter.get('/status', (_req, res) => {
  const s = loadState();
  res.json({ enabled: ENABLED, start: START, lastRunAt: s.lastRunAt, lastResult: s.lastResult, lastError: s.lastError || null, handled: Object.keys(s.handled || {}).length });
});

// ?dry=1 shows the matches without changing Ecwid.
qpEcwidRouter.get('/run', async (req, res) => {
  try {
    res.json(await runQpEcwidSync({ force: true, dryRun: req.query.dry === '1' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
