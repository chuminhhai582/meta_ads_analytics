/**
 * Build the dashboard "view" from a raw report (src/meta-api.js → fetchRawReport).
 *
 * Local Data Lake Engine:
 *  - Calculates aggregations for ANY date preset ('today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month')
 *  - Calculates aggregations for ANY account ('ALL' or specific account ID)
 *  - Calculates aggregations for ANY product ('ALL' or 'ucmas', 'uckid', 'mathca', 'traihe')
 *  - 100% Local / In-memory: executes in < 5ms without calling Meta API.
 */
import { TARGET_PRODUCTS, TARGET_KEYS } from './meta-api.js';

export const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  messenger: 'Messenger',
  audience_network: 'Audience Network',
  threads: 'Threads',
  unknown: 'Khác'
};

const round = (n) => Math.round(n || 0);
const ratio = (a, b, digits = 2) => (b > 0 ? parseFloat(((a / b) * 100).toFixed(digits)) : 0);

/**
 * Get YYYY-MM-DD in Vietnam timezone (Asia/Ho_Chi_Minh - GMT+7).
 */
export function getVietnamDateString(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  return parts; // e.g. "2026-10-15"
}

/**
 * Compute { startDate, endDate, todayStr, yesterdayStr } for a preset in Vietnam time.
 */
export function getDateRange(preset = 'last_30d', refDate = new Date()) {
  const todayStr = getVietnamDateString(refDate);

  // Parse YYYY, MM, DD in UTC space for safe day arithmetic
  const [y, m, d] = todayStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));

  const addDays = (offset) => {
    const next = new Date(base.getTime() + offset * 86400000);
    return next.toISOString().split('T')[0];
  };

  const yesterdayStr = addDays(-1);

  let startDate = addDays(-29);
  let endDate = todayStr;

  switch (preset) {
    case 'today':
      startDate = todayStr;
      endDate = todayStr;
      break;
    case 'yesterday':
      startDate = yesterdayStr;
      endDate = yesterdayStr;
      break;
    case 'last_7d':
      startDate = addDays(-6);
      endDate = todayStr;
      break;
    case 'last_14d':
      startDate = addDays(-13);
      endDate = todayStr;
      break;
    case 'last_30d':
      startDate = addDays(-29);
      endDate = todayStr;
      break;
    case 'this_month': {
      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
      startDate = monthStart;
      endDate = todayStr;
      break;
    }
  }

  return { startDate, endDate, todayStr, yesterdayStr };
}

/** Sum metrics of a campaign list into one stats object. */
function aggregate(campaigns) {
  const s = campaigns.reduce((acc, c) => {
    acc.spend += c.spend || 0;
    acc.messages += c.messages || 0;
    acc.impressions += c.impressions || 0;
    acc.clicks += c.clicks || 0;
    acc.expectedDailyBudget += c.expectedDailyBudget || 0;
    acc.todaySpend += c.todaySpend || 0;
    acc.todayMessages += c.todayMessages || 0;
    if (c.effective_status === 'ACTIVE') acc.activeCount += 1;
    return acc;
  }, { spend: 0, messages: 0, impressions: 0, clicks: 0, expectedDailyBudget: 0, todaySpend: 0, todayMessages: 0, activeCount: 0 });

  return {
    ...s,
    count: campaigns.length,
    cpa: s.messages > 0 ? round(s.spend / s.messages) : 0,
    ctr: ratio(s.clicks, s.impressions),
    cpc: s.clicks > 0 ? round(s.spend / s.clicks) : 0,
    cpm: s.impressions > 0 ? round((s.spend / s.impressions) * 1000) : 0,
    todayCpa: s.todayMessages > 0 ? round(s.todaySpend / s.todayMessages) : 0,
    pacingPct: s.expectedDailyBudget > 0 ? parseFloat(((s.todaySpend / s.expectedDailyBudget) * 100).toFixed(1)) : 0
  };
}

/**
 * Build view with multi-dimensional local slicing:
 * @param {object} raw Raw report (v2) from latest_insights.json
 * @param {object|string} options { product = 'ALL', accountId = 'ALL', datePreset = 'last_30d' } or product string
 */
export function buildView(raw, options = {}) {
  const opts = typeof options === 'string' ? { product: options } : (options || {});
  const product = opts.product || 'ALL';
  const accountId = opts.accountId || 'ALL';
  const datePreset = opts.datePreset || raw.datePreset || 'last_30d';

  const selectedProduct = TARGET_KEYS.includes(product) ? product : 'ALL';
  const selectedAccount = (accountId && accountId !== 'ALL') ? String(accountId).replace(/^act_/, '') : 'ALL';

  const { startDate, endDate, todayStr } = getDateRange(datePreset);

  const dailyRecords = raw.dailyRecords || [];
  const placementRecords = raw.placementRecords || [];

  // 1. Group daily stats by campaign for the chosen date range & account
  const campAggMap = new Map();
  const campTodayMap = new Map();
  const dailyDateMap = new Map();

  for (const d of dailyRecords) {
    // Filter account
    if (selectedAccount !== 'ALL' && d.accountId !== selectedAccount) continue;

    // Track today's spend & messages regardless of datePreset (so today's KPI is always accurate)
    if (d.date === todayStr) {
      const curToday = campTodayMap.get(d.campaignId) || { spend: 0, messages: 0 };
      curToday.spend += d.spend || 0;
      curToday.messages += d.messages || 0;
      campTodayMap.set(d.campaignId, curToday);
    }

    // Filter date range for the active period
    if (d.date >= startDate && d.date <= endDate) {
      const cur = campAggMap.get(d.campaignId) || { spend: 0, messages: 0, impressions: 0, clicks: 0 };
      cur.spend += d.spend || 0;
      cur.messages += d.messages || 0;
      cur.impressions += d.impressions || 0;
      cur.clicks += d.clicks || 0;
      campAggMap.set(d.campaignId, cur);

      // Daily trend aggregation for charts (if matching product)
      const matchProd = selectedProduct === 'ALL' ? TARGET_KEYS.includes(d.product) : d.product === selectedProduct;
      if (matchProd) {
        const trendItem = dailyDateMap.get(d.date) || { date: d.date, spend: 0, impressions: 0, clicks: 0, messages: 0 };
        trendItem.spend += d.spend || 0;
        trendItem.impressions += d.impressions || 0;
        trendItem.clicks += d.clicks || 0;
        trendItem.messages += d.messages || 0;
        dailyDateMap.set(d.date, trendItem);
      }
    }
  }

  // 2. Map all campaigns with aggregated metrics
  const allFilteredCampaigns = (raw.campaigns || [])
    .filter(c => selectedAccount === 'ALL' || c.accountId === selectedAccount)
    .map(c => {
      // If daily records are present, aggregate dynamically; otherwise fallback to stored snapshot values
      const agg = dailyRecords.length > 0 ? (campAggMap.get(c.id) || { spend: 0, messages: 0, impressions: 0, clicks: 0 }) : c;
      const t = dailyRecords.length > 0 ? (campTodayMap.get(c.id) || { spend: 0, messages: 0 }) : { spend: c.todaySpend || 0, messages: c.todayMessages || 0 };

      const spend = agg.spend || 0;
      const messages = agg.messages || 0;
      const impressions = agg.impressions || 0;
      const clicks = agg.clicks || 0;

      return {
        ...c,
        spend,
        messages,
        impressions,
        clicks,
        ctr: ratio(clicks, impressions),
        cpc: clicks > 0 ? round(spend / clicks) : 0,
        cpm: impressions > 0 ? round((spend / impressions) * 1000) : 0,
        cpa: messages > 0 ? round(spend / messages) : 0,
        todaySpend: t.spend || 0,
        todayMessages: t.messages || 0
      };
    });

  // 3. Filter campaigns for the 4 target products
  const targetCampaigns = allFilteredCampaigns.filter(c => TARGET_KEYS.includes(c.product));

  // Compute the 4 product summary cards
  const products = TARGET_PRODUCTS.map(p => ({
    ...p,
    ...aggregate(targetCampaigns.filter(c => c.product === p.key))
  }));

  // Campaigns to display in table / AI analysis
  const viewCampaigns = targetCampaigns
    .filter(c => selectedProduct === 'ALL' || c.product === selectedProduct)
    .sort((a, b) => b.spend - a.spend || b.expectedDailyBudget - a.expectedDailyBudget);

  const s = aggregate(viewCampaigns);

  // 4. Daily trend list sorted chronologically
  const dailyTrend = [...dailyDateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, cpa: d.messages > 0 ? round(d.spend / d.messages) : 0 }));

  // 5. Placements breakdown for selected account & product
  const placementMap = new Map();
  for (const p of placementRecords) {
    if (selectedAccount !== 'ALL' && p.accountId !== selectedAccount) continue;
    const matchProd = selectedProduct === 'ALL' ? TARGET_KEYS.includes(p.product) : p.product === selectedProduct;
    if (!matchProd) continue;

    const item = placementMap.get(p.platform) || { platform: p.platform, label: PLATFORM_LABELS[p.platform] || p.platform, spend: 0, impressions: 0 };
    item.spend += p.spend || 0;
    item.impressions += p.impressions || 0;
    placementMap.set(p.platform, item);
  }
  const placementList = [...placementMap.values()].filter(p => p.spend > 0).sort((a, b) => b.spend - a.spend);
  const totalPlacementSpend = placementList.reduce((acc, p) => acc + p.spend, 0);
  const placements = placementList.map(p => ({
    ...p,
    percentage: totalPlacementSpend > 0 ? parseFloat(((p.spend / totalPlacementSpend) * 100).toFixed(1)) : 0
  }));

  // Resolve scope display name
  let scopeName = raw.scope?.name || 'Toàn BM Ucmas Việt Nam';
  if (selectedAccount !== 'ALL') {
    const accObj = (raw.bmAccounts || []).find(a => a.numericId === selectedAccount);
    scopeName = accObj ? accObj.name : `Tài khoản ${selectedAccount}`;
  }

  return {
    fetchedAt: raw.fetchedAt,
    datePreset,
    dateRange: { startDate, endDate },
    scope: { ...raw.scope, accountId: selectedAccount, name: scopeName },
    bmAccounts: raw.bmAccounts || [],
    product: selectedProduct,
    accountId: selectedAccount,
    products,
    summary: {
      totalSpend: s.spend,
      totalMessages: s.messages,
      avgCpa: s.cpa,
      totalImpressions: s.impressions,
      totalClicks: s.clicks,
      avgCtr: s.ctr,
      avgCpc: s.cpc,
      avgCpm: s.cpm,
      expectedDailyBudget: s.expectedDailyBudget,
      todaySpend: s.todaySpend,
      todayMessages: s.todayMessages,
      todayCpa: s.todayCpa,
      pacingPct: s.pacingPct,
      campaignCount: s.count,
      activeCount: s.activeCount
    },
    funnel: { impressions: s.impressions, clicks: s.clicks, messages: s.messages },
    dailyTrend,
    placements,
    campaigns: viewCampaigns,
    warnings: raw.warnings || []
  };
}
