// Minimal Bosta client: reads a delivery's status BY TRACKING NUMBER.
// Used by the Ecwid-tracking bridge — you create the shipment in Bosta yourself
// and put its tracking number on the Ecwid order; the system reads that number
// and polls Bosta for the delivery's status. (Listing deliveries isn't possible
// on Bosta's API, so single-read-by-tracking-number is the only route — and it
// works on /api/v1.)

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

// Returns { code, value } for a delivery, where value is Bosta's human-readable
// state (e.g. "Delivered", "Exception"). Throws on HTTP errors so the caller can
// fail safe (e.g. stop tracking a delivery Bosta reports as not found).
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
  return {
    code: state.code ?? state.stateCode ?? null,
    value: state.value || state.state || d?.maskedState || '',
  };
}
