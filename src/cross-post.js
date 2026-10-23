/**
 * Cross-Post & Creative Replication Module
 * 
 * Cho phép:
 * 1. Sao chép bài đăng từ 1 Fanpage và đăng lên nhiều Fanpage khác.
 * 2. Sao chép quảng cáo (Ad/Creative) sang các AdSet/Account khác với trạng thái mặc định PAUSED.
 * 
 * Hoàn toàn tách biệt với logic Dashboard Phân tích Ads.
 */

import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const crossPostRouter = express.Router();

/**
 * server.js bơm hàm đọc rawReport vào đây khi khởi động (P-05).
 * Tránh đọc + parse lại 2 MB JSON (14,7 ms) cho dữ liệu đã nằm trong RAM.
 */
let getRawReport = () => null;
export function setRawReportProvider(fn) { getRawReport = fn; }

/**
 * Các việc tạo hàng loạt chạy 30–60 s. Giữ trạng thái ở server để client hỏi
 * được tiến độ, và để kết quả không mất khi rớt kết nối giữa đường (F-04).
 * Job tự hết hạn sau 1 giờ để Map không phình mãi.
 */
const jobs = new Map();
const JOB_TTL_MS = 3600000;

function newJob(total, extra = {}) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    status: 'running', done: 0, total,
    results: [], error: null, at: Date.now(),
    ...extra
  });
  for (const [k, v] of jobs) if (Date.now() - v.at > JOB_TTL_MS) jobs.delete(k);
  return id;
}

crossPostRouter.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Không tìm thấy tiến trình (có thể đã hết hạn).' });
  res.json({ ok: true, ...job });
});

const BASE_URL = 'https://graph.facebook.com';
const API_VERSION = config.apiVersion || 'v21.0';

/**
 * Giới hạn chống spam API Meta. Đây là những con số BẢO VỆ TÀI KHOẢN QUẢNG CÁO —
 * đừng đổi mà không có lý do nghiệp vụ, và có test khoá lại từng con số.
 */
export const SAFETY_LIMITS = {
  PUBLISH_MAX_PAGES:     10,
  BULK_REPLICATE_MAX:    10,
  BATCH_ADS_MAX:         15,
  ANALYZE_CAMPAIGNS_MAX: 20,
  DELAY_PUBLISH_MS:      1500,
  DELAY_CREATE_MS:       2000,
  DELAY_TARGET_MS:       2500,

  // ---------------------------------------------------------------
  // Engine build-structure (tab 2 "tạo mới hàng loạt" + tab 3 "đăng
  // vào CĐ/nhóm có sẵn"). Chốt với chủ dự án 23/10/2026:
  //   • 1 tài khoản quảng cáo / 1 đợt
  //   • tối đa 15 chiến dịch, 3 nhóm mỗi chiến dịch
  // Trần 195 đối tượng ≈ 7 phút chạy — đừng nâng mà không đo lại thời gian.
  // ---------------------------------------------------------------
  BUILD_MAX_NEW_CAMPAIGNS:       15,
  BUILD_MAX_ADSETS_PER_CAMPAIGN: 3,
  BUILD_MAX_NEW_ADSETS:          45,   // 15 × 3
  BUILD_MAX_TARGETS:             45,   // tổng nhóm đích (mới + có sẵn)
  BUILD_MAX_CONTENTS:            12,
  BUILD_MAX_ADS:                 135,  // 45 nhóm × 3 nội dung — TRẦN CỨNG
  BUILD_MAX_OBJECTS:             195,  // CĐ + nhóm + ad

  DELAY_BUILD_CAMPAIGN_MS:  2500,
  DELAY_BUILD_ADSET_MS:     2500,
  DELAY_BUILD_CREATIVE_MS:  1200,
  DELAY_BUILD_AD_MS:        2000,

  UPLOAD_IMAGE_MAX_BYTES: 8 * 1024 * 1024
};

/**
 * Suy ra cờ "bản nháp" cho 1 chiến dịch.
 *
 * Marketing API KHÔNG có status DRAFT — effective_status chỉ có
 * ACTIVE | PAUSED | DELETED | ARCHIVED | IN_PROCESS | WITH_ISSUES
 * (xem docs Campaign Reference v21.0). Nên "nháp" được định nghĩa theo
 * nghiệp vụ: chiến dịch tồn tại nhưng CHƯA có quảng cáo nào, hoặc đang
 * IN_PROCESS / WITH_ISSUES. Đây đúng là tập hợp mà Ads Manager gắn nhãn "Draft".
 *
 * Bản nháp còn nằm trong TRÌNH TẠO của Ads Manager (chưa sinh object) thì
 * không có endpoint nào đọc được — không cố đoán, trả isDraft:false.
 */
export function classifyCampaignDraft(c = {}) {
  const adsCount    = c.ads?.summary?.total_count ?? null;
  const adsetsCount = c.adsets?.summary?.total_count ?? null;
  const es = c.effective_status;

  if (es === 'IN_PROCESS')  return { isDraft: true,  reason: 'in_process' };
  if (es === 'WITH_ISSUES') return { isDraft: true,  reason: 'with_issues' };
  if (adsCount === 0)       return { isDraft: true,  reason: adsetsCount === 0 ? 'no_adset' : 'no_ad' };
  return { isDraft: false, reason: null };
}

/** Các trạng thái được phép truyền vào query ?statuses= */
const CAMPAIGN_STATUS_WHITELIST = new Set([
  'ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'
]);

/**
 * Chuẩn hoá query của route campaigns. Giữ TƯƠNG THÍCH NGƯỢC:
 * không truyền gì → đúng hành vi cũ ['ACTIVE','PAUSED'], tab 2 không bị ảnh hưởng.
 */
export function parseCampaignQuery(q = {}) {
  let statuses;
  if (!q.statuses) {
    statuses = ['ACTIVE', 'PAUSED'];
  } else if (String(q.statuses).toLowerCase() === 'all') {
    statuses = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];
  } else {
    statuses = String(q.statuses).split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => CAMPAIGN_STATUS_WHITELIST.has(s));
    if (statuses.length === 0) statuses = ['ACTIVE', 'PAUSED'];
  }
  if (String(q.includeArchived) === '1' && !statuses.includes('ARCHIVED')) {
    statuses.push('ARCHIVED');
  }

  const rawLimit = Number(q.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  return { statuses, limit, withDraftFlag: String(q.withDraftFlag) === '1' };
}

/** Meta campaign object → shape client dùng. Không bịa trường nào không có thật. */
export function normalizeCampaign(c = {}) {
  const { isDraft, reason } = classifyCampaignDraft(c);
  const daily = Number(c.daily_budget || 0);
  return {
    id: c.id,
    name: c.name || '(không tên)',
    objective: c.objective || '',
    status: c.status || '',
    effective_status: c.effective_status || '',
    dailyBudget: daily,
    lifetimeBudget: Number(c.lifetime_budget || 0),
    hasCbo: daily > 0 || Number(c.lifetime_budget || 0) > 0,
    adsetsCount: c.adsets?.summary?.total_count ?? null,
    adsCount:    c.ads?.summary?.total_count ?? null,
    isDraft,
    draftReason: reason,
    createdTime: c.created_time || null
  };
}

/** Meta adset object → shape client dùng, kèm pageId đã suy ra sẵn. */
export function normalizeAdset(a = {}) {
  return {
    id: a.id,
    name: a.name || '(không tên)',
    campaignId: a.campaign_id || '',
    status: a.status || '',
    effective_status: a.effective_status || '',
    dailyBudget: Number(a.daily_budget || 0),
    optimizationGoal: a.optimization_goal || '',
    destinationType: a.destination_type || '',
    pageId: a.promoted_object?.page_id || ''
  };
}

/**
 * Ưu tiên page của CHÍNH nhóm đích (promoted_object.page_id).
 * Creative gắn page khác page nhóm đích là nguồn lỗi "page mismatch" khó đoán.
 */
export function resolvePageIdForTarget(adset = {}, fallbackPageId = '') {
  const pid = adset.pageId || adset.promoted_object?.page_id || fallbackPageId;
  if (!pid) {
    throw new Error(`Nhóm "${adset.name || adset.id}" không xác định được Fanpage đích.`);
  }
  return String(pid);
}


const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PAGES_CACHE_FILE = join(DATA_DIR, 'cp_pages_cache.json');
const ACCOUNTS_CACHE_FILE = join(DATA_DIR, 'cp_accounts_cache.json');

/**
 * Cache lưu trữ Page Access Tokens trong RAM.
 * Key: pageId -> Value: { id, name, category, fanCount, pictureUrl, accessToken }
 * KHÔNG BAO GIỜ gửi accessToken về client frontend.
 * Được lưu xuống disk và nạp lại khi khởi động server.
 */
const pageCache = new Map();

/** Ad accounts cache (RAM + disk) */
let adAccountsCache = [];
/** Timestamp (ms) khi cache được cập nhật lần cuối */
let cacheUpdatedAt = 0;

// --- Disk persistence helpers ---
function loadCacheFromDisk() {
  try {
    if (existsSync(PAGES_CACHE_FILE)) {
      const raw = JSON.parse(readFileSync(PAGES_CACHE_FILE, 'utf8'));
      if (raw.pages && Array.isArray(raw.pages)) {
        pageCache.clear();
        raw.pages.forEach(p => pageCache.set(p.id, p));
        cacheUpdatedAt = raw.updatedAt || 0;
        console.log(`[CrossPost] Nạp cache ${pageCache.size} Fanpage từ disk.`);
      }
    }
  } catch (e) { console.warn('[CrossPost] Không đọc được pages cache:', e.message); }

  try {
    if (existsSync(ACCOUNTS_CACHE_FILE)) {
      const raw = JSON.parse(readFileSync(ACCOUNTS_CACHE_FILE, 'utf8'));
      if (raw.accounts && Array.isArray(raw.accounts)) {
        adAccountsCache = raw.accounts;
        console.log(`[CrossPost] Nạp cache ${adAccountsCache.length} Ad Accounts từ disk.`);
      }
    }
  } catch (e) { console.warn('[CrossPost] Không đọc được accounts cache:', e.message); }
}

function savePagesCache() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Lưu tất cả fields NGOẠI TRỪ accessToken (bảo mật)
    const safeCopy = [];
    for (const [, p] of pageCache) {
      safeCopy.push({ ...p, accessToken: '***' });
    }
    writeFileSync(PAGES_CACHE_FILE, JSON.stringify({
      updatedAt: cacheUpdatedAt,
      updatedAtHuman: new Date(cacheUpdatedAt).toLocaleString('vi-VN'),
      pages: safeCopy
    }, null, 2), 'utf8');
  } catch (e) { console.warn('[CrossPost] Không ghi được pages cache:', e.message); }
}

function saveAccountsCache() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ACCOUNTS_CACHE_FILE, JSON.stringify({
      updatedAt: cacheUpdatedAt,
      updatedAtHuman: new Date(cacheUpdatedAt).toLocaleString('vi-VN'),
      accounts: adAccountsCache
    }, null, 2), 'utf8');
  } catch (e) { console.warn('[CrossPost] Không ghi được accounts cache:', e.message); }
}

// Load cache ngay khi module được import
loadCacheFromDisk();

/**
 * Đảm bảo các Fanpage trong cache có Access Token thực trong RAM (không phải '***' hoặc rỗng).
 * Vì disk cache chỉ lưu metadata (không lưu token để bảo mật), khi cần gọi hành động đăng bài/nhân bản,
 * hàm này sẽ tự động nạp token đầy đủ từ Meta API nếu chưa có.
 */
async function ensurePageTokens() {
  const needsRefresh = pageCache.size === 0 || Array.from(pageCache.values()).some(p => !p.accessToken || p.accessToken === '***');
  if (needsRefresh) {
    console.log('[CrossPost] Nạp Page Access Tokens từ Meta API vào RAM...');
    await fetchAndCachePages();
  }
}

/**
 * Helper gọi Meta Graph API với timeout và kiểm soát lỗi
 */
async function callMeta(endpoint, { method = 'GET', params = {}, body = null, token = null } = {}) {
  const accessToken = token || config.accessToken;
  if (!accessToken) {
    throw new Error('Chưa cấu hình Access Token trong hệ thống.');
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = new URL(`${BASE_URL}/${API_VERSION}/${cleanEndpoint}`);

  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      searchParams.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }

  const headers = {};
  let reqBody = undefined;

  if (method === 'GET') {
    searchParams.append('access_token', accessToken);
    url.search = searchParams.toString();
  } else {
    // Với POST / DELETE: có thể gửi form-urlencoded hoặc JSON
    headers['Content-Type'] = 'application/json';
    const payload = { ...(body || {}) };
    // Thêm token vào payload
    payload.access_token = accessToken;
    reqBody = JSON.stringify(payload);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: reqBody,
      signal: controller.signal
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      const err = data.error || {};
      const msg = err.error_user_msg || err.message || `Lỗi Meta Graph API (HTTP ${res.status})`;
      const errorObj = new Error(msg);
      errorObj.code = err.code;
      errorObj.subcode = err.error_subcode;
      errorObj.type = err.type;
      throw errorObj;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Kết nối Meta API bị timeout sau 35s (${endpoint})`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Lấy danh sách Fanpage có quyền quản lý và cập nhật cache token
 */
async function fetchAndCachePages() {
  const result = await callMeta('/me/accounts', {
    params: {
      fields: 'id,name,category,access_token,fan_count,picture{url},tasks,verification_status',
      limit: 100
    }
  });

  const pages = result.data || [];
  pageCache.clear();

  for (const p of pages) {
    pageCache.set(p.id, {
      id: p.id,
      name: p.name,
      category: p.category,
      fanCount: p.fan_count || 0,
      pictureUrl: p.picture?.data?.url || '',
      tasks: p.tasks || [],
      accessToken: p.access_token
    });
  }

  cacheUpdatedAt = Date.now();
  savePagesCache();

  // Fetch ad accounts cùng lúc
  try {
    const accResult = await callMeta('me/adaccounts', {
      params: { fields: 'id,account_id,name,account_status,currency', limit: 100 }
    });
    adAccountsCache = (accResult.data || []).map(a => ({
      id: a.id,
      accountId: a.account_id || a.id.replace(/^act_/, ''),
      name: a.name,
      status: a.account_status,
      currency: a.currency || 'VND'
    }));
    saveAccountsCache();
    console.log(`[CrossPost] Cache cập nhật: ${pageCache.size} pages, ${adAccountsCache.length} ad accounts.`);
  } catch (e) {
    console.warn('[CrossPost] Lỗi lấy ad accounts:', e.message);
  }

  return pages.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    fanCount: p.fan_count || 0,
    pictureUrl: p.picture?.data?.url || '',
    canPost: Boolean(p.access_token)
  }));
}

// -------------------------------------------------------------
// ROUTES: FANPAGE POSTS & CROSS-POSTING
// -------------------------------------------------------------

/**
 * GET /api/cp/pages
 * Danh sách Fanpage người dùng có quyền quản trị
 */
crossPostRouter.get('/pages', async (req, res) => {
  try {
    // Dùng cache nếu có, chỉ fetch mới khi cache rỗng
    if (pageCache.size > 0) {
      const pages = [];
      for (const [, p] of pageCache) {
        pages.push({ id: p.id, name: p.name, category: p.category, fanCount: p.fanCount, pictureUrl: p.pictureUrl, canPost: Boolean(p.accessToken && p.accessToken !== '***') });
      }
      return res.json({
        ok: true, pages, fromCache: true,
        cacheAge: cacheUpdatedAt ? `${Math.round((Date.now() - cacheUpdatedAt) / 60000)} phút trước` : 'N/A'
      });
    }
    const pages = await fetchAndCachePages();
    res.json({ ok: true, pages, fromCache: false });
  } catch (err) {
    console.error('[CrossPost] Lỗi lấy danh sách Fanpage:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cp/refresh-cache
 * Làm mới cache (pages + ad accounts) — gọi khi phân quyền thêm
 */
crossPostRouter.post('/refresh-cache', async (req, res) => {
  try {
    const pages = await fetchAndCachePages();
    res.json({
      ok: true,
      message: `Đã làm mới: ${pages.length} Fanpage, ${adAccountsCache.length} Ad Accounts`,
      pages,
      adAccounts: adAccountsCache,
      updatedAt: new Date(cacheUpdatedAt).toLocaleString('vi-VN')
    });
  } catch (err) {
    console.error('[CrossPost] Lỗi làm mới cache:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cp/ad-accounts
 * Trả về danh sách ad accounts (từ cache hoặc tự làm mới nếu rỗng)
 */
crossPostRouter.get('/ad-accounts', async (req, res) => {
  try {
    if (adAccountsCache.length === 0) await fetchAndCachePages();
    res.json({
      ok: true,
      accounts: adAccountsCache,
      cacheAge: cacheUpdatedAt ? `${Math.round((Date.now() - cacheUpdatedAt) / 60000)} phút trước` : 'Chưa có'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cp/pages/:pageId/posts
 * Lấy các bài đăng gần đây của một Fanpage nguồn
 */
crossPostRouter.get('/pages/:pageId/posts', async (req, res) => {
  const { pageId } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 50);

  try {
    // Đảm bảo token fanpage đã có trong RAM
    await ensurePageTokens();
    const pageInfo = pageCache.get(pageId);

    if (!pageInfo || !pageInfo.accessToken) {
      return res.status(403).json({
        ok: false,
        error: `Không có Page Access Token cho Fanpage ID ${pageId}`
      });
    }

    const fields = [
      'id',
      'message',
      'story',
      'created_time',
      'full_picture',
      'permalink_url',
      'shares',
      'reactions.summary(true)',
      'comments.summary(true)',
      'attachments{media_type,type,url,media,subattachments,title,description}'
    ].join(',');

    const result = await callMeta(`/${pageId}/posts`, {
      token: pageInfo.accessToken,
      params: { fields, limit }
    });

    const posts = (result.data || []).map(p => {
      // Chuẩn hoá attachment hình ảnh/video nếu có
      let mediaType = 'text';
      let mediaUrl = p.full_picture || '';
      let subMedia = [];

      const attach = p.attachments?.data?.[0];
      if (attach) {
        mediaType = attach.media_type || attach.type || 'text';
        if (attach.media?.image?.src) {
          mediaUrl = attach.media.image.src;
        }
        if (attach.subattachments?.data) {
          subMedia = attach.subattachments.data.map(sub => sub.media?.image?.src || '').filter(Boolean);
        }
      }

      return {
        id: p.id,
        message: p.message || p.story || '',
        createdTime: p.created_time,
        fullPicture: mediaUrl || p.full_picture || '',
        permalinkUrl: p.permalink_url,
        mediaType,
        subMedia,
        reactionsCount: p.reactions?.summary?.total_count || 0,
        commentsCount: p.comments?.summary?.total_count || 0,
        sharesCount: p.shares?.count || 0
      };
    });

    res.json({ ok: true, posts, pageName: pageInfo.name });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy bài đăng của trang ${pageId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Chặn chạy trùng theo tên việc.
 *
 * Các route này tạo đối tượng THẬT trên Meta và mất 20–60 s mới trả lời, nên
 * người dùng rất dễ bấm lại nút Thực thi — và tạo gấp đôi mọi thứ.
 *
 * Dùng res.on('finish'/'close') chứ không dùng try/finally trong handler: nếu
 * client đóng kết nối giữa đường, 'close' vẫn bắn và chốt được nhả ra.
 */
const running = new Set();
export function withLock(jobName) {
  return (req, res, next) => {
    if (running.has(jobName)) {
      return res.status(429).json({
        ok: false,
        error: 'Lệnh trước chưa xong. Đợi hoàn tất rồi thử lại để tránh tạo trùng.'
      });
    }
    running.add(jobName);
    const release = () => running.delete(jobName);
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/**
 * POST /api/cp/publish
 * Đăng bài đồng loạt lên nhiều Fanpage đích
 * Body: { targetPageIds: string[], message: string, imageUrl?: string, link?: string }
 */
crossPostRouter.post('/publish', withLock('publish'), async (req, res) => {
  const { targetPageIds, message, imageUrl, link } = req.body;

  if (!Array.isArray(targetPageIds) || targetPageIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Vui lòng chọn ít nhất 1 Fanpage đích.' });
  }

  if (targetPageIds.length > SAFETY_LIMITS.PUBLISH_MAX_PAGES) {
    return res.status(400).json({ ok: false, error: `Mỗi lần đăng tối đa ${SAFETY_LIMITS.PUBLISH_MAX_PAGES} Fanpage để đảm bảo an toàn tốc độ API.` });
  }

  if (!message && !imageUrl && !link) {
    return res.status(400).json({ ok: false, error: 'Nội dung bài đăng không được để trống (cần có văn bản hoặc hình ảnh/liên kết).' });
  }

  // Đảm bảo token fanpage đã có trong RAM
  await ensurePageTokens();

  const results = [];

  for (let i = 0; i < targetPageIds.length; i++) {
    const targetId = targetPageIds[i];
    const pageInfo = pageCache.get(targetId);

    if (!pageInfo || !pageInfo.accessToken) {
      results.push({
        pageId: targetId,
        pageName: pageInfo?.name || targetId,
        success: false,
        error: 'Không tìm thấy Access Token của Fanpage này.'
      });
      continue;
    }

    try {
      let publishedPost;

      if (imageUrl && imageUrl.trim()) {
        // Đăng dạng Photo
        publishedPost = await callMeta(`/${targetId}/photos`, {
          method: 'POST',
          token: pageInfo.accessToken,
          body: {
            url: imageUrl.trim(),
            caption: message || ''
          }
        });
      } else {
        // Đăng dạng Feed (văn bản hoặc link)
        const feedBody = {
          message: message || ''
        };
        if (link && link.trim()) {
          feedBody.link = link.trim();
        }

        publishedPost = await callMeta(`/${targetId}/feed`, {
          method: 'POST',
          token: pageInfo.accessToken,
          body: feedBody
        });
      }

      results.push({
        pageId: targetId,
        pageName: pageInfo.name,
        success: true,
        postId: publishedPost.id || publishedPost.post_id
      });
    } catch (err) {
      console.error(`[CrossPost] Lỗi khi đăng lên ${pageInfo.name} (${targetId}):`, err.message);
      results.push({
        pageId: targetId,
        pageName: pageInfo.name,
        success: false,
        error: err.message
      });
    }

    // Delay giữa các page để tránh trigger spam protection của Meta
    if (i < targetPageIds.length - 1) {
      await new Promise(r => setTimeout(r, SAFETY_LIMITS.DELAY_PUBLISH_MS));
    }
  }

  const totalSuccess = results.filter(r => r.success).length;
  res.json({
    ok: true,
    summary: {
      total: targetPageIds.length,
      success: totalSuccess,
      failed: targetPageIds.length - totalSuccess
    },
    results
  });
});

// -------------------------------------------------------------
// ROUTES: AD ACCOUNTS & AD CREATIVE REPLICATION (PHASE 2)
// -------------------------------------------------------------

/**
 * GET /api/cp/ad-accounts/:accountId/campaigns
 * Danh sách chiến dịch của 1 tài khoản.
 *
 * Query (tất cả TUỲ CHỌN — không truyền gì thì hành vi y như trước 23/10/2026):
 *   statuses=ACTIVE,PAUSED | all     (all = + IN_PROCESS, WITH_ISSUES → lấy được CĐ nháp)
 *   includeArchived=1
 *   withDraftFlag=1                  (đếm adset/ad bằng summary để suy ra cờ nháp)
 *   limit=1..200
 */
crossPostRouter.get('/ad-accounts/:accountId/campaigns', async (req, res) => {
  const cleanId = req.params.accountId.replace(/^act_/, '');
  const { statuses, limit, withDraftFlag } = parseCampaignQuery(req.query);

  const fields = [
    'id', 'name', 'objective', 'status', 'effective_status',
    'created_time', 'daily_budget', 'lifetime_budget'
  ];
  // Field expansion + summary: đếm adset/ad ngay trong 1 request, thay vì
  // bắn thêm 1 request cho MỖI chiến dịch (18 CĐ = 18 request → 1 request).
  if (withDraftFlag) {
    fields.push('adsets.limit(0).summary(total_count)');
    fields.push('ads.limit(0).summary(total_count)');
  }

  try {
    const result = await callMeta(`/act_${cleanId}/campaigns`, {
      params: {
        fields: fields.join(','),
        effective_status: JSON.stringify(statuses).replace(/"/g, "'"),
        limit
      }
    });

    const campaigns = (result.data || []).map(normalizeCampaign);
    const counts = {
      total:  campaigns.length,
      draft:  campaigns.filter(c => c.isDraft).length,
      active: campaigns.filter(c => c.effective_status === 'ACTIVE').length,
      paused: campaigns.filter(c => c.effective_status === 'PAUSED').length
    };

    res.json({
      ok: true,
      campaigns,
      counts,
      notice: withDraftFlag
        ? 'Chỉ nạp được chiến dịch nháp đã tồn tại trên Meta. Bản nháp còn nằm trong trình tạo Ads Manager thì API không đọc được.'
        : undefined
    });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy chiến dịch act_${cleanId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cp/ad-accounts/:accountId/adsets?campaignIds=120x,120y
 * Lấy nhóm quảng cáo của NHIỀU chiến dịch bằng 1 request (filtering campaign.id IN).
 *
 * Route /campaigns/:campaignId/adsets vẫn giữ nguyên cho tab 2 — không xoá.
 */
crossPostRouter.get('/ad-accounts/:accountId/adsets', async (req, res) => {
  const cleanId = req.params.accountId.replace(/^act_/, '');
  const campaignIds = String(req.query.campaignIds || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (campaignIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Thiếu campaignIds.' });
  }
  if (campaignIds.length > 50) {
    return res.status(400).json({ ok: false, error: 'Tối đa 50 chiến dịch mỗi lần (giới hạn filtering IN của Meta).' });
  }

  const fields = 'id,name,campaign_id,status,effective_status,daily_budget,' +
                 'optimization_goal,billing_event,destination_type,' +
                 'promoted_object{page_id,application_id}';

  try {
    const result = await callMeta(`/act_${cleanId}/adsets`, {
      params: {
        fields,
        filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
        limit: 200
      }
    });
    return res.json({ ok: true, adsets: (result.data || []).map(normalizeAdset), fallback: false });
  } catch (err) {
    // Một số loại tài khoản từ chối filtering campaign.id IN → gọi từng chiến dịch.
    // Phải ghi log rõ là đã fallback (rule §4: nói rõ giới hạn dữ liệu).
    console.warn(`[CrossPost] filtering IN thất bại trên act_${cleanId} (${err.message}) → fallback gọi từng chiến dịch.`);
    try {
      const all = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < campaignIds.length; i += CONCURRENCY) {
        const chunk = campaignIds.slice(i, i + CONCURRENCY);
        const parts = await Promise.all(chunk.map(cid =>
          callMeta(`/${cid}/adsets`, { params: { fields, limit: 100 } })
            .then(r => r.data || [])
            .catch(e => { console.error(`[CrossPost] Lỗi adsets CĐ ${cid}: ${e.message}`); return []; })
        ));
        parts.forEach(p => all.push(...p));
      }
      return res.json({ ok: true, adsets: all.map(normalizeAdset), fallback: true });
    } catch (err2) {
      console.error(`[CrossPost] Lỗi lấy adsets act_${cleanId}:`, err2.message);
      return res.status(500).json({ ok: false, error: err2.message });
    }
  }
});

/**
 * GET /api/cp/campaigns/:campaignId/adsets
 * Danh sách nhóm quảng cáo trong chiến dịch
 */
crossPostRouter.get('/campaigns/:campaignId/adsets', async (req, res) => {
  const { campaignId } = req.params;

  try {
    const result = await callMeta(`/${campaignId}/adsets`, {
      params: {
        fields: 'id,name,status,effective_status,daily_budget',
        limit: 50
      }
    });

    res.json({ ok: true, adsets: result.data || [] });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy nhóm quảng cáo ${campaignId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cp/adsets/:adsetId/ads
 * Danh sách quảng cáo và creative trong 1 nhóm
 */
crossPostRouter.get('/adsets/:adsetId/ads', async (req, res) => {
  const { adsetId } = req.params;

  try {
    const result = await callMeta(`/${adsetId}/ads`, {
      params: {
        fields: 'id,name,status,effective_status,creative{id,name,title,body,image_url,thumbnail_url,object_story_spec,effective_object_story_id}',
        limit: 50
      }
    });

    res.json({ ok: true, ads: result.data || [] });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy quảng cáo nhóm ${adsetId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cp/replicate-ad
 * Nhân bản 1 quảng cáo sang các nhóm quảng cáo khác (Mặc định PAUSED theo quy tắc an toàn)
 * Body: { sourceAdId: string, targetAdsetIds: string[], renamePrefix?: string }
 */
crossPostRouter.post('/replicate-ad', async (req, res) => {
  const { sourceAdId, targetAdsetIds, renamePrefix = '[Sao chép] ' } = req.body;

  if (!sourceAdId) {
    return res.status(400).json({ ok: false, error: 'Thiếu ID quảng cáo nguồn.' });
  }

  if (!Array.isArray(targetAdsetIds) || targetAdsetIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Vui lòng chọn ít nhất 1 nhóm quảng cáo đích.' });
  }

  const results = [];

  for (let i = 0; i < targetAdsetIds.length; i++) {
    const targetAdsetId = targetAdsetIds[i];

    try {
      // Sử dụng endpoint POST /{ad-id}/copies của Meta Graph API
      // BẮT BUỘC: status_option = "PAUSED" theo quy tắc an toàn §2
      const copyRes = await callMeta(`/${sourceAdId}/copies`, {
        method: 'POST',
        body: {
          adset_id: targetAdsetId,
          status_option: 'PAUSED',
          rename_options: {
            rename_prefix: renamePrefix
          }
        }
      });

      results.push({
        adsetId: targetAdsetId,
        success: true,
        copiedAdId: copyRes.copied_ad_id || copyRes.id
      });
    } catch (err) {
      console.error(`[CrossPost] Lỗi sao chép ad ${sourceAdId} vào nhóm ${targetAdsetId}:`, err.message);
      results.push({
        adsetId: targetAdsetId,
        success: false,
        error: err.message
      });
    }

    if (i < targetAdsetIds.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  const totalSuccess = results.filter(r => r.success).length;
  res.json({
    ok: true,
    summary: {
      total: targetAdsetIds.length,
      success: totalSuccess,
      failed: targetAdsetIds.length - totalSuccess
    },
    results
  });
});

/**
 * Dựng body gửi Meta cho một Campaign mới.
 * Tách khỏi route để test được mà không cần mock fetch hay gọi Meta thật.
 */
export function buildCampaignBody({ name, objective = 'OUTCOME_ENGAGEMENT', dailyBudget }) {
  const campBody = {
    name: String(name).trim(),
    objective,
    status: 'PAUSED', // BẮT BUỘC PAUSED theo quy tắc an toàn
    special_ad_categories: []
  };

  if (dailyBudget && Number(dailyBudget) > 0) {
    campBody.daily_budget = String(Math.round(Number(dailyBudget)));
  }

  return campBody;
}

/**
 * POST /api/cp/create-campaign
 * Tạo chiến dịch mới trên tài khoản quảng cáo (mặc định PAUSED)
 * Body: { accountId: string, name: string, objective?: string, dailyBudget?: number }
 */
crossPostRouter.post('/create-campaign', async (req, res) => {
  const { accountId, name, objective = 'OUTCOME_ENGAGEMENT', dailyBudget } = req.body;
  if (!accountId || !name) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId hoặc tên chiến dịch.' });
  }

  const cleanAccId = accountId.replace(/^act_/, '');
  const campBody = buildCampaignBody({ name, objective, dailyBudget });

  try {
    const result = await callMeta(`act_${cleanAccId}/campaigns`, {
      method: 'POST',
      body: campBody
    });
    res.json({ ok: true, campaign: { id: result.id, name: campBody.name, status: 'PAUSED' } });
  } catch (err) {
    console.error(`[CrossPost] Lỗi tạo campaign trên act_${cleanAccId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Dựng body gửi Meta cho một Adset mới.
 *
 * Tách khỏi route để test được mà không cần mock fetch hay gọi Meta thật.
 * Những bất biến ở đây bảo vệ tài khoản quảng cáo: status LUÔN PAUSED, và
 * targeting không bao giờ rỗng (geo mặc định VN) để Meta không tự mở toàn cầu.
 */
export function buildAdsetBody({
  campaignId, name, pageId, dailyBudget = 100000,
  targeting = {}, optimizationGoal = 'CONVERSATIONS',
  useCampaignBudget = false,
  destinationType = ''
}) {
  const finalTargeting = {};

  if (targeting.geoLocations && Object.keys(targeting.geoLocations).length > 0) {
    finalTargeting.geo_locations = targeting.geoLocations;
  } else {
    finalTargeting.geo_locations = { countries: ['VN'] };
  }

  if (targeting.ageMin) finalTargeting.age_min = Number(targeting.ageMin);
  if (targeting.ageMax) finalTargeting.age_max = Number(targeting.ageMax);
  if (Array.isArray(targeting.genders) && targeting.genders.length > 0) {
    finalTargeting.genders = targeting.genders;
  }
  if (Array.isArray(targeting.placements) && targeting.placements.length > 0) {
    finalTargeting.publisher_platforms = targeting.placements;
  }
  if (Array.isArray(targeting.positions) && targeting.positions.length > 0) {
    finalTargeting.facebook_positions = targeting.positions;
  }

  const body = {
    name: String(name).trim(),
    campaign_id: campaignId,
    status: 'PAUSED',              // BẮT BUỘC — không bao giờ tạo ở trạng thái chạy
    optimization_goal: optimizationGoal,
    billing_event: 'IMPRESSIONS',
    promoted_object: { page_id: pageId },
    targeting: finalTargeting
  };

  if (!useCampaignBudget) {
    body.daily_budget = String(Math.round(Number(dailyBudget)));
  }
  if (destinationType) {
    body.destination_type = destinationType;
  }

  return body;
}

const CTA_PATTERN = /^[A-Z_]{3,40}$/;

export const CTA_SUGGESTIONS = [
  'SEND_MESSAGE', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE', 'LEARN_MORE', 'SIGN_UP',
  'APPLY_NOW', 'CONTACT_US', 'CALL_NOW', 'GET_QUOTE', 'GET_OFFER',
  'SUBSCRIBE', 'BOOK_TRAVEL', 'SHOP_NOW', 'DOWNLOAD', 'NO_BUTTON'
];

/**
 * Dựng body tạo AdCreative. Tách khỏi route để test được mà không gọi Meta.
 */
export function buildAdCreativeBody({ pageId, content = {} }) {
  if (!pageId) throw new Error('buildAdCreativeBody: thiếu pageId.');

  const c = content;
  const name = `[Creative] ${String(c.name || 'Ad').slice(0, 80)}`;

  if (c.type === 'page_post') {
    const raw = String(c.sourcePostId || '').trim();
    if (!raw) throw new Error('buildAdCreativeBody: nội dung page_post thiếu sourcePostId.');
    const storyId = raw.includes('_') ? raw : `${pageId}_${raw}`;
    return { name, object_story_id: storyId };
  }

  const cta = String(c.ctaType || 'SEND_MESSAGE').trim();
  if (!CTA_PATTERN.test(cta)) {
    throw new Error(`buildAdCreativeBody: CTA không hợp lệ "${cta}" (cần chữ IN HOA và _ , 3–40 ký tự).`);
  }

  const link = (c.linkUrl && String(c.linkUrl).trim())
    ? String(c.linkUrl).trim()
    : `https://m.me/${pageId}`;

  const callToAction = (cta === 'NO_BUTTON') ? null : { type: cta, value: { link } };

  const spec = { page_id: pageId };

  if (c.videoId) {
    spec.video_data = {
      video_id: String(c.videoId),
      title: c.headline || '',
      message: c.message || ''
    };
    if (c.description) spec.video_data.link_description = c.description;
    if (callToAction)  spec.video_data.call_to_action = callToAction;
    if (c.imageHash)      spec.video_data.image_hash = c.imageHash;
    else if (c.imageUrl)  spec.video_data.image_url  = c.imageUrl;
  } else {
    spec.link_data = {
      link,
      message: c.message || '',
      name: c.headline || c.name || ''
    };
    if (c.description) spec.link_data.description = c.description;
    if (callToAction)  spec.link_data.call_to_action = callToAction;
    if (c.imageHash)      spec.link_data.image_hash = c.imageHash;
    else if (c.imageUrl)  spec.link_data.picture    = c.imageUrl;
  }

  return { name, object_story_spec: spec };
}

/**
 * Dựng body tạo Ad. Bất biến: status LUÔN 'PAUSED'.
 */
export function buildAdBody({ name, adsetId, creativeId }) {
  if (!adsetId)   throw new Error('buildAdBody: thiếu adsetId.');
  if (!creativeId) throw new Error('buildAdBody: thiếu creativeId.');

  const clean = String(name || 'Quảng cáo')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);

  return {
    name: clean || 'Quảng cáo',
    adset_id: String(adsetId),
    creative: { creative_id: String(creativeId) },
    status: 'PAUSED'   // BẮT BUỘC
  };
}

/**
 * Dựng tên quảng cáo từ mẫu có token.
 */
export function renderAdName(pattern, ctx = {}) {
  const tokens = {
    content:  ctx.contentName  || '',
    adset:    ctx.adsetName    || '',
    campaign: ctx.campaignName || '',
    index:    ctx.index != null ? String(ctx.index) : '',
    date:     ctx.date || new Date().toISOString().slice(0, 10)
  };

  const raw = String(pattern || '{content} — {adset}')
    .replace(/\{(content|adset|campaign|index|date)\}/g, (_, k) => tokens[k] || '');

  const clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (clean || 'Quảng cáo').slice(0, 200);
}

/**
 * Giải trường attachTo của từng nhóm mới thành danh sách cặp.
 */
export function resolveAttachments({ campaigns = [], adsets = [], existingCampaigns = [] }) {
  const newByKey = new Map(campaigns.map(c => [String(c.key), c]));
  const cboByExistingId = new Map(existingCampaigns.map(c => [String(c.id), Boolean(c.hasCbo)]));
  const out = [];

  for (const a of adsets) {
    const attach = String(a.attachTo || 'all');
    let refs;

    if (attach === 'all') {
      if (campaigns.length === 0) {
        throw new Error(`Nhóm "${a.name}" gán "all" nhưng plan không có chiến dịch mới nào.`);
      }
      refs = campaigns.map(c => ({
        kind: 'new', key: String(c.key), name: c.name,
        hasCbo: Number(c.dailyBudget || 0) > 0
      }));
    } else if (attach.startsWith('existing:')) {
      const id = attach.slice('existing:'.length).trim();
      if (!id) throw new Error(`Nhóm "${a.name}" có attachTo "existing:" thiếu ID chiến dịch.`);
      refs = [{ kind: 'existing', id, name: `CĐ ${id}`, hasCbo: cboByExistingId.get(id) === true }];
    } else {
      const c = newByKey.get(attach);
      if (!c) throw new Error(`Nhóm "${a.name}" gán vào chiến dịch không tồn tại trong plan: "${attach}".`);
      refs = [{ kind: 'new', key: String(c.key), name: c.name, hasCbo: Number(c.dailyBudget || 0) > 0 }];
    }

    for (const ref of refs) {
      if (ref.hasCbo && Number(a.dailyBudget || 0) > 0) {
        throw new Error(
          `Chiến dịch "${ref.name}" dùng ngân sách CBO — nhóm "${a.name}" không được đặt ngân sách riêng. ` +
          `Bỏ ngân sách ở nhóm, hoặc bỏ CBO ở chiến dịch.`
        );
      }
      out.push({ adsetSpec: a, campaignRef: ref, useCampaignBudget: ref.hasCbo });
    }
  }

  const perCampaign = new Map();
  for (const o of out) {
    const k = o.campaignRef.kind === 'new' ? `new:${o.campaignRef.key}` : `ex:${o.campaignRef.id}`;
    perCampaign.set(k, (perCampaign.get(k) || 0) + 1);
  }
  for (const [k, n] of perCampaign) {
    if (n > SAFETY_LIMITS.BUILD_MAX_ADSETS_PER_CAMPAIGN) {
      throw new Error(`Chiến dịch ${k} được gán ${n} nhóm mới — tối đa ${SAFETY_LIMITS.BUILD_MAX_ADSETS_PER_CAMPAIGN} nhóm/chiến dịch.`);
    }
  }
  if (out.length > SAFETY_LIMITS.BUILD_MAX_NEW_ADSETS) {
    throw new Error(`Tổng ${out.length} nhóm mới — tối đa ${SAFETY_LIMITS.BUILD_MAX_NEW_ADSETS}.`);
  }

  return out;
}

/**
 * Ghép nội dung với nhóm đích theo 3 chế độ.
 */
export function expandPairs({ targets = [], contents = [], pairingMode = 'matrix', excluded = [] }) {
  if (targets.length === 0)  throw new Error('expandPairs: không có nhóm quảng cáo đích.');
  if (contents.length === 0) throw new Error('expandPairs: không có nội dung quảng cáo.');

  const skip = new Set(excluded);
  const keyOf = (c, t) => `${c.key}|${t.adsetId}`;
  const raw = [];

  if (pairingMode === 'matrix') {
    for (const c of contents) for (const t of targets) raw.push({ content: c, target: t });
  } else if (pairingMode === 'one_to_one') {
    if (contents.length !== targets.length) {
      throw new Error(`Chế độ 1-1 cần số nội dung bằng số nhóm (${contents.length} ≠ ${targets.length}).`);
    }
    for (let i = 0; i < contents.length; i++) raw.push({ content: contents[i], target: targets[i] });
  } else if (pairingMode === 'round_robin') {
    const n = Math.max(contents.length, targets.length);
    for (let i = 0; i < n; i++) {
      raw.push({ content: contents[i % contents.length], target: targets[i % targets.length] });
    }
  } else {
    throw new Error(`pairingMode không hợp lệ: "${pairingMode}".`);
  }

  return raw
    .filter(p => !skip.has(keyOf(p.content, p.target)))
    .map((p, i) => ({ ...p, index: i + 1, pairKey: keyOf(p.content, p.target) }));
}

/**
 * Đếm tổng đối tượng sẽ tạo và chặn trần.
 */
export function countPlanObjects({ campaignCount, adsetCount, adCount }) {
  const total = campaignCount + adsetCount + adCount;

  if (campaignCount > SAFETY_LIMITS.BUILD_MAX_NEW_CAMPAIGNS) {
    throw new Error(`${campaignCount} chiến dịch — tối đa ${SAFETY_LIMITS.BUILD_MAX_NEW_CAMPAIGNS}.`);
  }
  if (adCount > SAFETY_LIMITS.BUILD_MAX_ADS) {
    throw new Error(`${adCount} quảng cáo — tối đa ${SAFETY_LIMITS.BUILD_MAX_ADS}. Hãy bớt nội dung hoặc bớt nhóm đích.`);
  }
  if (total > SAFETY_LIMITS.BUILD_MAX_OBJECTS) {
    throw new Error(`Tổng ${total} đối tượng — tối đa ${SAFETY_LIMITS.BUILD_MAX_OBJECTS} mỗi đợt.`);
  }

  return { campaignCount, adsetCount, adCount, total };
}

/**
 * Ước tính thời gian chạy (giây).
 */
export function estimateRunSeconds({ campaignCount = 0, adsetCount = 0, adCount = 0, creativeCount = 0 }) {
  const L = SAFETY_LIMITS;
  const ms = campaignCount * (L.DELAY_BUILD_CAMPAIGN_MS || 2500)
           + adsetCount    * (L.DELAY_BUILD_ADSET_MS || 2500)
           + creativeCount * (L.DELAY_BUILD_CREATIVE_MS || 1200)
           + adCount       * (L.DELAY_BUILD_AD_MS || 2000);
  return Math.round(ms / 1000);
}

/**
 * Bung spintax: "Con {chưa tập trung|học mãi không vào}?"
 */
export function expandSpintax(text, max = 6) {
  const src = String(text || '');
  const PAT = /\{([^{}]*)\}/;
  if (!PAT.test(src)) return [src];

  const expandOnce = (s) => {
    const m = PAT.exec(s);
    if (!m) return [s];
    const head = s.slice(0, m.index);
    const tail = s.slice(m.index + m[0].length);
    const opts = m[1].split('|');
    return opts.map(o => head + o.trim() + tail);
  };

  let frontier = [src];
  let guard = 0;
  while (frontier.some(s => PAT.test(s)) && guard++ < 12) {
    frontier = frontier.flatMap(expandOnce);
    if (frontier.length > 200) break;
  }

  const out = [];
  for (const s of frontier) {
    const v = s.replace(/\s{2,}/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : [src];
}

/**
 * Kiểm tra ảnh upload bằng MAGIC BYTES (JPEG/PNG).
 */
export function normalizeImageUpload(buffer) {
  if (!buffer || buffer.length === 0) throw new Error('Tệp ảnh rỗng.');
  if (buffer.length > SAFETY_LIMITS.UPLOAD_IMAGE_MAX_BYTES) {
    const mb = (SAFETY_LIMITS.UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0);
    throw new Error(`Ảnh vượt ${mb} MB.`);
  }
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  if (!isJpeg && !isPng) throw new Error('Chỉ nhận ảnh JPEG hoặc PNG.');
  return { mime: isJpeg ? 'image/jpeg' : 'image/png', bytes: buffer.length };
}

/**
 * Lỗi Meta tạm thời đáng thử lại 1 lần.
 */
export function isTransientMetaError(err = {}) {
  const transientCodes = new Set([1, 2, 4, 17, 341, 80000, 80004]);
  if (transientCodes.has(Number(err.code))) return true;
  return /rate limit|try again|temporarily|timeout/i.test(String(err.message || ''));
}

/**
 * POST /api/cp/create-adset
 * Tạo nhóm quảng cáo mới kèm targeting và vị trí hiển thị (mặc định PAUSED)
 * Body: {
 *   accountId: string,
 *   campaignId: string,
 *   name: string,
 *   pageId: string,
 *   dailyBudget?: number,
 *   targeting?: {
 *     ageMin?: number,
 *     ageMax?: number,
 *     genders?: number[],
 *     geoLocations?: any,
 *     placements?: string[],
 *     positions?: string[]
 *   },
 *   optimizationGoal?: string
 * }
 */
crossPostRouter.post('/create-adset', async (req, res) => {
  const { accountId, campaignId, name, pageId, dailyBudget = 100000, targeting = {}, optimizationGoal = 'CONVERSATIONS' } = req.body;

  if (!accountId || !campaignId || !name || !pageId) {
    return res.status(400).json({ ok: false, error: 'Thiếu thông tin bắt buộc: accountId, campaignId, name, pageId.' });
  }

  const cleanAccId = accountId.replace(/^act_/, '');
  const adsetBody = buildAdsetBody({
    campaignId, name, pageId, dailyBudget, targeting, optimizationGoal
  });

  try {
    const result = await callMeta(`act_${cleanAccId}/adsets`, {
      method: 'POST',
      body: adsetBody
    });
    res.json({ ok: true, adset: { id: result.id, name: adsetBody.name, campaignId, status: 'PAUSED' } });
  } catch (err) {
    console.error(`[CrossPost] Lỗi tạo adset trên act_${cleanAccId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cp/batch-create-ads
 * Tạo đồng thời nhiều quảng cáo từ các nội dung đã chuẩn bị vào các nhóm đích
 * Body: {
 *   accountId: string,
 *   adsetIds: string[],
 *   pageId: string,
 *   items: Array<{
 *     name: string,
 *     type: 'page_post' | 'custom' | 'clone_ad',
 *     sourcePostId?: string,
 *     message?: string,
 *     title?: string,
 *     imageUrl?: string,
 *     videoId?: string,
 *     sourceAdId?: string
 *   }>
 * }
 */
crossPostRouter.post('/batch-create-ads', withLock('batchAds'), async (req, res) => {
  const { accountId, adsetIds, pageId, items } = req.body;

  if (!accountId || !pageId || !Array.isArray(adsetIds) || adsetIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId, pageId hoặc danh sách nhóm đích (adsetIds).' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Danh sách quảng cáo cần tạo không được rỗng.' });
  }

  if (items.length > SAFETY_LIMITS.BATCH_ADS_MAX) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BATCH_ADS_MAX} quảng cáo mỗi đợt để đảm bảo an toàn tốc độ API.` });
  }

  const cleanAccId = accountId.replace(/^act_/, '');
  await ensurePageTokens();

  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemResult = {
      itemName: item.name || `Quảng cáo ${i + 1}`,
      type: item.type,
      success: false,
      createdAds: [],
      error: null
    };

    try {
      // 1. Tạo Creative mới tương ứng với nội dung
      let creativeId = '';

      if (item.type === 'page_post') {
        const rawPostId = item.sourcePostId || '';
        const storyId = rawPostId.includes('_') ? rawPostId : `${pageId}_${rawPostId}`;

        const crRes = await callMeta(`act_${cleanAccId}/adcreatives`, {
          method: 'POST',
          body: {
            name: `[Creative] ${item.name || 'Post Ad'}`,
            object_story_id: storyId
          }
        });
        creativeId = crRes.id;
      } else if (item.type === 'clone_ad' && item.sourceAdId) {
        // Lấy thông tin creative của ad gốc để clone một cách sạch sẽ (tránh lỗi copies)
        const srcAd = await callMeta(`${item.sourceAdId}`, {
          params: { fields: 'name,creative{id,name,title,body,image_url,thumbnail_url,video_id,effective_object_story_id}' }
        });
        const srcCr = srcAd.creative || {};

        if (srcCr.effective_object_story_id && srcCr.effective_object_story_id.startsWith(pageId + '_')) {
          // Cùng page -> dùng lại story_id
          const crRes = await callMeta(`act_${cleanAccId}/adcreatives`, {
            method: 'POST',
            body: {
              name: `[Creative] ${item.name || srcAd.name}`,
              object_story_id: srcCr.effective_object_story_id
            }
          });
          creativeId = crRes.id;
        } else {
          // Tạo link_data hoặc video_data chuẩn
          const storySpec = { page_id: pageId };
          if (srcCr.video_id) {
            storySpec.video_data = {
              video_id: srcCr.video_id,
              title: srcCr.title || '',
              message: srcCr.body || '',
              call_to_action: { type: 'SEND_MESSAGE', value: { link: `https://m.me/${pageId}` } }
            };
          } else {
            storySpec.link_data = {
              message: srcCr.body || '',
              name: srcCr.title || item.name || '',
              link: `https://m.me/${pageId}`,
              call_to_action: { type: 'SEND_MESSAGE' }
            };
            if (srcCr.image_url || srcCr.thumbnail_url) {
              storySpec.link_data.picture = srcCr.image_url || srcCr.thumbnail_url;
            }
          }
          const crRes = await callMeta(`act_${cleanAccId}/adcreatives`, {
            method: 'POST',
            body: {
              name: `[Creative] ${item.name || srcAd.name}`,
              object_story_spec: storySpec
            }
          });
          creativeId = crRes.id;
        }
      } else {
        // Custom creative (Text + Image/Video)
        const storySpec = { page_id: pageId };
        if (item.videoId) {
          storySpec.video_data = {
            video_id: item.videoId,
            title: item.title || '',
            message: item.message || '',
            call_to_action: { type: 'SEND_MESSAGE', value: { link: `https://m.me/${pageId}` } }
          };
          if (item.imageUrl) storySpec.video_data.image_url = item.imageUrl;
        } else if (item.imageUrl) {
          storySpec.link_data = {
            message: item.message || '',
            name: item.title || item.name || '',
            picture: item.imageUrl,
            link: `https://m.me/${pageId}`,
            call_to_action: { type: 'SEND_MESSAGE' }
          };
        } else {
          storySpec.link_data = {
            message: item.message || '',
            name: item.title || item.name || '',
            link: `https://m.me/${pageId}`,
            call_to_action: { type: 'SEND_MESSAGE' }
          };
        }

        const crRes = await callMeta(`act_${cleanAccId}/adcreatives`, {
          method: 'POST',
          body: {
            name: `[Creative] ${item.name || 'Ad'}`,
            object_story_spec: storySpec
          }
        });
        creativeId = crRes.id;
      }

      await new Promise(r => setTimeout(r, 1200));

      // 2. Tạo Ad trên từng nhóm đích trong adsetIds
      for (const adsetId of adsetIds) {
        try {
          const adRes = await callMeta(`act_${cleanAccId}/ads`, {
            method: 'POST',
            body: {
              name: item.name || `Quảng cáo ${i + 1}`,
              adset_id: adsetId,
              creative: { creative_id: creativeId },
              status: 'PAUSED' // BẮT BUỘC PAUSED
            }
          });
          itemResult.createdAds.push({ adsetId, adId: adRes.id, success: true });
        } catch (adErr) {
          itemResult.createdAds.push({ adsetId, success: false, error: adErr.message });
        }
        await new Promise(r => setTimeout(r, 1200));
      }

      itemResult.success = itemResult.createdAds.some(a => a.success);
    } catch (err) {
      console.error(`[CrossPost] Lỗi tạo item ${item.name}:`, err.message);
      itemResult.error = err.message;
    }

    results.push(itemResult);

    // Delay giữa các item
    if (i < items.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const totalSuccess = results.filter(r => r.success).length;
  res.json({
    ok: true,
    summary: {
      totalItems: items.length,
      successItems: totalSuccess,
      failedItems: items.length - totalSuccess
    },
    results
  });
});

// -------------------------------------------------------------
// ROUTES: DASHBOARD → ANALYZE & BULK REPLICATE
// -------------------------------------------------------------

/** Anti-spam: prevent concurrent bulk operations */
let bulkInFlight = false;

/**
 * POST /api/cp/analyze-campaigns
 * Lấy chi tiết Ads + Creative cho danh sách chiến dịch đã chọn.
 * Phân loại mỗi ad là Page Post hay Direct Ad.
 * Body: { campaignIds: string[] }
 */
crossPostRouter.post('/analyze-campaigns', async (req, res) => {
  const { campaignIds } = req.body;

  if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Cần chọn ít nhất 1 chiến dịch.' });
  }
  if (campaignIds.length > SAFETY_LIMITS.ANALYZE_CAMPAIGNS_MAX) {
    return res.status(400).json({ ok: false, error: `Mỗi lần phân tích tối đa ${SAFETY_LIMITS.ANALYZE_CAMPAIGNS_MAX} chiến dịch.` });
  }

  // Cần biết campaign thuộc ad account nào → đọc từ provider trong RAM (P-05)
  let campaignAccountMap = new Map();
  try {
    const raw = getRawReport() || JSON.parse(readFileSync(join(DATA_DIR, 'latest_insights.json'), 'utf8'));
    for (const c of (raw?.campaigns || [])) {
      if (c.id && c.accountId) campaignAccountMap.set(c.id, c.accountId);
    }
  } catch (e) {
    console.warn('[CrossPost] Không đọc được campaign-account map:', e.message);
  }

  const allAds = [];
  const errors = [];

  // Nhóm campaigns theo account để batch query
  const byAccount = new Map();
  for (const cid of campaignIds) {
    const accId = campaignAccountMap.get(cid);
    if (!accId) {
      errors.push({ campaignId: cid, error: 'Không xác định được tài khoản quảng cáo. Hãy đồng bộ dữ liệu trước.' });
      continue;
    }
    if (!byAccount.has(accId)) byAccount.set(accId, []);
    byAccount.get(accId).push(cid);
  }

  for (const [accId, cids] of byAccount) {
    try {
      // 1) Lấy ads + creative
      const result = await callMeta(`act_${accId}/ads`, {
        params: {
          fields: 'id,name,status,effective_status,campaign_id,adset_id,creative{id,name,body,title,image_url,thumbnail_url,video_id,object_story_spec,effective_object_story_id}',
          filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: cids }]),
          limit: 100
        }
      });

      // 2) Lấy adsets + targeting cho các campaign này
      const adsetResult = await callMeta(`act_${accId}/adsets`, {
        params: {
          fields: 'id,name,campaign_id,targeting,optimization_goal,billing_event,bid_strategy,promoted_object,daily_budget,lifetime_budget,status',
          filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: cids }]),
          limit: 100
        }
      });

      // Map adsetId → adset data (bao gồm targeting)
      const adsetMap = new Map();
      for (const as of (adsetResult.data || [])) {
        adsetMap.set(as.id, {
          id: as.id,
          name: as.name,
          campaignId: as.campaign_id,
          targeting: as.targeting || {},
          optimizationGoal: as.optimization_goal || '',
          billingEvent: as.billing_event || '',
          bidStrategy: as.bid_strategy || '',
          promotedObject: as.promoted_object || null,
          dailyBudget: as.daily_budget || '',
          lifetimeBudget: as.lifetime_budget || '',
          status: as.status || ''
        });
      }

      const ads = (result.data || []).map(ad => {
        const cr = ad.creative || {};
        const storyId = cr.effective_object_story_id || '';
        let type = 'direct_ad';
        let sourcePageId = '';
        let sourcePostId = '';

        if (storyId && storyId.includes('_')) {
          type = 'page_post';
          const parts = storyId.split('_');
          sourcePageId = parts[0];
          sourcePostId = storyId;
        }

        // Gắn targeting từ adset
        const adsetInfo = adsetMap.get(ad.adset_id) || null;

        // Tóm tắt targeting cho frontend
        let targetingSummary = null;
        if (adsetInfo?.targeting) {
          const t = adsetInfo.targeting;
          const geo = t.geo_locations || {};
          const geoNames = [];
          if (geo.countries?.length) geoNames.push(...geo.countries);
          if (geo.cities?.length) geoNames.push(...geo.cities.map(c => c.name).filter(Boolean));
          if (geo.regions?.length) geoNames.push(...geo.regions.map(r => r.name).filter(Boolean));
          if (geo.places?.length) geoNames.push(`${geo.places.length} địa điểm`);

          targetingSummary = {
            ageMin: t.age_min || null,
            ageMax: t.age_max || null,
            genders: t.genders || [],
            geoNames,
            customAudiences: (t.custom_audiences || []).map(a => ({ id: a.id, name: a.name })),
            excludedCustomAudiences: (t.excluded_custom_audiences || []).map(a => ({ id: a.id, name: a.name })),
            platforms: t.publisher_platforms || [],
            positions: t.facebook_positions || []
          };
        }

        return {
          campaignId: ad.campaign_id,
          accountId: accId,
          adId: ad.id,
          adName: ad.name,
          adsetId: ad.adset_id,
          status: ad.effective_status,
          type,
          sourcePageId,
          sourcePostId,
          creative: {
            id: cr.id || '',
            body: cr.body || '',
            title: cr.title || '',
            imageUrl: cr.image_url || cr.thumbnail_url || '',
            videoId: cr.video_id || '',
            objectStorySpec: cr.object_story_spec || null
          },
          adsetInfo,       // Full adset data (targeting, budget, etc.) cho backend replicate
          targetingSummary  // Tóm tắt cho frontend hiển thị
        };
      });

      allAds.push(...ads);
    } catch (err) {
      console.error(`[CrossPost] Lỗi phân tích ads từ act_${accId}:`, err.message);
      cids.forEach(cid => errors.push({ campaignId: cid, error: err.message }));
    }

    // 500ms delay giữa các account
    await new Promise(r => setTimeout(r, 500));
  }

  res.json({ ok: true, ads: allAds, errors });
});

/**
 * POST /api/cp/bulk-replicate
 * Nhân bản quảng cáo cross-account với các type:
 * - cross_account_replicate: Tạo Campaign → Adset → Creative → Ad trên TK đích với Page đích
 * - page_post (legacy): Đăng chéo nội dung
 * - direct_ad (legacy): Sao chép Ad
 *
 * An toàn: max 10 items, delay 2-3s, PAUSED, mutex
 */
/**
 * Hàm thực thi nhân bản hàng loạt ngầm, cập nhật tiến độ vào job (F-04).
 */
async function runBulkReplicate(items, job) {
  // Đảm bảo page token sẵn sàng trong RAM
  try { await ensurePageTokens(); } catch (e) { /* ignore */ }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = { adId: item.adId, type: item.type, targets: [] };

    if (item.type === 'cross_account_replicate') {
      const targetAccId = item.targetAccountId;
      const targetPageId = item.targetPageId;
      const adsetInfo = item.adsetInfo || null;
      const budgetType = item.budgetType || 'daily_budget';
      const budgetAmount = item.budgetAmount || '200000';
      const creative = item.creative || {};

      if (!targetAccId || !targetPageId) {
        result.targets.push({
          targetId: targetAccId || '?', success: false,
          error: 'Thiếu tài khoản hoặc fanpage đích.'
        });
        job.results.push(result);
        job.done += 1;
        continue;
      }

      const targetPage = pageCache.get(targetPageId);
      const targetPageName = targetPage?.name || targetPageId;

      try {
        // ① TẠO CAMPAIGN (PAUSED)
        const campName = `[Nhân bản] ${item.campaignName || item.adId}`;
        const newCampaign = await callMeta(`act_${targetAccId}/campaigns`, {
          method: 'POST',
          body: {
            name: campName,
            objective: 'OUTCOME_ENGAGEMENT',
            status: 'PAUSED',
            special_ad_categories: []
          }
        });
        const newCampId = newCampaign.id;
        console.log(`[BulkReplicate] ① Campaign: ${newCampId}`);

        await new Promise(r => setTimeout(r, 2000));

        // ② TẠO ADSET (PAUSED) — clone targeting theo tuỳ chọn
        const adsetBody = {
          name: `[Nhân bản] ${adsetInfo?.name || 'Nhóm QC'}`,
          campaign_id: newCampId,
          status: 'PAUSED',
          optimization_goal: item.optimizationGoal || adsetInfo?.optimizationGoal || 'CONVERSATIONS',
          billing_event: item.billingEvent || adsetInfo?.billingEvent || 'IMPRESSIONS',
          [budgetType]: String(budgetAmount)
        };

        if (item.clonedTargeting && Object.keys(item.clonedTargeting).length > 0) {
          adsetBody.targeting = item.clonedTargeting;
        } else {
          adsetBody.targeting = {
            geo_locations: { countries: ['VN'] },
            age_min: 18,
            age_max: 65
          };
        }

        if (adsetInfo?.promotedObject) {
          const pObj = { ...adsetInfo.promotedObject };
          if (pObj.page_id) pObj.page_id = targetPageId;
          adsetBody.promoted_object = pObj;
        } else {
          adsetBody.promoted_object = { page_id: targetPageId };
        }

        if (adsetInfo?.bidStrategy) {
          adsetBody.bid_strategy = adsetInfo.bidStrategy;
        }

        const newAdset = await callMeta(`act_${targetAccId}/adsets`, {
          method: 'POST',
          body: adsetBody
        });
        const newAdsetId = newAdset.id;
        console.log(`[BulkReplicate] ② Adset: ${newAdsetId}`);

        await new Promise(r => setTimeout(r, 2000));

        // ③ TẠO CREATIVE — nội dung gốc + page đích
        let newCreativeId;
        const storySpec = { page_id: targetPageId };

        if (creative.videoId) {
          storySpec.video_data = {
            video_id: creative.videoId,
            title: creative.title || '',
            message: creative.body || '',
            call_to_action: { type: 'SEND_MESSAGE', value: { link: `https://m.me/${targetPageId}` } }
          };
          if (creative.imageUrl) {
            storySpec.video_data.image_url = creative.imageUrl;
          }
        } else if (creative.imageUrl) {
          storySpec.link_data = {
            message: creative.body || '',
            name: creative.title || '',
            picture: creative.imageUrl,
            link: `https://m.me/${targetPageId}`,
            call_to_action: { type: 'SEND_MESSAGE' }
          };
        } else {
          storySpec.link_data = {
            message: creative.body || '',
            link: `https://m.me/${targetPageId}`,
            call_to_action: { type: 'SEND_MESSAGE' }
          };
        }

        const creativeRes = await callMeta(`act_${targetAccId}/adcreatives`, {
          method: 'POST',
          body: {
            name: `[Nhân bản] ${creative.title || item.campaignName || 'Creative'}`,
            object_story_spec: storySpec
          }
        });
        newCreativeId = creativeRes.id;
        console.log(`[BulkReplicate] ③ Creative: ${newCreativeId}`);

        await new Promise(r => setTimeout(r, 2000));

        // ④ TẠO AD (PAUSED)
        const newAd = await callMeta(`act_${targetAccId}/ads`, {
          method: 'POST',
          body: {
            name: `[Nhân bản] ${item.campaignName || item.adId}`,
            adset_id: newAdsetId,
            creative: { creative_id: newCreativeId },
            status: 'PAUSED'
          }
        });
        console.log(`[BulkReplicate] ④ Ad: ${newAd.id}`);

        result.targets.push({
          targetId: targetAccId,
          targetName: `${targetPageName} (TK ${targetAccId})`,
          success: true,
          campaignId: newCampId,
          adsetId: newAdsetId,
          creativeId: newCreativeId,
          adId: newAd.id,
          targetingCloned: Boolean(item.clonedTargeting)
        });

      } catch (err) {
        console.error(`[BulkReplicate] Lỗi cross-account ad ${item.adId} → act_${targetAccId}:`, err.message);
        result.targets.push({
          targetId: targetAccId,
          targetName: `${targetPage?.name || targetPageId} (TK ${targetAccId})`,
          success: false,
          error: err.message
        });
      }

    } else if (item.type === 'page_post') {
      const targetPageIds = item.targetPageIds || [];
      const content = item.content || {};

      for (let j = 0; j < targetPageIds.length; j++) {
        const targetId = targetPageIds[j];
        const pageInfo = pageCache.get(targetId);

        if (!pageInfo || !pageInfo.accessToken) {
          result.targets.push({ targetId, targetName: pageInfo?.name || targetId, success: false, error: 'Không có Access Token.' });
          continue;
        }

        try {
          let pub;
          if (content.imageUrl && content.imageUrl.trim()) {
            pub = await callMeta(`${targetId}/photos`, {
              method: 'POST', token: pageInfo.accessToken,
              body: { url: content.imageUrl.trim(), caption: content.message || '' }
            });
          } else {
            const feedBody = { message: content.message || '' };
            if (content.link) feedBody.link = content.link;
            pub = await callMeta(`${targetId}/feed`, {
              method: 'POST', token: pageInfo.accessToken, body: feedBody
            });
          }
          result.targets.push({ targetId, targetName: pageInfo.name, success: true, postId: pub.id || pub.post_id });
        } catch (err) {
          result.targets.push({ targetId, targetName: pageInfo?.name || targetId, success: false, error: err.message });
        }
        if (j < targetPageIds.length - 1) await new Promise(r => setTimeout(r, 2500));
      }

    } else {
      const targetAdsetIds = item.targetAdsetIds || [];
      for (let j = 0; j < targetAdsetIds.length; j++) {
        const tid = targetAdsetIds[j];
        try {
          const copyRes = await callMeta(`${item.adId}/copies`, {
            method: 'POST',
            body: { adset_id: tid, status_option: 'PAUSED', rename_options: { rename_prefix: '[Nhân bản] ' } }
          });
          result.targets.push({ targetId: tid, success: true, copiedAdId: copyRes.copied_ad_id || copyRes.id });
        } catch (err) {
          result.targets.push({ targetId: tid, success: false, error: err.message });
        }
        if (j < targetAdsetIds.length - 1) await new Promise(r => setTimeout(r, 2500));
      }
    }

    job.results.push(result);
    job.done += 1;

    // Delay 3s giữa các item
    if (i < items.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  let totalTargets = 0, totalSuccess = 0;
  job.results.forEach(r => { r.targets.forEach(t => { totalTargets++; if (t.success) totalSuccess++; }); });
  job.summary = { totalItems: items.length, totalTargets, success: totalSuccess, failed: totalTargets - totalSuccess };
}

crossPostRouter.post('/bulk-replicate', async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Danh sách nhân bản trống.' });
  }
  if (items.length > SAFETY_LIMITS.BULK_REPLICATE_MAX) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BULK_REPLICATE_MAX} mục mỗi lần để bảo vệ tài khoản Meta.` });
  }
  if (bulkInFlight) {
    return res.status(429).json({ ok: false, error: 'Đang có 1 lệnh nhân bản khác đang chạy. Vui lòng đợi hoàn thành.' });
  }

  const jobId = newJob(items.length);
  res.json({ ok: true, jobId, total: items.length });

  bulkInFlight = true;
  const job = jobs.get(jobId);
  runBulkReplicate(items, job)
    .then(() => { job.status = 'done'; })
    .catch(err => { job.status = 'error'; job.error = err.message; })
    .finally(() => { bulkInFlight = false; });
});

// =====================================================================
// ENGINE BUILD-STRUCTURE & HÀNG LOẠT (TAB 2 & TAB 3)
// =====================================================================

const IMAGE_HASH_CACHE_FILE = join(DATA_DIR, 'cp_image_hashes.json');

/** sha256 nội dung ảnh → image_hash đã upload. Tránh upload lại cùng 1 ảnh. */
let imageHashCache = null;
function loadImageHashCache() {
  if (imageHashCache) return imageHashCache;
  try {
    imageHashCache = existsSync(IMAGE_HASH_CACHE_FILE)
      ? JSON.parse(readFileSync(IMAGE_HASH_CACHE_FILE, 'utf-8'))
      : {};
  } catch { imageHashCache = {}; }
  return imageHashCache;
}
function saveImageHashCache() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(IMAGE_HASH_CACHE_FILE, JSON.stringify(imageHashCache, null, 2), 'utf-8');
  } catch (e) { console.warn('[CrossPost] Không ghi được cache image hash:', e.message); }
}

/**
 * POST /api/cp/upload-ad-image
 * Body: { accountId, fileName, dataBase64 }
 */
crossPostRouter.post('/upload-ad-image', async (req, res) => {
  const { accountId, fileName, dataBase64 } = req.body || {};
  if (!accountId || !dataBase64) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId hoặc dataBase64.' });
  }

  let buf;
  try {
    buf = Buffer.from(String(dataBase64), 'base64');
    normalizeImageUpload(buf);
  } catch (err) {
    const code = /vượt/.test(err.message) ? 413 : 400;
    return res.status(code).json({ ok: false, error: err.message });
  }

  const cleanAccId = String(accountId).replace(/^act_/, '');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const cacheKey = `${cleanAccId}:${sha}`;
  const cache = loadImageHashCache();

  if (cache[cacheKey]) {
    return res.json({ ok: true, cached: true, ...cache[cacheKey] });
  }

  try {
    const result = await callMeta(`act_${cleanAccId}/adimages`, {
      method: 'POST',
      body: { bytes: buf.toString('base64') }
    });

    const first = Object.values(result.images || {})[0] || {};
    if (!first.hash) throw new Error('Meta không trả về image hash.');

    const payload = {
      imageHash: first.hash,
      url: first.url || '',
      width: first.width || 0,
      height: first.height || 0,
      fileName: String(fileName || 'image')
    };
    cache[cacheKey] = payload;
    saveImageHashCache();

    res.json({ ok: true, cached: false, ...payload });
  } catch (err) {
    console.error(`[CrossPost] Lỗi upload ảnh act_${cleanAccId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// Thư viện nội dung
// ---------------------------------------------------------------------
const CONTENT_LIBRARY_FILE = join(DATA_DIR, 'cp_content_library.json');
const CONTENT_LIBRARY_MAX = 200;

function readContentLibrary() {
  try {
    return existsSync(CONTENT_LIBRARY_FILE)
      ? JSON.parse(readFileSync(CONTENT_LIBRARY_FILE, 'utf-8'))
      : [];
  } catch { return []; }
}

crossPostRouter.get('/content-library', (req, res) => {
  res.json({ ok: true, items: readContentLibrary() });
});

crossPostRouter.post('/content-library', (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  if (incoming.length === 0) {
    return res.status(400).json({ ok: false, error: 'Danh sách nội dung cần lưu đang rỗng.' });
  }

  const pick = (o) => ({
    id: String(o.id || crypto.randomUUID()),
    name: String(o.name || '').slice(0, 120),
    message: String(o.message || '').slice(0, 4000),
    headline: String(o.headline || '').slice(0, 200),
    description: String(o.description || '').slice(0, 300),
    linkUrl: String(o.linkUrl || '').slice(0, 500),
    ctaType: String(o.ctaType || 'SEND_MESSAGE').slice(0, 40),
    imageHash: String(o.imageHash || ''),
    imageUrl: String(o.imageUrl || '').slice(0, 500),
    videoId: String(o.videoId || ''),
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 8).map(t => String(t).slice(0, 30)) : [],
    savedAt: new Date().toISOString()
  });

  try {
    const existing = readContentLibrary();
    const added = incoming.map(pick);
    const addedIds = new Set(added.map(a => a.id));
    const merged = [...added, ...existing.filter(e => !addedIds.has(e.id))].slice(0, CONTENT_LIBRARY_MAX);

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONTENT_LIBRARY_FILE, JSON.stringify(merged, null, 2), 'utf-8');

    res.json({ ok: true, saved: added.length, total: merged.length });
  } catch (err) {
    console.error('[CrossPost] Lỗi ghi thư viện nội dung:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// Route POST /api/cp/build-structure và engine runBuildStructure
// ---------------------------------------------------------------------

/**
 * Chặn gửi lại cùng 1 plan (người dùng bấm 2 lần / mạng chập chờn).
 * planId → { jobId, at }. Trong 10 phút thì trả lại đúng job cũ.
 */
const planJobs = new Map();
const PLAN_DEDUPE_MS = 600000;

crossPostRouter.post('/build-structure', withLock('buildStructure'), async (req, res) => {
  const p = req.body || {};
  const {
    planId, accountId,
    campaigns = [], adsets = [], existingTargets = [], existingCampaigns = [],
    contents = [], pairingMode = 'matrix',
    namePattern = '{content} — {adset}', excludedPairs = []
  } = p;

  // --- Chống gửi trùng ---
  if (planId && planJobs.has(planId)) {
    const prev = planJobs.get(planId);
    if (Date.now() - prev.at < PLAN_DEDUPE_MS) {
      return res.json({ ok: true, jobId: prev.jobId, deduped: true });
    }
  }

  // --- Validate cơ bản ---
  if (!accountId) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId (mỗi đợt chỉ 1 tài khoản quảng cáo).' });
  }
  if (contents.length === 0) {
    return res.status(400).json({ ok: false, error: 'Chưa có nội dung quảng cáo nào.' });
  }
  if (contents.length > SAFETY_LIMITS.BUILD_MAX_CONTENTS) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BUILD_MAX_CONTENTS} nội dung mỗi đợt.` });
  }
  if (adsets.length === 0 && existingTargets.length === 0) {
    return res.status(400).json({ ok: false, error: 'Chưa chọn nhóm quảng cáo đích, cũng chưa khai nhóm tạo mới.' });
  }
  if (existingTargets.length > SAFETY_LIMITS.BUILD_MAX_TARGETS) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BUILD_MAX_TARGETS} nhóm đích mỗi đợt.` });
  }

  // --- Validate nội dung ---
  for (const c of contents) {
    if (!c.key) return res.status(400).json({ ok: false, error: 'Mỗi nội dung phải có "key" duy nhất.' });
    if (c.type === 'page_post' && !c.sourcePostId) {
      return res.status(400).json({ ok: false, error: `Nội dung "${c.name || c.key}" thiếu bài đăng nguồn.` });
    }
    if ((!c.type || c.type === 'custom') && !c.message && !c.imageHash && !c.imageUrl && !c.videoId) {
      return res.status(400).json({ ok: false, error: `Nội dung "${c.name || c.key}" trống — cần ít nhất nội dung chữ hoặc ảnh/video.` });
    }
  }

  // --- Giải attachTo + đếm đối tượng + ước tính thời gian ---
  let attachments, pairs, counts, etaSeconds, creativeCount;
  try {
    attachments = resolveAttachments({ campaigns, adsets, existingCampaigns });

    const plannedTargetCount = attachments.length + existingTargets.length;
    if (plannedTargetCount > SAFETY_LIMITS.BUILD_MAX_TARGETS) {
      throw new Error(`Tổng ${plannedTargetCount} nhóm đích — tối đa ${SAFETY_LIMITS.BUILD_MAX_TARGETS}.`);
    }

    const mockTargets = [
      ...attachments.map((a, i) => ({ adsetId: `new_${i}`, adsetName: a.adsetSpec.name, campaignName: a.campaignRef.name })),
      ...existingTargets.map(t => ({ adsetId: t.adsetId, adsetName: t.adsetName, campaignName: t.campaignName }))
    ];
    pairs = expandPairs({ targets: mockTargets, contents, pairingMode, excluded: excludedPairs });

    creativeCount = new Set(pairs.map(x => `${x.target.pageId || ''}|${x.content.key}`)).size || contents.length;
    counts = countPlanObjects({
      campaignCount: campaigns.length,
      adsetCount: attachments.length,
      adCount: pairs.length
    });
    etaSeconds = estimateRunSeconds({ ...counts, creativeCount });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  // --- Mở job rồi trả về ngay ---
  const totalSteps = counts.total;
  const jobId = newJob(totalSteps, {
    phase: 'campaigns',
    created: { campaigns: [], adsets: [], ads: [] },
    logs: [],
    plan: { accountId, pairingMode, namePattern, counts, etaSeconds }
  });
  if (planId) planJobs.set(planId, { jobId, at: Date.now() });

  res.json({
    ok: true, jobId,
    preview: { ...counts, creativeCount, etaSeconds }
  });

  const job = jobs.get(jobId);
  runBuildStructure({
    accountId, campaigns, attachments, existingTargets,
    contents, pairingMode, namePattern, excludedPairs
  }, job)
    .then(() => { job.status = 'done'; })
    .catch(err => { job.status = 'error'; job.error = err.message; pushLog(job, 'error', `Đợt chạy dừng: ${err.message}`); });
});

const JOB_LOG_MAX = 500;

function pushLog(job, level, msg) {
  job.logs = job.logs || [];
  job.logs.push({ at: new Date().toISOString(), level, msg });
  if (job.logs.length > JOB_LOG_MAX) job.logs.splice(0, job.logs.length - JOB_LOG_MAX);
  const tag = level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : 'OK';
  console.log(`[BuildStructure][${tag}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callMetaWithRetry(endpoint, options, job, label) {
  try {
    return { data: await callMeta(endpoint, options), retried: false };
  } catch (err) {
    if (!isTransientMetaError(err)) throw err;
    pushLog(job, 'warn', `${label}: lỗi tạm thời (${err.message}) — chờ 5s thử lại.`);
    await sleep(5000);
    return { data: await callMeta(endpoint, options), retried: true };
  }
}

async function runBuildStructure(plan, job) {
  const L = SAFETY_LIMITS;
  const cleanAccId = String(plan.accountId).replace(/^act_/, '');
  await ensurePageTokens();

  // ---------- PHA 1: CHIẾN DỊCH ----------
  job.phase = 'campaigns';
  const campaignIdByKey = new Map();
  const campaignNameById = new Map();

  for (const spec of plan.campaigns || []) {
    const row = { key: String(spec.key), name: spec.name, id: null, success: false, error: null };
    try {
      const body = buildCampaignBody({
        name: spec.name,
        objective: spec.objective || 'OUTCOME_ENGAGEMENT',
        dailyBudget: spec.dailyBudget
      });
      const { data } = await callMetaWithRetry(
        `act_${cleanAccId}/campaigns`, { method: 'POST', body }, job, `Chiến dịch "${spec.name}"`
      );
      row.id = data.id;
      row.success = true;
      campaignIdByKey.set(row.key, data.id);
      campaignNameById.set(data.id, spec.name);
      pushLog(job, 'success', `Đã tạo chiến dịch "${spec.name}" → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `Lỗi tạo chiến dịch "${spec.name}": ${err.message}`);
    }
    job.created.campaigns.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_CAMPAIGN_MS || 2500);
  }

  // ---------- PHA 2: NHÓM QUẢNG CÁO ----------
  job.phase = 'adsets';
  const createdTargets = [];

  for (const att of plan.attachments || []) {
    const spec = att.adsetSpec;
    const ref = att.campaignRef;

    let campaignId = null;
    if (ref.kind === 'new') {
      campaignId = campaignIdByKey.get(ref.key) || null;
      if (!campaignId) {
        const row = { key: spec.key, name: spec.name, campaignId: null, id: null,
                      success: false, skipped: true,
                      error: `Bỏ qua: chiến dịch "${ref.name}" tạo không thành công.` };
        job.created.adsets.push(row);
        job.done++;
        pushLog(job, 'warn', row.error);
        continue;
      }
    } else {
      campaignId = ref.id;
      if (!campaignNameById.has(campaignId)) campaignNameById.set(campaignId, ref.name);
    }

    const row = { key: spec.key, name: spec.name, campaignId, id: null,
                  success: false, skipped: false, error: null };
    try {
      const body = buildAdsetBody({
        campaignId,
        name: spec.name,
        pageId: spec.pageId,
        dailyBudget: spec.dailyBudget,
        targeting: spec.targeting || {},
        optimizationGoal: spec.optimizationGoal || 'CONVERSATIONS',
        destinationType: spec.destinationType || '',
        useCampaignBudget: att.useCampaignBudget
      });
      const { data } = await callMetaWithRetry(
        `act_${cleanAccId}/adsets`, { method: 'POST', body }, job, `Nhóm "${spec.name}"`
      );
      row.id = data.id;
      row.success = true;
      createdTargets.push({
        campaignId,
        campaignName: campaignNameById.get(campaignId) || '',
        adsetId: data.id,
        adsetName: spec.name,
        pageId: spec.pageId
      });
      pushLog(job, 'success', `Đã tạo nhóm "${spec.name}" trong CĐ ${campaignId} → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `Lỗi tạo nhóm "${spec.name}": ${err.message}`);
    }
    job.created.adsets.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_ADSET_MS || 2500);
  }

  // ---------- PHA 3: QUẢNG CÁO ----------
  job.phase = 'ads';
  const targets = [...createdTargets, ...(plan.existingTargets || [])];

  if (targets.length === 0) {
    pushLog(job, 'error', 'Không còn nhóm đích nào khả dụng — không tạo được quảng cáo.');
    job.summary = buildSummary(job);
    return;
  }

  let pairs;
  try {
    pairs = expandPairs({
      targets, contents: plan.contents,
      pairingMode: plan.pairingMode, excluded: plan.excludedPairs
    });
  } catch (err) {
    pushLog(job, 'error', `Không ghép được ma trận: ${err.message}`);
    job.summary = buildSummary(job);
    return;
  }

  pairs.sort((a, b) => {
    const ka = `${a.target.pageId || ''}|${a.content.key}`;
    const kb = `${b.target.pageId || ''}|${b.content.key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const creativeCache = new Map();
  const creativeFailed = new Map();

  let adIndex = 0;
  for (const pair of pairs) {
    adIndex++;
    const { content, target } = pair;
    let pageId;
    try {
      pageId = resolvePageIdForTarget(target, content.pageId || '');
    } catch (err) {
      job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true, error: err.message });
      job.done++;
      pushLog(job, 'error', err.message);
      continue;
    }

    const ck = `${pageId}|${content.key}`;

    if (creativeFailed.has(ck)) {
      job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true,
                             error: `Bỏ qua: creative lỗi (${creativeFailed.get(ck)})` });
      job.done++;
      continue;
    }

    if (!creativeCache.has(ck)) {
      try {
        const body = buildAdCreativeBody({ pageId, content });
        const { data } = await callMetaWithRetry(
          `act_${cleanAccId}/adcreatives`, { method: 'POST', body }, job, `Creative "${content.name || content.key}"`
        );
        creativeCache.set(ck, data.id);
        pushLog(job, 'success', `Đã tạo creative "${content.name || content.key}" (page ${pageId}) → ${data.id}`);
      } catch (err) {
        creativeFailed.set(ck, err.message);
        job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true,
                               error: `Lỗi creative: ${err.message}` });
        job.done++;
        pushLog(job, 'error', `Lỗi tạo creative "${content.name || content.key}": ${err.message}`);
        continue;
      }
      await sleep(L.DELAY_BUILD_CREATIVE_MS || 1200);
    }

    const creativeId = creativeCache.get(ck);
    const adName = renderAdName(plan.namePattern, {
      contentName: content.name,
      adsetName: target.adsetName,
      campaignName: target.campaignName,
      index: adIndex
    });

    const row = { ...baseAdRow(pair, target, content), adName, creativeId, success: false, skipped: false, error: null, retried: false };
    try {
      const { data, retried } = await callMetaWithRetry(
        `act_${cleanAccId}/ads`,
        { method: 'POST', body: buildAdBody({ name: adName, adsetId: target.adsetId, creativeId }) },
        job, `Quảng cáo "${adName}"`
      );
      row.adId = data.id;
      row.success = true;
      row.retried = retried;
      pushLog(job, 'success', `[${adIndex}/${pairs.length}] Đã tạo "${adName}" → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `[${adIndex}/${pairs.length}] Lỗi tạo "${adName}": ${err.message}`);
    }
    job.created.ads.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_AD_MS || 2000);
  }

  job.summary = buildSummary(job);
  pushLog(job, 'success',
    `HOÀN TẤT: ${job.summary.campaignsCreated} chiến dịch · ${job.summary.adsetsCreated} nhóm · ` +
    `${job.summary.adsCreated} quảng cáo (tất cả PAUSED). Thất bại: ${job.summary.failed}.`);
}

function baseAdRow(pair, target, content) {
  return {
    pairKey: pair.pairKey,
    campaignId: target.campaignId,
    campaignName: target.campaignName,
    adsetId: target.adsetId,
    adsetName: target.adsetName,
    contentKey: content.key,
    contentName: content.name || content.key,
    adId: null, creativeId: null, adName: ''
  };
}

function buildSummary(job) {
  const c = job.created || { campaigns: [], adsets: [], ads: [] };
  const adsOk = c.ads.filter(a => a.success).length;
  const byCampaign = {};
  for (const a of c.ads) {
    const k = a.campaignName || a.campaignId || '(không rõ)';
    byCampaign[k] = byCampaign[k] || { success: 0, failed: 0 };
    a.success ? byCampaign[k].success++ : byCampaign[k].failed++;
  }
  return {
    campaignsCreated: c.campaigns.filter(x => x.success).length,
    adsetsCreated:    c.adsets.filter(x => x.success).length,
    adsCreated:       adsOk,
    failed: c.campaigns.filter(x => !x.success).length
          + c.adsets.filter(x => !x.success).length
          + c.ads.filter(x => !x.success).length,
    creativesCreated: new Set(c.ads.filter(a => a.creativeId).map(a => a.creativeId)).size,
    byCampaign
  };
}

/**
 * GET /api/cp/job/:jobId/csv
 * Xuất kết quả đợt chạy UTF-8 BOM.
 */
crossPostRouter.get('/job/:jobId/csv', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).type('text/plain').send('Không tìm thấy tiến trình (có thể đã hết hạn).');

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];

  lines.push('# CHIEN DICH DA TAO');
  lines.push(['Ten', 'Campaign ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.campaigns || []) {
    lines.push([r.name, r.id || '', r.success ? 'Thanh cong' : 'Loi', r.error || ''].map(esc).join(','));
  }

  lines.push('');
  lines.push('# NHOM QUANG CAO DA TAO');
  lines.push(['Ten', 'Adset ID', 'Campaign ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.adsets || []) {
    lines.push([r.name, r.id || '', r.campaignId || '', r.success ? 'Thanh cong' : (r.skipped ? 'Bo qua' : 'Loi'), r.error || ''].map(esc).join(','));
  }

  lines.push('');
  lines.push('# QUANG CAO DA TAO');
  lines.push(['Chien dich', 'Campaign ID', 'Nhom QC', 'Adset ID', 'Noi dung', 'Ten Ad', 'Ad ID', 'Creative ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.ads || []) {
    lines.push([
      r.campaignName, r.campaignId, r.adsetName, r.adsetId, r.contentName,
      r.adName, r.adId || '', r.creativeId || '',
      r.success ? 'Thanh cong' : (r.skipped ? 'Bo qua' : 'Loi'), r.error || ''
    ].map(esc).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ket-qua-${req.params.jobId.slice(0, 8)}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});


