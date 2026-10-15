import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config, ROOT_DIR, updateEnvFile } from './config.js';
import { fetchRawReport } from './meta-api.js';
import { buildView } from './report.js';
import { generateAnalysis } from './ai-analyst.js';
import { saveReportFiles } from './export-csv.js';

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

// Load last snapshot on server start
function loadSnapshot() {
  const jsonPath = path.join(dataDir, 'latest_insights.json');
  if (!fs.existsSync(jsonPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (parsed.version === 2) rawReport = parsed;
    else console.log('[Server] Snapshot định dạng cũ, cần đồng bộ lại.');
  } catch (e) {
    console.warn('[Server] Lỗi đọc latest_insights.json:', e.message);
  }
}
loadSnapshot();

function respondWithView(res, options = {}, extra = {}) {
  const view = buildView(rawReport, options);
  const analysis = generateAnalysis(view);
  res.json({ ...extra, view, analysis });
}

/**
 * GET /api/data?product=...&accountId=...&datePreset=...
 * Slices the in-memory Local Data Lake by product, account, and date range in < 5ms (no Meta call).
 */
app.get('/api/data', (req, res) => {
  if (!config.hasToken()) return res.json({ needsConfig: true });
  if (!rawReport) return res.json({ needsSync: true });

  const product = req.query.product || 'ALL';
  const accountId = req.query.accountId || 'ALL';
  const datePreset = VALID_PRESETS.includes(req.query.datePreset) ? req.query.datePreset : (rawReport.datePreset || 'last_30d');

  respondWithView(res, { product, accountId, datePreset });
});

/**
 * POST /api/sync
 * Pulls fresh data from Meta Marketing API for ALL 10 accounts in BM.
 * This is the ONLY endpoint that makes external API calls to Meta.
 */
app.post('/api/sync', async (req, res) => {
  const datePreset = VALID_PRESETS.includes(req.body.datePreset) ? req.body.datePreset : 'last_30d';
  const accountId = req.body.accountId || 'ALL';
  const product = req.body.productFilter || 'ALL';

  try {
    // Coalesce concurrent sync triggers into a single Meta sync
    if (!syncInFlight) {
      syncInFlight = fetchRawReport('ALL', 'last_30d').finally(() => { syncInFlight = null; });
    }
    rawReport = await syncInFlight;

    // Save full data lake snapshot and CSV
    saveReportFiles(rawReport, buildView(rawReport, { product: 'ALL', accountId: 'ALL', datePreset: 'last_30d' }));

    respondWithView(res, { product, accountId, datePreset }, {
      success: true,
      message: `Đồng bộ toàn bộ BM (${rawReport.bmAccounts?.length || 10} tài khoản) thành công!`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/save-config - Save Token & App credentials into .env (only the given keys)
 */
app.post('/api/save-config', (req, res) => {
  const { accessToken, appId, appSecret } = req.body;
  if (!accessToken || !accessToken.trim()) {
    return res.status(400).json({ error: 'Vui lòng cung cấp Access Token của Meta' });
  }
  try {
    const updates = { META_ADS_ACCESS_TOKEN: accessToken.trim() };
    if (appId && appId.trim()) updates.META_APP_ID = appId.trim();
    if (appSecret && appSecret.trim()) updates.META_APP_SECRET = appSecret.trim();
    updateEnvFile(updates);

    config.accessToken = updates.META_ADS_ACCESS_TOKEN;
    if (updates.META_APP_ID) config.appId = updates.META_APP_ID;
    if (updates.META_APP_SECRET) config.appSecret = updates.META_APP_SECRET;

    res.json({ success: true, message: 'Đã lưu cấu hình vào .env' });
  } catch (err) {
    res.status(500).json({ error: 'Không thể ghi file .env: ' + err.message });
  }
});

/**
 * GET /api/export/:fileType - Download CSV or JSON
 */
app.get('/api/export/:fileType', (req, res) => {
  const files = { campaigns: 'campaigns.csv', daily: 'daily_performance.csv', json: 'latest_insights.json' };
  const filename = files[req.params.fileType];
  if (!filename) return res.status(400).send('File type không hợp lệ');

  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Chưa có file dữ liệu để tải. Hãy đồng bộ trước.');
  res.download(filePath, filename);
});

/**
 * GET /docs/huong-dan-token - Token guide
 */
app.get('/docs/huong-dan-token', (req, res) => {
  res.type('text/plain; charset=utf-8').sendFile(path.join(ROOT_DIR, 'HUONG_DAN_LAY_TOKEN_META.md'));
});

/**
 * GET /auth/login - Redirect to Facebook OAuth with App ID
 */
app.get('/auth/login', (req, res) => {
  const appId = config.appId || '1512128683054595';
  const redirectUri = encodeURIComponent(`http://localhost:${config.port}/auth/callback`);
  const scope = encodeURIComponent('ads_read,read_insights,ads_management');
  res.redirect(`https://www.facebook.com/${config.apiVersion}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`);
});

/**
 * GET /auth/callback - OAuth Callback receiver (exchanges code → 60-day token)
 */
app.get('/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const page = (title, body) => `<div style="font-family:sans-serif;padding:30px;max-width:600px;margin:0 auto">
    <h2>${title}</h2>${body}<p><a href="/">← Quay lại Dashboard</a></p></div>`;

  if (error) return res.status(400).send(page('Lỗi đăng nhập Meta', `<p>${String(error_description || error)}</p>`));
  if (!code) return res.status(400).send(page('Không nhận được mã xác thực (code)', ''));

  const appId = config.appId || '1512128683054595';
  if (!config.appSecret) {
    return res.send(page('Thiếu App Secret',
      `<p>Điền <code>META_APP_SECRET</code> vào file <code>.env</code> rồi thử lại, hoặc lấy token tại
       <a href="https://developers.facebook.com/tools/explorer/?app_id=${appId}" target="_blank">Graph API Explorer</a>.</p>`));
  }

  try {
    const exchange = async (params) => {
      const url = new URL(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`);
      for (const [k, v] of Object.entries({ client_id: appId, client_secret: config.appSecret, ...params })) url.searchParams.set(k, v);
      const data = await (await fetch(url)).json();
      if (data.error) throw new Error(data.error.message);
      return data.access_token;
    };

    let token = await exchange({ redirect_uri: `http://localhost:${config.port}/auth/callback`, code });
    try {
      token = await exchange({ grant_type: 'fb_exchange_token', fb_exchange_token: token });
    } catch (e) {
      console.warn('Không thể nâng cấp token 60 ngày:', e.message);
    }

    updateEnvFile({ META_ADS_ACCESS_TOKEN: token });
    config.accessToken = token;
    res.redirect('/?auth=success');
  } catch (err) {
    res.status(500).send(page('Lỗi đổi token', `<p>${err.message}</p>`));
  }
});

// Start Express server
app.listen(config.port, () => {
  console.log('====================================================');
  console.log('🚀 Meta Ads Analytics Dashboard đang chạy tại:');
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`   BM: ${config.businessId} | Token: ${config.hasToken() ? 'đã cấu hình' : 'CHƯA cấu hình'}`);
  console.log('====================================================');
});
