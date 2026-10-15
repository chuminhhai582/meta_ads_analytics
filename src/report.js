/**
 * Build the dashboard "view" from a raw report (src/meta-api.js → fetchRawReport).
 *
 * Local Data Lake Engine v3:
 *  - Calculates aggregations for ANY date preset ('today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month')
 *  - Calculates aggregations for ANY account ('ALL' or specific account ID)
 *  - Calculates aggregations for ANY product ('ALL', 'ucmas', 'uckid', 'mathca', 'traihe')
 *  - Integrates Lead & CRM Funnel from Google Sheet (L1 ➔ L2 ➔ L3 ➔ L4, Revenue, CAC, CPL)
 *  - 100% Local / In-memory: executes in < 5ms without calling Meta API.
 */
import { TARGET_PRODUCTS, TARGET_KEYS } from './meta-api.js';
import { summarizeLeads } from './google-sheet.js';

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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Compute { startDate, endDate, todayStr, yesterdayStr } for a preset in Vietnam time.
 */
export function getDateRange(preset = 'last_30d', refDate = new Date()) {
  const todayStr = getVietnamDateString(refDate);

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
 * Mask phone number for dashboard display (e.g. 0968***189)
 */
function maskPhone(phone) {
  if (!phone || phone.length < 8) return phone || '';
  return phone.slice(0, 4) + '***' + phone.slice(-3);
}

/**
 * Build view with multi-dimensional local slicing & lead funnel data:
 * @param {object} raw Raw report from latest_insights.json
 * @param {object|string} options { product = 'ALL', accountId = 'ALL', datePreset = 'last_30d', activeTab = 'all' }
 */
export function buildView(raw, options = {}) {
  const opts = typeof options === 'string' ? { product: options } : (options || {});
  const activeTab = opts.activeTab || (opts.product && opts.product !== 'ALL' ? opts.product : 'all');
  const product = opts.product || (activeTab !== 'all' ? activeTab : 'ALL');
  const accountId = opts.accountId || 'ALL';
  const datePreset = opts.datePreset || raw.datePreset || 'last_30d';

  const selectedProduct = TARGET_KEYS.includes(product) ? product : 'ALL';
  const selectedAccount = (accountId && accountId !== 'ALL') ? String(accountId).replace(/^act_/, '') : 'ALL';

  const { startDate, endDate, todayStr } = getDateRange(datePreset);

  const dailyRecords = raw.dailyRecords || [];
  const placementRecords = raw.placementRecords || [];
  const rawLeads = raw.leadsRecords || [];

  // 1. Group daily stats by campaign for chosen date range & account
  const campAggMap = new Map();
  const campTodayMap = new Map();
  const dailyDateMap = new Map();

  for (const d of dailyRecords) {
    if (selectedAccount !== 'ALL' && d.accountId !== selectedAccount) continue;

    if (d.date === todayStr) {
      const curToday = campTodayMap.get(d.campaignId) || { spend: 0, messages: 0 };
      curToday.spend += d.spend || 0;
      curToday.messages += d.messages || 0;
      campTodayMap.set(d.campaignId, curToday);
    }

    if (d.date >= startDate && d.date <= endDate) {
      const cur = campAggMap.get(d.campaignId) || { spend: 0, messages: 0, impressions: 0, clicks: 0 };
      cur.spend += d.spend || 0;
      cur.messages += d.messages || 0;
      cur.impressions += d.impressions || 0;
      cur.clicks += d.clicks || 0;
      campAggMap.set(d.campaignId, cur);

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

  // 1.5. Index placement spend per campaign
  const campPlacementsMap = new Map();
  for (const p of placementRecords) {
    if (selectedAccount !== 'ALL' && p.accountId !== selectedAccount) continue;
    const cur = campPlacementsMap.get(p.campaignId) || {
      fbSpend: 0,
      igSpend: 0,
      msgSpend: 0,
      audSpend: 0,
      otherSpend: 0,
      total: 0
    };
    if (p.platform === 'facebook') cur.fbSpend += p.spend || 0;
    else if (p.platform === 'instagram') cur.igSpend += p.spend || 0;
    else if (p.platform === 'messenger') cur.msgSpend += p.spend || 0;
    else if (p.platform === 'audience_network') cur.audSpend += p.spend || 0;
    else cur.otherSpend += p.spend || 0;
    cur.total += p.spend || 0;
    campPlacementsMap.set(p.campaignId, cur);
  }

  // 1.6. Match leads directly to campaigns via Ad ID or matching 11-digit prefix
  const directLeadsMap = new Map();
  const assignedLeadIds = new Set();
  const rawCampaignsList = raw.campaigns || [];

  for (const l of rawLeads) {
    if (!l.adId) continue;
    const matchedCamp = rawCampaignsList.find(c =>
      c.id === l.adId ||
      (c.product === l.product && l.adId.length >= 11 && c.id.slice(0, 11) === l.adId.slice(0, 11))
    );
    if (matchedCamp) {
      assignedLeadIds.add(l.id);
      const cur = directLeadsMap.get(matchedCamp.id) || { l1: 0, l2: 0, l3: 0, l4: 0, revenue: 0 };
      if (l.l1) cur.l1++;
      if (l.l2) cur.l2++;
      if (l.l3) cur.l3++;
      if (l.l4) cur.l4++;
      cur.revenue += l.revenue || 0;
      directLeadsMap.set(matchedCamp.id, cur);
    }
  }

  // Group unassigned leads by product
  const unassignedByProduct = {};
  TARGET_KEYS.forEach(k => {
    unassignedByProduct[k] = { l1: 0, l2: 0, l3: 0, l4: 0, revenue: 0 };
  });
  for (const l of rawLeads) {
    if (assignedLeadIds.has(l.id)) continue;
    const bucket = unassignedByProduct[l.product];
    if (bucket) {
      if (l.l1) bucket.l1++;
      if (l.l2) bucket.l2++;
      if (l.l3) bucket.l3++;
      if (l.l4) bucket.l4++;
      bucket.revenue += l.revenue || 0;
    }
  }

  // Total spend per product for proportional allocation
  const productSpendMap = {};
  TARGET_KEYS.forEach(k => { productSpendMap[k] = 0; });
  for (const c of rawCampaignsList) {
    if (selectedAccount !== 'ALL' && c.accountId !== selectedAccount) continue;
    const agg = dailyRecords.length > 0 ? (campAggMap.get(c.id) || { spend: 0 }) : c;
    const sp = agg.spend || 0;
    if (sp > 0 && productSpendMap[c.product] !== undefined) {
      productSpendMap[c.product] += sp;
    }
  }

  // 2. Map all campaigns with aggregated metrics + lead funnel & platform breakdown
  const allFilteredCampaigns = rawCampaignsList
    .filter(c => selectedAccount === 'ALL' || c.accountId === selectedAccount)
    .map(c => {
      const agg = dailyRecords.length > 0 ? (campAggMap.get(c.id) || { spend: 0, messages: 0, impressions: 0, clicks: 0 }) : c;
      const t = dailyRecords.length > 0 ? (campTodayMap.get(c.id) || { spend: 0, messages: 0 }) : { spend: c.todaySpend || 0, messages: c.todayMessages || 0 };

      const spend = agg.spend || 0;
      const messages = agg.messages || 0;
      const impressions = agg.impressions || 0;
      const clicks = agg.clicks || 0;

      // Placement metrics
      const plc = campPlacementsMap.get(c.id) || { fbSpend: 0, igSpend: 0, msgSpend: 0, audSpend: 0, otherSpend: 0, total: 0 };
      let fbSpend = plc.fbSpend;
      let igSpend = plc.igSpend;
      let msgSpend = plc.msgSpend;
      let audSpend = plc.audSpend;
      let otherSpend = plc.otherSpend;
      if (spend > 0 && plc.total === 0) {
        fbSpend = spend;
      }
      const platformBreakdown = [];
      const baseSpend = spend > 0 ? spend : 1;
      if (fbSpend > 0) platformBreakdown.push({ platform: 'facebook', short: 'FB', label: 'Facebook', spend: fbSpend, pct: round((fbSpend / baseSpend) * 100) });
      if (igSpend > 0) platformBreakdown.push({ platform: 'instagram', short: 'IG', label: 'Instagram', spend: igSpend, pct: round((igSpend / baseSpend) * 100) });
      if (msgSpend > 0) platformBreakdown.push({ platform: 'messenger', short: 'Msg', label: 'Messenger', spend: msgSpend, pct: round((msgSpend / baseSpend) * 100) });
      if (audSpend > 0) platformBreakdown.push({ platform: 'audience_network', short: 'Aud', label: 'Audience Net', spend: audSpend, pct: round((audSpend / baseSpend) * 100) });
      if (otherSpend > 0) platformBreakdown.push({ platform: 'other', short: 'Khác', label: 'Khác', spend: otherSpend, pct: round((otherSpend / baseSpend) * 100) });

      // Leads metrics (direct + proportional)
      const direct = directLeadsMap.get(c.id) || { l1: 0, l2: 0, l3: 0, l4: 0, revenue: 0 };
      const unassigned = unassignedByProduct[c.product] || { l1: 0, l2: 0, l3: 0, l4: 0, revenue: 0 };
      const prodTotalSpend = productSpendMap[c.product] || 0;
      const weight = (spend > 0 && prodTotalSpend > 0) ? (spend / prodTotalSpend) : 0;

      const l1Count = direct.l1 + Math.round(unassigned.l1 * weight);
      const l2Count = direct.l2 + Math.round(unassigned.l2 * weight);
      const l3Count = direct.l3 + Math.round(unassigned.l3 * weight);
      const l4Count = direct.l4 + Math.round(unassigned.l4 * weight);
      const revenue = direct.revenue + Math.round(unassigned.revenue * weight);

      const cpl = l1Count > 0 ? round(spend / l1Count) : 0;
      const cac = l4Count > 0 ? round(spend / l4Count) : 0;
      const cpaL3 = l3Count > 0 ? round(spend / l3Count) : 0;
      const roas = spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0;

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
        todayMessages: t.messages || 0,
        // Platform breakdown
        fbSpend,
        igSpend,
        msgSpend,
        audSpend,
        otherSpend,
        platformBreakdown,
        // Lead & funnel metrics
        l1Count,
        l2Count,
        l3Count,
        l4Count,
        revenue,
        cpl,
        cpaL3,
        cac,
        roas,
        directL1: direct.l1,
        directL4: direct.l4,
        directRevenue: direct.revenue
      };
    });

  // 3. Filter campaigns for the 4 target products
  const targetCampaigns = allFilteredCampaigns.filter(c => TARGET_KEYS.includes(c.product));

  // Compute the 4 product summary cards with lead & funnel metrics
  const products = TARGET_PRODUCTS.map(p => {
    const pCamps = targetCampaigns.filter(c => c.product === p.key);
    const pStats = aggregate(pCamps);
    const pLeads = summarizeLeads(rawLeads, { product: p.key });

    const cpl = pLeads.l1Count > 0 ? round(pStats.spend / pLeads.l1Count) : 0;
    const cpaL3 = pLeads.l3Count > 0 ? round(pStats.spend / pLeads.l3Count) : 0;
    const cac = pLeads.l4Count > 0 ? round(pStats.spend / pLeads.l4Count) : 0;
    const roas = pStats.spend > 0 ? parseFloat((pLeads.revenue / pStats.spend).toFixed(2)) : 0;
    const convMsgToL1 = pStats.messages > 0 ? ratio(pLeads.l1Count, pStats.messages) : 0;

    return {
      ...p,
      ...pStats,
      leads: pLeads.totalLeads,
      l1Count: pLeads.l1Count,
      l2Count: pLeads.l2Count,
      l3Count: pLeads.l3Count,
      l4Count: pLeads.l4Count,
      revenue: pLeads.revenue,
      cpl,
      cpaL3,
      cac,
      roas,
      convMsgToL1,
      convL1toL2: pLeads.convL1toL2,
      convL2toL3: pLeads.convL2toL3,
      convL3toL4: pLeads.convL3toL4,
      convTotal: pLeads.convTotal
    };
  });

  // Campaigns to display in table
  const viewCampaigns = targetCampaigns
    .filter(c => selectedProduct === 'ALL' || c.product === selectedProduct)
    .sort((a, b) => b.spend - a.spend || b.expectedDailyBudget - a.expectedDailyBudget);

  const s = aggregate(viewCampaigns);

  // 4. Summarize leads for currently active view / tab
  const activeLeadSummary = summarizeLeads(rawLeads, { product: selectedProduct });
  const activeCpl = activeLeadSummary.l1Count > 0 ? round(s.spend / activeLeadSummary.l1Count) : 0;
  const activeCpaL3 = activeLeadSummary.l3Count > 0 ? round(s.spend / activeLeadSummary.l3Count) : 0;
  const activeCac = activeLeadSummary.l4Count > 0 ? round(s.spend / activeLeadSummary.l4Count) : 0;
  const activeRoas = s.spend > 0 ? parseFloat((activeLeadSummary.revenue / s.spend).toFixed(2)) : 0;
  const activeConvMsgToL1 = s.messages > 0 ? ratio(activeLeadSummary.l1Count, s.messages) : 0;

  // 5. Daily trend list sorted chronologically
  const dailyTrend = [...dailyDateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, cpa: d.messages > 0 ? round(d.spend / d.messages) : 0 }));

  // 6. Placements breakdown
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

  // Build dedicated tab data for the 4 products
  const productTabs = {};
  TARGET_KEYS.forEach(key => {
    const prodObj = products.find(p => p.key === key) || {};
    const prodCamps = targetCampaigns.filter(c => c.product === key);
    const prodLeads = summarizeLeads(rawLeads, { product: key });

    productTabs[key] = {
      key,
      name: prodObj.name || key.toUpperCase(),
      stats: prodObj,
      campaigns: prodCamps,
      funnel: {
        impressions: prodObj.impressions || 0,
        clicks: prodObj.clicks || 0,
        messages: prodObj.messages || 0,
        l1: prodLeads.l1Count,
        l2: prodLeads.l2Count,
        l3: prodLeads.l3Count,
        l4: prodLeads.l4Count
      },
      recentEnrolled: (prodLeads.recentEnrolled || []).map(r => ({
        ...r,
        phoneMasked: maskPhone(r.phone)
      }))
    };
  });

  return {
    fetchedAt: raw.fetchedAt,
    datePreset,
    dateRange: { startDate, endDate },
    activeTab,
    scope: { ...raw.scope, accountId: selectedAccount, name: scopeName },
    bmAccounts: raw.bmAccounts || [],
    product: selectedProduct,
    accountId: selectedAccount,
    products,
    productTabs,
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
      activeCount: s.activeCount,
      // Lead Funnel & Revenue Metrics
      totalLeads: activeLeadSummary.totalLeads,
      l1Count: activeLeadSummary.l1Count,
      l2Count: activeLeadSummary.l2Count,
      l3Count: activeLeadSummary.l3Count,
      l4Count: activeLeadSummary.l4Count,
      totalRevenue: activeLeadSummary.revenue,
      cpl: activeCpl,
      cpaL3: activeCpaL3,
      cac: activeCac,
      roas: activeRoas,
      convMsgToL1: activeConvMsgToL1,
      convL1toL2: activeLeadSummary.convL1toL2,
      convL2toL3: activeLeadSummary.convL2toL3,
      convL3toL4: activeLeadSummary.convL3toL4,
      convTotal: activeLeadSummary.convTotal
    },
    funnel: {
      impressions: s.impressions,
      clicks: s.clicks,
      messages: s.messages,
      l1: activeLeadSummary.l1Count,
      l2: activeLeadSummary.l2Count,
      l3: activeLeadSummary.l3Count,
      l4: activeLeadSummary.l4Count
    },
    dailyTrend,
    placements,
    campaigns: viewCampaigns,
    recentEnrolled: (activeLeadSummary.recentEnrolled || []).map(r => ({
      ...r,
      phoneMasked: maskPhone(r.phone)
    })),
    warnings: raw.warnings || []
  };
}
