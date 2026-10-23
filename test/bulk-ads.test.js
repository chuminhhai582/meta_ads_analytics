import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFETY_LIMITS, buildAdBody, buildAdCreativeBody, buildAdsetBody,
  classifyCampaignDraft, parseCampaignQuery, resolveAttachments,
  expandPairs, renderAdName, countPlanObjects, estimateRunSeconds,
  expandSpintax, normalizeImageUpload, resolvePageIdForTarget,
  isTransientMetaError
} from '../src/cross-post.js';

// ---------------------------------------------------------------------------
// Bất biến an toàn — KHÔNG được đổi mà không có quyết định nghiệp vụ
// ---------------------------------------------------------------------------

test('buildAdBody: status LUÔN PAUSED', () => {
  const b = buildAdBody({ name: 'x', adsetId: '1', creativeId: '2' });
  assert.equal(b.status, 'PAUSED');
});

test('buildAdBody: thiếu creativeId thì throw', () => {
  assert.throws(() => buildAdBody({ name: 'x', adsetId: '1' }), /creativeId/);
});

test('buildAdBody: tên bị cắt 200 ký tự và loại bỏ xuống dòng', () => {
  const b = buildAdBody({ name: 'a\nb' + 'x'.repeat(300), adsetId: '1', creativeId: '2' });
  assert.ok(b.name.length <= 200);
  assert.ok(!b.name.includes('\n'));
});

test('buildAdCreativeBody: luôn có page_id', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi' } });
  assert.equal(b.object_story_spec.page_id, 'p1');
});

test('buildAdCreativeBody: imageHash được ưu tiên hơn picture', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi', imageHash: 'h1', imageUrl: 'http://x/y.jpg' } });
  assert.equal(b.object_story_spec.link_data.image_hash, 'h1');
  assert.equal('picture' in b.object_story_spec.link_data, false);
});

test('buildAdCreativeBody: có videoId thì dùng video_data, không link_data', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { videoId: 'v1', message: 'hi' } });
  assert.ok(b.object_story_spec.video_data);
  assert.equal('link_data' in b.object_story_spec, false);
});

test('buildAdCreativeBody: không linkUrl thì mặc định m.me của page', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi' } });
  assert.equal(b.object_story_spec.link_data.link, 'https://m.me/p1');
});

test('buildAdCreativeBody: CTA sai định dạng thì throw', () => {
  assert.throws(() => buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi', ctaType: 'send message' } }), /CTA/);
});

test('buildAdCreativeBody: CTA lạ nhưng đúng định dạng thì CHẤP NHẬN (người dùng tự điền)', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi', ctaType: 'ORDER_NOW' } });
  assert.equal(b.object_story_spec.link_data.call_to_action.type, 'ORDER_NOW');
});

test('buildAdCreativeBody: NO_BUTTON thì không gắn call_to_action', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { message: 'hi', ctaType: 'NO_BUTTON' } });
  assert.equal('call_to_action' in b.object_story_spec.link_data, false);
});

test('buildAdCreativeBody: page_post dùng object_story_id, tự ghép pageId', () => {
  const b = buildAdCreativeBody({ pageId: 'p1', content: { type: 'page_post', sourcePostId: '999' } });
  assert.equal(b.object_story_id, 'p1_999');
});

// ---------------------------------------------------------------------------
// buildAdsetBody — vá CBO, KHÔNG phá 6 test cũ
// ---------------------------------------------------------------------------

test('buildAdsetBody: useCampaignBudget=true thì KHÔNG gửi daily_budget', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', useCampaignBudget: true });
  assert.equal('daily_budget' in b, false);
});

test('buildAdsetBody: mặc định vẫn gửi daily_budget dạng chuỗi (hành vi cũ)', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', dailyBudget: 99999.7 });
  assert.equal(b.daily_budget, '100000');
});

// ---------------------------------------------------------------------------
// Chiến dịch nháp
// ---------------------------------------------------------------------------

test('classifyCampaignDraft: IN_PROCESS là nháp', () => {
  assert.deepEqual(classifyCampaignDraft({ effective_status: 'IN_PROCESS' }), { isDraft: true, reason: 'in_process' });
});

test('classifyCampaignDraft: PAUSED mà 0 ad là nháp', () => {
  const r = classifyCampaignDraft({ effective_status: 'PAUSED', ads: { summary: { total_count: 0 } }, adsets: { summary: { total_count: 2 } } });
  assert.deepEqual(r, { isDraft: true, reason: 'no_ad' });
});

test('classifyCampaignDraft: 0 nhóm thì reason là no_adset', () => {
  const r = classifyCampaignDraft({ effective_status: 'PAUSED', ads: { summary: { total_count: 0 } }, adsets: { summary: { total_count: 0 } } });
  assert.equal(r.reason, 'no_adset');
});

test('classifyCampaignDraft: ACTIVE và có ad thì KHÔNG phải nháp', () => {
  const r = classifyCampaignDraft({ effective_status: 'ACTIVE', ads: { summary: { total_count: 3 } } });
  assert.equal(r.isDraft, false);
});

test('classifyCampaignDraft: thiếu summary thì KHÔNG đoán bừa', () => {
  assert.equal(classifyCampaignDraft({ effective_status: 'PAUSED' }).isDraft, false);
});

test('parseCampaignQuery: không truyền gì thì giữ hành vi cũ ACTIVE+PAUSED', () => {
  const q = parseCampaignQuery({});
  assert.deepEqual(q.statuses, ['ACTIVE', 'PAUSED']);
  assert.equal(q.withDraftFlag, false);
  assert.equal(q.limit, 50);
});

test('parseCampaignQuery: statuses=all thêm IN_PROCESS và WITH_ISSUES', () => {
  assert.deepEqual(parseCampaignQuery({ statuses: 'all' }).statuses,
    ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']);
});

test('parseCampaignQuery: trạng thái rác bị loại, limit bị kẹp 200', () => {
  const q = parseCampaignQuery({ statuses: 'DROP_TABLE,ACTIVE', limit: '9999' });
  assert.deepEqual(q.statuses, ['ACTIVE']);
  assert.equal(q.limit, 200);
});

// ---------------------------------------------------------------------------
// resolveAttachments
// ---------------------------------------------------------------------------

test('resolveAttachments: attachTo=all nhân 3 CĐ × 2 nhóm = 6', () => {
  const r = resolveAttachments({
    campaigns: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    adsets: [{ key: 'x', attachTo: 'all' }, { key: 'y', attachTo: 'all' }]
  });
  assert.equal(r.length, 6);
});

test('resolveAttachments: attachTo trỏ CĐ không tồn tại thì throw', () => {
  assert.throws(() => resolveAttachments({ campaigns: [{ key: 'a' }], adsets: [{ key: 'x', name: 'X', attachTo: 'zz' }] }), /không tồn tại/);
});

test('resolveAttachments: CĐ dùng CBO mà nhóm khai ngân sách thì throw', () => {
  assert.throws(() => resolveAttachments({
    campaigns: [{ key: 'a', name: 'A', dailyBudget: 150000 }],
    adsets: [{ key: 'x', name: 'X', attachTo: 'all', dailyBudget: 100000 }]
  }), /CBO/);
});

test('resolveAttachments: CĐ dùng CBO thì useCampaignBudget=true', () => {
  const r = resolveAttachments({
    campaigns: [{ key: 'a', name: 'A', dailyBudget: 150000 }],
    adsets: [{ key: 'x', name: 'X', attachTo: 'all' }]
  });
  assert.equal(r[0].useCampaignBudget, true);
});

test('resolveAttachments: quá 3 nhóm mới trên 1 chiến dịch thì throw', () => {
  assert.throws(() => resolveAttachments({
    campaigns: [{ key: 'a' }],
    adsets: [1, 2, 3, 4].map(i => ({ key: `x${i}`, attachTo: 'all' }))
  }), /nhóm\/chiến dịch/);
});

// ---------------------------------------------------------------------------
// expandPairs / renderAdName
// ---------------------------------------------------------------------------

const T = (id) => ({ adsetId: id, adsetName: `AS ${id}`, campaignName: 'CP', pageId: 'p1' });
const C = (k) => ({ key: k, name: `Content ${k}` });

test('expandPairs: matrix 3×4 = 12 cặp', () => {
  assert.equal(expandPairs({ contents: [C('1'), C('2'), C('3')], targets: [T('a'), T('b'), T('c'), T('d')] }).length, 12);
});

test('expandPairs: thứ tự ổn định (nội dung ngoài, nhóm trong)', () => {
  const p = expandPairs({ contents: [C('1'), C('2')], targets: [T('a'), T('b')] });
  assert.deepEqual(p.map(x => x.pairKey), ['1|a', '1|b', '2|a', '2|b']);
});

test('expandPairs: one_to_one lệch số lượng thì throw', () => {
  assert.throws(() => expandPairs({ contents: [C('1')], targets: [T('a'), T('b')], pairingMode: 'one_to_one' }), /1-1/);
});

test('expandPairs: round_robin 3 nội dung × 5 nhóm = 5 cặp quay vòng', () => {
  const p = expandPairs({ contents: [C('1'), C('2'), C('3')], targets: ['a','b','c','d','e'].map(T), pairingMode: 'round_robin' });
  assert.equal(p.length, 5);
  assert.deepEqual(p.map(x => x.content.key), ['1', '2', '3', '1', '2']);
});

test('expandPairs: excluded bị loại khỏi kết quả', () => {
  const p = expandPairs({ contents: [C('1')], targets: [T('a'), T('b')], excluded: ['1|a'] });
  assert.deepEqual(p.map(x => x.pairKey), ['1|b']);
});

test('expandPairs: pairingMode lạ thì throw', () => {
  assert.throws(() => expandPairs({ contents: [C('1')], targets: [T('a')], pairingMode: 'xyz' }), /pairingMode/);
});

test('renderAdName: token thiếu thì thành rỗng, không in {content} thô', () => {
  const n = renderAdName('{content} — {adset}', { adsetName: 'AS1' });
  assert.ok(!n.includes('{'));
  assert.ok(n.includes('AS1'));
});

test('renderAdName: cắt 200 ký tự', () => {
  assert.ok(renderAdName('{content}', { contentName: 'x'.repeat(300) }).length <= 200);
});

// ---------------------------------------------------------------------------
// Trần an toàn & tiện ích
// ---------------------------------------------------------------------------

test('countPlanObjects: quá 135 quảng cáo thì throw', () => {
  assert.throws(() => countPlanObjects({ campaignCount: 0, adsetCount: 0, adCount: 136 }), /135/);
});

test('countPlanObjects: quá 15 chiến dịch thì throw', () => {
  assert.throws(() => countPlanObjects({ campaignCount: 16, adsetCount: 0, adCount: 0 }), /15/);
});

test('estimateRunSeconds: đợt tối đa ước tính trên 6 phút', () => {
  const s = estimateRunSeconds({ campaignCount: 15, adsetCount: 45, adCount: 135, creativeCount: 12 });
  assert.ok(s > 360, `ước tính ${s}s`);
});

test('expandSpintax: bung đúng các nhánh', () => {
  const r = expandSpintax('Con {chậm|nhanh} lắm');
  assert.deepEqual(r, ['Con chậm lắm', 'Con nhanh lắm']);
});

test('expandSpintax: thiếu dấu } thì trả nguyên văn, không throw', () => {
  assert.deepEqual(expandSpintax('Con {chậm|nhanh lắm'), ['Con {chậm|nhanh lắm']);
});

test('normalizeImageUpload: nhận JPEG, từ chối GIF', () => {
  assert.equal(normalizeImageUpload(Buffer.from([0xFF, 0xD8, 0xFF, 0x00])).mime, 'image/jpeg');
  assert.throws(() => normalizeImageUpload(Buffer.from('GIF89a')), /JPEG hoặc PNG/);
});

test('normalizeImageUpload: buffer rỗng thì throw', () => {
  assert.throws(() => normalizeImageUpload(Buffer.alloc(0)), /rỗng/);
});

test('resolvePageIdForTarget: ưu tiên page của chính nhóm đích', () => {
  assert.equal(resolvePageIdForTarget({ pageId: 'p9' }, 'p1'), 'p9');
  assert.equal(resolvePageIdForTarget({}, 'p1'), 'p1');
  assert.throws(() => resolvePageIdForTarget({ name: 'AS' }, ''), /Fanpage/);
});

test('isTransientMetaError: rate limit là tạm thời, lỗi nghiệp vụ thì không', () => {
  assert.equal(isTransientMetaError({ code: 17 }), true);
  assert.equal(isTransientMetaError({ code: 100, message: 'Invalid parameter' }), false);
});

// ---------------------------------------------------------------------------
// Khoá trần an toàn — đổi là phải có quyết định nghiệp vụ
// ---------------------------------------------------------------------------

test('trần engine build-structure giữ đúng giá trị đã chốt', () => {
  assert.equal(SAFETY_LIMITS.BUILD_MAX_NEW_CAMPAIGNS,       15);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_ADSETS_PER_CAMPAIGN,  3);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_NEW_ADSETS,          45);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_TARGETS,             45);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_CONTENTS,            12);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_ADS,                135);
  assert.equal(SAFETY_LIMITS.BUILD_MAX_OBJECTS,            195);
  assert.ok(SAFETY_LIMITS.DELAY_BUILD_AD_MS       >= 2000, 'giãn cách tạo ad ≥ 2s');
  assert.ok(SAFETY_LIMITS.DELAY_BUILD_ADSET_MS    >= 2500, 'giãn cách tạo nhóm ≥ 2,5s');
  assert.ok(SAFETY_LIMITS.DELAY_BUILD_CAMPAIGN_MS >= 2500, 'giãn cách tạo CĐ ≥ 2,5s');
});

test('6 trần cũ KHÔNG bị thay đổi', () => {
  assert.equal(SAFETY_LIMITS.PUBLISH_MAX_PAGES,     10);
  assert.equal(SAFETY_LIMITS.BULK_REPLICATE_MAX,    10);
  assert.equal(SAFETY_LIMITS.BATCH_ADS_MAX,         15);
  assert.equal(SAFETY_LIMITS.ANALYZE_CAMPAIGNS_MAX, 20);
});
