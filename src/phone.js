// Normalizes a phone number into the bare international format WhatsApp expects
// (digits only, no "+", no spaces). Handles the common ways people type numbers.

export function normalizePhone(raw, defaultCountryCode = '20') {
  if (!raw) return null;

  // Keep digits only (drop +, spaces, dashes, parentheses, etc.)
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // "00" international prefix -> drop it (e.g. 002010... -> 2010...)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return digits || null;
  }

  // Already starts with the country code (e.g. 2010...) -> leave as is.
  if (digits.startsWith(defaultCountryCode)) {
    return digits;
  }

  // Local format with a leading 0 (e.g. 01012345678) -> swap 0 for country code.
  if (digits.startsWith('0')) {
    return defaultCountryCode + digits.slice(1);
  }

  // Otherwise assume it's a local number missing the country code.
  return defaultCountryCode + digits;
}
