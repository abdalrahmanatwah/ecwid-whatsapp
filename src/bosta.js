// Bosta delivery client. Creates a "Send" (deliver) shipment from an Ecwid
// order. City comes from Ecwid's dropdown and is matched to a Bosta city ID;
// the street line is translated to Arabic. Cash-on-delivery amount = order total.
//
// IMPORTANT: test against Bosta STAGING first (set BOSTA_BASE_URL to the staging
// URL). Bosta's exact required address fields can vary by account; this client
// logs the full Bosta error so any field mismatch is easy to see and adjust.

import { translateAddressToArabic } from './translate.js';

const BASE = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
const API_KEY = process.env.BOSTA_API_KEY || '';
const DELIVERY_TYPE_SEND = Number(process.env.BOSTA_DELIVERY_TYPE || 10); // 10 = Deliver/Send
// Dry run: build + log the shipment but DON'T create it (safe testing).
const DRY_RUN = String(process.env.BOSTA_DRY_RUN || '').toLowerCase() === 'true';

export function bostaConfigured() {
  return Boolean(API_KEY);
}

function authHeaders() {
  // Bosta v2 expects the API key directly in the Authorization header.
  return { Authorization: API_KEY, 'Content-Type': 'application/json' };
}

// --- City resolution -------------------------------------------------------
// Fetch Bosta's city list once and cache it, then match an Ecwid city name
// (English or Arabic) to Bosta's internal city id.
let _cityCache = null;

function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip Arabic diacritics (proper char class)
    .replace(/[إأآا]/g, 'ا')               // unify alef forms
    .replace(/ى/g, 'ي')                    // alef maqsura -> ya
    .replace(/ة/g, 'ه')                    // ta marbuta -> ha
    .replace(/\u0640/g, '')                // strip tatweel
    .replace(/\s+/g, ' ');
}

async function loadCities() {
  if (_cityCache) return _cityCache;
  const res = await fetch(`${BASE}/cities`, { headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bosta getCities failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  // Bosta responses commonly wrap the list under data.list or data.
  const list = data?.data?.list || data?.data || data?.cities || [];
  const map = new Map();
  for (const c of list) {
    const id = c._id || c.id || c.cityId;
    if (!id) continue;
    for (const label of [c.name, c.nameAr, c.otherName]) {
      if (label) map.set(normalize(label), id);
    }
  }
  _cityCache = map;
  return map;
}

// Try several candidate names (e.g. area, then governorate) and return the
// first that matches a Bosta city. On total failure, logs the available Bosta
// city names so the mismatch is easy to diagnose.
export async function resolveCityId(candidates) {
  const map = await loadCities();
  const tried = [];
  for (const name of candidates) {
    if (!name) continue;
    tried.push(name);
    const id = map.get(normalize(name));
    if (id) return id;
  }
  const available = [...new Set([...map.keys()])].sort().join(', ');
  console.error(`[bosta] no city match for [${tried.join(' | ')}]. Bosta cities available: ${available}`);
  throw new Error(`Bosta has no city matching [${tried.join(' | ')}] — see logs for Bosta's city list, then adjust`);
}

// --- Create delivery from an Ecwid order -----------------------------------
function pickAddress(order) {
  const p = order.shippingPerson || order.billingPerson || {};
  return {
    name: p.name || order.customerName || 'Customer',
    phone: p.phone || order.phone || '',
    street: p.street || p.address || '',
    city: p.city || '',                                   // often the AREA (e.g. حلوان)
    state: p.stateOrProvinceName || p.stateOrProvinceCode || '', // governorate (e.g. Cairo)
    postalCode: p.postalCode || '',
  };
}

function splitName(full) {
  const parts = String(full || 'Customer').trim().split(/\s+/);
  const firstName = parts.shift() || 'Customer';
  const lastName = parts.join(' ') || '.';
  return { firstName, lastName };
}

// Builds the Bosta payload and creates the delivery. Returns the created
// delivery (with trackingNumber). Throws on any problem so the caller can
// fail safe (leave the order in Processing and alert the merchant).
export async function createDeliveryFromOrder(order) {
  if (!API_KEY) throw new Error('BOSTA_API_KEY not set');

  const addr = pickAddress(order);
  if (!addr.phone) throw new Error('order has no phone for Bosta receiver');
  if (!addr.city && !addr.state) throw new Error('order has no city/governorate for Bosta');

  // Bosta cities are governorate-level (Cairo, Giza, …). Try the area first
  // (in case Bosta lists it), then fall back to the governorate.
  const cityId = await resolveCityId([addr.city, addr.state]);

  // Keep the area in the address line so the courier sees it even when the
  // Bosta "city" resolved to the governorate. Then translate the whole line.
  const fullStreet = [addr.city, addr.street].filter(Boolean).join('، ');
  const arabicStreet = await translateAddressToArabic(fullStreet);
  const { firstName, lastName } = splitName(addr.name);

  const item = (order.items || [])[0] || {};
  const description = item.name || 'Order item';
  const cod = Number(order.total || 0); // Cash on Delivery = full order total

  const payload = {
    type: DELIVERY_TYPE_SEND,
    specs: {
      packageType: 'Parcel',
      packageDetails: { itemsCount: 1, description },
    },
    cod,
    dropOffAddress: {
      city: cityId,
      firstLine: arabicStreet || addr.street || '-',
    },
    receiver: { firstName, lastName, phone: addr.phone },
    businessReference: String(order.orderNumber || order.id || ''),
    // Preserve the original (untranslated) address so nothing is lost if the
    // translation is imperfect — the courier still has the source text.
    notes: fullStreet && arabicStreet !== fullStreet ? `Original: ${fullStreet}` : '',
  };

  if (DRY_RUN) {
    console.log(
      `[bosta] DRY RUN — order ${payload.businessReference}: would create this delivery (NOT sent):\n` +
        JSON.stringify(payload, null, 2)
    );
    return { trackingNumber: null, deliveryId: null, dryRun: true, payload };
  }

  const res = await fetch(`${BASE}/deliveries`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Bosta createDelivery failed: ${res.status} ${JSON.stringify(data)}`);
  }

  const d = data?.data || data;
  const trackingNumber = d.trackingNumber || d.tracking_number || null;
  const deliveryId = d._id || d.id || null;
  return { trackingNumber, deliveryId, raw: d };
}

// Reads a delivery's current state from Bosta. Returns { code, value } where
// value is Bosta's human-readable state (e.g. "Delivered", "Returned to business").
// Used to trigger the post-delivery follow-up messages.
export async function getDeliveryState(deliveryId) {
  if (!API_KEY || !deliveryId) return null;
  const res = await fetch(`${BASE}/deliveries/${deliveryId}`, { headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bosta getDelivery failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const d = data?.data || data;
  const state = d?.state || {};
  return {
    code: state.code ?? state.stateCode ?? null,
    value: state.value || state.state || d?.maskedState || '',
  };
}
