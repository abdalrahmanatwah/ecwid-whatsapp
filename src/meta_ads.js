// Reads monthly ad spend from Meta Ads Manager (Marketing API insights) for
// the sales-sheet sync.
//
// Needs META_ADS_TOKEN: a System User token with the `ads_read` permission on
// the ad account (Business Settings → System users → Generate token), and
// META_AD_ACCOUNT_ID (the number only, without "act_").

const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const TOKEN = process.env.META_ADS_TOKEN || '';
const ACCOUNT = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

export function metaAdsConfigured() {
  return Boolean(TOKEN && ACCOUNT);
}

function lastDayOfMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Spend for a "YYYY-MM" month (up to today for the current month), in the ad
// account's currency. Meta's insights use the ad account's own time zone.
export async function monthSpend(key) {
  const since = `${key}-01`;
  const until = `${key}-${String(lastDayOfMonth(key)).padStart(2, '0')}`;
  const url = new URL(`https://graph.facebook.com/${VERSION}/act_${ACCOUNT}/insights`);
  url.searchParams.set('fields', 'spend,account_currency');
  url.searchParams.set('level', 'account');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', TOKEN);

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Meta insights failed: ${res.status} ${data.error?.message || ''}`.trim());
  }
  const row = data.data?.[0];
  return {
    spend: row ? Math.round(Number(row.spend) || 0) : 0, // no row = nothing spent
    currency: row?.account_currency || null,
  };
}

// Spend per day for a "YYYY-MM" month: { 'YYYY-MM-DD': spend }. Days with no
// spend are missing (= 0). Taxes setting (الافتراضات B16) is applied by the caller.
export async function dailySpend(key) {
  const since = `${key}-01`;
  const until = `${key}-${String(lastDayOfMonth(key)).padStart(2, '0')}`;
  const url = new URL(`https://graph.facebook.com/${VERSION}/act_${ACCOUNT}/insights`);
  url.searchParams.set('fields', 'spend');
  url.searchParams.set('level', 'account');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('limit', '40');
  url.searchParams.set('access_token', TOKEN);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta daily insights failed: ${res.status} ${data.error?.message || ''}`.trim());
  const out = {};
  for (const r of data.data || []) if (r.date_start) out[r.date_start] = Number(r.spend) || 0;
  return out;
}

// Read-only lookup of one ad: its post (page_id_post_id) so it can be reused
// with "Use existing post" in another campaign, keeping likes and comments.
export async function adPost(adId) {
  if (!TOKEN) throw new Error('META_ADS_TOKEN not set');
  if (!/^\d{6,25}$/.test(String(adId))) throw new Error('bad ad id');
  const url = new URL(`https://graph.facebook.com/${VERSION}/${adId}`);
  url.searchParams.set('fields', 'name,status,campaign{name},adset{name},creative{id,effective_object_story_id,object_story_id,effective_instagram_media_id}');
  url.searchParams.set('access_token', TOKEN);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
  const story = j.creative?.effective_object_story_id || j.creative?.object_story_id || null;
  return {
    ad: j.name, status: j.status, campaign: j.campaign?.name, adset: j.adset?.name,
    creative_id: j.creative?.id || null,
    post_id: story ? story.split('_').pop() : null,
    page_post_id: story,
    instagram_media_id: j.creative?.effective_instagram_media_id || null,
  };
}

// Find ads in the account whose name contains `name` (case-insensitive) and
// return each one's post ID.
export async function adPostsByName(name) {
  if (!TOKEN || !ACCOUNT) throw new Error('Meta not configured');
  const q = String(name || '').trim().toLowerCase();
  if (!q) throw new Error('name required');
  const out = [];
  let next = `https://graph.facebook.com/${VERSION}/act_${ACCOUNT}/ads?limit=200&fields=id,name,effective_status,campaign{name},adset{name},creative{effective_object_story_id,object_story_id}&access_token=${encodeURIComponent(TOKEN)}`;
  for (let page = 0; next && page < 10; page++) {
    const r = await fetch(next);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
    for (const a of j.data || []) {
      if (!String(a.name || '').toLowerCase().includes(q)) continue;
      const story = a.creative?.effective_object_story_id || a.creative?.object_story_id || null;
      out.push({ ad_id: a.id, ad: a.name, status: a.effective_status, campaign: a.campaign?.name, adset: a.adset?.name, post_id: story ? story.split('_').pop() : null });
    }
    next = j.paging?.next || null;
  }
  return out;
}
