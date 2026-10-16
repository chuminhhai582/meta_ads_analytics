import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from './config.js';

/**
 * Published-to-web CSV of the CRM sheet. Set GOOGLE_SHEET_CSV_URL in .env — the literal
 * below is only the historical fallback so an existing install keeps working.
 */
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

    // Determine target product key. Starts as null ON PURPOSE: defaulting to 'ucmas'
    // used to sweep every unrecognised row into UCMAS (998 of 1.142 leads), which
    // inflated UCMAS and starved MATHCA. A row we cannot classify is 'khac', and
    // report.js prefers the product of the matched campaign anyway when there is one.
    let product = null;
    const fanpageLower = fanpage.toLowerCase();
    if (prodRaw.includes('UCKID') || l1K || l4K) {
      product = 'uckid';
    } else if (prodRaw.includes('MATHCA')) {
      product = 'mathca';
    } else if (prodRaw.includes('TRẠI HÈ') || prodRaw.includes('TRAI HE') ||
               fanpageLower.includes('trại hè') || fanpageLower.includes('mùa hè')) {
      product = 'traihe';
    } else if (prodRaw.includes('UCMAS') || l1U || l4U) {
      product = 'ucmas';
    }
    const productFromSheet = product !== null;
    if (product === null) product = 'khac';

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
      productFromSheet,
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
 * The single definition of which date places a lead inside a reporting period.
 * Used by both summarizeLeads() and the aggregation engine in report.js so the two
 * can never disagree about what "leads in the last 7 days" means.
 */
export function leadPeriodDate(lead) {
  return lead.l1Date || lead.entryDate || null;
}

/** True when a lead falls inside [startDate, endDate] (either bound may be null). */
export function leadInRange(lead, startDate = null, endDate = null) {
  if (!startDate && !endDate) return true;
  const d = leadPeriodDate(lead);
  // A lead with no usable date cannot be proven to be in the period — exclude it
  // rather than silently counting it in every range.
  if (!d) return false;
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

/** Empty funnel bucket. Callers accumulate into this shape. */
export function emptyFunnel() {
  return { totalLeads: 0, l1Count: 0, l2Count: 0, l3Count: 0, l4Count: 0, revenue: 0 };
}

/** Accumulate one lead into a bucket created by emptyFunnel(). */
export function addLeadToFunnel(bucket, lead) {
  bucket.totalLeads += 1;
  if (lead.l1) bucket.l1Count += 1;
  if (lead.l2) bucket.l2Count += 1;
  if (lead.l3) bucket.l3Count += 1;
  if (lead.l4) bucket.l4Count += 1;
  bucket.revenue += lead.revenue || 0;
  return bucket;
}

const pct = (a, b) => (b > 0 ? parseFloat(((a / b) * 100).toFixed(1)) : 0);

/** Add the derived conversion rates to a funnel bucket. */
export function withFunnelRates(bucket) {
  return {
    ...bucket,
    convL1toL2: pct(bucket.l2Count, bucket.l1Count),
    convL2toL3: pct(bucket.l3Count, bucket.l2Count),
    convL3toL4: pct(bucket.l4Count, bucket.l3Count),
    convTotal: pct(bucket.l4Count, bucket.l1Count)
  };
}

/**
 * Filter and summarize leads for a specific product and date range.
 * Kept as a standalone utility (CLI, tests); report.js uses a single-pass engine
 * instead so it never has to scan the lead list once per product.
 */
export function summarizeLeads(leads = [], options = {}) {
  const { product = 'ALL', startDate = null, endDate = null, adIdSet = null } = options;

  const filtered = leads.filter(l => {
    if (product !== 'ALL' && l.product !== product) return false;
    if (adIdSet && adIdSet.size > 0 && l.adId && !adIdSet.has(l.adId)) return false;
    return leadInRange(l, startDate, endDate);
  });

  const bucket = filtered.reduce(addLeadToFunnel, emptyFunnel());

  return {
    ...withFunnelRates(bucket),
    recentEnrolled: filtered
      .filter(l => l.l4)
      .sort((a, b) => (b.l4Date || '').localeCompare(a.l4Date || ''))
      .slice(0, 10)
  };
}
