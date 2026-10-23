// Hourly sync: delivered Bosta + QP orders → the "499K Sales" Google Sheet.
//
// What it does each run:
//   1. Collects orders: every QP order the scraper has stored, plus recent Bosta
//      deliveries (full listing when Bosta allows it, otherwise only the ones
//      this service tracks through Ecwid tracking numbers).
//   2. Sorts each into sale / review / return / skip (rules in sales_rows.js).
//   3. Sales → new rows above the "الإجمالي" row of that month's tab, with live
//      formulas. Next month's tab is created from the current one when needed.
//   4. Anything a human should decide → the "مراجعة" (review) tab.
//   5. Refused/returned counts per month → the "المرتجعات" tab, which the
//      month tab's summary reads.
//
// Never adds the same shipment twice: every row carries its shipment id in
// column Q, and ids already handled are also remembered on disk, so a row you
// delete on purpose (e.g. after reviewing it) is not re-added.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Router } from 'express';
import * as sheets from './google_sheets.js';
import { listRecentDeliveries, probeListing, deliveryShape } from './bosta_list.js';
import { getDeliveryState, bostaConfigured } from './bosta.js';
import { allQpOrders } from './qp_orders.js';
import { store } from './store.js';
import { notifyMerchant } from './notify.js';
import {
  normalizeBosta, normalizeQp, classify, saleRowValues, reviewRowValues, monthKey,
} from './sales_rows.js';

const SHEET_ID = process.env.SALES_SHEET_ID || '';
const ENABLED = String(process.env.SHEET_SYNC ?? 'true').toLowerCase() !== 'false';
const DRY_RUN = String(process.env.SHEET_SYNC_DRY_RUN || '').toLowerCase() === 'true';
const EVERY_MS = Number(process.env.SHEET_SYNC_INTERVAL_MINUTES || 60) * 60_000;
// Orders resolved before this day were entered by hand and are never touched.
const START = process.env.SHEET_SYNC_START || '2026-10-22';
const STATE_FILE = process.env.SHEET_SYNC_FILE || '/var/data/sheet_sync.json';
const BOSTA_LOOKBACK_DAYS = Number(process.env.SHEET_SYNC_BOSTA_DAYS || 45);

const ASSUMPTIONS = 'الافتراضات';
const REVIEW_TAB = 'مراجعة';
const RETURNS_TAB = 'المرتجعات';
const TOTAL_LABEL = 'الإجمالي';
const FIRST_DATA_ROW = 5;

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// Tabs created by hand before the sync existed.
const LEGACY_TABS = { '2026-10': 'أكتوبر' };

const q = (tab) => `'${tab.replace(/'/g, "''")}'`;

// ---- local state ----------------------------------------------------------------

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    console.warn('[sheet] state file unreadable, starting fresh:', e.message);
  }
  return { processed: {}, lastRunAt: null, lastResult: null };
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---- gathering orders -------------------------------------------------------------

// Bosta deliveries we know about only through Ecwid tracking numbers. Used when
// Bosta's listing endpoint is unavailable. Incomplete: orders that never went
// through Ecwid are missing, so return counts are not written from this.
async function bostaFromEcwid(processed) {
  const out = [];
  for (const rec of store.list()) {
    if (!rec.bostaTracking || processed[`bosta:${rec.bostaTracking}`]) continue;
    if (!['delivered', 'returned', 'shipment_canceled'].includes(rec.status)) continue;
    try {
      const st = await getDeliveryState(rec.bostaTracking);
      if (st?.raw) out.push(st.raw);
    } catch (e) {
      console.warn(`[sheet] Bosta read failed for ${rec.bostaTracking}:`, e.message);
    }
  }
  return out;
}

// QP data is only trusted for return counts when the scraper has synced
// recently; a stopped scraper would otherwise drive the counts to zero.
const QP_FRESH_HOURS = Number(process.env.SHEET_SYNC_QP_FRESH_HOURS || 3);

async function gatherOrders(state) {
  const qpRaw = allQpOrders();
  const qpLastSeen = qpRaw.reduce((m, o) => (o.last_seen_at && o.last_seen_at > m ? o.last_seen_at : m), '');
  const qpFresh = Boolean(qpLastSeen) && Date.now() - new Date(qpLastSeen).getTime() < QP_FRESH_HOURS * 3_600_000;
  const orders = qpRaw.map(normalizeQp);
  let bostaSource = 'none';
  let bostaComplete = false;
  if (bostaConfigured()) {
    let raws;
    try {
      const r = await listRecentDeliveries({ sinceDays: BOSTA_LOOKBACK_DAYS });
      raws = r.deliveries;
      bostaSource = r.strategy + (r.paging != null ? `#${r.paging}` : '');
      bostaComplete = r.complete;
      if (!r.complete) {
        // Only the newest page was readable: add the Ecwid-tracked deliveries
        // too, so older shipments delivered today aren't missed.
        const seen = new Set(raws.map((d) => d.trackingNumber));
        for (const d of await bostaFromEcwid(state.processed)) if (!seen.has(d.trackingNumber)) raws.push(d);
        bostaSource += '+ecwid-tracked';
      }
    } catch (e) {
      console.warn('[sheet] Bosta listing unavailable, using Ecwid-tracked deliveries only:', e.message);
      raws = await bostaFromEcwid(state.processed);
      bostaSource = 'ecwid-tracked';
    }
    for (const d of raws) if (d?.trackingNumber) orders.push(normalizeBosta(d));
  }
  return { orders, bostaSource, bostaComplete, qpFresh, qpLastSeen };
}

// ---- sheet helpers ------------------------------------------------------------------

async function readPriceTable() {
  const rows = await sheets.getFormulas(SHEET_ID, `${q(ASSUMPTIONS)}!E4:F200`);
  return rows
    .map(([key, price]) => ({ key: String(key || '').trim(), price: Number(price) }))
    .filter((r) => r.key && r.price > 0);
}

function monthTabName(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function findMonthTab(tabs, key) {
  const wanted = [monthTabName(key), LEGACY_TABS[key]].filter(Boolean);
  return tabs.find((t) => wanted.includes(t.title)) || null;
}

// Row numbers (1-based) of the total row and the summary rows, found by label.
async function readLayout(tab) {
  const colC = await sheets.getValues(SHEET_ID, `${q(tab)}!C1:C400`);
  const find = (re, after = 0) => {
    const i = colC.findIndex((r, idx) => idx >= after && re.test(String(r?.[0] || '')));
    return i === -1 ? null : i + 1;
  };
  const total = find(new RegExp(`^${TOTAL_LABEL}$`));
  if (!total) throw new Error(`tab "${tab}" has no "${TOTAL_LABEL}" row in column C`);
  return {
    total,
    ads: find(/^مصاريف الإعلانات/, total),
    returns: find(/^أوردرات مرفوضة/, total),
  };
}

async function existingIds(tab, col) {
  const vals = await sheets.getValues(SHEET_ID, `${q(tab)}!${col}1:${col}5000`);
  return new Set(vals.map((r) => String(r?.[0] || '').trim()).filter(Boolean));
}

const returnsFormula = (key) => `=IFERROR(VLOOKUP("${key}",${q(RETURNS_TAB)}!$A:$D,4,FALSE),0)`;

// Month tabs with their "YYYY-MM" key, newest first.
function monthTabsOf(tabs) {
  return tabs
    .map((t) => {
      const k = Object.keys(LEGACY_TABS).find((lk) => LEGACY_TABS[lk] === t.title) ||
        (() => {
          const m = MONTHS_AR.findIndex((name) => t.title.startsWith(name + ' '));
          const y = Number(t.title.split(' ')[1]);
          return m >= 0 && y ? `${y}-${String(m + 1).padStart(2, '0')}` : null;
        })();
      return k ? { tab: t, key: k } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.key.localeCompare(a.key));
}

// Copies the most recent month tab, empties its data rows and points its
// summary at the new month.
async function createMonthTab(tabs, key) {
  const monthTabs = monthTabsOf(tabs);
  if (!monthTabs.length) throw new Error('no month tab to copy from');
  const source = monthTabs[0].tab;
  const name = monthTabName(key);

  const res = await sheets.batchUpdate(SHEET_ID, [
    { duplicateSheet: { sourceSheetId: source.sheetId, insertSheetIndex: 0, newSheetName: name } },
  ]);
  const sheetId = res.replies[0].duplicateSheet.properties.sheetId;

  const layout = await readLayout(name);
  const requests = [];
  // Keep one empty data row so the open-ended total formulas keep a range.
  if (layout.total - 1 > FIRST_DATA_ROW) {
    requests.push({
      deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: FIRST_DATA_ROW, endIndex: layout.total - 1 } },
    });
  }
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: FIRST_DATA_ROW - 1, endRowIndex: FIRST_DATA_ROW, startColumnIndex: 0, endColumnIndex: 11 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  });
  await sheets.batchUpdate(SHEET_ID, requests);

  const after = await readLayout(name);
  const [y, m] = key.split('-').map(Number);
  await sheets.updateValues(SHEET_ID, `${q(name)}!A${FIRST_DATA_ROW}:Q${FIRST_DATA_ROW}`, [Array(17).fill('')]);
  await sheets.updateValues(SHEET_ID, `${q(name)}!A1`, [[`${MONTHS_AR[m - 1]} ${y} — الشوزات المباعة وسعر البيع بعد خصم الشحن`]]);
  await sheets.updateValues(SHEET_ID, `${q(name)}!A3`, [[`'${key}`]]);
  if (after.ads) await sheets.updateValues(SHEET_ID, `${q(name)}!C${after.ads}:F${after.ads}`, [['مصاريف الإعلانات (اكتبها هنا)', null, null, 0]]);
  if (after.returns) await sheets.updateValues(SHEET_ID, `${q(name)}!F${after.returns}`, [[returnsFormula(key)]]);

  console.log(`[sheet] created month tab "${name}" from "${source.title}"`);
  await notifyMerchant(`📅 اتعمل تاب جديد في شيت المبيعات: ${name}. اكتب مصاريف الإعلانات بتاعة الشهر فيه.`);
  return { title: name, sheetId };
}

async function appendSales(tab, sheetId, sales) {
  const layout = await readLayout(tab.title);
  const T = layout.total;
  const n = sales.length;
  await sheets.batchUpdate(SHEET_ID, [
    { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: T - 1, endIndex: T - 1 + n }, inheritFromBefore: true } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: T - 1, endRowIndex: T - 1 + n, startColumnIndex: 0, endColumnIndex: 11 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    },
  ]);
  const values = sales.map((s, i) => saleRowValues(s, T + i));
  await sheets.updateValues(SHEET_ID, `${q(tab.title)}!A${T}:Q${T + n - 1}`, values);

  // Keep the "(1 → 22)" day range in the title current.
  const [[title = ''] = []] = await sheets.getValues(SHEET_ID, `${q(tab.title)}!A1`);
  const lastDay = Number(sales[sales.length - 1].date.slice(8, 10));
  const m = title.match(/\(1 → (\d+)\)/);
  if (m && Number(m[1]) < lastDay) {
    await sheets.updateValues(SHEET_ID, `${q(tab.title)}!A1`, [[title.replace(m[0], `(1 → ${lastDay})`)]]);
  }
}

async function ensureReturnsTab(tabs) {
  if (tabs.some((t) => t.title === RETURNS_TAB)) return;
  await sheets.batchUpdate(SHEET_ID, [{ addSheet: { properties: { title: RETURNS_TAB, rightToLeft: true } } }]);
  await sheets.updateValues(SHEET_ID, `${q(RETURNS_TAB)}!A1:E1`, [['الشهر', 'مرتجع بوسطة', 'مرتجع QP', 'الإجمالي', 'آخر تحديث']]);
}

async function writeReturns(counts, bostaComplete, qpFresh) {
  const rows = await sheets.getValues(SHEET_ID, `${q(RETURNS_TAB)}!A1:A200`);
  const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' });
  for (const [key, c] of Object.entries(counts)) {
    let r = rows.findIndex((row) => String(row?.[0] || '') === key) + 1;
    if (!r) {
      r = rows.length + 1;
      rows.push([key]);
      await sheets.updateValues(SHEET_ID, `${q(RETURNS_TAB)}!A${r}:D${r}`, [[`'${key}`, 0, 0, `=B${r}+C${r}`]]);
    }
    // Only overwrite Bosta's count when the full Bosta listing was available.
    if (bostaComplete) await sheets.updateValues(SHEET_ID, `${q(RETURNS_TAB)}!B${r}`, [[c.bosta]]);
    // Only overwrite QP's count when the QP scraper has synced recently.
    if (qpFresh) await sheets.updateValues(SHEET_ID, `${q(RETURNS_TAB)}!C${r}`, [[c.qp]]);
    await sheets.updateValues(SHEET_ID, `${q(RETURNS_TAB)}!E${r}`, [[stamp]]);
  }
}

// ---- main ---------------------------------------------------------------------------

let running = false;

export async function runSheetSync({ force = false, dryRun = DRY_RUN } = {}) {
  if (!ENABLED || !SHEET_ID || !sheets.sheetsConfigured()) return { skipped: 'not configured' };
  if (running) return { skipped: 'already running' };
  const state = loadState();
  if (!force && state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < EVERY_MS) {
    return { skipped: 'throttled' };
  }

  running = true;
  try {
    const priceTable = await readPriceTable();
    const { orders, bostaSource, bostaComplete, qpFresh, qpLastSeen } = await gatherOrders(state);

    const sales = [];
    const reviews = [];
    const returnCounts = {};
    const tally = {};
    const latestDelivered = [];
    const startMonth = monthKey(START);
    for (const n of orders) {
      const c = classify(n, priceTable);
      tally[`${n.carrier}:${c.action}`] = (tally[`${n.carrier}:${c.action}`] || 0) + 1;
      if (n.deliveredDate) latestDelivered.push({ id: n.id, delivered: n.deliveredDate, action: c.action, amount: n.amount });
      if (c.action === 'return') {
        const key = monthKey(c.date);
        if (!key || key < startMonth) continue;
        returnCounts[key] ||= { bosta: 0, qp: 0 };
        returnCounts[key][c.carrier]++;
      } else if ((c.action === 'sale' || c.action === 'review') && c.date && c.date >= START && !state.processed[c.id]) {
        (c.action === 'sale' ? sales : reviews).push(c);
      }
    }

    let tabs = await sheets.getTabs(SHEET_ID);
    // Every shipment id already anywhere in the sheet: month tabs (column Q) + review tab (column G).
    const known = tabs.some((t) => t.title === REVIEW_TAB) ? await existingIds(REVIEW_TAB, 'G') : new Set();
    for (const t of monthTabsOf(tabs)) for (const id of await existingIds(t.tab.title, 'Q')) known.add(id);

    // Sales, grouped by month tab.
    const byMonth = {};
    for (const s of sales) (byMonth[monthKey(s.date)] ||= []).push(s);
    const added = [];
    for (const key of Object.keys(byMonth).sort()) {
      let tab = findMonthTab(tabs, key);
      const fresh = byMonth[key]
        .filter((s) => !known.has(s.id))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!fresh.length) continue;
      if (dryRun) { added.push(...fresh); continue; }
      if (!tab) {
        tab = await createMonthTab(tabs, key);
        tabs = await sheets.getTabs(SHEET_ID);
      }
      await appendSales(tab, tab.sheetId, fresh);
      added.push(...fresh);
      for (const s of fresh) state.processed[s.id] = { action: 'sale', at: new Date().toISOString() };
    }

    // Review items.
    const newReviews = reviews.filter((r) => !known.has(r.id)).sort((a, b) => a.date.localeCompare(b.date));
    if (newReviews.length && !dryRun) {
      if (!tabs.some((t) => t.title === REVIEW_TAB)) {
        await sheets.batchUpdate(SHEET_ID, [{ addSheet: { properties: { title: REVIEW_TAB, rightToLeft: true } } }]);
        await sheets.updateValues(SHEET_ID, `${q(REVIEW_TAB)}!A1:H1`, [['التاريخ', 'شركة الشحن', 'الوصف', 'المحصّل', 'الشحن', 'السبب', 'رقم الشحنة', 'اتراجع؟']]);
      }
      await sheets.appendValues(SHEET_ID, `${q(REVIEW_TAB)}!A1:H1`, newReviews.map(reviewRowValues));
      for (const r of newReviews) state.processed[r.id] = { action: 'review', at: new Date().toISOString() };
    }

    // Return counts.
    if (!dryRun && Object.keys(returnCounts).length) {
      await ensureReturnsTab(tabs);
      await writeReturns(returnCounts, bostaComplete, qpFresh);
    }

    const result = {
      at: new Date().toISOString(),
      dryRun,
      bostaSource,
      bostaComplete,
      qpFresh,
      qpLastSyncedAt: qpLastSeen || null,
      ordersSeen: orders.length,
      byAction: tally,
      latestDelivered: latestDelivered.sort((a, b) => b.delivered.localeCompare(a.delivered)).slice(0, 8),
      salesAdded: added.map((s) => ({ id: s.id, date: s.date, name: s.name, amount: s.amount })),
      reviewAdded: newReviews.map((r) => ({ id: r.id, date: r.date, reason: r.reason, amount: r.amount })),
      returnCounts,
    };
    state.lastRunAt = result.at;
    state.lastResult = result;
    if (!dryRun) saveState(state);

    console.log(`[sheet] sync: +${added.length} sales, +${newReviews.length} for review, bosta via ${bostaSource}${dryRun ? ' (dry run)' : ''}`);
    if (!dryRun && (added.length || newReviews.length)) {
      await notifyMerchant(
        `📊 شيت المبيعات: اتضاف ${added.length} أوردر${newReviews.length ? `، و${newReviews.length} محتاجين مراجعة في تاب "${REVIEW_TAB}"` : ''}.`
      );
    }
    return result;
  } finally {
    running = false;
  }
}

// Called from the poller every cycle; self-throttled to SHEET_SYNC_INTERVAL_MINUTES.
export async function maybeRunSheetSync() {
  try {
    await runSheetSync();
  } catch (err) {
    console.error('[sheet] sync failed:', err.message);
    const state = loadState();
    state.lastRunAt = new Date().toISOString(); // don't hammer on a persistent error
    state.lastError = { at: state.lastRunAt, message: err.message };
    saveState(state);
  }
}

// ---- dashboard routes (mounted behind Basic Auth) ---------------------------------

export const sheetSyncRouter = Router();

// Last run's result.
sheetSyncRouter.get('/status', (_req, res) => {
  const s = loadState();
  res.json({
    configured: Boolean(SHEET_ID && sheets.sheetsConfigured()),
    serviceAccount: sheets.serviceAccountEmail(),
    start: START,
    everyMinutes: EVERY_MS / 60_000,
    lastRunAt: s.lastRunAt,
    lastResult: s.lastResult,
    lastError: s.lastError || null,
    processedCount: Object.keys(s.processed || {}).length,
  });
});

// Run now. ?dry=1 shows what would be written without touching the sheet.
sheetSyncRouter.get('/run', async (req, res) => {
  try {
    res.json(await runSheetSync({ force: true, dryRun: req.query.dry === '1' || DRY_RUN }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Which Bosta listing endpoint works on this account, and what fields it returns.
// ?tracking=123 also shows the field layout of one delivery from the single read.
sheetSyncRouter.get('/bosta-probe', async (req, res) => {
  const out = { listing: await probeListing() };
  if (req.query.tracking) {
    try {
      const st = await getDeliveryState(String(req.query.tracking));
      out.singleRead = { value: st?.value, fieldShape: deliveryShape(st?.raw) };
    } catch (e) {
      out.singleRead = { error: e.message };
    }
  }
  res.json(out);
});
