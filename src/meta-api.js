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
import { config, ROOT_DIR } from './config.js';

const ROOT_DIR_FOR_CLI = ROOT_DIR;
const BASE_URL = 'https://graph.facebook.com';
const MAX_PAGES = 50;              // safety cap per paginated request
const ACCOUNT_CONCURRENCY = 3;     // accounts processed in parallel (rate-limit friendly)

/**
 * SNAPSHOT_VERSION — phiên bản của data/latest_insights.json (dữ liệu hạt lựu).
 * VIEW_VERSION     — phiên bản của payload buildView() gửi cho client.
 *
 * Hai số này KHÁC nhau và tăng độc lập. Trước đây cả hai bị gọi lẫn là
 * "format version" với bốn giá trị khác nhau rải trong comment.
 */
export const SNAPSHOT_VERSION = 4;
export const SNAPSHOT_MIN_SUPPORTED = 2;

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
    if (val === undefined || val === null) continue;
    // Các tham số dạng object của Meta (time_range, filtering...) phải là JSON.
    // String({since,until}) cho ra "[object Object]" và Meta trả lỗi 100
    // "param time_range must be non-empty".
    url.searchParams.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
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

/**
 * Cắt [since, until] thành các cửa sổ theo từng tháng.
 *
 * Kéo nguyên một năm trong 1 request vẫn chạy, nhưng đo thực tế trên BM này:
 * cả năm = 3.593 dòng / 110,6s (~32 dòng/s, 8 trang), còn chia theo tháng
 * = ~56 dòng/s và mỗi tháng gọn trong 1 trang. Chia nhỏ vừa nhanh hơn vừa
 * tránh request quá lớn bị Meta trả lỗi "reduce the amount of data".
 */
export function monthChunks(since, until) {
  const chunks = [];
  if (!since || !until || since > until) return chunks;

  const pad = (n) => String(n).padStart(2, '0');
  let [y, m] = since.split('-').map(Number);

  while (true) {
    const monthStart = `${y}-${pad(m)}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${pad(m)}-${pad(lastDay)}`;

    chunks.push({
      since: monthStart < since ? since : monthStart,
      until: monthEnd > until ? until : monthEnd
    });

    if (monthEnd >= until) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return chunks;
}

/**
 * Ngày YYYY-MM-DD theo giờ Việt Nam (Asia/Ho_Chi_Minh, GMT+7).
 * Đặt ở đây chứ không ở report.js vì report.js đã import từ module này —
 * để ngược lại sẽ thành phụ thuộc vòng.
 */
export function getVietnamDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/** Cộng `days` vào một chuỗi YYYY-MM-DD. */
export function addDaysTo(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return next.toISOString().split('T')[0];
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
 * Split the conversions reported by Meta into two SEPARATE counters.
 *
 * `messages` is the business's primary KPI (messaging / lead generation) and is the only
 * thing CPA is computed from. Form leads and purchases are kept apart in
 * `otherConversions` — they used to be folded into the same number, which made CPA mean
 * different things on different campaigns while still being summed together.
 *
 * @returns {{ messages: number, otherConversions: number }}
 */
export function extractConversions(actions = []) {
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
  return {
    messages: messages || connections,
    otherConversions: Math.max(leads, purchases)
  };
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
async function fetchAccountData(acc, { since, until, onProgress }) {
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

  const chunks = monthChunks(since, until);

  const [campaigns, adsets, ads, recent, placements] = await Promise.all([
    safe('campaigns', callGraphApiAll(`${ep}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time', limit: 200
    })),
    safe('adsets', callGraphApiAll(`${ep}/adsets`, {
      fields: 'id,campaign_id,effective_status,daily_budget', limit: 500
    })),
    // Ad-level ids ONLY, to build the adId → campaignId lookup the CRM sheet needs.
    // The sheet's "Ad ID" column holds AD ids; without this map a lead can never be
    // attributed to the campaign that produced it.
    safe('ads', callGraphApiAll(`${ep}/ads`, {
      fields: 'id,campaign_id', limit: 500
    })),
    // Tần suất/reach CHỈ lấy cho cửa sổ 30 ngày gần nhất, không theo phạm vi kho dữ liệu.
    // Frequency của cả một năm vô nghĩa với việc phát hiện bão hoà creative, và reach
    // đã loại trùng nên không cộng hay chia nhỏ lại được.
    safe('insights_recent', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', date_preset: 'last_30d',
      fields: 'campaign_id,reach,frequency,cpc,cpm', limit: 500
    })),
    // Phân bổ nền tảng theo THÁNG để lọc được theo khoảng thời gian. Lấy theo ngày sẽ
    // nở ra gấp ~30 lần mà biểu đồ cũng không dùng tới mức chi tiết đó.
    safe('insights_placement', callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', time_range: { since, until }, time_increment: 'monthly',
      breakdowns: 'publisher_platform',
      fields: 'campaign_id,date_start,spend,impressions', limit: 500
    }))
  ]);

  // Số liệu theo ngày — chia theo tháng, chạy tuần tự để không dồn quá nhiều
  // request song song lên cùng một tài khoản (dễ dính rate limit).
  const daily = [];
  for (const c of chunks) {
    const rows = await safe(`insights_daily ${c.since.slice(0, 7)}`, callGraphApiAll(`${ep}/insights`, {
      level: 'campaign', time_range: { since: c.since, until: c.until }, time_increment: 1,
      fields: 'campaign_id,date_start,spend,impressions,clicks,actions', limit: 500
    }));
    daily.push(...rows);
    if (onProgress) onProgress(acc, c, rows.length);
  }

  return { acc, campaigns, adsets, ads, recent, daily, placements, warnings };
}

/** Merge one account's raw API rows into normalized campaign objects + aggregates. */
function normalizeAccount({ acc, campaigns, adsets, ads, recent, daily, placements }) {
  // ABO budget: sum daily_budget of ad sets that are REALLY delivering
  const aboBudget = new Map();
  for (const a of adsets) {
    if (a.effective_status === 'ACTIVE' && a.daily_budget) {
      aboBudget.set(a.campaign_id, (aboBudget.get(a.campaign_id) || 0) + (parseInt(a.daily_budget, 10) || 0));
    }
  }
  const recentMap = new Map(recent.map(i => [i.campaign_id, i]));

  const productOf = new Map();
  const result = campaigns.map(camp => {
    const r = recentMap.get(camp.id) || {};
    const prod = detectProduct(camp.name);
    productOf.set(camp.id, prod.key);

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
      // Chi tiêu / tin nhắn / hiển thị / click đều do report.js tính lại từ dailyRecords
      // theo đúng khoảng thời gian đang xem, nên không lưu bản tổng ở đây nữa.
      // Tần suất của 30 NGÀY GẦN NHẤT, không phải của phạm vi kho dữ liệu.
      // Đây là cửa sổ duy nhất mà chỉ số này có ý nghĩa để phát hiện bão hoà creative.
      frequency: parseFloat(r.frequency || 0)
    };
  });

  // adId → campaignId, restricted to campaigns that really exist in this account.
  const adMap = {};
  for (const ad of ads) {
    if (ad.id && ad.campaign_id) adMap[ad.id] = ad.campaign_id;
  }

  // Daily rows with campaign and account linkage
  const dailyRows = daily.map(d => {
    const { messages, otherConversions } = extractConversions(d.actions);
    return {
      campaignId: d.campaign_id,
      accountId: acc.numericId,
      product: productOf.get(d.campaign_id) || 'khac', // deleted campaigns → 'khac'
      date: d.date_start,
      spend: parseFloat(d.spend || 0),
      impressions: parseInt(d.impressions || 0, 10),
      clicks: parseInt(d.clicks || 0, 10),
      messages,
      otherConversions
    };
  });

  const placementRows = placements.map(p => ({
    campaignId: p.campaign_id,
    accountId: acc.numericId,
    product: productOf.get(p.campaign_id) || 'khac',
    platform: p.publisher_platform || 'unknown',
    // Gom theo tháng (YYYY-MM) để report.js lọc được theo khoảng thời gian đang chọn.
    month: String(p.date_start || '').slice(0, 7),
    spend: parseFloat(p.spend || 0),
    impressions: parseInt(p.impressions || 0, 10)
  }));

  return { campaigns: result, dailyRows, placementRows, adMap };
}

/**
 * Full sync for the whole BM (accountId = 'ALL') or one account.
 * Returns the RAW report (snapshot schema v4) — see PROJECT_CONTEXT.md §7.
 */
export async function fetchRawReport(accountId = 'ALL', options = {}) {
  if (!config.hasToken()) {
    throw new Error('Chưa cấu hình Access Token. Vui lòng bấm "Cài đặt Token".');
  }

  const previous = options.previous || null;
  const todayStr = getVietnamDateString();
  const targetSince = options.since || config.syncStartDate;
  const targetUntil = options.until || todayStr;

  // Quyết định kéo toàn bộ hay chỉ phần mới.
  const plan = planSync(previous, targetSince, targetUntil);

  const bmAccounts = await getUserAdAccounts();
  if (bmAccounts.length === 0) {
    throw new Error(`Không tìm thấy tài khoản quảng cáo nào thuộc BM ${config.businessId}.`);
  }

  const isAll = !accountId || accountId === 'ALL';
  const targets = isAll ? bmAccounts : bmAccounts.filter(a => a.numericId === String(accountId).replace(/^act_/, ''));
  if (targets.length === 0) {
    throw new Error(`Tài khoản ${accountId} không thuộc BM ${config.businessId}.`);
  }

  const nMonths = monthChunks(plan.fetchSince, plan.fetchUntil).length;
  console.log(
    `[Meta Ads API] ${plan.mode === 'full' ? 'Kéo TOÀN BỘ' : 'Cập nhật phần mới'}: ` +
    `${plan.fetchSince} → ${plan.fetchUntil} (${nMonths} tháng) × ${targets.length} tài khoản...`
  );
  if (plan.mode === 'full' && nMonths > 2) {
    console.log(`[Meta Ads API] Lần đầu kéo nhiều dữ liệu, có thể mất vài phút. Các lần sau sẽ nhanh.`);
  }

  const started = Date.now();
  let done = 0;
  const onProgress = (acc, chunk) => {
    done += 1;
    process.stdout.write(`\r  ...${done}/${targets.length * nMonths} khối (${acc.name} ${chunk.since.slice(0, 7)})     `);
  };

  const accountResults = await mapWithConcurrency(targets, ACCOUNT_CONCURRENCY,
    acc => fetchAccountData(acc, { since: plan.fetchSince, until: plan.fetchUntil, onProgress }));
  process.stdout.write('\r' + ' '.repeat(70) + '\r');

  const campaigns = [], freshDaily = [], freshPlacements = [], warnings = [];
  const adMap = {};
  for (const res of accountResults) {
    const n = normalizeAccount(res);
    campaigns.push(...n.campaigns);
    freshDaily.push(...n.dailyRows);
    freshPlacements.push(...n.placementRows);
    Object.assign(adMap, n.adMap);
    warnings.push(...res.warnings);
  }

  // Gộp với dữ liệu cũ: giữ phần trước `fetchSince`, thay toàn bộ phần từ đó trở đi.
  const dailyRows = mergeByDate(previous?.dailyRecords, freshDaily, plan.fetchSince, r => r.date);
  const placementRows = mergeByDate(
    previous?.placementRecords, freshPlacements, plan.fetchSince.slice(0, 7), r => r.month
  );

  const scopeName = isAll
    ? `Toàn BM Ucmas Việt Nam (${bmAccounts.length} tài khoản)`
    : targets[0].name;

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[Meta Ads API] Xong ${campaigns.length} chiến dịch, ${Object.keys(adMap).length} quảng cáo, ` +
    `${freshDaily.length} dòng mới (tổng ${dailyRows.length}) trong ${secs}s. Cảnh báo: ${warnings.length}`
  );

  return {
    version: SNAPSHOT_VERSION,
    fetchedAt: new Date().toISOString(),
    /** Khoảng thời gian kho dữ liệu THỰC SỰ chứa. report.js cảnh báo nếu xem ra ngoài. */
    coverage: { since: targetSince, until: targetUntil },
    lastSync: { mode: plan.mode, since: plan.fetchSince, until: plan.fetchUntil, seconds: Number(secs), newRows: freshDaily.length },
    /** Tần suất/reach luôn là của 30 ngày gần nhất, độc lập với `coverage`. */
    frequencyWindow: 'last_30d',
    scope: { businessId: config.businessId, accountId: isAll ? 'ALL' : targets[0].numericId, name: scopeName, currency: targets[0].currency || 'VND' },
    bmAccounts,
    campaigns,
    /** adId → campaignId, để quy kết lead từ Google Sheet CRM về đúng chiến dịch. */
    adMap,
    dailyRecords: dailyRows,
    placementRecords: placementRows,
    warnings
  };
}

/**
 * Quyết định lần đồng bộ này phải kéo khoảng nào.
 *
 * - Chưa có dữ liệu, hoặc kho cũ bắt đầu MUỘN hơn mốc cần → kéo toàn bộ.
 * - Đã có đủ → chỉ kéo từ (ngày cuối của kho − retroDays) tới hôm nay.
 *   Lùi lại `retroDays` vì Meta còn ghi nhận chuyển đổi cho các ngày vừa qua
 *   (cửa sổ quy kết 7 ngày); chỉ lấy ngày mới sẽ bỏ sót phần đó.
 */
export function planSync(previous, targetSince, targetUntil, retroDays = config.retroDays) {
  const cov = previous?.coverage;
  const hasUsableCoverage =
    previous &&
    Array.isArray(previous.dailyRecords) && previous.dailyRecords.length > 0 &&
    cov?.since && cov?.until &&
    cov.since <= targetSince;

  if (!hasUsableCoverage) {
    return { mode: 'full', fetchSince: targetSince, fetchUntil: targetUntil };
  }

  let fetchSince = addDaysTo(cov.until, -retroDays + 1);
  if (fetchSince < targetSince) fetchSince = targetSince;
  if (fetchSince > targetUntil) fetchSince = targetUntil;

  return { mode: 'incremental', fetchSince, fetchUntil: targetUntil };
}

/**
 * Giữ bản ghi cũ TRƯỚC `fromKey`, thay toàn bộ từ `fromKey` trở đi bằng bản ghi mới.
 * Thay vì cộng dồn, vì Meta có thể sửa lại số của những ngày đã qua.
 */
export function mergeByDate(previousRows, freshRows, fromKey, keyOf) {
  const kept = (previousRows || []).filter(r => keyOf(r) && keyOf(r) < fromKey);
  return [...kept, ...freshRows];
}

// Allow CLI execution: node src/meta-api.js  (npm run fetch)
// Cờ --full ép kéo lại toàn bộ kho dữ liệu thay vì chỉ phần mới.
if (process.argv[1] && process.argv[1].endsWith('meta-api.js')) {
  // No top-level await here: report.js imports this module (circular) — let evaluation finish first.
  Promise.all([import('./report.js'), import('./export-csv.js'), import('fs'), import('path')])
    .then(async ([{ buildView }, { saveReportFiles }, fs, path]) => {
      const forceFull = process.argv.includes('--full');
      const snapPath = path.default.resolve(ROOT_DIR_FOR_CLI, 'data', 'latest_insights.json');

      // Nạp snapshot cũ để đồng bộ gia tăng (trừ khi chạy với --full).
      let previous = null;
      if (!forceFull && fs.default.existsSync(snapPath)) {
        try {
          previous = JSON.parse(fs.default.readFileSync(snapPath, 'utf-8'));
        } catch { previous = null; }
      }

      const raw = await fetchRawReport('ALL', { previous });
      const view = buildView(raw, 'ALL');
      saveReportFiles(raw, view);
      const s = view.summary;
      console.log(`\n================ BÁO CÁO ${raw.scope.name} ================`);
      console.log(`Kho dữ liệu: ${raw.coverage.since} → ${raw.coverage.until} | ${raw.dailyRecords.length.toLocaleString('vi-VN')} dòng theo ngày`);
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
