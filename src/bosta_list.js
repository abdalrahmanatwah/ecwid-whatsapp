// Lists recent Bosta deliveries — ALL of them, including orders that never went
// through Ecwid (WhatsApp/phone orders, exchanges) — for the sales-sheet sync.
//
// Bosta's listing endpoint isn't in their public v2 docs, so this tries the
// known candidates in order and remembers the first one that answers with a
// list of deliveries:
//   1. POST /api/v2/deliveries/search   (what Bosta's own dashboard uses)
//   2. GET  /api/v1/deliveries          (same family as the working single read)
//   3. GET  /api/v0/deliveries          (what Bosta's official SDKs call)
// If none works, the caller falls back to the deliveries it already tracks
// through Ecwid tracking numbers. GET /dashboard/api/bosta-probe shows which
// strategy works on this account and which fields Bosta returns.

const BASE = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
const ORIGIN = BASE.replace(/\/api\/v\d+.*$/i, '');
const API_KEY = process.env.BOSTA_API_KEY || '';
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.BOSTA_LIST_MAX_PAGES || 30);

const headers = () => ({ Authorization: API_KEY, 'Content-Type': 'application/json' });

const STRATEGIES = {
  v2_search: (page, size) =>
    fetch(`${ORIGIN}/api/v2/deliveries/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ pageNumber: page, pageLimit: size, sortBy: '-createdAt' }),
    }),
  v1_list: (page, size) =>
    fetch(`${ORIGIN}/api/v1/deliveries?pageNumber=${page}&pageLimit=${size}&sortBy=-createdAt`, { headers: headers() }),
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

async function fetchPage(name, page, size) {
  const res = await STRATEGIES[name](page, size);
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status} ${text.slice(0, 120)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${name} returned non-JSON`); }
  const list = extractDeliveries(json);
  if (!list) throw new Error(`${name} answered but no deliveries list found (keys: ${Object.keys(json?.data || json || {}).join(',')})`);
  return list;
}

const ageDays = (d) => (Date.now() - new Date(d?.createdAt || d?.updatedAt || Date.now()).getTime()) / 86_400_000;

// Returns { strategy, deliveries } covering roughly the last `sinceDays` days.
// Throws if no strategy works.
export async function listRecentDeliveries({ sinceDays = 45 } = {}) {
  if (!API_KEY) throw new Error('BOSTA_API_KEY missing');
  const order = working ? [working, ...Object.keys(STRATEGIES).filter((s) => s !== working)] : Object.keys(STRATEGIES);
  const errors = [];

  for (const name of order) {
    try {
      const all = [];
      const seen = new Set();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const list = await fetchPage(name, page, PAGE_SIZE);
        let fresh = 0;
        for (const d of list) {
          if (seen.has(d.trackingNumber)) continue;
          seen.add(d.trackingNumber);
          all.push(d);
          fresh++;
        }
        // Stop at the end of the data, when a page repeats (paging ignored),
        // or once a whole page is older than the window (newest-first order).
        if (list.length < PAGE_SIZE || fresh === 0 || list.every((d) => ageDays(d) > sinceDays)) break;
      }
      working = name;
      return { strategy: name, deliveries: all.filter((d) => ageDays(d) <= sinceDays) };
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
