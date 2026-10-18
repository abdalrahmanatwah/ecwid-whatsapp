// Social proof: "صور عملائنا" — real customer photos shown on every product page,
// right under the product gallery.
//
// Pieces:
//   GET  /social-proof/widget.js          storefront script (loaded by the Ecwid app)
//   GET  /social-proof/photos.json        public list of visible photos
//   GET  /social-proof/img/:file          the photo files themselves
//   GET  /social-proof/admin              admin page (embedded in the Ecwid control panel)
//   *    /social-proof/admin/api/...      admin API: upload / edit / reorder / delete
//
// Storage: metadata in /var/data/social_proof.json, images in /var/data/social-proof/.
// Admin access: Basic Auth (same as /dashboard) OR ?key=SOCIAL_PROOF_ADMIN_KEY — the
// key form exists because browsers often block Basic Auth prompts inside iframes,
// and the Ecwid control panel shows app pages in an iframe.

import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || '/var/data';
const META_FILE = process.env.SOCIAL_PROOF_FILE || path.join(DATA_DIR, 'social_proof.json');
const IMG_DIR = process.env.SOCIAL_PROOF_IMG_DIR || path.join(DATA_DIR, 'social-proof');
const ADMIN_KEY = process.env.SOCIAL_PROOF_ADMIN_KEY || '';
const DASH_USER = process.env.DASHBOARD_USER || '499k';
const DASH_PASS = process.env.DASHBOARD_PASSWORD || '';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // after browser-side resize photos are ~150–400 KB

const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/* ----------------------------- storage ----------------------------- */

function ensureDirs() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    return Array.isArray(data.photos) ? data : { photos: [] };
  } catch {
    return { photos: [] };
  }
}

function save(data) {
  ensureDirs();
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, META_FILE); // atomic replace so a crash never leaves half a file
}

function clean(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function publicPhoto(p) {
  return { id: p.id, src: `/social-proof/img/${p.file}`, name: p.name, city: p.city };
}

/* ------------------------------ auth ------------------------------- */

function requireAdmin(req, res, next) {
  const key = req.query.key || req.get('x-admin-key');
  if (ADMIN_KEY && key && safeEqual(String(key), ADMIN_KEY)) return next();

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (DASH_PASS && scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === DASH_USER && safeEqual(pass || '', DASH_PASS)) return next();
  }
  if (!ADMIN_KEY && !DASH_PASS) {
    res.status(503).send('Social proof admin not configured: set SOCIAL_PROOF_ADMIN_KEY.');
    return;
  }
  res.set('WWW-Authenticate', 'Basic realm="499K Social Proof"');
  res.status(401).send('Authentication required.');
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------ router ----------------------------- */

export const socialProofRouter = Router();

// Storefront pages live on another origin (the 499K store domain), so the public
// endpoints must allow cross-origin reads.
function cors(_req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  next();
}

socialProofRouter.get('/widget.js', cors, (req, res) => {
  // Render terminates HTTPS at its proxy, so req.protocol alone would say "http".
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const base = process.env.PUBLIC_BASE_URL || `${proto}://${req.get('host')}`;
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'social-proof-widget.js'), 'utf8')
    .replace('__SOCIAL_PROOF_BASE__', base);
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(src);
});

socialProofRouter.get('/photos.json', cors, (_req, res) => {
  const photos = load().photos.filter((p) => !p.hidden).map(publicPhoto);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ photos });
});

socialProofRouter.get('/img/:file', cors, (req, res) => {
  const file = path.basename(req.params.file); // no path traversal
  const full = path.join(IMG_DIR, file);
  if (!fs.existsSync(full)) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=31536000, immutable'); // file names are unique
  res.sendFile(full);
});

/* ------------------------------ admin ------------------------------ */

socialProofRouter.get('/admin', requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'social-proof-admin.html'));
});

socialProofRouter.get('/admin/api/photos', requireAdmin, (_req, res) => {
  res.json({ photos: load().photos.map((p) => ({ ...publicPhoto(p), hidden: !!p.hidden, createdAt: p.createdAt })) });
});

// Upload: JSON { image: "data:image/jpeg;base64,...", name, city }.
// The admin page resizes in the browser first, so no multipart library is needed.
socialProofRouter.post('/admin/api/photos', requireAdmin, express.json({ limit: '8mb' }), (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image || '');
  if (!m) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'Image too large.' });

  ensureDirs();
  const id = crypto.randomBytes(8).toString('hex');
  const file = `${id}.${ALLOWED_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(IMG_DIR, file), buf);

  const data = load();
  const photo = {
    id,
    file,
    name: clean(req.body.name, 40),
    city: clean(req.body.city, 40),
    hidden: false,
    createdAt: new Date().toISOString(),
  };
  data.photos.unshift(photo); // newest first
  save(data);
  console.log(`[social-proof] added photo ${id} (${photo.name} – ${photo.city})`);
  res.json({ photo: { ...publicPhoto(photo), hidden: false } });
});

socialProofRouter.patch('/admin/api/photos/:id', requireAdmin, express.json(), (req, res) => {
  const data = load();
  const p = data.photos.find((x) => x.id === req.params.id);
  if (!p) return res.sendStatus(404);
  if ('name' in req.body) p.name = clean(req.body.name, 40);
  if ('city' in req.body) p.city = clean(req.body.city, 40);
  if ('hidden' in req.body) p.hidden = !!req.body.hidden;
  save(data);
  res.json({ ok: true });
});

// Reorder: { ids: [...] } in the desired display order.
socialProofRouter.put('/admin/api/order', requireAdmin, express.json(), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const data = load();
  const byId = new Map(data.photos.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const rest = data.photos.filter((p) => !ids.includes(p.id));
  data.photos = [...ordered, ...rest];
  save(data);
  res.json({ ok: true });
});

socialProofRouter.delete('/admin/api/photos/:id', requireAdmin, (req, res) => {
  const data = load();
  const p = data.photos.find((x) => x.id === req.params.id);
  if (!p) return res.sendStatus(404);
  data.photos = data.photos.filter((x) => x.id !== p.id);
  save(data);
  fs.rm(path.join(IMG_DIR, p.file), { force: true }, () => {});
  console.log(`[social-proof] deleted photo ${p.id}`);
  res.json({ ok: true });
});
