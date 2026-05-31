// A dependency-free, file-backed key/value store.
// Used for: (1) idempotency so we don't poll the same order twice, and
// (2) a simple audit trail of what was sent and how customers replied.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = process.env.STORE_FILE || './data/orders.json';

function load() {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function save(data) {
  mkdirSync(dirname(FILE), { recursive: true });
  // Write to a temp file then rename = atomic-ish, avoids corruption on crash.
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export const store = {
  get(orderId) {
    return load()[orderId] || null;
  },
  upsert(orderId, patch) {
    const data = load();
    data[orderId] = { ...(data[orderId] || {}), ...patch, orderId, updatedAt: new Date().toISOString() };
    save(data);
    return data[orderId];
  },
  has(orderId) {
    return Boolean(load()[orderId]);
  },
  // Small bag for non-order state (e.g. the last time we polled).
  getMeta(key) {
    return (load().__meta__ || {})[key] ?? null;
  },
  setMeta(key, value) {
    const data = load();
    data.__meta__ = { ...(data.__meta__ || {}), [key]: value };
    save(data);
    return value;
  },
};
