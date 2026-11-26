// Read-only snapshot of every Ecwid product's price, so the owner can change
// prices for an offer by hand and put them back later. Writes the list to a
// new tab in the sales sheet and to the persistent disk.
// GET /dashboard/ecwid/price-snapshot?label=27-11

import { writeFileSync, mkdirSync } from 'node:fs';
import * as sheets from './google_sheets.js';
import { listProductPrices, listCategories } from './ecwid.js';

const SHEET_ID = process.env.SALES_SHEET_ID || '';
const DIR = process.env.PRICE_SNAPSHOT_DIR || '/var/data/price_snapshots';

export async function snapshotPrices(label) {
  const [products, cats] = await Promise.all([listProductPrices(), listCategories()]);
  const catName = Object.fromEntries(cats.map((c) => [c.id, String(c.name || '').replace(/\s*\|\s*499K\s*$/, '').replace(/[​]/g, '').trim()]));
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 16);
  const rows = products
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || String(a.name).localeCompare(String(b.name)))
    .map((p) => [p.name, p.price, p.oldPrice || '', p.enabled ? 'ظاهر' : 'مخفي', p.inStock === false ? 'خلصان' : 'متاح',
      (p.cats || []).map((id) => catName[id]).filter(Boolean).join('، '), String(p.id)]);
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(`${DIR}/${stamp.replace(/[: ]/g, '-')}.json`, JSON.stringify(products)); } catch { /* disk optional */ }

  const title = `أسعار قبل العرض ${label || stamp.slice(0, 10)}`;
  if (!SHEET_ID) return { saved: rows.length, sheet: null };
  const tabs = await sheets.getTabs(SHEET_ID);
  if (!tabs.some((t) => t.title === title)) {
    await sheets.batchUpdate(SHEET_ID, [{ addSheet: { properties: { title, rightToLeft: true, gridProperties: { rowCount: rows.length + 10, columnCount: 8 } } } }]);
  }
  const q = `'${title.replace(/'/g, "''")}'`;
  await sheets.updateValues(SHEET_ID, `${q}!A1:G${rows.length + 3}`, [
    [`أسعار كل المنتجات على إيكود — اتحفظت ${stamp} (بتوقيت القاهرة). ارجعلها بعد العرض.`, '', '', '', '', '', ''],
    ['المنتج', 'السعر', 'السعر المشطوب', 'ظاهر؟', 'المخزون', 'القسم', 'رقم المنتج'],
    ...rows,
  ]);
  return { saved: rows.length, sheet: title, at: stamp };
}
