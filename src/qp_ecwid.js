// QP delivered → Ecwid order marked Delivered + Paid.
//
// QP orders aren't linked to Ecwid orders (no tracking number on the Ecwid
// order), so each delivered QP order is matched to its Ecwid order by the
// customer's phone number, then the price:
//   - same phone (last 10 digits, so +20 / 0 prefixes don't matter),
//   - Ecwid order placed up to QP_ECWID_LOOKBACK_DAYS before the QP order,
//   - not cancelled and not already delivered,
//   - if several match, the one whose total is closest to what QP collected
//     (within QP_ECWID_MAX_PRICE_GAP); otherwise it's left for the merchant.
// Every QP order is handled once (remembered in /var/data/qp_ecwid.json).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Router } from 'express';
import { allQpOrders } from './qp_orders.js';
import { searchOrders, updateOrder } from './ecwid.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';

const ENABLED = String(process.env.QP_ECWID_SYNC ?? 'true').toLowerCase() !== 'false';
const STATE_FILE = process.env.QP_ECWID_FILE || '/var/data/qp_ecwid.json';
const EVERY_MS = Number(process.env.QP_ECWID_INTERVAL_MINUTES || 10) * 60_000;
// QP orders delivered before this day are never touched.
const START = process.env.QP_ECWID_START || '2026-11-01';
const LOOKBACK_DAYS = Number(process.env.QP_ECWID_LOOKBACK_DAYS || 14);
const MAX_PRICE_GAP = Number(process.env.QP_ECWID_MAX_PRICE_GAP || 400);
const DELIVERED_STATUS = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const PAID_STATUS = process.env.PAID_PAYMENT_STATUS || 'PAID';
const CANCEL_STATUS = process.env.CANCEL_PAYMENT_STATUS || 'CANCELLED';
const CANCEL_FULFILLMENT_STATUS = process.env.CANCEL_FULFILLMENT_STATUS || 'WILL_NOT_DELIVER';

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
// 01xxxxxxxxx / +201xxxxxxxxx → 1xxxxxxxxx). Arabic-Indic digits included.
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

// QP's delivered day: the collected date, or when our scraper saw it turn
// Delivered (QP fills "collected" later, when it settles the cash).
function qpDeliveredDay(o) {
  if (o.status !== 'Delivered') return null;
  if (o.collected) return String(o.collected).slice(0, 10);
  if (o.status_changed_at && o.first_seen_at && o.status_changed_at > o.first_seen_at) {
    return String(o.status_changed_at).slice(0, 10);
  }
  return null;
}

// Picks the Ecwid order for one QP order from the candidate list.
// Returns { order } | { reason }.
export function matchOrder(qp, ecwidOrders) {
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

  const open = samePhone.filter(
    (o) => o.paymentStatus !== CANCEL_STATUS && o.fulfillmentStatus !== CANCEL_FULFILLMENT_STATUS && o.fulfillmentStatus !== DELIVERED_STATUS
  );
  if (!open.length) {
    const done = samePhone.find((o) => o.fulfillmentStatus === DELIVERED_STATUS);
    return done ? { alreadyDelivered: done } : { reason: 'only cancelled Ecwid orders with this phone' };
  }

  const collected = Number(qp.total_amount) || 0;
  const ranked = open
    .map((o) => ({ o, gap: Math.abs((Number(o.total) || 0) - collected) }))
    .sort((a, b) => a.gap - b.gap);
  if (ranked.length === 1 && (collected <= 0 || ranked[0].gap <= MAX_PRICE_GAP)) return { order: ranked[0].o };
  if (ranked[0].gap <= MAX_PRICE_GAP && (ranked.length === 1 || ranked[1].gap > ranked[0].gap)) return { order: ranked[0].o };
  return { reason: `${ranked.length} Ecwid orders with this phone, none clearly matches ${collected} EGP` };
}

let running = false;

export async function runQpEcwidSync({ force = false, dryRun = false } = {}) {
  if (!ENABLED) return { skipped: 'disabled' };
  if (running) return { skipped: 'already running' };
  const state = loadState();
  if (!force && state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < EVERY_MS) return { skipped: 'throttled' };

  running = true;
  try {
    const todo = allQpOrders().filter((o) => {
      const day = qpDeliveredDay(o);
      return day && day >= START && !state.handled[String(o.serial)];
    });
    const result = { at: new Date().toISOString(), dryRun, checked: todo.length, marked: [], alreadyDelivered: [], unmatched: [] };

    if (todo.length) {
      const oldest = todo.reduce((m, o) => {
        const t = new Date(String(o.order_date || o.collected || '').slice(0, 10) + 'T00:00:00Z').getTime();
        return Number.isNaN(t) ? m : Math.min(m, t);
      }, Date.now());
      const ecwidOrders = await searchOrders(Math.floor((oldest - LOOKBACK_DAYS * dayMs) / 1000));

      for (const qp of todo) {
        const serial = String(qp.serial);
        const m = matchOrder(qp, ecwidOrders);
        if (m.order) {
          const id = String(m.order.id ?? m.order.orderNumber);
          const label = m.order.orderNumber || id;
          if (!dryRun) {
            try {
              await updateOrder(id, { fulfillmentStatus: DELIVERED_STATUS, paymentStatus: PAID_STATUS });
              m.order.fulfillmentStatus = DELIVERED_STATUS; // don't match it again this run
              if (store.has(id)) store.upsert(id, { status: 'delivered', deliveredVia: 'qp', qpSerial: serial });
              state.handled[serial] = { ecwid: id, at: result.at };
            } catch (e) {
              result.unmatched.push({ serial, reason: `Ecwid update failed: ${e.message}` });
              continue;
            }
          }
          result.marked.push({ serial, ecwid: label, total: m.order.total, collected: qp.total_amount });
        } else if (m.alreadyDelivered) {
          if (!dryRun) state.handled[serial] = { ecwid: String(m.alreadyDelivered.id), already: true, at: result.at };
          result.alreadyDelivered.push({ serial, ecwid: m.alreadyDelivered.orderNumber || m.alreadyDelivered.id });
        } else {
          // Kept for the next runs (the Ecwid order may be created late); after
          // 7 days of no match it's given up so it isn't retried forever.
          result.unmatched.push({ serial, reason: m.reason, contents: qp.shipment_contents, amount: qp.total_amount });
          if (!dryRun) {
            const days = (Date.now() - new Date(qp.collected || qp.status_changed_at || Date.now()).getTime()) / dayMs;
            if (days > 7) state.handled[serial] = { unmatched: m.reason, at: result.at };
          }
        }
      }
    }

    state.lastRunAt = result.at;
    state.lastResult = result;
    if (!dryRun) saveState(state);

    if (!dryRun && (result.marked.length || result.unmatched.length)) {
      const lines = [];
      if (result.marked.length) lines.push(`✅ اتعلّم Delivered + Paid على Ecwid: ${result.marked.map((x) => `#${x.ecwid}`).join('، ')}`);
      const fresh = result.unmatched.filter((u) => !state.lastNotified?.[u.serial]);
      if (fresh.length) {
        lines.push(`⚠️ أوردرات QP اتسلّمت ومش لاقي أوردرها على Ecwid (علّمها بإيدك): ${fresh.map((u) => `${u.serial} (${u.amount} ج)`).join('، ')}`);
        state.lastNotified = { ...(state.lastNotified || {}), ...Object.fromEntries(fresh.map((u) => [u.serial, result.at])) };
        saveState(state);
      }
      if (lines.length) await notifyMerchant(`📦 QP → Ecwid\n${lines.join('\n')}`);
    }
    if (result.checked) console.log(`[qp-ecwid] ${result.marked.length} marked, ${result.alreadyDelivered.length} already delivered, ${result.unmatched.length} unmatched${dryRun ? ' (dry run)' : ''}`);
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
