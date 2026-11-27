// Read-only ads check: Meta results today / yesterday / last 7 days (by
// campaign and by ad) next to Ecwid orders placed in the same days.
// GET /dashboard/meta/report

import { searchOrders } from './ecwid.js';

const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const TOKEN = process.env.META_ADS_TOKEN || '';
const ACCOUNT = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

function act(list, type) {
  const row = (list || []).find((a) => a.action_type === type);
  return row ? Number(row.value) : 0;
}
const PURCHASE = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];
function purchases(r) { for (const t of PURCHASE) { const v = act(r.actions, t); if (v) return v; } return 0; }
function value(r) { for (const t of PURCHASE) { const v = act(r.action_values, t); if (v) return v; } return 0; }

async function insights(params) {
  const url = new URL(`https://graph.facebook.com/${VERSION}/act_${ACCOUNT}/insights`);
  url.searchParams.set('fields', 'campaign_name,adset_name,ad_name,ad_id,spend,impressions,clicks,ctr,cpm,actions,action_values');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', TOKEN);
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return (j.data || []).map((x) => ({
    date: x.date_start, campaign: x.campaign_name, adset: x.adset_name, ad: x.ad_name,
    spend: Math.round(Number(x.spend) || 0), impressions: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0,
    ctr: Math.round((Number(x.ctr) || 0) * 100) / 100, cpm: Math.round(Number(x.cpm) || 0),
    purchases: purchases(x), value: Math.round(value(x)),
  })).filter((x) => x.spend > 0 || x.purchases > 0);
}

function cairoDay(d = new Date()) { return d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Cairo' }); }

export async function adsReport() {
  if (!TOKEN || !ACCOUNT) throw new Error('Meta not configured');
  const [today, yday, week, campaignsToday] = await Promise.all([
    insights({ level: 'ad', date_preset: 'today' }),
    insights({ level: 'account', date_preset: 'yesterday' }),
    insights({ level: 'account', date_preset: 'last_7d', time_increment: '1' }),
    insights({ level: 'campaign', date_preset: 'today' }),
  ]);
  // Ecwid orders by Cairo day for the last 8 days.
  const from = Math.floor(Date.now() / 1000) - 8 * 86400;
  let orders = [];
  try { orders = await searchOrders(from); } catch (e) { orders = []; }
  const byDay = {};
  for (const o of orders) {
    const d = cairoDay(new Date((o.createTimestamp || 0) * 1000));
    const m = (byDay[d] ||= { orders: 0, total: 0, cancelled: 0 });
    if (/CANCELLED/.test(o.paymentStatus || '') || /RETURNED|WILL_NOT_DELIVER/.test(o.fulfillmentStatus || '')) m.cancelled++;
    m.orders++; m.total += Number(o.total) || 0;
  }
  return { now: new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }), campaignsToday, adsToday: today, yesterday: yday[0] || null, last7: week, ecwidByDay: byDay };
}
