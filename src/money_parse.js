// Personal money log: turns a bank / Vodafone Cash SMS into one ledger row.
//
// Egyptian bank and wallet messages differ by sender, so this reads them by
// keywords rather than one fixed format: the amount (EGP / ج.م / جنيه), whether
// money came in or went out, the other side (shop, number, person), and the
// balance after, when the message has it. Anything it can't read is still
// logged, marked "مش واضح", so nothing is lost.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const toLatinDigits = (s) => String(s || '')
  .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
  .replace(/٫/g, '.').replace(/٬/g, ',');

const num = (s) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Card / account / wallet / phone / reference numbers (10+ digits): keep the last 4.
// Dates and times ("12:39 26-11-22") stay as they are.
export const maskNumbers = (s) => String(s || '').replace(/\d[\d*xX\- ]{6,}\d/g, (m) => {
  const digits = m.replace(/\D/g, '');
  return digits.length >= 10 ? `****${digits.slice(-4)}` : m;
});

const CUR = '(?:EGP|LE|L\\.E\\.?|E\\.?G\\.?P|ج\\.?م\\.?|جنيه(?:ا|اً)?|جم)';
const AMT = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';

// Words that say which way the money went. Checked in order: the first group
// that matches wins, so "تم تحويل ... إليك" (in) is tested before "تحويل" (out).
const IN_WORDS = [
  /تم\s+استلام/, /استلمت/, /\bاستلام\b/, /إيداع|ايداع/, /إضافة|اضافة|أضيف|اضيف/, /تحويل\s+(?:وارد|إليك|اليك|لك)/,
  /وارد/, /مرتجع|استرداد|استرجاع|refund/i, /credited|received|deposit|incoming|transfer\s+in|added to/i, /راتب|مرتب|salary/i,
];
const OUT_WORDS = [
  /خصم|مخصوم/, /سحب/, /شراء|مشتريات/, /دفع|سداد|مدفوع/, /تحويل|حولت|حوّلت/, /صادر/,
  /debited|purchase|withdraw|payment|paid|spent|transfer(?:red)?\s+to|charged|pos\b|atm\b/i,
];

const BALANCE_RE2 = new RegExp(`(?:الرصيد|رصيد)[^\\d\\n]{0,45}?(?:الحالي|المتاح|المتبقي|الجديد)\\s*:?\\s*${CUR}?\\s*${AMT}`, 'i');
// Al Ahly debit: "… المتاح 33938.75EGP".
const BALANCE_RE3 = new RegExp(`(?:^|\\s)(?:المتاح|available)\\s*:?\\s*${CUR}?\\s*${AMT}`, 'i');
const BALANCE_RE = new RegExp(`(?:الرصيد(?:\\s+(?:الحالي|المتاح|المتبقي|الجديد))?|رصيدك(?:\\s+(?:الحالي|المتاح))?|(?:available\\s+)?balance|bal\\.?|avl\\.?\\s*bal)\\s*(?:هو|is|:)?\\s*${CUR}?\\s*${AMT}`, 'i');

function findAmount(t) {
  // "500 جنيه" / "EGP 500" / "مبلغ 500"
  const patterns = [
    new RegExp(`${CUR}\\s*${AMT}`, 'i'),
    new RegExp(`${AMT}\\s*${CUR}`, 'i'),
    new RegExp(`(?:مبلغ|بمبلغ|amount(?:\\s+of)?)\\s*:?\\s*${AMT}`, 'i'),
  ];
  let best = null;
  for (const re of patterns) {
    const m = t.match(re);
    if (m && (best == null || m.index < best.index)) best = { value: num(m[1]), index: m.index, text: m[0] };
  }
  return best;
}

function direction(t) {
  const firstHit = (list) => list.reduce((best, re) => {
    const m = t.match(re);
    return m && (best == null || m.index < best) ? m.index : best;
  }, null);
  const i = firstHit(IN_WORDS);
  const o = firstHit(OUT_WORDS);
  // Al Ahly: "تم اضافه تحويل EGP ... لحساب 1010" = money credited to your account.
  if (/تم\s+[اإ]ضاف[ةه]/.test(t)) return 'in';
  if (i == null && o == null) return null;
  if (o == null) return 'in';
  if (i == null) return 'out';
  // Both: "تم تحويل مبلغ ... إليك من" → in. "تحويل وارد" also lands here.
  if (/إليك|اليك|لحسابك|إلى حسابك|الى حسابك|to your (?:account|wallet)/i.test(t) && !/(?:إلى|الى|لرقم|لـ)\s*\d/.test(t)) return 'in';
  return i < o ? 'in' : 'out';
}

const STOP = /\s+(?:رصيد\S*|الرصيد\S*|بنجاح|بتاريخ|يوم|في|على|عن|on|to|your|at|via|بقيمة|بمبلغ|balance|avl|ref|مصاريف|رسوم|عمولة|رقم\s+(?:العملية|مرجعي)|fees?)(?=\s|$).*$/i;
function counterparty(t) {
  const pats = [
    /(?:لدى|لدي|عند|\bat\b|@)\s+([^\n,،.]+)/i,
    /(?:من|from)\s+(?:رقم\s+|السيد\s+|محفظة\s+)?([^\n,،.]+)/i,
    /(?:إلى|الى|لرقم|ل\s*رقم|\bto\b)\s+(?:رقم\s+|محفظة\s+)?([^\n,،.]+)/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    const v = m[1].replace(STOP, '').replace(/^(?:التاجر|المتجر|merchant)\s+/i, '').trim().split(/\s+/).slice(0, 4).join(' ');
    if (!v || /^(?:حساب|حسابك|بطاقتك|كارت|card|your|account|EGP|LE|جنيه|ج\.?م)/i.test(v) || /^\d{1,7}(?:[.,]\d+)?$/.test(v)) continue;
    return maskNumbers(v).slice(0, 60);
  }
  return '';
}

// Rough categories from the shop / message words. Edit freely.
const CATEGORIES = [
  // Ads are mostly paid through Fawry (merchant "My fawry"); Meta charges too.
  ['إعلانات', /fawry|فوري|facebook|meta\b|fb\s*ads|ميتا|فيسبوك/i],
  ['طلبات', /talabat|طلبات/i],
  ['أكل وكافيهات', /elmenus|mcdonald|kfc|pizza|burger|cafe|coffee|starbucks|costa|مطعم|كافيه|بيتزا|كشري/i],
  ['سوبر ماركت', /carrefour|كارفور|spinneys|سبينيز|metro\b|مترو ماركت|hyper|seoudi|سعودي|kazyon|كازيون|خير زمان|oscar|أوسكار|ماركت|market/i],
  ['مواصلات وبنزين', /uber|careem|indrive|swvl|didi|bolt|اوبر|كريم|بنزين|fuel|petrol|wataniya|وطنية|total ?energies|misr petroleum|mobil|chillout/i],
  ['فواتير وشحن', /vodafone|فودافون|orange|اورنج|etisalat|اتصالات|we\b|وي\b|كهرباء|غاز|مياه|electricity|water|internet|انترنت|شحن رصيد|recharge/i],
  ['أونلاين واشتراكات', /amazon|noon|jumia|apple|google|netflix|spotify|shahid|شاهد|anthropic|claude|openai|render|ecwid/i],
  ['صحة', /pharmacy|صيدلية|seif|العزبي|el ?ezaby|hospital|مستشفى|clinic|عيادة|lab|معمل/i],
  ['سحب كاش', /سحب|atm|withdraw/i],
  ['تحويلات', /تحويل|instapay|انستا ?باي|transfer|محفظة|wallet/i],
];
// Account(s) that receive 499K's courier collections (Bosta / QP payouts).
const BIZ_ACCOUNTS = String(process.env.MONEY_BIZ_ACCOUNTS || '1010').split(',').map((s) => s.trim()).filter(Boolean);
export const COLLECTION_CAT = 'تحصيل 499K';

export function categorize(text, dir) {
  if (dir === 'in' && BIZ_ACCOUNTS.some((a) => new RegExp(`لحساب\\s*(?:رقم\\s*)?${a}(?!\\d)`).test(text))) return COLLECTION_CAT;
  if (dir === 'in') return /راتب|مرتب|salary/i.test(text) ? 'مرتب' : 'دخل';
  for (const [name, re] of CATEGORIES) if (re.test(text)) return name;
  return 'تاني';
}

export function sourceOf(from, text) {
  const s = `${from} ${text}`;
  if (/vodafone\s*cash|فودافون\s*كاش|VF-?Cash|^vf\b/i.test(s)) return 'فودافون كاش';
  if (/instapay|انستا ?باي/i.test(s)) return 'InstaPay';
  const banks = [['CIB', /\bcib\b/i], ['البنك الأهلي', /\bnbe\b|الأهلي|الاهلي|ahly|alahly/i], ['بنك مصر', /banque\s*misr|\bbm\b|بنك مصر/i],
    ['QNB', /\bqnb\b/i], ['بنك القاهرة', /banque\s*du\s*caire|\bbdc\b|القاهرة/i], ['HSBC', /hsbc/i], ['ADIB', /adib/i], ['AAIB', /aaib/i], ['Fawry', /^fawry|^فوري/i]];
  for (const [name, re] of banks) if (re.test(s)) return name;
  return String(from || 'غير معروف').slice(0, 30);
}

// One-time codes: the bank sends the amount with them ("…لعملية الشراء التي تقوم بها
// الآن بمبلغ EGP 10,122"), but no money has moved yet — the real debit SMS comes after.
const OTP_RE = /OTP|one[- ]?time|verification code|password|do not share|الكود|كود|رمز\s+(?:التحقق|سر)|(?:^|\s)سر[يى](?=[\s.،,]|$)|كلمة\s+(?:السر|المرور)|عدم\s+مشاركت|لا\s+تشارك/i;

// Messages that move no money: codes, offers, login alerts.
const NOT_MONEY = /(?:OTP|كود التحقق|رمز التحقق|كلمة السر|verification code|password|\bcode\b|لا تشارك|do not share|عرض|offer|خصم\s+\d+\s*%)/i;

// → { kind: 'tx' | 'ignore' | 'unclear', dir, amount, balance, counterparty, category, source, text }
// Ads glued to the end of wallet messages ("حول فلوس لأي محفظة وزود فرصك…", links).
const PROMO_TAIL = /\s*(?:حول فلوس لأي|جدد باقة|اشترك|استمتع|كمان هيجيلك|https?:\/\/|vf\.eg\/).*$/i;
const FEE_RE = new RegExp(`(?:مصاريف(?:\\s+ال)?خدمة|رسوم|عمولة|fees?)\\s*:?\\s*${AMT}\\s*${CUR}?`, 'i');

export function parseMoneySms(from, rawText) {
  const full = toLatinDigits(rawText).replace(/\s+/g, ' ').trim();
  // A message that is only an ad starts with the promo words: keep it whole, it gets ignored below.
  const cut = full.replace(PROMO_TAIL, '').trim();
  const text = cut || full;
  const source = sourceOf(from, text);
  const masked = maskNumbers(text);
  if (!text) return { kind: 'ignore', source, text: masked };
  const bal = text.match(BALANCE_RE) || text.match(BALANCE_RE2) || text.match(BALANCE_RE3);
  const balance = bal ? num(bal[1]) : null;
  // Read the amount with the balance part blanked out, so "رصيدك 900" is never taken as the amount.
  const noBal = bal ? text.slice(0, bal.index) + ' '.repeat(bal[0].length) + text.slice(bal.index + bal[0].length) : text;
  const amount = findAmount(noBal);
  if (OTP_RE.test(text)) return { kind: 'ignore', source, text: masked };
  if (NOT_MONEY.test(text) && !amount) return { kind: 'ignore', source, text: masked };
  if (!cut && !amount) return { kind: 'ignore', source, text: masked };
  // Service fee is read separately so it isn't taken as the amount, then added to money out.
  const feeM = noBal.match(FEE_RE);
  const fee = feeM ? num(feeM[1]) : 0;
  const noFee = feeM ? noBal.replace(feeM[0], ' '.repeat(feeM[0].length)) : noBal;
  const amt2 = findAmount(noFee) || amount;
  const dir = direction(noFee);
  const value = amt2?.value != null ? amt2.value + (dir === 'out' ? fee : 0) : null;
  if (value == null || !dir) return { kind: 'unclear', dir: dir || null, amount: value, balance, source, counterparty: counterparty(text), category: 'مش واضح', text: masked };
  return { kind: 'tx', dir, amount: value, balance, counterparty: counterparty(text), category: categorize(text.replace(/فودافون\s*كاش|vodafone\s*cash/gi, ''), dir), fee: fee || undefined, source, text: masked };
}
