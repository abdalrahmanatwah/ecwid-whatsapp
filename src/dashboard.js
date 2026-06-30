// Dashboard API: GET /dashboard/api/metrics?period=today|7d|14d|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
// Pulls the order window straight from Ecwid (which already carries Bosta's
// delivered/returned/cancelled status, mirrored over by ecwid_tracking.js) and
// runs it through metrics.js. No separate database — Ecwid is the source of truth.

import { Router } from 'express';
import { searchOrders } from './ecwid.js';
import { resolveWindow, computeMetrics } from './metrics.js';

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
    const orders = await searchOrders(window.fromUnix, window.toUnix);
    const metrics = computeMetrics(orders);
    res.json({ window: { label: window.label, from: window.fromUnix, to: window.toUnix }, ...metrics });
  } catch (e) {
    console.error('[dashboard] metrics fetch failed:', e.message);
    res.status(502).json({ error: 'Could not reach Ecwid. Try again in a moment.' });
  }
});
