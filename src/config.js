import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

export const config = {
  accessToken: process.env.META_ADS_ACCESS_TOKEN || '',
  adAccountId: (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, ''),
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  businessId: process.env.META_BUSINESS_ID || '2590933284556026',
  apiVersion: process.env.META_API_VERSION || 'v21.0',
  port: parseInt(process.env.PORT || '3000', 10),

  hasToken() {
    const t = this.accessToken.trim();
    return Boolean(t && t !== 'your_meta_access_token_here');
  }
};

/**
 * Update ONLY the given keys in .env (other lines/comments are preserved).
 * Never overwrite the whole file — it holds secrets (see .agents/rules/quy-tac-du-an.md §3).
 * @param {Record<string, string>} updates e.g. { META_ADS_ACCESS_TOKEN: '...' }
 */
export function updateEnvFile(updates) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
    process.env[key] = String(value);
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}
