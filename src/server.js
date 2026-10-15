import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config, ROOT_DIR, updateEnvFile } from './config.js';
import { fetchRawReport } from './meta-api.js';
import { buildView } from './report.js';
import { generateAnalysis } from './ai-analyst.js';
import { saveReportFiles } from './export-csv.js';
import { fetchGoogleSheetLeads, DEFAULT_SHEET_CSV_URL } from './google-sheet.js';

const dataDir = path.resolve(ROOT_DIR, 'data');
const publicDir = path.resolve(ROOT_DIR, 'public');
const VALID_PRESETS = ['last_30d', 'last_14d', 'last_7d', 'this_month', 'yesterday', 'today'];

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// Raw report cached in memory (format version 2, see PROJECT_CONTEXT.md §7)
let rawReport = null;
let syncInFlight = null;

// Load last snapshot & leads cache on server start
function loadSnapshot() {
  const jsonPath = path.join(dataDir, 'latest_insights.json');
  const leadsPath = path.join(dataDir, 'leads_cache.json');

  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (parsed.version === 2) rawReport = parsed;
    } catch (e) {
      console.warn('[Server] Lỗi đọc latest_insights.json:', e.message);
    }
  }

  // Load leads cache
  if (rawReport) {
    if (fs.existsSync(leadsPath)) {
      try {
        const leadCache = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
        rawReport.leadsRecords = leadCache.leads || [];
        console.log(`[Server] Đã nạp ${rawReport.leadsRecords.length} leads từ cache.`);
      } catch (e) {
        console.warn('[Server] Lỗi đọc leads_cache.json:', e.message);
      }
    } else {
      // Async initial fetch
      fetchGoogleSheetLeads()
        .then(res => {
          if (rawReport) rawReport.leadsRecords = res.leads || [];
        })
        .catch(err => console.warn('[Server] Không thể tải Google Sheet ban đầu:', err.message));
    }
  }
}
loadSnapshot();

function respondWithView(res, options = {}, extra = {}) {
  const view = buildView(rawReport, options);
  const analysis = generateAnalysis(view);
  res.json({ ...extra, view, analysis });
}

/**
 * GET /api/data?product=...&accountId=...&datePreset=...&tab=...
 * Slices the in-memory Local Data Lake by product, account, and date range in < 5ms (no Meta call).
 */
app.get('/api/data', (req, res) => {
  if (!config.hasToken() && !rawReport) return res.json({ needsConfig: true });
  if (!rawReport) return res.json({ needsSync: true });

  const activeTab = req.query.tab || 'all';
  const product = req.query.product || (activeTab !== 'all' ? activeTab : 'ALL');
  const accountId = req.query.accountId || 'ALL';
  const datePreset = VALID_PRESETS.includes(req.query.datePreset) ? req.query.datePreset : (rawReport.datePreset || 'last_30d');

  respondWithView(res, { product, accountId, datePreset, activeTab });
});

/**
 * POST /api/sync
 * Pulls fresh data from Meta Marketing API for ALL 10 accounts in BM AND Google Sheet leads.
 */
app.post('/api/sync', async (req, res) => {
  const datePreset = VALID_PRESETS.includes(req.body.datePreset) ? req.body.datePreset : 'last_30d';
  const accountId = req.body.accountId || 'ALL';
  const product = req.body.productFilter || 'ALL';
  const activeTab = req.body.activeTab || 'all';

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

    // 2. Fetch Meta Ads
    const metaPromise = (async () => {
      try {
        if (!syncInFlight) {
          syncInFlight = fetchRawReport('ALL', 'last_30d').finally(() => { syncInFlight = null; });
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

    // Save full data lake snapshot and CSV
    saveReportFiles(rawReport, buildView(rawReport, { product: 'ALL', accountId: 'ALL', datePreset: 'last_30d' }));

    const msg = metaError
      ? `Đã cập nhật ${leadsCount} leads từ Google Sheet. (Meta API: ${metaError})`
      : `Đồng bộ toàn bộ BM (${rawReport.bmAccounts?.length || 10} tài khoản) & ${leadsCount} leads Google Sheet thành công!`;

    respondWithView(res, { product, accountId, datePreset, activeTab }, {
      success: true,
      message: msg,
      metaWarning: Boolean(metaError)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync-sheet - Refresh Google Sheet leads only (super fast: ~0.3s)
 */
app.post('/api/sync-sheet', async (req, res) => {
  try {
    const sheetData = await fetchGoogleSheetLeads();
    if (rawReport) {
      rawReport.leadsRecords = sheetData.leads || [];
    }
    const activeTab = req.body.activeTab || 'all';
    respondWithView(res, { activeTab }, {
      success: true,
      message: `Đã cập nhật ${sheetData.leads?.length || 0} leads từ Google Sheet thành công!`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/save-config - Save Token & App credentials into .env
 */
app.post('/api/save-config', (req, res) => {
  const { accessToken, appId, appSecret, sheetUrl } = req.body;
  try {
    const updates = {};
    if (accessToken && accessToken.trim()) updates.META_ADS_ACCESS_TOKEN = accessToken.trim();
    if (appId && appId.trim()) updates.META_APP_ID = appId.trim();
    if (appSecret && appSecret.trim()) updates.META_APP_SECRET = appSecret.trim();
    if (sheetUrl && sheetUrl.trim()) updates.GOOGLE_SHEET_CSV_URL = sheetUrl.trim();

    updateEnvFile(updates);
    res.json({ success: true, message: 'Đã lưu cấu hình an toàn vào .env' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/export-csv - Download CSV report
 */
app.get('/api/export-csv', (req, res) => {
  if (!rawReport) return res.status(404).send('Chưa có dữ liệu để xuất');
  const product = req.query.product || 'ALL';
  const accountId = req.query.accountId || 'ALL';
  const datePreset = req.query.datePreset || 'last_30d';

  const view = buildView(rawReport, { product, accountId, datePreset });
  const rows = [
    ['ID Chiến dịch', 'Tên chiến dịch', 'Tài khoản', 'Sản phẩm', 'Trạng thái', 'Ngân sách/ngày (₫)', 'Chi tiêu (₫)', 'Tin nhắn', 'CPA (₫)', 'Hiển thị', 'Clicks', 'CTR (%)']
  ];
  view.campaigns.forEach(c => {
    rows.push([
      `"${c.id}"`,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.accountName || c.accountId}"`,
      `"${c.productLabel}"`,
      `"${c.effective_status}"`,
      c.expectedDailyBudget || 0,
      c.spend || 0,
      c.messages || 0,
      c.cpa || 0,
      c.impressions || 0,
      c.clicks || 0,
      c.ctr || 0
    ]);
  });
  const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=bao_cao_meta_ads_${product}_${datePreset}.csv`);
  res.send(csvContent);
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

// Single Page App fallback
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start express server
app.listen(config.port, () => {
  console.log(`\n====================================================`);
  console.log(`🚀 Meta Ads Analytics Dashboard đang chạy tại:`);
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`   BM: ${config.businessId} | Token: ${config.hasToken() ? 'đã cấu hình' : 'CHƯA CẤU HÌNH'}`);
  console.log(`====================================================\n`);
});
