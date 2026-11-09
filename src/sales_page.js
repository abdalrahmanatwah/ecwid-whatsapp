// Public, read-only sales page built live from the "499K Sales" Google Sheet.
//
// No login: it lives behind a private link /s/<slug>. The slug is random,
// generated once and kept in /var/data/sales_page.json (or SALES_PAGE_SLUG),
// sent to the merchant on WhatsApp, and shown at /dashboard/sheet-sync/page-link.
// Anyone without the link gets a 404. The repo is public, so the slug is
// never in the code.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import * as sheets from './google_sheets.js';
import { notifyMerchant } from './notify.js';

const SHEET_ID = process.env.SALES_SHEET_ID || '';
const SLUG_FILE = process.env.SALES_PAGE_FILE || '/var/data/sales_page.json';
const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || 'https://ecwid-whatsapp.onrender.com').replace(/\/$/, '');
const CACHE_MS = 60_000;

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const LEGACY = { 'أكتوبر': '2026-10' };

let slugCache = null;

export function pageSlug() {
  if (slugCache) return slugCache;
  if (process.env.SALES_PAGE_SLUG) return (slugCache = process.env.SALES_PAGE_SLUG);
  try {
    if (existsSync(SLUG_FILE)) {
      const s = JSON.parse(readFileSync(SLUG_FILE, 'utf8')).slug;
      if (s) return (slugCache = s);
    }
  } catch { /* regenerate */ }
  slugCache = randomBytes(15).toString('base64url');
  try {
    mkdirSync(dirname(SLUG_FILE), { recursive: true });
    writeFileSync(SLUG_FILE, JSON.stringify({ slug: slugCache, createdAt: new Date().toISOString() }));
    notifyMerchant(`📊 صفحة المبيعات جاهزة (من غير باسورد، اللينك ده ليك بس):\n${pageUrl()}`).catch(() => {});
  } catch (e) {
    console.warn('[sales-page] could not save slug:', e.message);
  }
  return slugCache;
}

export const pageUrl = () => `${PUBLIC_URL}/s/${pageSlug()}`;

// "YYYY-MM" for a month tab title, or null.
function monthKeyOf(title) {
  if (LEGACY[title]) return LEGACY[title];
  const i = MONTHS_AR.findIndex((m) => title.startsWith(m + ' '));
  const y = Number(title.split(' ')[1]);
  return i >= 0 && y ? `${y}-${String(i + 1).padStart(2, '0')}` : null;
}

const cell = (row, i) => String(row?.[i] ?? '').trim();

function parseMonth(title, key, rows, rawDates = []) {
  const header = rows.findIndex((r) => cell(r, 0) === 'التاريخ');
  const total = rows.findIndex((r) => cell(r, 2) === 'الإجمالي');
  if (header === -1 || total === -1) return null;
  const cols = rows[header].map((c) => String(c || '').trim());
  // Each order: columns A–Q as displayed, plus [17] = the date as a Sheets
  // serial number (sorting by the displayed text breaks when a cell is
  // formatted mm/dd instead of dd/mm).
  const orders = [];
  for (let i = header + 1; i < total; i++) {
    const r = rows[i];
    if (!cell(r, 2)) continue;
    const row = Array.from({ length: 17 }, (_, c) => cell(r, c));
    const serial = Number(rawDates[i]?.[0]);
    row.push(Number.isFinite(serial) && serial > 40000 ? serial : null);
    if (row[17]) {
      const d = new Date(Date.UTC(1899, 11, 30) + row[17] * 86_400_000);
      row[0] = String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    orders.push(row);
  }
  const summary = [];
  const supplier = [];
  let inSupplier = false;
  for (const r of rows.slice(total + 1)) {
    const label = cell(r, 2);
    if (!label) continue;
    if (/^حساب المورد/.test(label)) { inSupplier = true; continue; }
    if (label === 'ملخص') continue;
    (inSupplier ? supplier : summary).push({ label, value: cell(r, 5) });
  }
  return {
    title, key,
    heading: cell(rows[0], 0),
    columns: cols.slice(0, 16),
    orders,
    total: rows[total].slice(0, 16).map((c) => String(c ?? '')),
    summary, supplier,
  };
}

let cache = { at: 0, data: null };

async function buildData() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const tabs = await sheets.getTabs(SHEET_ID);
  const months = [];
  for (const t of tabs) {
    const key = monthKeyOf(t.title);
    if (!key) continue;
    const [rows, rawDates] = await Promise.all([
      sheets.getValues(SHEET_ID, `'${t.title}'!A1:Q600`),
      sheets.getFormulas(SHEET_ID, `'${t.title}'!A1:A600`),
    ]);
    const m = parseMonth(t.title, key, rows, rawDates);
    if (m) months.push(m);
  }
  months.sort((a, b) => b.key.localeCompare(a.key));
  const has = (name) => tabs.some((t) => t.title === name);
  const [returns, review, assumptions, purchases] = await Promise.all([
    has('المرتجعات') ? sheets.getValues(SHEET_ID, `'المرتجعات'!A1:H200`) : [],
    has('مراجعة') ? sheets.getValues(SHEET_ID, `'مراجعة'!A1:H500`) : [],
    has('الافتراضات') ? sheets.getValues(SHEET_ID, `'الافتراضات'!A1:G200`) : [],
    has('المشتريات') ? sheets.getValues(SHEET_ID, `'المشتريات'!A5:K300`) : [],
  ]);
  const data = {
    updatedAt: new Date().toISOString(),
    months,
    returns,
    review,
    assumptions: assumptions.slice(2).map((r) => [cell(r, 0), cell(r, 1), cell(r, 2)]).filter((r) => r[0] && r[1]),
    // date, model, price, qty, invoice total, sold, recovered, left, stock value, % back, last sale
    purchases: purchases.map((r) => Array.from({ length: 11 }, (_, i) => cell(r, i))).filter((r) => r[1] && r[3]),
    prices: assumptions.slice(3).map((r) => [cell(r, 4), cell(r, 5), cell(r, 6)]).filter((r) => r[0] && /\d/.test(r[1])),
  };
  cache = { at: Date.now(), data };
  return data;
}

export const salesPageRouter = Router();

salesPageRouter.get('/:slug/data.json', async (req, res) => {
  if (req.params.slug !== pageSlug()) return res.status(404).end();
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await buildData());
  } catch (e) {
    console.error('[sales-page] data failed:', e.message);
    res.status(502).json({ error: 'تعذّر قراءة الشيت دلوقتي' });
  }
});

salesPageRouter.get('/:slug', (req, res) => {
  if (req.params.slug !== pageSlug()) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.type('html').send(PAGE_HTML);
});

// The page: all markup, styles and script in one string. Data is rendered
// with textContent only (sheet text is never injected as HTML).
const PAGE_HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>499K — المبيعات</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f4f1ea; --panel:#fffdf8; --ink:#1b1a17; --muted:#6f6a60; --line:#e4dfd3;
  --accent:#d9480f; --accent-soft:#ffe8dc; --good:#2f7d4f; --good-soft:#e2f2e8; --bad:#c2410c; --bad-soft:#fde7dc;
  --bosta:#d9480f; --qp:#3b5bdb; --hand:#7c6f57;
  --c1:#d9480f; --c2:#3b5bdb; --c3:#2f7d4f; --c4:#b7791f; --c5:#7c6f57;
  --shadow:0 1px 0 rgba(27,26,23,.04),0 8px 24px -16px rgba(27,26,23,.25);
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#141311; --panel:#1d1b18; --ink:#f2eee6; --muted:#a39c8f; --line:#2f2c27;
  --accent:#ff7a3d; --accent-soft:#3a2216; --good:#5cc489; --good-soft:#16291e; --bad:#ff8a5b; --bad-soft:#35190f;
  --bosta:#ff7a3d; --qp:#7d97ff; --hand:#b8aa8c; --c1:#ff7a3d; --c2:#7d97ff; --c3:#5cc489; --c4:#e8b54d; --c5:#b8aa8c;
  --shadow:0 1px 0 rgba(0,0,0,.3),0 8px 24px -16px rgba(0,0,0,.8);
}}
:root[data-theme="dark"]{
  --bg:#141311; --panel:#1d1b18; --ink:#f2eee6; --muted:#a39c8f; --line:#2f2c27;
  --accent:#ff7a3d; --accent-soft:#3a2216; --good:#5cc489; --good-soft:#16291e; --bad:#ff8a5b; --bad-soft:#35190f;
  --bosta:#ff7a3d; --qp:#7d97ff; --hand:#b8aa8c; --c1:#ff7a3d; --c2:#7d97ff; --c3:#5cc489; --c4:#e8b54d; --c5:#b8aa8c;
  --shadow:0 1px 0 rgba(0,0,0,.3),0 8px 24px -16px rgba(0,0,0,.8);
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans Arabic",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.num{font-family:"JetBrains Mono",ui-monospace,monospace;font-feature-settings:"tnum";direction:ltr;unicode-bidi:isolate}
.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 64px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.brand{display:flex;align-items:baseline;gap:10px}
.brand b{font-size:28px;letter-spacing:-.5px}
.brand b span{color:var(--accent)}
.brand small{color:var(--muted);font-size:13px}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:7px 14px;font:inherit;font-size:14px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
/* top-level views */
.nav{display:flex;flex-direction:column;gap:12px;margin-bottom:18px}
.seg{display:inline-flex;align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:4px;gap:2px;box-shadow:var(--shadow)}
.seg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:500;padding:8px 16px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.seg button:not([aria-pressed="true"]):hover{color:var(--ink);background:var(--bg)}
.seg .dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.55}
/* month strip */
.mbar{display:flex;align-items:center;gap:8px}
.mstrip{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;padding:2px;flex:1}
.mstrip::-webkit-scrollbar{display:none}
.mcard{flex:0 0 auto;scroll-snap-align:center;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:12px;padding:8px 14px 9px;cursor:pointer;font:inherit;text-align:start;min-width:96px;transition:transform .15s,border-color .15s}
.mcard:hover{border-color:var(--muted);transform:translateY(-1px)}
.mcard .mn{font-weight:600;font-size:14px;display:flex;align-items:baseline;gap:5px}
.mcard .mn small{font-weight:400;color:var(--muted);font-size:11px}
.mcard .ms{font-size:12px;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:6px}
.mcard .ms i{display:block;height:4px;border-radius:2px;background:var(--accent);opacity:.7}
.mcard[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.mcard[aria-pressed="true"] .mn small,.mcard[aria-pressed="true"] .ms{color:color-mix(in srgb,var(--bg) 70%,transparent)}
.mcard[aria-pressed="true"] .ms i{background:var(--bg)}
.mcard.yr{min-width:auto;padding:8px 10px;border-style:dashed;color:var(--muted);cursor:default;background:transparent;font-size:12px;display:flex;align-items:center}
.arrow{flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;font-size:16px;line-height:1;display:grid;place-items:center}
.arrow:disabled{opacity:.35;cursor:default}
@media (max-width:600px){.seg{align-self:stretch}.seg button{flex:1;justify-content:center;padding:8px 6px}.arrow{display:none}}
/* purchases */
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-bottom:14px}
.pcard{display:flex;flex-direction:column;gap:10px}
.pcard .top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.pcard h3{margin:0;font-size:16px}
.pcard .when{color:var(--muted);font-size:12px;margin-top:2px}
.ring{--p:0;--c:var(--accent);width:64px;height:64px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--line) 0)}
.ring span{width:50px;height:50px;border-radius:50%;background:var(--panel);display:grid;place-items:center;font-size:13px;font-weight:600}
.pstats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pstats div{background:var(--bg);border-radius:10px;padding:8px 10px}
.pstats small{display:block;color:var(--muted);font-size:11px}
.pstats b{font-size:15px}
.pfoot{font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--line);padding-top:8px}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.tag.good{background:var(--good-soft);color:var(--good)} .tag.mid{background:var(--accent-soft);color:var(--accent)} .tag.bad{background:var(--bad-soft);color:var(--bad)}
.stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--line);margin:10px 0 8px}
.stack i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend b{width:9px;height:9px;border-radius:3px;display:inline-block}
.split{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;margin-bottom:14px}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.months{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:18px;scrollbar-width:none}
.updated{color:var(--muted);font-size:12px}
.hero{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;margin-bottom:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:var(--shadow)}
.big .label{color:var(--muted);font-size:14px}
.big .value{font-size:44px;font-weight:700;letter-spacing:-1px;margin:6px 0 2px}
.big .sub{color:var(--muted);font-size:13px}
.big.profit{background:linear-gradient(135deg,var(--accent-soft),var(--panel) 70%)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
.kpi .label{color:var(--muted);font-size:13px}
.kpi .value{font-size:24px;font-weight:600;margin-top:4px}
.kpi .hint{font-size:12px;color:var(--muted);margin-top:2px}
.neg{color:var(--bad)} .pos{color:var(--good)}
.grid2{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px}
h2{font-size:17px;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;gap:8px}
h2 small{font-weight:400;color:var(--muted);font-size:12px}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:5px;vertical-align:-1px}
svg text{fill:var(--muted);font-size:11px;font-family:"JetBrains Mono",monospace}
.bars{display:flex;flex-direction:column;gap:10px}
.bar .row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}
.bar .track{height:10px;background:var(--line);border-radius:999px;overflow:hidden;display:flex;justify-content:flex-start}
.bar .fill{height:100%;border-radius:999px}
.list{display:grid;grid-template-columns:1fr auto;gap:0;font-size:14px}
.list div{padding:9px 0;border-bottom:1px dashed var(--line)}
.list div:nth-child(2n){text-align:left}
.list .strong{font-weight:700;border-bottom:none;padding-top:12px}
.tablebar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.tablebar input{flex:1;min-width:180px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:9px 12px;font:inherit}
.tscroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:860px}
th,td{padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--panel);color:var(--muted);font-weight:500;font-size:12px;white-space:nowrap;cursor:pointer;user-select:none}
tbody tr:hover{background:var(--accent-soft)}
td.shoe{min-width:220px;max-width:360px}
td.note{color:var(--muted);font-size:12px;max-width:260px}
tfoot td{font-weight:700;background:var(--bg)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;white-space:nowrap}
.p-bosta{background:var(--accent-soft);color:var(--bosta)}
.p-qp{background:color-mix(in srgb,var(--qp) 15%,transparent);color:var(--qp)}
.p-hand{background:color-mix(in srgb,var(--hand) 18%,transparent);color:var(--hand)}
details.card{margin-bottom:14px}
details summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between}
details summary::after{content:"＋";color:var(--muted)}
details[open] summary::after{content:"－"}
details .inner{margin-top:12px}
.empty{color:var(--muted);text-align:center;padding:24px}
.err{background:var(--bad-soft);color:var(--bad);padding:14px;border-radius:12px}
.skeleton{height:120px;border-radius:16px;background:linear-gradient(90deg,var(--line),var(--panel),var(--line));background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}
tr.fresh td{animation:freshrow 2.4s ease-out 3}
@keyframes freshrow{0%{background:color-mix(in srgb,var(--good) 35%,transparent)}100%{background:transparent}}
.badge-new{display:inline-block;margin-inline-start:6px;padding:1px 7px;border-radius:999px;background:var(--good);color:var(--bg);font-size:11px;font-weight:600;vertical-align:1px}
.toasts{position:fixed;inset-inline:0;bottom:18px;display:flex;flex-direction:column;align-items:center;gap:10px;z-index:50;pointer-events:none;padding:0 16px}
.toast{pointer-events:auto;display:flex;align-items:center;gap:14px;max-width:520px;width:100%;background:var(--panel);border:1px solid var(--line);border-inline-start:5px solid var(--good);border-radius:16px;padding:14px 16px;box-shadow:0 18px 40px -18px rgba(0,0,0,.45);animation:toastin .6s cubic-bezier(.2,1.4,.4,1) both}
.toast.out{animation:toastout .4s ease-in forwards}
.toast .ico{font-size:30px;animation:bounce 1s ease-in-out 3}
.toast .t1{font-weight:700;font-size:15px}
.toast .t2{color:var(--muted);font-size:13px;margin-top:2px}
.toast .amt{margin-inline-start:auto;font-size:20px;font-weight:700;color:var(--good)}
@keyframes toastin{from{opacity:0;transform:translateY(40px) scale(.9)}to{opacity:1;transform:none}}
@keyframes toastout{to{opacity:0;transform:translateY(30px)}}
@keyframes bounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px) rotate(-8deg)}70%{transform:translateY(0) rotate(6deg)}}
#confetti{position:fixed;inset:0;pointer-events:none;z-index:40}
@media (prefers-reduced-motion: reduce){.toast,.toast .ico,tr.fresh td{animation:none!important}}
@media (max-width:900px){.hero,.grid2{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.big .value{font-size:36px}}
@media (max-width:420px){.kpi .value{font-size:20px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand"><b>499<span>K</span></b><small>لوحة المبيعات</small></div>
    <div class="tools"><span class="updated" id="updated"></span><button class="chip" id="refresh">تحديث</button><button class="chip" id="theme" aria-label="الوضع الليلي">◐</button></div>
  </header>
  <nav class="nav" id="months"></nav>
  <main id="app"><div class="skeleton"></div></main>
</div>
<canvas id="confetti" aria-hidden="true"></canvas>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
<script>
(() => {
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
const svgEl = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const num = (s) => { s = String(s ?? '').trim(); if (!s || s === '-') return 0; const neg = /^\(.*\)$/.test(s) || s.startsWith('-'); const n = parseFloat(s.replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : (neg ? -n : n); };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const money = (s) => h('span', { class: 'num' + (num(s) < 0 ? ' neg' : '') }, s || '-');
const find = (list, re) => (list || []).find((x) => re.test(x.label));
const carrierClass = (c) => /بوسطة/.test(c) ? 'p-bosta' : /QP/i.test(c) ? 'p-qp' : 'p-hand';
const SLUG = location.pathname.split('/').filter(Boolean).pop();

try { const t = localStorage.getItem('499k-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('#theme').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('499k-theme', next); } catch {}
};

let DATA = null, current = null;
const FRESH = new Set(); // shipment ids that arrived since the last look

// New delivered orders since this browser last looked → celebration.
// The first visit only remembers what's there (no celebration for old orders).
function detectNew() {
  const all = [];
  for (const m of DATA.months) m.orders.forEach((r) => { const id = r[16] || (m.key + '|' + r.slice(0, 6).join('|')); all.push({ id, r, m }); });
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem('499k-seen') || 'null'); } catch {}
  const known = new Set(seen || []);
  const todaySerial = Math.floor((Date.now() + 2 * 3600e3) / 864e5) + 25569; // Cairo day as a Sheets serial
  let fresh = seen ? all.filter((x) => !known.has(x.id)) : all.filter((x) => x.r[17] === todaySerial);
  if (/[?&]celebrate/.test(location.search) && !fresh.length) {
    fresh = [...all].sort((a, b) => (a.r[17] || 0) - (b.r[17] || 0)).slice(-1);
  }
  try { localStorage.setItem('499k-seen', JSON.stringify(all.map((x) => x.id))); } catch {}
  if (!fresh.length) return;
  for (const x of fresh) FRESH.add(x.id);
  // jump to the month of the newest one, unless another view (all / purchases) is open
  if (!current || !current.startsWith('__')) current = fresh[fresh.length - 1].m.key;
  celebrate(fresh);
}

function celebrate(list) {
  const box = $('#toasts');
  const show = list.slice(-3).reverse();
  show.forEach((x, i) => setTimeout(() => {
    const t = h('div', { class: 'toast' },
      h('div', { class: 'ico' }, '🎉'),
      h('div', {}, h('div', { class: 't1' }, 'أوردر اتسلّم!'), h('div', { class: 't2' }, (x.r[1] || '') + ' · ' + (x.r[2] || '').slice(0, 60))),
      h('div', { class: 'amt num' }, '+' + (x.r[5] || '')));
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 6500);
  }, i * 900));
  if (list.length > 3) {
    const t = h('div', { class: 'toast' }, h('div', { class: 'ico' }, '📦'), h('div', {}, h('div', { class: 't1' }, 'و ' + (list.length - 3) + ' أوردر كمان اتسلّموا')));
    setTimeout(() => { box.append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 6500); }, 3 * 900);
  }
  confetti();
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = ['--c1', '--c2', '--c3', '--c4'].map((v) => css.getPropertyValue(v).trim());
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .75,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 8,
    s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - t0 < 3200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

async function load() {
  $('#updated').textContent = 'بيحمّل…';
  try {
    const r = await fetch(location.pathname.replace(/\/$/, '') + '/data.json', { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    DATA = await r.json();
    if (!current) current = fromHash();
    detectNew();
    if (current === '__buy' && !DATA.purchases?.length) current = null;
    if (!current || (!current.startsWith('__') && !DATA.months.some((m) => m.key === current))) current = DATA.months[0]?.key;
    if (!current.startsWith('__')) lastMonth = current;
    $('#updated').textContent = 'آخر تحديث ' + new Date(DATA.updatedAt).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
    render();
  } catch (e) {
    $('#updated').textContent = '';
    $('#app').replaceChildren(h('div', { class: 'err' }, 'مش قادر أجيب البيانات: ' + e.message));
  }
}
$('#refresh').onclick = load;

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
let lastMonth = null;
function go(view) { current = view; if (!view.startsWith('__')) lastMonth = view; try { history.replaceState(null, '', '#' + (view === '__all' ? 'all' : view === '__buy' ? 'buy' : view)); } catch {} render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function fromHash() { const x = decodeURIComponent(location.hash.slice(1)); return x === 'all' ? '__all' : x === 'buy' ? '__buy' : /^\d{4}-\d{2}$/.test(x) ? x : null; }

function render() {
  const nav = $('#months');
  const months = DATA.months;
  if (!lastMonth || !months.some((m) => m.key === lastMonth)) lastMonth = months[0]?.key;
  const isMonth = !current.startsWith('__');
  const curM = months.find((m) => m.key === lastMonth);
  const seg = h('div', { class: 'seg', role: 'tablist' },
    h('button', { 'aria-pressed': String(isMonth), onclick: () => go(lastMonth) }, h('i', { class: 'dot' }), curM ? 'الشهر: ' + curM.title.split(' ')[0] : 'الشهر'),
    h('button', { 'aria-pressed': String(current === '__all'), onclick: () => go('__all') }, 'كل الشهور'),
    ...(DATA.purchases?.length ? [h('button', { 'aria-pressed': String(current === '__buy'), onclick: () => go('__buy') }, 'المشتريات')] : []));
  const parts = [seg];
  if (isMonth) {
    const maxSales = Math.max(...months.map((m) => num(m.total[5])), 1);
    const strip = h('div', { class: 'mstrip' });
    let year = null;
    for (const m of months) {
      const [y, mm] = m.key.split('-');
      if (year && y !== year) strip.append(h('div', { class: 'mcard yr' }, y));
      year = y;
      const sales = num(m.total[5]);
      strip.append(h('button', { class: 'mcard', 'aria-pressed': String(m.key === current), 'data-k': m.key, onclick: () => go(m.key) },
        h('div', { class: 'mn' }, AR_MONTHS[Number(mm) - 1], h('small', {}, y)),
        h('div', { class: 'ms' }, h('span', { class: 'num' }, sales >= 1000 ? Math.round(sales / 1000) + 'k' : fmt(sales)), h('i', { style: 'width:' + Math.max(6, sales / maxSales * 44) + 'px' }))));
    }
    const idx = months.findIndex((m) => m.key === current);
    // months are newest first: "previous" (older) is idx+1
    const older = h('button', { class: 'arrow', 'aria-label': 'الشهر اللي قبله', disabled: idx >= months.length - 1 ? '' : null, onclick: () => go(months[idx + 1].key) }, '›');
    const newer = h('button', { class: 'arrow', 'aria-label': 'الشهر اللي بعده', disabled: idx <= 0 ? '' : null, onclick: () => go(months[idx - 1].key) }, '‹');
    if (idx >= months.length - 1) older.disabled = true; else older.removeAttribute('disabled');
    if (idx <= 0) newer.disabled = true; else newer.removeAttribute('disabled');
    parts.push(h('div', { class: 'mbar' }, older, strip, newer));
    requestAnimationFrame(() => { const el = strip.querySelector('[aria-pressed="true"]'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  }
  nav.replaceChildren(...parts);
  const app = $('#app');
  if (current === '__all') return app.replaceChildren(...renderAll());
  if (current === '__buy') return app.replaceChildren(...renderPurchases());
  const m = DATA.months.find((x) => x.key === current);
  if (!m) return app.replaceChildren(h('div', { class: 'empty' }, 'مفيش بيانات'));
  app.replaceChildren(...renderMonth(m));
}

function renderMonth(m) {
  const S = m.summary, T = m.total;
  const net = find(S, /^صافي الربح/), ads = find(S, /^مصاريف الإعلانات/), rate = find(S, /^نسبة الاستلام/);
  const orders = find(S, /^عدد الأوردرات/), pairs = find(S, /^عدد الأزواج/), returned = find(S, /^أوردرات مرفوضة/);
  const due = find(m.supplier, /^المستحق للمورد/), left = find(m.supplier, /^الفاضل/);
  const out = [];

  out.push(h('section', { class: 'hero' },
    h('div', { class: 'card big profit' },
      h('div', { class: 'label' }, 'صافي الربح — ' + m.title),
      h('div', { class: 'value num' + (num(net?.value) < 0 ? ' neg' : '') }, net?.value || '-'),
      h('div', { class: 'sub' }, 'بعد الشحن والإعلانات والباكدچينج والمرتجعات')),
    h('div', { class: 'card big' },
      h('div', { class: 'label' }, 'إجمالي المبيعات'),
      h('div', { class: 'value num' }, T[5] || '-'),
      h('div', { class: 'sub' }, 'الصافي بعد الشحن ', h('span', { class: 'num' }, T[7] || '-'), ' · الربح بعد الشحن ', h('span', { class: 'num' }, T[9] || '-')))));

  const kpi = (label, value, hint, cls = '') => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value num ' + cls }, value || '-'), hint ? h('div', { class: 'hint' }, hint) : null);
  out.push(h('section', { class: 'kpis' },
    kpi('الأوردرات المستلمة', orders?.value, (pairs?.value || '-') + ' زوج'),
    kpi('نسبة الاستلام', rate?.value, (returned?.value || '0') + ' مرتجع'),
    kpi('مصاريف الإعلانات', ads?.value, 'للأوردر ' + (find(S, /^تكلفة الإعلان/)?.value || '-')),
    kpi('الفاضل بعد المورد', left?.value, 'المستحق للمورد ' + (due?.value || '-'))));

  // daily chart
  const byDay = {};
  for (const r of m.orders) { const d = r[0] || '؟'; (byDay[d] ||= { sales: 0, profit: 0, n: 0, k: r[17] || 0 }); byDay[d].sales += num(r[5]); byDay[d].profit += num(r[9]); byDay[d].n++; }
  const days = Object.keys(byDay).sort((a, b) => (byDay[a].k - byDay[b].k) || a.localeCompare(b));
  out.push(h('section', { class: 'grid2' },
    h('div', { class: 'card' }, h('h2', {}, 'المبيعات اليومية', h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--c1)' }), 'المبيعات'), h('span', {}, h('i', { style: 'background:var(--c3)' }), 'الربح بعد الشحن'))), dailyChart(days, byDay)),
    h('div', { class: 'card' }, h('h2', {}, 'الأزواج حسب البراند'), brandBars(m), h('h2', { style: 'margin-top:18px' }, 'حسب شركة الشحن'), carrierBars(m))));

  // summary + supplier
  out.push(h('section', { class: 'grid2' },
    h('div', { class: 'card' }, h('h2', {}, 'ملخص الشهر'), listOf(S, /^صافي الربح/)),
    h('div', { class: 'card' }, h('h2', {}, 'حساب المورد (قطعي)'), listOf(m.supplier, /^الفاضل/))));

  out.push(ordersTable(m));
  return out;
}

function listOf(items, strongRe) {
  const box = h('div', { class: 'list' });
  for (const it of items || []) {
    const strong = strongRe && strongRe.test(it.label) ? ' strong' : '';
    box.append(h('div', { class: strong.trim() }, it.label), h('div', { class: strong.trim() }, money(it.value)));
  }
  if (!items?.length) box.append(h('div', { class: 'empty' }, '—'));
  return box;
}

function dailyChart(days, byDay) {
  if (!days.length) return h('div', { class: 'empty' }, 'لسه مفيش أوردرات الشهر ده');
  const W = 640, H = 230, pad = { l: 8, r: 46, t: 10, b: 26 };
  const max = Math.max(...days.map((d) => byDay[d].sales), 1);
  const step = (W - pad.l - pad.r) / days.length, bw = Math.max(4, Math.min(22, step * 0.38));
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': 'المبيعات والربح لكل يوم' });
  for (let i = 0; i <= 3; i++) {
    const v = (max / 3) * i, yy = y(v);
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: 'var(--line)', 'stroke-dasharray': i ? '3 4' : '' }));
    const t = svgEl('text', { x: W - pad.r + 6, y: yy + 4 }); t.textContent = v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v); svg.append(t);
  }
  days.forEach((d, i) => {
    const x = pad.l + step * i + step / 2, s = byDay[d];
    const r1 = svgEl('rect', { x: x - bw - 1, y: y(s.sales), width: bw, height: Math.max(0, H - pad.b - y(s.sales)), rx: 3, fill: 'var(--c1)' });
    const r2 = svgEl('rect', { x: x + 1, y: y(Math.max(0, s.profit)), width: bw, height: Math.max(0, H - pad.b - y(Math.max(0, s.profit))), rx: 3, fill: 'var(--c3)' });
    const tip = svgEl('title'); tip.textContent = d + ' — ' + s.n + ' أوردر · مبيعات ' + fmt(s.sales) + ' · ربح ' + fmt(s.profit);
    const g = svgEl('g'); g.append(tip, r1, r2); svg.append(g);
    if (days.length <= 16 || i % Math.ceil(days.length / 12) === 0) { const t = svgEl('text', { x, y: H - 8, 'text-anchor': 'middle' }); t.textContent = d; svg.append(t); }
  });
  return svg;
}

function bars(rows) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar' },
    h('div', { class: 'row' }, h('span', {}, r.label), h('span', {}, h('b', { class: 'num' }, fmt(r.v)), r.unit ? ' ' + r.unit : '', r.extra != null ? h('span', { style: 'color:var(--muted)' }, ' · ', h('span', { class: 'num' }, fmt(r.extra)), ' ج') : null)),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + (r.v / max * 100) + '%;background:' + r.color })))));
}
function brandBars(m) {
  // pairs per brand from the total row (columns L–P)
  const names = ['أسيكس', 'أديداس', 'نايك', 'ON', 'أخرى'], colors = ['var(--c2)', 'var(--c1)', 'var(--c4)', 'var(--c3)', 'var(--c5)'];
  return bars(names.map((n, i) => ({ label: n, v: num(m.total[11 + i]), unit: 'زوج', color: colors[i] })).filter((r) => r.v > 0));
}
function carrierBars(m) {
  const by = {};
  for (const r of m.orders) { const c = r[1] || 'أخرى'; (by[c] ||= { n: 0, s: 0 }); by[c].n++; by[c].s += num(r[5]); }
  return bars(Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([c, v]) => ({ label: c, v: v.n, unit: 'أوردر', extra: v.s, color: /بوسطة/.test(c) ? 'var(--bosta)' : /QP/i.test(c) ? 'var(--qp)' : 'var(--hand)' })));
}

function ordersTable(m) {
  const show = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const numeric = new Set([4, 5, 6, 7, 8, 9]);
  let q = '', carrier = '', sortCol = null, dir = 1;
  // Default order: newest first — by date (dd/MM), then later rows first.
  const dayKey = (r, i) => {
    if (r[17]) return r[17] * 10000 + i;
    const [d, mo] = String(r[0]).split('/').map(Number);
    return (46000 + (mo || 0) * 31 + (d || 0)) * 10000 + i;
  };
  const indexed = m.orders.map((r, i) => ({ r, k: dayKey(r, i) }));
  const tbody = h('tbody'), count = h('small');
  const carriers = [...new Set(m.orders.map((r) => r[1]).filter(Boolean))];
  const draw = () => {
    let rows = [...indexed].sort((a, b) => b.k - a.k).map((x) => x.r)
      .filter((r) => (!carrier || r[1] === carrier) && (!q || r.join(' ').toLowerCase().includes(q)));
    if (sortCol != null) rows = [...rows].sort((a, b) => (numeric.has(sortCol) ? num(a[sortCol]) - num(b[sortCol]) : String(a[sortCol]).localeCompare(String(b[sortCol]), 'ar')) * dir);
    tbody.replaceChildren(...rows.map((r) => h('tr', { class: FRESH.has(r[16]) ? 'fresh' : '' }, show.map((i) => {
      if (i === 1) return h('td', {}, h('span', { class: 'pill ' + carrierClass(r[1]) }, r[1]));
      if (i === 2) return h('td', { class: 'shoe' }, r[2], FRESH.has(r[16]) ? h('span', { class: 'badge-new' }, 'جديد') : null);
      if (i === 10) return h('td', { class: 'note' }, r[10]);
      if (numeric.has(i)) return h('td', {}, money(r[i]));
      return h('td', { class: i === 0 ? 'num' : '' }, r[i]);
    }))));
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: show.length, class: 'empty' }, 'مفيش نتائج')));
    count.textContent = rows.length + ' من ' + m.orders.length + ' أوردر';
  };
  const head = h('tr', {}, show.map((i) => h('th', { onclick: () => { dir = sortCol === i ? -dir : 1; sortCol = i; draw(); } }, m.columns[i] || '')));
  const foot = h('tr', {}, show.map((i) => h('td', {}, i === 2 ? 'الإجمالي' : numeric.has(i) ? money(m.total[i]) : '')));
  const filters = h('div', { class: 'tablebar' },
    h('input', { type: 'search', placeholder: 'دوّر على موديل، مقاس، تاريخ…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
    h('button', { class: 'chip', 'aria-pressed': 'true', onclick: (e) => { carrier = ''; e.target.parentNode.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.target))); draw(); } }, 'الكل'),
    carriers.map((c) => h('button', { class: 'chip', 'aria-pressed': 'false', onclick: (e) => { carrier = c; e.target.parentNode.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === e.target))); draw(); } }, c)));
  draw();
  return h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', {}, 'كل الأوردرات', count), filters,
    h('div', { class: 'tscroll' }, h('table', {}, h('thead', {}, head), tbody, h('tfoot', {}, foot))));
}

function simpleTable(rows, opts = {}) {
  if (!rows || rows.length < 2) return h('div', { class: 'empty' }, 'فاضي');
  const [head, ...body] = rows;
  const width = Math.max(...rows.map((r) => r.length));
  return h('div', { class: 'tscroll' }, h('table', { style: 'min-width:' + (opts.min || 560) + 'px' },
    h('thead', {}, h('tr', {}, Array.from({ length: width }, (_, i) => h('th', {}, head[i] || '')))),
    h('tbody', {}, body.filter((r) => r.some((c) => String(c).trim())).map((r) => h('tr', {}, Array.from({ length: width }, (_, i) => {
      const v = r[i] ?? '';
      if (opts.dateCol === i && /^\d{5}$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 864e5); return h('td', { class: 'num' }, d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7)); }
      return h('td', { class: /^[\d,.()%\-\s]+$/.test(v) && v ? 'num' : '' }, v);
    }))))));
}

// Stock bought up front: how much of the money has come back.
const PCOLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', '#9c36b5', '#0c8599', '#e8590c'];
function parseDMY(t) { const m = String(t || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null; }
function renderPurchases() {
  const P = (DATA.purchases || []).map((r, i) => {
    const qty = num(r[3]), sold = Math.min(num(r[5]), qty);
    const since = parseDMY(r[0]);
    const days = since ? Math.max(1, Math.round((Date.now() - since) / 864e5)) : null;
    const perWeek = days ? sold / days * 7 : 0;
    const left = qty - sold;
    const weeksLeft = perWeek > 0 ? left / perWeek : null;
    return { name: String(r[1]).split('|')[0].trim(), date: r[0], price: num(r[2]), qty, cost: num(r[4]), sold, back: num(r[6]), left, stock: num(r[8]), last: r[10], pct: qty ? sold / qty * 100 : 0, days, perWeek, weeksLeft, color: PCOLORS[i % PCOLORS.length] };
  });
  const t = P.reduce((a, p) => ({ cost: a.cost + p.cost, qty: a.qty + p.qty, sold: a.sold + p.sold, back: a.back + p.back, left: a.left + p.left, stock: a.stock + p.stock }), { cost: 0, qty: 0, sold: 0, back: 0, left: 0, stock: 0 });
  const pct = t.cost ? Math.round(t.back / t.cost * 100) : 0;
  const out = [];

  // Hero: money back + where the rest is sitting.
  const stack = h('div', { class: 'stack', title: 'قيمة المخزون حسب الموديل' }, P.filter((p) => p.stock > 0).map((p) => h('i', { style: 'width:' + (p.stock / (t.stock || 1) * 100) + '%;background:' + p.color, title: p.name + ': ' + fmt(p.stock) })));
  out.push(h('section', { class: 'split' },
    h('div', { class: 'card big profit' },
      h('div', { class: 'label' }, 'فلوس البضاعة اللي رجعتلك'),
      h('div', { class: 'value num' }, fmt(t.back)),
      h('div', { class: 'sub' }, 'من ', h('b', { class: 'num' }, fmt(t.cost)), ' اتدفعوا في ', h('b', { class: 'num' }, fmt(t.qty)), ' زوج'),
      h('div', { class: 'stack', style: 'height:16px' }, h('i', { style: 'width:' + pct + '%;background:var(--good)' })),
      h('div', { class: 'legend' }, h('span', {}, h('b', { style: 'background:var(--good)' }), h('span', { class: 'num' }, pct + '%'), ' رجع'), h('span', {}, h('b', { style: 'background:var(--line)' }), h('span', { class: 'num' }, (100 - pct) + '%'), ' لسه بضاعة'))),
    h('div', { class: 'card' },
      h('div', { class: 'label', style: 'color:var(--muted);font-size:14px' }, 'لسه في المخزن'),
      h('div', { style: 'font-size:34px;font-weight:700;margin:6px 0 2px' }, h('span', { class: 'num' }, fmt(t.stock)), h('span', { style: 'font-size:14px;color:var(--muted);font-weight:400' }, ' ج · ', h('span', { class: 'num' }, fmt(t.left)), ' زوج')),
      stack,
      h('div', { class: 'legend' }, P.filter((p) => p.stock > 0).map((p) => h('span', {}, h('b', { style: 'background:' + p.color }), p.name, ' ', h('span', { class: 'num' }, fmt(p.stock))))))));

  // One card per model.
  out.push(h('section', { class: 'pgrid' }, P.map((p) => {
    const tag = p.pct >= 80 ? ['good', 'قرب يخلص'] : p.pct >= 40 ? ['mid', 'ماشي كويس'] : ['bad', 'بطيء'];
    const eta = p.left === 0 ? 'خلص ✓' : p.weeksLeft == null ? 'لسه مااتباعش منه' : p.weeksLeft < 1.5 ? 'هيخلص خلال أسبوع تقريباً' : 'هيخلص في حوالي ' + Math.round(p.weeksLeft) + ' أسبوع';
    return h('div', { class: 'card pcard' },
      h('div', { class: 'top' },
        h('div', {}, h('h3', {}, p.name), h('div', { class: 'when' }, 'من ', h('span', { class: 'num' }, p.date), ' · ', h('span', { class: 'num' }, fmt(p.price)), ' ج للزوج'), h('div', { style: 'margin-top:6px' }, h('span', { class: 'tag ' + tag[0] }, tag[1]))),
        h('div', { class: 'ring', style: '--p:' + p.pct.toFixed(1) + ';--c:' + (p.pct >= 80 ? 'var(--good)' : p.pct >= 40 ? 'var(--accent)' : 'var(--bad)') }, h('span', {}, h('span', { class: 'num', style: 'width:auto;height:auto;background:none' }, Math.round(p.pct) + '%')))),
      h('div', { class: 'pstats' },
        h('div', {}, h('small', {}, 'اتباع'), h('b', { class: 'num' }, fmt(p.sold)), h('span', { style: 'color:var(--muted);font-size:12px' }, ' من ', h('span', { class: 'num' }, fmt(p.qty)))),
        h('div', {}, h('small', {}, 'فاضل'), h('b', { class: 'num' }, fmt(p.left)), h('span', { style: 'color:var(--muted);font-size:12px' }, ' زوج')),
        h('div', {}, h('small', {}, 'رجعلك'), h('b', { class: 'num', style: 'color:var(--good)' }, fmt(p.back))),
        h('div', {}, h('small', {}, 'قيمة الفاضل'), h('b', { class: 'num' }, fmt(p.stock)))),
      h('div', { class: 'pfoot' },
        h('span', {}, p.perWeek ? h('span', {}, h('span', { class: 'num' }, p.perWeek.toFixed(1)), ' زوج في الأسبوع') : '—'),
        h('span', {}, eta)),
      p.last ? h('div', { class: 'when' }, 'آخر بيعة ', h('span', { class: 'num' }, p.last)) : null);
  })));

  const head = ['تاريخ الشراء', 'الموديل', 'سعر القطعة', 'العدد', 'الفاتورة', 'اتباع', 'رجعلك', 'فاضل', 'قيمة المخزون', 'نسبة اللي رجع', 'آخر بيعة'];
  const rows = (DATA.purchases || []).map((r) => [r[0], String(r[1]).split('|')[0].trim(), ...r.slice(2)]);
  const d = h('details', { class: 'card' }, h('summary', {}, 'جدول الفواتير'), h('div', { class: 'inner' },
    simpleTable([head, ...rows, ['', 'الإجمالي', '', fmt(t.qty), fmt(t.cost), fmt(t.sold), fmt(t.back), fmt(t.left), fmt(t.stock), pct + '%', '']], { min: 900 })));
  out.push(d);
  return out;
}

function renderAll() {
  const out = [];
  const rows = [['الشهر', 'الأوردرات', 'الأزواج', 'المبيعات', 'الصافي بعد الشحن', 'الإعلانات', 'نسبة الاستلام', 'صافي الربح', 'المستحق للمورد']];
  let tot = { o: 0, p: 0, s: 0, n: 0, a: 0, net: 0, due: 0 };
  for (const m of DATA.months) {
    const g = (re) => find(m.summary, re)?.value || '-';
    const due = find(m.supplier, /^المستحق/)?.value || '-';
    rows.push([m.title, g(/^عدد الأوردرات/), g(/^عدد الأزواج/), m.total[5], m.total[7], g(/^مصاريف الإعلانات/), g(/^نسبة الاستلام/), g(/^صافي الربح/), due]);
    tot.o += num(g(/^عدد الأوردرات/)); tot.p += num(g(/^عدد الأزواج/)); tot.s += num(m.total[5]); tot.n += num(m.total[7]); tot.a += num(g(/^مصاريف الإعلانات/)); tot.net += num(g(/^صافي الربح/)); tot.due += num(due);
  }
  rows.push(['الإجمالي', fmt(tot.o), fmt(tot.p), fmt(tot.s), fmt(tot.n), fmt(tot.a), '', fmt(tot.net), fmt(tot.due)]);
  const kpi = (label, v) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value num' + (v < 0 ? ' neg' : '') }, fmt(v)));
  out.push(h('section', { class: 'kpis' }, kpi('صافي الربح (كل الشهور)', tot.net), kpi('المبيعات', tot.s), kpi('الأوردرات', tot.o), kpi('الإعلانات', tot.a)));
  out.push(h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', {}, 'مقارنة الشهور'), simpleTable(rows, { min: 820 })));
  const sec = (title, body, open) => { const d = h('details', { class: 'card' }, h('summary', {}, title), h('div', { class: 'inner' }, body)); if (open) d.open = true; return d; };
  out.push(sec('المرتجعات حسب الشهر', simpleTable(DATA.returns), true));
  out.push(sec('تاب المراجعة (أوردرات محتاجة قرار)', simpleTable(DATA.review, { dateCol: 0, min: 760 }), true));
  out.push(sec('الافتراضات', simpleTable([['البند', 'القيمة', 'ملاحظة'], ...DATA.assumptions], { min: 520 })));
  out.push(sec('أسعار الجملة حسب الموديل', simpleTable([['الموديل', 'الجملة', 'المصدر'], ...DATA.prices], { min: 420 })));
  return out;
}

load();
setInterval(load, 60 * 1000);
})();
</script>
</body>
</html>`;
