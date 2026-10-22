import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdsetBody, SAFETY_LIMITS } from '../src/cross-post.js';

// ---------------------------------------------------------------------------
// Dựng payload — không gọi mạng
// ---------------------------------------------------------------------------

test('create-adset: luôn PAUSED', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p' });
  assert.equal(b.status, 'PAUSED');
});

test('create-adset: không truyền geo thì mặc định Việt Nam', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p' });
  assert.deepEqual(b.targeting.geo_locations, { countries: ['VN'] });
});

test('create-adset: placements rỗng thì KHÔNG gửi publisher_platforms', () => {
  // Gửi mảng rỗng khiến Meta từ chối toàn bộ request; để trống thì Meta tự
  // chọn tất cả placements — đó mới là hành vi mong muốn.
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', targeting: { placements: [] } });
  assert.equal('publisher_platforms' in b.targeting, false);
});

test('create-adset: ngân sách được làm tròn và gửi dạng chuỗi', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', dailyBudget: 99999.7 });
  assert.equal(b.daily_budget, '100000');
  assert.equal(typeof b.daily_budget, 'string');
});

test('create-adset: tên bị cắt khoảng trắng hai đầu', () => {
  const b = buildAdsetBody({ campaignId: '1', name: '  Nhom QC  ', pageId: 'p' });
  assert.equal(b.name, 'Nhom QC');
});

test('create-adset: promoted_object luôn mang page_id', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'page_123' });
  assert.deepEqual(b.promoted_object, { page_id: 'page_123' });
});

// ---------------------------------------------------------------------------
// Giới hạn an toàn — khoá lại để không bị đổi âm thầm
// ---------------------------------------------------------------------------

test('giới hạn chống spam API giữ đúng giá trị đã chốt', () => {
  assert.equal(SAFETY_LIMITS.PUBLISH_MAX_PAGES,     10);
  assert.equal(SAFETY_LIMITS.BULK_REPLICATE_MAX,    10);
  assert.equal(SAFETY_LIMITS.BATCH_ADS_MAX,         15);
  assert.equal(SAFETY_LIMITS.ANALYZE_CAMPAIGNS_MAX, 20);
  assert.ok(SAFETY_LIMITS.DELAY_PUBLISH_MS >= 1500, 'giãn cách đăng bài ≥ 1,5s');
  assert.ok(SAFETY_LIMITS.DELAY_CREATE_MS  >= 2000, 'giãn cách tạo QC ≥ 2s');
});
