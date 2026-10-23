# KẾ HOẠCH CODE v2 — Tạo nội dung & Đăng Ads hàng loạt (Tab 3 mới + nâng cấp Tab 2)

> ⚠️ **TÀI LIỆU NÀY ĐÃ ĐƯỢC THAY THẾ.** Bản thi hành chính thức là
> [`docs/HUONG_DAN_CODE_ADS_HANG_LOAT.md`](HUONG_DAN_CODE_ADS_HANG_LOAT.md).
> Trần an toàn trong file này là **số cũ** (5 CĐ / 60 ad / 80 đối tượng).
> Chủ dự án đã chốt lại **15 chiến dịch · 3 nhóm/chiến dịch · 45 nhóm · 135 quảng cáo · 195 đối tượng**.
> Khi 2 tài liệu lệch nhau, **lấy theo bản hướng dẫn code**. File này giữ lại để truy nguồn lý do thiết kế.

> Trạng thái: **CHỜ CHỦ DỰ ÁN DUYỆT LẦN CUỐI** (theo `.agents/rules/quy-tac-du-an.md` §2 — thay đổi 🔴 lớn: thêm REST endpoint + ghi dữ liệu THẬT lên Meta + sửa tab 2 đang chạy).
> Ngày lập: 23/10/2026 · Phạm vi: `Cross-Post Manager` (`/cross-post`), không chạm Dashboard phân tích.

## Quyết định của chủ dự án (đã chốt 23/10/2026)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | "Bản nháp" là loại nào? | **Loại A** — chiến dịch nháp có thật trên Meta (chưa có ad / `IN_PROCESS` / `WITH_ISSUES`). Loại B (nháp trong trình tạo Ads Manager) bỏ ngoài phạm vi vì API không đọc được. |
| 2 | Trần số ad mỗi đợt | **60** — OK |
| 3 | CTA | **Người dùng tự chọn / tự điền**, không hard-code `SEND_MESSAGE` |
| 4 | Nhiều tài khoản quảng cáo mỗi đợt? | **KHÔNG — 1 tài khoản / 1 đợt** |
| 5 | Tab 2 | **Nâng cấp cho phép tạo NHIỀU chiến dịch / NHIỀU nhóm / NHIỀU quảng cáo mới trong 1 lần** |

Quyết định #4 và #5 làm thay đổi kiến trúc so với kế hoạch v1: hai tab giờ dùng **chung một engine backend** (§4.6) chứ không phải 2 đường code riêng.

---

## 1. Mục tiêu sau khi chốt

### Tab 3 (MỚI) — "Đăng Ads hàng loạt vào CĐ/Nhóm có sẵn"
Soạn nhiều nội dung quảng cáo → chọn **nhiều chiến dịch (gồm chiến dịch nháp) × nhiều nhóm** trong **1 tài khoản** → sinh ma trận `N nội dung × M nhóm` → tạo hàng loạt ad ở trạng thái **PAUSED**.

### Tab 2 (NÂNG CẤP) — "Tạo mới hàng loạt CĐ → Nhóm → QC"
Trong 1 lần chạy: tạo **nhiều chiến dịch mới** + **nhiều nhóm mới** (nhân bản vào mọi chiến dịch hoặc gán riêng) + **nhiều quảng cáo mới**, tất cả **PAUSED**.

Hai tab khác nhau ở **chỗ lấy nhóm đích**: tab 3 = nhóm **có sẵn**; tab 2 = nhóm **tạo mới**. Phần "soạn nội dung → sinh ma trận → tạo ad" là **dùng chung**.

---

## 2. Sự thật về "chiến dịch bản nháp"

Đã tra tài liệu chính thức Meta ([Campaign Reference](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/)):

| Trường | Giá trị hợp lệ |
|---|---|
| `status` / `configured_status` | `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED` |
| `effective_status` | `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`, `IN_PROCESS`, `WITH_ISSUES` |

**Marketing API KHÔNG có trạng thái `DRAFT`.** Chủ dự án đã chốt lấy **Loại A**: chiến dịch tồn tại thật trên Meta nhưng chưa hoàn chỉnh — chưa có ad, hoặc `effective_status` là `IN_PROCESS` / `WITH_ISSUES`. Ads Manager gắn nhãn *Draft* kèm nút "Xuất bản".

Route hiện tại đang **lọc mất chúng** — [cross-post.js:559](src/cross-post.js:559):

```js
effective_status: "['ACTIVE','PAUSED']",   // loại bỏ IN_PROCESS và WITH_ISSUES
limit: 50
```

**Giới hạn phải ghi rõ trên UI (rule §4 — trung thực về số liệu):** *"Chỉ nạp được chiến dịch nháp đã tồn tại trên Meta. Bản nháp còn nằm trong trình tạo Ads Manager thì API không đọc được — cần Lưu/Xuất bản trong Ads Manager trước."*

---

## 3. Danh sách file sẽ sửa / tạo mới

| File | Hành động | Ước lượng |
|---|---|---|
| `src/cross-post.js` | **SỬA** — thêm 5 endpoint + 10 hàm pure + limit mới. Không xoá/đổi route cũ. | +700 dòng |
| `src/server.js` | **SỬA** — mount `express.json({limit:'12mb'})` riêng cho route upload ảnh | +5 dòng |
| `public/js/ads-studio.js` | **TẠO MỚI (GĐ 0)** — di chuyển nguyên khối logic tab 2 từ `cross-post-app.js` (dòng 601–1700), **không đổi logic** | ~1100 dòng (chuyển, không viết mới) |
| `public/js/ads-studio.js` | **SỬA (GĐ 5)** — thêm chế độ tạo nhiều CĐ / nhiều nhóm | +450 dòng |
| `public/js/bulk-ads-app.js` | **TẠO MỚI** — toàn bộ logic tab 3, IIFE độc lập | ~750 dòng |
| `public/js/cp-shared.js` | **TẠO MỚI** — tiện ích dùng chung: thẻ nội dung, spintax, upload ảnh, poll job, `escapeHtml`, `refreshIcons` | ~380 dòng |
| `public/cross-post.html` | **SỬA** — nút tab 3 + `<section id="bulkAdsSection">` + mở rộng bước 1/2 của tab 2 + 3 thẻ `<script>` | +400 dòng |
| `public/css/cross-post.css` | **SỬA** — class cho cây 2 cấp, thẻ nội dung/CĐ/nhóm, bảng ma trận | +280 dòng |
| `public/js/cross-post-app.js` | **SỬA** — `switchTab()` theo map + bỏ khối đã chuyển sang `ads-studio.js` | −1100 / +15 dòng |
| `test/bulk-ads.test.js` | **TẠO MỚI** — test hàm pure + khoá limit mới | ~200 dòng |
| `test/cp-guard.test.js` | **SỬA** — assert route ghi mới nằm sau token guard | +10 dòng |
| `PROJECT_CONTEXT.md` | **SỬA** — mục 6 (REST API) + mục 10 (Lịch sử thay đổi) | +50 dòng |
| `README.md` | **SỬA** — hướng dẫn tab 2 mới + tab 3 | +45 dòng |

**Không xoá file nào. Không thêm dependency** (giữ đúng 3 package: express, dotenv, meta-ads-mcp).

### GĐ 0 — tách `ads-studio.js`: vì sao cần, và vì sao an toàn

`public/js/cross-post-app.js` hiện **1712 dòng**. Thêm 450 dòng cho tab 2 → **2160 dòng** trong 1 file, rất khó bảo trì. Đề xuất tách trước, thành commit riêng:

- **Chỉ di chuyển code, không đổi một dòng logic nào.** Khối `// TAB 2: ADS CREATION STUDIO` (dòng 601 → hết `executeStudioBatch`) chuyển sang `ads-studio.js`, expose `window.AdsStudio = { init }`.
- Các hàm dùng chung (`escapeHtml`, `refreshIcons`, lấy `pages`/`adAccounts`/`sessionToken`) chuyển sang `cp-shared.js`, cả 3 file cùng dùng.
- Nghiệm thu: mở tab 2 làm đúng 4 bước trước và sau khi tách, kết quả giống nhau; `git diff --stat` cho thấy tổng số dòng gần như không đổi.
- Nếu chủ dự án không muốn tách → vẫn làm được, nhưng `cross-post-app.js` sẽ > 2100 dòng. **Khuyến nghị: tách.**

---

## 4. Backend — `src/cross-post.js`

### 4.1 Hằng số an toàn mới (thêm vào `SAFETY_LIMITS`, KHÔNG đổi 6 giá trị cũ)

```js
export const SAFETY_LIMITS = {
  // ... 6 giá trị cũ giữ nguyên y nguyên (test/cross-post.test.js đang khoá) ...

  // --- Engine build-structure (tab 2 + tab 3), 1 TÀI KHOẢN / ĐỢT ---
  BUILD_MAX_NEW_CAMPAIGNS: 5,    // số chiến dịch tạo mới mỗi đợt
  BUILD_MAX_NEW_ADSETS:    15,   // TỔNG nhóm tạo mới (sau khi nhân theo chiến dịch)
  BUILD_MAX_TARGETS:       30,   // TỔNG nhóm đích (mới + có sẵn)
  BUILD_MAX_CONTENTS:      12,   // số nội dung soạn
  BUILD_MAX_ADS:           60,   // TỔNG ad tạo ra — TRẦN CỨNG (chốt #2)
  BUILD_MAX_OBJECTS:       80,   // CĐ + nhóm + ad, chặn đợt chạy quá dài

  DELAY_BUILD_CAMPAIGN_MS: 2500,
  DELAY_BUILD_ADSET_MS:    2500,
  DELAY_BUILD_AD_MS:       2000,
  UPLOAD_IMAGE_MAX_BYTES:  8 * 1024 * 1024
};
```

> 80 object × 2–2,5 s ≈ **3 phút**. Bắt buộc chạy theo **job bất đồng bộ** — không thể giữ 1 HTTP request (tab 2 hiện đang chạy đồng bộ, đây là lý do phải đổi).

### 4.2 `GET /api/cp/ad-accounts/:accountId/campaigns` — MỞ RỘNG (tương thích ngược)

Thêm query tuỳ chọn. **Không truyền gì → hành vi y như cũ.**

| Query | Mặc định | Ý nghĩa |
|---|---|---|
| `statuses` | `ACTIVE,PAUSED` | CSV. `all` = `ACTIVE,PAUSED,IN_PROCESS,WITH_ISSUES` |
| `includeArchived` | `0` | `1` → thêm `ARCHIVED` |
| `withDraftFlag` | `0` | `1` → đếm adset/ad để suy ra cờ nháp |
| `limit` | `50` | tối đa `200` |

Khi `withDraftFlag=1`, dùng **field expansion + summary** để không phải gọi thêm request cho mỗi chiến dịch:

```js
fields: [
  'id','name','objective','status','effective_status',
  'created_time','updated_time','start_time','daily_budget','lifetime_budget',
  'adsets.limit(0).summary(total_count)',
  'ads.limit(0).summary(total_count)'
].join(',')
```

Hàm pure tách riêng để test:

```js
/**
 * Suy ra cờ "nháp" cho 1 chiến dịch.
 * Marketing API KHÔNG có status DRAFT (xem docs Campaign Reference), nên nháp
 * được định nghĩa theo nghiệp vụ: chiến dịch tồn tại nhưng CHƯA có quảng cáo nào,
 * hoặc đang ở IN_PROCESS/WITH_ISSUES. Trùng với nhãn "Draft" của Ads Manager.
 */
export function classifyCampaignDraft(c) {
  const adsCount    = c.ads?.summary?.total_count ?? null;
  const adsetsCount = c.adsets?.summary?.total_count ?? null;
  const es = c.effective_status;

  if (es === 'IN_PROCESS')  return { isDraft: true, reason: 'in_process' };
  if (es === 'WITH_ISSUES') return { isDraft: true, reason: 'with_issues' };
  if (adsCount === 0)       return { isDraft: true, reason: adsetsCount === 0 ? 'no_adset' : 'no_ad' };
  return { isDraft: false, reason: null };
}
```

Response:

```json
{
  "ok": true,
  "campaigns": [{
    "id": "120...",
    "name": "haicm/ucmas/mess/khaigiang",
    "objective": "OUTCOME_ENGAGEMENT",
    "status": "PAUSED",
    "effective_status": "IN_PROCESS",
    "dailyBudget": 150000,
    "hasCbo": true,
    "adsetsCount": 2,
    "adsCount": 0,
    "isDraft": true,
    "draftReason": "no_ad",
    "createdTime": "2026-10-20T09:12:00+0700"
  }],
  "counts": { "total": 18, "draft": 5, "active": 9, "paused": 4 },
  "notice": "API Meta không đọc được bản nháp còn nằm trong trình tạo Ads Manager."
}
```

`hasCbo` cần cho việc chặn xung đột ngân sách ở §4.7.

### 4.3 `GET /api/cp/ad-accounts/:accountId/adsets?campaignIds=a,b,c` — MỚI

Lấy adset của **nhiều chiến dịch bằng 1 request** (route cũ `/campaigns/:id/adsets` **giữ nguyên** cho tương thích).

```js
params: {
  fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,' +
          'optimization_goal,billing_event,destination_type,promoted_object{page_id,application_id},' +
          'targeting{age_min,age_max,genders,geo_locations}',
  filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
  limit: 200
}
```

- Chặn `campaignIds.length > 50` (giới hạn thực tế của `filtering IN`).
- Trả thêm `pageId` suy ra sẵn từ `promoted_object.page_id` → frontend không phải đoán.
- Nếu `filtering` bị Meta từ chối (một số loại tài khoản), **fallback** gọi `/<campaignId>/adsets` tối đa 4 luồng song song, **ghi log rõ là đã fallback**.

### 4.4 `POST /api/cp/upload-ad-image` — MỚI

Creative dùng `image_hash` đáng tin cậy hơn `picture` (URL ngoài hay bị Meta chặn fetch).

```
Body: { accountId, fileName, dataBase64 }   // dataBase64 KHÔNG kèm tiền tố data:
```

1. `Buffer.byteLength ≤ UPLOAD_IMAGE_MAX_BYTES` → 413 nếu vượt.
2. **Magic bytes**: `FF D8 FF` (JPEG) hoặc `89 50 4E 47` (PNG). Đuôi file không được tin.
3. `sha256(buffer)` tra `data/cp_image_hashes.json` → trùng thì trả hash cũ, **không upload lại**.
4. `POST act_<id>/adimages` với `{ bytes: base64 }`.

Response `{ ok, imageHash, url, width, height, cached }`.

> `src/server.js` đang giới hạn `express.json({ limit: '256kb' })` ([server.js:47](src/server.js:47)). Mount middleware riêng **chỉ cho path này**, đặt trước khi mount router — không nâng limit toàn cục:
> ```js
> app.use('/api/cp/upload-ad-image', express.json({ limit: '12mb' }));
> ```

### 4.5 `GET` + `POST /api/cp/content-library` — MỚI

Thư viện nội dung tại `data/cp_content_library.json` (tối đa 200 mục, mục mới lên đầu, ghi theo pattern `writeFileSync` sẵn có ở [cross-post.js:108](src/cross-post.js:108)).

Mục: `{ id, name, message, headline, description, linkUrl, ctaType, imageHash, imageUrl, videoId, tags[], savedAt }`.

### 4.6 `POST /api/cp/build-structure` — ENGINE CHUNG CHO CẢ 2 TAB (MỚI)

Thay vì 2 endpoint riêng, **1 endpoint tổng quát** gồm 3 pha tuần tự. Tab 2 dùng cả 3 pha, tab 3 chỉ dùng pha 3.

```jsonc
{
  "planId": "uuid-client-sinh",             // chống double-submit
  "accountId": "123",                       // ĐÚNG 1 tài khoản / đợt (chốt #4)

  // --- PHA 1: chiến dịch tạo mới ([] = không tạo) — tab 2 ---
  "campaigns": [
    { "key": "cp1", "name": "haicm/ucmas/mess/khaigiang",
      "objective": "OUTCOME_ENGAGEMENT", "dailyBudget": 150000 }
  ],

  // --- PHA 2: nhóm tạo mới ([] = không tạo) — tab 2 ---
  "adsets": [
    { "key": "as1", "name": "Nữ 25-45 HN", "pageId": "456...",
      "dailyBudget": 100000, "optimizationGoal": "CONVERSATIONS",
      "destinationType": "MESSENGER",
      "targeting": { "ageMin": 25, "ageMax": 45, "genders": [2],
                     "geoLocations": { "regions": [{ "key": "3875" }] },
                     "placements": [] },
      "attachTo": "all"
      // "all"               → tạo nhóm này trong MỌI chiến dịch ở pha 1
      // "cp1"               → chỉ trong chiến dịch có key cp1
      // "existing:120..."   → trong 1 chiến dịch CÓ SẴN (gồm chiến dịch nháp)
    }
  ],

  // --- PHA 3: nhóm ĐÍCH có sẵn ([] = không có) — tab 3 ---
  "existingTargets": [
    { "campaignId": "120...", "campaignName": "...", "adsetId": "238...",
      "adsetName": "...", "pageId": "456..." }
  ],

  // --- PHA 3: nội dung quảng cáo ---
  "contents": [
    { "key": "c1", "name": "QC01 - Tập trung", "type": "custom",
      "message": "...", "headline": "...", "description": "...",
      "ctaType": "SEND_MESSAGE", "linkUrl": "", "imageHash": "abc", "videoId": "" },
    { "key": "c2", "type": "page_post", "sourcePostId": "456_789" },
    { "key": "c3", "type": "clone_ad",  "sourceAdId": "239..." }
  ],

  "pairingMode": "matrix",                  // matrix | one_to_one | round_robin
  "namePattern": "{content} — {adset}"      // token: {content} {adset} {campaign} {index} {date}
}
```

Cách 2 tab dùng cùng payload này:

| | `campaigns` | `adsets` | `existingTargets` |
|---|---|---|---|
| **Tab 3** (đăng vào CĐ/nhóm có sẵn, gồm nháp) | `[]` | `[]` | 1–30 nhóm |
| **Tab 2 — tạo mới toàn bộ** | 1–5 | 1–15, `attachTo: "all"` | `[]` |
| **Tab 2 — nhóm mới trong CĐ có sẵn** | `[]` | 1–15, `attachTo: "existing:<id>"` | `[]` |
| **Tab 2 — như hiện tại (1 CĐ + 1 nhóm)** | 1 | 1 | `[]` |

Thành công → **trả ngay** `{ ok:true, jobId, preview: { campaigns, adsets, ads, objects } }`, rồi chạy `runBuildStructure()` ngầm bằng `newJob()` + `withLock('buildStructure')` ([cross-post.js:427](src/cross-post.js:427)) — đúng pattern `bulk-replicate` ([cross-post.js:1414](src/cross-post.js:1414)).

> 3 route cũ (`create-campaign`, `create-adset`, `batch-create-ads`) **GIỮ NGUYÊN, không xoá** — vẫn có test khoá, vẫn gọi được. Chỉ là frontend chuyển sang dùng `build-structure`.

### 4.7 Validate trước khi trả response (fail nhanh, chưa gọi Meta)

| Kiểm tra | Mã lỗi |
|---|---|
| thiếu `accountId` | 400 |
| `contents` rỗng | 400 |
| không có nhóm đích nào (`adsets` rỗng **và** `existingTargets` rỗng) | 400 |
| `campaigns.length > BUILD_MAX_NEW_CAMPAIGNS` (5) | 400 |
| tổng nhóm tạo mới (sau nhân `attachTo:"all"`) `> BUILD_MAX_NEW_ADSETS` (15) | 400 |
| tổng nhóm đích `> BUILD_MAX_TARGETS` (30) | 400 |
| `contents.length > BUILD_MAX_CONTENTS` (12) | 400 |
| `expandPairs().length > BUILD_MAX_ADS` (60) | 400 (kèm số thực tế) |
| tổng object `> BUILD_MAX_OBJECTS` (80) | 400 |
| `attachTo` trỏ tới `key` chiến dịch không tồn tại | 400 |
| **`attachTo` trỏ CĐ có `hasCbo=true` mà nhóm vẫn khai `dailyBudget`** | 400 — xung đột CBO/ABO, Meta sẽ từ chối |
| `pairingMode='one_to_one'` mà số lượng lệch | 400 |
| target thiếu `pageId` và không có fallback | 400 |
| `type='custom'` thiếu cả `message` và `imageHash`/`videoId` | 400 |
| `ctaType` không khớp `^[A-Z_]{3,40}$` | 400 |
| đã có job `planId` này chạy < 10 phút | 200 + trả lại `jobId` cũ (idempotent) |

**Phát hiện phụ cần xử lý (bug tiềm ẩn đang có trong code):** `buildAdsetBody()` ([cross-post.js:735](src/cross-post.js:735)) **luôn** gửi `daily_budget`. Nếu chiến dịch dùng CBO thì Meta từ chối. Khắc phục **không phá test cũ**: thêm tham số `useCampaignBudget = false`; khi `true` thì bỏ `daily_budget`. Mặc định `false` → 6 test hiện có vẫn PASS.

### 4.8 Thuật toán `runBuildStructure(plan, job)`

```
B0. ensurePageTokens()

PHA 1 — CHIẾN DỊCH  (bỏ qua nếu plan.campaigns rỗng)
  Với từng campaign:
    buildCampaignBody() → POST act_<id>/campaigns  (status PAUSED)
    campaignIdByKey[key] = id
    log + job.done++ ; chờ DELAY_BUILD_CAMPAIGN_MS
    Lỗi → đánh dấu campaign đó fail, BỎ QUA mọi nhóm attachTo trỏ vào nó,
           các chiến dịch khác vẫn chạy tiếp

PHA 2 — NHÓM QUẢNG CÁO  (bỏ qua nếu plan.adsets rỗng)
  Giải attachTo → danh sách (campaignId, adsetSpec)
  Với từng cặp:
    useCampaignBudget = campaign đó có CBO
    buildAdsetBody({ ..., useCampaignBudget }) → POST act_<id>/adsets  (PAUSED)
    targets.push({ campaignId, campaignName, adsetId, adsetName, pageId })
    log + job.done++ ; chờ DELAY_BUILD_ADSET_MS
    Lỗi → chỉ fail nhóm đó

PHA 3 — QUẢNG CÁO
  targets = (nhóm vừa tạo ở pha 2) ∪ plan.existingTargets
  pairs   = expandPairs({ targets, contents, pairingMode })
  Sắp xếp pairs theo (pageId, contentKey) → pair dùng chung creative nằm liền nhau
  creativeCache = Map<`${pageId}|${contentKey}`, creativeId>
  Với từng pair:
    a. Cache miss → buildAdCreativeBody() → POST act_<id>/adcreatives → cache
                  → chờ 1200 ms
    b. buildAdBody({ name: renderAdName(...), adsetId, creativeId })
       → POST act_<id>/ads, LUÔN status PAUSED
    c. Lỗi tạm (code 1,2,4,17,80004 / HTTP 429) → chờ 5 s, thử LẠI 1 lần
    d. Ghi job.results + job.logs ; job.done++
    e. Chờ DELAY_BUILD_AD_MS

B9. job.summary = { campaignsCreated, adsetsCreated, adsCreated, failed,
                    creativesCreated, creativesReused, byCampaign: {...} }
```

**Cache creative là điểm thiết kế quan trọng nhất.** Creative thuộc *ad account*, không thuộc adset. Vì mỗi đợt chỉ 1 tài khoản (chốt #4), khoá cache chỉ còn `pageId|contentKey`. Ma trận 10 nội dung × 20 nhóm cùng 1 page chỉ cần **10 creative + 200 ad**, không phải 200 creative → giảm ~95 % lệnh tạo creative và giảm hẳn nguy cơ rate-limit.

**Cách ly lỗi (rule §5):** lỗi ở 1 object chỉ đánh dấu object đó. Creative lỗi → bỏ qua **toàn bộ pair dùng creative đó**, đánh `skipped: true`, job vẫn chạy tiếp. Chiến dịch lỗi → bỏ nhóm con của nó, không dừng cả đợt.

Job shape (dùng chung `jobs` Map sẵn có, TTL 1 h):

```jsonc
{
  "status": "running",                       // running | done | error
  "phase": "ads",                            // campaigns | adsets | ads
  "done": 37, "total": 80,
  "created": {
    "campaigns": [{ "key":"cp1", "id":"120...", "name":"...", "success":true, "error":null }],
    "adsets":    [{ "key":"as1", "campaignId":"120...", "id":"238...", "name":"...", "success":true }],
    "ads":       [{ "pairKey":"c1|238...", "campaignId":"120...", "campaignName":"...",
                    "adsetId":"238...", "adsetName":"...", "contentKey":"c1",
                    "contentName":"QC01", "adId":"239...", "creativeId":"121...",
                    "adName":"...", "success":true, "skipped":false,
                    "error":null, "retried":false }]
  },
  "logs": [{ "at":"...", "level":"success", "msg":"..." }],
  "summary": { }
}
```

Giữ thêm `job.plan` (đã loại token) để `GET /api/cp/job/:jobId` trả đủ ngữ cảnh khi người dùng F5 giữa đường.

### 4.9 `GET /api/cp/job/:jobId/csv` — MỚI

Xuất kết quả ra CSV **UTF-8 BOM** (đúng chuẩn `src/export-csv.js` để Excel tiếng Việt không lỗi font). 3 phần: chiến dịch đã tạo · nhóm đã tạo · ad đã tạo. Cột phần ad: `Thời điểm, Chiến dịch, Campaign ID, Nhóm QC, Adset ID, Nội dung, Tên Ad, Ad ID, Creative ID, Kết quả, Lỗi`.

### 4.10 Các hàm pure export để test (không gọi mạng)

| Hàm | Bất biến cần khoá bằng test |
|---|---|
| `buildAdBody({ name, adsetId, creativeId })` | `status === 'PAUSED'` **luôn luôn**; `name` được trim; thiếu `adsetId`/`creativeId` → throw |
| `buildAdCreativeBody({ pageId, content })` | luôn có `object_story_spec.page_id`; `imageHash` → `link_data.image_hash`; `videoId` → `video_data`; `ctaType` sai định dạng → throw; không `linkUrl` → mặc định `https://m.me/<pageId>` |
| `buildAdsetBody({ ..., useCampaignBudget })` | `useCampaignBudget:true` → **không có** `daily_budget`; mặc định `false` → hành vi y như cũ (6 test cũ vẫn PASS) |
| `resolveAttachments({ campaigns, adsets, existingCampaigns })` | `attachTo:"all"` nhân đúng N×M; `attachTo:"cp1"` chỉ 1; key không tồn tại → throw; CĐ có CBO + nhóm khai `dailyBudget` → throw |
| `expandPairs({ targets, contents, pairingMode })` | `matrix` = N×M; `one_to_one` lệch số lượng → throw; `round_robin` = max(N,M) quay vòng; thứ tự ổn định |
| `renderAdName(pattern, ctx)` | token thiếu → chuỗi rỗng, không in `{content}` thô; cắt còn 200 ký tự (hạn mức tên ad của Meta); loại bỏ `\n` |
| `classifyCampaignDraft(c)` | `IN_PROCESS` → nháp; số ad = 0 → nháp; `ACTIVE` + có ad → không nháp; thiếu summary → `isDraft:false` (không đoán bừa) |
| `countPlanObjects(plan)` | đếm đúng tổng CĐ + nhóm + ad; vượt trần → throw kèm số thực tế |
| `expandSpintax(text)` | `{A\|B}` lồng nhau; thiếu `}` → trả nguyên văn, không throw |
| `normalizeImageUpload(buffer)` | nhận JPEG/PNG theo magic bytes; `GIF89a`/rỗng → throw |

---

## 5. Frontend — Tab 3 (MỚI)

### 5.1 `public/cross-post.html`

Nút tab 3 (sau `#tabAdsBtn`, [cross-post.html:52](public/cross-post.html:52)):

```html
<button id="tabBulkAdsBtn" class="cp-tab-btn" type="button">
  <i data-lucide="layout-grid"></i>
  <span>Đăng Ads hàng loạt (gồm CĐ nháp)</span>
</button>
```

`<section id="bulkAdsSection">` với stepper 4 bước (`#bulkStepper`). Mọi element tương tác có `id` duy nhất, tiền tố `bulk` để không trùng tab 2 (rule §5).

#### Bước 1 — Chọn đích (`#bulkStep1`)

- **1 select tài khoản** `#bulkAccountSelect` (chốt #4 — không multi-account). Đổi tài khoản → xoá mọi lựa chọn cũ và cảnh báo.
- **Cây 2 cấp** `#bulkTargetTree`: Chiến dịch → Nhóm QC. Checkbox tri-state (chọn chiến dịch = chọn mọi nhóm của nó).
- Mỗi chiến dịch hiện: tên · `objective` · chip trạng thái · **chip 🟡 "Nháp"** kèm tooltip lý do (*Chưa có quảng cáo* / *Chưa có nhóm* / *Đang xử lý* / *Có vấn đề*) · số ad / số nhóm · chip `CBO` nếu có · ngày tạo.
- Chiến dịch nháp **chưa có nhóm nào** → hiện rõ "Chưa có nhóm — không đăng ad vào được, hãy tạo nhóm ở Tab 2 trước" (không cho tick).
- Bộ lọc `#bulkCampaignFilter`: `Tất cả` · **`Chỉ nháp`** · `Đang chạy` · `Tạm dừng` + ô tìm tên `#bulkCampaignSearch`.
- Dòng chú thích cố định về giới hạn nháp loại B (§2).
- Đếm sống `#bulkSelectedTargetsCount` → "Đã chọn 12 nhóm thuộc 4 chiến dịch".

#### Bước 2 — Soạn nội dung (`#bulkStep2`) — dùng chung với tab 2 qua `cp-shared.js`

4 cách nạp nội dung (tab con `#bulkContentTabBar`):

1. **Soạn mới** — thẻ nội dung động, mỗi thẻ = 1 quảng cáo: tên nội bộ, *Primary text*, *Headline*, *Description*, **CTA**, link đích, ảnh (**kéo-thả → `POST /api/cp/upload-ad-image`** → preview + `image_hash`) hoặc `video_id`. Có **Nhân bản thẻ**, **Xoá thẻ**, đếm ký tự theo mức Meta khuyến nghị (125 / 40 / 30).
2. **Từ bài Fanpage** — tái dùng `GET /api/cp/pages/:pageId/posts` ([cross-post.js:345](src/cross-post.js:345)).
3. **Từ Ads mẫu** — tái dùng `GET /api/cp/adsets/:adsetId/ads` ([cross-post.js:599](src/cross-post.js:599)).
4. **Thư viện** — `GET /api/cp/content-library`.

**Ô CTA (chốt #3 — người dùng tự điền):** `<select>` ~15 lựa chọn phổ biến (`SEND_MESSAGE`, `MESSAGE_PAGE`, `WHATSAPP_MESSAGE`, `LEARN_MORE`, `SIGN_UP`, `APPLY_NOW`, `CONTACT_US`, `CALL_NOW`, `GET_QUOTE`, `GET_OFFER`, `SUBSCRIBE`, `BOOK_TRAVEL`, `SHOP_NOW`, `DOWNLOAD`, `NO_BUTTON`) **+ mục "Tự nhập…"** mở input tự do (validate `^[A-Z_]{3,40}$`) để Meta thêm loại mới vẫn dùng được ngay. Mặc định `SEND_MESSAGE`. Nếu CTA không khớp `objective`/`optimization_goal` của nhóm đích → **cảnh báo vàng, không chặn** (người dùng tự quyết).

**Bộ sinh biến thể** `#bulkVariantBox` (rule-based, không LLM — dự án không có LLM; `src/ai-analyst.js` cũng rule-based):
- Spintax `Con {chưa tập trung|học mãi không vào}?` → bung thành nhiều biến thể.
- Thư viện **hook mở đầu** + **CTA cuối** theo 4 sản phẩm UCMAS / UCKID / MATHCA / TRẠI HÈ.
- Chọn số biến thể (2–6) → tạo thành thẻ nội dung mới, **có nhãn "Biến thể #n"**.

#### Bước 3 — Ma trận & kiểm tra (`#bulkStep3`)

- **Chế độ ghép** `#bulkPairingMode`: `Ma trận đầy đủ (N×M)` / `1-1 theo thứ tự` / `Quay vòng`.
- **Mẫu tên ad** `#bulkNamePattern`, mặc định `{content} — {adset}`, kèm preview 3 dòng đầu.
- **Bảng ma trận** `#bulkMatrixTable`: hàng = nội dung, cột = nhóm đích, ô ✓/✗ **bấm được để loại trừ từng cặp**.
- Tổng kết `#bulkMatrixSummary`: "Sẽ tạo **48 quảng cáo** (12 creative mới, 36 tái dùng)".
- **Chặn cứng** khi vượt 60 → disable nút thực thi, nói rõ cần bỏ bớt bao nhiêu.
- Khối cảnh báo an toàn (tái dùng style ở [cross-post.html:587](public/cross-post.html:587)).

#### Bước 4 — Thực thi (`#bulkStep4`)

- Modal xác nhận **buộc nhập đúng số lượng** (ví dụ gõ `48`), không dùng `confirm()` suông.
- `POST /api/cp/build-structure` (`campaigns:[]`, `adsets:[]`) → nhận `jobId` → **poll `GET /api/cp/job/:jobId` mỗi 2 s** (pattern [replicate-modal.js:583](public/js/replicate-modal.js:583)).
- Thanh tiến độ + log cuộn + bảng kết quả nhóm theo chiến dịch.
- Hiện `jobId` kèm hướng dẫn: mất kết nối thì mở `/api/cp/job/<id>` — kết quả nằm ở server, không mất.
- Nút **Tải CSV kết quả**; nút **Thử lại phần lỗi** (gửi lại plan chỉ gồm pair thất bại, `planId` mới).

### 5.2 `public/js/bulk-ads-app.js`

```js
bulkState = {
  initialized, accountId: '',
  campaigns: [],              // của tài khoản đang chọn, kèm isDraft
  adsetsByCampaign: Map,      // campId -> adset[]
  selectedAdsetKeys: Set,     // `${campId}|${adsetId}`
  campaignFilter: 'all',      // all | draft | active | paused
  contents: [],               // thẻ nội dung (dùng module cp-shared)
  excludedPairs: Set,
  pairingMode: 'matrix',
  namePattern: '{content} — {adset}',
  planId: '', jobId: '', polling: null, isExecuting: false
}
```

---

## 6. Frontend — Tab 2 (NÂNG CẤP, chốt #5)

Giữ nguyên 4 bước và toàn bộ bộ sinh tên chuẩn 4 sản phẩm. Mỗi bước thêm **chế độ "nhiều"**.

### Bước 1 — thêm chế độ thứ 3 vào `.studio-switch` ([cross-post.html:243](public/cross-post.html:243))

| Chế độ | Trạng thái |
|---|---|
| `Chiến dịch có sẵn` | giữ nguyên |
| `Tạo Chiến dịch mới` | giữ nguyên (1 CĐ) |
| **`Tạo nhiều Chiến dịch`** | **MỚI** |

Chế độ mới: danh sách thẻ `#studioCampaignCards` (tối đa 5), mỗi thẻ có đủ bộ sinh tên chuẩn sẵn có (người phụ trách / sản phẩm / tên gợi nhớ → preview tên đầy đủ) + ngân sách CBO riêng. Thêm **"Sinh nhanh theo sản phẩm"**: tick UCMAS/UCKID/MATHCA/TRẠI HÈ → tự tạo 1 thẻ cho mỗi sản phẩm với cùng thông điệp. Nút **Nhân bản thẻ** / **Xoá thẻ**.

### Bước 2 — thêm chế độ thứ 3

| Chế độ | Trạng thái |
|---|---|
| `Nhóm có sẵn trong CĐ` | giữ nguyên |
| `Tạo Nhóm mới` | giữ nguyên (1 nhóm) |
| **`Tạo nhiều Nhóm`** | **MỚI** |

Chế độ mới: danh sách thẻ `#studioAdsetCards` (tối đa 15 sau khi nhân), mỗi thẻ = tên + Fanpage + ngân sách + targeting (tuổi / giới tính / khu vực / placements) — tái dùng đúng các control đang có.

**Cách gán nhóm vào chiến dịch** `#studioAdsetAttachMode` (ánh xạ sang `attachTo` ở §4.6):
- **`Mọi chiến dịch`** (`all`) — mỗi nhóm được tạo trong TẤT CẢ chiến dịch mới. 3 CĐ × 2 nhóm = 6 nhóm.
- **`Gán riêng`** — mỗi thẻ nhóm chọn 1 chiến dịch cụ thể.

Bảng xem trước `#studioStructurePreview` hiện rõ cây sẽ tạo:
```
haicm/ucmas/mess/khaigiang   (CBO 150.000đ)
  ├─ Nữ 25-45 HN      (ABO tắt — CĐ dùng CBO)
  └─ Nữ 25-45 HCM
haicm/uckid/mess/khaigiang   (CBO 150.000đ)
  ├─ Nữ 25-45 HN
  └─ Nữ 25-45 HCM
→ 2 chiến dịch · 4 nhóm · 12 quảng cáo = 18 đối tượng
```

**Chặn xung đột CBO/ABO ngay trên UI:** chiến dịch có ngân sách CBO → ô ngân sách của thẻ nhóm tự disable kèm chú thích, không để Meta trả lỗi mới biết.

### Bước 3 — giữ nguyên 3 cách nạp nội dung, **thêm ô CTA** và thư viện/biến thể (dùng chung `cp-shared.js`).

### Bước 4 — chuyển sang `build-structure` + job

`executeStudioBatch()` ([cross-post-app.js:1546](public/js/cross-post-app.js:1546)) hiện gọi tuần tự 3 route rồi chờ response đồng bộ. Đổi thành: gom 1 plan → `POST /api/cp/build-structure` → **poll job**. Log hiển thị theo 3 pha (chiến dịch → nhóm → quảng cáo), có CSV kết quả.

> Chế độ 1 CĐ / 1 nhóm **vẫn chạy đúng** vì `build-structure` tổng quát hoá cả trường hợp đó (`campaigns.length = 1`, `adsets.length = 1`).

### 6.1 `public/js/cross-post-app.js` — sửa tối thiểu

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
  if (tab === 'ads')  window.AdsStudio?.init();
  if (tab === 'bulk') window.BulkAds?.init();
  refreshIcons();
}
```

### 6.2 `public/css/cross-post.css`

Class mới (không style inline trừ giá trị tính ở runtime — rule §5): `.bulk-tree`, `.bulk-tree-node`, `.bulk-tree-node--campaign/--adset`, `.bulk-chip-draft`, `.bulk-chip-cbo`, `.cp-entity-card`, `.cp-entity-card-head`, `.cp-char-counter`, `.cp-char-counter--over`, `.bulk-matrix-table`, `.bulk-matrix-cell`, `.bulk-matrix-cell--off`, `.cp-droparea`, `.cp-droparea--hover`, `.cp-log-row`, `.cp-variant-box`, `.studio-structure-tree`. Dùng biến `:root` sẵn có, không thêm màu cứng.

> `test/css.test.js` đang quét file CSS — đọc luật của nó trước khi thêm class để không làm fail test.

---

## 7. Test (`test/bulk-ads.test.js`)

Chỉ test hàm pure, **không gọi mạng** — đúng tinh thần `test/cross-post.test.js`:

1. `buildAdBody` → `status === 'PAUSED'` (bất biến then chốt).
2. `buildAdBody` thiếu `creativeId` → throw.
3. `buildAdCreativeBody` → luôn có `object_story_spec.page_id`.
4. `buildAdCreativeBody` có `imageHash` → `link_data.image_hash`, **không** dùng `picture`.
5. `buildAdCreativeBody` có `videoId` → `video_data`, không `link_data`.
6. `buildAdCreativeBody` `ctaType` sai định dạng → throw.
7. `buildAdCreativeBody` `ctaType` lạ nhưng đúng `^[A-Z_]{3,40}$` → **chấp nhận** (chốt #3).
8. `buildAdsetBody({ useCampaignBudget: true })` → **không có** `daily_budget`.
9. `buildAdsetBody()` mặc định → vẫn có `daily_budget` dạng chuỗi (6 test cũ không vỡ).
10. `resolveAttachments` `attachTo:"all"` với 3 CĐ × 2 nhóm = 6 nhóm.
11. `resolveAttachments` key không tồn tại → throw.
12. `resolveAttachments` CĐ có CBO + nhóm khai `dailyBudget` → throw.
13. `expandPairs` matrix 3×4 = 12 cặp, thứ tự ổn định.
14. `expandPairs` one_to_one lệch số lượng → throw.
15. `expandPairs` round_robin 3 nội dung × 5 nhóm = 5 cặp, quay vòng đúng.
16. `renderAdName` cắt ≤ 200 ký tự, loại `\n`, token thiếu → rỗng.
17. `classifyCampaignDraft`: `IN_PROCESS` → nháp.
18. `classifyCampaignDraft`: số ad = 0 → nháp, `reason='no_ad'`.
19. `classifyCampaignDraft`: `ACTIVE` + có ad → không nháp.
20. `classifyCampaignDraft`: thiếu summary → `isDraft:false` (không đoán).
21. `countPlanObjects` vượt 80 → throw kèm số thực tế.
22. `expandSpintax` lồng nhau; thiếu `}` → trả nguyên văn.
23. `normalizeImageUpload` nhận JPEG/PNG, từ chối GIF/rỗng.
24. **Khoá limit mới** (5 / 15 / 30 / 12 / 60 / 80) + `DELAY_BUILD_AD_MS >= 2000` — giống cách `test/cross-post.test.js:47` đang khoá.
25. `test/cp-guard.test.js`: `build-structure`, `upload-ad-image`, `content-library` (POST) đều nằm sau token guard.

Mục tiêu: **64 test hiện tại vẫn PASS** + ~25 test mới.

---

## 8. Rủi ro & cách giảm

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Tạo tới 80 object THẬT lên BM, dọn tay rất mệt | 🔴 Cao | Toàn bộ **PAUSED**; modal buộc gõ đúng số lượng; CSV có đủ ID (CĐ/nhóm/ad) để xoá nhanh; **chạy thử 1 CĐ × 1 nhóm × 1 nội dung** trước khi mở rộng |
| Rate-limit / checkpoint tài khoản | 🔴 Cao | 2–2,5 s/object, cache creative (giảm ~95 % lệnh tạo creative), `withLock` chặn chạy song song, trần cứng 60 ad / 80 object |
| **Sửa tab 2 đang chạy được → làm vỡ** | 🔴 Cao | GĐ 0 chỉ **di chuyển code** (không đổi logic), nghiệm thu bằng cách chạy lại đúng 4 bước trước/sau; 3 route cũ **không xoá**; chế độ "1 CĐ + 1 nhóm" vẫn là đường đi được test |
| Xung đột CBO (CĐ) ↔ ABO (nhóm) | 🟡 TB | Chặn 2 lớp: UI disable ô ngân sách, backend `resolveAttachments` throw |
| CTA không khớp `objective` nhóm đích | 🟡 TB | Cảnh báo vàng, **không chặn** (chốt #3 — người dùng tự quyết); lỗi vẫn cách ly từng ad |
| Page creative khác page nhóm đích | 🟡 TB | Lấy `promoted_object.page_id` của chính adset; cache creative tách theo `pageId` |
| Chiến dịch nháp chưa có nhóm → không đăng ad vào được | 🟡 TB | Tab 3 hiện rõ, không cho tick, hướng người dùng sang tab 2 để tạo nhóm |
| Người dùng tưởng tải được nháp loại B | 🟡 TB | Ghi rõ giới hạn trên UI + README; không bịa nháp |
| `filtering campaign.id IN` bị Meta từ chối | 🟢 Thấp | Fallback gọi từng campaign, log rõ |
| Upload ảnh 8 MB nghẽn body parser | 🟢 Thấp | Chỉ nâng limit cho đúng 1 path; kiểm magic bytes; cache sha256 |
| Job mất khi restart server giữa đợt | 🟢 Thấp | Object đã tạo vẫn còn trên Meta; CSV tải được trong 1 h |

---

## 9. Cách hoàn tác

1. **Ẩn tab 3 ngay:** xoá nút `#tabBulkAdsBtn` trong `public/cross-post.html` → tab biến mất, mọi thứ khác chạy bình thường.
2. **Hoàn tác tab 2:** `git revert` commit GĐ 5–6. Nếu cần lùi hẳn về trước khi tách file → revert thêm commit GĐ 0.
3. **Dọn dữ liệu đã tạo trên Meta:** tải CSV kết quả → lọc cột ID → xoá/archive trong Ads Manager theo lô. Vì tất cả PAUSED nên **không phát sinh chi phí** trong lúc chờ dọn.
4. File dữ liệu mới (`cp_content_library.json`, `cp_image_hashes.json`) nằm trong `data/` (đã gitignore), xoá an toàn, không ảnh hưởng dashboard.

---

## 10. Chia giai đoạn (mỗi giai đoạn 1 commit, test xanh mới sang bước sau)

| GĐ | Nội dung | Ghi lên Meta? | Nghiệm thu ngay |
|---|---|---|---|
| **0** | Tách `ads-studio.js` + `cp-shared.js` khỏi `cross-post-app.js` — **chỉ di chuyển code** | Không | Tab 2 làm đủ 4 bước giống hệt trước khi tách |
| **1** | Backend đọc: mở rộng route `campaigns` (cờ nháp) + route `adsets` nhiều campaign + `classifyCampaignDraft` | Không | `curl` thấy chiến dịch nháp với `isDraft:true` |
| **2** | Tab 3 bước 1: tab mới + cây 2 cấp + bộ lọc "Chỉ nháp" + đếm chọn | Không | Tick chọn được 12 nhóm thuộc 4 CĐ nháp |
| **3** | `cp-shared.js`: thẻ nội dung + ô CTA + upload ảnh + thư viện + sinh biến thể | Chỉ upload ảnh | Soạn 3 nội dung, upload ảnh thấy preview + `image_hash` |
| **4** | Tab 3 bước 3: ma trận, chế độ ghép, mẫu tên, chặn trần | Không | Bảng ma trận + "Sẽ tạo N quảng cáo" đúng số |
| **5** | Backend ghi: `build-structure` + job + CSV. **Chạy thật 1 nội dung × 1 nhóm có sẵn** | **CÓ** | 1 ad PAUSED xuất hiện đúng nhóm đích |
| **6** | Tab 3 bước 4 đầy đủ: poll job, log, kết quả, CSV, thử lại phần lỗi | **CÓ** | Chạy 2 nội dung × 3 nhóm = 6 ad |
| **7** | Tab 2: chế độ "Tạo nhiều Chiến dịch" + "Tạo nhiều Nhóm" + `attachTo` + xem trước cây | Không (chỉ UI) | Cây xem trước đúng: 2 CĐ · 4 nhóm · 12 ad |
| **8** | Tab 2 bước 4 chuyển sang `build-structure` + job. **Chạy thật 1 CĐ × 1 nhóm × 1 nội dung** | **CÓ** | Cây 1-1-1 tạo đúng, PAUSED |
| **9** | Chạy thật tab 2 quy mô nhỏ: 2 CĐ × 2 nhóm × 2 nội dung = 12 đối tượng | **CÓ** | Khớp CSV, không lỗi CBO/ABO |
| **10** | Test + cập nhật `PROJECT_CONTEXT.md` (§6 REST API, §10 Lịch sử) + README | Không | `npm test` xanh toàn bộ |

GĐ 0–4 và 7 **không ghi gì lên Meta** → rủi ro bằng 0.

---

## 11. Checklist nghiệm thu

**Tab 3**
- [ ] Chiến dịch nháp (chưa có ad / `IN_PROCESS`) hiện với chip 🟡 "Nháp"
- [ ] Bộ lọc "Chỉ nháp" đúng số lượng
- [ ] CĐ nháp chưa có nhóm → báo rõ, không cho tick
- [ ] UI ghi rõ giới hạn nháp loại B
- [ ] Chọn được nhiều nhóm thuộc nhiều chiến dịch trong 1 tài khoản
- [ ] Đổi tài khoản → xoá lựa chọn cũ và cảnh báo

**Nội dung (dùng chung)**
- [ ] Soạn ≥ 3 nội dung, upload ảnh trả `image_hash`, lưu/nạp từ thư viện
- [ ] Ô CTA chọn được từ danh sách **và** tự nhập được
- [ ] Bộ sinh biến thể tạo nội dung mới có nhãn rõ ràng

**Tab 2**
- [ ] Tạo được 2–5 chiến dịch mới trong 1 lần, tên theo chuẩn 4 sản phẩm
- [ ] "Sinh nhanh theo sản phẩm" tạo đúng 1 thẻ / sản phẩm
- [ ] Tạo nhiều nhóm, `attachTo: all` nhân đúng vào mọi chiến dịch
- [ ] Cây xem trước khớp số thực tế tạo ra
- [ ] CĐ có CBO → ô ngân sách nhóm bị disable, không lỗi Meta
- [ ] Chế độ cũ (1 CĐ / 1 nhóm / nhóm có sẵn) chạy y như trước

**Chung**
- [ ] Bảng ma trận đúng số, loại trừ được từng cặp, chặn khi vượt 60
- [ ] **Mọi object tạo ra đều PAUSED**
- [ ] 1 object lỗi không làm dừng cả đợt
- [ ] CSV kết quả mở bằng Excel tiếng Việt không lỗi font
- [ ] F5 giữa đợt → `GET /api/cp/job/:jobId` vẫn trả kết quả
- [ ] POST mới bị chặn khi thiếu `X-Internal-Token`
- [ ] `npm test` xanh (64 cũ + ~25 mới)
- [ ] Tab 1 hoạt động y như trước
- [ ] Console trình duyệt sạch lỗi
- [ ] `PROJECT_CONTEXT.md` + `README.md` đã cập nhật

---

## 12. Việc cần chủ dự án xác nhận nốt

1. **GĐ 0 — tách `ads-studio.js` + `cp-shared.js`:** đồng ý không? (Khuyến nghị **có** — nếu không, `cross-post-app.js` sẽ > 2100 dòng. Thuần di chuyển code, không đổi logic.)
2. **Trần tab 2:** tối đa **5 chiến dịch** / **15 nhóm** / **80 đối tượng** mỗi đợt — ok chưa?
3. Duyệt kế hoạch này để bắt đầu **GĐ 0 → GĐ 4** (toàn bộ phần không ghi gì lên Meta).
