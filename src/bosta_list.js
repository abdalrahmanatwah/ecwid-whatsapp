// Lists recent Bosta deliveries — ALL of them, including orders that never went
// through Ecwid (WhatsApp/phone orders, exchanges) — for the sales-sheet sync.
//
// Bosta's listing endpoint isn't in their public v2 docs, so this tries the
// known candidates in order and remembers the first one that answers with a
// list of deliveries:
//   1. POST /api/v2/deliveries/search   (what Bosta's own dashboard uses)
//   2. GET  /api/v0/deliveries          (what Bosta's official SDKs call)
// If none works, the caller falls back to the deliveries it already tracks
// through Ecwid tracking numbers. GET /dashboard/api/bosta-probe shows which
// strategy works on this account and which fields Bosta returns.

const BASE = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
const ORIGIN = BASE.replace(/\/api\/v\d+.*$/i, '');
const API_KEY = process.env.BOSTA_API_KEY || '';
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.BOSTA_LIST_MAX_PAGES || 30);

const headers = () => ({ Authorization: API_KEY, 'Content-Type': 'application/json' });

// Bosta's v2 search ignores unknown body fields, so the right paging field
// isn't knowable up front. Page 1 is plain; for page 2 each variant below is
// tried until one returns shipments we haven't seen, and that one is kept.
// For each field the 0-based form is tried first: on a 1-based API it just
// repeats page 1 (no new shipments → rejected), while trying the 1-based form
// first on a 0-based API would silently skip a page.
const V2_PAGING = [
  (p) => ({ pageNumber: p - 1 }),
  (p) => ({ pageNumber: p }),
  (p) => ({ pageId: p - 1 }),
  (p) => ({ pageId: p }),
  (p) => ({ page: p - 1 }),
  (p) => ({ page: p }),
];
let v2Paging = null; // index into V2_PAGING that worked last time

const v2 = (body, size) =>
  fetch(`${ORIGIN}/api/v2/deliveries/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pageLimit: size, limit: size, sortBy: '-createdAt', ...body }),
  });

const STRATEGIES = {
  v2_search: (page, size, variant) => v2(page === 1 ? {} : V2_PAGING[variant](page), size),
  v0_list: (page, size) =>
    fetch(`${ORIGIN}/api/v0/deliveries?pageNumber=${page}&limit=${size}`, { headers: headers() }),
};

let working = null; // name of the strategy that worked last time

// Finds the array of deliveries in whatever envelope Bosta wraps it in.
export function extractDeliveries(json) {
  const candidates = [
    json?.data?.deliveries, json?.data?.list, json?.data?.data, json?.data,
    json?.deliveries, json?.list, json,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && (c.length === 0 || c[0]?.trackingNumber)) return c;
  }
  return null;
}

async function fetchPage(name, page, size, variant = 0) {
  const res = await STRATEGIES[name](page, size, variant);
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status} ${text.slice(0, 120)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${name} returned non-JSON`); }
  const list = extractDeliveries(json);
  if (!list) throw new Error(`${name} answered but no deliveries list found (keys: ${Object.keys(json?.data || json || {}).join(',')})`);
  return list;
}

const ageDays = (d) => (Date.now() - new Date(d?.createdAt || d?.updatedAt || Date.now()).getTime()) / 86_400_000;

// Page 2 with each paging variant until one brings new shipments.
async function findV2Paging(seen, size) {
  const order = v2Paging != null ? [v2Paging, ...V2_PAGING.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...V2_PAGING.keys()];
  for (const variant of order) {
    try {
      const list = await fetchPage('v2_search', 2, size, variant);
      if (list.some((d) => !seen.has(d.trackingNumber))) return { variant, list };
    } catch { /* try the next variant */ }
  }
  return null;
}

// Returns { strategy, deliveries, complete } covering roughly the last
// `sinceDays` days. `complete` is false when paging didn't work and only the
// newest page could be read. Throws if no strategy works at all.
export async function listRecentDeliveries({ sinceDays = 45 } = {}) {
  if (!API_KEY) throw new Error('BOSTA_API_KEY missing');
  const order = working ? [working, ...Object.keys(STRATEGIES).filter((s) => s !== working)] : Object.keys(STRATEGIES);
  const errors = [];

  for (const name of order) {
    try {
      const all = [];
      const seen = new Set();
      const take = (list) => {
        let fresh = 0;
        for (const d of list) {
          if (!d?.trackingNumber || seen.has(d.trackingNumber)) continue;
          seen.add(d.trackingNumber);
          all.push(d);
          fresh++;
        }
        return fresh;
      };
      const pastWindow = (list) => list.length > 0 && list.every((d) => ageDays(d) > sinceDays);

      const first = await fetchPage(name, 1, PAGE_SIZE);
      take(first);
      let complete = first.length < PAGE_SIZE || pastWindow(first);
      let variant = 0;

      if (!complete && name === 'v2_search') {
        const found = await findV2Paging(seen, PAGE_SIZE);
        if (found) {
          v2Paging = variant = found.variant;
          take(found.list);
          complete = found.list.length < PAGE_SIZE || pastWindow(found.list);
          for (let page = 3; !complete && page <= MAX_PAGES; page++) {
            const list = await fetchPage(name, page, PAGE_SIZE, variant);
            const fresh = take(list);
            if (list.length < PAGE_SIZE || pastWindow(list)) complete = true;
            else if (fresh === 0) break; // paging stopped advancing
          }
        }
      } else if (!complete) {
        for (let page = 2; !complete && page <= MAX_PAGES; page++) {
          const list = await fetchPage(name, page, PAGE_SIZE);
          const fresh = take(list);
          if (list.length < PAGE_SIZE || pastWindow(list)) complete = true;
          else if (fresh === 0) break;
        }
      }

      working = name;
      return { strategy: name, paging: name === 'v2_search' ? v2Paging : null, complete, deliveries: all.filter((d) => ageDays(d) <= sinceDays) };
    } catch (e) {
      errors.push(e.message);
    }
  }
  working = null;
  throw new Error(`no Bosta listing endpoint worked: ${errors.join(' | ')}`);
}

// For the probe page: what each strategy returns, without customer details.
const PII = /name|phone|address|receiver|consignee|email|firstLine|secondLine|building|floor|apartment/i;
function shape(obj, depth = 0) {
  if (obj == null || typeof obj !== 'object') return typeof obj;
  if (Array.isArray(obj)) return obj.length ? [shape(obj[0], depth + 1)] : [];
  if (depth > 2) return 'object';
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !PII.test(k)).map(([k, v]) => [k, shape(v, depth + 1)]));
}

export async function probeListing() {
  const out = {};
  try {
    const r = await listRecentDeliveries({ sinceDays: 45 });
    const dates = r.deliveries.map((d) => d.createdAt).filter(Boolean).map((x) => new Date(x).toISOString().slice(0, 10)).sort();
    out.fullListing = {
      strategy: r.strategy, pagingVariant: r.paging, complete: r.complete, count: r.deliveries.length,
      oldestCreated: dates[0] || null, newestCreated: dates.at(-1) || null,
    };
  } catch (e) {
    out.fullListing = { error: e.message };
  }
  for (const name of Object.keys(STRATEGIES)) {
    try {
      const list = await fetchPage(name, 1, 3);
      const first = list[0] || null;
      out[name] = {
        ok: true,
        count: list.length,
        fieldShape: shape(first),
        sample: first && {
          trackingNumber: first.trackingNumber, type: first.type, state: first.state?.value ?? first.state,
          cod: first.cod, createdAt: first.createdAt, updatedAt: first.updatedAt,
        },
      };
    } catch (e) {
      out[name] = { ok: false, error: e.message };
    }
  }
  return out;
}

export function deliveryShape(raw) {
  return shape(raw);
}
