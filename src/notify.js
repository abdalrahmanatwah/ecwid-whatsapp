// Sends an optional WhatsApp alert to the store owner. Silent no-op if MERCHANT
// isn't set. The owner number is normalized the same way customer numbers are,
// so "+20 102 …", "0102…", "00201…" etc. all work.
//
// Free-text messages only reach the owner if their last message to the bot was
// within 24h. If MERCHANT_NOTIFY_TEMPLATE_NAME is set (an approved template with
// ONE body variable), a failed free-text alert is retried through that template,
// which is delivered regardless of the 24h window.

import { sendText, sendTemplate } from './whatsapp.js';
import { normalizePhone } from './phone.js';

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '20';
const NOTIFY_TEMPLATE = process.env.MERCHANT_NOTIFY_TEMPLATE_NAME || '';
const NOTIFY_LANG = process.env.MERCHANT_NOTIFY_TEMPLATE_LANG || process.env.WHATSAPP_TEMPLATE_LANG || 'ar';

function cleanMerchant(raw) {
  let n = normalizePhone(raw, DEFAULT_CC);
  if (!n) return null;
  // Guard against "country code + a leading 0" (e.g. 20 + 010… → 2001…): drop the stray 0.
  if (n.startsWith(DEFAULT_CC + '0')) n = DEFAULT_CC + n.slice(DEFAULT_CC.length + 1);
  return n;
}

const MERCHANT = cleanMerchant(process.env.MERCHANT_WHATSAPP || '');

// Exported so call sites that need GUARANTEED delivery (not dependent on the
// 24h window) can send the owner an approved template directly via
// sendTemplate/sendTemplateWithButtons from whatsapp.js, instead of going
// through notifyMerchant's free-text sendText below.
export const merchantNumber = MERCHANT;

export async function notifyMerchant(text) {
  if (!MERCHANT) return;

  try {
    await sendText(MERCHANT, text);
    return;
  } catch (err) {
    if (!NOTIFY_TEMPLATE) {
      console.warn('[merchant] notify skipped:', err.message);
      return;
    }
    console.warn('[merchant] free-text alert failed, retrying via template:', String(err.message).slice(0, 160));
  }

  try {
    // Template variables can't contain newlines (sendTemplate collapses them)
    // and the body has a length limit, so keep the alert short.
    await sendTemplate(MERCHANT, NOTIFY_TEMPLATE, NOTIFY_LANG, [String(text).slice(0, 900)]);
  } catch (err2) {
    console.warn('[merchant] template alert skipped:', err2.message);
  }
}
