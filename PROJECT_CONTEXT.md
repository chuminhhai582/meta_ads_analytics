# PROJECT CONTEXT — Meta Ads Analytics (BM Ucmas Việt Nam)

> **Tài liệu bối cảnh dành cho AI / Developer tiếp theo.**
> Đọc file này TRƯỚC khi sửa bất kỳ dòng code nào. Quy tắc làm việc bắt buộc nằm ở
> [`.agents/rules/quy-tac-du-an.md`](./.agents/rules/quy-tac-du-an.md).
>
> Cập nhật lần cuối: 2026-10-23

---

## 1. Mục tiêu ứng dụng

Ứng dụng web **chạy local** (Node.js + Express + HTML/CSS/JS thuần) giúp chủ doanh nghiệp:

1. Kéo dữ liệu quảng cáo **thật** từ Meta Marketing API (Graph API) cho **toàn bộ tài khoản quảng cáo thuộc 1 Business Manager duy nhất**.
2. Xem báo cáo theo **2 chiều**: theo **Tài khoản quảng cáo** và theo **Sản phẩm**.
3. Theo dõi **ngân sách dự kiến chi tiêu trong ngày** (CBO + ABO) và tiến độ giải ngân hôm nay.
4. Nhận chẩn đoán / khuyến nghị tự động (rule-based, không gọi LLM) cho từng chiến dịch.
5. Xuất dữ liệu ra CSV / JSON chuẩn UTF-8.

Mô hình kinh doanh: **giáo dục (toán tư duy cho trẻ em)**. Chuyển đổi chính là **tin nhắn (messaging)** / lead, **KHÔNG phải mua hàng online**. Vì vậy CPA (giá/tin nhắn) là chỉ số quan trọng nhất; Doanh thu & ROAS thương mại điện tử không áp dụng.

---

## 2. Ràng buộc nghiệp vụ CỐ ĐỊNH (không được tự ý thay đổi)

| # | Ràng buộc | Giá trị |
|---|-----------|---------|
| 1 | Business Manager duy nhất | **BM ID `2590933284556026`** ("Ucmas Việt Nam"). System User hiện tại truy cập được **9/10** tài khoản (thiếu TK 7 `act_878031747567840`) |
| 2 | Meta App | App ID `1512128683054595` ("APP Test") |
| 3 | Sản phẩm được hiển thị & phân tích | **Chỉ 4 sản phẩm: UCMAS, UCKID, MATHCA, TRẠI HÈ** |
| 4 | Quy tắc nhận diện sản phẩm | Lấy đoạn text **giữa dấu `/` thứ 1 và thứ 2** trong tên chiến dịch. VD: `hai/ucmas/mess/khaigiang` → `ucmas` |
| 5 | Sản phẩm khác | Gán key `khac`, **không hiển thị** trong 4 thẻ sản phẩm và bộ lọc "Tất cả 4 sản phẩm" |
| 6 | Tiền tệ | VND, timezone `Asia/Ho_Chi_Minh` |

### 2.1 Bảng ánh xạ sản phẩm (`detectProduct()` trong `src/meta-api.js`)

| Đoạn giữa `/…/` (không phân biệt hoa thường) | key | Nhãn |
|---|---|---|
| chứa `ucmas` (gồm `ucmass`) | `ucmas` | UCMAS |
| chứa `uckid` hoặc bằng `uc-kid` | `uckid` | UCKID |
| chứa `mathca` (gồm `somathca`) | `mathca` | MATHCA |
| chứa `traihe` hoặc `trại hè` | `traihe` | TRẠI HÈ |
| còn lại | `khac` | Khác |

Fallback: nếu tên không có đủ dấu `/`, tìm từ khoá trong toàn bộ tên.

### 2.2 Công thức Ngân sách dự kiến hôm nay (`expectedDailyBudget`)

Phần lớn chiến dịch trong BM chạy **ABO** (ngân sách đặt ở Nhóm quảng cáo), nên `campaign.daily_budget` thường = 0.

```
Nếu chiến dịch đang chạy:
    Nếu campaign.daily_budget > 0  (CBO) → dùng campaign.daily_budget
    Ngược lại (ABO)                      → Σ adset.daily_budget của các adset có effective_status === 'ACTIVE'
Nếu chiến dịch không chạy → 0
```

⚠️ **Bắt buộc dùng `effective_status === 'ACTIVE'`** cho adset (không dùng `status`). Adset có `status: ACTIVE` nhưng chiến dịch cha bị tắt sẽ có `effective_status: CAMPAIGN_PAUSED` và KHÔNG tiêu tiền.

Tổng hợp lên: chiến dịch → sản phẩm (`products[i].expectedDailyBudget`) → toàn bộ (`summary.expectedDailyBudget`).

### 2.3 Chỉ số chuyển đổi chính (`extractConversions()`)

Trả về **hai trường tách biệt**, không gộp:

| Trường | Lấy từ action_type |
|---|---|
| `messages` | `onsite_conversion.messaging_conversation_started_7d`, dự phòng `onsite_conversion.total_messaging_connection` |
| `otherConversions` | `lead` / `onsite_conversion.lead` / `purchase` / `omni_purchase` |

⚠️ **CPA chỉ tính trên `messages`.** Trước 16/10/2026 hàm này gộp cả bốn loại vào một số
(`messages || connections || leads || purchases`), khiến chiến dịch 0 tin nhắn nhưng có
50 đơn hàng bị báo thành "50 tin nhắn" — CPA của các chiến dịch đo những thứ khác nhau
mà vẫn cộng chung.

---

## 3. Kiến trúc & luồng dữ liệu

```mermaid
flowchart LR
    A["Meta Graph API v21.0"] -->|"owned_ad_accounts, campaigns, adsets, insights (phân trang đầy đủ)"| B["src/meta-api.js (fetchRawReport)"]
    B -->|"raw report v4 (coverage + adMap)"| C["src/report.js (buildView)"]
    C -->|"view 4 sản phẩm"| D["src/export-csv.js"]
    D --> E["data/latest_insights.json + CSV"]
    C --> F["src/server.js (Express)"]
    C -->|"generateAnalysis()"| G["src/ai-analyst.js"]
    F -->|"REST /api/data, /api/sync"| H["public/js/app.js"]
    H --> I["public/index.html + css/style.css"]
```

1. Server khởi động → đọc `data/latest_insights.json` (schema v2-v4) vào bộ nhớ (`rawReport`).
2. Người dùng bấm **Đồng bộ** → `POST /api/sync` → `planSync()` quyết định kéo toàn bộ hay chỉ phần mới → `fetchRawReport()` gọi Meta API (chia theo tháng, phân trang đầy đủ) → gộp với kho cũ → ghi JSON/CSV → trả payload view + phân tích.
3. Lọc theo **sản phẩm / tài khoản / khoảng thời gian** đều xử lý 100% local qua `GET /api/data` — `buildView()` cắt lát kho dữ liệu trong ~4ms, KHÔNG gọi lại Meta API.

---

## 4. Cấu trúc thư mục

```text
Local_phantich_ads/
├── .agents/
│   ├── rules/quy-tac-du-an.md        # QUY TẮC BẮT BUỘC cho AI (always_on)
│   └── plugins/meta-ads/             # Plugin Antigravity: MCP server + skill meta-ads
│       ├── plugin.json
│       ├── mcp_config.json           # Trỏ tới mcp-launcher.js
│       └── skills/meta-ads/SKILL.md
├── data/                             # Dữ liệu sinh tự động (gitignored)
│   ├── latest_insights.json          # Snapshot raw report v4 (adMap + coverage)
│   ├── campaigns.csv                 # Excel UTF-8 BOM
│   └── daily_performance.csv
├── public/                           # Frontend tĩnh (served by Express)
│   ├── index.html                    # Layout dashboard chuẩn SEO & responsive
│   ├── css/style.css                 # Design system Dark Glassmorphism dùng CSS variables
│   └── js/app.js                     # Logic UI, Chart.js, bộ lọc & sắp xếp bảng
├── src/
│   ├── config.js                     # Đọc .env & updateEnvFile an toàn
│   ├── meta-api.js                   # Client Graph API với phân trang toàn diện
│   ├── report.js                     # View builder lọc 4 sản phẩm & tổng hợp chỉ số
│   ├── ai-analyst.js                 # Động cơ chẩn đoán rule-based chuẩn CPA tin nhắn
│   ├── export-csv.js                 # Xuất CSV UTF-8 BOM & JSON
│   └── server.js                     # Express server + REST API (chỉ loopback + token CSRF)
├── docs/                             # Tài liệu & lưu trữ
│   └── archive/                      # Báo cáo rà soát & hướng dẫn lịch sử đã hoàn thành
│       ├── BAO_CAO_RA_SOAT_2026-10-16.md
│       ├── HUONG_DAN_FIX_2026-10-22.md
│       └── HUONG_DAN_LAY_TOKEN_TU_N8N.md
├── mcp-launcher.js                   # Khởi chạy @mikusnuz/meta-ads-mcp
├── .env                              # BÍ MẬT: token, app secret (gitignored)
├── .env.example                      # Mẫu biến môi trường
├── HUONG_DAN_LAY_TOKEN_META.md       # Hướng dẫn lấy access token
├── PROJECT_CONTEXT.md                # (file này)
└── README.md                         # Hướng dẫn sử dụng cho người dùng
```

---

## 5. Biến môi trường (`.env`)

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `META_ADS_ACCESS_TOKEN` | ✅ | User/System User token, quyền `ads_read`, `read_insights` |
| `META_AD_ACCOUNT_ID` | ⛔ (dùng cho MCP) | Tài khoản mặc định cho MCP server |
| `META_BUSINESS_ID` | ⛔ | Mặc định `2590933284556026` |
| `META_APP_ID` / `META_APP_SECRET` | ⛔ | Không dùng để lấy dữ liệu. Để trống được nếu dùng System User token hạn Never |
| `META_API_VERSION` | ⛔ | Mặc định `v21.0` |
| `PORT` | ⛔ | Mặc định `3000` |
| `SYNC_START_DATE` | ⛔ | Mốc bắt đầu kho dữ liệu, mặc định `2026-01-01` |
| `SYNC_RETRO_DAYS` | ⛔ | Số ngày luôn kéo lại mỗi lần đồng bộ, mặc định `7` |
| `ALLOW_REMOTE` | ⛔ | `true` mới cho máy khác trong LAN truy cập. Mặc định `false` |

---

## 6. REST API (`src/server.js`)

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/api/data?product=...` | Trả về view báo cáo theo sản phẩm (`ALL` hoặc key sản phẩm) + phân tích AI |
| POST | `/api/sync` | Body `{ datePreset, accountId, productFilter }` → kéo dữ liệu mới từ Meta |
| POST | `/api/save-config` | Lưu token/app vào `.env` (chỉ cập nhật đúng key được gửi) |
| GET | `/api/session` | Trả token phiên (CSRF) cho trang cùng origin |
| POST | `/api/sync-sheet` | Chỉ làm mới lead Google Sheet (~0,3s, không gọi Meta) |
| GET | `/api/export/campaigns` \| `/daily` \| `/json` | Xuất CSV / JSON theo bộ lọc hiện tại |
| GET | `/docs/huong-dan-token` | Tải tài liệu hướng dẫn lấy token dạng text UTF-8 |

> Không có route `/auth/*` — ứng dụng không dùng OAuth, chỉ dán token thủ công.

**Bảo mật:** không gửi header CORS; chỉ nhận kết nối loopback (trừ khi `ALLOW_REMOTE=true`);
mọi route **ghi** đòi header `X-Internal-Token` lấy từ `GET /api/session`.

`datePreset` hợp lệ (hằng `DATE_PRESETS` trong `src/report.js`):
`today`, `yesterday`, `last_7d`, `last_14d`, `last_30d`, `last_90d`,
`this_month`, `last_month`, `this_quarter`, `this_year`.

Ngoài ra `datePreset=custom` kèm `startDate` + `endDate` (YYYY-MM-DD) cho khoảng ngày
tự chọn. Ngày không hợp lệ / thiếu → tự quay về `last_30d`; chọn ngược → tự đảo;
vượt quá hôm nay → cắt về hôm nay. Xem `normalizeCustomRange()`.

---

## 7. Cấu trúc view báo cáo trả về cho Client

```jsonc
{
  "view": {
    "fetchedAt": "ISO date",
    "datePreset": "last_30d",
    "scope": { "businessId", "accountId", "name", "currency" },
    "bmAccounts": [ { "id", "numericId", "name", "status", "currency" } ],
    "product": "ALL | ucmas | uckid | mathca | traihe",
    "products": [
      { "key", "name", "subtitle", "count", "spend", "messages", "expectedDailyBudget", "todaySpend", "todayMessages", "cpa", "ctr", "cpc", "pacingPct" }
    ],
    "summary": {
      "totalSpend", "totalMessages", "avgCpa", "expectedDailyBudget", "todaySpend", "todayMessages", "todayCpa", "pacingPct", "campaignCount", "activeCount"
    },
    "funnel": { "impressions", "clicks", "messages", "l1", "l2", "l3", "l4" },
    "dailyTrend": [ { "date", "spend", "messages", "cpa", ... } ],
    "placements": [ { "platform", "label", "spend", "percentage" } ],
    "campaigns": [
      { "id", "name", "accountId", "accountName", "product", "productLabel", "effective_status", "expectedDailyBudget", "spend", "messages", "otherConversions", "cpa", "todaySpend", "todayMessages", "ctr", "recommendation",
        // Lead đã ĐO ĐƯỢC qua adMap — không bao giờ là số chia theo tỉ lệ
        "l1Count", "l2Count", "l3Count", "l4Count", "revenue", "cpl", "cpaL3", "cac", "roas" }
    ],

    // ----- Bổ sung từ đợt rà soát 2026-10-16 & 2026-10-22 (VIEW_VERSION = 5) -----
    "schemaVersion": 5,                // VIEW_VERSION = 5 (khác SNAPSHOT_VERSION = 4 của kho dữ liệu)
    "syncWindow": "last_30d",          // kỳ snapshot thật sự chứa dữ liệu
    "frequencyWindow": "last_30d",     // cửa sổ đo tần suất cố định 30 ngày
    "dateRange": { "startDate", "endDate" },
    "tabBadges": {                     // THAY THẾ `productTabs` (trước nặng 436 KB)
      "ucmas": { "l1Count", "l3Count", "l4Count", "campaignCount", "activeCount" }, ...
    },
    "fatigueApplicable": true,         // luôn true (frequency tính theo cửa sổ 30 ngày cố định)
    "leadAttribution": { "matched", "unmatched", "adMapSize" },
    "unassignedLeads": { "totalLeads", "l1Count", "l2Count", "l3Count", "l4Count", "revenue" },
    "dataNotes": [ { "level": "info|warning", "message" } ],
    "recentEnrolled": [ { "phoneMasked", "l4Date", "entryDate", "fanpage", "revenue", "product" } ]
    //        ^ KHÔNG chứa `phone` hay `adId` gốc (B-02)
  },
  "analysis": {
    "healthScore": 66,
    "statusLabel": "Hoạt động trung bình",
    "statusLevel": "warn",
    "thresholds": { "CPA_GOOD": 65000, ... },   // frontend dùng chung, không hardcode
    "fatigueApplicable": true,
    "recommendations": [ { "type", "title", "message" } ],
    "topPerformers": [ ... ],
    "moneyWasters": [ ... ],
    "fatigueAlerts": [ ... ],
    "executiveSummary": "..."
  }
}
```

### Bất biến BẮT BUỘC giữ (có test tự động khoá lại)

```
Σ(view.campaigns[].l1Count) + view.unassignedLeads.l1Count === view.summary.l1Count
```
Đúng cho cả L2/L3/L4 và `revenue`, với mọi tổ hợp kỳ × sản phẩm × tài khoản.
Chạy `npm test` trước khi commit bất kỳ thay đổi nào trong `src/report.js`.

### Phân biệt Snapshot Schema vs View Schema (Q-03)

| Khái niệm | Hằng số | Phiên bản | File quản lý | Ý nghĩa |
|---|---|---|---|---|
| **Snapshot Schema** | `SNAPSHOT_VERSION` | **4** (hỗ trợ v2–v4) | `src/meta-api.js` | Định dạng file lưu trữ hạt lựu `data/latest_insights.json` (coverage, adMap, dailyRecords, placementRecords). |
| **View Schema** | `VIEW_VERSION` | **5** | `src/report.js` | Định dạng payload API `/api/data` gửi về client sau khi `buildView()` tổng hợp. |

### Lịch sử Snapshot `data/latest_insights.json`

| Phiên bản | Khác biệt |
|---|---|
| v2 | Không có `adMap`. Vẫn đọc được, nhưng mọi lead vào `unassignedLeads` + hiện cảnh báo cần đồng bộ lại. |
| v3 | Có `adMap` (`adId → campaignId`). `dailyRecords` có thêm `reach`, `otherConversions`. |
| **v4** | Có `coverage {since, until}` → đồng bộ gia tăng. `placementRecords` có `month`. Chiến dịch KHÔNG còn mang số tổng (mọi chỉ số tính lại từ `dailyRecords`). `frequency` là của **30 ngày gần nhất**, độc lập với `coverage`. |

### Kho dữ liệu & đồng bộ gia tăng (từ 16/10/2026)

| | |
|---|---|
| Phạm vi | `SYNC_START_DATE` (mặc định `2026-01-01`) → hôm nay |
| Lần đầu | Kéo toàn bộ. Đo thực tế: **6.471 dòng / 9 tài khoản / 55,9 giây** |
| Các lần sau | Chỉ kéo từ `coverage.until − SYNC_RETRO_DAYS + 1` → hôm nay. Đo thực tế: **~10 giây** |
| Ép kéo lại tất cả | `npm run fetch -- --full` |

**Vì sao phải lùi lại `SYNC_RETRO_DAYS` (mặc định 7) chứ không chỉ lấy ngày mới:**
Meta dùng cửa sổ quy kết 7 ngày, nên số liệu của những ngày vừa qua còn được bổ sung
sau khi đã ghi nhận. Chỉ lấy ngày mới sẽ bỏ sót phần thay đổi đó.

**Gộp dữ liệu:** `mergeByDate()` giữ nguyên bản ghi TRƯỚC mốc kéo lại và **thay thế**
(không cộng dồn) toàn bộ từ mốc đó trở đi — vì Meta có thể sửa lại số của ngày đã qua.

**Chia theo tháng:** `monthChunks()` cắt khoảng cần kéo thành từng tháng. Đo thực tế trên
BM này: kéo cả năm trong 1 request = 3.593 dòng / 110,6s (~32 dòng/s, 8 trang); chia theo
tháng = ~56 dòng/s, mỗi tháng gọn trong 1 trang. Nhanh hơn **1,7×** và tránh request quá
lớn bị Meta từ chối.

**Lead từ Google Sheet:** `fetchGoogleSheetLeads()` luôn tải lại TOÀN BỘ CSV và dựng lại
mọi lead từ đầu — nên các trường được cập nhật trên lead cũ (ngày L2/L3/L4, học phí) đều
được ghi nhận, không chỉ lead mới tạo.

---

## 8. Ngưỡng nghiệp vụ phân tích AI (`src/ai-analyst.js`)

| Chỉ số | Ngưỡng |
|---|---|
| CPA tốt / trung bình / cao | ≤ 65.000 ₫ / ≤ 90.000 ₫ / > 90.000 ₫ |
| Win cần scale | ≥ 10 tin & CPA ≤ 65.000 ₫ (đang chạy) |
| Cần rà soát (Money Waster) | Chi > 1,2tr & 0 tin, hoặc chi > 2tr & CPA > 130.000 ₫ (đang chạy) |
| Fatigue | Frequency ≥ 3.0 (đang chạy) — **tính theo cửa sổ cố định 30 ngày gần nhất** |
| CTR thấp / cao | < 1,2% / ≥ 2,0% |

> Ngưỡng là nguồn duy nhất tại `THRESHOLDS` trong `src/ai-analyst.js`, được gửi kèm
> payload (`analysis.thresholds`) để frontend dùng chung — không viết lại trong `app.js`.

> **Về Frequency (từ 2026-10-16 / Q-02):** Meta chỉ trả `frequency` chính xác cho kỳ được truy vấn
> (reach loại trùng không thể cộng gộp theo ngày). Do bão hoà quảng cáo (Creative Fatigue) là hiện tượng
> dài hạn, hệ thống đo tần suất trên cửa sổ **30 ngày gần nhất** (`last_30d`) và lưu trong snapshot.
> Vì vậy `view.fatigueApplicable` luôn là `true`, và nhãn/tooltip trên giao diện & file CSV ghi rõ
> "Tần suất (30 ngày gần nhất)" để người dùng không nhầm lẫn khi xem các kỳ ngắn (như "Hôm qua").

---

## 9. Vấn đề đã biết (Known Issues) — cập nhật khi sửa xong

### Đợt rà soát 2026-10-22 — Đã hoàn thành 28/28 hạng mục (Đợt 1–4, 64/64 tests PASS ✅)

Báo cáo chi tiết & hướng dẫn kỹ thuật: [`HUONG_DAN_FIX_2026-10-22.md`](./docs/archive/HUONG_DAN_FIX_2026-10-22.md)

1. **Đợt 1 — Giao diện & Bảo mật (4/4 ✅)**:
   - ✅ **U-01 + F-03**: Thêm lại `<div id="reportContent">`, sửa lỗi empty state "Không có chiến dịch nào".
   - ✅ **U-02**: Bổ sung đầy đủ 7 biến CSS còn thiếu (`--text-subtle`, `--text-on-accent`, `--bg-accent-dim`, `--radius-xs`, `--radius-lg`, `--shadow-md`, `--shadow-xl`).
   - ✅ **F-01**: Đồng bộ tham số bộ lọc (`?datePreset=&product=&accountId=`) vào 3 liên kết xuất file (CSV chiến dịch, CSV ngày, JSON).
   - ✅ **S-01**: Chặn CSRF theo phương thức cho `/api/cp/*` (`POST/PUT/DELETE` bắt buộc `X-Internal-Token`, `GET` mở tự do cho đọc cache).
2. **Đợt 2 — Hiệu suất payload (3/3 ✅)**:
   - ✅ **P-01**: Lọc 561 chiến dịch rỗng khỏi payload view (giảm 89% dung lượng từ 389.7 KB xuống ~42 KB), bảo toàn 100% bất biến $\sum(\text{dòng}) + \text{unassignedLeads} = \text{summary}$.
   - ✅ **P-02**: Nén gzip bằng thư viện native `zlib` (tiết kiệm thêm 94% băng thông mạng, không thêm external dependency).
   - ✅ **F-02**: Tỉa danh sách chiến dịch trong dropdown/autocomplete của module nhân bản theo đúng view hiện tại.
3. **Đợt 3 — Độ tin cậy & Tiêu chuẩn UX (6/6 ✅)**:
   - ✅ **Q-01**: Bộ test tự động toàn diện cho `cross-post.js` và các route xuất file (`test/cross-post.test.js`, `test/export-routes.test.js`).
   - ✅ **F-05**: Bổ sung cờ chống bấm trùng (`isSubmitting`) cho cả Cross-Post và Ads Creation Studio.
   - ✅ **P-03**: Debounce ô tìm kiếm bảng (150ms) giúp thao tác lọc mượt mà, không giật lag.
   - ✅ **P-04**: Cập nhật biểu đồ tại chỗ (`chart.update()`) thay vì huỷ tạo lại từ đầu (`chart.destroy()`).
   - ✅ **U-04**: Hỗ trợ sắp xếp bảng bằng bàn phím (Enter/Space) kèm thuộc tính trợ năng `aria-sort`.
   - ✅ **U-05**: Khép kín focus (`trapFocus`) và hỗ trợ phím `Esc` đóng modal, hoàn trả focus chuẩn WAI-ARIA.
4. **Đợt 4 — Hoàn thiện kiến trúc & Clean-up (14/14 ✅)**:
   - ✅ **U-03**: Thêm thanh bật/tắt nhóm cột bảng (`Chỉ số Meta`, `Tuyển sinh CRM`, `Nền tảng`) lưu trạng thái qua `localStorage`.
   - ✅ **F-04**: Chuyển quy trình nhân bản hàng loạt sang Job model (`jobId`, polling 1.5s, `renderPartialResults`) chống timeout HTTP.
   - ✅ **Q-02**: Dọn dẹp `fatigueApplicable` (mặc định luôn true), chuẩn hoá nhãn "Tần suất (30 ngày gần nhất)", tooltip động.
   - ✅ **Q-03**: Tách biệt rõ ràng 2 khái niệm phiên bản: `SNAPSHOT_VERSION = 4` (kho dữ liệu) vs `VIEW_VERSION = 5` (payload API).
   - ✅ **P-05**: Bỏ đọc lại JSON từ ổ đĩa trong `analyze-campaigns`, chia sẻ `rawReport` qua `setRawReportProvider`.
   - ✅ **P-06**: Ghi compact JSON cho `leads_cache.json` (giảm 31% kích thước file).
   - ✅ **P-07**: Thêm tài liệu giải thích giới hạn `VIEW_CACHE_MAX = 32`.
   - ✅ **F-06**: Gộp hai route trùng lặp `/api/cp/ad-accounts`, tự động kéo từ Meta nếu cache rỗng.
   - ✅ **S-02**: Ghim phiên bản `lucide@0.460.0`, thêm `defer`, cấp cache headers `immutable` cho static assets.
   - ✅ **U-06**: Nâng tỷ lệ tương phản `--text-muted` lên #7c8ba3 (AA 5.8:1), tăng kích thước font chữ cho các chỉ số phụ.
   - ✅ **U-07**: Bổ sung `@media (prefers-reduced-motion: reduce)` và `@media print` hỗ trợ in ấn báo cáo rõ nét.
   - ✅ **U-08**: Thống nhất `max-width: 1480px`, tái sử dụng class CSS trong modal nhân bản, bổ sung quy ước hạn chế style inline.
   - ✅ **Q-04**: Loại bỏ các trường payload không ai dùng (`objective`, `status`, `igSpend`, `msgSpend`, `audSpend`, `otherSpend`).
   - ✅ **Q-05**: Gắn thẻ Git `snapshot/*` cho các mốc lịch sử, xoá bỏ triệt để thư mục `.backups/`.

### Đợt rà soát 2026-10-16 — đã sửa toàn bộ 31 phát hiện (đã duyệt)

Báo cáo đầy đủ kèm số đo kiểm chứng: [`BAO_CAO_RA_SOAT_2026-10-16.md`](./docs/archive/BAO_CAO_RA_SOAT_2026-10-16.md)

**Nhóm A — số liệu sai (7/7 ✅)**
1. ✅ **A-01 Ghép lead đúng qua `adMap`**: sync kéo thêm `act_X/ads?fields=id,campaign_id` dựng bảng tra `adId → campaignId` (schema **v3**). Trước đây so Ad ID với Campaign ID — 2 loại đối tượng khác nhau, 0/1.142 lead khớp.
2. ✅ **A-02 Bỏ hoàn toàn việc chia lead theo tỉ lệ chi tiêu** (vi phạm §4). Lead không ghép được nằm ở `view.unassignedLeads` + một dòng "Chưa gán được nguồn" có nhãn rõ trong bảng.
3. ✅ **A-03 Lead/doanh thu lọc theo kỳ**: truyền `startDate`/`endDate` vào mọi phép tổng hợp lead. Kiểm chứng: 30 ngày L1 283 (trước 1.142), ROAS **1,92×** (trước 11,88× — chia doanh thu trọn đời cho chi tiêu 30 ngày).
4. ✅ **A-04 Lead lọc theo tài khoản** qua `campaign.accountId` của chiến dịch đã ghép.
5. ✅ **A-05 Một nguồn tính duy nhất**: bất biến `Σ(dòng hiển thị) + unassignedLeads === summary` được test tự động khoá lại cho mọi tổ hợp kỳ × sản phẩm.
6. ✅ **A-06 Lead không nhận diện được → `'khac'`**, không còn mặc định dồn về UCMAS (trước: 998/1.142 = 87% bị gán UCMAS). Sản phẩm của chiến dịch đã ghép được ưu tiên hơn cột trong sheet.
7. ✅ **A-07 Tách `messages` và `otherConversions`**: `extractConversions()` không còn trả về đơn hàng dưới dạng "tin nhắn". CPA chỉ tính trên tin nhắn. Fatigue chỉ đánh giá khi `fatigueApplicable`.

**Nhóm B — bảo mật & dữ liệu cá nhân (3/3 ✅)**
8. ✅ **B-01**: bỏ `cors()` (không còn `Access-Control-Allow-Origin: *`); chặn mọi kết nối không phải loopback (403); route ghi yêu cầu header `X-Internal-Token` lấy từ `GET /api/session` → chặn CSRF ghi đè token. Mở LAN có chủ ý bằng `ALLOW_REMOTE=true`.
9. ✅ **B-02**: `recentEnrolled` chỉ còn các trường được chọn tường minh — `phone` và `adId` gốc không rời khỏi server nữa.
10. ✅ **B-03**: `validateConfigInput()` kiểm tra định dạng token/appId/appSecret/sheetUrl; `updateEnvFile()` lọc `\r\n` chống chèn biến vào `.env`.

**Nhóm C — chức năng hỏng (7/7 ✅)**
11. ✅ **C-01**: thêm thật 3 route `/api/export/campaigns|daily|json` (trước trả về `index.html` 23 KB kèm status 200). Thêm nút "Làm mới Google Sheet" gọi `/api/sync-sheet` (~0,3s).
12. ✅ **C-02**: `/api/*` không khớp → `404 JSON`, đặt trước SPA fallback.
13. ✅ **C-03**: guard `rawReport` trong `respondWithView` (409 thay vì TypeError 500); truyền đủ bộ lọc.
14. ✅ **C-04**: hàm `esc()` bọc mọi giá trị động; toast dùng `textContent`. Kiểm chứng: tên chiến dịch chứa `<img onerror>` và `<script>` hiển thị nguyên văn, không chèn được DOM.
15. ✅ **C-05**: `AbortController` huỷ request cũ khi đổi bộ lọc liên tiếp.
16. ✅ **C-06**: sort ép chuỗi trước `localeCompare`; dùng `classList.toggle` thay vì ghi đè `className` (giữ được class căn lề).
17. ✅ **C-07**: kỳ đồng bộ ghi rõ ở `raw.syncWindow`, UI cảnh báo khi kỳ đang chọn vượt vùng dữ liệu.

**Nhóm D — hiệu năng (5/5 ✅)**
18. ✅ **D-01**: `productTabs` (436 KB, dùng 4 con số) → `tabBadges`. Payload **883 KB → 428 KB**.
19. ✅ **D-02**: *bỏ* — D-01 đã giảm một nửa payload, không thêm dependency `compression` để giữ stack gọn.
20. ✅ **D-03**: `Map` tra chiến dịch theo ID (bỏ `.find()` lồng ≈ 688.000 phép so sánh/request) + gộp 9 lượt quét lead thành 1. **`buildView` 17,4ms → 1,40ms**; request 24ms → ~6ms.
21. ✅ **D-04**: bỏ lời gọi `insights_today` trùng lặp (today suy ra từ `dailyRecords`); thêm `reach` vào `insights_daily`; thêm lời gọi `ads` cho `adMap`.
22. ✅ **D-05**: cache `buildView` theo khoá `product|accountId|datePreset|tab`, xoá khi đồng bộ (tối đa 32 bản).

**Nhóm E — chất lượng code (9/9 ✅)**
23. ✅ E-01 ngưỡng CPA gửi qua payload, frontend không hardcode. 24. ✅ E-02 BM ID / Sheet URL / phiên bản API đọc từ `.env` + `/api/session`. 25. ✅ E-03 `summarizeLeads` có default param. 26. ✅ E-04 xoá import chết, dùng chung `ROOT_DIR`. 27. ✅ E-05 export dùng lại `convertToCsv()` (kèm chống CSV formula injection). 28. ✅ E-06 xoá hàm `selectProduct()` không dùng. 29. ✅ E-07 gộp 3 thư mục backup vào `.backups/`. 30. ✅ E-08 **29 test tự động** (`npm test`) khoá lại toàn bộ nhóm A. 31. ✅ E-09 tài liệu cập nhật bằng số đo thật.

> ℹ️ **Trạng thái Access Token**: Hệ thống sử dụng System User Token vĩnh viễn (Never Expires)
> với 43 quyền đầy đủ bao gồm `ads_management`, `pages_manage_posts`, `pages_read_engagement`, `business_management`.

### Đợt rà soát 2026-10-15 (lịch sử)

> Đã hoàn tất rà soát & tối ưu ngày 2026-10-15:
1. ✅ **Phân trang (pagination) Graph API**: Đã thêm `callGraphApiAll()` duyệt toàn bộ `paging.next` cho `campaigns`, `adsets`, `insights`. Số chiến dịch quét tăng từ 479 lên 618 (TK 1: 224 chiến dịch, TK 6: 115 chiến dịch).
2. ✅ **Xoá bỏ hoàn toàn dữ liệu giả lập**: Gỡ bỏ các tỷ lệ phễu giả, placement cố định, và frequency 2.3. Thay bằng dữ liệu thật: breakdown `publisher_platform`, phễu 3 tầng thực tế (Hiển thị → Click → Tin nhắn), và frequency thật.
3. ✅ **Sửa cấu trúc HTML header**: Đã thêm thẻ `<div class="header-right">`, giao diện co giãn chuẩn.
4. ✅ **Bảo vệ an toàn file `.env`**: Thay thế bằng hàm `updateEnvFile()` chỉ cập nhật đúng key được gửi lên, không xoá biến khác.
5. ✅ **Sửa đường dẫn tài liệu Token**: Link footer trỏ tới `/docs/huong-dan-token` tải file trực tiếp, không bị 404.
6. ✅ **Tối ưu Payload & Tốc độ**: Tách `fetchRawReport` và `buildView` tại server. Bỏ trùng lặp `allCampaigns`, JSON nén gọn, đồng bộ 10 tài khoản chỉ mất ~9.6 giây.
7. ✅ **Lọc trạng thái chuẩn xác**: Toàn bộ hệ thống (`ai-analyst.js`, `app.js`, `meta-api.js`) dùng đồng nhất `effective_status === 'ACTIVE'`.
8. ✅ **Bỏ hardcode tài khoản & BM ID**: Đọc động từ `config.businessId` và `bmAccounts.length`.
9. ✅ **Nâng cấp Kiến trúc Local Data Lake (Offline-First)**: Lưu trữ dữ liệu hạt lựu `dailyRecords` và `placementRecords` theo từng ngày của toàn bộ 10 tài khoản. Thao tác đổi tài khoản, đổi khoảng thời gian (Hôm nay, Hôm qua, 7 ngày, 14 ngày, 30 ngày, Tháng này) và đổi 4 sản phẩm chạy 100% Local trong < 2ms, không gọi Meta API. Chỉ gọi Graph API duy nhất khi bấm nút "Đồng bộ Meta Ads".
10. ✅ **Tích hợp Google Sheet CRM & Phễu Tuyển Sinh L1-L4 & 5 Tab Sản Phẩm**: Tự động kéo 1.137 lead từ Google Sheet qua link CSV xuất bản web khi bấm Đồng bộ. Phân rã tiến trình tuyển sinh L1 (SĐT), L2 (tiếp cận), L3 (hẹn test), L4 (nhập học chốt), doanh thu học phí thực tế. Tách giao diện thành 5 Tab điều hướng độc lập: Tổng quan (Toàn BM), UCMAS, UCKID, MATHCA, TRẠI HÈ.
11. ✅ **Mở rộng bảng chiến dịch với SĐT (L1), L3, L4, Doanh thu & Chi tiêu theo nền tảng**: Bổ sung trực quan 5 cột mới vào bảng danh sách chiến dịch (`SĐT (L1)`, `Hẹn test (L3)`, `Nhập học (L4)`, `Doanh thu`, `Nền tảng FB/IG/Khác`). Cho phép lọc và click tiêu đề để sort trực tiếp theo từng chỉ số tuyển sinh và doanh thu.
---

## 10. Lịch sử thay đổi quan trọng

| Ngày | Thay đổi |
|---|---|
| 2026-10-15 | Kết nối Meta API với token user "Minh Hải", App `1512128683054595` |
| 2026-10-15 | Giới hạn phạm vi BM `2590933284556026` (10 tài khoản) |
| 2026-10-15 | Phân loại sản phẩm theo quy tắc `/…/`; chốt chỉ 4 SP: UCMAS, UCKID, MATHCA, TRẠI HÈ |
| 2026-10-15 | Thêm Ngân sách dự kiến hôm nay (CBO + ABO, lọc `effective_status`) vào KPI, thẻ SP, bảng |
| 2026-10-15 | Tạo `PROJECT_CONTEXT.md` và `.agents/rules/quy-tac-du-an.md` |
| 2026-10-15 | **Tối ưu toàn diện hệ thống (Đã duyệt)**: Phân trang API (quét đủ 618 CĐ), xoá demo/fake data, thay thế KPI e-commerce bằng tin nhắn/pacing thực tế, đồng nhất UI/UX Dark Glassmorphism, chuẩn hoá schema v2. |
| 2026-10-15 | **Nâng cấp Local Data Lake (Offline-First - Đã duyệt)**: Tách triệt để lớp lưu trữ hạt lựu (`dailyRecords`, `placementRecords`) và lớp biểu diễn (`buildView`). Chuyển toàn bộ lọc tài khoản / ngày / sản phẩm sang xử lý local tức thì (< 2ms), chống Rate Limit Meta, trải nghiệm mượt mà tuyệt đối. |
| 2026-10-15 | **Tích hợp Google Sheet & 5 Tab Chuyên Sâu (Đã duyệt)**: Xây dựng module `src/google-sheet.js`, đo lường phễu tuyển sinh 6 tầng L1-L4, ghi nhận doanh thu học phí & CAC thực tế, chia 5 tab chuyên sâu cho từng sản phẩm. |
| 2026-10-15 | **Bổ sung cột SĐT (L1), L3, L4, Doanh thu và Chi tiêu nền tảng vào danh sách chiến dịch**: Tích hợp dữ liệu phễu tuyển sinh và phân rã chi tiêu Facebook, Instagram, Messenger, Audience Network chi tiết cho từng hàng chiến dịch kèm chức năng sắp xếp linh hoạt. |
| 2026-10-16 | **Kho dữ liệu cả năm 2026 + đồng bộ gia tăng (Đã duyệt)**: snapshot v4 với coverage; lần đầu kéo 6.471 dòng/55,9s, các lần sau ~10s; chia request theo tháng (nhanh hơn 1,7x); placements có chiều thời gian; thêm các kỳ 90 ngày / tháng trước / quý này / cả năm; frequency chuyển sang cửa sổ cố định 30 ngày. |
| 2026-10-16 | **Rà soát toàn hệ thống & sửa 31 phát hiện (Đã duyệt)**: ghép lead đúng qua `adMap` (schema v3), bỏ chia lead theo tỉ lệ chi tiêu, lọc lead theo kỳ & tài khoản, khoá bất biến Σdòng = tổng KPI bằng 29 test; chặn CORS `*` + chỉ cho loopback + token CSRF; ngừng gửi SĐT thật về client; sửa 3 link export hỏng; payload 883→428 KB, `buildView` 17,4→1,40 ms. |
| 2026-10-20 | **Tính năng Cross-Post & Creative Replication (Đã duyệt)**: Tách biệt hoàn toàn dưới route `/cross-post` và API `/api/cp/*`. Hỗ trợ: (1) Quản lý sao chép bài đăng từ 1 Fanpage và đăng đồng loạt sang nhiều Fanpage khác có điều chỉnh nội dung, kèm xem trước và giãn cách 1.5s bảo vệ API; (2) Quản lý nhân bản quảng cáo (Ad Copy) sang các nhóm quảng cáo khác với trạng thái mặc định PAUSED tuyệt đối an toàn. Bảo vệ CSRF qua `X-Internal-Token`. |
| 2026-10-20 | **Nhân bản chiến dịch từ Dashboard + Disk Cache**: (1) Checkbox chọn chiến dịch trên bảng Dashboard, floating toolbar, wizard 4 bước (Phân tích Ads, Chọn Fanpage đích, Cấu hình ngân sách, Thực thi). Tự động phân loại Page Post vs Direct Ad. (2) Cache Fanpage và Ad Accounts xuống data/cp_pages_cache.json và cp_accounts_cache.json — nạp từ disk khi server start, nút Làm mới khi phân quyền thêm. (3) Fix analyze-campaigns: truy vấn ads qua ad account + filtering. Chống spam: max 10 items/batch, 2.5s delay, PAUSED mặc định. |
| 2026-10-20 | **Nhân bản Targeting + Custom Audiences**: analyze-campaigns giờ trả về adset targeting đầy đủ (age, geo, custom_audiences, excluded_custom_audiences, publisher_platforms, bid_strategy, promoted_object). bulk-replicate Direct Ad giờ tạo Campaign → Adset (clone targeting) → Ad trên account đích thay vì chỉ copy ad. UI hiển thị targeting trên mỗi ad card (bước 1) và tóm tắt targeting sẽ được clone (bước 3). Tệp đối tượng Custom/Lookalike Audience tự động sử dụng được nếu đã chia sẻ quyền từ BM. |
| 2026-10-21 | **Tối ưu toàn diện UI/UX (Đã duyệt)**: (1) Sửa triệt để lỗi rớt dòng nút Export trên Header Dashboard, gom nhóm tiện ích Sheet/Token/Export thành toolbar gọn gàng; (2) Thêm Sticky Column cho 2 cột Checkbox + Tên chiến dịch khi cuộn ngang bảng giúp không bị mất dấu; (3) Thêm nút Thu gọn/Mở rộng cho khối Khuyến nghị AI giúp đưa bảng số liệu lên gần tầm mắt; (4) Căn chỉnh Header trang Cross-Post Manager thẳng hàng phẳng phiu, cân đối 2 bên; (5) Bổ sung Dark Custom Scrollbar thanh mảnh, tinh tế cho toàn bộ modal và bảng. |
| 2026-10-21 | **Nâng cấp Ads Creation Studio 4 bước (Đã duyệt)**: (1) Bổ sung quy trình tạo chiến dịch, tạo nhóm quảng cáo kèm targeting (tuổi, giới tính, khu vực địa lý, placements) và tạo hàng loạt quảng cáo; (2) Hỗ trợ 3 cách chuẩn bị nội dung: Multi-post Fanpage, Nhập danh sách nội dung (Custom Cards), và Nhân bản Ads mẫu; (3) Xem trước Ma trận quảng cáo động (Matrix Preview); (4) Khắc phục triệt để lỗi Standard Enhancements / copies deprecated của Meta bằng cách khởi tạo trực tiếp Creative sạch qua `POST act_{id}/adcreatives` và `POST act_{id}/ads`; (5) Giữ an toàn tuyệt đối với trạng thái PAUSED mặc định và giãn cách 1.5s - 2s chống spam API. |
| 2026-10-22 | **Rà soát & tối ưu toàn diện 28 hạng mục (Đợt 1–4, 64/64 tests PASS - Đã duyệt)**: (1) Sửa layout footer, định nghĩa 7 biến CSS thiếu, liên kết export theo bộ lọc, chặn CSRF cho API ghi; (2) Lọc chiến dịch rỗng khỏi payload (−89%), nén gzip bằng zlib native (−94%), bảo toàn 100% bất biến KPI; (3) Bổ sung 15 automated tests (tổng 64 tests), chốt cờ debounce & chốt chống chạy trùng, cập nhật Chart tại chỗ, a11y bàn phím & modal; (4) Bật/tắt nhóm cột bảng, Job model nhân bản hàng loạt chống timeout, chuẩn hoá snapshot v4 vs view v5, đọc RAM trực tiếp, compact cache, ghim CDN + static cache headers, nâng tương phản WCAG AA, prefers-reduced-motion + print style. |
| 2026-10-22 | **Lưu trữ & dọn dẹp tài liệu hoàn thành (Đã duyệt)**: Chuyển các báo cáo rà soát và hướng dẫn đã hoàn thành (BAO_CAO_RA_SOAT_2026-10-16.md, HUONG_DAN_FIX_2026-10-22.md, HUONG_DAN_LAY_TOKEN_TU_N8N.md) vào thư mục docs/archive/ giúp thư mục gốc gọn gàng. |
| 2026-10-23 | **Sửa lỗi làm mới Fanpage & TK (Cross-Post Manager)**: Khắc phục lỗi `ReferenceError: sourceAccountSelect is not defined` trong `public/js/cross-post-app.js` bằng cách trỏ đúng ID `studioAccountSelect`, kiểm tra DOM element an toàn và bảo toàn lựa chọn tài khoản hiện tại. |

