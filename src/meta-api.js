/**
 * Meta Graph API client for BM Ucmas Việt Nam.
 *
 * Responsibilities:
 *  - Fetch every ad account owned by the configured Business Manager.
 *  - Fetch campaigns / ad sets / insights for each account WITH FULL PAGINATION.
 *  - Tag each campaign with a product (rule: text between the 1st and 2nd "/").
 *  - Compute expected daily budget (CBO, or sum of ACTIVE ad sets for ABO).
 *  - Return a "raw report" (stored in data/latest_insights.json). The per-product
 *    view sent to the browser is built by src/report.js.
 *
 * Only REAL data from Meta is returned. Nothing is simulated.
 */
import { config } from './config.js';

const BASE_URL = 'https://graph.facebook.com';
const MAX_PAGES = 50;              // safety cap per paginated request
const ACCOUNT_CONCURRENCY = 3;     // accounts processed in parallel (rate-limit friendly)

/** The 4 products the owner wants to analyse (order = display order). */
export const TARGET_PRODUCTS = [
  { key: 'ucmas', name: 'UCMAS', subtitle: 'Toán tư duy não bộ' },
  { key: 'uckid', name: 'UCKID', subtitle: 'Tiền tiểu học & Mầm non' },
  { key: 'mathca', name: 'MATHCA', subtitle: 'Toán trải nghiệm' },
  { key: 'traihe', name: 'TRẠI HÈ', subtitle: 'Trại hè / Summer Camp' }
];
export const TARGET_KEYS = TARGET_PRODUCTS.map(p => p.key);

/**
 * Detect product from campaign name strictly for 4 requested products:
 * UCMAS, UCKID, MATHCA, TRẠI HÈ
 * Rule: Product name is between 1st and 2nd slash '/' in campaign name (e.g. author/product/type/topic)
 */
export function detectProduct(campaignName) {
  if (!campaignName || typeof campaignName !== 'string') {
    return { key: 'khac', label: 'Khác' };
  }

  const match = (lower) => {
    if (lower.includes('ucmas')) return { key: 'ucmas', label: 'UCMAS' };
    if (lower.includes('uckid') || lower === 'uc-kid') return { key: 'uckid', label: 'UCKID' };
    if (lower.includes('mathca')) return { key: 'mathca', label: 'MATHCA' };
    if (lower.includes('traihe') || lower.includes('trại hè')) return { key: 'traihe', label: 'TRẠI HÈ' };
    return null;
  };

  const parts = campaignName.split('/');
  if (parts.length >= 2 && parts[1].trim()) {
    const hit = match(parts[1].trim().toLowerCase());
    if (hit) return hit;
  }

  // Fallback if slashes are missing or formatted differently
  return match(campaignName.toLowerCase()) || { key: 'khac', label: 'Khác' };
}

/**
 * Execute a single GET request to Meta Graph API.
 * The access token is never included in thrown error messages.
 */
async function callGraphApi(endpoint, params = {}) {
  if (!config.hasToken()) {
    throw new Error('Chưa cấu hình META_ADS_ACCESS_TOKEN trong .env');
  }
  const url = new URL(`${BASE_URL}/${config.apiVersion}/${endpoint}`);
  url.searchParams.set('access_token', config.accessToken);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
  }
  return fetchJson(url.toString());
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await response.json();
  if (json.error) {
    throw new Error(`Meta API Error [${json.error.code} - ${json.error.type}]: ${json.error.message}`);
  }
  return json;
}

/**
 * GET with full pagination (follows paging.next until exhausted).
 * Returns { rows, truncated } — truncated=true if MAX_PAGES was hit.
 */
async function callGraphApiAll(endpoint, params = {}) {
  const first = await callGraphApi(endpoint, params);
  const rows = [...(first.data || [])];
  let next = first.paging?.next;
  let pages = 1;
  while (next && pages < MAX_PAGES) {
    const page = await fetchJson(next);
    rows.push(...(page.data || []));
    next = page.paging?.next;
    pages++;
  }
  return { rows, truncated: Boolean(next) };
}

/** Run async fn over items with limited concurrency, preserving order. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Extract the primary conversion (messages → leads → purchases) from insights actions.
 * Business model = messaging/lead generation, so messages are the main KPI.
 */
function extractMessages(actions = []) {
  let messages = 0, connections = 0, leads = 0, purchases = 0;
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const val = parseInt(a.value, 10) || 0;
      switch (a.action_type) {
        case 'onsite_conversion.messaging_conversation_started_7d': messages = Math.max(messages, val); break;
        case 'onsite_conversion.total_messaging_connection': connections = Math.max(connections, val); break;
        case 'lead':
        case 'onsite_conversion.lead': leads = Math.max(leads, val); break;
        case 'purchase':
        case 'omni_purchase': purchases = Math.max(purchases, val); break;
      }
    }
  }
  return messages || connections || leads || purchases;
}

/**
 * Get all Ad Accounts belonging strictly to the configured BM (default 2590933284556026 "Ucmas Việt Nam").
 */
export async function getUserAdAccounts() {
  if (!config.hasToken()) return [];
  const bmId = config.businessId;
  let accounts = [];
  try {
    const res = await callGraphApiAll(`${bmId}/owned_ad_accounts`, {
      fields: 'id,name,account_id,account_status,currency,timezone_name',
      limit: 100
    });
    accounts = res.rows;
  } catch (bmErr) {
    console.warn('[Meta API] Không thể lấy trực tiếp từ BM, quét qua /me/adaccounts:', bmErr.message);
  }

  // Fallback: /me/adaccounts filtered by business ID
  if (accounts.length === 0) {
    const res = await callGraphApiAll('me/adaccounts', {
      fields: 'id,name,account_id,account_status,currency,timezone_name,business{id}',
      limit: 100
    });
    accounts = res.rows.filter(a => a.business?.id === bmId);
  }

  const formatted = accounts.map(acc => ({
    id: acc.id,
    numericId: acc.account_id || acc.id.replace(/^act_/, ''),
    name: `TK ${acc.name || acc.account_id}`,
    rawName: acc.name || acc.account_id,
    status: acc.account_status,
    currency: acc.currency || 'VND',
    timezone: acc.timezone_name
  }));

  // Natural sort (TK 1, TK 2, ... TK 10)
  return formatted.sort((a, b) => {
    const numA = parseInt(a.rawName, 10);
    const numB = parseInt(b.rawName, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.rawName).localeCompare(String(b.rawName));
  });
}

/**
 * Fetch everything for ONE ad account, in parallel. Each step fails independently
 * and is reported in `warnings` so one broken call never hides the other data.
 */
async function fetchAccountData(acc, datePreset) {
  const ep = `act_${acc.numericId}`;
  const warnings = [];
  const safe = async (step, promise) => {
    try {
      const res = await promise;
      if (res.truncated) warnings.push({ account: acc.name, step, message: `Vượt quá ${MAX_PAGES} trang, dữ liệu có thể thiếu` });
      return res.rows;
    } catch (err) {
      warnings.push({ account: acc.name, step, message: err.message });
      return [];
    }
  };

  const insightFields = 'campaign_id,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions';
  const [campaigns, adsets, insights, todayInsights, daily, placements] = await Promise.all([
    safe('campaigns', callGraphApiAll(`${ep}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time', limit: 200
    })),
    safe('adsets', callGraphApiAll(`${ep}/adsets`, {
      fields: 'id,campaign_id,effective_status,daily_budget', limit: 500
    })),
    safe('insights', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', date_preset: datePreset, fields: insightFields, limit: 500
    })),
    safe('insights_today', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', date_preset: 'today', fields: 'campaign_id,spend,actions', limit: 500
    })),
    safe('insights_daily', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', date_preset: datePreset, time_increment: 1,
      fields: 'campaign_id,date_start,spend,impressions,clicks,actions', limit: 500
    })),
    safe('insights_placement', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', date_preset: datePreset, breakdowns: 'publisher_platform',
      fields: 'campaign_id,spend,impressions', limit: 500
    }))
  ]);

  return { acc, campaigns, adsets, insights, todayInsights, daily, placements, warnings };
}

/** Merge one account's raw API rows into normalized campaign objects + aggregates. */
function normalizeAccount({ acc, campaigns, adsets, insights, todayInsights, daily, placements }) {
  // ABO budget: sum daily_budget of ad sets that are REALLY delivering
  const aboBudget = new Map();
  for (const a of adsets) {
    if (a.effective_status === 'ACTIVE' && a.daily_budget) {
      aboBudget.set(a.campaign_id, (aboBudget.get(a.campaign_id) || 0) + (parseInt(a.daily_budget, 10) || 0));
    }
  }
  const insMap = new Map(insights.map(i => [i.campaign_id, i]));
  const todayMap = new Map(todayInsights.map(i => [i.campaign_id, i]));

  const productOf = new Map();
  const result = campaigns.map(camp => {
    const ins = insMap.get(camp.id) || {};
    const today = todayMap.get(camp.id) || {};
    const prod = detectProduct(camp.name);
    productOf.set(camp.id, prod.key);

    const spend = parseFloat(ins.spend || 0);
    const messages = extractMessages(ins.actions);
    const isRunning = camp.effective_status === 'ACTIVE';
    const cbo = parseInt(camp.daily_budget, 10) || 0;
    const expectedDailyBudget = isRunning ? (cbo > 0 ? cbo : (aboBudget.get(camp.id) || 0)) : 0;

    return {
      id: camp.id,
      name: camp.name,
      accountId: acc.numericId,
      accountName: acc.name,
      product: prod.key,
      productLabel: prod.label,
      status: camp.status,
      effective_status: camp.effective_status || camp.status,
      objective: camp.objective,
      budgetType: cbo > 0 ? 'CBO' : 'ABO',
      expectedDailyBudget,
      spend,
      impressions: parseInt(ins.impressions || 0, 10),
      reach: parseInt(ins.reach || 0, 10),
      clicks: parseInt(ins.clicks || 0, 10),
      ctr: parseFloat(ins.ctr || 0),
      cpc: parseFloat(ins.cpc || 0),
      cpm: parseFloat(ins.cpm || 0),
      frequency: parseFloat(ins.frequency || 0),
      messages,
      cpa: messages > 0 ? Math.round(spend / messages) : 0,
      todaySpend: parseFloat(today.spend || 0),
      todayMessages: extractMessages(today.actions)
    };
  });

  // Daily rows with campaign and account linkage
  const dailyRows = daily.map(d => ({
    campaignId: d.campaign_id,
    accountId: acc.numericId,
    product: productOf.get(d.campaign_id) || 'khac', // deleted campaigns → 'khac'
    date: d.date_start,
    spend: parseFloat(d.spend || 0),
    impressions: parseInt(d.impressions || 0, 10),
    clicks: parseInt(d.clicks || 0, 10),
    messages: extractMessages(d.actions)
  }));

  const placementRows = placements.map(p => ({
    campaignId: p.campaign_id,
    accountId: acc.numericId,
    product: productOf.get(p.campaign_id) || 'khac',
    platform: p.publisher_platform || 'unknown',
    spend: parseFloat(p.spend || 0),
    impressions: parseInt(p.impressions || 0, 10)
  }));

  return { campaigns: result, dailyRows, placementRows };
}

/** Aggregate rows into { productKey: [...] } maps. */
function groupDaily(rows) {
  const out = {};
  for (const r of rows) {
    const bucket = (out[r.product] ||= new Map());
    const item = bucket.get(r.date) || { date: r.date, spend: 0, impressions: 0, clicks: 0, messages: 0 };
    item.spend += r.spend; item.impressions += r.impressions; item.clicks += r.clicks; item.messages += r.messages;
    bucket.set(r.date, item);
  }
  return Object.fromEntries(Object.entries(out).map(([k, m]) =>
    [k, [...m.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}

function groupPlacements(rows) {
  const out = {};
  for (const r of rows) {
    const bucket = (out[r.product] ||= {});
    const item = bucket[r.platform] || { platform: r.platform, spend: 0, impressions: 0 };
    item.spend += r.spend; item.impressions += r.impressions;
    bucket[r.platform] = item;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.values(v)]));
}

/**
 * Full sync for the whole BM (accountId = 'ALL') or one account.
 * Returns the RAW report (format version 2) — see PROJECT_CONTEXT.md §7.
 */
export async function fetchRawReport(accountId = 'ALL', datePreset = 'last_30d') {
  if (!config.hasToken()) {
    throw new Error('Chưa cấu hình Access Token. Vui lòng bấm "Cài đặt Token".');
  }

  const bmAccounts = await getUserAdAccounts();
  if (bmAccounts.length === 0) {
    throw new Error(`Không tìm thấy tài khoản quảng cáo nào thuộc BM ${config.businessId}.`);
  }

  const isAll = !accountId || accountId === 'ALL';
  const targets = isAll ? bmAccounts : bmAccounts.filter(a => a.numericId === String(accountId).replace(/^act_/, ''));
  if (targets.length === 0) {
    throw new Error(`Tài khoản ${accountId} không thuộc BM ${config.businessId}.`);
  }

  console.log(`[Meta Ads API] Đang quét ${targets.length} tài khoản thuộc BM ${config.businessId} (${datePreset})...`);
  const started = Date.now();
  const accountResults = await mapWithConcurrency(targets, ACCOUNT_CONCURRENCY, acc => fetchAccountData(acc, datePreset));

  const campaigns = [], dailyRows = [], placementRows = [], warnings = [];
  for (const res of accountResults) {
    const n = normalizeAccount(res);
    campaigns.push(...n.campaigns);
    dailyRows.push(...n.dailyRows);
    placementRows.push(...n.placementRows);
    warnings.push(...res.warnings);
  }

  const scopeName = isAll
    ? `Toàn BM Ucmas Việt Nam (${bmAccounts.length} tài khoản)`
    : targets[0].name;

  console.log(`[Meta Ads API] Xong ${campaigns.length} chiến dịch trong ${((Date.now() - started) / 1000).toFixed(1)}s. Cảnh báo: ${warnings.length}`);

  return {
    version: 2,
    fetchedAt: new Date().toISOString(),
    datePreset,
    scope: { businessId: config.businessId, accountId: isAll ? 'ALL' : targets[0].numericId, name: scopeName, currency: targets[0].currency || 'VND' },
    bmAccounts,
    campaigns,
    dailyRecords: dailyRows,
    placementRecords: placementRows,
    dailyByProduct: groupDaily(dailyRows),
    placementsByProduct: groupPlacements(placementRows),
    warnings
  };
}

// Allow CLI execution: node src/meta-api.js  (npm run fetch)
if (process.argv[1] && process.argv[1].endsWith('meta-api.js')) {
  // No top-level await here: report.js imports this module (circular) — let evaluation finish first.
  Promise.all([import('./report.js'), import('./export-csv.js')])
    .then(async ([{ buildView }, { saveReportFiles }]) => {
      const raw = await fetchRawReport('ALL', 'last_30d');
      const view = buildView(raw, 'ALL');
      saveReportFiles(raw, view);
      const s = view.summary;
      console.log(`\n================ BÁO CÁO ${raw.scope.name} ================`);
      console.log(`Tổng chi tiêu: ${s.totalSpend.toLocaleString('vi-VN')} ₫ | Tin nhắn: ${s.totalMessages} | CPA: ${s.avgCpa.toLocaleString('vi-VN')} ₫`);
      console.log(`Ngân sách dự kiến hôm nay: ${s.expectedDailyBudget.toLocaleString('vi-VN')} ₫ | Đã chi hôm nay: ${s.todaySpend.toLocaleString('vi-VN')} ₫`);
      for (const p of view.products) {
        console.log(`👉 [${p.name}] ${p.count} CĐ | Chi ${p.spend.toLocaleString('vi-VN')} ₫ | ${p.messages} tin | CPA ${p.cpa.toLocaleString('vi-VN')} ₫ | NS/ngày ${p.expectedDailyBudget.toLocaleString('vi-VN')} ₫`);
      }
      if (raw.warnings.length) console.log('⚠️ Cảnh báo:', raw.warnings);
    })
    .catch(err => {
      console.error('[Meta Ads Lỗi]:', err.message);
      process.exit(1);
    });
}
