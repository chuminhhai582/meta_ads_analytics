/**
 * Launcher for Meta Ads MCP Server
 * Loads environment variables from .env and starts @mikusnuz/meta-ads-mcp
 */
import 'dotenv/config';

// Validate required environment variables
const token = process.env.META_ADS_ACCESS_TOKEN;
const accountId = process.env.META_AD_ACCOUNT_ID;

if (!token || !accountId || token === 'your_meta_access_token_here') {
  console.error('[Meta Ads MCP] CẢNH BÁO: Chưa cấu hình META_ADS_ACCESS_TOKEN hoặc META_AD_ACCOUNT_ID trong file .env');
  console.error('[Meta Ads MCP] Vui lòng mở file .env và điền thông tin tài khoản quảng cáo Meta.');
}

// Clean account ID if user accidentally kept 'act_' prefix
if (process.env.META_AD_ACCOUNT_ID && process.env.META_AD_ACCOUNT_ID.startsWith('act_')) {
  process.env.META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID.replace('act_', '');
}

// Start MCP Server
import('@mikusnuz/meta-ads-mcp').catch((err) => {
  console.error('[Meta Ads MCP] Lỗi khi khởi động MCP server:', err);
  process.exit(1);
});
