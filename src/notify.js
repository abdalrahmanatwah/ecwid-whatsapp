// Sends an optional WhatsApp alert to the store owner. Used by both the reply
// handler and the delayed shipping step. Silent no-op if MERCHANT isn't set.

import { sendText } from './whatsapp.js';

const MERCHANT = process.env.MERCHANT_WHATSAPP || '';

export async function notifyMerchant(text) {
  if (!MERCHANT) return;
  try {
    await sendText(MERCHANT, text);
  } catch (err) {
    console.warn('[merchant] notify skipped:', err.message);
  }
}
