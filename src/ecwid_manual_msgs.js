// Orders you close by hand on Ecwid get the same customer message as the
// automatic ones:
//   fulfillment → DELIVERED                      → DELIVERED_TEMPLATE_NAME (the offer)
//   fulfillment → WILL_NOT_DELIVER ("delivery
//                 canceled") or RETURNED          → REJECTED_TEMPLATE_NAME (ask the reason)
//
// Every 10 minutes it reads the Ecwid orders updated in the last 2 days. An
// order is messaged once, only if it was placed in the last 30 days, and only
// when the change wasn't made by the automation itself (Bosta tracking, the QP
// sync, the customer's own WhatsApp cancel — those already send their own
// message) and the same template didn't reach that phone in the last 3 days.
// On the first run every order that is already closed is just remembered, so
// switching this on never messages old customers.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { searchOrders } from './ecwid.js';
import { sendTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';
import { isAuto, noteSent, sentRecently } from './auto_marks.js';
import { notifyMerchant } from './notify.js';

const ENABLED = String(process.env.ECWID_MANUAL_MESSAGES ?? 'true').toLowerCase() !== 'false';
const FILE = process.env.ECWID_MANUAL_MSGS_FILE || '/var/data/ecwid_manual_msgs.json';
const EVERY_MS = Number(process.env.ECWID_MANUAL_MSGS_MINUTES || 10) * 60_000;
const DELIVERED_STATUS = process.env.DELIVERED_FULFILLMENT_STATUS || 'DELIVERED';
const RETURNED_STATUS = process.env.RETURNED_FULFILLMENT_STATUS || 'RETURNED';
const CANCEL_FULFILLMENT_STATUS = process.env.CANCEL_FULFILLMENT_STATUS || 'WILL_NOT_DELIVER';
const DELIVERED_TEMPLATE = process.env.DELIVERED_TEMPLATE_NAME || '';
const REJECTED_TEMPLATE = process.env.REJECTED_TEMPLATE_NAME || '';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const DAY = 86_400_000;

function load() {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
  return { seeded: false, handled: {}, lastRunAt: null, lastResult: null };
}
function save(s) {
  const cutoff = Date.now() - 90 * DAY;
  for (const [k, v] of Object.entries(s.handled)) if (new Date(v.at).getTime() < cutoff) delete s.handled[k];
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

// Which message an order's current status calls for (null = none).
export function kindOf(order) {
  const f = order.fulfillmentStatus;
  if (f === DELIVERED_STATUS) return 'delivered';
  if (f === CANCEL_FULFILLMENT_STATUS || f === RETURNED_STATUS) return 'rejected';
  return null;
}

const placedAt = (o) => (o.createTimestamp ? o.createTimestamp * 1000 : new Date(o.createDate || 0).getTime());
const phoneOf = (o) => o.phone || o.billingPerson?.phone || o.shippingPerson?.phone || o.contactPhone || null;

// The messages to send now, given the orders and what was handled before.
export function plan(orders, handled, { now = Date.now(), isAutoFn = isAuto, sentRecentlyFn = sentRecently } = {}) {
  const out = [];
  for (const o of orders) {
    const kind = kindOf(o);
    const id = String(o.id ?? o.orderNumber);
    if (!kind) continue;
    const key = `${id}|${kind}`;
    if (handled[key]) continue;
    const template = kind === 'delivered' ? DELIVERED_TEMPLATE : REJECTED_TEMPLATE;
    const to = normalizePhone(phoneOf(o));
    let skip = null;
    if (now - placedAt(o) > 30 * DAY) skip = 'old order';
    else if (isAutoFn(id) || (o.orderNumber != null && isAutoFn(o.orderNumber))) skip = 'changed by the automation (already messaged)';
    else if (!to) skip = 'no phone';
    else if (!template) skip = 'template env var empty';
    else if (sentRecentlyFn(to, template)) skip = 'same message sent to this phone in the last 3 days';
    out.push({ id, number: o.orderNumber || id, kind, to, template, skip });
  }
  return out;
}

let running = false;
export async function runEcwidManualMessages({ force = false, dryRun = false } = {}) {
  if (!ENABLED) return { skipped: 'disabled' };
  if (running) return { skipped: 'already running' };
  const s = load();
  if (!force && s.lastRunAt && Date.now() - new Date(s.lastRunAt).getTime() < EVERY_MS) return { skipped: 'throttled' };
  running = true;
  try {
    const at = new Date().toISOString();
    const orders = await searchOrders(Math.floor((Date.now() - 2 * DAY) / 1000), undefined, 'updated');
    const result = { at, dryRun, checked: orders.length, sent: [], skipped: [], failed: [] };
    if (!s.seeded) {
      // First run: remember what's already closed, message nobody.
      if (!dryRun) {
        for (const o of await searchOrders(Math.floor((Date.now() - 60 * DAY) / 1000), undefined, 'updated')) {
          const k = kindOf(o);
          if (k) s.handled[`${String(o.id ?? o.orderNumber)}|${k}`] = { at, seeded: true };
        }
        s.seeded = true;
      }
      result.seeded = true;
    } else {
      for (const m of plan(orders, s.handled)) {
        if (m.skip) {
          result.skipped.push({ order: m.number, kind: m.kind, reason: m.skip });
          if (!dryRun && m.skip !== 'template env var empty') s.handled[`${m.id}|${m.kind}`] = { at, skipped: m.skip };
          continue;
        }
        if (dryRun) { result.sent.push({ order: m.number, kind: m.kind, to: m.to }); continue; }
        try {
          await sendTemplate(m.to, m.template, LANG);
          noteSent(m.to, m.template);
          result.sent.push({ order: m.number, kind: m.kind, to: m.to });
        } catch (e) {
          result.failed.push({ order: m.number, kind: m.kind, to: m.to, error: e.message });
        }
        s.handled[`${m.id}|${m.kind}`] = { at };
      }
    }
    if (!dryRun) {
      s.lastRunAt = at;
      s.lastResult = result;
      save(s);
      const lines = [];
      const d = result.sent.filter((x) => x.kind === 'delivered');
      const r = result.sent.filter((x) => x.kind === 'rejected');
      if (d.length) lines.push(`🎁 عرض بعد الاستلام (Delivered يدوي على Ecwid): ${d.map((x) => '#' + x.order).join('، ')}`);
      if (r.length) lines.push(`❓ سؤال عن سبب الرفض (Delivery canceled / Returned يدوي): ${r.map((x) => '#' + x.order).join('، ')}`);
      if (result.failed.length) lines.push(`⚠️ ماوصلتش: ${result.failed.map((x) => `#${x.order} (${x.to})`).join('، ')}`);
      if (lines.length) await notifyMerchant(`💬 رسايل Ecwid\n${lines.join('\n')}`);
    }
    return result;
  } finally {
    running = false;
  }
}

export async function maybeRunEcwidManualMessages() {
  try { await runEcwidManualMessages(); } catch (e) {
    console.error('[ecwid-msgs] failed:', e.message);
    const s = load(); s.lastRunAt = new Date().toISOString(); s.lastError = { at: s.lastRunAt, message: e.message }; save(s);
  }
}

export function manualMessagesStatus() {
  const s = load();
  return { enabled: ENABLED, seeded: s.seeded, deliveredTemplate: DELIVERED_TEMPLATE || null, rejectedTemplate: REJECTED_TEMPLATE || null, lastRunAt: s.lastRunAt, lastResult: s.lastResult, lastError: s.lastError || null };
}
