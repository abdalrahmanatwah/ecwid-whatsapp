/**
 * qp_orders.js
 *
 * Handles the QP Express order-tracking data pipeline.
 * This is INTENTIONALLY separate from Bosta's tracking logic — QP has
 * its own status vocabulary, its own city list, and no direct API, so
 * mixing it into ecwid.js/dashboard.js would create false equivalences.
 *
 * Data flow:
 *   [local Playwright script] --POST--> /webhooks/qp-orders --> stored here
 *   [dashboard]              --GET-->  /api/qp/orders        --> read from here
 *
 * Storage: flat JSON file on the persistent disk (/var/data), same pattern
 * already used elsewhere in this service.
 */

import fs from 'node:fs';
import path from 'node:path';

const QP_STORE_FILE = process.env.QP_STORE_FILE || '/var/data/qp_orders.json';
const QP_INGEST_TOKEN = process.env.QP_INGEST_TOKEN; // shared secret, see note below

// QP's known status vocabulary (from the observed export). If QP ever adds
// a new status we haven't seen, we store it as-is rather than dropping the
// row — better to show an unmapped status on the dashboard than to lose data.
export const KNOWN_STATUSES = ['Pending', 'Out for Delivery', 'Delivered', 'Hold', 'Undelivered'];

function loadOrders() {
  try {
    if (!fs.existsSync(QP_STORE_FILE)) return {};
    const raw = fs.readFileSync(QP_STORE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[qp_orders] failed to load store file, starting fresh:', err.message);
    return {};
  }
}

function saveOrders(orders) {
  const dir = path.dirname(QP_STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QP_STORE_FILE, JSON.stringify(orders, null, 2), 'utf-8');
}

/**
 * Merges a fresh batch of QP rows into the existing store, keyed by serial.
 * - New serials are added.
 * - Existing serials get their status/notes/collected/returned fields
 *   updated if changed, and we track `status_changed_at` so the dashboard
 *   can show "updated N minutes ago" per order.
 * - We never delete rows that are missing from a given export (QP's export
 *   is date-filtered by default: an order not present today just means it
 *   wasn't in that particular pull, not that it vanished).
 */
export function mergeOrders(rows) {
  const store = loadOrders();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const serial = String(row.serial);
    const existing = store[serial];

    const normalized = {
      serial,
      full_name: row.full_name || '',
      phone: row.phone || '',
      address: row.address || '',
      total_amount: row.total_amount || null,
      total_fees: row.total_fees || null,
      cod: row.cod || null,
      collected: row.collected || null, // date string or null
      returned: row.returned || null, // date string or null
      notes: row.notes || '',
      order_date: row.order_date || null,
      shipment_contents: row.shipment_contents || '',
      weight: row.weight || null,
      city: row.city || '',
      status: row.status || 'Unknown',
      status_note: row.status_note || '',
      reference_id: row.reference_id || null,
      customer_serial: row.customer_serial || null,
      last_seen_at: now,
    };

    if (!existing) {
      normalized.first_seen_at = now;
      normalized.status_changed_at = now;
      store[serial] = normalized;
      added++;
    } else {
      normalized.first_seen_at = existing.first_seen_at || now;
      normalized.status_changed_at =
        existing.status !== normalized.status ? now : existing.status_changed_at || now;
      store[serial] = normalized;
      if (existing.status !== normalized.status || existing.status_note !== normalized.status_note) {
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  saveOrders(store);
  return { added, updated, unchanged, total_in_store: Object.keys(store).length };
}

/**
 * Express route handlers — already wired into server.js:
 *
 *   import * as qpOrders from './qp_orders.js';
 *   app.post('/webhooks/qp-orders', qpOrders.handleIngest);
 *   app.get('/api/qp/orders', qpOrders.handleList);
 *   app.get('/api/qp/summary', qpOrders.handleSummary);
 */

export function handleIngest(req, res) {
  // Simple shared-secret auth — this endpoint is only ever called by our
  // own Playwright script, not by QP or any public client, so a static
  // bearer token (set via QP_INGEST_TOKEN env var) is sufficient here.
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!QP_INGEST_TOKEN) {
    console.error('[qp_orders] QP_INGEST_TOKEN is not set on the server — refusing all ingests until configured.');
    return res.status(500).json({ error: 'Server misconfigured: QP_INGEST_TOKEN not set' });
  }

  if (token !== QP_INGEST_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { rows } = req.body || {};
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected { rows: [...] } in request body' });
  }

  try {
    const result = mergeOrders(rows);
    console.log(
      `[qp_orders] ingest complete: +${result.added} new, ${result.updated} updated, ${result.unchanged} unchanged (store total: ${result.total_in_store})`
    );
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[qp_orders] ingest failed:', err);
    return res.status(500).json({ error: 'Internal error during ingest' });
  }
}

export function handleList(req, res) {
  const store = loadOrders();
  const orders = Object.values(store).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));

  // Optional query filters, mirroring what the dashboard might want
  const { status, city } = req.query;
  let filtered = orders;
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (city) filtered = filtered.filter((o) => o.city === city);

  res.json({ count: filtered.length, orders: filtered });
}

/**
 * Filters orders down to those "resolved" (Delivered or Undelivered) whose
 * REAL resolution date falls within [from, to] (inclusive, UTC day
 * boundaries). The real resolution date comes straight from QP's own export:
 *   - Delivered orders   → the `collected` date (when COD cash was taken)
 *   - Undelivered orders → the `returned` date (when the shipment came back)
 *
 * This is QP's own authoritative timestamp, so it works correctly even for
 * orders that were already resolved the first time we ever synced them —
 * unlike status_changed_at, which would just be the sync time. If a resolved
 * order is somehow missing its collected/returned date, we fall back to
 * status_changed_at so it isn't silently dropped.
 *
 * Orders still Pending/Hold/Out for Delivery are never "resolved" and are
 * excluded from any date-filtered view (they still show in the live counts).
 */
function resolutionDateOf(order) {
  if (order.status === 'Delivered') return order.collected || order.status_changed_at || null;
  if (order.status === 'Undelivered') return order.returned || order.status_changed_at || null;
  return null;
}

function filterResolvedByDateRange(orders, from, to) {
  if (!from && !to) return null; // signal: no filtering requested

  const fromTime = from ? new Date(from + 'T00:00:00.000Z').getTime() : -Infinity;
  const toTime = to ? new Date(to + 'T23:59:59.999Z').getTime() : Infinity;

  return orders.filter((o) => {
    const isResolved = o.status === 'Delivered' || o.status === 'Undelivered';
    if (!isResolved) return false;
    const resDate = resolutionDateOf(o);
    if (!resDate) return false;
    // resDate may be a date-only string like "2026-06-05" — treat as that UTC day
    const t = new Date(resDate.length === 10 ? resDate + 'T12:00:00.000Z' : resDate).getTime();
    if (Number.isNaN(t)) return false;
    return t >= fromTime && t <= toTime;
  });
}

export function handleSummary(req, res) {
  const store = loadOrders();
  const allOrders = Object.values(store);
  const { from, to } = req.query;

  const resolvedInRange = filterResolvedByDateRange(allOrders, from, to);
  const isDateFiltered = resolvedInRange !== null;

  // by_status / total_orders / total_cod always reflect the FULL live store —
  // these are "right now" snapshot numbers, not period-scoped, matching the
  // "Right now" section semantics used elsewhere in this dashboard.
  const byStatus = {};
  for (const s of KNOWN_STATUSES) byStatus[s] = 0;
  let unmappedStatusCount = 0;
  for (const o of allOrders) {
    if (byStatus[o.status] !== undefined) byStatus[o.status]++;
    else unmappedStatusCount++;
  }
  const totalCOD = allOrders.reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);

  // delivery_rate_percent switches meaning based on whether from/to were passed:
  //   - unfiltered: rate across ALL resolved orders ever synced (unchanged behavior)
  //   - filtered:   rate across only orders resolved within [from, to]
  let deliveredCount, undeliveredCount, resolvedCount, deliveryRate, resolvedCOD;
  if (isDateFiltered) {
    deliveredCount = resolvedInRange.filter((o) => o.status === 'Delivered').length;
    undeliveredCount = resolvedInRange.filter((o) => o.status === 'Undelivered').length;
    resolvedCount = deliveredCount + undeliveredCount;
    deliveryRate = resolvedCount > 0 ? ((deliveredCount / resolvedCount) * 100).toFixed(1) : null;
    resolvedCOD = resolvedInRange
      .filter((o) => o.status === 'Delivered')
      .reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);
  } else {
    deliveredCount = byStatus['Delivered'] || 0;
    undeliveredCount = byStatus['Undelivered'] || 0;
    resolvedCount = deliveredCount + undeliveredCount;
    deliveryRate = resolvedCount > 0 ? ((deliveredCount / resolvedCount) * 100).toFixed(1) : null;
    resolvedCOD = totalCOD;
  }

  res.json({
    // "Right now" — always full store, never period-limited
    total_orders: allOrders.length,
    by_status: byStatus,
    unmapped_status_count: unmappedStatusCount,
    total_cod_egp: totalCOD.toFixed(2),
    last_updated: allOrders.reduce((latest, o) => {
      return !latest || o.last_seen_at > latest ? o.last_seen_at : latest;
    }, null),

    // Period-scoped (or full-history if no from/to given) — resolution-date anchored
    is_date_filtered: isDateFiltered,
    period_delivered_count: deliveredCount,
    period_undelivered_count: undeliveredCount,
    period_resolved_count: resolvedCount,
    period_delivery_rate_percent: deliveryRate,
    period_cod_collected_egp: resolvedCOD.toFixed(2),
  });
}
