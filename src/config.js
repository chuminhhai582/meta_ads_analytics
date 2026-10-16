import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

/** Default BM "Ucmas Việt Nam" — override with META_BUSINESS_ID in .env (see §1 quy-tac-du-an.md). */
const DEFAULT_BUSINESS_ID = '2590933284556026';

export const config = {
  accessToken: process.env.META_ADS_ACCESS_TOKEN || '',
  adAccountId: (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, ''),
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  businessId: process.env.META_BUSINESS_ID || DEFAULT_BUSINESS_ID,
  apiVersion: process.env.META_API_VERSION || 'v21.0',
  port: parseInt(process.env.PORT || '3000', 10),

  /**
   * Ngày bắt đầu kho dữ liệu. Lần đồng bộ đầu tiên sẽ kéo từ đây tới hôm nay
   * (mất vài phút); các lần sau chỉ kéo phần mới.
   */
  syncStartDate: process.env.SYNC_START_DATE || '2026-01-01',

  /**
   * Số ngày gần nhất LUÔN được kéo lại mỗi lần đồng bộ.
   * Meta quy kết chuyển đổi theo cửa sổ 7 ngày, nên số liệu của những ngày vừa qua
   * còn thay đổi sau khi đã ghi nhận. Chỉ lấy "ngày mới" sẽ bỏ sót phần thay đổi đó.
   */
  retroDays: parseInt(process.env.SYNC_RETRO_DAYS || '7', 10),
  /**
   * Off by default: the dashboard exposes BM spend, revenue and customer phone numbers,
   * so only the machine running it may connect. Set ALLOW_REMOTE=true in .env to open it
   * to the LAN deliberately.
   */
  allowRemote: String(process.env.ALLOW_REMOTE || '').toLowerCase() === 'true',

  hasToken() {
    const t = this.accessToken.trim();
    return Boolean(t && t !== 'your_meta_access_token_here');
  }
};

/**
 * Per-process CSRF token. The browser reads it from GET /api/session (same-origin only,
 * since the server sends no CORS headers) and echoes it in the X-Internal-Token header
 * on every mutating request. A custom header forces a CORS preflight, which a
 * cross-site page cannot satisfy — that is what blocks a hostile site from
 * silently overwriting .env via /api/save-config.
 */
export const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');

/** Strip CR/LF so a value can never inject extra lines into .env, and cap the length. */
function sanitizeEnvValue(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim().slice(0, 1000);
}

/**
 * Update ONLY the given keys in .env (other lines/comments are preserved).
 * Never overwrite the whole file — it holds secrets (see .agents/rules/quy-tac-du-an.md §3).
 * @param {Record<string, string>} updates e.g. { META_ADS_ACCESS_TOKEN: '...' }
 */
export function updateEnvFile(updates) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Tên biến môi trường không hợp lệ: ${key}`);
    }
    const value = sanitizeEnvValue(rawValue);
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
    process.env[key] = value;
    // Keep the live config object in sync so no restart is needed after saving.
    if (key === 'META_ADS_ACCESS_TOKEN') config.accessToken = value;
    if (key === 'META_APP_ID') config.appId = value;
    if (key === 'META_APP_SECRET') config.appSecret = value;
    if (key === 'META_BUSINESS_ID') config.businessId = value;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

/** Validate what /api/save-config accepts before it ever reaches .env. */
export function validateConfigInput({ accessToken, appId, appSecret, sheetUrl }) {
  const updates = {};
  const errors = [];

  if (accessToken && accessToken.trim()) {
    const t = accessToken.trim();
    if (t.length < 30 || /\s/.test(t)) errors.push('Access Token không đúng định dạng (quá ngắn hoặc chứa khoảng trắng).');
    else updates.META_ADS_ACCESS_TOKEN = t;
  }
  if (appId && appId.trim()) {
    const v = appId.trim();
    if (!/^\d{5,25}$/.test(v)) errors.push('App ID phải là dãy số.');
    else updates.META_APP_ID = v;
  }
  if (appSecret && appSecret.trim()) {
    const v = appSecret.trim();
    if (!/^[a-f0-9]{20,64}$/i.test(v)) errors.push('App Secret không đúng định dạng.');
    else updates.META_APP_SECRET = v;
  }
  if (sheetUrl && sheetUrl.trim()) {
    const v = sheetUrl.trim();
    let ok = false;
    try {
      const u = new URL(v);
      ok = u.protocol === 'https:' && u.hostname === 'docs.google.com';
    } catch { ok = false; }
    if (!ok) errors.push('Link Google Sheet phải là URL https://docs.google.com/...');
    else updates.GOOGLE_SHEET_CSV_URL = v;
  }

  return { updates, errors };
}
