// Minimal HTTP Basic Auth — no extra dependency needed, browsers handle the
// password prompt natively. Protects the dashboard, which shows revenue numbers.

const USER = process.env.DASHBOARD_USER || '499k';
const PASS = process.env.DASHBOARD_PASSWORD || '';

export function requireAuth(req, res, next) {
  if (!PASS) {
    // Fail closed: an unset password must block access, not silently allow it.
    res.status(503).send('Dashboard not configured: set DASHBOARD_PASSWORD.');
    return;
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === USER && pass === PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="499K Dashboard"');
  res.status(401).send('Authentication required.');
}
