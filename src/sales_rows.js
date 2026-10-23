// Turns Bosta deliveries and QP orders into rows for the "499K Sales" sheet.
//
// Pure functions only (no network, no disk) so the rules can be tested against
// real carrier exports. sheet_sync.js does the I/O.
//
// Every order ends up in exactly one bucket:
//   sale   → a row in the month tab (delivered shoes with money collected)
//   review → a row in the review tab, for a human to decide (zero collection,
//            unclear description, non-shoe items, partial deliveries, exchanges)
//   return → counted in the month's refused/returned total, no row
//   skip   → ignored (still in transit, fee lines, return pickups)

const CAIRO_TZ = 'Africa/Cairo';

export const BRANDS = ['ASICS', 'ADIDAS', 'NIKE', 'ON', 'OTHER'];

// Order matters: the first pattern that matches a segment wins.
const BRAND_PATTERNS = [
  ['ASICS', /\basics\b/i],
  ['ADIDAS', /\badidas\b|\badizero\b|\by-3\b|\bterrex\b|\bhyperboost\b|\bultraboost\b/i],
  ['NIKE', /\bnike\b|\bvomero\b|\bpegasus\b/i],
  ['ON', /\bon running\b|\bon cloud|\bcloudtilt\b|\bcloudrock\b|\bcloudmonster\b|\bcloudsurfer\b|^\s*on\s+(roger|cloud)/i],
  ['OTHER', /\breebok\b|north face|\bbrooks\b|new balance|\btimberland\b|\bpuma\b|\bskechers\b|\bhoka\b|\bsaucony\b|\bmizuno\b|\bunder armour\b/i],
];

const NON_SHOE = /tennis bag|\bbag\b|شنط|backpack|\bsocks?\b|شراب/i;
const INSOLE = /insole|فرش/i;

// Sizes are always 35+, so any count above this is a size, not an insole count.
const MAX_INSOLES = 4;

export function detectBrand(text) {
  for (const [brand, re] of BRAND_PATTERNS) if (re.test(text)) return brand;
  return null;
}

export function countInsoles(desc) {
  const text = String(desc || '');
  const patterns = [
    /(\d+)\s*[×x]?\s*comfort foam insoles?/gi,
    /comfort foam insoles?\s*(?:\/\s*فرش طبي)?\s*:?\s*(\d+)/gi,
    /فرش(?:\s*طبي)?\s*:\s*(\d+)/g,
    /(\d+)\s*فرش/g,
    /insoles?[^\d]{0,12}quantity\s*(\d+)/gi,
  ];
  let best = 0;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= MAX_INSOLES && n > best) best = n;
    }
  }
  return best;
}

// Splits a description into its items. Carriers join items with "//", " + "
// or ", " — but a single "/" usually separates two sizes of the SAME shoe
// ("40½ / 40"), so that one is not a split point.
export function splitItems(desc) {
  return String(desc || '')
    .split(/\s*\/\/\s*|\s+\+\s+|,\s+(?=[A-Za-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Returns the shoe items in a description, each with its brand.
export function shoeItems(desc) {
  const items = [];
  for (const seg of splitItems(desc)) {
    // "asics 43 / on cloud 43" → two different shoes inside one segment
    const parts = seg.split(/\s+\/\s+/).filter((p) => detectBrand(p));
    const pieces = parts.length > 1 ? parts : [seg];
    for (const p of pieces) {
      const brand = detectBrand(p);
      if (brand) items.push({ text: p, brand });
    }
  }
  return items;
}

// Model price table: [{ key: 'hyperboost ephr', price: 1450 }, ...].
// The longest key contained in the item text wins, so "edge xt" beats "edge".
export function lookupModelPrice(itemText, priceTable) {
  const t = String(itemText || '').toLowerCase();
  let hit = null;
  for (const row of priceTable || []) {
    const k = String(row.key || '').toLowerCase().trim();
    if (!k || !(row.price > 0)) continue;
    if (t.includes(k) && (!hit || k.length > hit.key.length)) hit = { key: k, price: row.price };
  }
  return hit;
}

// ---- Dates -----------------------------------------------------------------

export function cairoDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export const monthKey = (ymd) => (ymd ? ymd.slice(0, 7) : null);

// Google Sheets date serial (days since 1899-12-30).
export function sheetSerial(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// ---- Normalizers -------------------------------------------------------------
// Bosta's API field names aren't fully documented, so read defensively: the
// same function handles the v1 single-delivery read, the list endpoints, and
// rows converted from the Excel export (used in tests).

const BOSTA_TYPE_CODES = { 10: 'SEND', 15: 'CASH_COLLECTION', 20: 'RTO', 25: 'CUSTOMER_RETURN_PICKUP', 30: 'EXCHANGE' };

function bostaTypeName(t) {
  if (t == null) return '';
  if (typeof t === 'object') return bostaTypeName(t.value ?? t.code ?? t.name);
  if (typeof t === 'number' || /^\d+$/.test(String(t))) return BOSTA_TYPE_CODES[Number(t)] || String(t);
  return String(t).toUpperCase().replace(/[\s-]+/g, '_').replace(/^DELIVER$|^FORWARD$/, 'SEND');
}

export function normalizeBosta(d) {
  const state = d.state || {};
  const stateValue = String(state.value || state.state || d.maskedState || d.deliveryState || '');
  const type = bostaTypeName(d.type);
  const oldType = bostaTypeName(d.oldType ?? d.type?.before ?? d.previousType);
  const deliveredAt =
    d.deliveredAt || state.deliveredAt || state.delivering?.time || state.delivered?.time ||
    d.collectedFromConsignee || (/delivered/i.test(stateValue) ? d.updatedAt : null);
  const description =
    d.specs?.packageDetails?.description || d.packageDetails?.description || d.description || '';
  return {
    id: `bosta:${d.trackingNumber}`,
    carrier: 'bosta',
    tracking: String(d.trackingNumber),
    type,
    oldType,
    state: stateValue,
    amount: Number(d.cod ?? d.codAmount ?? 0) || 0,
    fee: null, // Bosta's fee isn't on the delivery; the sheet uses the estimate cell
    description: String(description).replace(/\s+/g, ' ').trim(),
    note: String(d.notes || ''),
    createdDate: cairoDate(d.createdAt),
    deliveredDate: cairoDate(deliveredAt),
  };
}

export function normalizeQp(o) {
  return {
    id: `qp:${o.serial}`,
    carrier: 'qp',
    tracking: String(o.serial),
    type: 'SEND',
    oldType: '',
    state: String(o.status || ''),
    amount: Number(o.total_amount ?? 0) || 0,
    fee: Number(o.total_fees ?? 0) || 0,
    description: String(o.shipment_contents || '').replace(/\s+/g, ' ').trim(),
    note: String(o.status_note || '').replace(/\s+/g, ' ').trim(),
    createdDate: cairoDate(o.order_date),
    deliveredDate: o.status === 'Delivered' ? cairoDate(o.collected) : null,
    returnedDate: cairoDate(o.returned),
  };
}

// ---- Classification ------------------------------------------------------------

const MIN_PAIR_PRICE = 1700;

// Drops the insole add-on text that carriers append after the size.
function cleanItemName(text) {
  return text.replace(/\s*[\/,]?\s*(\d+\s*)?(comfort foam insoles?|فرش).*$/i, '').trim() || text;
} // below this per pair, not every listed pair was paid for

function reviewOrSale(n, priceTable) {
  const date = n.deliveredDate;
  const base = { id: n.id, carrier: n.carrier, date, amount: n.amount, fee: n.fee, description: n.description };

  if (n.amount <= 0) return { action: 'review', reason: 'تحصيل صفر (تحويل أو استبدال؟)', ...base };
  if (n.carrier === 'qp' && /استبدال/.test(n.note)) return { action: 'review', reason: `استبدال — ${n.note}`, ...base };

  const shoes = shoeItems(n.description);
  if (!shoes.length) {
    const what = NON_SHOE.test(n.description) ? 'مش شوز (شنطة أو غيره)' : INSOLE.test(n.description) ? 'فرش بس' : 'الوصف مش واضح';
    return { action: 'review', reason: what, ...base };
  }

  const partialNote = n.carrier === 'qp' && /مرتجع|جزئي|بدل/.test(n.note);
  if ((shoes.length > 1 && n.amount < MIN_PAIR_PRICE * shoes.length) || partialNote) {
    return { action: 'review', reason: `الوصف فيه ${shoes.length} زوج والمحصّل ${n.amount}${n.note ? ' — ' + n.note : ''} (استلام جزئي؟)`, ...base };
  }

  const insoles = countInsoles(n.description);
  const pairs = Object.fromEntries(BRANDS.map((b) => [b, 0]));
  const costs = [];
  const newModels = [];
  for (const s of shoes) {
    pairs[s.brand]++;
    const hit = lookupModelPrice(s.text, priceTable);
    costs.push(hit ? { price: hit.price } : { brand: s.brand });
    if (!hit) newModels.push(s.text);
  }
  const brandsUsed = [...new Set(shoes.map((s) => s.brand))];
  const notes = [];
  if (n.carrier === 'bosta') notes.push('شحن تقديري');
  if (newModels.length) notes.push('الجملة من الافتراضات (موديل جديد)');

  return {
    action: 'sale',
    ...base,
    name: shoes.map((s) => cleanItemName(s.text)).join(' + '),
    brand: brandsUsed.join(' + '),
    insoles,
    pairs,
    costs,
    note: notes.join(' · '),
  };
}

export function classify(n, priceTable) {
  if (n.carrier === 'qp') {
    if (/^\s*(رسوم|استرجاع)/.test(n.description)) return { action: 'skip' };
    const refused = /رفض|لاغى|لاغي|ملغ/.test(n.note);
    const neverLeft = /مجاش من الشركة/.test(n.note);
    if (n.state === 'Delivered' && n.deliveredDate) {
      if (n.amount <= 0 && n.returnedDate) return { action: 'return', id: n.id, carrier: n.carrier, date: n.createdDate };
      return reviewOrSale(n, priceTable);
    }
    if (n.state === 'Undelivered' && !neverLeft && (n.returnedDate || refused)) {
      return { action: 'return', id: n.id, carrier: n.carrier, date: n.createdDate };
    }
    return { action: 'skip' };
  }

  // Bosta
  const delivered = /delivered/i.test(n.state) && !/exchanged/i.test(n.state);
  if (n.type === 'RTO' && (!n.oldType || n.oldType === 'SEND')) {
    return { action: 'return', id: n.id, carrier: n.carrier, date: n.createdDate };
  }
  if (n.type === 'SEND' && /returned|return to|cancel/i.test(n.state)) {
    return { action: 'return', id: n.id, carrier: n.carrier, date: n.createdDate };
  }
  if (n.type === 'SEND' && delivered && n.deliveredDate) return reviewOrSale(n, priceTable);
  if (/EXCHANGE|CASH_COLLECTION/.test(n.type) && n.amount > 0 && /delivered|exchanged|collected/i.test(n.state)) {
    return {
      action: 'review', reason: 'استبدال / تحصيل', id: n.id, carrier: n.carrier, date: n.deliveredDate || n.createdDate,
      amount: n.amount, fee: n.fee, description: n.description,
    };
  }
  return { action: 'skip' };
}

// ---- Sheet rows ------------------------------------------------------------------

const A = "'الافتراضات'";
// Brand default wholesale cells in the assumptions tab.
export const BRAND_COST_CELL = {
  ASICS: `${A}!$B$3`, ADIDAS: `${A}!$B$4`, NIKE: `${A}!$B$5`, ON: `${A}!$B$6`, OTHER: `${A}!$B$7`,
};
const INSOLE_COST_CELL = `${A}!$B$8`;
const BOSTA_SHIPPING_CELL = `${A}!$B$9`;

// Columns A..Q of the month tab, for sheet row number r.
export function saleRowValues(sale, r) {
  const carrierLabel = sale.carrier === 'bosta' ? 'بوسطة' : 'QP';
  const cost = sale.costs.map((c) => (c.price ? String(c.price) : BRAND_COST_CELL[c.brand])).join('+');
  return [
    sheetSerial(sale.date),
    carrierLabel,
    sale.name,
    sale.brand,
    sale.insoles,
    sale.amount,
    sale.carrier === 'bosta' ? `=${BOSTA_SHIPPING_CELL}` : sale.fee,
    `=F${r}-G${r}`,
    `=${cost}+E${r}*${INSOLE_COST_CELL}`,
    `=H${r}-I${r}`,
    sale.note,
    ...BRANDS.map((b) => sale.pairs[b]),
    sale.id,
  ];
}

// Columns of the review tab.
export function reviewRowValues(item) {
  return [
    item.date ? sheetSerial(item.date) : '',
    item.carrier === 'bosta' ? 'بوسطة' : 'QP',
    item.description,
    item.amount,
    item.fee ?? '',
    item.reason,
    item.id,
    '',
  ];
}
