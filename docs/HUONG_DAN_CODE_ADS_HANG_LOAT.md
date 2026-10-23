# HƯỚNG DẪN CODE HOÀN CHỈNH — Tạo nội dung & Đăng Ads hàng loạt

**Dự án:** Meta Ads Analytics (BM Ucmas Việt Nam) · **Phạm vi:** `Cross-Post Manager` (`/cross-post`)
**Ngày lập:** 23/10/2026 · **Phiên bản:** 1.0 · **Dành cho:** AI code / developer thực thi

---

## PHẦN 0 — CÁCH DÙNG TÀI LIỆU NÀY

### 0.1 Đọc trước khi gõ dòng code đầu tiên

1. `PROJECT_CONTEXT.md` — mục tiêu, ràng buộc nghiệp vụ, Known Issues.
2. `.agents/rules/quy-tac-du-an.md` — quy tắc bắt buộc. **Giao tiếp với chủ dự án bằng tiếng Việt.**
3. `src/cross-post.js` — module sẽ sửa nhiều nhất.
4. `test/cross-post.test.js` — **6 test đang khoá bất biến của `buildAdsetBody` và `SAFETY_LIMITS`. Không được làm vỡ.**

### 0.2 Luật tuyệt đối — vi phạm là làm sai yêu cầu

| # | Luật | Vì sao |
|---|---|---|
| L1 | **Mọi Campaign / Adset / Ad tạo mới LUÔN `status: 'PAUSED'`** | Tạo ở trạng thái chạy = đốt tiền thật của BM |
| L2 | **Không xoá route cũ, không đổi payload route cũ** | `batch-create-ads`, `create-campaign`, `create-adset`, `/campaigns/:id/adsets` đang được tab 2 dùng |
| L3 | **Không đổi 6 giá trị `SAFETY_LIMITS` cũ** | `test/cross-post.test.js:47` khoá lại |
| L4 | **Không thêm dependency** | Stack chốt 3 package: express, dotenv, meta-ads-mcp |
| L5 | **Không `fetch` trực tiếp trong code mới** — luôn qua `callMeta()` | Timeout 35 s + bóc lỗi Meta đã chuẩn hoá |
| L6 | **Lỗi 1 object chỉ fail object đó**, không dừng cả đợt | rule §5 |
| L7 | **Giãn cách tối thiểu** 2 s giữa 2 lệnh tạo | chống rate-limit / checkpoint |
| L8 | **Không log Access Token / Page Token** ra console hay response | rule §3 |
| L9 | CSS: chỉ style inline cho **giá trị tính ở runtime**; còn lại viết class trong `public/css/cross-post.css` | rule §5 |
| L10 | Mọi element tương tác trong HTML phải có **`id` duy nhất** | rule §5 |
| L11 | Lọc trạng thái "đang chạy" dùng `effective_status`, không dùng `status` | rule §5 |
| L12 | Không hiển thị số liệu không lấy được thật. Thiếu thì nói rõ là thiếu. | rule §4 |

### 0.3 Thứ tự thực thi

Làm **đúng theo thứ tự GĐ 0 → GĐ 10**. Mỗi GĐ = **1 commit riêng**, `npm test` xanh mới được sang GĐ sau.

| GĐ | Nội dung | Ghi lên Meta? | Phần trong tài liệu |
|---|---|---|---|
| 0 | Tách `ads-studio.js` + `cp-shared.js` | Không | §3 |
| 1 | Backend đọc: cờ nháp + adsets nhiều CĐ | Không | §4 |
| 2 | Tab 3 — bước 1: cây chọn đích | Không | §7 |
| 3 | `cp-shared.js`: thẻ nội dung, CTA, upload ảnh, thư viện, biến thể | Chỉ upload ảnh | §8 |
| 4 | Tab 3 — bước 3: ma trận | Không | §9 |
| 5 | Backend ghi: `build-structure` + job + CSV | **CÓ** | §5, §6 |
| 6 | Tab 3 — bước 4: poll job, log, CSV | **CÓ** | §10 |
| 7 | Tab 2 — chế độ tạo nhiều CĐ / nhiều nhóm | Không | §11 |
| 8 | Tab 2 — bước 4 chuyển sang `build-structure` | **CÓ** | §11.5 |
| 9 | Chạy thật quy mô nhỏ | **CÓ** | §13 |
| 10 | Test + cập nhật `PROJECT_CONTEXT.md` + `README.md` | Không | §12, §14 |

**Dừng xin duyệt chủ dự án trước GĐ 5** (lần đầu ghi thật lên Meta).

### 0.4 Giả định đang áp dụng

> GĐ 0 (tách file) **chưa được chủ dự án duyệt dứt khoát** tại thời điểm viết tài liệu. Tài liệu này giả định **CÓ tách**, vì nếu không `public/js/cross-post-app.js` sẽ vượt 2100 dòng.
> **Nếu chủ dự án không duyệt tách:** bỏ GĐ 0, viết tiếp vào `cross-post-app.js`, và thay mọi tham chiếu `window.AdsStudio` / `window.CPShared` bằng hàm nội bộ trong IIFE đó. Mọi phần khác của tài liệu không đổi.

---

## PHẦN 1 — QUYẾT ĐỊNH ĐÃ CHỐT CỦA CHỦ DỰ ÁN

| # | Hạng mục | Chốt |
|---|---|---|
| 1 | "Chiến dịch bản nháp" | **Loại A** — chiến dịch có thật trên Meta nhưng chưa hoàn chỉnh (chưa có ad / `IN_PROCESS` / `WITH_ISSUES`). Loại B (nháp còn trong trình tạo Ads Manager) **API không đọc được**, ngoài phạm vi. |
| 2 | Số tài khoản mỗi đợt | **1 tài khoản / 1 đợt** |
| 3 | CTA | **Người dùng tự chọn / tự điền**, không hard-code |
| 4 | Trần tạo mới | **15 chiến dịch**, **3 nhóm / chiến dịch** → tối đa **45 nhóm** |
| 5 | Tab 2 | Nâng cấp cho phép tạo **nhiều** chiến dịch / nhóm / quảng cáo trong 1 lần |

### 1.1 Hệ quả về khối lượng và thời gian — PHẢI HIỂN THỊ CHO NGƯỜI DÙNG

Trần 15 CĐ × 3 nhóm làm tổng tải lớn hơn hẳn. Tính theo giãn cách bắt buộc:

| Thành phần | Số lượng tối đa | Giãn cách | Thời gian |
|---|---|---|---|
| Chiến dịch | 15 | 2,5 s | 37 s |
| Nhóm quảng cáo | 45 | 2,5 s | 112 s |
| Creative | ≤ 12 | 1,2 s | 14 s |
| Quảng cáo | 135 (45 nhóm × 3 nội dung) | 2,0 s | 270 s |
| **Tổng** | **195 đối tượng** | | **≈ 7 phút 13 s** |

**Bắt buộc:**
- Chạy theo **job bất đồng bộ** + poll (không giữ 1 HTTP request 7 phút).
- Bước 3 phải hiện **ước tính thời gian** (`estimateRunSeconds()`), kèm cảnh báo khi > 5 phút.
- Người dùng **không được đóng tab** giữa đợt thì tốt hơn, nhưng nếu đóng thì job vẫn chạy ở server và kết quả còn trong 1 giờ.

---

## PHẦN 2 — KIẾN TRÚC TỔNG THỂ

### 2.1 Sơ đồ

```
┌──────────────────── public/cross-post.html ────────────────────┐
│  Tab 1: Đăng bài chéo Fanpage      → cross-post-app.js (giữ)   │
│  Tab 2: Tạo mới hàng loạt CĐ→Nhóm→QC → ads-studio.js (nâng cấp)│
│  Tab 3: Đăng Ads vào CĐ/Nhóm có sẵn  → bulk-ads-app.js (MỚI)   │
│         (gồm chiến dịch nháp)                                   │
│                        ↓ dùng chung ↓                           │
│              public/js/cp-shared.js (MỚI)                       │
│   thẻ nội dung · CTA · upload ảnh · thư viện · spintax ·        │
│   poll job · escapeHtml · refreshIcons · fetch có token         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌──────────────────────── src/cross-post.js ─────────────────────┐
│ ĐỌC   GET  /ad-accounts/:id/campaigns?withDraftFlag=1  (mở rộng)│
│       GET  /ad-accounts/:id/adsets?campaignIds=a,b,c   (MỚI)   │
│       GET  /content-library                            (MỚI)   │
│       GET  /job/:jobId          (có sẵn, dùng lại)             │
│       GET  /job/:jobId/csv                             (MỚI)   │
│ GHI   POST /upload-ad-image                            (MỚI)   │
│       POST /content-library                            (MỚI)   │
│       POST /build-structure     ★ ENGINE CHUNG 2 TAB   (MỚI)   │
│                                                                 │
│ GIỮ NGUYÊN: /publish /replicate-ad /create-campaign            │
│             /create-adset /batch-create-ads /analyze-campaigns  │
│             /bulk-replicate /campaigns/:id/adsets               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Vì sao 1 engine chung `build-structure`

Hai tab khác nhau **chỉ ở chỗ lấy nhóm đích**:

| | `campaigns` | `adsets` | `existingTargets` |
|---|---|---|---|
| **Tab 3** — đăng vào CĐ/nhóm có sẵn (gồm nháp) | `[]` | `[]` | 1–45 nhóm |
| **Tab 2** — tạo mới toàn bộ | 1–15 | 1–3, `attachTo:"all"` | `[]` |
| **Tab 2** — nhóm mới trong CĐ có sẵn | `[]` | `attachTo:"existing:<id>"` | `[]` |
| **Tab 2** — như hiện tại (1 CĐ + 1 nhóm) | 1 | 1 | `[]` |

Phần "soạn nội dung → sinh ma trận → tạo creative → tạo ad" **dùng chung**, viết 1 lần, test 1 lần.

### 2.3 File mới và kích thước dự kiến

| File | Loại | Dòng |
|---|---|---|
| `src/cross-post.js` | sửa | +730 |
| `src/server.js` | sửa | +5 |
| `public/js/cp-shared.js` | MỚI | ~400 |
| `public/js/ads-studio.js` | MỚI (chuyển) + sửa | ~1100 chuyển, +470 mới |
| `public/js/bulk-ads-app.js` | MỚI | ~780 |
| `public/js/cross-post-app.js` | sửa | −1100 / +15 |
| `public/cross-post.html` | sửa | +420 |
| `public/css/cross-post.css` | sửa | +290 |
| `test/bulk-ads.test.js` | MỚI | ~230 |
| `test/cp-guard.test.js` | sửa | +12 |

---

## PHẦN 3 — GĐ 0: TÁCH FILE (chỉ di chuyển code)

> **Nguyên tắc sống còn của GĐ này: KHÔNG đổi một dòng logic nào.** Chỉ cắt–dán và thêm phần expose. Nếu phải sửa logic để chạy được → dừng, ghi lại chỗ vướng, báo chủ dự án.

### 3.1 Tạo `public/js/cp-shared.js`

Chuyển các hàm tiện ích hiện đang nằm trong IIFE của `cross-post-app.js` sang đây, expose qua `window.CPShared`:

```js
/**
 * Tiện ích dùng chung cho cả 3 tab của Cross-Post Manager.
 * Tách khỏi cross-post-app.js ngày 23/10/2026 khi file đó đạt 1712 dòng —
 * tab 3 và phần nâng cấp tab 2 cần dùng lại đúng các hàm này.
 */
window.CPShared = (function () {
  'use strict';

  let sessionToken = '';
  let pages = [];
  let adAccounts = [];
  const readyWaiters = [];
  let isReady = false;

  async function bootstrap() {
    if (isReady) return;
    try {
      const r = await fetch('/api/session');
      if (r.ok) sessionToken = (await r.json()).token || '';
    } catch (e) { console.warn('[CPShared] Không lấy được session token:', e); }
    isReady = true;
    readyWaiters.splice(0).forEach(fn => fn());
  }

  function onReady(fn) { isReady ? fn() : readyWaiters.push(fn); }
  function getToken() { return sessionToken; }
  function setPages(p) { pages = p || []; }
  function getPages() { return pages; }
  function setAdAccounts(a) { adAccounts = a || []; }
  function getAdAccounts() { return adAccounts; }

  /** fetch có kèm X-Internal-Token cho mọi request GHI */
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': sessionToken },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);
    return data;
  }

  async function apiGet(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);
    return data;
  }

  function escapeHtml(s) { /* chuyển y nguyên từ cross-post-app.js */ }
  function refreshIcons() { /* chuyển y nguyên từ cross-post-app.js */ }

  bootstrap();

  return { onReady, getToken, apiGet, apiPost, escapeHtml, refreshIcons,
           setPages, getPages, setAdAccounts, getAdAccounts };
})();
```

### 3.2 Tạo `public/js/ads-studio.js`

Cắt khối từ dòng **601** (`// TAB 2: ADS CREATION STUDIO`) đến hết `executeStudioBatch()` (dòng ~1700) của `cross-post-app.js`, dán vào file mới, bọc IIFE, expose:

```js
window.AdsStudio = (function () {
  'use strict';
  const S = window.CPShared;
  const studioState = { /* ... y nguyên ... */ };
  /* ... toàn bộ hàm studio y nguyên ... */
  return { init: initStudio };
})();
```

Thay trong phần đã chuyển:
- `escapeHtml(` → `S.escapeHtml(`
- `refreshIcons(` → `S.refreshIcons(`
- `state.sessionToken` → `S.getToken()`
- `state.pages` → `S.getPages()`
- `state.adAccounts` → `S.getAdAccounts()`

### 3.3 Sửa `public/js/cross-post-app.js`

1. Xoá khối đã chuyển (dòng 601–~1700).
2. Sau khi `loadFanpages()` / `loadAdAccounts()` chạy xong, bơm dữ liệu sang shared: `S.setPages(state.pages)` và `S.setAdAccounts(state.adAccounts)`.
3. Sửa `switchTab()` (dòng 234) sang chạy theo map:

```js
const TABS = {
  fanpage: { btn: 'tabFanpageBtn', section: 'fanpageSection' },
  ads:     { btn: 'tabAdsBtn',     section: 'adsSection'     },
  bulk:    { btn: 'tabBulkAdsBtn', section: 'bulkAdsSection' }
};

function switchTab(tab) {
  state.activeTab = tab;
  for (const [k, v] of Object.entries(TABS)) {
    document.getElementById(v.btn)?.classList.toggle('active', k === tab);
    const sec = document.getElementById(v.section);
    if (sec) sec.style.display = (k === tab) ? 'block' : 'none';
  }
  if (tab === 'ads')  window.AdsStudio?.init();   // lazy init
  if (tab === 'bulk') window.BulkAds?.init();     // lazy init
  refreshIcons();
}
```

4. Gắn listener cho nút tab 3: `document.getElementById('tabBulkAdsBtn')?.addEventListener('click', () => switchTab('bulk'));`

### 3.4 Sửa `public/cross-post.html` — thứ tự script BẮT BUỘC

```html
<script src="/js/cp-shared.js?v=20261023"></script>
<script src="/js/ads-studio.js?v=20261023"></script>
<script src="/js/bulk-ads-app.js?v=20261023"></script>
<script src="/js/cross-post-app.js?v=20261023"></script>
```

`cp-shared.js` phải nạp trước; `cross-post-app.js` nạp cuối vì nó gọi `init()`.

### 3.5 Nghiệm thu GĐ 0

- [ ] Mở `/cross-post`, tab 1 đăng bài chéo chạy y như trước
- [ ] Tab 2 làm đủ 4 bước (chọn TK → CĐ → nhóm → nội dung → bước 4) hiển thị đúng như trước khi tách
- [ ] Console trình duyệt **0 lỗi**
- [ ] `git diff --stat` cho thấy tổng số dòng gần như không đổi (chỉ di chuyển)
- [ ] `npm test` xanh 64/64

---

## PHẦN 4 — GĐ 1: BACKEND ĐỌC

### 4.1 Mở rộng `SAFETY_LIMITS` — `src/cross-post.js` (quanh dòng 55)

**Thêm vào cuối object, KHÔNG sửa 6 dòng cũ:**

```js
export const SAFETY_LIMITS = {
  PUBLISH_MAX_PAGES:     10,
  BULK_REPLICATE_MAX:    10,
  BATCH_ADS_MAX:         15,
  ANALYZE_CAMPAIGNS_MAX: 20,
  DELAY_PUBLISH_MS:      1500,
  DELAY_CREATE_MS:       2000,
  DELAY_TARGET_MS:       2500,

  // ---------------------------------------------------------------
  // Engine build-structure (tab 2 "tạo mới hàng loạt" + tab 3 "đăng
  // vào CĐ/nhóm có sẵn"). Chốt với chủ dự án 23/10/2026:
  //   • 1 tài khoản quảng cáo / 1 đợt
  //   • tối đa 15 chiến dịch, 3 nhóm mỗi chiến dịch
  // Trần 195 đối tượng ≈ 7 phút chạy — đừng nâng mà không đo lại thời gian.
  // ---------------------------------------------------------------
  BUILD_MAX_NEW_CAMPAIGNS:       15,
  BUILD_MAX_ADSETS_PER_CAMPAIGN: 3,
  BUILD_MAX_NEW_ADSETS:          45,   // 15 × 3
  BUILD_MAX_TARGETS:             45,   // tổng nhóm đích (mới + có sẵn)
  BUILD_MAX_CONTENTS:            12,
  BUILD_MAX_ADS:                 135,  // 45 nhóm × 3 nội dung — TRẦN CỨNG
  BUILD_MAX_OBJECTS:             195,  // CĐ + nhóm + ad

  DELAY_BUILD_CAMPAIGN_MS:  2500,
  DELAY_BUILD_ADSET_MS:     2500,
  DELAY_BUILD_CREATIVE_MS:  1200,
  DELAY_BUILD_AD_MS:        2000,

  UPLOAD_IMAGE_MAX_BYTES: 8 * 1024 * 1024
};
```

### 4.2 Hàm pure — nhóm "đọc"

Đặt ngay sau `SAFETY_LIMITS`, trước các route.

```js
/**
 * Suy ra cờ "bản nháp" cho 1 chiến dịch.
 *
 * Marketing API KHÔNG có status DRAFT — effective_status chỉ có
 * ACTIVE | PAUSED | DELETED | ARCHIVED | IN_PROCESS | WITH_ISSUES
 * (xem docs Campaign Reference v21.0). Nên "nháp" được định nghĩa theo
 * nghiệp vụ: chiến dịch tồn tại nhưng CHƯA có quảng cáo nào, hoặc đang
 * IN_PROCESS / WITH_ISSUES. Đây đúng là tập hợp mà Ads Manager gắn nhãn "Draft".
 *
 * Bản nháp còn nằm trong TRÌNH TẠO của Ads Manager (chưa sinh object) thì
 * không có endpoint nào đọc được — không cố đoán, trả isDraft:false.
 */
export function classifyCampaignDraft(c = {}) {
  const adsCount    = c.ads?.summary?.total_count ?? null;
  const adsetsCount = c.adsets?.summary?.total_count ?? null;
  const es = c.effective_status;

  if (es === 'IN_PROCESS')  return { isDraft: true,  reason: 'in_process' };
  if (es === 'WITH_ISSUES') return { isDraft: true,  reason: 'with_issues' };
  if (adsCount === 0)       return { isDraft: true,  reason: adsetsCount === 0 ? 'no_adset' : 'no_ad' };
  return { isDraft: false, reason: null };
}

/** Các trạng thái được phép truyền vào query ?statuses= */
const CAMPAIGN_STATUS_WHITELIST = new Set([
  'ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'
]);

/**
 * Chuẩn hoá query của route campaigns. Giữ TƯƠNG THÍCH NGƯỢC:
 * không truyền gì → đúng hành vi cũ ['ACTIVE','PAUSED'], tab 2 không bị ảnh hưởng.
 */
export function parseCampaignQuery(q = {}) {
  let statuses;
  if (!q.statuses) {
    statuses = ['ACTIVE', 'PAUSED'];
  } else if (String(q.statuses).toLowerCase() === 'all') {
    statuses = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];
  } else {
    statuses = String(q.statuses).split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => CAMPAIGN_STATUS_WHITELIST.has(s));
    if (statuses.length === 0) statuses = ['ACTIVE', 'PAUSED'];
  }
  if (String(q.includeArchived) === '1' && !statuses.includes('ARCHIVED')) {
    statuses.push('ARCHIVED');
  }

  const rawLimit = Number(q.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  return { statuses, limit, withDraftFlag: String(q.withDraftFlag) === '1' };
}

/** Meta campaign object → shape client dùng. Không bịa trường nào không có thật. */
export function normalizeCampaign(c = {}) {
  const { isDraft, reason } = classifyCampaignDraft(c);
  const daily = Number(c.daily_budget || 0);
  return {
    id: c.id,
    name: c.name || '(không tên)',
    objective: c.objective || '',
    status: c.status || '',
    effective_status: c.effective_status || '',
    dailyBudget: daily,
    lifetimeBudget: Number(c.lifetime_budget || 0),
    hasCbo: daily > 0 || Number(c.lifetime_budget || 0) > 0,
    adsetsCount: c.adsets?.summary?.total_count ?? null,
    adsCount:    c.ads?.summary?.total_count ?? null,
    isDraft,
    draftReason: reason,
    createdTime: c.created_time || null
  };
}

/** Meta adset object → shape client dùng, kèm pageId đã suy ra sẵn. */
export function normalizeAdset(a = {}) {
  return {
    id: a.id,
    name: a.name || '(không tên)',
    campaignId: a.campaign_id || '',
    status: a.status || '',
    effective_status: a.effective_status || '',
    dailyBudget: Number(a.daily_budget || 0),
    optimizationGoal: a.optimization_goal || '',
    destinationType: a.destination_type || '',
    pageId: a.promoted_object?.page_id || ''
  };
}

/**
 * Ưu tiên page của CHÍNH nhóm đích (promoted_object.page_id).
 * Creative gắn page khác page nhóm đích là nguồn lỗi "page mismatch" khó đoán.
 */
export function resolvePageIdForTarget(adset = {}, fallbackPageId = '') {
  const pid = adset.pageId || adset.promoted_object?.page_id || fallbackPageId;
  if (!pid) {
    throw new Error(`Nhóm "${adset.name || adset.id}" không xác định được Fanpage đích.`);
  }
  return String(pid);
}
```

### 4.3 Sửa route `GET /ad-accounts/:accountId/campaigns` — `src/cross-post.js:553`

Thay **toàn bộ** handler bằng:

```js
/**
 * GET /api/cp/ad-accounts/:accountId/campaigns
 * Danh sách chiến dịch của 1 tài khoản.
 *
 * Query (tất cả TUỲ CHỌN — không truyền gì thì hành vi y như trước 23/10/2026):
 *   statuses=ACTIVE,PAUSED | all     (all = + IN_PROCESS, WITH_ISSUES → lấy được CĐ nháp)
 *   includeArchived=1
 *   withDraftFlag=1                  (đếm adset/ad bằng summary để suy ra cờ nháp)
 *   limit=1..200
 */
crossPostRouter.get('/ad-accounts/:accountId/campaigns', async (req, res) => {
  const cleanId = req.params.accountId.replace(/^act_/, '');
  const { statuses, limit, withDraftFlag } = parseCampaignQuery(req.query);

  const fields = [
    'id', 'name', 'objective', 'status', 'effective_status',
    'created_time', 'daily_budget', 'lifetime_budget'
  ];
  // Field expansion + summary: đếm adset/ad ngay trong 1 request, thay vì
  // bắn thêm 1 request cho MỖI chiến dịch (18 CĐ = 18 request → 1 request).
  if (withDraftFlag) {
    fields.push('adsets.limit(0).summary(total_count)');
    fields.push('ads.limit(0).summary(total_count)');
  }

  try {
    const result = await callMeta(`/act_${cleanId}/campaigns`, {
      params: {
        fields: fields.join(','),
        effective_status: JSON.stringify(statuses).replace(/"/g, "'"),
        limit
      }
    });

    const campaigns = (result.data || []).map(normalizeCampaign);
    const counts = {
      total:  campaigns.length,
      draft:  campaigns.filter(c => c.isDraft).length,
      active: campaigns.filter(c => c.effective_status === 'ACTIVE').length,
      paused: campaigns.filter(c => c.effective_status === 'PAUSED').length
    };

    res.json({
      ok: true,
      campaigns,
      counts,
      notice: withDraftFlag
        ? 'Chỉ nạp được chiến dịch nháp đã tồn tại trên Meta. Bản nháp còn nằm trong trình tạo Ads Manager thì API không đọc được.'
        : undefined
    });
  } catch (err) {
    console.error(`[CrossPost] Lỗi lấy chiến dịch act_${cleanId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

> **Lưu ý về `effective_status`:** code cũ truyền chuỗi `"['ACTIVE','PAUSED']"`. Meta nhận dạng list dùng dấu nháy đơn, nên `JSON.stringify([...]).replace(/"/g, "'")` cho ra đúng định dạng đó. Giữ nguyên cách này để không đổi hành vi.

### 4.4 Route MỚI `GET /ad-accounts/:accountId/adsets?campaignIds=a,b,c`

Chèn **ngay sau** route campaigns ở trên. **KHÔNG xoá** route `/campaigns/:campaignId/adsets` cũ (dòng 577).

```js
/**
 * GET /api/cp/ad-accounts/:accountId/adsets?campaignIds=120x,120y
 * Lấy nhóm quảng cáo của NHIỀU chiến dịch bằng 1 request (filtering campaign.id IN).
 *
 * Route /campaigns/:campaignId/adsets vẫn giữ nguyên cho tab 2 — không xoá.
 */
crossPostRouter.get('/ad-accounts/:accountId/adsets', async (req, res) => {
  const cleanId = req.params.accountId.replace(/^act_/, '');
  const campaignIds = String(req.query.campaignIds || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (campaignIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Thiếu campaignIds.' });
  }
  if (campaignIds.length > 50) {
    return res.status(400).json({ ok: false, error: 'Tối đa 50 chiến dịch mỗi lần (giới hạn filtering IN của Meta).' });
  }

  const fields = 'id,name,campaign_id,status,effective_status,daily_budget,' +
                 'optimization_goal,billing_event,destination_type,' +
                 'promoted_object{page_id,application_id}';

  try {
    const result = await callMeta(`/act_${cleanId}/adsets`, {
      params: {
        fields,
        filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
        limit: 200
      }
    });
    return res.json({ ok: true, adsets: (result.data || []).map(normalizeAdset), fallback: false });
  } catch (err) {
    // Một số loại tài khoản từ chối filtering campaign.id IN → gọi từng chiến dịch.
    // Phải ghi log rõ là đã fallback (rule §4: nói rõ giới hạn dữ liệu).
    console.warn(`[CrossPost] filtering IN thất bại trên act_${cleanId} (${err.message}) → fallback gọi từng chiến dịch.`);
    try {
      const all = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < campaignIds.length; i += CONCURRENCY) {
        const chunk = campaignIds.slice(i, i + CONCURRENCY);
        const parts = await Promise.all(chunk.map(cid =>
          callMeta(`/${cid}/adsets`, { params: { fields, limit: 100 } })
            .then(r => r.data || [])
            .catch(e => { console.error(`[CrossPost] Lỗi adsets CĐ ${cid}: ${e.message}`); return []; })
        ));
        parts.forEach(p => all.push(...p));
      }
      return res.json({ ok: true, adsets: all.map(normalizeAdset), fallback: true });
    } catch (err2) {
      console.error(`[CrossPost] Lỗi lấy adsets act_${cleanId}:`, err2.message);
      return res.status(500).json({ ok: false, error: err2.message });
    }
  }
});
```

### 4.5 Nghiệm thu GĐ 1

Chạy server (`npm start`) rồi kiểm bằng lệnh:

```bash
curl "http://localhost:3000/api/cp/ad-accounts/<ACCOUNT_ID>/campaigns?statuses=all&withDraftFlag=1&limit=100"
```

- [ ] Có chiến dịch `"isDraft": true` xuất hiện (nếu BM thực sự có CĐ chưa có ad)
- [ ] `counts.draft` > 0 và khớp số dòng `isDraft:true`
- [ ] Gọi **không kèm query** → kết quả giống hệt trước khi sửa (chỉ ACTIVE/PAUSED, không có `isDraft`… thực ra vẫn có `isDraft:false` vì `normalizeCampaign` luôn chạy — điều này **chấp nhận được** vì chỉ thêm trường, không xoá/đổi trường cũ; tab 2 đọc `id`/`name` nên không ảnh hưởng)
- [ ] `curl "…/adsets?campaignIds=<id1>,<id2>"` trả nhóm của cả 2 chiến dịch, mỗi nhóm có `pageId`
- [ ] `npm test` xanh 64/64
---

## PHẦN 5 — GĐ 5a: HÀM PURE NHÓM "GHI" (`src/cross-post.js`)

Đặt ngay **trước** `buildCampaignBody()` (dòng 687) để các hàm dựng body nằm cùng một chỗ.

### 5.1 Vá `buildAdsetBody()` — thêm 2 tham số, giữ mặc định y như cũ

**Chỉ sửa chữ ký và 3 dòng cuối. 6 test cũ phải vẫn PASS** (chúng gọi không truyền 2 tham số mới):

```js
export function buildAdsetBody({
  campaignId, name, pageId, dailyBudget = 100000,
  targeting = {}, optimizationGoal = 'CONVERSATIONS',
  // THÊM 23/10/2026:
  // Chiến dịch dùng CBO (campaign.daily_budget) thì Meta TỪ CHỐI adset có
  // daily_budget riêng. Trước đây hàm này LUÔN gửi daily_budget → tạo nhóm
  // trong chiến dịch CBO chắc chắn lỗi. Mặc định false để không đổi hành vi cũ.
  useCampaignBudget = false,
  destinationType = ''
}) {
  const finalTargeting = {};

  if (targeting.geoLocations && Object.keys(targeting.geoLocations).length > 0) {
    finalTargeting.geo_locations = targeting.geoLocations;
  } else {
    finalTargeting.geo_locations = { countries: ['VN'] };
  }
  if (targeting.ageMin) finalTargeting.age_min = Number(targeting.ageMin);
  if (targeting.ageMax) finalTargeting.age_max = Number(targeting.ageMax);
  if (Array.isArray(targeting.genders) && targeting.genders.length > 0) {
    finalTargeting.genders = targeting.genders;
  }
  if (Array.isArray(targeting.placements) && targeting.placements.length > 0) {
    finalTargeting.publisher_platforms = targeting.placements;
  }
  if (Array.isArray(targeting.positions) && targeting.positions.length > 0) {
    finalTargeting.facebook_positions = targeting.positions;
  }

  const body = {
    name: String(name).trim(),
    campaign_id: campaignId,
    status: 'PAUSED',              // BẮT BUỘC — không bao giờ tạo ở trạng thái chạy
    optimization_goal: optimizationGoal,
    billing_event: 'IMPRESSIONS',
    promoted_object: { page_id: pageId },
    targeting: finalTargeting
  };

  if (!useCampaignBudget) {
    body.daily_budget = String(Math.round(Number(dailyBudget)));
  }
  if (destinationType) {
    body.destination_type = destinationType;
  }

  return body;
}
```

### 5.2 `buildAdCreativeBody()` — dựng creative cho cả 3 loại nội dung

```js
/**
 * CTA do người dùng tự chọn / tự điền (chốt chủ dự án 23/10/2026).
 * Không khoá cứng danh sách enum vì Meta bổ sung CTA mới theo từng phiên bản —
 * chỉ kiểm định dạng để chặn rác, còn đúng/sai nghiệp vụ thì Meta tự trả lỗi
 * và lỗi đó được cách ly theo từng quảng cáo.
 */
const CTA_PATTERN = /^[A-Z_]{3,40}$/;

/** Gợi ý cho dropdown ở UI — KHÔNG dùng để chặn. */
export const CTA_SUGGESTIONS = [
  'SEND_MESSAGE', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE', 'LEARN_MORE', 'SIGN_UP',
  'APPLY_NOW', 'CONTACT_US', 'CALL_NOW', 'GET_QUOTE', 'GET_OFFER',
  'SUBSCRIBE', 'BOOK_TRAVEL', 'SHOP_NOW', 'DOWNLOAD', 'NO_BUTTON'
];

/**
 * Dựng body tạo AdCreative. Tách khỏi route để test được mà không gọi Meta.
 *
 * 3 loại nội dung:
 *   page_post — dùng lại bài đã đăng trên Fanpage (object_story_id)
 *   custom    — soạn mới: message + headline + ảnh/video + CTA
 *   clone_ad  — nội dung bóc từ 1 ad mẫu, caller đã nạp sẵn vào content
 *
 * Bất biến: LUÔN có page_id. Ưu tiên image_hash (upload qua /adimages) hơn
 * imageUrl, vì Meta hay chặn fetch ảnh từ URL ngoài.
 */
export function buildAdCreativeBody({ pageId, content = {} }) {
  if (!pageId) throw new Error('buildAdCreativeBody: thiếu pageId.');

  const c = content;
  const name = `[Creative] ${String(c.name || 'Ad').slice(0, 80)}`;

  if (c.type === 'page_post') {
    const raw = String(c.sourcePostId || '').trim();
    if (!raw) throw new Error('buildAdCreativeBody: nội dung page_post thiếu sourcePostId.');
    const storyId = raw.includes('_') ? raw : `${pageId}_${raw}`;
    return { name, object_story_id: storyId };
  }

  const cta = String(c.ctaType || 'SEND_MESSAGE').trim();
  if (!CTA_PATTERN.test(cta)) {
    throw new Error(`buildAdCreativeBody: CTA không hợp lệ "${cta}" (cần chữ IN HOA và _ , 3–40 ký tự).`);
  }

  const link = (c.linkUrl && String(c.linkUrl).trim())
    ? String(c.linkUrl).trim()
    : `https://m.me/${pageId}`;

  const callToAction = (cta === 'NO_BUTTON') ? null : { type: cta, value: { link } };

  const spec = { page_id: pageId };

  if (c.videoId) {
    spec.video_data = {
      video_id: String(c.videoId),
      title: c.headline || '',
      message: c.message || ''
    };
    if (c.description) spec.video_data.link_description = c.description;
    if (callToAction)  spec.video_data.call_to_action = callToAction;
    if (c.imageHash)      spec.video_data.image_hash = c.imageHash;
    else if (c.imageUrl)  spec.video_data.image_url  = c.imageUrl;
  } else {
    spec.link_data = {
      link,
      message: c.message || '',
      name: c.headline || c.name || ''
    };
    if (c.description) spec.link_data.description = c.description;
    if (callToAction)  spec.link_data.call_to_action = callToAction;
    if (c.imageHash)      spec.link_data.image_hash = c.imageHash;
    else if (c.imageUrl)  spec.link_data.picture    = c.imageUrl;
  }

  return { name, object_story_spec: spec };
}
```

### 5.3 `buildAdBody()`

```js
/**
 * Dựng body tạo Ad.
 * Bất biến: status LUÔN 'PAUSED'. Tên ad bị cắt 200 ký tự (hạn mức của Meta)
 * và loại bỏ ký tự xuống dòng để không bị Meta từ chối.
 */
export function buildAdBody({ name, adsetId, creativeId }) {
  if (!adsetId)   throw new Error('buildAdBody: thiếu adsetId.');
  if (!creativeId) throw new Error('buildAdBody: thiếu creativeId.');

  const clean = String(name || 'Quảng cáo')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);

  return {
    name: clean || 'Quảng cáo',
    adset_id: String(adsetId),
    creative: { creative_id: String(creativeId) },
    status: 'PAUSED'   // BẮT BUỘC
  };
}
```

### 5.4 `renderAdName()`

```js
/**
 * Dựng tên quảng cáo từ mẫu có token.
 * Token hỗ trợ: {content} {adset} {campaign} {index} {date}
 * Token không có dữ liệu → thay bằng rỗng (KHÔNG in "{content}" thô lên Meta).
 */
export function renderAdName(pattern, ctx = {}) {
  const tokens = {
    content:  ctx.contentName  || '',
    adset:    ctx.adsetName    || '',
    campaign: ctx.campaignName || '',
    index:    ctx.index != null ? String(ctx.index) : '',
    date:     ctx.date || new Date().toISOString().slice(0, 10)
  };

  const raw = String(pattern || '{content} — {adset}')
    .replace(/\{(content|adset|campaign|index|date)\}/g, (_, k) => tokens[k]);

  const clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (clean || 'Quảng cáo').slice(0, 200);
}
```

### 5.5 `resolveAttachments()` — giải `attachTo`, chặn xung đột CBO/ABO

```js
/**
 * Giải trường attachTo của từng nhóm mới thành danh sách cặp (nhóm × chiến dịch).
 *
 *   attachTo = "all"              → tạo nhóm này trong MỌI chiến dịch mới
 *   attachTo = "<campaignKey>"    → chỉ trong 1 chiến dịch mới
 *   attachTo = "existing:<id>"    → trong 1 chiến dịch CÓ SẴN (gồm chiến dịch nháp)
 *
 * Chặn 2 lỗi mà Meta chỉ báo sau khi đã tạo nửa vời:
 *   1) attachTo trỏ tới chiến dịch không tồn tại
 *   2) chiến dịch dùng CBO nhưng nhóm vẫn khai ngân sách riêng (ABO)
 *
 * @param {object[]} campaigns          chiến dịch MỚI trong plan ({ key, name, dailyBudget })
 * @param {object[]} adsets             nhóm MỚI trong plan ({ key, name, dailyBudget, attachTo })
 * @param {object[]} existingCampaigns  chiến dịch CÓ SẴN ({ id, name, hasCbo }) để tra CBO
 */
export function resolveAttachments({ campaigns = [], adsets = [], existingCampaigns = [] }) {
  const newByKey = new Map(campaigns.map(c => [String(c.key), c]));
  const cboByExistingId = new Map(existingCampaigns.map(c => [String(c.id), Boolean(c.hasCbo)]));
  const out = [];

  for (const a of adsets) {
    const attach = String(a.attachTo || 'all');
    let refs;

    if (attach === 'all') {
      if (campaigns.length === 0) {
        throw new Error(`Nhóm "${a.name}" gán "all" nhưng plan không có chiến dịch mới nào.`);
      }
      refs = campaigns.map(c => ({
        kind: 'new', key: String(c.key), name: c.name,
        hasCbo: Number(c.dailyBudget || 0) > 0
      }));
    } else if (attach.startsWith('existing:')) {
      const id = attach.slice('existing:'.length).trim();
      if (!id) throw new Error(`Nhóm "${a.name}" có attachTo "existing:" thiếu ID chiến dịch.`);
      refs = [{ kind: 'existing', id, name: `CĐ ${id}`, hasCbo: cboByExistingId.get(id) === true }];
    } else {
      const c = newByKey.get(attach);
      if (!c) throw new Error(`Nhóm "${a.name}" gán vào chiến dịch không tồn tại trong plan: "${attach}".`);
      refs = [{ kind: 'new', key: String(c.key), name: c.name, hasCbo: Number(c.dailyBudget || 0) > 0 }];
    }

    for (const ref of refs) {
      if (ref.hasCbo && Number(a.dailyBudget || 0) > 0) {
        throw new Error(
          `Chiến dịch "${ref.name}" dùng ngân sách CBO — nhóm "${a.name}" không được đặt ngân sách riêng. ` +
          `Bỏ ngân sách ở nhóm, hoặc bỏ CBO ở chiến dịch.`
        );
      }
      out.push({ adsetSpec: a, campaignRef: ref, useCampaignBudget: ref.hasCbo });
    }
  }

  // Trần 3 nhóm MỚI / chiến dịch (chốt chủ dự án). Nhóm có sẵn trong chiến dịch
  // không bị tính vào trần này — trần chỉ áp cho những gì đợt chạy này tạo ra.
  const perCampaign = new Map();
  for (const o of out) {
    const k = o.campaignRef.kind === 'new' ? `new:${o.campaignRef.key}` : `ex:${o.campaignRef.id}`;
    perCampaign.set(k, (perCampaign.get(k) || 0) + 1);
  }
  for (const [k, n] of perCampaign) {
    if (n > SAFETY_LIMITS.BUILD_MAX_ADSETS_PER_CAMPAIGN) {
      throw new Error(`Chiến dịch ${k} được gán ${n} nhóm mới — tối đa ${SAFETY_LIMITS.BUILD_MAX_ADSETS_PER_CAMPAIGN} nhóm/chiến dịch.`);
    }
  }
  if (out.length > SAFETY_LIMITS.BUILD_MAX_NEW_ADSETS) {
    throw new Error(`Tổng ${out.length} nhóm mới — tối đa ${SAFETY_LIMITS.BUILD_MAX_NEW_ADSETS}.`);
  }

  return out;
}
```

### 5.6 `expandPairs()` — sinh ma trận nội dung × nhóm

```js
/**
 * Ghép nội dung với nhóm đích theo 3 chế độ:
 *   matrix      — N nội dung × M nhóm (mặc định)
 *   one_to_one  — nội dung thứ i vào nhóm thứ i (bắt buộc N === M)
 *   round_robin — quay vòng, tạo max(N, M) quảng cáo
 *
 * excluded: mảng pairKey ("contentKey|adsetId") người dùng bấm loại trừ ở UI.
 * Thứ tự trả về PHẢI ổn định để bảng xem trước khớp đúng thứ tự thực thi.
 */
export function expandPairs({ targets = [], contents = [], pairingMode = 'matrix', excluded = [] }) {
  if (targets.length === 0)  throw new Error('expandPairs: không có nhóm quảng cáo đích.');
  if (contents.length === 0) throw new Error('expandPairs: không có nội dung quảng cáo.');

  const skip = new Set(excluded);
  const keyOf = (c, t) => `${c.key}|${t.adsetId}`;
  const raw = [];

  if (pairingMode === 'matrix') {
    for (const c of contents) for (const t of targets) raw.push({ content: c, target: t });
  } else if (pairingMode === 'one_to_one') {
    if (contents.length !== targets.length) {
      throw new Error(`Chế độ 1-1 cần số nội dung bằng số nhóm (${contents.length} ≠ ${targets.length}).`);
    }
    for (let i = 0; i < contents.length; i++) raw.push({ content: contents[i], target: targets[i] });
  } else if (pairingMode === 'round_robin') {
    const n = Math.max(contents.length, targets.length);
    for (let i = 0; i < n; i++) {
      raw.push({ content: contents[i % contents.length], target: targets[i % targets.length] });
    }
  } else {
    throw new Error(`pairingMode không hợp lệ: "${pairingMode}".`);
  }

  return raw
    .filter(p => !skip.has(keyOf(p.content, p.target)))
    .map((p, i) => ({ ...p, index: i + 1, pairKey: keyOf(p.content, p.target) }));
}
```

### 5.7 `countPlanObjects()` + `estimateRunSeconds()`

```js
/**
 * Đếm tổng đối tượng sẽ tạo và chặn trần. Gọi TRƯỚC khi bắn request đầu tiên
 * lên Meta — vượt trần thì không được tạo nửa vời rồi mới báo lỗi.
 */
export function countPlanObjects({ campaignCount, adsetCount, adCount }) {
  const total = campaignCount + adsetCount + adCount;

  if (campaignCount > SAFETY_LIMITS.BUILD_MAX_NEW_CAMPAIGNS) {
    throw new Error(`${campaignCount} chiến dịch — tối đa ${SAFETY_LIMITS.BUILD_MAX_NEW_CAMPAIGNS}.`);
  }
  if (adCount > SAFETY_LIMITS.BUILD_MAX_ADS) {
    throw new Error(`${adCount} quảng cáo — tối đa ${SAFETY_LIMITS.BUILD_MAX_ADS}. Hãy bớt nội dung hoặc bớt nhóm đích.`);
  }
  if (total > SAFETY_LIMITS.BUILD_MAX_OBJECTS) {
    throw new Error(`Tổng ${total} đối tượng — tối đa ${SAFETY_LIMITS.BUILD_MAX_OBJECTS} mỗi đợt.`);
  }

  return { campaignCount, adsetCount, adCount, total };
}

/**
 * Ước tính thời gian chạy (giây) để UI cảnh báo trước. Chỉ cộng các giãn cách
 * bắt buộc — thời gian Meta phản hồi chưa tính, nên con số thực sẽ cao hơn.
 */
export function estimateRunSeconds({ campaignCount, adsetCount, adCount, creativeCount }) {
  const L = SAFETY_LIMITS;
  const ms = campaignCount * L.DELAY_BUILD_CAMPAIGN_MS
           + adsetCount    * L.DELAY_BUILD_ADSET_MS
           + creativeCount * L.DELAY_BUILD_CREATIVE_MS
           + adCount       * L.DELAY_BUILD_AD_MS;
  return Math.round(ms / 1000);
}
```

### 5.8 `expandSpintax()` + `normalizeImageUpload()`

```js
/**
 * Bung spintax: "Con {chưa tập trung|học mãi không vào}?" → nhiều biến thể.
 * Hỗ trợ lồng nhau. Thiếu dấu "}" → trả nguyên văn, KHÔNG throw (người dùng
 * đang gõ dở không nên bị chặn).
 */
export function expandSpintax(text, max = 6) {
  const src = String(text || '');
  const PAT = /\{([^{}]*)\}/;
  if (!PAT.test(src)) return [src];

  const expandOnce = (s) => {
    const m = PAT.exec(s);
    if (!m) return [s];
    const head = s.slice(0, m.index);
    const tail = s.slice(m.index + m[0].length);
    const opts = m[1].split('|');
    return opts.map(o => head + o.trim() + tail);
  };

  let frontier = [src];
  let guard = 0;
  while (frontier.some(s => PAT.test(s)) && guard++ < 12) {
    frontier = frontier.flatMap(expandOnce);
    if (frontier.length > 200) break;
  }

  const out = [];
  for (const s of frontier) {
    const v = s.replace(/\s{2,}/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : [src];
}

/**
 * Kiểm tra ảnh upload bằng MAGIC BYTES, không tin đuôi file.
 * Chỉ nhận JPEG / PNG — hai định dạng Meta /adimages chắc chắn nhận.
 */
export function normalizeImageUpload(buffer) {
  if (!buffer || buffer.length === 0) throw new Error('Tệp ảnh rỗng.');
  if (buffer.length > SAFETY_LIMITS.UPLOAD_IMAGE_MAX_BYTES) {
    const mb = (SAFETY_LIMITS.UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0);
    throw new Error(`Ảnh vượt ${mb} MB.`);
  }
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  if (!isJpeg && !isPng) throw new Error('Chỉ nhận ảnh JPEG hoặc PNG.');
  return { mime: isJpeg ? 'image/jpeg' : 'image/png', bytes: buffer.length };
}

/**
 * Lỗi Meta tạm thời → đáng thử lại 1 lần. Lỗi nghiệp vụ (sai CTA, sai
 * objective, hết ngân sách…) thì thử lại chỉ tốn thời gian và tăng rate-limit.
 */
export function isTransientMetaError(err = {}) {
  const transientCodes = new Set([1, 2, 4, 17, 341, 80000, 80004]);
  if (transientCodes.has(Number(err.code))) return true;
  return /rate limit|try again|temporarily|timeout/i.test(String(err.message || ''));
}
```

---

## PHẦN 6 — GĐ 5b: ROUTE GHI

### 6.1 Tổng quát hoá `newJob()` — `src/cross-post.js:35`

```js
function newJob(total, extra = {}) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    status: 'running', done: 0, total,
    results: [], error: null, at: Date.now(),
    ...extra
  });
  for (const [k, v] of jobs) if (Date.now() - v.at > JOB_TTL_MS) jobs.delete(k);
  return id;
}
```

Tương thích ngược: `newJob(10)` vẫn cho ra shape cũ.

### 6.2 `POST /api/cp/upload-ad-image`

```js
const IMAGE_HASH_CACHE_FILE = join(DATA_DIR, 'cp_image_hashes.json');

/** sha256 nội dung ảnh → image_hash đã upload. Tránh upload lại cùng 1 ảnh. */
let imageHashCache = null;
function loadImageHashCache() {
  if (imageHashCache) return imageHashCache;
  try {
    imageHashCache = existsSync(IMAGE_HASH_CACHE_FILE)
      ? JSON.parse(readFileSync(IMAGE_HASH_CACHE_FILE, 'utf-8'))
      : {};
  } catch { imageHashCache = {}; }
  return imageHashCache;
}
function saveImageHashCache() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(IMAGE_HASH_CACHE_FILE, JSON.stringify(imageHashCache, null, 2), 'utf-8');
  } catch (e) { console.warn('[CrossPost] Không ghi được cache image hash:', e.message); }
}

/**
 * POST /api/cp/upload-ad-image
 * Body: { accountId, fileName, dataBase64 }   // dataBase64 KHÔNG kèm "data:image/..."
 *
 * Trả image_hash để creative dùng link_data.image_hash — tin cậy hơn picture URL
 * vì Meta thường chặn fetch ảnh từ host ngoài.
 *
 * LƯU Ý: route này cần body lớn → src/server.js phải mount express.json({limit:'12mb'})
 * riêng cho đúng path này (xem §6.6).
 */
crossPostRouter.post('/upload-ad-image', async (req, res) => {
  const { accountId, fileName, dataBase64 } = req.body || {};
  if (!accountId || !dataBase64) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId hoặc dataBase64.' });
  }

  let buf;
  try {
    buf = Buffer.from(String(dataBase64), 'base64');
    normalizeImageUpload(buf);
  } catch (err) {
    const code = /vượt/.test(err.message) ? 413 : 400;
    return res.status(code).json({ ok: false, error: err.message });
  }

  const cleanAccId = String(accountId).replace(/^act_/, '');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const cacheKey = `${cleanAccId}:${sha}`;
  const cache = loadImageHashCache();

  if (cache[cacheKey]) {
    return res.json({ ok: true, cached: true, ...cache[cacheKey] });
  }

  try {
    const result = await callMeta(`act_${cleanAccId}/adimages`, {
      method: 'POST',
      body: { bytes: buf.toString('base64') }
    });

    // Meta trả { images: { "<fileName>": { hash, url, width, height } } }
    const first = Object.values(result.images || {})[0] || {};
    if (!first.hash) throw new Error('Meta không trả về image hash.');

    const payload = {
      imageHash: first.hash,
      url: first.url || '',
      width: first.width || 0,
      height: first.height || 0,
      fileName: String(fileName || 'image')
    };
    cache[cacheKey] = payload;
    saveImageHashCache();

    res.json({ ok: true, cached: false, ...payload });
  } catch (err) {
    console.error(`[CrossPost] Lỗi upload ảnh act_${cleanAccId}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### 6.3 `GET` / `POST /api/cp/content-library`

```js
const CONTENT_LIBRARY_FILE = join(DATA_DIR, 'cp_content_library.json');
const CONTENT_LIBRARY_MAX = 200;

function readContentLibrary() {
  try {
    return existsSync(CONTENT_LIBRARY_FILE)
      ? JSON.parse(readFileSync(CONTENT_LIBRARY_FILE, 'utf-8'))
      : [];
  } catch { return []; }
}

crossPostRouter.get('/content-library', (req, res) => {
  res.json({ ok: true, items: readContentLibrary() });
});

/**
 * POST /api/cp/content-library
 * Body: { items: [...] }  — thêm vào đầu danh sách, giữ tối đa 200 mục.
 * Chỉ nhận đúng các trường đã khai; bỏ mọi trường lạ để file không phình.
 */
crossPostRouter.post('/content-library', (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  if (incoming.length === 0) {
    return res.status(400).json({ ok: false, error: 'Danh sách nội dung cần lưu đang rỗng.' });
  }

  const pick = (o) => ({
    id: String(o.id || crypto.randomUUID()),
    name: String(o.name || '').slice(0, 120),
    message: String(o.message || '').slice(0, 4000),
    headline: String(o.headline || '').slice(0, 200),
    description: String(o.description || '').slice(0, 300),
    linkUrl: String(o.linkUrl || '').slice(0, 500),
    ctaType: String(o.ctaType || 'SEND_MESSAGE').slice(0, 40),
    imageHash: String(o.imageHash || ''),
    imageUrl: String(o.imageUrl || '').slice(0, 500),
    videoId: String(o.videoId || ''),
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 8).map(t => String(t).slice(0, 30)) : [],
    savedAt: new Date().toISOString()
  });

  try {
    const existing = readContentLibrary();
    const added = incoming.map(pick);
    const addedIds = new Set(added.map(a => a.id));
    const merged = [...added, ...existing.filter(e => !addedIds.has(e.id))].slice(0, CONTENT_LIBRARY_MAX);

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONTENT_LIBRARY_FILE, JSON.stringify(merged, null, 2), 'utf-8');

    res.json({ ok: true, saved: added.length, total: merged.length });
  } catch (err) {
    console.error('[CrossPost] Lỗi ghi thư viện nội dung:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### 6.4 `POST /api/cp/build-structure` — route + validate

```js
/**
 * Chặn gửi lại cùng 1 plan (người dùng bấm 2 lần / mạng chập chờn).
 * planId → { jobId, at }. Trong 10 phút thì trả lại đúng job cũ.
 */
const planJobs = new Map();
const PLAN_DEDUPE_MS = 600000;

/**
 * POST /api/cp/build-structure
 *
 * ENGINE CHUNG cho tab 2 (tạo mới hàng loạt) và tab 3 (đăng vào CĐ/nhóm có sẵn).
 * 3 pha tuần tự: chiến dịch → nhóm → quảng cáo. Pha nào không có dữ liệu thì bỏ qua.
 *
 * Body: {
 *   planId, accountId,
 *   campaigns:       [{ key, name, objective?, dailyBudget? }],
 *   adsets:          [{ key, name, pageId, dailyBudget?, optimizationGoal?,
 *                       destinationType?, targeting?, attachTo }],
 *   existingTargets: [{ campaignId, campaignName, adsetId, adsetName, pageId }],
 *   existingCampaigns: [{ id, name, hasCbo }],     // để chặn xung đột CBO
 *   contents:        [{ key, name, type, ... }],
 *   pairingMode, namePattern, excludedPairs
 * }
 *
 * Trả NGAY { ok, jobId, preview } rồi chạy ngầm — đợt lớn nhất mất ~7 phút.
 */
crossPostRouter.post('/build-structure', withLock('buildStructure'), async (req, res) => {
  const p = req.body || {};
  const {
    planId, accountId,
    campaigns = [], adsets = [], existingTargets = [], existingCampaigns = [],
    contents = [], pairingMode = 'matrix',
    namePattern = '{content} — {adset}', excludedPairs = []
  } = p;

  // --- Chống gửi trùng ---
  if (planId && planJobs.has(planId)) {
    const prev = planJobs.get(planId);
    if (Date.now() - prev.at < PLAN_DEDUPE_MS) {
      return res.json({ ok: true, jobId: prev.jobId, deduped: true });
    }
  }

  // --- Validate cơ bản ---
  if (!accountId) {
    return res.status(400).json({ ok: false, error: 'Thiếu accountId (mỗi đợt chỉ 1 tài khoản quảng cáo).' });
  }
  if (contents.length === 0) {
    return res.status(400).json({ ok: false, error: 'Chưa có nội dung quảng cáo nào.' });
  }
  if (contents.length > SAFETY_LIMITS.BUILD_MAX_CONTENTS) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BUILD_MAX_CONTENTS} nội dung mỗi đợt.` });
  }
  if (adsets.length === 0 && existingTargets.length === 0) {
    return res.status(400).json({ ok: false, error: 'Chưa chọn nhóm quảng cáo đích, cũng chưa khai nhóm tạo mới.' });
  }
  if (existingTargets.length > SAFETY_LIMITS.BUILD_MAX_TARGETS) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BUILD_MAX_TARGETS} nhóm đích mỗi đợt.` });
  }

  // --- Validate nội dung ---
  for (const c of contents) {
    if (!c.key) return res.status(400).json({ ok: false, error: 'Mỗi nội dung phải có "key" duy nhất.' });
    if (c.type === 'page_post' && !c.sourcePostId) {
      return res.status(400).json({ ok: false, error: `Nội dung "${c.name || c.key}" thiếu bài đăng nguồn.` });
    }
    if ((!c.type || c.type === 'custom') && !c.message && !c.imageHash && !c.imageUrl && !c.videoId) {
      return res.status(400).json({ ok: false, error: `Nội dung "${c.name || c.key}" trống — cần ít nhất nội dung chữ hoặc ảnh/video.` });
    }
  }

  // --- Giải attachTo + đếm đối tượng + ước tính thời gian ---
  let attachments, pairs, counts, etaSeconds, creativeCount;
  try {
    attachments = resolveAttachments({ campaigns, adsets, existingCampaigns });

    // Nhóm sẽ tạo chưa có ID thật, nhưng ĐẾM được để chặn trần trước khi gọi Meta.
    const plannedTargetCount = attachments.length + existingTargets.length;
    if (plannedTargetCount > SAFETY_LIMITS.BUILD_MAX_TARGETS) {
      throw new Error(`Tổng ${plannedTargetCount} nhóm đích — tối đa ${SAFETY_LIMITS.BUILD_MAX_TARGETS}.`);
    }

    // Số quảng cáo = kết quả expandPairs trên tập nhóm giả lập cùng kích thước.
    const mockTargets = [
      ...attachments.map((a, i) => ({ adsetId: `new_${i}`, adsetName: a.adsetSpec.name, campaignName: a.campaignRef.name })),
      ...existingTargets.map(t => ({ adsetId: t.adsetId, adsetName: t.adsetName, campaignName: t.campaignName }))
    ];
    pairs = expandPairs({ targets: mockTargets, contents, pairingMode, excluded: excludedPairs });

    creativeCount = new Set(pairs.map(x => `${x.target.pageId || ''}|${x.content.key}`)).size || contents.length;
    counts = countPlanObjects({
      campaignCount: campaigns.length,
      adsetCount: attachments.length,
      adCount: pairs.length
    });
    etaSeconds = estimateRunSeconds({ ...counts, creativeCount });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  // --- Mở job rồi trả về ngay ---
  const totalSteps = counts.total;
  const jobId = newJob(totalSteps, {
    phase: 'campaigns',
    created: { campaigns: [], adsets: [], ads: [] },
    logs: [],
    plan: { accountId, pairingMode, namePattern, counts, etaSeconds }
  });
  if (planId) planJobs.set(planId, { jobId, at: Date.now() });

  res.json({
    ok: true, jobId,
    preview: { ...counts, creativeCount, etaSeconds }
  });

  const job = jobs.get(jobId);
  runBuildStructure({
    accountId, campaigns, attachments, existingTargets,
    contents, pairingMode, namePattern, excludedPairs
  }, job)
    .then(() => { job.status = 'done'; })
    .catch(err => { job.status = 'error'; job.error = err.message; pushLog(job, 'error', `Đợt chạy dừng: ${err.message}`); });
});
```

### 6.5 `runBuildStructure()` — bộ thực thi 3 pha

```js
const JOB_LOG_MAX = 500;

function pushLog(job, level, msg) {
  job.logs.push({ at: new Date().toISOString(), level, msg });
  if (job.logs.length > JOB_LOG_MAX) job.logs.splice(0, job.logs.length - JOB_LOG_MAX);
  const tag = level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : 'OK';
  console.log(`[BuildStructure][${tag}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Gọi Meta, thử lại 1 lần nếu là lỗi tạm thời. */
async function callMetaWithRetry(endpoint, options, job, label) {
  try {
    return { data: await callMeta(endpoint, options), retried: false };
  } catch (err) {
    if (!isTransientMetaError(err)) throw err;
    pushLog(job, 'warn', `${label}: lỗi tạm thời (${err.message}) — chờ 5s thử lại.`);
    await sleep(5000);
    return { data: await callMeta(endpoint, options), retried: true };
  }
}

/**
 * Thực thi plan theo 3 pha. Nguyên tắc: lỗi 1 đối tượng chỉ fail đối tượng đó.
 * Chiến dịch lỗi → bỏ các nhóm gán vào nó. Creative lỗi → bỏ các quảng cáo
 * dùng creative đó (đánh skipped). Không bao giờ dừng cả đợt vì 1 lỗi lẻ.
 */
async function runBuildStructure(plan, job) {
  const L = SAFETY_LIMITS;
  const cleanAccId = String(plan.accountId).replace(/^act_/, '');
  await ensurePageTokens();

  // ---------- PHA 1: CHIẾN DỊCH ----------
  job.phase = 'campaigns';
  const campaignIdByKey = new Map();
  const campaignNameById = new Map();

  for (const spec of plan.campaigns) {
    const row = { key: String(spec.key), name: spec.name, id: null, success: false, error: null };
    try {
      const body = buildCampaignBody({
        name: spec.name,
        objective: spec.objective || 'OUTCOME_ENGAGEMENT',
        dailyBudget: spec.dailyBudget
      });
      const { data } = await callMetaWithRetry(
        `act_${cleanAccId}/campaigns`, { method: 'POST', body }, job, `Chiến dịch "${spec.name}"`
      );
      row.id = data.id;
      row.success = true;
      campaignIdByKey.set(row.key, data.id);
      campaignNameById.set(data.id, spec.name);
      pushLog(job, 'success', `Đã tạo chiến dịch "${spec.name}" → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `Lỗi tạo chiến dịch "${spec.name}": ${err.message}`);
    }
    job.created.campaigns.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_CAMPAIGN_MS);
  }

  // ---------- PHA 2: NHÓM QUẢNG CÁO ----------
  job.phase = 'adsets';
  const createdTargets = [];

  for (const att of plan.attachments) {
    const spec = att.adsetSpec;
    const ref = att.campaignRef;

    let campaignId = null;
    if (ref.kind === 'new') {
      campaignId = campaignIdByKey.get(ref.key) || null;
      if (!campaignId) {
        const row = { key: spec.key, name: spec.name, campaignId: null, id: null,
                      success: false, skipped: true,
                      error: `Bỏ qua: chiến dịch "${ref.name}" tạo không thành công.` };
        job.created.adsets.push(row);
        job.done++;
        pushLog(job, 'warn', row.error);
        continue;
      }
    } else {
      campaignId = ref.id;
      if (!campaignNameById.has(campaignId)) campaignNameById.set(campaignId, ref.name);
    }

    const row = { key: spec.key, name: spec.name, campaignId, id: null,
                  success: false, skipped: false, error: null };
    try {
      const body = buildAdsetBody({
        campaignId,
        name: spec.name,
        pageId: spec.pageId,
        dailyBudget: spec.dailyBudget,
        targeting: spec.targeting || {},
        optimizationGoal: spec.optimizationGoal || 'CONVERSATIONS',
        destinationType: spec.destinationType || '',
        useCampaignBudget: att.useCampaignBudget
      });
      const { data } = await callMetaWithRetry(
        `act_${cleanAccId}/adsets`, { method: 'POST', body }, job, `Nhóm "${spec.name}"`
      );
      row.id = data.id;
      row.success = true;
      createdTargets.push({
        campaignId,
        campaignName: campaignNameById.get(campaignId) || '',
        adsetId: data.id,
        adsetName: spec.name,
        pageId: spec.pageId
      });
      pushLog(job, 'success', `Đã tạo nhóm "${spec.name}" trong CĐ ${campaignId} → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `Lỗi tạo nhóm "${spec.name}": ${err.message}`);
    }
    job.created.adsets.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_ADSET_MS);
  }

  // ---------- PHA 3: QUẢNG CÁO ----------
  job.phase = 'ads';
  const targets = [...createdTargets, ...plan.existingTargets];

  if (targets.length === 0) {
    pushLog(job, 'error', 'Không còn nhóm đích nào khả dụng — không tạo được quảng cáo.');
    job.summary = buildSummary(job);
    return;
  }

  let pairs;
  try {
    pairs = expandPairs({
      targets, contents: plan.contents,
      pairingMode: plan.pairingMode, excluded: plan.excludedPairs
    });
  } catch (err) {
    pushLog(job, 'error', `Không ghép được ma trận: ${err.message}`);
    job.summary = buildSummary(job);
    return;
  }

  // Creative thuộc AD ACCOUNT, không thuộc adset. Mỗi đợt chỉ 1 tài khoản nên
  // khoá cache là (pageId, contentKey): 10 nội dung × 20 nhóm cùng page chỉ cần
  // 10 creative + 200 ad, thay vì 200 creative. Giảm ~95% lệnh tạo creative.
  pairs.sort((a, b) => {
    const ka = `${a.target.pageId}|${a.content.key}`;
    const kb = `${b.target.pageId}|${b.content.key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const creativeCache = new Map();   // `${pageId}|${contentKey}` -> creativeId
  const creativeFailed = new Map();  // cùng khoá -> lý do lỗi

  let adIndex = 0;
  for (const pair of pairs) {
    adIndex++;
    const { content, target } = pair;
    let pageId;
    try {
      pageId = resolvePageIdForTarget(target, content.pageId || '');
    } catch (err) {
      job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true, error: err.message });
      job.done++;
      pushLog(job, 'error', err.message);
      continue;
    }

    const ck = `${pageId}|${content.key}`;

    if (creativeFailed.has(ck)) {
      job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true,
                             error: `Bỏ qua: creative lỗi (${creativeFailed.get(ck)})` });
      job.done++;
      continue;
    }

    if (!creativeCache.has(ck)) {
      try {
        const body = buildAdCreativeBody({ pageId, content });
        const { data } = await callMetaWithRetry(
          `act_${cleanAccId}/adcreatives`, { method: 'POST', body }, job, `Creative "${content.name || content.key}"`
        );
        creativeCache.set(ck, data.id);
        pushLog(job, 'success', `Đã tạo creative "${content.name || content.key}" (page ${pageId}) → ${data.id}`);
      } catch (err) {
        creativeFailed.set(ck, err.message);
        job.created.ads.push({ ...baseAdRow(pair, target, content), success: false, skipped: true,
                               error: `Lỗi creative: ${err.message}` });
        job.done++;
        pushLog(job, 'error', `Lỗi tạo creative "${content.name || content.key}": ${err.message}`);
        continue;
      }
      await sleep(L.DELAY_BUILD_CREATIVE_MS);
    }

    const creativeId = creativeCache.get(ck);
    const adName = renderAdName(plan.namePattern, {
      contentName: content.name,
      adsetName: target.adsetName,
      campaignName: target.campaignName,
      index: adIndex
    });

    const row = { ...baseAdRow(pair, target, content), adName, creativeId, success: false, skipped: false, error: null, retried: false };
    try {
      const { data, retried } = await callMetaWithRetry(
        `act_${cleanAccId}/ads`,
        { method: 'POST', body: buildAdBody({ name: adName, adsetId: target.adsetId, creativeId }) },
        job, `Quảng cáo "${adName}"`
      );
      row.adId = data.id;
      row.success = true;
      row.retried = retried;
      pushLog(job, 'success', `[${adIndex}/${pairs.length}] Đã tạo "${adName}" → ${data.id} (PAUSED)`);
    } catch (err) {
      row.error = err.message;
      pushLog(job, 'error', `[${adIndex}/${pairs.length}] Lỗi tạo "${adName}": ${err.message}`);
    }
    job.created.ads.push(row);
    job.done++;
    await sleep(L.DELAY_BUILD_AD_MS);
  }

  job.summary = buildSummary(job);
  pushLog(job, 'success',
    `HOÀN TẤT: ${job.summary.campaignsCreated} chiến dịch · ${job.summary.adsetsCreated} nhóm · ` +
    `${job.summary.adsCreated} quảng cáo (tất cả PAUSED). Thất bại: ${job.summary.failed}.`);
}

function baseAdRow(pair, target, content) {
  return {
    pairKey: pair.pairKey,
    campaignId: target.campaignId,
    campaignName: target.campaignName,
    adsetId: target.adsetId,
    adsetName: target.adsetName,
    contentKey: content.key,
    contentName: content.name || content.key,
    adId: null, creativeId: null, adName: ''
  };
}

function buildSummary(job) {
  const c = job.created;
  const adsOk = c.ads.filter(a => a.success).length;
  const byCampaign = {};
  for (const a of c.ads) {
    const k = a.campaignName || a.campaignId || '(không rõ)';
    byCampaign[k] = byCampaign[k] || { success: 0, failed: 0 };
    a.success ? byCampaign[k].success++ : byCampaign[k].failed++;
  }
  return {
    campaignsCreated: c.campaigns.filter(x => x.success).length,
    adsetsCreated:    c.adsets.filter(x => x.success).length,
    adsCreated:       adsOk,
    failed: c.campaigns.filter(x => !x.success).length
          + c.adsets.filter(x => !x.success).length
          + c.ads.filter(x => !x.success).length,
    creativesCreated: new Set(c.ads.filter(a => a.creativeId).map(a => a.creativeId)).size,
    byCampaign
  };
}
```

### 6.6 `GET /api/cp/job/:jobId/csv`

```js
/**
 * GET /api/cp/job/:jobId/csv
 * Xuất kết quả đợt chạy. UTF-8 BOM để Excel tiếng Việt không lỗi font
 * (cùng chuẩn với src/export-csv.js).
 */
crossPostRouter.get('/job/:jobId/csv', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).type('text/plain').send('Không tìm thấy tiến trình (có thể đã hết hạn).');

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];

  lines.push('# CHIEN DICH DA TAO');
  lines.push(['Ten', 'Campaign ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.campaigns || []) {
    lines.push([r.name, r.id || '', r.success ? 'Thanh cong' : 'Loi', r.error || ''].map(esc).join(','));
  }

  lines.push('');
  lines.push('# NHOM QUANG CAO DA TAO');
  lines.push(['Ten', 'Adset ID', 'Campaign ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.adsets || []) {
    lines.push([r.name, r.id || '', r.campaignId || '', r.success ? 'Thanh cong' : (r.skipped ? 'Bo qua' : 'Loi'), r.error || ''].map(esc).join(','));
  }

  lines.push('');
  lines.push('# QUANG CAO DA TAO');
  lines.push(['Chien dich', 'Campaign ID', 'Nhom QC', 'Adset ID', 'Noi dung', 'Ten Ad', 'Ad ID', 'Creative ID', 'Ket qua', 'Loi'].join(','));
  for (const r of job.created?.ads || []) {
    lines.push([
      r.campaignName, r.campaignId, r.adsetName, r.adsetId, r.contentName,
      r.adName, r.adId || '', r.creativeId || '',
      r.success ? 'Thanh cong' : (r.skipped ? 'Bo qua' : 'Loi'), r.error || ''
    ].map(esc).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ket-qua-${req.params.jobId.slice(0, 8)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));   // BOM
});
```

### 6.7 Vá `src/server.js`

Chèn **ngay trước** `app.use('/api/cp', crossPostRouter)` (dòng 431):

```js
// Route upload ảnh quảng cáo cần body tới 12 MB (ảnh base64), trong khi toàn
// hệ thống giữ limit 256 KB. Nâng limit CHỈ cho đúng path này — nâng toàn cục
// sẽ mở cửa cho request rác làm phình RAM.
app.use('/api/cp/upload-ad-image', express.json({ limit: '12mb' }));
```

Guard token hiện có (`app.use('/api/cp', …)` dòng 427) đã bắt mọi method khác GET/HEAD, nên 3 route ghi mới **tự động được bảo vệ** — không cần sửa gì thêm.

### 6.8 Nghiệm thu GĐ 5

- [ ] `curl -X POST .../build-structure` **không kèm** `X-Internal-Token` → **403 BAD_SESSION**
- [ ] Gửi plan trống nội dung → 400 kèm thông báo tiếng Việt rõ nghĩa
- [ ] Gửi plan 16 chiến dịch → 400 "tối đa 15"
- [ ] Gửi plan có CĐ CBO + nhóm khai `dailyBudget` → 400 nói rõ xung đột
- [ ] **Chạy thật 1 nội dung × 1 nhóm có sẵn**: `GET /api/cp/job/:jobId` thấy `phase` chuyển `campaigns → adsets → ads`, 1 ad tạo ra, `status: PAUSED` khi kiểm trong Ads Manager
- [ ] Gửi lại cùng `planId` → trả `deduped: true`, **không** tạo thêm ad
- [ ] `GET /api/cp/job/:jobId/csv` mở bằng Excel không lỗi font tiếng Việt
- [ ] `npm test` xanh
---

## PHẦN 7 — GĐ 2: TAB 3, BƯỚC 1 (CHỌN ĐÍCH)

### 7.1 `public/cross-post.html` — nút tab

Chèn **ngay sau** `#tabAdsBtn` (dòng 56):

```html
<button id="tabBulkAdsBtn" class="cp-tab-btn" type="button">
  <i data-lucide="layout-grid"></i>
  <span>Đăng Ads hàng loạt (gồm CĐ nháp)</span>
</button>
```

### 7.2 `public/cross-post.html` — khung section

Chèn **ngay sau** thẻ đóng `</section>` của `#adsSection` (dòng 622):

```html
<!-- ========================================================= -->
<!-- SECTION 3: ĐĂNG ADS HÀNG LOẠT VÀO CĐ/NHÓM CÓ SẴN          -->
<!-- ========================================================= -->
<section id="bulkAdsSection" style="display:none;">

  <nav class="studio-stepper" id="bulkStepper" aria-label="Các bước đăng ads hàng loạt">
    <div class="studio-step-item active" data-bulk-step="1" id="bulkStepInd1">
      <span class="step-badge">1</span><span>Chọn Chiến dịch &amp; Nhóm đích</span>
    </div>
    <div class="studio-step-divider"></div>
    <div class="studio-step-item" data-bulk-step="2" id="bulkStepInd2">
      <span class="step-badge">2</span><span>Soạn nội dung Quảng cáo</span>
    </div>
    <div class="studio-step-divider"></div>
    <div class="studio-step-item" data-bulk-step="3" id="bulkStepInd3">
      <span class="step-badge">3</span><span>Ma trận &amp; Kiểm tra</span>
    </div>
    <div class="studio-step-divider"></div>
    <div class="studio-step-item" data-bulk-step="4" id="bulkStepInd4">
      <span class="step-badge">4</span><span>Thực thi</span>
    </div>
  </nav>

  <!-- ---------------- BƯỚC 1 ---------------- -->
  <div id="bulkStep1" class="studio-step-container">
    <div class="cp-card">
      <div class="cp-card-header">
        <h2 class="cp-card-title">
          <span class="step-num">1</span>
          <span>Chọn Tài khoản, Chiến dịch (gồm bản nháp) &amp; Nhóm đích</span>
        </h2>
        <span class="badge" id="bulkTargetBadge">0 nhóm đích</span>
      </div>

      <div class="cp-editor-box">
        <div class="cp-form-group">
          <label for="bulkAccountSelect" class="cp-form-label">
            Tài khoản Quảng cáo <span class="cp-label-hint">(mỗi đợt chỉ 1 tài khoản)</span>
          </label>
          <select id="bulkAccountSelect" class="select-filter cp-w-full">
            <option value="">-- Đang tải tài khoản quảng cáo... --</option>
          </select>
        </div>

        <div class="bulk-filter-row">
          <div class="cp-form-group cp-flex-1">
            <label for="bulkCampaignSearch" class="cp-form-label">Tìm theo tên chiến dịch</label>
            <input type="text" id="bulkCampaignSearch" class="cp-input" placeholder="VD: khaigiang, ucmas...">
          </div>
          <div class="cp-form-group">
            <label for="bulkCampaignFilter" class="cp-form-label">Lọc trạng thái</label>
            <select id="bulkCampaignFilter" class="select-filter">
              <option value="all">Tất cả</option>
              <option value="draft">Chỉ bản nháp</option>
              <option value="active">Đang chạy</option>
              <option value="paused">Tạm dừng</option>
            </select>
          </div>
          <div class="bulk-filter-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="bulkReloadCampaignsBtn">
              <i data-lucide="refresh-cw"></i><span>Tải lại</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="bulkExpandAllBtn">Mở hết</button>
            <button type="button" class="btn btn-secondary btn-sm" id="bulkClearTargetsBtn">Bỏ chọn hết</button>
          </div>
        </div>

        <div class="bulk-notice-draft" id="bulkDraftNotice">
          <i data-lucide="info"></i>
          <span>
            Chỉ nạp được <strong>chiến dịch nháp đã tồn tại trên Meta</strong> (chưa có quảng cáo,
            hoặc đang xử lý). Bản nháp còn nằm trong <strong>trình tạo của Ads Manager</strong> thì
            Marketing API không đọc được — hãy Lưu/Xuất bản bản nháp đó trong Ads Manager trước.
          </span>
        </div>

        <div id="bulkTargetTree" class="bulk-tree">
          <div class="cp-empty-state">Hãy chọn Tài khoản quảng cáo ở trên.</div>
        </div>

        <div class="bulk-count-line">
          Đã chọn <strong id="bulkSelectedTargetsCount">0</strong> nhóm
          thuộc <strong id="bulkSelectedCampaignsCount">0</strong> chiến dịch
        </div>
      </div>
    </div>
  </div>

  <!-- BƯỚC 2, 3, 4: xem §8, §9, §10 -->
  <div id="bulkStep2" class="studio-step-container" style="display:none;"></div>
  <div id="bulkStep3" class="studio-step-container" style="display:none;"></div>
  <div id="bulkStep4" class="studio-step-container" style="display:none;"></div>

  <footer class="studio-nav-bar">
    <button type="button" class="btn btn-secondary" id="bulkBackBtn" style="display:none;">
      <i data-lucide="arrow-left"></i><span>Quay lại</span>
    </button>
    <div class="studio-nav-right">
      <button type="button" class="btn btn-primary" id="bulkNextBtn">
        <span>Tiếp theo</span><i data-lucide="arrow-right"></i>
      </button>
      <button type="button" class="btn btn-primary btn-success-tone" id="bulkExecuteBtn" style="display:none;">
        <i data-lucide="rocket"></i><span>Tiến hành tạo Quảng cáo (PAUSED)</span>
      </button>
    </div>
  </footer>
</section>
```

> `style="display:none"` trên container bước là **trạng thái runtime** → được phép inline (L9). Các thuộc tính tĩnh khác (`cp-w-full`, `cp-flex-1`, `studio-nav-right`, `btn-success-tone`…) phải viết class trong CSS, **không** inline.

### 7.3 `public/js/bulk-ads-app.js` — khung và bước 1

```js
/**
 * Tab 3 — Đăng Ads hàng loạt vào chiến dịch / nhóm CÓ SẴN (gồm chiến dịch nháp).
 *
 * Khác tab 2 (ads-studio.js): tab này KHÔNG tạo chiến dịch/nhóm mới, chỉ gắn
 * quảng cáo vào cấu trúc đã có. Cả hai dùng chung engine POST /api/cp/build-structure.
 *
 * Mỗi đợt chỉ 1 tài khoản quảng cáo (chốt chủ dự án 23/10/2026).
 */
window.BulkAds = (function () {
  'use strict';

  const S = window.CPShared;

  const LIMITS = {          // phải khớp SAFETY_LIMITS ở backend
    MAX_TARGETS: 45,
    MAX_CONTENTS: 12,
    MAX_ADS: 135
  };

  const st = {
    initialized: false,
    step: 1,
    accountId: '',
    accountName: '',
    campaigns: [],                   // đã normalize, có isDraft
    adsetsByCampaign: new Map(),     // campaignId -> adset[]
    expandedCampaigns: new Set(),
    selectedAdsets: new Map(),       // adsetId -> { campaignId, campaignName, adsetId, adsetName, pageId }
    filter: 'all',
    search: '',
    contents: [],                    // do CPShared.ContentEditor quản lý
    pairingMode: 'matrix',
    namePattern: '{content} — {adset}',
    excludedPairs: new Set(),
    planId: '',
    jobId: '',
    polling: null,
    isExecuting: false
  };

  function init() {
    if (st.initialized) return;
    st.initialized = true;
    bindEvents();
    loadAccounts();
  }

  // ------------------------------------------------------------------
  // BƯỚC 1 — chọn đích
  // ------------------------------------------------------------------
  async function loadAccounts() {
    const sel = document.getElementById('bulkAccountSelect');
    try {
      const data = await S.apiGet('/api/cp/ad-accounts');
      const accs = data.accounts || [];
      sel.innerHTML = '<option value="">-- Chọn tài khoản quảng cáo --</option>' +
        accs.map(a => `<option value="${a.accountId}">${S.escapeHtml(a.name)} (act_${a.accountId})</option>`).join('');
      if (accs.length === 1) { sel.value = accs[0].accountId; sel.dispatchEvent(new Event('change')); }
    } catch (err) {
      sel.innerHTML = `<option value="">Lỗi tải tài khoản: ${S.escapeHtml(err.message)}</option>`;
    }
  }

  /** Đổi tài khoản = đổi toàn bộ ngữ cảnh → xoá lựa chọn cũ, cảnh báo rõ. */
  async function onAccountChange(accountId) {
    if (st.selectedAdsets.size > 0 &&
        !confirm('Đổi tài khoản sẽ xoá toàn bộ nhóm đích đang chọn. Tiếp tục?')) {
      document.getElementById('bulkAccountSelect').value = st.accountId;
      return;
    }
    st.accountId = accountId;
    st.accountName = document.getElementById('bulkAccountSelect').selectedOptions[0]?.textContent || accountId;
    st.campaigns = [];
    st.adsetsByCampaign.clear();
    st.selectedAdsets.clear();
    st.expandedCampaigns.clear();
    renderTree();
    if (accountId) await loadCampaigns();
  }

  /**
   * Nạp chiến dịch KÈM cờ nháp.
   * statuses=all → thêm IN_PROCESS & WITH_ISSUES; withDraftFlag=1 → đếm adset/ad.
   */
  async function loadCampaigns() {
    const box = document.getElementById('bulkTargetTree');
    box.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span><p>Đang tải chiến dịch...</p></div>';
    try {
      const data = await S.apiGet(
        `/api/cp/ad-accounts/${st.accountId}/campaigns?statuses=all&withDraftFlag=1&limit=200`
      );
      st.campaigns = data.campaigns || [];
      renderTree();
      updateCounts(data.counts);
    } catch (err) {
      box.innerHTML = `<div class="cp-empty-state cp-text-danger">Lỗi tải chiến dịch: ${S.escapeHtml(err.message)}</div>`;
    }
  }

  function visibleCampaigns() {
    const q = st.search.trim().toLowerCase();
    return st.campaigns.filter(c => {
      if (q && !String(c.name).toLowerCase().includes(q)) return false;
      if (st.filter === 'draft')  return c.isDraft;
      if (st.filter === 'active') return c.effective_status === 'ACTIVE';
      if (st.filter === 'paused') return c.effective_status === 'PAUSED';
      return true;
    });
  }

  const DRAFT_REASON_TEXT = {
    no_ad:       'Chưa có quảng cáo nào',
    no_adset:    'Chưa có nhóm quảng cáo',
    in_process:  'Meta đang xử lý',
    with_issues: 'Đang có vấn đề cần xử lý'
  };

  function renderTree() {
    const box = document.getElementById('bulkTargetTree');
    if (!st.accountId) { box.innerHTML = '<div class="cp-empty-state">Hãy chọn Tài khoản quảng cáo ở trên.</div>'; return; }

    const list = visibleCampaigns();
    if (list.length === 0) { box.innerHTML = '<div class="cp-empty-state">Không có chiến dịch nào khớp bộ lọc.</div>'; return; }

    box.innerHTML = list.map(c => {
      const adsets = st.adsetsByCampaign.get(c.id) || null;
      const open = st.expandedCampaigns.has(c.id);
      const noAdset = c.adsetsCount === 0;

      const chips = [
        `<span class="bulk-chip bulk-chip--status">${S.escapeHtml(c.effective_status)}</span>`,
        c.isDraft ? `<span class="bulk-chip bulk-chip--draft" title="${S.escapeHtml(DRAFT_REASON_TEXT[c.draftReason] || 'Bản nháp')}">Nháp</span>` : '',
        c.hasCbo ? '<span class="bulk-chip bulk-chip--cbo">CBO</span>' : '',
        `<span class="bulk-chip">${c.adsetsCount ?? '?'} nhóm · ${c.adsCount ?? '?'} ads</span>`
      ].join('');

      // Chiến dịch nháp CHƯA CÓ NHÓM thì không đăng ad vào được — nói thẳng,
      // không cho tick, và chỉ sang tab 2 để tạo nhóm.
      const body = noAdset
        ? `<div class="bulk-tree-warn">Chiến dịch này chưa có nhóm quảng cáo — không thể đăng ads vào.
             Hãy sang tab <strong>Nhân bản Quảng cáo</strong> để tạo nhóm trước.</div>`
        : (adsets === null
            ? `<div class="bulk-tree-loading">Bấm để tải danh sách nhóm...</div>`
            : adsets.map(a => `
                <label class="bulk-tree-node bulk-tree-node--adset">
                  <input type="checkbox" class="bulk-adset-cb" data-adset-id="${a.id}" data-campaign-id="${c.id}"
                         ${st.selectedAdsets.has(a.id) ? 'checked' : ''}>
                  <span class="bulk-adset-name">${S.escapeHtml(a.name)}</span>
                  <span class="bulk-chip">${S.escapeHtml(a.effective_status)}</span>
                  ${a.pageId ? '' : '<span class="bulk-chip bulk-chip--warn">Thiếu Fanpage</span>'}
                </label>`).join(''));

      return `
        <div class="bulk-tree-group" data-campaign-id="${c.id}">
          <div class="bulk-tree-node bulk-tree-node--campaign" data-toggle-campaign="${c.id}">
            <i data-lucide="${open ? 'chevron-down' : 'chevron-right'}"></i>
            <input type="checkbox" class="bulk-campaign-cb" data-campaign-id="${c.id}" ${noAdset ? 'disabled' : ''}>
            <span class="bulk-campaign-name">${S.escapeHtml(c.name)}</span>
            ${chips}
          </div>
          <div class="bulk-tree-children" ${open ? '' : 'style="display:none;"'}>${body}</div>
        </div>`;
    }).join('');

    S.refreshIcons();
    syncTriState();
  }
```

**Các hàm còn lại của bước 1** (viết tiếp theo đúng mô tả):

| Hàm | Nhiệm vụ |
|---|---|
| `toggleCampaign(campaignId)` | mở/đóng nhánh; lần mở đầu tiên gọi `loadAdsets([campaignId])` |
| `loadAdsets(campaignIds)` | `GET /api/cp/ad-accounts/:acc/adsets?campaignIds=…` (gộp nhiều CĐ 1 request); nếu `data.fallback === true` thì hiện chú thích "đã dùng cách gọi dự phòng" |
| `onCampaignCheckbox(id, checked)` | tick CĐ = tick mọi nhóm của nó; nếu chưa tải nhóm thì tải trước rồi mới tick |
| `onAdsetCheckbox(adsetId, campaignId, checked)` | thêm/bớt trong `st.selectedAdsets`; **chặn khi vượt `LIMITS.MAX_TARGETS`** kèm alert rõ số |
| `syncTriState()` | đặt `indeterminate` cho checkbox CĐ khi chọn một phần |
| `updateCounts(counts)` | cập nhật `#bulkSelectedTargetsCount`, `#bulkSelectedCampaignsCount`, `#bulkTargetBadge`; nếu `counts.draft > 0` thì thêm dòng "Tìm thấy N chiến dịch nháp" |
| `expandAll()` | mở hết nhánh + gọi `loadAdsets()` cho mọi CĐ đang hiển thị (gộp tối đa 50 id / request) |

### 7.4 Nghiệm thu GĐ 2

- [ ] Tab 3 hiện ra, chọn tài khoản → cây chiến dịch nạp đủ
- [ ] Chiến dịch nháp có chip **Nháp** + tooltip đúng lý do
- [ ] Lọc "Chỉ bản nháp" hiện đúng tập hợp
- [ ] CĐ chưa có nhóm → checkbox bị disable + hiện dòng cảnh báo
- [ ] Tick CĐ chọn hết nhóm con; chọn một phần → checkbox CĐ ở trạng thái indeterminate
- [ ] Chọn vượt 45 nhóm → bị chặn kèm thông báo
- [ ] Đổi tài khoản → hỏi xác nhận, xoá lựa chọn cũ
- [ ] Console 0 lỗi

---

## PHẦN 8 — GĐ 3: `cp-shared.js` — SOẠN NỘI DUNG (DÙNG CHUNG 2 TAB)

Toàn bộ phần này viết **một lần** trong `cp-shared.js`, cả tab 2 và tab 3 gọi lại.

### 8.1 API của module

```js
/**
 * ContentEditor — bộ soạn nội dung quảng cáo dùng chung.
 *
 * Mount vào 1 container, trả về đối tượng điều khiển:
 *   const editor = CPShared.ContentEditor.mount({
 *     containerId: 'bulkContentBox',
 *     max: 12,
 *     accountId: () => st.accountId,      // hàm, vì người dùng đổi TK giữa đường
 *     pages: () => CPShared.getPages(),
 *     onChange: (contents) => { ... }     // gọi mỗi khi danh sách nội dung đổi
 *   });
 *   editor.getContents();   // mảng content chuẩn gửi lên build-structure
 *   editor.setContents(arr);
 */
```

### 8.2 Cấu trúc 1 nội dung (shape gửi lên backend)

```js
{
  key: 'c1',                  // duy nhất trong đợt, dùng làm khoá cache creative
  name: 'QC01 - Tập trung',   // tên nội bộ, vào {content} của mẫu tên ad
  type: 'custom',             // custom | page_post | clone_ad
  message: '...',             // Primary text
  headline: '...',            // Headline (link_data.name / video_data.title)
  description: '...',         // Description
  ctaType: 'SEND_MESSAGE',
  linkUrl: '',                // rỗng → backend tự dùng https://m.me/<pageId>
  imageHash: '',              // ưu tiên; có được sau khi upload
  imageUrl: '',               // dự phòng
  videoId: '',
  sourcePostId: '',           // khi type = page_post
  sourceAdId: ''              // khi type = clone_ad
}
```

### 8.3 Bốn cách nạp nội dung — tab con

| Tab con | Nguồn | Ghi chú |
|---|---|---|
| **Soạn mới** | người dùng gõ | mỗi thẻ = 1 quảng cáo |
| **Từ bài Fanpage** | `GET /api/cp/pages/:pageId/posts` | tích nhiều bài → mỗi bài 1 nội dung `type:'page_post'` |
| **Từ Ads mẫu** | `GET /api/cp/adsets/:adsetId/ads` | bóc `creative.body` → `message`, `creative.title` → `headline`, `image_url` → `imageUrl`; đặt `type:'custom'` để tạo creative mới trên tài khoản đích (an toàn hơn `clone_ad` cross-account) |
| **Thư viện** | `GET /api/cp/content-library` | nạp lại nội dung đã lưu |

### 8.4 Thẻ nội dung — các control bắt buộc

| Control | `id` (hậu tố `-<cardId>`) | Ghi chú |
|---|---|---|
| Tên nội bộ | `cpcName-` | bắt buộc |
| Primary text | `cpcMessage-` | textarea, đếm ký tự, khuyến nghị ≤ 125 |
| Headline | `cpcHeadline-` | đếm ký tự, khuyến nghị ≤ 40 |
| Description | `cpcDesc-` | đếm ký tự, khuyến nghị ≤ 30 |
| CTA | `cpcCta-` | `<select>` từ `CTA_SUGGESTIONS` + mục `__custom__` |
| CTA tự nhập | `cpcCtaCustom-` | hiện khi chọn `__custom__`; validate `^[A-Z_]{3,40}$` |
| Link đích | `cpcLink-` | rỗng → dùng `m.me/<pageId>` |
| Ảnh | `cpcDrop-` | kéo-thả hoặc chọn file |
| Video ID | `cpcVideo-` | tuỳ chọn |
| Nhân bản thẻ | `cpcDup-` | copy toàn bộ trường, `key` mới |
| Xoá thẻ | `cpcDel-` | chặn xoá khi chỉ còn 1 thẻ |

Đếm ký tự vượt khuyến nghị → thêm class `cp-char-counter--over` (chỉ **cảnh báo**, không chặn — Meta vẫn nhận).

### 8.5 Upload ảnh — kéo-thả

```js
/**
 * Đọc file ảnh → base64 → POST /api/cp/upload-ad-image → image_hash.
 * Dùng image_hash thay vì URL ngoài vì Meta thường chặn fetch ảnh từ host lạ.
 */
async function uploadImage(file, accountId) {
  const MAX = 8 * 1024 * 1024;
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Chỉ nhận ảnh JPEG hoặc PNG.');
  if (file.size > MAX) throw new Error(`Ảnh ${(file.size / 1048576).toFixed(1)} MB — vượt 8 MB.`);
  if (!accountId) throw new Error('Hãy chọn Tài khoản quảng cáo trước khi tải ảnh.');

  const dataBase64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.readAsDataURL(file);
  });

  const data = await apiPost('/api/cp/upload-ad-image', {
    accountId, fileName: file.name, dataBase64
  });
  return { imageHash: data.imageHash, url: data.url, cached: data.cached };
}
```

### 8.6 Bộ sinh biến thể (rule-based, không LLM)

Dự án **không có LLM** (`src/ai-analyst.js` cũng là rule-based) — không được gọi dịch vụ AI ngoài.

```js
/**
 * Bung spintax phía client để xem trước tức thì.
 * Bản backend (expandSpintax trong src/cross-post.js) là bản có test; bản này
 * phải cho ra KẾT QUẢ GIỐNG — nếu sửa thuật toán thì sửa cả hai.
 */
function expandSpintax(text, max = 6) { /* copy đúng logic §5.8 */ }

/** Hook mở đầu theo 4 sản phẩm của BM — chỉ là GỢI Ý, người dùng sửa được. */
const HOOK_LIBRARY = {
  ucmas:  ['Con tính nhẩm chậm hơn bạn cùng lớp?', 'Bé 6 tuổi nhân 3 chữ số trong 5 giây — bằng cách nào?'],
  uckid:  ['Bé vào lớp 1 mà chưa ngồi yên được 10 phút?', 'Giai đoạn vàng 4-6 tuổi trôi qua rất nhanh'],
  mathca: ['Con sợ môn Toán từ lớp mấy?', 'Giải toán bằng tư duy, không học thuộc mẹo'],
  traihe: ['Hè này con ở nhà với điện thoại?', 'Trại hè không chỉ để chơi']
};
```

UI: chọn số biến thể (2–6) → tạo thẻ nội dung mới, **tên có nhãn `Biến thể #n`** để không lẫn với bản gốc (L12 — không trình bày nội dung sinh tự động như thể do người viết).

### 8.7 Nghiệm thu GĐ 3

- [ ] Thêm/nhân bản/xoá thẻ nội dung hoạt động; không xoá được thẻ cuối cùng
- [ ] Đếm ký tự đổi màu khi vượt khuyến nghị, **không** chặn
- [ ] CTA: chọn từ danh sách **và** tự nhập được; nhập sai định dạng → báo lỗi tại chỗ
- [ ] Kéo-thả ảnh JPEG/PNG → hiện preview + `image_hash`
- [ ] Upload lại cùng ảnh → response `cached: true`, không gọi Meta lần 2
- [ ] Ảnh GIF / ảnh > 8 MB → báo lỗi rõ ràng, không gửi lên server
- [ ] Nạp từ bài Fanpage / Ads mẫu / Thư viện đều ra thẻ nội dung đúng
- [ ] Lưu vào thư viện rồi nạp lại ở phiên sau vẫn còn

---

## PHẦN 9 — GĐ 4: TAB 3, BƯỚC 3 (MA TRẬN)

### 9.1 Nội dung `#bulkStep3`

| Element | `id` | Mô tả |
|---|---|---|
| Chế độ ghép | `bulkPairingMode` | `matrix` (mặc định) / `one_to_one` / `round_robin` |
| Mẫu tên ad | `bulkNamePattern` | mặc định `{content} — {adset}` |
| Preview tên | `bulkNamePreview` | 3 dòng tên ad đầu tiên |
| Bảng ma trận | `bulkMatrixTable` | hàng = nội dung, cột = nhóm đích |
| Tổng kết | `bulkMatrixSummary` | số ad · số creative · ước tính thời gian |
| Cảnh báo | `bulkMatrixWarn` | CTA lệch objective, thời gian > 5 phút, vượt trần |

### 9.2 Logic ma trận

```js
/**
 * Sinh danh sách cặp để xem trước. PHẢI cho ra thứ tự giống expandPairs()
 * ở backend, nếu không bảng xem trước sẽ lệch với thứ tự thực thi.
 */
function buildPairs() {
  const targets = Array.from(st.selectedAdsets.values());
  const contents = st.contents;
  const mode = st.pairingMode;
  const out = [];

  if (mode === 'matrix') {
    for (const c of contents) for (const t of targets) out.push({ content: c, target: t });
  } else if (mode === 'one_to_one') {
    if (contents.length !== targets.length) return { error: `Chế độ 1-1 cần ${targets.length} nội dung, hiện có ${contents.length}.`, pairs: [] };
    for (let i = 0; i < contents.length; i++) out.push({ content: contents[i], target: targets[i] });
  } else {
    const n = Math.max(contents.length, targets.length);
    for (let i = 0; i < n; i++) out.push({ content: contents[i % contents.length], target: targets[i % targets.length] });
  }

  const pairs = out.filter(p => !st.excludedPairs.has(`${p.content.key}|${p.target.adsetId}`));
  return { error: null, pairs };
}

/** Ước tính thời gian — công thức PHẢI khớp estimateRunSeconds() ở backend. */
function estimateSeconds(adCount, creativeCount) {
  return Math.round((creativeCount * 1200 + adCount * 2000) / 1000);
}
```

Tổng kết hiển thị:

```
Sẽ tạo 48 quảng cáo · 12 creative mới · ước tính ≈ 2 phút 10 giây
```

### 9.3 Quy tắc chặn / cảnh báo

| Điều kiện | Hành vi |
|---|---|
| `pairs.length === 0` | disable nút Tiếp theo, hiện lý do |
| `pairs.length > 135` | **disable** nút thực thi, hiện "Vượt trần 135 quảng cáo — cần bỏ bớt N" |
| `estimateSeconds > 300` | cảnh báo vàng "Đợt này chạy khoảng X phút, đừng tắt server giữa đợt" |
| CTA của nội dung không khớp `optimizationGoal` của nhóm đích | cảnh báo vàng liệt kê cặp lệch, **không chặn** (chốt #3) |
| Nhóm đích thiếu `pageId` | cảnh báo vàng: creative sẽ dùng Fanpage dự phòng đã chọn |

Ô ma trận bấm được → thêm/bớt `st.excludedPairs`, đổi class `bulk-matrix-cell--off`, tính lại tổng kết ngay.

### 9.4 Nghiệm thu GĐ 4

- [ ] Ma trận 3 nội dung × 4 nhóm = 12 ô ✓, tổng kết "12 quảng cáo"
- [ ] Bấm loại trừ 2 ô → tổng còn 10, số creative tính lại đúng
- [ ] Đổi sang `1-1` khi số lượng lệch → báo lỗi rõ, chặn đi tiếp
- [ ] `round_robin` 3 nội dung × 5 nhóm = 5 quảng cáo
- [ ] Mẫu tên đổi → preview đổi theo ngay
- [ ] Dựng cấu hình vượt 135 → nút thực thi bị disable

---

## PHẦN 10 — GĐ 6: TAB 3, BƯỚC 4 (THỰC THI)

### 10.1 Modal xác nhận có cổng số

```js
/**
 * Bắt người dùng gõ đúng số lượng quảng cáo sẽ tạo.
 * confirm() suông quá dễ bấm Enter — mà mỗi lần bấm nhầm là tạo tới 135 object
 * THẬT trên BM, dọn tay rất mệt.
 */
function confirmExecute(adCount, etaSeconds) {
  const typed = prompt(
    `Sắp tạo ${adCount} quảng cáo THẬT trên Meta (tất cả PAUSED).\n` +
    `Ước tính ${Math.ceil(etaSeconds / 60)} phút.\n\n` +
    `Gõ đúng số ${adCount} để xác nhận:`
  );
  return String(typed || '').trim() === String(adCount);
}
```

> Nếu muốn modal đẹp hơn `prompt()` thì tái dùng `#confirmModal` sẵn có ([cross-post.html:629](public/cross-post.html:629)) và thêm 1 ô input — **không được bỏ cổng số**.

### 10.2 Gửi plan và poll job

```js
async function executeBulk() {
  if (st.isExecuting) return;

  const { pairs, error } = buildPairs();
  if (error) { alert(error); return; }
  if (pairs.length === 0) { alert('Chưa có quảng cáo nào để tạo.'); return; }

  const creativeCount = new Set(pairs.map(p => `${p.target.pageId}|${p.content.key}`)).size;
  if (!confirmExecute(pairs.length, estimateSeconds(pairs.length, creativeCount))) return;

  st.isExecuting = true;
  st.planId = crypto.randomUUID();
  setExecUi(true);

  try {
    const data = await S.apiPost('/api/cp/build-structure', {
      planId: st.planId,
      accountId: st.accountId,
      campaigns: [],                 // tab 3 KHÔNG tạo chiến dịch mới
      adsets: [],                    // tab 3 KHÔNG tạo nhóm mới
      existingTargets: Array.from(st.selectedAdsets.values()),
      contents: st.contents,
      pairingMode: st.pairingMode,
      namePattern: st.namePattern,
      excludedPairs: Array.from(st.excludedPairs)
    });

    st.jobId = data.jobId;
    renderJobHeader(data);
    pollJob(data.jobId);
  } catch (err) {
    logExec('error', `Không khởi tạo được đợt chạy: ${err.message}`);
    st.isExecuting = false;
    setExecUi(false);
  }
}

/**
 * Poll 2 giây/lần. Job sống ở server nên đóng tab không mất kết quả —
 * phải nói rõ điều đó cho người dùng kèm theo jobId.
 */
function pollJob(jobId) {
  clearInterval(st.polling);
  st.polling = setInterval(async () => {
    try {
      const j = await S.apiGet(`/api/cp/job/${jobId}`);
      renderProgress(j);
      renderLogs(j.logs || []);
      if (j.status === 'done' || j.status === 'error') {
        clearInterval(st.polling);
        st.polling = null;
        st.isExecuting = false;
        setExecUi(false);
        renderResultTable(j);
      }
    } catch (err) {
      logExec('warn', `Mất kết nối khi hỏi tiến độ (${err.message}) — sẽ thử lại.`);
    }
  }, 2000);
}
```

### 10.3 Vùng kết quả — các element

| Element | `id` | Mô tả |
|---|---|---|
| Thanh tiến độ | `bulkProgressFill` | `width` theo `done/total` (inline, hợp lệ theo L9) |
| Trạng thái pha | `bulkPhaseText` | "Đang tạo quảng cáo (37/60)" |
| Mã job | `bulkJobIdText` | kèm câu: *đóng tab vẫn chạy, mở `/api/cp/job/<id>` để xem lại* |
| Log | `bulkExecLog` | cuộn tự động, màu theo `level` |
| Bảng kết quả | `bulkResultTable` | nhóm theo chiến dịch, hiện Ad ID |
| Tải CSV | `bulkDownloadCsvBtn` | link `/api/cp/job/<id>/csv` |
| Thử lại phần lỗi | `bulkRetryFailedBtn` | gửi plan mới chỉ gồm cặp thất bại, `planId` mới |

### 10.4 Nghiệm thu GĐ 6

- [ ] Modal buộc gõ đúng số; gõ sai → không chạy
- [ ] Tiến độ chạy mượt, pha đổi `campaigns → adsets → ads`
- [ ] Log hiện từng dòng, lỗi màu đỏ
- [ ] **Kiểm trong Ads Manager: mọi ad tạo ra đều PAUSED**
- [ ] Cố tình đặt 1 nội dung sai (CTA lạ) → chỉ ad đó lỗi, các ad khác vẫn tạo
- [ ] F5 giữa đợt → mở `/api/cp/job/<id>` vẫn thấy tiến độ
- [ ] CSV tải về mở bằng Excel đúng font tiếng Việt
- [ ] "Thử lại phần lỗi" chỉ tạo lại phần thất bại, không nhân đôi phần đã thành công

---

## PHẦN 11 — GĐ 7 & 8: NÂNG CẤP TAB 2

Giữ nguyên 4 bước, giữ nguyên **bộ sinh tên chuẩn 4 sản phẩm**. Mỗi bước thêm 1 chế độ "nhiều".

### 11.1 Bước 1 — thêm chế độ thứ 3

Thêm vào `.studio-switch` ([cross-post.html:243](public/cross-post.html:243)):

```html
<button type="button" class="studio-switch-btn" id="btnModeMultiCamp">
  <i data-lucide="layers-3"></i><span>Tạo nhiều Chiến dịch</span>
</button>
```

Khối mới `#boxMultiCamp`:

| Element | `id` | Mô tả |
|---|---|---|
| Danh sách thẻ CĐ | `studioCampaignCards` | tối đa **15** |
| Thêm thẻ | `btnAddCampaignCard` | disable khi đạt 15 |
| Sinh nhanh theo sản phẩm | `btnQuickGenCampaigns` | tick UCMAS/UCKID/MATHCA/TRẠI HÈ → 1 thẻ mỗi sản phẩm, cùng thông điệp |
| Mỗi thẻ | `scName-/scPrefix-/scProduct-/scDesc-/scCbo-/scDup-/scDel-` | tên đầy đủ tự sinh `{prefix}/{product}/mess/{desc}`, readonly |

> Bộ sinh tên **phải giữ đúng công thức hiện có** (`cross-post-app.js:869`): `${prefix}/${product}/mess/${desc}` — Dashboard nhận diện sản phẩm bằng đoạn giữa dấu `/` thứ 1 và thứ 2 (quy tắc §1). Sai công thức là làm sai phân loại sản phẩm của toàn bộ Dashboard.

### 11.2 Bước 2 — thêm chế độ thứ 3

```html
<button type="button" class="studio-switch-btn" id="btnModeMultiAdset">
  <i data-lucide="layers-3"></i><span>Tạo nhiều Nhóm</span>
</button>
```

Khối mới `#boxMultiAdset`:

| Element | `id` | Mô tả |
|---|---|---|
| Danh sách thẻ nhóm | `studioAdsetCards` | tối đa **3 thẻ** (vì mỗi thẻ nhân vào mọi CĐ → 15 × 3 = 45) |
| Thêm thẻ | `btnAddAdsetCard` | disable khi đạt 3 |
| Cách gán | `studioAdsetAttachMode` | `all` = mọi chiến dịch · `each` = gán riêng từng thẻ |
| Chọn CĐ cho thẻ | `saAttach-<cardId>` | chỉ hiện khi chọn `each` |
| Mỗi thẻ | `saName-/saPage-/saBudget-/saAgeMin-/saAgeMax-/saGender-/saGeo-/saPlacement-` | tái dùng đúng control targeting đang có |
| Xem trước cây | `studioStructurePreview` | sơ đồ cây + tổng số đối tượng |

**Trần phải kiểm ngay trên UI:** `số CĐ × số thẻ nhóm ≤ 45` và `≤ 3 nhóm / chiến dịch`.

Xem trước cây:

```
haicm/ucmas/mess/khaigiang   (CBO 150.000đ)
  ├─ Nữ 25-45 HN      (ngân sách nhóm: tắt — CĐ dùng CBO)
  └─ Nữ 25-45 HCM
haicm/uckid/mess/khaigiang   (CBO 150.000đ)
  ├─ Nữ 25-45 HN
  └─ Nữ 25-45 HCM
→ 2 chiến dịch · 4 nhóm · 12 quảng cáo = 18 đối tượng · ước tính ≈ 1 phút 10 giây
```

### 11.3 Chặn xung đột CBO/ABO trên UI

```js
/**
 * Chiến dịch có ngân sách CBO thì nhóm KHÔNG được có ngân sách riêng —
 * Meta từ chối thẳng. Chặn ngay trên UI để người dùng không phải đợi 2 phút
 * mới biết lỗi.
 */
function syncBudgetLock() {
  const anyCbo = st.campaignCards.some(c => Number(c.cboBudget) > 0);
  st.adsetCards.forEach(card => {
    const el = document.getElementById(`saBudget-${card.id}`);
    if (!el) return;
    el.disabled = anyCbo;
    el.title = anyCbo ? 'Chiến dịch đang dùng ngân sách CBO — nhóm không đặt ngân sách riêng.' : '';
  });
  document.getElementById('studioBudgetLockNote').style.display = anyCbo ? 'block' : 'none';
}
```

### 11.4 Bước 3 — thay bằng `CPShared.ContentEditor`

Thay 3 tab nội dung hiện tại bằng module dùng chung ở §8 (có thêm CTA, thư viện, biến thể). **Giữ nguyên** 3 cách nạp cũ để người dùng không mất thao tác quen.

### 11.5 Bước 4 — chuyển sang `build-structure`

Viết lại `executeStudioBatch()` ([cross-post-app.js:1546](public/js/cross-post-app.js:1546), sau GĐ 0 nằm trong `ads-studio.js`):

```js
/**
 * Trước 23/10/2026: gọi lần lượt create-campaign → create-adset → batch-create-ads
 * và CHỜ ĐỒNG BỘ. Với 15 CĐ × 3 nhóm thì đợt chạy tới ~7 phút — vượt xa sức chịu
 * của 1 HTTP request. Nay gom thành 1 plan và poll job.
 */
async function executeStudioBatch() {
  const plan = buildPlanFromStudioState();   // xem bảng ánh xạ dưới
  if (!confirmExecute(plan.expectedAds, plan.etaSeconds)) return;

  const data = await S.apiPost('/api/cp/build-structure', plan.payload);
  pollJob(data.jobId);   // dùng chung CPShared.pollJob
}
```

**Bảng ánh xạ `studioState` → payload `build-structure`:**

| Chế độ bước 1 | Chế độ bước 2 | `campaigns` | `adsets` | `existingTargets` |
|---|---|---|---|---|
| CĐ có sẵn | Nhóm có sẵn | `[]` | `[]` | nhóm đã tick |
| CĐ có sẵn | Tạo 1 nhóm | `[]` | 1 thẻ, `attachTo:"existing:<campId>"` | `[]` |
| CĐ có sẵn | Tạo nhiều nhóm | `[]` | n thẻ, `attachTo:"existing:<campId>"` | `[]` |
| Tạo 1 CĐ | Tạo 1 nhóm | 1 thẻ | 1 thẻ, `attachTo:"all"` | `[]` |
| Tạo nhiều CĐ | Tạo nhiều nhóm (`all`) | n thẻ | m thẻ, `attachTo:"all"` | `[]` |
| Tạo nhiều CĐ | Tạo nhiều nhóm (`each`) | n thẻ | m thẻ, `attachTo:"<campKey>"` | `[]` |

Luôn kèm `existingCampaigns` (danh sách `{id, name, hasCbo}` của các CĐ có sẵn liên quan) để backend chặn được xung đột CBO.

### 11.6 Nghiệm thu GĐ 7 & 8

- [ ] Tạo 3 thẻ chiến dịch, tên đầy đủ đúng công thức `{prefix}/{product}/mess/{desc}`
- [ ] "Sinh nhanh theo sản phẩm" tick 4 sản phẩm → đúng 4 thẻ
- [ ] Thêm quá 15 thẻ CĐ / 3 thẻ nhóm → bị chặn
- [ ] `attachTo: all` với 3 CĐ × 2 nhóm → cây xem trước hiện 6 nhóm
- [ ] Đặt CBO ở CĐ → ô ngân sách nhóm tự disable
- [ ] **Chạy thật 1 CĐ × 1 nhóm × 1 nội dung** → cây tạo đúng, tất cả PAUSED
- [ ] Chế độ cũ (CĐ có sẵn + nhóm có sẵn) chạy y như trước
- [ ] 3 route cũ vẫn tồn tại và vẫn gọi được bằng `curl`

---

## PHẦN 12 — GĐ 10a: TEST

### 12.1 `test/bulk-ads.test.js`

```js
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
```

### 12.2 Bổ sung `test/cp-guard.test.js`

Thêm 3 route ghi mới vào danh sách phải nằm sau token guard:

```js
test('route ghi mới của engine build-structure đều cần token phiên', () => {
  const writeRoutes = ['build-structure', 'upload-ad-image', 'content-library'];
  // Guard trong server.js chặn theo METHOD (mọi method khác GET/HEAD), nên chỉ
  // cần khẳng định 3 route này là POST — không phải GET — để không lọt khe.
  for (const r of writeRoutes) {
    assert.match(source, new RegExp(`crossPostRouter\\.post\\('/${r}'`),
      `${r} phải là POST để tự động được token guard bảo vệ`);
  }
});
```

### 12.3 Nghiệm thu

```bash
npm test
```

- [ ] **64 test cũ PASS** (đặc biệt 6 test `buildAdsetBody` + test khoá `SAFETY_LIMITS`)
- [ ] ~40 test mới PASS
- [ ] Không có test nào bị `skip`

---

## PHẦN 13 — CSS (`public/css/cross-post.css`)

Thêm vào cuối file. Dùng biến `:root` sẵn có trong `public/css/style.css`, **không thêm màu cứng** (L9).

### 13.1 Danh sách class phải viết

| Nhóm | Class |
|---|---|
| Tiện ích | `.cp-w-full`, `.cp-flex-1`, `.cp-text-danger`, `.cp-label-hint`, `.studio-nav-right`, `.btn-success-tone` |
| Cây chọn đích | `.bulk-tree`, `.bulk-tree-group`, `.bulk-tree-node`, `.bulk-tree-node--campaign`, `.bulk-tree-node--adset`, `.bulk-tree-children`, `.bulk-tree-warn`, `.bulk-tree-loading`, `.bulk-campaign-name`, `.bulk-adset-name` |
| Chip | `.bulk-chip`, `.bulk-chip--status`, `.bulk-chip--draft`, `.bulk-chip--cbo`, `.bulk-chip--warn` |
| Lọc & đếm | `.bulk-filter-row`, `.bulk-filter-actions`, `.bulk-count-line`, `.bulk-notice-draft` |
| Thẻ nội dung / CĐ / nhóm | `.cp-entity-card`, `.cp-entity-card-head`, `.cp-entity-card-body`, `.cp-entity-card-actions`, `.cp-char-counter`, `.cp-char-counter--over` |
| Upload ảnh | `.cp-droparea`, `.cp-droparea--hover`, `.cp-droparea-preview` |
| Ma trận | `.bulk-matrix-wrap`, `.bulk-matrix-table`, `.bulk-matrix-cell`, `.bulk-matrix-cell--off`, `.bulk-matrix-head` |
| Thực thi | `.cp-log-row`, `.cp-log-row--error`, `.cp-log-row--warn`, `.cp-log-row--success`, `.bulk-result-group` |
| Cây xem trước (tab 2) | `.studio-structure-tree`, `.studio-structure-node` |
| Biến thể | `.cp-variant-box`, `.cp-variant-list` |

### 13.2 Ví dụ mẫu — tuân thủ design system

```css
/* ============================================================
   TAB 3 — ĐĂNG ADS HÀNG LOẠT (thêm 23/10/2026)
   ============================================================ */

.bulk-tree {
  max-height: 460px;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-inset);
}

.bulk-tree-node {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
}

.bulk-tree-node--campaign { background: var(--bg-card); font-weight: 600; }
.bulk-tree-node--adset    { padding-left: var(--space-6); font-size: 0.875rem; }
.bulk-tree-node:hover     { background: var(--bg-card-solid); }

.bulk-chip {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  white-space: nowrap;
}

/* Chip "Nháp" phải nổi bật — đây là thứ người dùng tìm trên trang này */
.bulk-chip--draft {
  color: var(--warning);
  border-color: var(--warning);
  background: rgba(245, 158, 11, 0.12);
  font-weight: 600;
}

.bulk-chip--cbo  { color: var(--cyan-text);   border-color: var(--cyan-text); }
.bulk-chip--warn { color: var(--danger-text); border-color: var(--danger-text); }

.bulk-matrix-wrap { overflow-x: auto; }   /* bảng rộng cuộn trong khung, không đẩy cả trang */

.bulk-matrix-cell {
  text-align: center;
  cursor: pointer;
  user-select: none;
  color: var(--success-text);
}
.bulk-matrix-cell--off { color: var(--text-muted); opacity: 0.45; }
```

### 13.3 Nghiệm thu

- [ ] `npm test` — `test/css.test.js` xanh (đọc luật của file test này **trước** khi thêm class)
- [ ] Thu nhỏ cửa sổ xuống 1280 px và 768 px → bảng ma trận cuộn ngang trong khung, trang không bị đẩy ngang
- [ ] Không có màu hard-code dạng `#rrggbb` mới (trừ `rgba()` dùng cho nền chip, theo đúng pattern có sẵn trong file)

---

## PHẦN 14 — GĐ 9 & 10b: CHẠY THẬT + TÀI LIỆU

### 14.1 GĐ 9 — kịch bản chạy thật, tăng dần

**Tuyệt đối không chạy quy mô lớn ở lần đầu.** Theo đúng thứ tự:

| Lượt | Cấu hình | Đối tượng | Kiểm sau khi chạy |
|---|---|---|---|
| 1 | Tab 3: 1 nội dung × 1 nhóm có sẵn | 1 | Ad PAUSED, đúng nhóm, creative đúng page |
| 2 | Tab 3: 2 nội dung × 3 nhóm (2 chiến dịch, có 1 CĐ nháp) | 6 | Đủ 6 ad; CĐ nháp nhận được ad |
| 3 | Tab 2: 1 CĐ mới × 1 nhóm mới × 1 nội dung | 3 | Cây đúng, cả 3 PAUSED |
| 4 | Tab 2: 2 CĐ × 2 nhóm (`all`) × 2 nội dung | 2+4+8 = 14 | CSV khớp cây xem trước |
| 5 | Tab 2: 1 CĐ có CBO × 2 nhóm (không ngân sách) × 1 nội dung | 1+2+2 = 5 | **Không lỗi CBO/ABO** |

Sau mỗi lượt: mở Ads Manager, **xoá hoặc archive** các object test để BM không rác.

### 14.2 GĐ 10b — cập nhật `PROJECT_CONTEXT.md`

**Mục 6 (REST API)** — thêm bảng:

```markdown
### Cross-Post Manager — Engine tạo hàng loạt (từ 23/10/2026)

| Method | Endpoint | Mô tả |
|---|---|---|
| GET  | `/api/cp/ad-accounts/:id/campaigns?statuses=all&withDraftFlag=1` | Chiến dịch kèm cờ `isDraft` (nháp = chưa có ad / IN_PROCESS / WITH_ISSUES) |
| GET  | `/api/cp/ad-accounts/:id/adsets?campaignIds=a,b,c` | Nhóm QC của nhiều chiến dịch trong 1 request |
| POST | `/api/cp/upload-ad-image` | Upload ảnh → `image_hash` (body tới 12 MB) |
| GET/POST | `/api/cp/content-library` | Thư viện nội dung quảng cáo |
| POST | `/api/cp/build-structure` | **Engine chung tab 2 + tab 3**: tạo CĐ → nhóm → quảng cáo theo job |
| GET  | `/api/cp/job/:jobId/csv` | Xuất kết quả đợt chạy (UTF-8 BOM) |

Trần an toàn: 15 chiến dịch · 3 nhóm/chiến dịch · 45 nhóm · 12 nội dung ·
135 quảng cáo · 195 đối tượng mỗi đợt. Tất cả tạo ra ở trạng thái **PAUSED**.

Giới hạn đã biết: Marketing API **không có** status DRAFT. Bản nháp còn nằm
trong trình tạo của Ads Manager (chưa sinh object) thì không đọc được —
chỉ lấy được chiến dịch nháp đã tồn tại trên Meta.
```

**Mục 10 (Lịch sử thay đổi)** — thêm 1 mục ngày 23/10/2026 ghi rõ: tab 3 mới, tab 2 nâng cấp, engine `build-structure`, vá bug `buildAdsetBody` luôn gửi `daily_budget` gây xung đột CBO.

**Mục 4 (Cấu trúc thư mục)** — thêm `cp-shared.js`, `ads-studio.js`, `bulk-ads-app.js`, `data/cp_content_library.json`, `data/cp_image_hashes.json`.

### 14.3 GĐ 10b — cập nhật `README.md`

Thêm mục hướng dẫn người dùng, nhấn 3 điều:
1. Tất cả tạo ra ở trạng thái **PAUSED** — phải vào Ads Manager bật tay.
2. Đợt lớn mất tới **7 phút**; đóng tab không mất kết quả, mở `/api/cp/job/<id>` xem lại.
3. **Giới hạn về bản nháp**: chỉ lấy được chiến dịch nháp đã tồn tại trên Meta.

### 14.4 Báo cáo cho chủ dự án (rule §6)

Sau khi xong, báo ngắn gọn bằng tiếng Việt: đã làm gì · file nào · số liệu Dashboard có thay đổi không (**câu trả lời phải là: không — engine này chỉ ghi lên Meta, không chạm `data/latest_insights.json` hay `src/report.js`**) · đã chạy thật bao nhiêu object và đã dọn chưa.

---

## PHẦN 15 — CHECKLIST TỔNG (nghiệm thu cuối)

**An toàn — không được bỏ qua ô nào**
- [ ] Mọi Campaign / Adset / Ad tạo ra đều `PAUSED` (kiểm trực tiếp trong Ads Manager)
- [ ] Giãn cách thực tế ≥ 2 s giữa 2 lệnh tạo (xem mốc thời gian trong log job)
- [ ] `withLock('buildStructure')` chặn được 2 đợt chạy song song
- [ ] Gửi lại cùng `planId` không tạo nhân đôi
- [ ] POST mới không có `X-Internal-Token` → 403
- [ ] Vượt trần bị chặn **trước khi** gọi Meta lần đầu
- [ ] Không có token nào bị in ra console hay trả về response

**Chức năng**
- [ ] Chiến dịch nháp hiện đủ với chip Nháp + lý do đúng
- [ ] Lọc "Chỉ bản nháp" đúng
- [ ] CĐ nháp chưa có nhóm → chặn tick, hướng sang tab 2
- [ ] Chọn tới 45 nhóm; vượt thì chặn
- [ ] Soạn tới 12 nội dung; CTA chọn được và tự nhập được
- [ ] Upload ảnh ra `image_hash`; upload lại cùng ảnh → `cached: true`
- [ ] Thư viện nội dung lưu và nạp lại được
- [ ] Sinh biến thể spintax ra kết quả có nhãn rõ
- [ ] Ma trận 3 chế độ ghép đúng; loại trừ từng cặp được
- [ ] Ước tính thời gian hiện ra và cảnh báo khi > 5 phút
- [ ] Tab 2 tạo được nhiều CĐ / nhiều nhóm; `attachTo: all` nhân đúng
- [ ] Chặn xung đột CBO/ABO cả ở UI và backend
- [ ] Cây xem trước tab 2 khớp kết quả thực tế
- [ ] Cách ly lỗi: 1 object lỗi không dừng cả đợt
- [ ] CSV mở bằng Excel tiếng Việt không lỗi font
- [ ] "Thử lại phần lỗi" không nhân đôi phần đã thành công

**Không hồi quy**
- [ ] Tab 1 (đăng bài chéo Fanpage) y như trước
- [ ] Tab 2 chế độ cũ (1 CĐ / 1 nhóm / nhóm có sẵn) y như trước
- [ ] 4 route cũ còn nguyên và còn gọi được: `create-campaign`, `create-adset`, `batch-create-ads`, `/campaigns/:id/adsets`
- [ ] Dashboard phân tích (`/`) không bị ảnh hưởng — không chạm `src/report.js`, `src/meta-api.js`, `data/latest_insights.json`
- [ ] `npm test` xanh toàn bộ
- [ ] Console trình duyệt 0 lỗi trên cả 3 tab

**Tài liệu**
- [ ] `PROJECT_CONTEXT.md` mục 4, 6, 10 đã cập nhật
- [ ] `README.md` đã có hướng dẫn tab mới + ghi rõ giới hạn bản nháp
- [ ] Mọi hàm mới có docstring nói **vì sao**, không chỉ **làm gì**

---

## PHẦN 16 — NHỮNG CHỖ DỄ SAI NHẤT

| Bẫy | Hậu quả | Phòng tránh |
|---|---|---|
| Quên `status: 'PAUSED'` ở 1 trong 3 loại object | Đốt tiền thật của BM | 3 hàm `buildCampaignBody`/`buildAdsetBody`/`buildAdBody` đều hard-code PAUSED, có test khoá |
| Tạo 1 creative cho MỖI cặp thay vì cache | 200 creative thừa, rate-limit gần như chắc chắn | Sắp xếp pairs theo `(pageId, contentKey)` rồi dùng `creativeCache` |
| Dùng `picture: imageUrl` thay vì `image_hash` | Meta chặn fetch ảnh, creative lỗi lác đác không rõ nguyên nhân | Luôn upload trước, ưu tiên `image_hash` |
| Nhóm có `daily_budget` trong CĐ CBO | Meta từ chối sau khi đã tạo nửa vời | `resolveAttachments` chặn + UI disable ô ngân sách |
| Dùng `status` thay `effective_status` khi lọc | Lọc sai trạng thái, mất CĐ nháp | Luôn `effective_status` (L11) |
| Nâng `express.json` limit toàn cục lên 12 MB | Mở cửa cho request rác làm phình RAM | Mount riêng đúng path `/api/cp/upload-ad-image` |
| Giữ 1 HTTP request cho đợt 7 phút | Timeout, người dùng tưởng lỗi rồi bấm lại → tạo nhân đôi | Job + poll + dedupe theo `planId` |
| Đổi công thức tên chiến dịch | Dashboard phân loại sai sản phẩm (quy tắc §1) | Giữ đúng `{prefix}/{product}/mess/{desc}` |
| `throw` giữa vòng lặp làm dừng cả đợt | Mất kết quả phần đã chạy | `try/catch` **trong** vòng lặp, ghi lỗi vào `job.results` rồi `continue` |
| Sửa 6 giá trị `SAFETY_LIMITS` cũ | Vỡ test, mất lớp bảo vệ đã chốt | Chỉ **thêm** khoá mới |
