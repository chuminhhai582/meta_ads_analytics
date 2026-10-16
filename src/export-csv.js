import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from './config.js';
import { classifyCampaign } from './ai-analyst.js';

const DATA_DIR = path.resolve(ROOT_DIR, 'data');

const STATUS_VI = {
  ACTIVE: 'Đang chạy', PAUSED: 'Tạm dừng', CAMPAIGN_PAUSED: 'CĐ cha tắt', ADSET_PAUSED: 'Nhóm QC tắt',
  ARCHIVED: 'Lưu trữ', DELETED: 'Đã xoá', IN_PROCESS: 'Đang xử lý', WITH_ISSUES: 'Có lỗi'
};

/**
 * Neutralise spreadsheet formula injection. A campaign named "=HYPERLINK(...)" would
 * otherwise execute when the exported CSV is opened in Excel.
 */
function csvSafe(value) {
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

/**
 * Convert JSON array to CSV format.
 * @param {object[]} items
 * @param {{key?: string, label: string, get?: Function}[]} fields
 */
export function convertToCsv(items, fields) {
  if (!items || items.length === 0) return '';

  const header = fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(',');
  const rows = items.map(item => fields.map(f => {
    let val = typeof f.get === 'function' ? f.get(item) : item[f.key];
    if (val === undefined || val === null) val = '';
    if (typeof val === 'number') return val;
    return `"${csvSafe(val).replace(/"/g, '""')}"`;
  }).join(','));

  return [header, ...rows].join('\n');
}

/** UTF-8 BOM so Excel renders Vietnamese correctly. */
export const CSV_BOM = '﻿';

/** Column set for the campaign export — shared by the CLI and GET /api/export/campaigns. */
export function campaignFields(fatigueApplicable = true) {
  return [
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
    { key: 'otherConversions', label: 'Chuyển đổi khác (form/mua)' },
    { key: 'l1Count', label: 'SĐT (L1)' },
    { key: 'cpl', label: 'Giá/SĐT (VND)' },
    { key: 'l3Count', label: 'Hẹn test (L3)' },
    { key: 'l4Count', label: 'Nhập học (L4)' },
    { key: 'cac', label: 'CAC (VND)' },
    { key: 'revenue', label: 'Doanh thu (VND)' },
    { key: 'roas', label: 'ROAS' },
    { key: 'impressions', label: 'Lượt hiển thị' },
    { key: 'clicks', label: 'Lượt click' },
    { key: 'ctr', label: 'CTR (%)' },
    { key: 'cpc', label: 'CPC (VND)' },
    { key: 'cpm', label: 'CPM (VND)' },
    { key: 'frequency', label: 'Tần suất (kỳ đồng bộ)' },
    { label: 'Đánh giá AI', get: c => classifyCampaign(c, fatigueApplicable) }
  ];
}

/** Column set for the per-day export. */
export const dailyFields = [
  { key: 'date', label: 'Ngày' },
  { key: 'spend', label: 'Chi tiêu (VND)' },
  { key: 'messages', label: 'Tin nhắn' },
  { key: 'cpa', label: 'Giá/tin (VND)' },
  { key: 'impressions', label: 'Lượt hiển thị' },
  { key: 'clicks', label: 'Lượt click' }
];

/**
 * Save the raw report (JSON) and the 4-product view (CSV) into data/.
 * CSV files carry a UTF-8 BOM so Excel shows Vietnamese correctly.
 */
export function saveReportFiles(raw, view, outputDir = DATA_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, 'campaigns.csv'),
    CSV_BOM + convertToCsv(view.campaigns, campaignFields(view.fatigueApplicable !== false)),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outputDir, 'daily_performance.csv'),
    CSV_BOM + convertToCsv(view.dailyTrend, dailyFields),
    'utf-8'
  );
  // Raw JSON snapshot (compact — loaded back on server start)
  fs.writeFileSync(path.join(outputDir, 'latest_insights.json'), JSON.stringify(raw), 'utf-8');
}
