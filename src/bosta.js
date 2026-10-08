// Bosta client: reads a delivery's status BY TRACKING NUMBER, creates new
// deliveries (auto-ship), and fetches the city list (for validating an order's
// city before shipping). Listing EXISTING deliveries isn't possible on Bosta's
// API, so single-read-by-tracking-number is the only route for status — and it
// works on /api/v1. Creation and cities work on /api/v2.

const BASE = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
// Reads live under /api/v1; derive that from whatever host BASE points at.
const READ_BASE = BASE.replace(/\/api\/v\d+.*$/i, '') + '/api/v1';
const API_KEY = process.env.BOSTA_API_KEY || '';

export function bostaConfigured() {
  return Boolean(API_KEY);
}

function authHeaders() {
  return { Authorization: API_KEY, 'Content-Type': 'application/json' };
}

// Returns { code, value, detail, raw } for a delivery.
//  - value:  Bosta's coarse, human-readable state (e.g. "Delivered", "Exception").
//            "Exception" covers several very different situations (postponed,
//            customer refused, wrong address, etc.) under the SAME code/value.
//  - detail: the more specific description Bosta gives for that state (from
//            maskedState), e.g. "Postponed - the client requested postponement
//            for another day" or "Cancellation - the customer refuses to
//            receive the shipment". This is what actually tells two
//            "Exception" deliveries apart — use this, not `value`, to decide
//            what message (if any) to send the customer.
//  - raw:    the full Bosta payload, kept for diagnosing unrecognized
//            Exceptions (so we can see where the real reason is written).
// Throws on HTTP errors so the caller can fail safe (e.g. stop tracking a
// delivery Bosta reports as not found).
export async function getDeliveryState(trackingNumber) {
  if (!API_KEY || !trackingNumber) return null;
  const res = await fetch(`${READ_BASE}/deliveries/${encodeURIComponent(trackingNumber)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bosta getDelivery failed: ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  const d = data?.data || data;
  const state = d?.state || {};
  const value = state.value || state.state || d?.maskedState || '';

  // When the state is "Exception", Bosta writes the real reason inside
  // state.exception[] (e.g. "Postponed - the customer requested postponement
  // for another day.", with a scheduledAt date) while maskedState is often
  // empty or just "Exception". Use the LATEST exception entry — and only when
  // the current state really is an Exception, so a stale entry from an earlier
  // attempt can't leak into a later "Out for delivery" state.
  let exReason = '';
  let exceptionKey = '';
  let scheduledAt = null;
  if (/exception/i.test(value) && Array.isArray(state.exception) && state.exception.length) {
    const latest = [...state.exception].sort(
      (a, b) => new Date(a?.time || 0) - new Date(b?.time || 0)
    ).pop();
    exReason = latest?.reason || '';
    exceptionKey = latest?.time || '';      // identifies THIS attempt's exception
    scheduledAt = latest?.scheduledAt || null; // new delivery date, if any
  }

  const masked = d?.maskedState || '';
  const maskedIsGeneric = !masked || /^\s*exception\s*$/i.test(masked);

  return {
    code: state.code ?? state.stateCode ?? null,
    value,
    detail: exReason && maskedIsGeneric ? exReason : (masked || exReason || state.value || state.state || ''),
    exceptionKey,
    scheduledAt,
    raw: d,
  };
}

// GET /cities — Bosta's official list of serviceable cities. Used to validate an
// order's city before shipping, since a city Bosta doesn't recognize is one of
// the documented fail-safe triggers (better to skip auto-ship than guess wrong).
let cachedCities = null;
export async function getCities() {
  if (cachedCities) return cachedCities;
  if (!API_KEY) return [];
  const res = await fetch(`${BASE}/cities`, { headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bosta getCities failed: ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  cachedCities = data?.data || data?.cities || (Array.isArray(data) ? data : []);
  return cachedCities;
}

// POST /deliveries — creates a new shipment. Returns the tracking number on
// success, or throws (caller is responsible for failing safe: leave the order
// alone and alert the merchant rather than retry blindly with bad data).
export async function createDelivery({ cod, city, addressLine, receiverName, receiverPhone, businessReference, notes }) {
  if (!API_KEY) throw new Error('Bosta not configured (BOSTA_API_KEY missing)');

  const body = {
    type: 10, // Bosta's "Forward" / standard package delivery code
    cod: Number(cod) || 0,
    dropOffAddress: {
      city,
      firstLine: addressLine,
    },
    businessReference: String(businessReference),
    receiver: {
      fullName: receiverName,
      phone: receiverPhone,
    },
    ...(notes ? { notes } : {}),
  };

  const res = await fetch(`${BASE}/deliveries`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bosta createDelivery failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const d = data?.data || data;
  // Defensive: don't assume one exact field name for the tracking number.
  const trackingNumber = d?.trackingNumber || d?._id || d?.id || d?.deliveryId;
  if (!trackingNumber) {
    throw new Error(`Bosta createDelivery succeeded but no tracking number found in response: ${JSON.stringify(d).slice(0, 200)}`);
  }
  return { trackingNumber, raw: d };
}
