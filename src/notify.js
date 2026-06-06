// Sends an optional WhatsApp alert to the store owner. Silent no-op if MERCHANT
// isn't set. The owner number is normalized the same way customer numbers are,
// so "+20 102 …", "0102…", "00201…" etc. all work.

import { sendText } from './whatsapp.js';
import { normalizePhone } from './phone.js';

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '20';

function cleanMerchant(raw) {
  let n = normalizePhone(raw, DEFAULT_CC);
  if (!n) return null;
  // Guard against "country code + a leading 0" (e.g. 20 + 010… → 2001…): drop the stray 0.
  if (n.startsWith(DEFAULT_CC + '0')) n = DEFAULT_CC + n.slice(DEFAULT_CC.length + 1);
  return n;
}

const MERCHANT = cleanMerchant(process.env.MERCHANT_WHATSAPP || '');

export async function notifyMerchant(text) {
  if (!MERCHANT) return;
  try {
    await sendText(MERCHANT, text);
  } catch (err) {
    console.warn('[merchant] notify skipped:', err.message);
  }
}
