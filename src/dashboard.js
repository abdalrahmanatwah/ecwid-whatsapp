// Dashboard API: GET /dashboard/api/metrics?period=today|7d|14d|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Makes three Ecwid queries and hands them to metrics.js:
//   1. Orders RESOLVED in the selected window (updatedFrom/To) — drives delivered/
//      undelivered/earnings/delivery rate/products/category split.
//   2. Orders currently unresolved, fixed 45-day lookback — drives the live "in
//      transit" / "cash pending" snapshot, independent of the period selector.
//   3. A lightweight count of orders PLACED in the window (createdFrom/To) — shown
//      as a separate, clearly-labeled context stat.

import { Router } from 'express';
import { searchOrders } from './ecwid.js';
import { resolveWindow, inTransitLookbackWindow, computeMetrics } from './metrics.js';

export const dashboardRouter = Router();

dashboardRouter.get('/api/metrics', async (req, res) => {
  const { period = 'today', from, to } = req.query;
  let window;
  try {
    window = resolveWindow(period, from, to);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  try {
    const inTransitWindow = inTransitLookbackWindow();
    const [resolvedOrders, inTransitOrders, placedOrders] = await Promise.all([
      searchOrders(window.fromUnix, window.toUnix, 'updated'),
      searchOrders(inTransitWindow.fromUnix, inTransitWindow.toUnix, 'created'),
      searchOrders(window.fromUnix, window.toUnix, 'created'),
    ]);

    const metrics = computeMetrics(resolvedOrders, inTransitOrders, placedOrders.length);
    res.json({ window: { label: window.label, from: window.fromUnix, to: window.toUnix }, ...metrics });
  } catch (e) {
    console.error('[dashboard] metrics fetch failed:', e.message);
    res.status(502).json({ error: 'Could not reach Ecwid. Try again in a moment.' });
  }
});
