import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROOT_DIR } from './config.js';

export const DEFAULT_SHEET_CSV_URL =
  process.env.GOOGLE_SHEET_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRydyFv8bQYdO4uULwFyVVzpbT_rg7Cz9tyqTFENumKK8XGFMYe033i6CjVFREO4fij0GrWBrgFslcJ/pub?gid=1036843724&single=true&output=csv';

const CACHE_PATH = path.join(ROOT_DIR, 'data', 'leads_cache.json');

/**
 * Robust RFC-4180 CSV line parser supporting quoted fields and embedded commas.
 */
export function parseCsvRows(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Convert Vietnamese date DD/MM/YYYY into YYYY-MM-DD
 */
export function normalizeDate(str) {
  if (!str) return null;
  const cleaned = String(str).trim();
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mon, y] = m;
  return `${y}-${mon.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Format phone number: ensures leading 0, strips non-digits
 */
export function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9) return '0' + digits;
  return digits;
}

/**
 * Fetch and parse Google Sheet leads
 */
export async function fetchGoogleSheetLeads(customUrl = null) {
  const url = customUrl || DEFAULT_SHEET_CSV_URL;
  console.log(`[Google Sheet] Đang tải dữ liệu từ: ${url.slice(0, 80)}...`);

  let csvText;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    csvText = await res.text();
  } catch (err) {
    console.warn(`[Google Sheet] Lỗi tải online (${err.message}). Đang dùng cache...`);
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
    throw err;
  }

  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    throw new Error('Google Sheet không có dữ liệu hoặc cấu trúc không hợp lệ.');
  }

  const headers = rows[0].map(h => h.toLowerCase());
  console.log(`[Google Sheet] Đã đọc ${rows.length - 1} dòng lead.`);

  // Find column indexes
  const col = {
    phone: headers.findIndex(h => h.includes('điện thoại') || h.includes('phone') || h.includes('sđt')),
    fanpage: headers.findIndex(h => h.includes('fanpage')),
    adId: headers.findIndex(h => h.includes('ad id') || h.includes('adid') || h.includes('quảng cáo')),
    entryDate: headers.findIndex(h => h.includes('ngày vào') || h.includes('ngày tạo') || h.includes('thời gian')),
    product: headers.findIndex(h => h.includes('sản phẩm') || h.includes('quan tâm')),
    revenue: headers.findIndex(h => h.includes('doanh thu') || h.includes('học phí')),
    l1Ucmas: headers.findIndex(h => h.includes('l1') && h.includes('ucmas')),
    l1Uckid: headers.findIndex(h => h.includes('l1') && h.includes('uckid')),
    l2Ucmas: headers.findIndex(h => h.includes('l2') && h.includes('ucmas')),
    l2Uckid: headers.findIndex(h => h.includes('l2') && h.includes('uckid')),
    l3Ucmas: headers.findIndex(h => h.includes('l3') && h.includes('ucmas')),
    l3Uckid: headers.findIndex(h => h.includes('l3') && h.includes('uckid')),
    l4Ucmas: headers.findIndex(h => h.includes('l4') && h.includes('ucmas')),
    l4Uckid: headers.findIndex(h => h.includes('l4') && h.includes('uckid'))
  };

  const leads = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawPhone = col.phone >= 0 ? r[col.phone] : r[0];
    const phone = normalizePhone(rawPhone);
    if (!phone) continue;

    const fanpage = (col.fanpage >= 0 ? r[col.fanpage] : '') || '';
    const adId = (col.adId >= 0 ? r[col.adId] : '') || '';
    const entryDate = normalizeDate(col.entryDate >= 0 ? r[col.entryDate] : null);
    const prodRaw = (col.product >= 0 ? r[col.product] : '').toUpperCase();
    const revRaw = col.revenue >= 0 ? r[col.revenue] : '0';
    const revenue = parseFloat(String(revRaw).replace(/[^\d.-]/g, '')) || 0;

    const l1U = normalizeDate(col.l1Ucmas >= 0 ? r[col.l1Ucmas] : null);
    const l1K = normalizeDate(col.l1Uckid >= 0 ? r[col.l1Uckid] : null);
    const l2U = normalizeDate(col.l2Ucmas >= 0 ? r[col.l2Ucmas] : null);
    const l2K = normalizeDate(col.l2Uckid >= 0 ? r[col.l2Uckid] : null);
    const l3U = normalizeDate(col.l3Ucmas >= 0 ? r[col.l3Ucmas] : null);
    const l3K = normalizeDate(col.l3Uckid >= 0 ? r[col.l3Uckid] : null);
    const l4U = normalizeDate(col.l4Ucmas >= 0 ? r[col.l4Ucmas] : null);
    const l4K = normalizeDate(col.l4Uckid >= 0 ? r[col.l4Uckid] : null);

    // Determine target product key
    let product = 'ucmas';
    if (prodRaw.includes('UCKID') || l1K || l4K) {
      product = 'uckid';
    } else if (prodRaw.includes('MATHCA')) {
      product = 'mathca';
    } else if (fanpage.toLowerCase().includes('trại hè') || fanpage.toLowerCase().includes('mùa hè')) {
      product = 'traihe';
    } else if (prodRaw.includes('UCMAS') || l1U || l4U) {
      product = 'ucmas';
    }

    // Determine funnel dates & flags based on detected product
    const isUckid = product === 'uckid';
    const l1Date = isUckid ? (l1K || l1U || entryDate) : (l1U || l1K || entryDate);
    const l2Date = isUckid ? (l2K || l2U) : (l2U || l2K);
    const l3Date = isUckid ? (l3K || l3U) : (l3U || l3K);
    const l4Date = isUckid ? (l4K || l4U) : (l4U || l4K);

    let currentLevel = 'L0';
    if (l4Date) currentLevel = 'L4';
    else if (l3Date) currentLevel = 'L3';
    else if (l2Date) currentLevel = 'L2';
    else if (l1Date) currentLevel = 'L1';

    leads.push({
      id: `${phone}_${entryDate || i}`,
      phone,
      fanpage,
      adId: adId.trim(),
      entryDate: entryDate || l1Date,
      product,
      revenue,
      currentLevel,
      l1: Boolean(l1Date),
      l1Date,
      l2: Boolean(l2Date),
      l2Date,
      l3: Boolean(l3Date),
      l3Date,
      l4: Boolean(l4Date),
      l4Date
    });
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    totalRows: leads.length,
    leads
  };

  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[Google Sheet] Đã lưu cache ${leads.length} leads vào ${CACHE_PATH}`);
  } catch (e) {
    console.warn('[Google Sheet] Không thể ghi cache:', e.message);
  }

  return result;
}

/**
 * Filter and summarize leads for a specific product and date range
 */
export function summarizeLeads(leads = [], { product = 'ALL', startDate = null, endDate = null, adIdSet = null }) {
  const filtered = leads.filter(l => {
    if (product !== 'ALL' && l.product !== product) return false;
    if (adIdSet && adIdSet.size > 0 && l.adId && !adIdSet.has(l.adId)) return false;
    // Date filter: based on lead entry date or L1 date
    const d = l.l1Date || l.entryDate;
    if (startDate && d && d < startDate) return false;
    if (endDate && d && d > endDate) return false;
    return true;
  });

  const l1Count = filtered.filter(l => l.l1).length;
  const l2Count = filtered.filter(l => l.l2).length;
  const l3Count = filtered.filter(l => l.l3).length;
  const l4Count = filtered.filter(l => l.l4).length;
  const revenue = filtered.reduce((s, l) => s + (l.revenue || 0), 0);

  const ratio = (a, b) => (b > 0 ? parseFloat(((a / b) * 100).toFixed(1)) : 0);

  return {
    totalLeads: filtered.length,
    l1Count,
    l2Count,
    l3Count,
    l4Count,
    revenue,
    convL1toL2: ratio(l2Count, l1Count),
    convL2toL3: ratio(l3Count, l2Count),
    convL3toL4: ratio(l4Count, l3Count),
    convTotal: ratio(l4Count, l1Count),
    recentEnrolled: filtered
      .filter(l => l.l4)
      .sort((a, b) => (b.l4Date || '').localeCompare(a.l4Date || ''))
      .slice(0, 10)
  };
}
