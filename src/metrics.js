// Dashboard metrics: turns two separate Ecwid queries into the numbers on the board.
//
// THE KEY DESIGN DECISION (changed after real-world testing against Bosta's own
// dashboard): a COD business's "today's earnings" means "what actually got paid
// today", not "what fraction of today's brand-new orders happen to have resolved
// already" — the latter is structurally close to zero for any recent day, since
// delivery takes time. So:
//
//   - DELIVERED / UNDELIVERED / earnings / delivery rate / top products / category
//     split are all anchored to RESOLUTION date (when Bosta's status landed on the
//     order) via Ecwid's `updatedFrom`/`updatedTo`, filtered to orders that are
//     actually in a resolved state. This matches what Bosta's own "yesterday" view
//     shows, and answers "what did I actually earn/lose in this window".
//
//   - IN_TRANSIT and cash PENDING are NOT period-filtered at all — they're a live
//     "right now" snapshot (everything currently unresolved, looked up via a fixed
//     45-day placement lookback, comfortably past the 21-day point where the
//     tracking bridge gives up on a delivery). A package doesn't become less "in
//     transit" because it falls outside whatever date range you happen to have
//     selected.
//
//   - PLACED is a separate, clearly-labeled context stat — orders placed in the
//     window by creation date — kept distinct so it's never confused with the
//     resolution-based numbers above it.

const CAIRO_TZ = 'Africa/Cairo';
const UNDELIVERED_STATUSES = new Set(['RETURNED', 'WILL_NOT_DELIVER']);
const DELIVERED_STATUS = 'DELIVERED';
const RESOLVED_STATUSES = new Set([DELIVERED_STATUS, ...UNDELIVERED_STATUSES]);
const IN_TRANSIT_LOOKBACK_DAYS = 45;

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

function cairoStartOfDay(date) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offsetMin = cairoOffsetMinutes(guess);
  const corrected = new Date(guess.getTime() - offsetMin * 60_000);
  return Math.floor(corrected.getTime() / 1000);
}

function cairoOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ, timeZoneName: 'shortOffset',
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
    case 'yesterday': {
      // Full Cairo-local calendar day: [yesterday 00:00, today 00:00).
      // Unlike 'today' (which runs to "now"), yesterday is a closed window —
      // it doesn't bleed into today, so earnings/delivery-rate for it don't
      // keep changing as the current day progresses.
      const yesterdayStart = todayStart - 86400;
      return { fromUnix: yesterdayStart, toUnix: todayStart - 1, label: 'Yesterday' };
    }
    case '7d':
      return { fromUnix: todayStart - 6 * 86400, toUnix: nowUnix, label: 'Last 7 days' };
    case '14d':
      return { fromUnix: todayStart - 13 * 86400, toUnix: nowUnix, label: 'Last 14 days' };
    case '30d':
      return { fromUnix: todayStart - 29 * 86400, toUnix: nowUnix, label: 'Last 30 days' };
    case 'custom': {
      if (!customFrom || !customTo) throw new Error('custom period needs from and to');
      const from = cairoStartOfDay(new Date(customFrom));
      const to = cairoStartOfDay(new Date(new Date(customTo).getTime() + 86400_000)) - 1;
      return { fromUnix: from, toUnix: to, label: `${customFrom} → ${customTo}` };
    }
    default:
      throw new Error(`unknown period "${period}"`);
  }
}

// The live "in transit right now" lookback is fixed, independent of the period selector.
export function inTransitLookbackWindow() {
  const nowUnix = Math.floor(Date.now() / 1000);
  return { fromUnix: nowUnix - IN_TRANSIT_LOOKBACK_DAYS * 86400, toUnix: nowUnix };
}

function fulfillment(order) {
  return String(order.fulfillmentStatus || '').toUpperCase();
}

// --- Main entry point ---
// resolvedOrders: Ecwid orders fetched by updatedFrom/updatedTo for the selected window
//   (caller should fetch broadly; this function does the resolved-status filtering).
// inTransitOrders: Ecwid orders fetched by the fixed lookback window (any date field),
//   not filtered by period — this function filters down to currently-unresolved ones.
// placedCount: count of orders placed in the selected window (createdFrom/To), for the
//   separate "placed" context stat — pass the raw count, no further processing needed.
export function computeMetrics(resolvedOrdersRaw, inTransitOrdersRaw, placedCount) {
  const resolvedOrders = resolvedOrdersRaw.filter((o) => RESOLVED_STATUSES.has(fulfillment(o)));
  const delivered = resolvedOrders.filter((o) => fulfillment(o) === DELIVERED_STATUS);
  const undelivered = resolvedOrders.filter((o) => UNDELIVERED_STATUSES.has(fulfillment(o)));
  const inTransit = inTransitOrdersRaw.filter((o) => !RESOLVED_STATUSES.has(fulfillment(o)));

  const sumTotal = (list) => list.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const currency =
    delivered.find((o) => o.currency)?.currency ||
    undelivered.find((o) => o.currency)?.currency ||
    inTransit.find((o) => o.currency)?.currency ||
    'EGP';

  const deliveredCount = delivered.length;
  const undeliveredCount = undelivered.length;
  const inTransitCount = inTransit.length;
  const resolvedCount = deliveredCount + undeliveredCount;

  const earnings = sumTotal(delivered);
  const cashPending = sumTotal(inTransit);
  const aov = deliveredCount ? earnings / deliveredCount : 0;
  const deliveryRate = resolvedCount ? deliveredCount / resolvedCount : null;

  // Top products & sizes — ranked by units sold, from delivered orders in this window.
  const productTally = new Map();
  const categoryTotals = new Map();
  for (const o of delivered) {
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
    .map(([category, revenue]) => ({ category, revenue, share: revenue / categoryTotalSum }));

  return {
    currency,
    counts: {
      delivered: deliveredCount,
      undelivered: undeliveredCount,
      inTransit: inTransitCount, // live, not period-filtered
      placed: placedCount,       // separate context stat, placement-date anchored
    },
    deliveryRate,
    earnings,
    aov,
    cash: { collected: earnings, pending: cashPending },
    topProducts,
    categorySplit,
  };
}
