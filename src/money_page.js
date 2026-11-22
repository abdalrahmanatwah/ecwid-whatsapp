// "فلوسي": a phone-first page over the personal money sheet (behind dashboard login).
// GET /dashboard/money            → the page
// GET /dashboard/money/data.json  → every row of the "الحركات" tab

import * as sheets from './google_sheets.js';
import { serialToDate } from './purchases.js';
const TAB = 'الحركات'; // same tab money.js writes to

const SHEET_ID = process.env.MONEY_SHEET_ID || '';

const toISO = (v) => {
  if (typeof v === 'number') return serialToDate(v);
  const s = String(v || '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
// The sheet turns "12:39" into a time value (a fraction of a day).
const toTime = (v) => {
  if (typeof v !== 'number') return String(v || '');
  const mins = Math.round((v % 1) * 1440);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
const n = (v) => (v === '' || v == null ? null : Number(String(v).replace(/,/g, '')) || 0);

export async function moneyData() {
  if (!SHEET_ID) throw new Error('MONEY_SHEET_ID not set');
  const rows = await sheets.getRawValues(SHEET_ID, `'${TAB}'!A2:J5000`);
  const tx = (rows || []).filter((r) => r && r[0]).map((r) => ({
    date: toISO(r[0]), time: toTime(r[1]), source: String(r[2] || ''), type: String(r[3] || ''),
    in: n(r[4]), out: n(r[5]), who: String(r[6] || ''), cat: String(r[7] || ''), bal: n(r[8]), msg: String(r[9] || ''),
  })).filter((t) => t.date);
  return { updatedAt: new Date().toISOString(), tx };
}

export const MONEY_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0f1a14">
<title>فلوسي</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f3f1ec;--panel:#fffefb;--ink:#17201b;--muted:#6c7069;--line:#e3e0d8;--in:#13795b;--in-soft:#dff3ea;--out:#c0392b;--out-soft:#fbe4e0;--accent:#1f4d3a;--chip:#ebe8e0;--warn:#a15c00;--warn-soft:#fff1d6}
@media (prefers-color-scheme: dark){:root{--bg:#0f1412;--panel:#171d1a;--ink:#eef2ee;--muted:#9aa29c;--line:#26302b;--in:#3ccf98;--in-soft:#12301f;--out:#ff7b6b;--out-soft:#3a1915;--accent:#8fd3b4;--chip:#212a25;--warn:#ffc061;--warn-soft:#332611}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans Arabic",system-ui,sans-serif}
.num{font-family:"JetBrains Mono",ui-monospace,monospace;font-feature-settings:"tnum";direction:ltr;unicode-bidi:isolate}
.wrap{max-width:720px;margin:0 auto;padding:20px 16px calc(48px + env(safe-area-inset-bottom))}
header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
header b{font-size:26px;letter-spacing:-.3px}
header small{color:var(--muted);font-size:12px}
.months{display:flex;gap:8px;overflow-x:auto;padding:14px 0 4px;scrollbar-width:none}
.months::-webkit-scrollbar{display:none}
.chip{flex:none;border:0;border-radius:999px;padding:7px 14px;background:var(--chip);color:var(--ink);font:500 14px inherit;font-family:inherit;cursor:pointer}
.chip.on{background:var(--accent);color:var(--bg)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:14px}
.hero .lbl{color:var(--muted);font-size:13px}
.hero .net{font-size:40px;font-weight:700;margin:4px 0 14px;letter-spacing:-1px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pill{border-radius:14px;padding:12px 14px}
.pill.in{background:var(--in-soft);color:var(--in)}.pill.out{background:var(--out-soft);color:var(--out)}
.pill .k{font-size:12px;opacity:.85}.pill .v{font-size:22px;font-weight:700;margin-top:2px}
.bals{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
.bal{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.bal .k{color:var(--muted);font-size:12px}.bal .v{font-size:20px;font-weight:700;margin-top:2px}.bal .w{color:var(--muted);font-size:11px;margin-top:2px}
h2{font-size:15px;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center}
h2 small{color:var(--muted);font-weight:400;font-size:12px}
.cat{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;padding:7px 0;cursor:pointer;border-radius:10px}
.cat .ic{font-size:17px;text-align:center}
.cat .bar{height:8px;border-radius:99px;background:var(--chip);overflow:hidden;margin-top:5px}
.cat .bar i{display:block;height:100%;border-radius:99px;background:var(--out)}
.cat .nm{font-size:14px;display:flex;justify-content:space-between;gap:8px}.cat .nm span{color:var(--muted);font-size:12px}
.cat .amt{font-size:14px;font-weight:700}
.cat.on .nm{font-weight:700}.cat.dim{opacity:.4}
.days{display:flex;align-items:flex-end;gap:3px;height:96px;margin-top:4px}
.days div{flex:1;background:var(--out);opacity:.85;border-radius:4px 4px 0 0;min-height:2px}
.days div.z{background:var(--line);opacity:1}
.days div.today{outline:2px solid var(--accent);outline-offset:1px}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:6px}
.tools{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.tools input{flex:1;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:12px;padding:10px 12px;font:15px inherit;font-family:inherit}
.tools button{border:0;background:var(--chip);color:var(--ink);border-radius:12px;padding:10px 12px;font-family:inherit;cursor:pointer}
.day{color:var(--muted);font-size:12px;margin:16px 0 4px;display:flex;justify-content:space-between}
.tx{display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}
.tx:last-child{border-bottom:0}
.tx .ic{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--chip);font-size:18px}
.tx .t{unicode-bidi:plaintext;text-align:start;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tx .s{color:var(--muted);font-size:12px;margin-top:2px}
.tx .a{font-weight:700;font-size:15px}.tx .a.in{color:var(--in)}.tx .a.out{color:var(--out)}
.tx .m{grid-column:1/-1;color:var(--muted);font-size:12px;background:var(--bg);border-radius:10px;padding:10px;line-height:1.7;display:none}
.tx.open .m{display:block}
.flag{display:inline-block;background:var(--warn-soft);color:var(--warn);border-radius:6px;padding:0 6px;font-size:11px;margin-inline-start:6px}
.warn{background:var(--warn-soft);color:var(--warn);border-radius:12px;padding:10px 12px;font-size:13px;margin-top:14px}
.empty,.note{color:var(--muted);font-size:13px;text-align:center;padding:18px 0}
.err{background:var(--out-soft);color:var(--out);padding:14px;border-radius:12px;margin-top:14px}
@media (max-width:420px){.hero .net{font-size:34px}.pill .v{font-size:19px}}
</style>
</head>
<body>
<div class="wrap">
  <header><b>فلوسي</b><small id="upd"></small></header>
  <div id="app"><p class="note">بنحمّل الحركات…</p></div>
</div>
<script>
const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const fmt = (x) => Math.round(x || 0).toLocaleString('en-US');
const money = (x, sign) => h('span', { class: 'num' }, (sign && x > 0 ? sign : '') + fmt(Math.abs(x)) + ' ج');
const ICONS = { 'إعلانات': '📣', 'طلبات': '🛵', 'أكل وكافيهات': '☕', 'سوبر ماركت': '🛒', 'مواصلات وبنزين': '⛽', 'فواتير وشحن': '🧾',
  'أونلاين واشتراكات': '💳', 'صحة': '💊', 'سحب كاش': '🏧', 'تحويلات': '↔️', 'دخل': '💰', 'مرتب': '💼', 'مش واضح': '❓', 'تاني': '•' };
const icon = (c) => ICONS[c] || '•';
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const monthName = (k) => { const [y, m] = k.split('-'); return AR_MONTHS[m - 1] + ' ' + y; };
const dayName = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

let DATA = null, month = null, catFilter = null, q = '';

async function load() {
  try {
    const r = await fetch(location.pathname.replace(/\\/$/, '') + '/data.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
    const months = [...new Set(DATA.tx.map((t) => t.date.slice(0, 7)))].sort().reverse();
    const now = new Date().toISOString().slice(0, 7);
    if (!month || !months.includes(month)) month = months.includes(now) ? now : (months[0] || now);
    $('#upd').textContent = 'اتحدّث ' + new Date(DATA.updatedAt).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
    render();
  } catch (e) {
    $('#app').replaceChildren(h('div', { class: 'err' }, 'تعذّر تحميل الحركات دلوقتي. جرّب تاني بعد شوية.'));
  }
}

function lastBalance(source) {
  const rows = DATA.tx.filter((t) => t.source === source && t.bal != null);
  if (!rows.length) return null;
  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return rows[rows.length - 1];
}

function render() {
  const all = DATA.tx;
  const months = [...new Set(all.map((t) => t.date.slice(0, 7)))].sort().reverse();
  if (!months.includes(month)) months.unshift(month);
  const mt = all.filter((t) => t.date.startsWith(month));
  const inSum = mt.reduce((s, t) => s + (t.in || 0), 0);
  const outSum = mt.reduce((s, t) => s + (t.out || 0), 0);
  const unclear = mt.filter((t) => t.type === 'مش واضح').length;

  const chips = h('div', { class: 'months' }, months.map((m) => h('button', { class: 'chip' + (m === month ? ' on' : ''),
    on: { click: () => { month = m; catFilter = null; render(); } } }, monthName(m))));

  const hero = h('section', { class: 'panel hero' },
    h('div', { class: 'lbl' }, 'الصافي في ' + monthName(month)),
    h('div', { class: 'net', style: 'color:var(' + (inSum - outSum >= 0 ? '--in' : '--out') + ')' }, h('span', { class: 'num' }, (inSum - outSum < 0 ? '−' : '') + fmt(Math.abs(inSum - outSum)) + ' ج')),
    h('div', { class: 'pair' },
      h('div', { class: 'pill in' }, h('div', { class: 'k' }, 'داخل'), h('div', { class: 'v' }, money(inSum))),
      h('div', { class: 'pill out' }, h('div', { class: 'k' }, 'خارج'), h('div', { class: 'v' }, money(outSum)))));

  const balBox = (label, src) => {
    const b = lastBalance(src);
    return h('div', { class: 'bal' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, b ? money(b.bal) : '—'),
      h('div', { class: 'w' }, b ? 'آخر رسالة ' + new Date(b.date + 'T12:00:00').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) + ' ' + b.time : 'لسه مفيش رسالة فيها رصيد'));
  };
  const bals = h('section', { class: 'bals' }, balBox('رصيد فودافون كاش', 'فودافون كاش'), balBox('رصيد البنك الأهلي', 'البنك الأهلي'));

  // Spending by category.
  const byCat = {};
  for (const t of mt) if (t.out) byCat[t.cat || 'تاني'] = (byCat[t.cat || 'تاني'] || 0) + t.out;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  const catPanel = h('section', { class: 'panel' },
    h('h2', {}, 'الصرف حسب التصنيف', h('small', {}, catFilter ? 'دوس تاني عشان تلغي الفلتر' : 'دوس على تصنيف تشوف حركاته')),
    cats.length ? cats.map(([c, v]) => h('div', { class: 'cat' + (catFilter === c ? ' on' : catFilter ? ' dim' : ''),
      on: { click: () => { catFilter = catFilter === c ? null : c; render(); document.getElementById('list').scrollIntoView({ behavior: 'smooth' }); } } },
      h('div', { class: 'ic' }, icon(c)),
      h('div', {}, h('div', { class: 'nm' }, c, h('span', { class: 'num' }, Math.round(v / outSum * 100) + '%')),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(3, v / max * 100) + '%' }))),
      h('div', { class: 'amt' }, money(v)))) : h('div', { class: 'empty' }, 'مفيش مصاريف في الشهر ده.'));

  // Daily spending.
  const [y, m] = month.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const perDay = Array(nDays).fill(0);
  for (const t of mt) if (t.out) perDay[Number(t.date.slice(8, 10)) - 1] += t.out;
  const dmax = Math.max(1, ...perDay);
  const today = new Date().toISOString().slice(0, 10);
  const daysPanel = h('section', { class: 'panel' },
    h('h2', {}, 'الصرف يوم بيوم', h('small', {}, 'أعلى يوم: ', money(dmax === 1 && !perDay.some(Boolean) ? 0 : dmax))),
    h('div', { class: 'days', dir: 'ltr' }, perDay.map((v, i) => {
      const d = month + '-' + String(i + 1).padStart(2, '0');
      return h('div', { class: (v ? '' : 'z') + (d === today ? ' today' : ''), title: (i + 1) + ': ' + fmt(v) + ' ج', style: 'height:' + (v ? Math.max(4, v / dmax * 100) : 2) + '%' });
    })),
    h('div', { class: 'axis', dir: 'ltr' }, h('span', {}, '1'), h('span', {}, String(Math.ceil(nDays / 2))), h('span', {}, String(nDays))));

  // Transactions.
  const qq = q.trim().toLowerCase();
  const list = mt.filter((t) => (!catFilter || (t.cat || 'تاني') === catFilter) &&
      (!qq || (t.who + ' ' + t.cat + ' ' + t.source + ' ' + t.msg).toLowerCase().includes(qq)))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const search = h('input', { type: 'search', placeholder: 'دوّر: طلبات، فوري، اسم، رقم…', value: q });
  search.addEventListener('input', (e) => { q = e.target.value; renderList(); });
  const listBox = h('div', {});
  function renderList() {
    const qq2 = q.trim().toLowerCase();
    const items = mt.filter((t) => (!catFilter || (t.cat || 'تاني') === catFilter) &&
      (!qq2 || (t.who + ' ' + t.cat + ' ' + t.source + ' ' + t.msg).toLowerCase().includes(qq2)))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const gs = [];
    for (const t of items) { const g = gs[gs.length - 1]; if (g && g.date === t.date) g.items.push(t); else gs.push({ date: t.date, items: [t] }); }
    listBox.replaceChildren(...(gs.length ? gs.map((g) => {
      const dayOut = g.items.reduce((s, t) => s + (t.out || 0), 0);
      return h('div', {}, h('div', { class: 'day' }, h('span', {}, dayName(g.date)), dayOut ? h('span', {}, 'خارج ', money(dayOut)) : null),
        g.items.map((t) => {
          const isIn = (t.in || 0) > 0;
          const row = h('div', { class: 'tx' },
            h('div', { class: 'ic' }, icon(t.cat)),
            h('div', { style: 'min-width:0' }, h('div', { class: 't' }, t.who || t.cat || t.source, t.type === 'مش واضح' ? h('span', { class: 'flag' }, 'مش واضح') : null),
              h('div', { class: 's' }, [t.cat, t.source, t.time].filter(Boolean).join(' · '))),
            h('div', { class: 'a ' + (isIn ? 'in' : 'out') }, money(isIn ? t.in : (t.out || 0), isIn ? '+' : '−')),
            h('div', { class: 'm' }, t.msg.replace(/^'/, '')));
          row.addEventListener('click', () => row.classList.toggle('open'));
          return row;
        }));
    }) : [h('div', { class: 'empty' }, q || catFilter ? 'مفيش حركات بالفلتر ده.' : 'مفيش حركات في الشهر ده لسه.')]));
  }
  renderList();
  const listPanel = h('section', { class: 'panel', id: 'list' },
    h('h2', {}, 'الحركات', h('small', {}, catFilter ? icon(catFilter) + ' ' + catFilter : list.length + ' حركة')),
    h('div', { class: 'tools' }, search, catFilter ? h('button', { on: { click: () => { catFilter = null; render(); } } }, 'كل التصنيفات') : null),
    listBox);

  $('#app').replaceChildren(chips, hero, bals,
    unclear ? h('div', { class: 'warn' }, unclear + ' رسالة ما اتقريتش كويس الشهر ده — معلّمة "مش واضح" تحت.') : null,
    catPanel, daysPanel, listPanel,
    h('p', { class: 'note' }, 'كل رسالة من البنك أو فودافون كاش بتظهر هنا لوحدها. تعديل التصنيف بيتعمل من الشيت.'));
}

load();
setInterval(load, 2 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;
