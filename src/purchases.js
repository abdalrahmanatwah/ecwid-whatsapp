// Stock bought up front (not consignment): did the money come back yet?
//
// The "المشتريات" tab holds one row per purchase line: date, model name,
// wholesale price per pair, pairs bought. Each sync counts the pairs of that
// model sold since the purchase date (from the month tabs) and writes the
// count; the tab's formulas turn it into money recovered and stock left.
//
// Sales are matched to purchases first-in-first-out: a sale counts against the
// oldest purchase of that model, dated on or before the sale, that still has
// pairs left. Sales beyond what was bought are left alone (consignment stock).

export const PURCHASES_TAB = 'المشتريات';
export const FIRST_ROW = 5;

// Lower-case, letters and digits only, so "Hyper Boost" matches "HYPERBOOST".
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');

// Sheets date serial ↔ "YYYY-MM-DD".
const EPOCH = Date.UTC(1899, 11, 30);
export const serialToDate = (n) => new Date(EPOCH + Math.round(Number(n)) * 86400000).toISOString().slice(0, 10);

// A purchase date as typed: a sheet date (serial), "1/11", "1/11/2026", "2026-11-01".
export function parseDate(v, year = new Date().getUTCFullYear()) {
  if (typeof v === 'number' && v > 30000) return serialToDate(v);
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(year);
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// Pairs of `key` in one sales row. `pairs` = the row's brand pair counts (L..P).
// The key may list other spellings separated by "|" (e.g. "Reebok Float | rebook").
export function unitsInRow(name, key, pairs = []) {
  const alts = String(key || '').split('|').map((a) => a.trim()).filter(Boolean);
  if (alts.length > 1) return Math.max(0, ...alts.map((a) => unitsInRow(name, a, pairs)));
  const n = norm(name);
  const k = norm(key);
  if (!k || !n.includes(k)) return 0;
  const occ = n.split(k).length - 1;
  const brands = pairs.map(Number).filter((x) => x > 0);
  // A single item with several pairs (e.g. "Hyperboost 42/43" counted as 2) →
  // trust the pair count; a row listing several items counts mentions only.
  const severalItems = /\+|\/\/|&&/.test(String(name));
  return !severalItems && brands.length === 1 ? Math.max(occ, brands[0]) : occ;
}

// purchases: [{ row, date, key, qty }]; sales: [{ date, name, pairs, net }]
// (net = what the carrier paid out for the whole row, after shipping)
// → { [row]: { sold, last, units: [{ date, revenue }] } }
export function allocate(purchases, sales) {
  const out = {};
  const open = purchases
    .filter((p) => p.date && norm(p.key) && p.qty > 0)
    .map((p) => ({ ...p, k: String(p.key).toLowerCase().replace(/\s+/g, ''), left: p.qty }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  for (const p of purchases) out[p.row] = { sold: 0, last: null, units: [] };
  const keys = [...new Set(open.map((p) => p.k))];
  for (const s of [...sales].sort((a, b) => a.date.localeCompare(b.date))) {
    const rowPairs = Math.max(1, (s.pairs || []).map(Number).filter((x) => x > 0).reduce((a, b) => a + b, 0));
    // Each model named on the row; its pairs go to that model's oldest open purchase(s).
    for (const k of keys) {
      let units = unitsInRow(s.name, open.find((p) => p.k === k).key, s.pairs);
      // The row's money is split evenly over its pairs.
      const perPair = (Number(s.net) || 0) / Math.max(rowPairs, units);
      for (const p of open) {
        if (!units) break;
        if (p.k !== k || p.date > s.date || !p.left) continue;
        const take = Math.min(units, p.left);
        p.left -= take;
        units -= take;
        out[p.row].sold += take;
        out[p.row].last = s.date;
        for (let i = 0; i < take; i++) out[p.row].units.push({ date: s.date, revenue: perPair });
      }
    }
  }
  return out;
}

// "YYYY-MM-DD" + n months (day clamped to the month's length).
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const dayBefore = (date) => new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

// Cash view of one purchase: everything collected first pays back the invoice,
// whatever comes in after that is profit. Reported in cycles of `months`
// months from the purchase date, up to today.
// → { collected, paidBackOn, cycles: [{ n, from, to, sold, collected, cum, recovered, left, profit }] }
export function cashCycles(purchase, units, today, months = 2) {
  const cost = purchase.price * purchase.qty;
  const sorted = [...units].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  let paidBackOn = null;
  for (const u of sorted) {
    cum += u.revenue;
    if (!paidBackOn && cum >= cost - 0.5) paidBackOn = u.date;
  }
  const cycles = [];
  let running = 0;
  for (let n = 0; ; n++) {
    const from = addMonths(purchase.date, n * months);
    if (from > today && n > 0) break;
    const to = dayBefore(addMonths(purchase.date, (n + 1) * months));
    const inside = sorted.filter((u) => u.date >= from && u.date <= to);
    const got = inside.reduce((a, u) => a + u.revenue, 0);
    running += got;
    cycles.push({
      n: n + 1, from, to, sold: inside.length, collected: Math.round(got), cum: Math.round(running),
      recovered: Math.round(Math.min(running, cost)), left: Math.round(Math.max(0, cost - running)), profit: Math.round(Math.max(0, running - cost)),
    });
    if (n > 60) break;
  }
  return { collected: Math.round(cum), paidBackOn, cycles };
}

export const CYCLES_TAB = 'دورات المشتريات';
export const CYCLE_MONTHS = 2;
export const CYCLE_HEADERS = ['الموديل', 'تاريخ الشراء', 'الدورة', 'من', 'إلى', 'اتباع في الدورة', 'اتحصّل في الدورة', 'اتحصّل لحد آخر الدورة', 'رجع من الفاتورة', 'فاضل من الفاتورة', 'مكسب بعد ما الفاتورة رجعت'];

export const HEADERS = [
  'تاريخ الشراء', 'الموديل (زي ما بيتكتب في الأوردر)', 'سعر القطعة جملة', 'العدد', 'إجمالي الفاتورة',
  'اتباع منه (تلقائي)', 'جملة اللي اتباع', 'فاضل في المخزن', 'قيمة المخزون (جملة)', 'نسبة اللي رجع من الفاتورة', 'آخر بيعة',
  'اتحصّل من البيع (بعد الشحن)', 'فاضل من الفاتورة', 'مكسب بعد ما الفاتورة رجعت', 'الفاتورة رجعت يوم',
];

// Formulas for purchase row r (columns E, G, H, I, J, M, N).
export const rowFormulas = (r) => ({
  E: `=IF(D${r}="","",C${r}*D${r})`,
  G: `=IF(D${r}="","",MIN(N(F${r}),D${r})*C${r})`,
  H: `=IF(D${r}="","",MAX(0,D${r}-N(F${r})))`,
  I: `=IF(D${r}="","",H${r}*C${r})`,
  J: `=IF(N(E${r})=0,"",MIN(N(L${r}),E${r})/E${r})`,
  M: `=IF(D${r}="","",MAX(0,E${r}-N(L${r})))`,
  N: `=IF(D${r}="","",MAX(0,N(L${r})-E${r}))`,
});
