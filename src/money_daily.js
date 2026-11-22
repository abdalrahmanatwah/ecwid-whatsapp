// Feeds the personal money sheet ("فلوسي") from the business:
//  - one income row per day with 499K's profit on the orders delivered that day
//    (column J of the month tab: after shipping and wholesale, BEFORE ads —
//    ads are already in the personal sheet as Fawry expenses, so this avoids
//    counting them twice);
//  - the monthly outside salary (MONEY_SALARY, on day MONEY_SALARY_DAY, default 1).
// Rows have stable ids (499k:YYYY-MM-DD, salary:YYYY-MM), so re-running updates
// them in place instead of adding duplicates.

export const PROFIT_CAT = 'ربح 499K';
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

export function profitRow(date, profit) {
  return [date, '23:59', '499K', profit >= 0 ? 'دخل' : 'مصروف', profit > 0 ? profit : '', profit < 0 ? -profit : '',
    'أرباح الأوردرات', PROFIT_CAT, '', `'ربح الأوردرات اللي اتسلمت يوم ${date} بعد الشحن والجملة (قبل الإعلانات)`, `499k:${date}`];
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
    const same = Number(cur.r[4] || 0) === Number(w[4] || 0) && Number(cur.r[5] || 0) === Number(w[5] || 0);
    if (!same) updates.push({ row: cur.row, values: w });
  }
  return { updates, appends };
}
