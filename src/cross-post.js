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

function newJob(total) {
  const id = crypto.randomUUID();
  jobs.set(id, { status: 'running', done: 0, total, results: [], error: null, at: Date.now() });
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
  DELAY_TARGET_MS:       2500
};

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
 * Danh sách chiến dịch của 1 tài khoản
 */
crossPostRouter.get('/ad-accounts/:accountId/campaigns', async (req, res) => {
  const { accountId } = req.params;
  const cleanId = accountId.replace(/^act_/, '');

  try {
    const result = await callMeta(`/act_${cleanId}/campaigns`, {
      params: {
        fields: 'id,name,objective,status,effective_status',
        effective_status: "['ACTIVE','PAUSED']",
        limit: 50
      }
    });

    res.json({ ok: true, campaigns: result.data || [] });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy chiến dịch act_${cleanId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
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
  targeting = {}, optimizationGoal = 'CONVERSATIONS'
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

  return {
    name: String(name).trim(),
    campaign_id: campaignId,
    status: 'PAUSED',              // BẮT BUỘC — không bao giờ tạo ở trạng thái chạy
    optimization_goal: optimizationGoal,
    billing_event: 'IMPRESSIONS',
    daily_budget: String(Math.round(Number(dailyBudget))),
    promoted_object: { page_id: pageId },
    targeting: finalTargeting
  };
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

