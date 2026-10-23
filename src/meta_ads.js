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
