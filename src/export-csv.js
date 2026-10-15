import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyCampaign } from './ai-analyst.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

const STATUS_VI = {
  ACTIVE: 'Đang chạy', PAUSED: 'Tạm dừng', CAMPAIGN_PAUSED: 'CĐ cha tắt', ADSET_PAUSED: 'Nhóm QC tắt',
  ARCHIVED: 'Lưu trữ', DELETED: 'Đã xoá', IN_PROCESS: 'Đang xử lý', WITH_ISSUES: 'Có lỗi'
};

/**
 * Convert JSON array to CSV format
 */
export function convertToCsv(items, fields) {
  if (!items || items.length === 0) return '';

  const header = fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(',');
  const rows = items.map(item => fields.map(f => {
    let val = typeof f.get === 'function' ? f.get(item) : item[f.key];
    if (val === undefined || val === null) val = '';
    if (typeof val === 'number') return val;
    return `"${String(val).replace(/"/g, '""')}"`;
  }).join(','));

  return [header, ...rows].join('\n');
}

/**
 * Save the raw report (JSON) and the 4-product view (CSV) into data/.
 * CSV files carry a UTF-8 BOM so Excel shows Vietnamese correctly.
 */
export function saveReportFiles(raw, view, outputDir = DATA_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. Campaigns (4 target products only)
  const campaignFields = [
    { key: 'id', label: 'Campaign ID' },
    { key: 'name', label: 'Tên chiến dịch' },
    { key: 'productLabel', label: 'Sản phẩm' },
    { key: 'accountName', label: 'Tài khoản' },
    { label: 'Trạng thái', get: c => STATUS_VI[c.effective_status] || c.effective_status },
    { key: 'budgetType', label: 'Loại ngân sách' },
    { key: 'expectedDailyBudget', label: 'Ngân sách/ngày (VND)' },
    { key: 'todaySpend', label: 'Chi hôm nay (VND)' },
    { key: 'todayMessages', label: 'Tin nhắn hôm nay' },
    { key: 'spend', label: 'Chi tiêu kỳ (VND)' },
    { key: 'messages', label: 'Tin nhắn kỳ' },
    { key: 'cpa', label: 'Giá/tin (VND)' },
    { key: 'impressions', label: 'Lượt hiển thị' },
    { key: 'clicks', label: 'Lượt click' },
    { key: 'ctr', label: 'CTR (%)' },
    { key: 'cpc', label: 'CPC (VND)' },
    { key: 'cpm', label: 'CPM (VND)' },
    { key: 'frequency', label: 'Tần suất' },
    { label: 'Đánh giá AI', get: c => classifyCampaign(c) }
  ];
  fs.writeFileSync(path.join(outputDir, 'campaigns.csv'), '\uFEFF' + convertToCsv(view.campaigns, campaignFields), 'utf-8');

  // 2. Daily performance (4 target products combined)
  const dailyFields = [
    { key: 'date', label: 'Ngày' },
    { key: 'spend', label: 'Chi tiêu (VND)' },
    { key: 'messages', label: 'Tin nhắn' },
    { key: 'cpa', label: 'Giá/tin (VND)' },
    { key: 'impressions', label: 'Lượt hiển thị' },
    { key: 'clicks', label: 'Lượt click' }
  ];
  fs.writeFileSync(path.join(outputDir, 'daily_performance.csv'), '\uFEFF' + convertToCsv(view.dailyTrend, dailyFields), 'utf-8');

  // 3. Raw JSON snapshot (compact — loaded back on server start)
  fs.writeFileSync(path.join(outputDir, 'latest_insights.json'), JSON.stringify(raw), 'utf-8');
}
