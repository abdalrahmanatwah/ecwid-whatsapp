// Dashboard metrics: turns a window of Ecwid orders into the numbers on the board.
//
// Definitions (chosen deliberately — see DEPLOY.md "Dashboard" section for the why):
//   - Windows are anchored to order PLACEMENT date (createTimestamp), in Africa/Cairo
//     local time, not server UTC. "Today" means Cairo's today.
//   - DELIVERED  = fulfillmentStatus DELIVERED            → counts as earned + collected.
//   - UNDELIVERED = fulfillmentStatus RETURNED or WILL_NOT_DELIVER (covers both the
//     customer-cancel-before-ship path and the Bosta-shipment-cancelled path — both
//     already converge on WILL_NOT_DELIVER in ecwid_tracking.js / server.js).
//   - IN_TRANSIT = everything else (Processing, Shipped, awaiting tracking, etc.) —
//     not yet resolved, so it's excluded from the delivery-rate denominator rather
//     than counted as a failure. Shown separately as "still moving" context.
//   - Delivery rate = DELIVERED / (DELIVERED + UNDELIVERED) among RESOLVED orders only.
//   - Cash collected = sum of `total` for DELIVERED orders (COD cash only lands on
//     a successful delivery). Cash pending = sum of `total` for IN_TRANSIT orders.

const CAIRO_TZ = 'Africa/Cairo';
const UNDELIVERED_STATUSES = new Set(['RETURNED', 'WILL_NOT_DELIVER']);
const DELIVERED_STATUS = 'DELIVERED';

// Best-effort category classifier from item names. Edit these keyword lists if a
// product doesn't land in the bucket you'd expect — there's no real category field
// coming from Ecwid's order API, so this is a stand-in until/unless one is added.
const CATEGORY_KEYWORDS = {
  'Tennis & Padel': ['tennis', 'padel'],
  'Running & Fitness': ['running', 'run ', 'fitness', 'training', 'gym'],
};

function classifyCategory(itemName) {
  const n = String(itemName || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => n.includes(k))) return category;
  }
  return 'Other';
}

// --- Cairo-local day boundaries, DST-correct (Egypt uses Africa/Cairo: EET/EEST) ---

// Returns the UNIX-seconds timestamp for the start of `date`'s Cairo-local day.
function cairoStartOfDay(date) {
  // en-CA gives YYYY-MM-DD, which is what we need to rebuild the boundary.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  // Find the UTC instant whose Cairo-local clock reads 00:00:00 on that date by
  // checking the Cairo UTC offset for a guess instant, then correcting once —
  // safe because EET/EEST are both whole-hour offsets so one correction suffices.
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offsetMin = cairoOffsetMinutes(guess);
  const corrected = new Date(guess.getTime() - offsetMin * 60_000);
  return Math.floor(corrected.getTime() / 1000);
}

function cairoOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+2';
  const m = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 120;
  return Number(m[1]) * 60 + (m[1].startsWith('-') ? -1 : 1) * Number(m[2] || 0);
}

// Resolves a period key into a { fromUnix, toUnix, label } window, Cairo-local.
export function resolveWindow(period, customFrom, customTo) {
  const now = new Date();
  const todayStart = cairoStartOfDay(now);
  const nowUnix = Math.floor(now.getTime() / 1000);

  switch (period) {
    case 'today':
      return { fromUnix: todayStart, toUnix: nowUnix, label: 'Today' };
    case '7d':
      return { fromUnix: todayStart - 6 * 86400, toUnix: nowUnix, label: 'Last 7 days' };
    case '14d':
      return { fromUnix: todayStart - 13 * 86400, toUnix: nowUnix, label: 'Last 14 days' };
    case '30d':
      return { fromUnix: todayStart - 29 * 86400, toUnix: nowUnix, label: 'Last 30 days' };
    case 'custom': {
      if (!customFrom || !customTo) throw new Error('custom period needs from and to');
      const from = cairoStartOfDay(new Date(customFrom));
      // End of the "to" day, Cairo-local: start of the next day minus 1 second.
      const to = cairoStartOfDay(new Date(new Date(customTo).getTime() + 86400_000)) - 1;
      return { fromUnix: from, toUnix: to, label: `${customFrom} → ${customTo}` };
    }
    default:
      throw new Error(`unknown period "${period}"`);
  }
}

function bucketOf(order) {
  const fs = String(order.fulfillmentStatus || '').toUpperCase();
  if (fs === DELIVERED_STATUS) return 'delivered';
  if (UNDELIVERED_STATUSES.has(fs)) return 'undelivered';
  return 'in_transit';
}

// The main entry point: orders (already filtered to the window by the caller's
// Ecwid query) → every number the dashboard shows.
export function computeMetrics(orders) {
  const buckets = { delivered: [], undelivered: [], in_transit: [] };
  for (const o of orders) buckets[bucketOf(o)].push(o);

  const sumTotal = (list) => list.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const currency = orders.find((o) => o.currency)?.currency || 'EGP';

  const deliveredCount = buckets.delivered.length;
  const undeliveredCount = buckets.undelivered.length;
  const inTransitCount = buckets.in_transit.length;
  const resolvedCount = deliveredCount + undeliveredCount;

  const earnings = sumTotal(buckets.delivered);
  const cashPending = sumTotal(buckets.in_transit);
  const aov = deliveredCount ? earnings / deliveredCount : 0;
  const deliveryRate = resolvedCount ? deliveredCount / resolvedCount : null; // null = nothing resolved yet

  // Top products & sizes — ranked by units sold, counted from delivered orders only
  // (an order still in transit hasn't "sold" anything yet in the COD sense).
  const productTally = new Map();
  const categoryTotals = new Map();
  for (const o of buckets.delivered) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const opts = Array.isArray(it.selectedOptions) ? it.selectedOptions : [];
      const sizeOpt = opts.find((x) => /size/i.test(x.name || ''));
      const label = sizeOpt ? `${it.name} — ${sizeOpt.value}` : it.name || 'Unnamed item';
      const qty = Number(it.quantity) || 1;
      productTally.set(label, (productTally.get(label) || 0) + qty);

      const cat = classifyCategory(it.name);
      const itemRevenue = (Number(it.price) || 0) * qty;
      categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + itemRevenue);
    }
  }
  const topProducts = [...productTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, units]) => ({ name, units }));

  const categoryTotalSum = [...categoryTotals.values()].reduce((s, v) => s + v, 0) || 1;
  const categorySplit = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, revenue]) => ({
      category,
      revenue,
      share: revenue / categoryTotalSum,
    }));

  return {
    currency,
    counts: {
      delivered: deliveredCount,
      undelivered: undeliveredCount,
      inTransit: inTransitCount,
      totalPlaced: orders.length,
    },
    deliveryRate, // 0..1 or null
    earnings,
    aov,
    cash: { collected: earnings, pending: cashPending },
    topProducts,
    categorySplit,
  };
}
