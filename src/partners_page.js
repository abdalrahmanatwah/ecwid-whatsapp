// Partners' page: what the extra private links show. Only each partner's
// share of the monthly net profit, read from the "نسب الشركاء" tab
// (names in A4:A5, percentages in B4:B5, totals on row 8, then one row
// per month, newest first; shares in columns C and D). Nothing else from the sheet —
// no sales, net profit, supplier or wholesale figures — is sent to the page.

import * as sheets from './google_sheets.js';

const SHEET_ID = process.env.SALES_SHEET_ID || '';
const TAB = process.env.PARTNERS_TAB || 'نسب الشركاء';
const CACHE_MS = 60_000;
const cell = (row, i) => String(row?.[i] ?? '').trim();

let cache = { at: 0, data: null };

export async function buildPartnersData() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const rows = await sheets.getValues(SHEET_ID, `'${TAB}'!A1:D60`);
  const partners = [3, 4].map((i) => ({ name: cell(rows[i], 0), pct: cell(rows[i], 1) })).filter((p) => p.name);
  // Row 8 is "الإجمالي", then one row per month, newest first (the tab
  // lists months from the start month to today; each starts from zero on the 1st).
  const months = [];
  let total = null;
  for (const r of rows.slice(7)) {
    const label = cell(r, 0);
    if (!label) continue;
    const shares = [cell(r, 2), cell(r, 3)];
    if (label === 'الإجمالي') total = shares;
    else months.push({ month: label, shares });
  }
  const data = { updatedAt: new Date().toISOString(), partners, months, total };
  cache = { at: Date.now(), data };
  return data;
}

export const PARTNERS_HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>499K — نصيب الشركاء</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4f1ea;--panel:#fffdf8;--ink:#1b1a17;--muted:#6f6a60;--line:#e4dfd3;--accent:#d9480f;--accent-soft:#ffe8dc;--c2:#3b5bdb;--c2-soft:#e4e9ff;--bad:#c2410c;--bad-soft:#fde7dc}
@media (prefers-color-scheme: dark){:root{--bg:#141311;--panel:#1d1b18;--ink:#f2eee6;--muted:#a39c8f;--line:#2f2c27;--accent:#ff7a3d;--accent-soft:#3a2216;--c2:#7d97ff;--c2-soft:#1c2340;--bad:#ff8a5b;--bad-soft:#35190f}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans Arabic",system-ui,sans-serif}
.num{font-family:"JetBrains Mono",ui-monospace,monospace;font-feature-settings:"tnum";direction:ltr;unicode-bidi:isolate}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 56px}
.brand b{font-size:28px;letter-spacing:-.5px}.brand b span{color:var(--accent)}
.brand small{display:block;color:var(--muted);font-size:14px;margin-top:2px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.card .who{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600}
.pct{font-size:12px;padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.card.p2 .pct{background:var(--c2-soft);color:var(--c2)}
.card .lbl{color:var(--muted);font-size:12px;margin-top:14px}
.card .val{font-size:30px;font-weight:700;margin-top:2px}
.card .now{color:var(--muted);font-size:13px;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{padding:11px 10px;border-bottom:1px solid var(--line);text-align:start}
th{color:var(--muted);font-size:13px;font-weight:500}
td.n,th.n{text-align:end}
tfoot td{font-weight:700;border-bottom:0}
.live{display:inline-block;margin-inline-start:6px;padding:1px 7px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:600}
.note,.updated{color:var(--muted);font-size:12px;margin-top:12px}
.err{background:var(--bad-soft);color:var(--bad);padding:14px;border-radius:12px}
@media (max-width:520px){.cards{grid-template-columns:1fr}.card .val{font-size:26px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><b>499<span>K</span></b><small>نصيب الشركاء من صافي الربح الشهري</small></div>
  <div id="app"><p class="note">بنحمّل الأرقام…</p></div>
</div>
<script>
const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const money = (t) => h('span', { class: 'num' }, t && t !== '-' ? t + ' ج' : '-');
async function load() {
  try {
    const r = await fetch(location.pathname.replace(/\/$/, '') + '/data.json', { cache: 'no-store' });
    if (!r.ok) throw 0;
    render(await r.json());
  } catch { $('#app').replaceChildren(h('div', { class: 'err' }, 'تعذّر تحميل الأرقام دلوقتي. جرّب تاني بعد شوية.')); }
}
function render(d) {
  const P = d.partners || [];
  const cur = d.months[0];
  const cards = h('section', { class: 'cards' }, P.map((p, i) => h('div', { class: 'card' + (i ? ' p2' : '') },
    h('div', { class: 'who' }, h('span', {}, p.name), h('span', { class: 'pct num' }, p.pct)),
    h('div', { class: 'lbl' }, 'الإجمالي من بداية الحساب'),
    h('div', { class: 'val' }, money(d.total ? d.total[i] : '-')),
    cur ? h('div', { class: 'now' }, cur.month + ': ', money(cur.shares[i])) : null)));
  const table = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'الشهر'), P.map((p) => h('th', { class: 'n' }, p.name + ' (' + p.pct + ')')))),
    h('tbody', {}, d.months.map((m, j) => h('tr', {},
      h('td', {}, m.month, j === 0 ? h('span', { class: 'live' }, 'لسه بيتحسب') : null),
      P.map((_, i) => h('td', { class: 'n' }, money(m.shares[i])))))),
    d.total ? h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), P.map((_, i) => h('td', { class: 'n' }, money(d.total[i]))))) : null);
  $('#app').replaceChildren(cards, h('div', { class: 'card' }, table),
    h('p', { class: 'note' }, 'كل شهر بيبدأ من صفر يوم 1، والشهر الحالي بيتحدّث كل ساعة مع كل أوردر بيتسلّم.'),
    h('p', { class: 'updated' }, 'آخر تحديث: ' + new Date(d.updatedAt).toLocaleString('ar-EG')));
}
load();
setInterval(load, 5 * 60_000);
</script>
</body>
</html>`;
