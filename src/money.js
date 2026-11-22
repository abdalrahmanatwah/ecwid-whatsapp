// Personal money log from bank / Vodafone Cash SMS.
//
// An SMS-forwarding app on the owner's Android phone POSTs each bank or wallet
// message to /webhooks/money. The message is read (money_parse.js) and one row
// is appended to the "الحركات" tab of a separate Google Sheet (MONEY_SHEET_ID),
// which has to be shared with the service account as Editor.
//
// Env:
//   MONEY_SHEET_ID   the personal sheet (not the 499K sales sheet)
//   MONEY_TOKEN      shared secret; the app sends it as ?token=… or x-money-token
//   MONEY_SENDERS    optional comma list of sender names to accept (e.g. "VF-Cash,CIB,NBE")
//
// Body (SMS to URL Forwarder template): {"from":"%from%","text":"%text%","sentStamp":"%sentStamp%"}

import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as sheets from './google_sheets.js';
import { parseMoneySms } from './money_parse.js';

const SHEET_ID = process.env.MONEY_SHEET_ID || '';
const TOKEN = process.env.MONEY_TOKEN || '';
const SENDERS = (process.env.MONEY_SENDERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const STATE_FILE = process.env.MONEY_STATE_FILE || '/var/data/money_log.json';
export const TAB = 'الحركات';
export const HEADERS = ['التاريخ', 'الوقت', 'المصدر', 'النوع', 'داخل', 'خارج', 'الطرف التاني', 'التصنيف', 'الرصيد بعدها', 'الرسالة', 'id'];

function loadState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* fresh */ }
  return { seen: {}, recent: [], lastError: null };
}
function saveState(st) {
  try { writeFileSync(STATE_FILE, JSON.stringify(st)); } catch (e) { console.warn('[money] state not saved:', e.message); }
}

// Cairo date + time of the SMS (or now).
function cairoParts(ms) {
  const d = new Date(Number(ms) > 1e11 ? Number(ms) : Date.now());
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => f.find((p) => p.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}

export function rowFor(p, { date, time }, id) {
  const type = p.kind === 'tx' ? (p.dir === 'in' ? 'دخل' : 'مصروف') : 'مش واضح';
  const inn = p.kind === 'tx' && p.dir === 'in' ? p.amount : '';
  const out = p.kind === 'tx' && p.dir === 'out' ? p.amount : '';
  // An unclear message with an amount still shows it, under the side we guessed (if any).
  const unclearIn = p.kind === 'unclear' && p.dir === 'in' ? p.amount ?? '' : '';
  const unclearOut = p.kind === 'unclear' && p.dir !== 'in' ? p.amount ?? '' : '';
  return [date, time, p.source, type, inn || unclearIn, out || unclearOut, p.counterparty || '', p.category || '', p.balance ?? '', `'${p.text}`, id];
}

let tabReady = false;
async function ensureTab() {
  if (tabReady) return;
  const tabs = await sheets.getTabs(SHEET_ID);
  if (!tabs.some((t) => t.title === TAB)) {
    await sheets.batchUpdate(SHEET_ID, [{ addSheet: { properties: { title: TAB, rightToLeft: true, gridProperties: { frozenRowCount: 1 } } } }]);
    await sheets.updateValues(SHEET_ID, `'${TAB}'!A1:K1`, [HEADERS]);
  }
  tabReady = true;
}

export async function ingest({ from = '', text = '', sentStamp } = {}) {
  if (!SHEET_ID) throw new Error('MONEY_SHEET_ID not set');
  if (SENDERS.length && !SENDERS.some((s) => String(from).toLowerCase().includes(s))) return { skipped: 'sender not in MONEY_SENDERS' };
  const id = createHash('sha1').update(`${from}|${text}|${sentStamp || ''}`).digest('hex').slice(0, 12);
  const st = loadState();
  if (st.seen[id]) return { skipped: 'duplicate', id };
  const parsed = parseMoneySms(from, text);
  if (parsed.kind === 'ignore') return { skipped: 'not a money message', source: parsed.source };
  await ensureTab();
  const row = rowFor(parsed, cairoParts(sentStamp), id);
  await sheets.appendValues(SHEET_ID, `'${TAB}'!A1:K1`, [row], { overwrite: true }); // the daily-profit table sits beside it (M:T)
  st.seen[id] = Date.now();
  st.recent = [{ at: new Date().toISOString(), id, kind: parsed.kind, dir: parsed.dir, amount: parsed.amount, source: parsed.source }, ...(st.recent || [])].slice(0, 30);
  saveState(st);
  return { added: true, id, ...parsed, text: undefined };
}

// Public webhook (token-protected).
export const moneyWebhookRouter = Router();
// Any forwarder app works: JSON, form fields, plain text, or query string (GET too).
moneyWebhookRouter.use(express.urlencoded({ extended: false }), express.text({ type: ['text/*'] }));
moneyWebhookRouter.all('/', async (req, res) => {
  const token = req.query.token || req.get('x-money-token');
  if (!TOKEN || token !== TOKEN) return res.status(401).json({ error: 'bad token' });
  let b = typeof req.body === 'object' && req.body ? { ...req.body } : {};
  if (typeof req.body === 'string') { try { b = JSON.parse(req.body); } catch { b = { text: req.body }; } }
  for (const k of ['from', 'sender', 'text', 'message', 'body', 'msg', 'sentStamp', 'timestamp']) if (b[k] == null && req.query[k] != null) b[k] = req.query[k];
  try {
    res.json(await ingest({ from: b.from || b.sender || b.number || b.phone || '', text: b.text || b.message || b.msg || b.body || b.content || '', sentStamp: b.sentStamp || b.receivedStamp || b.timestamp }));
  } catch (e) {
    const st = loadState();
    st.lastError = { at: new Date().toISOString(), message: e.message };
    saveState(st);
    console.warn('[money] ingest failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Dashboard (behind login): status and a dry-run reader for testing a message.
export const moneyDashboardRouter = Router();
moneyDashboardRouter.get('/status', (_req, res) => {
  const st = loadState();
  res.json({ configured: Boolean(SHEET_ID && TOKEN), sheet: SHEET_ID ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}` : null, senders: SENDERS, logged: Object.keys(st.seen || {}).length, recent: st.recent || [], lastError: st.lastError });
});
moneyDashboardRouter.get('/test', (req, res) => {
  res.json(parseMoneySms(String(req.query.from || ''), String(req.query.text || '')));
});
