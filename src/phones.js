// Phone-number helpers shared by the QP↔Ecwid matching and the sheet sync.

// All phone numbers in a string, as their last 10 digits (Egyptian mobiles:
// 01xxxxxxxxx / +201xxxxxxxxx / 0 122 … → 1xxxxxxxxx). Arabic-Indic digits included.
export function phoneKeys(text) {
  const western = String(text || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const keys = new Set();
  for (const m of western.matchAll(/\+?\d[\d\s-]{8,}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10) keys.add(digits.slice(-10));
  }
  return keys;
}

export function ecwidPhones(order) {
  const keys = new Set();
  for (const p of [order.phone, order.billingPerson?.phone, order.shippingPerson?.phone, order.contactPhone]) {
    for (const k of phoneKeys(p)) keys.add(k);
  }
  return keys;
}
