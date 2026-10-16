/**
 * Build the dashboard "view" from a raw report (src/meta-api.js → fetchRawReport).
 *
 * Local Data Lake Engine v4:
 *  - Aggregations for ANY date preset ('today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month')
 *  - Aggregations for ANY account ('ALL' or specific account ID)
 *  - Aggregations for ANY product ('ALL', 'ucmas', 'uckid', 'mathca', 'traihe')
 *  - Lead & CRM funnel (L1 ➔ L2 ➔ L3 ➔ L4, revenue, CAC, CPL) from the Google Sheet
 *  - 100% local / in-memory: no Meta API call.
 *
 * Lead attribution (schema v3+):
 *  Leads carry the AD id from the CRM sheet, so they are matched to a campaign through
 *  `raw.adMap` (adId → campaignId), which the sync builds from act_X/ads. A lead that
 *  cannot be matched is NEVER spread across campaigns by spend weight — it lands in
 *  `unassignedLeads`, reported as its own labelled figure. See quy-tac-du-an.md §4.
 *
 * Invariant enforced here and covered by test/report.test.js:
 *  summary.<L1..L4|revenue> === Σ(campaigns shown) + unassignedLeads.<same field>
 */
import { TARGET_PRODUCTS, TARGET_KEYS, getVietnamDateString } from './meta-api.js';
import { leadInRange, emptyFunnel, addLeadToFunnel, withFunnelRates } from './google-sheet.js';

// Giữ lại đường import cũ cho test và các module khác.
export { getVietnamDateString };

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

/** Đúng định dạng YYYY-MM-DD và là ngày có thật. */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Chuẩn hoá khoảng ngày do người dùng tự chọn.
 * Trả về null nếu không dùng được, để bên gọi quay về preset.
 */
export function normalizeCustomRange(startDate, endDate, refDate = new Date()) {
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) return null;
  // Tự đảo nếu người dùng chọn ngược
  let [since, until] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  // Không cho vượt quá hôm nay — Meta không có dữ liệu tương lai
  const todayStr = getVietnamDateString(refDate);
  if (until > todayStr) until = todayStr;
  if (since > todayStr) since = todayStr;
  return { startDate: since, endDate: until };
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
  const pad = (n) => String(n).padStart(2, '0');
  /** Ngày cuối cùng của tháng (y, m) — m tính từ 1. */
  const lastDayOf = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();

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
    case 'last_90d':
      startDate = addDays(-89);
      endDate = todayStr;
      break;
    case 'this_month':
      startDate = `${y}-${pad(m)}-01`;
      endDate = todayStr;
      break;
    case 'last_month': {
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      startDate = `${py}-${pad(pm)}-01`;
      endDate = `${py}-${pad(pm)}-${pad(lastDayOf(py, pm))}`;
      break;
    }
    case 'this_quarter': {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      startDate = `${y}-${pad(qStartMonth)}-01`;
      endDate = todayStr;
      break;
    }
    case 'this_year':
      startDate = `${y}-01-01`;
      endDate = todayStr;
      break;
  }

  return { startDate, endDate, todayStr, yesterdayStr };
}

/** Các khoảng thời gian hợp lệ — dùng chung cho server, frontend và test. */
export const DATE_PRESETS = [
  'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d',
  'last_90d', 'this_month', 'last_month', 'this_quarter', 'this_year'
];

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export const monthOf = (dateStr) => String(dateStr || '').slice(0, 7);

/**
 * Chọn độ mịn cho biểu đồ xu hướng theo độ dài khoảng thời gian.
 *
 * Vẽ 289 điểm ngày cho chế độ "Cả năm" cho ra các cột rộng dưới 1 pixel — đo thực tế
 * 0,88px/cột. Gộp lại để biểu đồ còn đọc được, và nói rõ đang gộp theo gì.
 */
export function pickTrendGranularity(startDate, endDate) {
  const days = Math.round(
    (Date.UTC(...endDate.split('-').map((v, i) => (i === 1 ? +v - 1 : +v))) -
     Date.UTC(...startDate.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)))) / 86400000
  ) + 1;
  if (days <= 45) return { unit: 'day', label: 'theo ngày' };
  if (days <= 180) return { unit: 'week', label: 'theo tuần' };
  return { unit: 'month', label: 'theo tháng' };
}

/** Thứ Hai của tuần chứa `dateStr`, dạng YYYY-MM-DD. */
function weekStartOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = thứ Hai
  return new Date(dt.getTime() - dow * 86400000).toISOString().split('T')[0];
}

/** Gộp các điểm theo ngày thành tuần hoặc tháng. */
export function rollUpTrend(dailyPoints, unit) {
  if (unit === 'day') return dailyPoints;

  const buckets = new Map();
  for (const p of dailyPoints) {
    const key = unit === 'week' ? weekStartOf(p.date) : monthOf(p.date);
    const b = buckets.get(key) ||
      { date: key, spend: 0, impressions: 0, clicks: 0, messages: 0, days: 0 };
    b.spend += p.spend; b.impressions += p.impressions;
    b.clicks += p.clicks; b.messages += p.messages; b.days += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => ({ ...b, cpa: b.messages > 0 ? round(b.spend / b.messages) : 0 }));
}

/** Sum metrics of a campaign list into one stats object. */
function aggregate(campaigns) {
  const s = campaigns.reduce((acc, c) => {
    acc.spend += c.spend || 0;
    acc.messages += c.messages || 0;
    acc.otherConversions += c.otherConversions || 0;
    acc.impressions += c.impressions || 0;
    acc.clicks += c.clicks || 0;
    acc.expectedDailyBudget += c.expectedDailyBudget || 0;
    acc.todaySpend += c.todaySpend || 0;
    acc.todayMessages += c.todayMessages || 0;
    if (c.effective_status === 'ACTIVE') acc.activeCount += 1;
    return acc;
  }, {
    spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0,
    expectedDailyBudget: 0, todaySpend: 0, todayMessages: 0, activeCount: 0
  });

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
 * Mask phone number for dashboard display (e.g. 0968***189).
 */
export function maskPhone(phone) {
  if (!phone || phone.length < 8) return phone || '';
  return phone.slice(0, 4) + '***' + phone.slice(-3);
}

/**
 * Project an enrolled lead down to the fields the dashboard actually renders.
 * The raw phone number and ad id deliberately do NOT leave the server.
 */
function publicEnrolled(lead) {
  return {
    phoneMasked: maskPhone(lead.phone),
    l4Date: lead.l4Date || null,
    entryDate: lead.entryDate || null,
    fanpage: lead.fanpage || '',
    revenue: lead.revenue || 0,
    product: lead.product || 'khac'
  };
}

/** Derived cost metrics for a funnel bucket against a given spend. */
function leadCosts(spend, funnel) {
  return {
    cpl: funnel.l1Count > 0 ? round(spend / funnel.l1Count) : 0,
    cpaL3: funnel.l3Count > 0 ? round(spend / funnel.l3Count) : 0,
    cac: funnel.l4Count > 0 ? round(spend / funnel.l4Count) : 0,
    roas: spend > 0 ? parseFloat((funnel.revenue / spend).toFixed(2)) : 0
  };
}

/**
 * Attribute every lead in scope to a campaign, in ONE pass.
 *
 * @returns {{
 *   byCampaign: Map<string, object>,     // campaignId → funnel bucket
 *   byProduct: Record<string, object>,   // product key → funnel bucket (campaigns + unassigned)
 *   unassignedByProduct: Record<string, object>,
 *   enrolled: object[],                  // in-scope L4 leads, newest first
 *   matchedCount: number,
 *   unmatchedCount: number
 * }}
 */
function attributeLeads(leads, { adMap, campaignById, selectedAccount, startDate, endDate }) {
  const byCampaign = new Map();
  const byProduct = {};
  const unassignedByProduct = {};
  for (const k of TARGET_KEYS) {
    byProduct[k] = emptyFunnel();
    unassignedByProduct[k] = emptyFunnel();
  }

  const enrolled = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const lead of leads) {
    if (!leadInRange(lead, startDate, endDate)) continue;

    const campaignId = lead.adId ? adMap[lead.adId] : undefined;
    const camp = campaignId ? campaignById.get(campaignId) : undefined;

    // An unmatched lead has no account, so it cannot be shown under a single account.
    if (selectedAccount !== 'ALL' && (!camp || camp.accountId !== selectedAccount)) continue;

    // The matched campaign's product wins over the sheet's own guess.
    const product = camp ? camp.product : lead.product;
    if (!TARGET_KEYS.includes(product)) continue; // 'khac' is out of scope for all 5 tabs

    addLeadToFunnel(byProduct[product], lead);

    if (camp) {
      matchedCount += 1;
      const bucket = byCampaign.get(camp.id) || emptyFunnel();
      addLeadToFunnel(bucket, lead);
      byCampaign.set(camp.id, bucket);
    } else {
      unmatchedCount += 1;
      addLeadToFunnel(unassignedByProduct[product], lead);
    }

    if (lead.l4) enrolled.push(lead);
  }

  enrolled.sort((a, b) => (b.l4Date || '').localeCompare(a.l4Date || ''));

  return { byCampaign, byProduct, unassignedByProduct, enrolled, matchedCount, unmatchedCount };
}

/** Sum a list of funnel buckets. */
function sumFunnels(buckets) {
  return buckets.reduce((acc, b) => {
    acc.totalLeads += b.totalLeads;
    acc.l1Count += b.l1Count;
    acc.l2Count += b.l2Count;
    acc.l3Count += b.l3Count;
    acc.l4Count += b.l4Count;
    acc.revenue += b.revenue;
    return acc;
  }, emptyFunnel());
}

/**
 * Build view with multi-dimensional local slicing & lead funnel data.
 * @param {object} raw Raw report from latest_insights.json
 * @param {object|string} options { product = 'ALL', accountId = 'ALL', datePreset = 'last_30d', activeTab = 'all' }
 */
export function buildView(raw, options = {}) {
  if (!raw) throw new Error('buildView: chưa có dữ liệu snapshot (rawReport rỗng).');

  const opts = typeof options === 'string' ? { product: options } : (options || {});
  const activeTab = opts.activeTab || (opts.product && opts.product !== 'ALL' ? opts.product : 'all');
  const product = opts.product || (activeTab !== 'all' ? activeTab : 'ALL');
  const accountId = opts.accountId || 'ALL';
  const datePreset = opts.datePreset || raw.datePreset || 'last_30d';

  const selectedProduct = TARGET_KEYS.includes(product) ? product : 'ALL';
  const selectedAccount = (accountId && accountId !== 'ALL') ? String(accountId).replace(/^act_/, '') : 'ALL';

  // Khoảng ngày tự chọn được ưu tiên; không hợp lệ thì quay về preset.
  const custom = datePreset === 'custom'
    ? normalizeCustomRange(opts.startDate, opts.endDate)
    : null;
  const effectivePreset = custom ? 'custom' : (datePreset === 'custom' ? 'last_30d' : datePreset);
  const range = custom || getDateRange(effectivePreset);
  const { startDate, endDate } = range;
  const { todayStr } = getDateRange('today');

  const dailyRecords = raw.dailyRecords || [];
  const placementRecords = raw.placementRecords || [];
  const rawLeads = raw.leadsRecords || [];
  const rawCampaignsList = raw.campaigns || [];

  // Campaign lookup by id — replaces the O(leads × campaigns) .find() this used to do.
  const campaignById = new Map(rawCampaignsList.map(c => [c.id, c]));

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
      const cur = campAggMap.get(d.campaignId) ||
        { spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0 };
      cur.spend += d.spend || 0;
      cur.messages += d.messages || 0;
      cur.otherConversions += d.otherConversions || 0;
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

  // 1.5. Index placement spend per campaign (cũng lọc theo tháng như biểu đồ nền tảng)
  const campPlacementsMap = new Map();
  const startMonthIdx = monthOf(startDate);
  const endMonthIdx = monthOf(endDate);
  for (const p of placementRecords) {
    if (selectedAccount !== 'ALL' && p.accountId !== selectedAccount) continue;
    if (p.month && (p.month < startMonthIdx || p.month > endMonthIdx)) continue;
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

  // 1.6. Attribute CRM leads to campaigns through the adId → campaignId map (ONE pass)
  const adMap = raw.adMap || {};
  const leadAttr = attributeLeads(rawLeads, {
    adMap,
    campaignById,
    selectedAccount,
    startDate,
    endDate
  });

  // 2. Map all campaigns with aggregated metrics + lead funnel & platform breakdown
  const allFilteredCampaigns = rawCampaignsList
    .filter(c => selectedAccount === 'ALL' || c.accountId === selectedAccount)
    .map(c => {
      // Từ schema v4, chiến dịch KHÔNG còn mang số tổng sẵn — mọi chỉ số đều được
      // tính lại từ dailyRecords theo đúng khoảng thời gian đang xem.
      const agg = campAggMap.get(c.id) || { spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0 };
      const t = campTodayMap.get(c.id) || { spend: 0, messages: 0 };

      const spend = agg.spend || 0;
      const messages = agg.messages || 0;
      const impressions = agg.impressions || 0;
      const clicks = agg.clicks || 0;

      // Placement metrics
      const plc = campPlacementsMap.get(c.id) || { fbSpend: 0, igSpend: 0, msgSpend: 0, audSpend: 0, otherSpend: 0, total: 0 };
      let fbSpend = plc.fbSpend;
      const igSpend = plc.igSpend;
      const msgSpend = plc.msgSpend;
      const audSpend = plc.audSpend;
      const otherSpend = plc.otherSpend;
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

      // Lead metrics — ONLY leads whose ad id really maps to this campaign.
      const funnel = leadAttr.byCampaign.get(c.id) || emptyFunnel();
      const costs = leadCosts(spend, funnel);

      return {
        ...c,
        spend,
        messages,
        otherConversions: agg.otherConversions || 0,
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
        // Lead & funnel metrics (measured, not allocated)
        l1Count: funnel.l1Count,
        l2Count: funnel.l2Count,
        l3Count: funnel.l3Count,
        l4Count: funnel.l4Count,
        revenue: funnel.revenue,
        ...costs
      };
    });

  // 3. Filter campaigns for the 4 target products
  const targetCampaigns = allFilteredCampaigns.filter(c => TARGET_KEYS.includes(c.product));

  // Compute the 4 product summary cards with lead & funnel metrics
  const products = TARGET_PRODUCTS.map(p => {
    const pCamps = targetCampaigns.filter(c => c.product === p.key);
    const pStats = aggregate(pCamps);
    const pLeads = withFunnelRates(leadAttr.byProduct[p.key]);
    const costs = leadCosts(pStats.spend, pLeads);
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
      ...costs,
      convMsgToL1,
      convL1toL2: pLeads.convL1toL2,
      convL2toL3: pLeads.convL2toL3,
      convL3toL4: pLeads.convL3toL4,
      convTotal: pLeads.convTotal,
      unassignedL1: leadAttr.unassignedByProduct[p.key].l1Count,
      unassignedL4: leadAttr.unassignedByProduct[p.key].l4Count
    };
  });

  // Campaigns to display in table
  const viewCampaigns = targetCampaigns
    .filter(c => selectedProduct === 'ALL' || c.product === selectedProduct)
    .sort((a, b) => b.spend - a.spend || b.expectedDailyBudget - a.expectedDailyBudget);

  const s = aggregate(viewCampaigns);

  // 4. Funnel for the active view. Built from exactly the same buckets as the rows above,
  //    so Σ(rows) + unassigned === summary by construction (see test/report.test.js).
  const scopeKeys = selectedProduct === 'ALL' ? TARGET_KEYS : [selectedProduct];
  const activeLeadSummary = withFunnelRates(sumFunnels(scopeKeys.map(k => leadAttr.byProduct[k])));
  const unassignedLeads = withFunnelRates(sumFunnels(scopeKeys.map(k => leadAttr.unassignedByProduct[k])));
  const activeCosts = leadCosts(s.spend, activeLeadSummary);
  const activeConvMsgToL1 = s.messages > 0 ? ratio(activeLeadSummary.l1Count, s.messages) : 0;

  // 5. Daily trend list sorted chronologically
  const dailyPoints = [...dailyDateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, cpa: d.messages > 0 ? round(d.spend / d.messages) : 0 }));
  const trendGranularity = pickTrendGranularity(startDate, endDate);
  const dailyTrend = rollUpTrend(dailyPoints, trendGranularity.unit);

  // 6. Placements breakdown
  const placementMap = new Map();
  for (const p of placementRecords) {
    if (selectedAccount !== 'ALL' && p.accountId !== selectedAccount) continue;
    // Phân bổ nền tảng được Meta trả theo THÁNG, nên chỉ lọc được tới mức tháng.
    // Bản ghi cũ (schema v3) không có `month` — vẫn nhận để không mất dữ liệu.
    if (p.month && (p.month < startMonthIdx || p.month > endMonthIdx)) continue;
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

  // Lightweight badges for the 5 tabs. This replaces the old `productTabs` payload, which
  // shipped every campaign of all 4 products (436 KB) so the UI could read four numbers.
  const tabBadges = {};
  for (const p of products) {
    tabBadges[p.key] = {
      l1Count: p.l1Count,
      l3Count: p.l3Count,
      l4Count: p.l4Count,
      campaignCount: p.count,
      activeCount: p.activeCount
    };
  }

  // Data-quality notes shown in the UI. These are facts about the snapshot, not estimates.
  const dataNotes = [];
  // Khoảng thời gian kho dữ liệu THỰC SỰ chứa. Snapshot cũ (v2/v3) không có `coverage`,
  // suy ngược từ chính các bản ghi ngày đang có.
  const recordDates = dailyRecords.length
    ? dailyRecords.reduce(
        (acc, r) => ({ min: r.date < acc.min ? r.date : acc.min, max: r.date > acc.max ? r.date : acc.max }),
        { min: dailyRecords[0].date, max: dailyRecords[0].date })
    : null;
  const coverage = raw.coverage || (recordDates ? { since: recordDates.min, until: recordDates.max } : null);

  if (!raw.adMap) {
    dataNotes.push({
      level: 'warning',
      message: 'Snapshot cũ (schema v2) chưa có bảng tra Ad ID → Chiến dịch. Bấm "Đồng bộ" để ghép lead vào từng chiến dịch.'
    });
  }
  if (leadAttr.unmatchedCount > 0) {
    dataNotes.push({
      level: 'info',
      message: `${leadAttr.unmatchedCount} lead trong kỳ chưa ghép được vào chiến dịch (Ad ID trống hoặc không thuộc BM). Số này nằm ở dòng "Chưa gán được nguồn", không chia vào các chiến dịch.`
    });
  }
  if (selectedAccount !== 'ALL') {
    dataNotes.push({
      level: 'info',
      message: 'Đang xem theo 1 tài khoản: lead chưa ghép được chiến dịch bị loại khỏi tổng, vì không xác định được thuộc tài khoản nào.'
    });
  }
  // Cảnh báo khi người dùng chọn khoảng vượt ra ngoài vùng dữ liệu đã tải về.
  if (coverage && startDate < coverage.since) {
    dataNotes.push({
      level: 'warning',
      message: `Kho dữ liệu chỉ có từ ${coverage.since}, nhưng khoảng đang chọn bắt đầu từ ${startDate}. ` +
               `Phần trước ${coverage.since} đang thiếu — số liệu hiển thị thấp hơn thực tế.`
    });
  }

  return {
    schemaVersion: 5,
    fetchedAt: raw.fetchedAt,
    /** Preset thực sự đang dùng — 'custom' khi người dùng tự chọn khoảng ngày. */
    datePreset: effectivePreset,
    /** true khi khoảng ngày do người dùng tự nhập (không phải preset dựng sẵn). */
    isCustomRange: Boolean(custom),
    coverage,
    lastSync: raw.lastSync || null,
    /** Tần suất luôn đo trên 30 ngày gần nhất, không phụ thuộc khoảng đang xem. */
    frequencyWindow: raw.frequencyWindow || 'last_30d',
    dateRange: { startDate, endDate },
    activeTab,
    scope: { ...raw.scope, accountId: selectedAccount, name: scopeName },
    bmAccounts: raw.bmAccounts || [],
    product: selectedProduct,
    accountId: selectedAccount,
    products,
    tabBadges,
    /**
     * Tần suất giờ LUÔN là của 30 ngày gần nhất — một cửa sổ cố định, có nghĩa rõ ràng,
     * nên quy tắc bão hoà creative luôn áp dụng được. Trước đây tần suất là của cả
     * phạm vi đồng bộ nên phải khoá lại khi hai thứ lệch nhau.
     */
    fatigueApplicable: true,
    leadAttribution: {
      matched: leadAttr.matchedCount,
      unmatched: leadAttr.unmatchedCount,
      adMapSize: Object.keys(adMap).length
    },
    unassignedLeads,
    dataNotes,
    summary: {
      totalSpend: s.spend,
      totalMessages: s.messages,
      totalOtherConversions: s.otherConversions,
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
      ...activeCosts,
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
    /** Biểu đồ xu hướng đang gộp theo gì: day | week | month. */
    trendGranularity,
    placements,
    campaigns: viewCampaigns,
    recentEnrolled: leadAttr.enrolled.slice(0, 10).map(publicEnrolled),
    warnings: raw.warnings || []
  };
}
