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

// purchases: [{ row, date, key, qty }]; sales: [{ date, name, pairs }]
// → { [row]: { sold, last } }
export function allocate(purchases, sales) {
  const out = {};
  const open = purchases
    .filter((p) => p.date && norm(p.key) && p.qty > 0)
    .map((p) => ({ ...p, k: String(p.key).toLowerCase().replace(/\s+/g, ''), left: p.qty }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  for (const p of purchases) out[p.row] = { sold: 0, last: null };
  const keys = [...new Set(open.map((p) => p.k))];
  for (const s of [...sales].sort((a, b) => a.date.localeCompare(b.date))) {
    // Each model named on the row; its pairs go to that model's oldest open purchase(s).
    for (const k of keys) {
      let units = unitsInRow(s.name, open.find((p) => p.k === k).key, s.pairs);
      for (const p of open) {
        if (!units) break;
        if (p.k !== k || p.date > s.date || !p.left) continue;
        const take = Math.min(units, p.left);
        p.left -= take;
        units -= take;
        out[p.row].sold += take;
        out[p.row].last = s.date;
      }
    }
  }
  return out;
}

export const HEADERS = [
  'تاريخ الشراء', 'الموديل (زي ما بيتكتب في الأوردر)', 'سعر القطعة جملة', 'العدد', 'إجمالي الفاتورة',
  'اتباع منه (تلقائي)', 'فلوس رجعتلك', 'فاضل في المخزن', 'قيمة المخزون', 'نسبة اللي رجع', 'آخر بيعة',
];

// Formulas for purchase row r (columns E, G, H, I, J).
export const rowFormulas = (r) => ({
  E: `=IF(D${r}="","",C${r}*D${r})`,
  G: `=IF(D${r}="","",MIN(N(F${r}),D${r})*C${r})`,
  H: `=IF(D${r}="","",MAX(0,D${r}-N(F${r})))`,
  I: `=IF(D${r}="","",H${r}*C${r})`,
  J: `=IF(N(E${r})=0,"",G${r}/E${r})`,
});
