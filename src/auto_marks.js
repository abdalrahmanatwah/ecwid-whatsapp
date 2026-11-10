// Small shared memory so the different senders don't message a customer twice:
//  - orders whose status the automation itself changed (Bosta tracking, QP sync,
//    the customer's own WhatsApp cancel) — the Ecwid watcher leaves those alone;
//  - which template went to which phone recently.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = process.env.AUTO_MARKS_FILE || '/var/data/auto_marks.json';
const KEEP_DAYS = 60;

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null; } catch { cache = null; }
  cache = { orders: {}, sent: {}, ...(cache || {}) };
  return cache;
}
function save() {
  const s = load();
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const bag of [s.orders, s.sent]) for (const [k, v] of Object.entries(bag)) if (new Date(v.at).getTime() < cutoff) delete bag[k];
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s)); } catch (e) { console.warn('[marks] save failed:', e.message); }
}

const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// The automation changed this Ecwid order's status (what = delivered / returned / cancelled).
export function markAuto(orderId, what) {
  if (orderId == null) return;
  load().orders[String(orderId)] = { what, at: new Date().toISOString() };
  save();
}
export function isAuto(orderId) {
  return Boolean(load().orders[String(orderId)]);
}

// A customer template went out.
export function noteSent(phone, template) {
  const k = phoneKey(phone);
  if (!k || !template) return;
  load().sent[`${k}|${template}`] = { at: new Date().toISOString() };
  save();
}
export function sentRecently(phone, template, days = 3) {
  const v = load().sent[`${phoneKey(phone)}|${template}`];
  return Boolean(v && Date.now() - new Date(v.at).getTime() < days * 86_400_000);
}
