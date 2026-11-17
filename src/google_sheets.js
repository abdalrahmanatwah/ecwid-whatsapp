// Minimal Google Sheets client using a service account — no extra npm packages.
//
// Setup: put the service account's JSON key (the whole file contents) in
// GOOGLE_SERVICE_ACCOUNT_JSON, and share the spreadsheet with the service
// account's email as an Editor. Auth is the standard OAuth2 JWT-bearer flow,
// signed with node:crypto.

import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

let cachedKey = null;
let cachedToken = null; // { token, expiresAt }

function serviceAccount() {
  if (cachedKey) return cachedKey;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) throw new Error('missing client_email or private_key');
    // Render's env editor sometimes keeps "\n" as two characters.
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    cachedKey = parsed;
    return parsed;
  } catch (e) {
    console.error('[sheets] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message);
    return null;
  }
}

export function sheetsConfigured() {
  return Boolean(serviceAccount());
}

export function serviceAccountEmail() {
  return serviceAccount()?.client_email || null;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('Google Sheets not configured (GOOGLE_SERVICE_ACCOUNT_JSON missing)');

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

// Google allows ~60 reads and ~60 writes a minute. A full sync can go past
// that, so a 429 (or a passing 5xx) waits and tries again instead of failing
// the step — the purchases step runs last and was the one getting cut off.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RETRY_WAITS_MS = [15_000, 30_000, 45_000, 60_000];

async function call(method, url, body) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (res.ok || !retryable || attempt >= RETRY_WAITS_MS.length) break;
    const after = Number(res.headers.get('retry-after')) * 1000;
    const wait = after > 0 ? Math.min(after, 90_000) : RETRY_WAITS_MS[attempt];
    console.warn(`[sheets] ${res.status} on ${method} — retrying in ${Math.round(wait / 1000)}s`);
    await res.text().catch(() => '');
    await sleep(wait);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sheets ${method} failed: ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json();
}

const enc = encodeURIComponent;

// Tab titles and numeric sheet IDs.
export async function getTabs(spreadsheetId) {
  const data = await call('GET', `${API}/${spreadsheetId}?fields=sheets.properties`);
  return (data.sheets || []).map((s) => s.properties);
}

// Displayed values (strings, as the UI shows them). Missing range → [].
export async function getValues(spreadsheetId, range) {
  const data = await call('GET', `${API}/${spreadsheetId}/values/${enc(range)}`);
  return data.values || [];
}

// Raw values: numbers stay numbers, formulas come back as "=…".
export async function getFormulas(spreadsheetId, range) {
  const data = await call('GET', `${API}/${spreadsheetId}/values/${enc(range)}?valueRenderOption=FORMULA`);
  return data.values || [];
}

// Computed values without display formatting: numbers stay numbers, dates are serials.
export async function getRawValues(spreadsheetId, range) {
  const data = await call('GET', `${API}/${spreadsheetId}/values/${enc(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  return data.values || [];
}

export async function clearValues(spreadsheetId, range) {
  return call('POST', `${API}/${spreadsheetId}/values/${enc(range)}:clear`, {});
}

// Writes values/formulas exactly as if typed into the UI.
export async function updateValues(spreadsheetId, range, values) {
  return call('PUT', `${API}/${spreadsheetId}/values/${enc(range)}?valueInputOption=USER_ENTERED`, { values });
}

// Many ranges in one write call: [{ range, values }].
export async function batchUpdateValues(spreadsheetId, data) {
  if (!data.length) return null;
  return call('POST', `${API}/${spreadsheetId}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data });
}

export async function appendValues(spreadsheetId, range, values) {
  return call(
    'POST',
    `${API}/${spreadsheetId}/values/${enc(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values }
  );
}

export async function batchUpdate(spreadsheetId, requests) {
  if (!requests.length) return null;
  return call('POST', `${API}/${spreadsheetId}:batchUpdate`, { requests });
}
