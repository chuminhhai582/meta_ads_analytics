/**
 * Regression tests for the metrics that the 2026-10-16 audit found wrong.
 * Run with: npm test
 *
 * These use a small hand-built snapshot, not the live data file, so they stay valid
 * after any sync. Each test names the audit finding it locks down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildView, getDateRange, getVietnamDateString, maskPhone } from '../src/report.js';
import { detectProduct, extractConversions, TARGET_KEYS } from '../src/meta-api.js';
import { parseCsvRows, normalizeDate, normalizePhone, summarizeLeads, leadInRange } from '../src/google-sheet.js';
import { classifyCampaign, THRESHOLDS } from '../src/ai-analyst.js';
import { convertToCsv } from '../src/export-csv.js';

// ---------------------------------------------------------------------------
// Fixture: 2 accounts, 3 campaigns, leads both matched and unmatched.
// ---------------------------------------------------------------------------
const TODAY = getVietnamDateString();
const { yesterdayStr: YESTERDAY } = getDateRange('last_30d');

function makeSnapshot() {
  return {
    version: 3,
    fetchedAt: new Date().toISOString(),
    datePreset: 'last_30d',
    syncWindow: 'last_30d',
    scope: { businessId: 'BM1', accountId: 'ALL', name: 'Toàn BM', currency: 'VND' },
    bmAccounts: [
      { id: 'act_100', numericId: '100', name: 'TK 1', rawName: '1', currency: 'VND' },
      { id: 'act_200', numericId: '200', name: 'TK 2', rawName: '2', currency: 'VND' }
    ],
    // adId → campaignId
    adMap: { AD_A: 'C1', AD_B: 'C2', AD_C: 'C3' },
    campaigns: [
      { id: 'C1', name: 'hai/ucmas/mess/a', accountId: '100', accountName: 'TK 1', product: 'ucmas', productLabel: 'UCMAS', status: 'ACTIVE', effective_status: 'ACTIVE', budgetType: 'CBO', expectedDailyBudget: 300000, spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0, frequency: 1.5 },
      { id: 'C2', name: 'hai/uckid/mess/b', accountId: '200', accountName: 'TK 2', product: 'uckid', productLabel: 'UCKID', status: 'ACTIVE', effective_status: 'ACTIVE', budgetType: 'ABO', expectedDailyBudget: 200000, spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0, frequency: 3.4 },
      { id: 'C3', name: 'hai/ucmas/mess/c', accountId: '100', accountName: 'TK 1', product: 'ucmas', productLabel: 'UCMAS', status: 'PAUSED', effective_status: 'PAUSED', budgetType: 'CBO', expectedDailyBudget: 0, spend: 0, messages: 0, otherConversions: 0, impressions: 0, clicks: 0, frequency: 0 }
    ],
    dailyRecords: [
      { campaignId: 'C1', accountId: '100', product: 'ucmas', date: TODAY, spend: 100000, impressions: 1000, reach: 800, clicks: 20, messages: 2, otherConversions: 0 },
      { campaignId: 'C1', accountId: '100', product: 'ucmas', date: YESTERDAY, spend: 200000, impressions: 2000, reach: 1500, clicks: 40, messages: 4, otherConversions: 0 },
      { campaignId: 'C2', accountId: '200', product: 'uckid', date: YESTERDAY, spend: 500000, impressions: 5000, reach: 4000, clicks: 50, messages: 5, otherConversions: 1 },
      { campaignId: 'C3', accountId: '100', product: 'ucmas', date: YESTERDAY, spend: 50000, impressions: 400, reach: 380, clicks: 4, messages: 0, otherConversions: 0 }
    ],
    placementRecords: [
      { campaignId: 'C1', accountId: '100', product: 'ucmas', platform: 'facebook', spend: 240000, impressions: 2400 },
      { campaignId: 'C1', accountId: '100', product: 'ucmas', platform: 'instagram', spend: 60000, impressions: 600 },
      { campaignId: 'C2', accountId: '200', product: 'uckid', platform: 'facebook', spend: 500000, impressions: 5000 }
    ],
    leadsRecords: [
      // Matched to C1 (UCMAS, account 100), enrolled yesterday
      { id: 'L1', phone: '0901234567', fanpage: 'FP', adId: 'AD_A', entryDate: YESTERDAY, product: 'ucmas', revenue: 5000000, l1: true, l1Date: YESTERDAY, l2: true, l2Date: YESTERDAY, l3: true, l3Date: YESTERDAY, l4: true, l4Date: YESTERDAY },
      // Matched to C2 (UCKID, account 200)
      { id: 'L2', phone: '0912345678', fanpage: 'FP', adId: 'AD_B', entryDate: YESTERDAY, product: 'uckid', revenue: 3000000, l1: true, l1Date: YESTERDAY, l2: true, l2Date: YESTERDAY, l3: false, l3Date: null, l4: false, l4Date: null },
      // Unmatched: ad id is not in adMap
      { id: 'L3', phone: '0923456789', fanpage: 'FP', adId: 'AD_UNKNOWN', entryDate: YESTERDAY, product: 'ucmas', revenue: 1000000, l1: true, l1Date: YESTERDAY, l2: false, l2Date: null, l3: false, l3Date: null, l4: false, l4Date: null },
      // Unmatched: no ad id at all
      { id: 'L4', phone: '0934567890', fanpage: 'FP', adId: '', entryDate: YESTERDAY, product: 'uckid', revenue: 0, l1: true, l1Date: YESTERDAY, l2: false, l2Date: null, l3: false, l3Date: null, l4: false, l4Date: null },
      // Outside any short range — dated far in the past
      { id: 'L5', phone: '0945678901', fanpage: 'FP', adId: 'AD_A', entryDate: '2020-01-01', product: 'ucmas', revenue: 9000000, l1: true, l1Date: '2020-01-01', l2: true, l2Date: '2020-01-01', l3: true, l3Date: '2020-01-01', l4: true, l4Date: '2020-01-01' }
    ],
    warnings: []
  };
}

const sumBy = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0);

// ---------------------------------------------------------------------------
// A-05 — the invariant that catches every other attribution bug
// ---------------------------------------------------------------------------
test('A-05: Σ các dòng chiến dịch + chưa gán = tổng KPI', () => {
  for (const datePreset of ['today', 'yesterday', 'last_7d', 'last_30d', 'this_month']) {
    for (const product of ['ALL', ...TARGET_KEYS]) {
      const view = buildView(makeSnapshot(), { product, datePreset });
      const u = view.unassignedLeads;
      const label = `${product}/${datePreset}`;

      for (const [row, kpi] of [['l1Count', 'l1Count'], ['l2Count', 'l2Count'], ['l3Count', 'l3Count'], ['l4Count', 'l4Count']]) {
        assert.equal(
          sumBy(view.campaigns, row) + u[kpi],
          view.summary[kpi],
          `${label}: Σ ${row} + chưa gán phải bằng summary.${kpi}`
        );
      }
      assert.equal(
        sumBy(view.campaigns, 'revenue') + u.revenue,
        view.summary.totalRevenue,
        `${label}: Σ doanh thu + chưa gán phải bằng summary.totalRevenue`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// A-03 — lead metrics must follow the selected date range
// ---------------------------------------------------------------------------
test('A-03: lead & doanh thu thay đổi theo khoảng thời gian', () => {
  const snap = makeSnapshot();
  const d30 = buildView(snap, { datePreset: 'last_30d' });
  const dToday = buildView(snap, { datePreset: 'today' });

  // L5 is dated 2020 and must be out of every short range.
  assert.equal(d30.summary.l1Count, 4, '30 ngày: chỉ 4 lead trong kỳ (L5 nằm ngoài)');
  assert.equal(d30.summary.totalRevenue, 9000000, '30 ngày: doanh thu không gồm lead 2020');

  // Nothing is dated today in the fixture, so every lead figure must be zero.
  assert.equal(dToday.summary.l1Count, 0, 'Hôm nay: không có lead nào');
  assert.equal(dToday.summary.totalRevenue, 0, 'Hôm nay: doanh thu phải là 0');
  assert.equal(dToday.summary.roas, 0, 'Hôm nay: ROAS phải là 0, không phải doanh thu trọn đời / chi tiêu hôm nay');
});

test('A-03: ROAS luôn so cùng kỳ với chi tiêu', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'yesterday' });
  const expected = parseFloat((view.summary.totalRevenue / view.summary.totalSpend).toFixed(2));
  assert.equal(view.summary.roas, expected);
});

// ---------------------------------------------------------------------------
// A-04 — lead metrics must follow the selected account
// ---------------------------------------------------------------------------
test('A-04: lead được lọc theo tài khoản', () => {
  const snap = makeSnapshot();
  const all = buildView(snap, { datePreset: 'last_30d', accountId: 'ALL' });
  const tk1 = buildView(snap, { datePreset: 'last_30d', accountId: '100' });
  const tk2 = buildView(snap, { datePreset: 'last_30d', accountId: '200' });

  assert.equal(all.summary.l1Count, 4);
  // TK 1 only owns C1 → only the lead matched to C1 counts (unmatched leads have no account).
  assert.equal(tk1.summary.l1Count, 1, 'TK 1 chỉ có 1 lead ghép được');
  assert.equal(tk1.summary.l4Count, 1);
  assert.equal(tk2.summary.l1Count, 1, 'TK 2 chỉ có 1 lead ghép được');
  assert.equal(tk2.unassignedLeads.totalLeads, 0, 'Xem theo 1 TK thì không tính lead chưa ghép');
  assert.ok(tk1.summary.l1Count < all.summary.l1Count, 'Lọc theo TK phải cho số nhỏ hơn toàn BM');
});

// ---------------------------------------------------------------------------
// A-01 / A-02 — attribution via adMap, never by spend weight
// ---------------------------------------------------------------------------
test('A-01: lead ghép vào chiến dịch qua adMap', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'last_30d' });
  const c1 = view.campaigns.find(c => c.id === 'C1');
  const c2 = view.campaigns.find(c => c.id === 'C2');
  const c3 = view.campaigns.find(c => c.id === 'C3');

  assert.equal(c1.l1Count, 1, 'AD_A → C1');
  assert.equal(c1.l4Count, 1);
  assert.equal(c1.revenue, 5000000);
  assert.equal(c2.l1Count, 1, 'AD_B → C2');
  assert.equal(c3.l1Count, 0, 'C3 không có lead nào → phải là 0, không được chia phần');
  assert.equal(c3.revenue, 0, 'C3 chi 50.000đ nhưng không có lead: doanh thu phải là 0');
});

test('A-02: lead không ghép được KHÔNG bị chia theo tỉ lệ chi tiêu', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'last_30d' });

  assert.equal(view.leadAttribution.unmatched, 2, 'L3 và L4 không ghép được');
  assert.equal(view.unassignedLeads.totalLeads, 2);
  assert.equal(view.unassignedLeads.revenue, 1000000, 'Doanh thu chưa gán nằm riêng');

  // Every campaign's lead count must be a whole measured number, never a rounded share.
  const matchedTotal = sumBy(view.campaigns, 'l1Count');
  assert.equal(matchedTotal, view.leadAttribution.matched, 'Σ lead các dòng = số lead ghép được');
});

test('A-02: snapshot v2 (không có adMap) không bịa số cho chiến dịch', () => {
  const snap = makeSnapshot();
  delete snap.adMap;
  snap.version = 2;
  const view = buildView(snap, { datePreset: 'last_30d' });

  assert.equal(sumBy(view.campaigns, 'l1Count'), 0, 'Không có adMap thì không chiến dịch nào có lead');
  assert.equal(view.unassignedLeads.l1Count, view.summary.l1Count, 'Tất cả lead vào mục chưa gán');
  assert.ok(view.dataNotes.some(n => n.level === 'warning'), 'Phải cảnh báo cần đồng bộ lại');
});

test('A-01: chiến dịch được ưu tiên quyết định sản phẩm của lead', () => {
  const snap = makeSnapshot();
  // Sheet says mathca, but AD_A belongs to C1 which is a UCMAS campaign.
  snap.leadsRecords[0].product = 'mathca';
  const view = buildView(snap, { datePreset: 'last_30d' });
  const ucmas = view.products.find(p => p.key === 'ucmas');
  const mathca = view.products.find(p => p.key === 'mathca');

  assert.equal(ucmas.l4Count, 1, 'Lead theo chiến dịch UCMAS');
  assert.equal(mathca.l4Count, 0, 'Không tính sang MATHCA theo cột sheet');
});

// ---------------------------------------------------------------------------
// A-06 — unclassified leads must not default to UCMAS
// ---------------------------------------------------------------------------
test('A-06: lead không nhận diện được sản phẩm không bị gán cho UCMAS', () => {
  const snap = makeSnapshot();
  snap.leadsRecords = [
    { id: 'X', phone: '0900000000', fanpage: '', adId: '', entryDate: YESTERDAY, product: 'khac', revenue: 7000000, l1: true, l1Date: YESTERDAY, l2: false, l3: false, l4: false }
  ];
  const view = buildView(snap, { datePreset: 'last_30d' });
  const ucmas = view.products.find(p => p.key === 'ucmas');

  assert.equal(ucmas.l1Count, 0, "Lead 'khac' không được cộng vào UCMAS");
  assert.equal(view.summary.totalRevenue, 0, "Doanh thu của lead 'khac' không vào 4 sản phẩm");
});

// ---------------------------------------------------------------------------
// A-07 — messages and other conversions stay separate
// ---------------------------------------------------------------------------
test('A-07: tin nhắn và chuyển đổi khác được tách riêng', () => {
  const onlyPurchases = extractConversions([{ action_type: 'purchase', value: '50' }]);
  assert.equal(onlyPurchases.messages, 0, '50 đơn hàng KHÔNG được báo thành 50 tin nhắn');
  assert.equal(onlyPurchases.otherConversions, 50);

  const msgs = extractConversions([
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' },
    { action_type: 'lead', value: '3' }
  ]);
  assert.equal(msgs.messages, 12);
  assert.equal(msgs.otherConversions, 3);

  // Connections are a fallback for messages, not a separate KPI.
  const conn = extractConversions([{ action_type: 'onsite_conversion.total_messaging_connection', value: '7' }]);
  assert.equal(conn.messages, 7);
});

test('A-07: CPA chỉ tính trên tin nhắn', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'yesterday' });
  const c2 = view.campaigns.find(c => c.id === 'C2');
  assert.equal(c2.messages, 5);
  assert.equal(c2.otherConversions, 1);
  assert.equal(c2.cpa, Math.round(c2.spend / 5), 'CPA = chi tiêu / tin nhắn, không gồm chuyển đổi khác');
});

test('A-07: chỉ gắn cờ bão hòa khi tần suất đúng kỳ đồng bộ', () => {
  const snap = makeSnapshot();
  const sameWindow = buildView(snap, { datePreset: 'last_30d' });
  const otherWindow = buildView(snap, { datePreset: 'yesterday' });

  assert.equal(sameWindow.fatigueApplicable, true);
  assert.equal(otherWindow.fatigueApplicable, false);

  const c2 = { effective_status: 'ACTIVE', messages: 0, cpa: 0, spend: 0, frequency: 3.4 };
  assert.equal(classifyCampaign(c2, true), 'fatigue_alert');
  assert.equal(classifyCampaign(c2, false), 'maintain', 'Không kết luận bão hòa bằng tần suất của kỳ khác');
});

// ---------------------------------------------------------------------------
// B-02 — no raw PII in the payload
// ---------------------------------------------------------------------------
test('B-02: payload không chứa số điện thoại thật hay Ad ID', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'last_30d' });
  assert.ok(view.recentEnrolled.length > 0, 'Fixture phải có học viên đã chốt');

  for (const r of view.recentEnrolled) {
    assert.ok(!('phone' in r), 'Không được gửi trường phone');
    assert.ok(!('adId' in r), 'Không được gửi trường adId');
    assert.match(r.phoneMasked, /\*\*\*/, 'Chỉ gửi số đã che');
  }
  const serialized = JSON.stringify(view.recentEnrolled);
  assert.ok(!serialized.includes('0901234567'), 'Số điện thoại gốc không được lọt vào payload');
});

test('B-02: maskPhone che đúng phần giữa', () => {
  assert.equal(maskPhone('0912000345'), '0912***345');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone('123'), '123'); // too short to mask meaningfully
});

// ---------------------------------------------------------------------------
// D-01 — payload must not ship the whole campaign list per product
// ---------------------------------------------------------------------------
test('D-01: tabBadges chỉ chứa số, không chứa danh sách chiến dịch', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'last_30d' });
  assert.equal(view.productTabs, undefined, 'productTabs đã được bỏ');
  assert.ok(view.tabBadges.ucmas, 'tabBadges phải có đủ 4 sản phẩm');
  for (const key of TARGET_KEYS) {
    assert.deepEqual(
      Object.keys(view.tabBadges[key]).sort(),
      ['activeCount', 'campaignCount', 'l1Count', 'l3Count', 'l4Count'],
      `tabBadges.${key} chỉ gồm số đếm`
    );
  }
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
test('getDateRange tính đúng từng preset', () => {
  const ref = new Date('2026-03-15T10:00:00Z');
  assert.deepEqual(getDateRange('today', ref), { startDate: '2026-03-15', endDate: '2026-03-15', todayStr: '2026-03-15', yesterdayStr: '2026-03-14' });
  assert.equal(getDateRange('yesterday', ref).startDate, '2026-03-14');
  assert.equal(getDateRange('last_7d', ref).startDate, '2026-03-09');
  assert.equal(getDateRange('last_14d', ref).startDate, '2026-03-02');
  assert.equal(getDateRange('last_30d', ref).startDate, '2026-02-14');
  assert.equal(getDateRange('this_month', ref).startDate, '2026-03-01');
});

test('getDateRange dùng múi giờ Việt Nam (GMT+7)', () => {
  // 23:30 UTC on the 14th is already 06:30 on the 15th in Vietnam.
  assert.equal(getVietnamDateString(new Date('2026-03-14T23:30:00Z')), '2026-03-15');
});

test('detectProduct lấy đoạn giữa dấu / thứ 1 và 2', () => {
  assert.equal(detectProduct('haicm/ucmas/mess/abc').key, 'ucmas');
  assert.equal(detectProduct('haicm/uckid/mess/abc').key, 'uckid');
  assert.equal(detectProduct('haicm/mathca/mess/abc').key, 'mathca');
  assert.equal(detectProduct('haicm/traihe/mess/abc').key, 'traihe');
  assert.equal(detectProduct('haicm/trại hè/mess/abc').key, 'traihe');
  assert.equal(detectProduct('không có gạch chéo').key, 'khac');
  assert.equal(detectProduct(null).key, 'khac');
  assert.equal(detectProduct('').key, 'khac');
});

test('parseCsvRows xử lý dấu nháy lồng và dấu phẩy trong ô', () => {
  const rows = parseCsvRows('a,b,c\n"x,1","y""2",z\r\nq,w,e');
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['x,1', 'y"2', 'z']);
  assert.deepEqual(rows[2], ['q', 'w', 'e']);
});

test('parseCsvRows bỏ dòng trống hoàn toàn', () => {
  assert.equal(parseCsvRows('a,b\n,\nc,d').length, 2);
});

test('normalizeDate đổi DD/MM/YYYY sang YYYY-MM-DD', () => {
  assert.equal(normalizeDate('5/3/2026'), '2026-03-05');
  assert.equal(normalizeDate('15/12/2026'), '2026-12-15');
  assert.equal(normalizeDate('không phải ngày'), null);
  assert.equal(normalizeDate(''), null);
});

test('normalizePhone thêm số 0 cho dãy 9 chữ số', () => {
  assert.equal(normalizePhone('912345678'), '0912345678');
  assert.equal(normalizePhone('0912 345 678'), '0912345678');
  assert.equal(normalizePhone(''), '');
});

test('leadInRange loại lead không có ngày', () => {
  assert.equal(leadInRange({ l1Date: null, entryDate: null }, '2026-01-01', '2026-12-31'), false);
  assert.equal(leadInRange({ l1Date: '2026-06-01' }, '2026-01-01', '2026-12-31'), true);
  assert.equal(leadInRange({ l1Date: '2025-06-01' }, '2026-01-01', '2026-12-31'), false);
  assert.equal(leadInRange({ l1Date: null }, null, null), true, 'Không có bộ lọc thì nhận hết');
});

test('E-03: summarizeLeads gọi được với 1 tham số', () => {
  assert.doesNotThrow(() => summarizeLeads([]));
  assert.equal(summarizeLeads([]).totalLeads, 0);
});

test('classifyCampaign tuân theo đúng ngưỡng đã chốt', () => {
  const base = { effective_status: 'ACTIVE', spend: 0, messages: 0, cpa: 0, frequency: 0 };
  assert.equal(classifyCampaign({ ...base, messages: 10, cpa: THRESHOLDS.CPA_GOOD }), 'scale');
  assert.equal(classifyCampaign({ ...base, messages: 9, cpa: 50000 }), 'maintain', 'Dưới 10 tin thì chưa scale');
  assert.equal(classifyCampaign({ ...base, spend: THRESHOLDS.WASTE_ZERO_CONV_SPEND + 1, messages: 0 }), 'cut_or_review');
  assert.equal(classifyCampaign({ ...base, spend: THRESHOLDS.WASTE_HIGH_CPA_SPEND + 1, messages: 5, cpa: THRESHOLDS.WASTE_HIGH_CPA + 1 }), 'cut_or_review');
  assert.equal(classifyCampaign({ ...base, effective_status: 'PAUSED', messages: 100, cpa: 1000 }), 'maintain', 'CĐ đã tắt luôn là maintain');
});

test('convertToCsv vô hiệu hoá công thức Excel', () => {
  const csv = convertToCsv([{ name: '=HYPERLINK("http://x")' }], [{ key: 'name', label: 'Tên' }]);
  assert.ok(csv.includes("'=HYPERLINK"), 'Tên bắt đầu bằng = phải được thêm dấu nháy đơn');
});

test('convertToCsv escape dấu nháy kép trong tên chiến dịch', () => {
  const csv = convertToCsv([{ name: 'CĐ "hot" nhất' }], [{ key: 'name', label: 'Tên' }]);
  assert.ok(csv.includes('"CĐ ""hot"" nhất"'));
});

test('buildView báo lỗi rõ ràng khi chưa có snapshot', () => {
  assert.throws(() => buildView(null), /chưa có dữ liệu snapshot/i);
});

// ---------------------------------------------------------------------------
// B-01 — the CORS hole must stay closed.
// `cors` lives on in node_modules as a transitive dep of the MCP SDK, so npm's flat
// tree would still resolve `import cors from 'cors'`. These two checks are what
// actually prevent the hole from being reopened by accident.
// ---------------------------------------------------------------------------
test('B-01: cors không còn là dependency trực tiếp', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  assert.equal(pkg.dependencies.cors, undefined, 'cors phải được xoá khỏi dependencies');
});

test('B-01: server.js không dùng cors và không phát header CORS', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf-8');
  // Strip comments first — the file explains WHY cors is absent, and that must not
  // make this test fail.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');

  assert.ok(!/from\s+['"]cors['"]/.test(code), 'Không được import cors');
  assert.ok(!/require\(\s*['"]cors['"]\s*\)/.test(code), 'Không được require cors');
  assert.ok(!/\bcors\s*\(/.test(code), 'Không được gọi cors()');
  assert.ok(
    !/Access-Control-Allow-Origin/i.test(code),
    'Không được tự set header Access-Control-Allow-Origin'
  );
});

test('B-01: server chỉ cho phép loopback trừ khi ALLOW_REMOTE=true', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf-8');
  assert.ok(/config\.allowRemote/.test(src), 'Phải kiểm tra cờ allowRemote');
  assert.ok(/isLoopback\(req\.socket\.remoteAddress\)/.test(src), 'Phải chặn theo IP của socket');
  assert.ok(/requireSessionToken/.test(src), 'Route ghi phải yêu cầu token phiên');
});

test('ngân sách dự kiến chỉ tính chiến dịch đang chạy', () => {
  const view = buildView(makeSnapshot(), { datePreset: 'last_30d' });
  // C1 (300k) + C2 (200k) are ACTIVE; C3 is PAUSED and contributes nothing.
  assert.equal(view.summary.expectedDailyBudget, 500000);
  assert.equal(view.summary.activeCount, 2);
  assert.equal(view.summary.campaignCount, 3);
});
