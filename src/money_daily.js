// Feeds the personal money sheet ("فلوسي") from the business:
//  - one income row per day with 499K's net for the day: profit on the orders
//    delivered that day (month tab column J: after shipping and wholesale)
//    minus that day's Meta ad spend, minus the partners' share (their % from
//    the partners tab, from their start date). The Fawry payments that fund the
//    ad account are business money, so the page and summary leave the
//    "إعلانات" category out of personal spending;
//  - the monthly outside salary (MONEY_SALARY, on day MONEY_SALARY_DAY, default 1).
// Rows have stable ids (499k:YYYY-MM-DD, salary:YYYY-MM), so re-running updates
// them in place instead of adding duplicates.

export const PROFIT_CAT = 'صافي 499K';
export const SALARY_CAT = 'مرتب';

// rows: raw month-tab rows from column A (date serial) to J (profit).
export function profitByDay(rows, serialToDate) {
  const out = {};
  for (const r of rows || []) {
    if (typeof r?.[0] !== 'number') continue;
    const p = r[9];
    if (typeof p !== 'number') continue; // returned rows show "-"
    const d = serialToDate(r[0]);
    out[d] = Math.round(((out[d] || 0) + p) * 100) / 100;
  }
  return out;
}

// One day's net: orders' profit − ad spend, then the partners' cut (pct, 0–1) if it applies.
export function dayNet(profit, ads, pct) {
  const before = (profit || 0) - (ads || 0);
  const partners = pct ? before * pct : 0;
  return { before: round2(before), partners: round2(partners), net: round2(before - partners) };
}
const round2 = (x) => Math.round(x * 100) / 100;
const f0 = (x) => Math.round(x).toLocaleString('en-US');

export function profitRow(date, profit, ads = 0, pct = 0) {
  const { partners, net } = dayNet(profit, ads, pct);
  const note = `ربح الأوردرات ${f0(profit)} − إعلانات ${f0(ads)}` + (pct ? ` − نصيب الشركاء ${f0(partners)} (${Math.round(pct * 1000) / 10}%)` : '');
  return [date, '23:59', '499K', net >= 0 ? 'دخل' : 'مصروف', net > 0 ? net : '', net < 0 ? -net : '',
    'صافي اليوم', PROFIT_CAT, '', `'${note}`, `499k:${date}`];
}

export function salaryRow(month, day, amount) {
  const date = `${month}-${String(day).padStart(2, '0')}`;
  return [date, '09:00', 'مرتب خارجي', 'دخل', amount, '', 'مرتب خارجي', SALARY_CAT, '', `'مرتب خارجي شهر ${month}`, `salary:${month}`];
}

// existing: raw rows of the money tab from A2 (K = id). Returns { updates:[{row, values}], appends:[values] }.
export function planUpserts(existing, wanted) {
  const at = new Map();
  (existing || []).forEach((r, i) => { if (r?.[10]) at.set(String(r[10]), { row: i + 2, r }); });
  const updates = [], appends = [];
  for (const w of wanted) {
    const cur = at.get(w[10]);
    if (!cur) { appends.push(w); continue; }
    const same = Number(cur.r[4] || 0) === Number(w[4] || 0) && Number(cur.r[5] || 0) === Number(w[5] || 0) && (!w[0] || !cur.r[0] || typeof cur.r[0] === 'number' || String(cur.r[0]) === w[0]);
    if (!same) updates.push({ row: cur.row, values: w });
  }
  return { updates, appends };
}

