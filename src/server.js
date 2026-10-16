import express from 'express';
import path from 'path';
import fs from 'fs';
import { config, ROOT_DIR, updateEnvFile, validateConfigInput, SESSION_TOKEN } from './config.js';
import { fetchRawReport } from './meta-api.js';
import { buildView, DATE_PRESETS } from './report.js';
import { generateAnalysis } from './ai-analyst.js';
import {
  saveReportFiles, convertToCsv, campaignFields, dailyFields, CSV_BOM
} from './export-csv.js';
import { fetchGoogleSheetLeads } from './google-sheet.js';

const dataDir = path.resolve(ROOT_DIR, 'data');
const publicDir = path.resolve(ROOT_DIR, 'public');

const VIEW_CACHE_MAX = 32;

const app = express();
// No cors() on purpose. The dashboard is same-origin, and sending
// `Access-Control-Allow-Origin: *` let any website the user had open read this BM's spend,
// revenue and customer phone numbers. See quy-tac-du-an.md §3.
app.disable('x-powered-by');

/**
 * Loopback-only access control.
 *
 * Binding the socket to 127.0.0.1 would also keep LAN clients out, but then a browser
 * pointed at http://localhost tries ::1 first, waits for it to fail and only then
 * retries IPv4 — measured at +215ms on every single request. So the socket listens on
 * both loopback families and the guard below rejects anything that is not loopback.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isLoopback(ip) {
  return Boolean(ip) && (LOOPBACK.has(ip) || ip.startsWith('127.'));
}

app.use((req, res, next) => {
  if (config.allowRemote || isLoopback(req.socket.remoteAddress)) return next();
  console.warn(`[Server] Từ chối truy cập từ ${req.socket.remoteAddress} → ${req.method} ${req.originalUrl}`);
  res.status(403).type('text/plain').send('Dashboard này chỉ chạy nội bộ trên máy cài đặt.');
});

app.use(express.json({ limit: '256kb' }));
app.use(express.static(publicDir));

// Raw report cached in memory (format version 3, see PROJECT_CONTEXT.md §7)
let rawReport = null;
let syncInFlight = null;

/** product|accountId|datePreset → { view, analysis }. Cleared whenever rawReport changes. */
const viewCache = new Map();

function cacheKey({ product, accountId, datePreset, activeTab }) {
  return [product, accountId, datePreset, activeTab].join('|');
}

function invalidateViewCache() {
  viewCache.clear();
}

/**
 * Mutating endpoints require the per-process token served by GET /api/session.
 * A custom header forces a CORS preflight that a cross-site page cannot satisfy, so a
 * hostile tab cannot silently POST a new Access Token into .env.
 */
function requireSessionToken(req, res, next) {
  const sent = req.get('X-Internal-Token');
  if (sent !== SESSION_TOKEN) {
    return res.status(403).json({
      error: 'Phiên không hợp lệ. Vui lòng tải lại trang (F5) rồi thử lại.',
      code: 'BAD_SESSION'
    });
  }
  next();
}

// Load last snapshot & leads cache on server start
function loadSnapshot() {
  const jsonPath = path.join(dataDir, 'latest_insights.json');
  const leadsPath = path.join(dataDir, 'leads_cache.json');

  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      // v2: chưa có adMap (lead không ghép được chiến dịch).
      // v3: có adMap nhưng chưa có coverage → lần đồng bộ sau sẽ kéo lại toàn bộ.
      // v4: có coverage → đồng bộ chỉ lấy phần mới.
      // Bản cũ vẫn hiển thị được; buildView tự thêm ghi chú nhắc đồng bộ lại.
      if (parsed.version >= 2 && parsed.version <= 4) rawReport = parsed;
      else console.warn(`[Server] Bỏ qua snapshot schema v${parsed.version} (không hỗ trợ).`);
    } catch (e) {
      console.warn('[Server] Lỗi đọc latest_insights.json:', e.message);
    }
  }

  if (!rawReport) return;

  if (fs.existsSync(leadsPath)) {
    try {
      const leadCache = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
      rawReport.leadsRecords = leadCache.leads || [];
      console.log(`[Server] Đã nạp ${rawReport.leadsRecords.length} leads từ cache.`);
    } catch (e) {
      console.warn('[Server] Lỗi đọc leads_cache.json:', e.message);
    }
  } else {
    // Async initial fetch — don't block startup on the network.
    fetchGoogleSheetLeads()
      .then(res => {
        if (rawReport) {
          rawReport.leadsRecords = res.leads || [];
          invalidateViewCache();
        }
      })
      .catch(err => console.warn('[Server] Không thể tải Google Sheet ban đầu:', err.message));
  }
}
loadSnapshot();

/** Normalize the filter params any endpoint may receive. */
function readOptions(source) {
  const activeTab = source.tab || source.activeTab || 'all';
  return {
    activeTab,
    product: source.product || source.productFilter || (activeTab !== 'all' ? activeTab : 'ALL'),
    accountId: source.accountId || 'ALL',
    datePreset: DATE_PRESETS.includes(source.datePreset)
      ? source.datePreset
      : (rawReport?.datePreset || 'last_30d')
  };
}

/** Build (or reuse) the view+analysis pair for a set of filters. */
function getViewAndAnalysis(options) {
  const key = cacheKey(options);
  const hit = viewCache.get(key);
  if (hit) return hit;

  const view = buildView(rawReport, options);
  const analysis = generateAnalysis(view);
  const entry = { view, analysis };

  if (viewCache.size >= VIEW_CACHE_MAX) {
    viewCache.delete(viewCache.keys().next().value);
  }
  viewCache.set(key, entry);
  return entry;
}

function respondWithView(res, options = {}, extra = {}) {
  if (!rawReport) {
    return res.status(409).json({
      success: false,
      error: 'Chưa có dữ liệu đồng bộ. Bấm "Đồng bộ" để tải dữ liệu từ Meta.',
      needsSync: true
    });
  }
  const { view, analysis } = getViewAndAnalysis(readOptions(options));
  res.json({ ...extra, view, analysis });
}

/**
 * GET /api/session — hands the same-origin page its CSRF token.
 * Readable only from this origin, because the server sends no CORS headers.
 */
app.get('/api/session', (req, res) => {
  res.json({ token: SESSION_TOKEN, apiVersion: config.apiVersion, businessId: config.businessId });
});

/**
 * GET /api/data?product=...&accountId=...&datePreset=...&tab=...
 * Slices the in-memory Local Data Lake by product, account, and date range (no Meta call).
 */
app.get('/api/data', (req, res) => {
  if (!config.hasToken() && !rawReport) return res.json({ needsConfig: true });
  if (!rawReport) return res.json({ needsSync: true });
  respondWithView(res, req.query);
});

/**
 * POST /api/sync
 * Pulls fresh data from Meta Marketing API for ALL accounts in the BM AND Google Sheet leads.
 */
app.post('/api/sync', requireSessionToken, async (req, res) => {
  let metaError = null;
  let leadsCount = 0;

  try {
    // 1. Fetch Google Sheet leads in parallel
    const sheetPromise = fetchGoogleSheetLeads()
      .then(r => {
        leadsCount = r.leads?.length || 0;
        return r.leads || [];
      })
      .catch(err => {
        console.warn('[Sync] Lỗi kéo Google Sheet:', err.message);
        return rawReport?.leadsRecords || [];
      });

    // 2. Fetch Meta Ads.
    //    Lần đầu (chưa có coverage) kéo từ config.syncStartDate tới hôm nay — mất vài phút.
    //    Các lần sau chỉ kéo phần mới + lùi lại config.retroDays ngày, vì Meta còn
    //    ghi nhận thêm chuyển đổi cho những ngày vừa qua. Xem planSync() trong meta-api.js.
    const metaPromise = (async () => {
      try {
        if (!syncInFlight) {
          syncInFlight = fetchRawReport('ALL', { previous: rawReport })
            .finally(() => { syncInFlight = null; });
        }
        return await syncInFlight;
      } catch (err) {
        metaError = err.message;
        console.warn('[Sync] Lỗi kéo Meta Ads (dùng cache hiện tại):', err.message);
        return rawReport; // Fallback to existing snapshot
      }
    })();

    const [freshLeads, freshRaw] = await Promise.all([sheetPromise, metaPromise]);

    if (!freshRaw) {
      throw new Error(`Đồng bộ thất bại: ${metaError || 'Không có dữ liệu quảng cáo'}`);
    }

    rawReport = freshRaw;
    rawReport.leadsRecords = freshLeads;
    invalidateViewCache();

    // Save full data lake snapshot and CSV
    saveReportFiles(rawReport, buildView(rawReport, { product: 'ALL', accountId: 'ALL', datePreset: 'last_30d' }));

    const msg = metaError
      ? `Đã cập nhật ${leadsCount} leads từ Google Sheet. (Meta API: ${metaError})`
      : (() => {
          const ls = rawReport.lastSync || {};
          const what = ls.mode === 'full' ? 'Kéo toàn bộ kho dữ liệu' : 'Cập nhật phần mới';
          return `${what} ${ls.since || ''} → ${ls.until || ''} cho ${rawReport.bmAccounts?.length || 0} tài khoản ` +
                 `(${(ls.newRows || 0).toLocaleString('vi-VN')} dòng) & ${leadsCount} leads Google Sheet. Xong trong ${ls.seconds || '?'}s.`;
        })();

    respondWithView(res, req.body, {
      success: true,
      message: msg,
      metaWarning: Boolean(metaError)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync-sheet — refresh Google Sheet leads only (fast: ~0.3s, no Meta call).
 */
app.post('/api/sync-sheet', requireSessionToken, async (req, res) => {
  if (!rawReport) {
    return res.status(409).json({
      success: false,
      error: 'Chưa có dữ liệu quảng cáo. Bấm "Đồng bộ" đầy đủ trước khi làm mới riêng Google Sheet.',
      needsSync: true
    });
  }
  try {
    const sheetData = await fetchGoogleSheetLeads();
    rawReport.leadsRecords = sheetData.leads || [];
    invalidateViewCache();
    respondWithView(res, req.body, {
      success: true,
      message: `Đã cập nhật ${sheetData.leads?.length || 0} leads từ Google Sheet thành công!`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/save-config — save Token & App credentials into .env (validated first).
 */
app.post('/api/save-config', requireSessionToken, (req, res) => {
  try {
    const { updates, errors } = validateConfigInput(req.body || {});
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Chưa có thông tin nào để lưu.' });
    }
    updateEnvFile(updates);
    res.json({ success: true, message: 'Đã lưu cấu hình an toàn vào .env' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Exports. These paths are the ones public/index.html links to.
// ---------------------------------------------------------------------------

function exportView(req) {
  return getViewAndAnalysis(readOptions(req.query)).view;
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(CSV_BOM + csv);
}

function requireData(res) {
  if (rawReport) return true;
  res.status(409).json({ error: 'Chưa có dữ liệu để xuất. Bấm "Đồng bộ" trước.' });
  return false;
}

/** GET /api/export/campaigns — campaign table as CSV (Excel-friendly). */
app.get('/api/export/campaigns', (req, res) => {
  if (!requireData(res)) return;
  const view = exportView(req);
  sendCsv(
    res,
    `chien_dich_${view.product}_${view.datePreset}.csv`,
    convertToCsv(view.campaigns, campaignFields(view.fatigueApplicable !== false))
  );
});

/** GET /api/export/daily — per-day performance as CSV. */
app.get('/api/export/daily', (req, res) => {
  if (!requireData(res)) return;
  const view = exportView(req);
  sendCsv(
    res,
    `theo_ngay_${view.product}_${view.datePreset}.csv`,
    convertToCsv(view.dailyTrend, dailyFields)
  );
});

/** GET /api/export/json — the sliced view as JSON (no raw phone numbers). */
app.get('/api/export/json', (req, res) => {
  if (!requireData(res)) return;
  const view = exportView(req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="du_lieu_${view.product}_${view.datePreset}.json"`);
  res.send(JSON.stringify(view, null, 2));
});

/** Kept for backwards compatibility with older bookmarks. */
app.get('/api/export-csv', (req, res) => {
  if (!requireData(res)) return;
  const view = exportView(req);
  sendCsv(
    res,
    `bao_cao_meta_ads_${view.product}_${view.datePreset}.csv`,
    convertToCsv(view.campaigns, campaignFields(view.fatigueApplicable !== false))
  );
});

// Serve token guide document
app.get('/docs/huong-dan-token', (req, res) => {
  const docPath = path.resolve(ROOT_DIR, 'HUONG_DAN_LAY_TOKEN_META.md');
  if (fs.existsSync(docPath)) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(docPath);
  } else {
    res.status(404).send('Không tìm thấy tài liệu hướng dẫn.');
  }
});

// Unknown API route → real 404 JSON. Without this the SPA fallback below answered every
// mistyped endpoint with 200 + index.html, which is how three broken export links in
// index.html went unnoticed.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Không tìm thấy endpoint ${req.method} /api${req.path}` });
});

// Single Page App fallback
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handler — never leak a stack trace (it can contain the access token).
app.use((err, req, res, _next) => {
  console.error('[Server] Lỗi không mong đợi:', err.message);
  res.status(500).json({ error: 'Lỗi nội bộ của server. Xem log để biết chi tiết.' });
});

// Start express server. The socket accepts both loopback families (so `localhost`
// resolves instantly either way); the guard above is what keeps the LAN out.
app.listen(config.port, () => {
  console.log(`\n====================================================`);
  console.log(`🚀 Meta Ads Analytics Dashboard đang chạy tại:`);
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`   BM: ${config.businessId} | Token: ${config.hasToken() ? 'đã cấu hình' : 'CHƯA CẤU HÌNH'}`);
  console.log(`   Truy cập: ${config.allowRemote ? '⚠️  MỞ RA MẠNG LAN (ALLOW_REMOTE=true)' : 'chỉ từ máy này (loopback)'}`);
  console.log(`====================================================\n`);
});
