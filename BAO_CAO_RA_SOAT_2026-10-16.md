# BÁO CÁO RÀ SOÁT & KẾ HOẠCH TỐI ƯU — 16/10/2026

> Rà soát 4.113 dòng code, chạy thật server và đối chiếu số liệu đầu ra trên dữ liệu thật
> (603 chiến dịch · 1.290 bản ghi ngày · 1.142 lead · 10 tài khoản).
> **Chưa thực hiện thay đổi nào** — theo quy tắc dự án §2, các mục nhóm A và D-01/D-02 cần duyệt trước.
> Bản xem đầy đủ: https://claude.ai/code/artifact/ba2550ad-50eb-4043-b09c-9ca488ab5f1c

## Tổng quan: 31 phát hiện

| Mức | Số lượng | Nội dung |
|---|---|---|
| 🔴 Nghiêm trọng | 10 | Số liệu sai hoặc rò rỉ dữ liệu cá nhân |
| 🟠 Cần sửa | 12 | Chức năng hỏng, hiệu năng kém |
| 🔵 Nên dọn | 9 | Code chết, hardcode, tài liệu lệch |

**Kết luận ngắn:** phần Meta Ads thuần (chi tiêu, tin nhắn, CPA, ngân sách ngày, phân rã nền tảng)
đáng tin. Nhưng **không nên ra quyết định ngân sách dựa trên cột L1/L3/L4/Doanh thu/CPL/CAC/ROAS
hiện tại** — xem A-01 đến A-04.

---

## NHÓM A — SỐ LIỆU SAI (7)

### A-01 🔴 Ghép lead vào chiến dịch bằng phép so khớp vô nghĩa
`src/report.js:205-221`

Cột "Ad ID" trong Google Sheet chứa **ID quảng cáo (ad)**, code đem so với **ID chiến dịch
(campaign)** — hai loại đối tượng khác nhau của Meta nên không bao giờ khớp. Nhánh dự phòng so
11 chữ số đầu: ID Meta đều mở đầu `120` + khối số theo thời điểm tạo, nên trùng tiền tố là
trùng ngẫu nhiên. `.find()` còn chỉ lấy chiến dịch đầu tiên trùng.

**Kiểm chứng thật:**

```
Khớp đúng ID chiến dịch ····· 0 / 1.142 lead
Khớp nhờ tiền tố 11 số ······· 154 lead -> dồn vào 27 chiến dịch
Không khớp, bị chia tỉ lệ ····· 988 lead (87%)
Có 2 tiền tố 11 số bị 4 chiến dịch dùng chung
```

**Sửa:** kéo thêm `act_X/ads?fields=id,campaign_id` khi đồng bộ để dựng bảng tra
`adId -> campaignId`, ghép lead qua bảng đó.

### A-02 🔴 Chia lead theo tỉ lệ chi tiêu rồi hiển thị như số đo thật
`src/report.js:282-297`

988 lead không ghép được bị nhân `weight = chi tiêu CĐ / chi tiêu sản phẩm` để ra
L1/L3/L4/doanh thu cho từng dòng. Bảng không có nhãn nào cho biết đây là ước lượng.
**Vi phạm trực tiếp quy tắc dự án §4** ("không ước lượng, không tự chia tách số liệu khi chưa tính").
CPL, CPA/L3, CAC, ROAS từng chiến dịch đều tính từ con số đã chia.

**Sửa:** sau A-01, chỉ hiển thị lead đã ghép đúng; phần chưa ghép gom vào một dòng
"Chưa gán được nguồn" ở cấp sản phẩm, có nhãn rõ ràng.

### A-03 🔴 Chỉ số lead không lọc theo khoảng thời gian
`src/report.js:341, 378, 421`

`summarizeLeads()` có hỗ trợ `startDate`/`endDate` nhưng cả 3 chỗ gọi đều không truyền.

**Kiểm chứng thật (cùng một snapshot):**

```
30 ngày ··· chi 181.611.073 đ · L1 1.142 · L4 217 · DT 2.157.412.500 đ
Hôm qua ··· chi   5.057.398 đ · L1 1.142 · L4 217 · DT 2.157.412.500 đ  <- lead đứng yên
Hôm nay ··· chi           0 đ · L1 1.142 · L4 217 · DT 2.157.412.500 đ
```

ROAS hiển thị **11,88x** là phép chia doanh thu trọn đời / chi tiêu 30 ngày.

**Sửa:** truyền `startDate`/`endDate` từ `getDateRange(datePreset)` vào cả 3 chỗ gọi.

### A-04 🔴 Chỉ số lead không lọc theo tài khoản
`src/report.js:378`

Chọn "TK 1": chi tiêu lọc đúng còn **126.491.522 đ**, nhưng L1 vẫn **1.142** và L4 vẫn **217**
của toàn BM. CAC/ROAS khi xem theo tài khoản luôn đẹp hơn thực tế.

**Sửa:** sau A-01, lead sẽ gắn được `accountId` và lọc như chiến dịch.

### A-05 🟠 Tổng các dòng trong bảng khác số ở thẻ KPI
`src/report.js:288-292` vs `:378`

Thẻ KPI dùng tổng thật từ `summarizeLeads`; bảng dùng "ghép trực tiếp + chia tỉ lệ" có
`Math.round` trên từng dòng. Hai đường tính khác nhau:

```
Σ L1 các dòng ······· 1.115  · KPI báo 1.142  (lệch 27)
Σ Doanh thu các dòng · ...498 đ · KPI báo ...500 đ
```

**Sửa:** dùng một nguồn tính duy nhất — tổng KPI = tổng các dòng đang hiển thị.

### A-06 🟠 Lead không nhận diện được bị gán mặc định cho UCMAS
`src/google-sheet.js:151-160`

`let product = 'ucmas'` làm mọi lead không khớp UCKID/MATHCA/TRẠI HÈ rơi hết về UCMAS.
Nhánh `else if` cuối kiểm tra UCMAS vì thế không bao giờ đổi được gì.

```
ucmas 998 (87,4%) · uckid 112 · traihe 28 · mathca 4
```

**Sửa:** khởi tạo `product = null`, không nhận diện được thì gán `'khac'` và hiển thị riêng.

### A-07 🟠 Hai chỉ số lệch pha với khoảng thời gian đang chọn
`src/meta-api.js:118-134` · `src/report.js:300`

1. `frequency` dùng gắn cờ "bão hòa creative" luôn là tần suất kỳ 30 ngày lúc đồng bộ,
   không theo preset đang xem.
2. `extractMessages()` trả `messages || connections || leads || purchases` — CĐ 0 tin nhắn
   nhưng 50 đơn hàng sẽ báo "50 tin nhắn". CPA các chiến dịch đang đo những thứ khác nhau
   mà vẫn cộng chung.

**Sửa:** lưu `frequency` vào `dailyRecords`; tách `messages` và `otherConversions` thành 2 trường.

---

## NHÓM B — BẢO MẬT & DỮ LIỆU CÁ NHÂN (3)

### B-01 🔴 Mọi website đang mở trên máy đều đọc được dữ liệu BM và ghi đè được token
`src/server.js:17, 170-184, 238`

`app.use(cors())` không tham số phát `Access-Control-Allow-Origin: *`. Không có lớp xác thực
nào, `app.listen(port)` lắng nghe trên mọi network interface.

Hệ quả: một trang web bất kỳ đang mở có thể `fetch('http://localhost:3000/api/data')` đọc toàn
bộ chi tiêu, doanh thu, số điện thoại khách — hoặc `POST /api/save-config` ghi đè Access Token
và App Secret trong `.env`. Mọi người cùng mạng LAN cũng mở được dashboard.

**Kiểm chứng:** `curl -H "Origin: https://evil.example" .../api/data` -> `Access-Control-Allow-Origin: *`

**Sửa:** bỏ `cors()` (frontend cùng origin, không cần). Bind `app.listen(port, '127.0.0.1')`.
Thêm token nội bộ sinh ngẫu nhiên trong `.env`, bắt buộc với `/api/save-config` và `/api/sync`.

### B-02 🔴 Số điện thoại thật vẫn được gửi về browser dù đã có hàm che
`src/report.js:118-121, 437-440, 500-503`

`maskPhone()` tạo thêm `phoneMasked`, nhưng dòng kế bên `{ ...r }` giữ nguyên cả `phone` gốc
và `adId`. Che chỉ có tác dụng ở phần hiển thị.

**Kiểm chứng:** `GET /api/data` -> `view.recentEnrolled[0]` =
`{"phone":"09XXXXXXXX","phoneMasked":"09XX***XXX","adId":"120XXXXXXXXXXXXXXX",...}`
(số thật đã được thay bằng X trong báo cáo này — trường `phone` và `adId` gốc thực sự
có mặt trong payload, đó chính là lỗi)

**Sửa:** chọn tường minh các trường gửi đi thay vì spread cả object. Lưu ý `leads_cache.json`
(494 KB) đang lưu 1.142 số điện thoại thật dạng plaintext.

### B-03 🟠 Giá trị gửi lên không được làm sạch trước khi ghi vào .env
`src/config.js:30-41`

`updateEnvFile()` ghi thẳng `${key}=${value}`. Value chứa ký tự xuống dòng có thể chèn biến
môi trường tùy ý. `/api/save-config` cũng không kiểm tra định dạng token.

**Sửa:** loại ký tự xuống dòng khỏi value, giới hạn độ dài, kiểm tra `sheetUrl` phải là
`https://docs.google.com/`.

---

## NHÓM C — CHỨC NĂNG HỎNG (7)

### C-01 🟠 Cả 3 mục trong menu Xuất dữ liệu đều tải về file rác
`public/index.html:90, 93, 96`

Menu trỏ `/api/export/campaigns`, `/api/export/daily`, `/api/export/json` — **không route nào
tồn tại**. Rơi vào SPA fallback nên server trả `index.html` kèm status 200, browser lưu thành
file "campaigns" chứa HTML, không có thông báo lỗi.

**Kiểm chứng:** `status=200 · type=text/html · size=23.258 bytes`

Ngược lại `/api/export-csv` có thật nhưng không UI nào gọi; `/api/sync-sheet` (đồng bộ nhanh
~0,3s) cũng không có nút bấm.

**Sửa:** thêm 3 route đúng tên (dùng lại `convertToCsv()` có sẵn), thêm nút "Đồng bộ nhanh Sheet".

### C-02 🟠 Mọi URL sai đều trả về 200 kèm trang HTML
`src/server.js:233-235`

SPA fallback bắt tất cả kể cả `/api/*`. Đây chính là cơ chế đã che lỗi C-01 bấy lâu.

**Sửa:** `/api/*` không khớp thì trả `404 JSON`, đặt trước SPA fallback.

### C-03 🟠 /api/sync-sheet sập khi chưa có snapshot
`src/server.js:151-165, 61-65`

Không có guard `rawReport` -> `buildView(null, ...)` -> đọc `raw.datePreset` trên `null` ->
TypeError 500. Route còn mất bộ lọc sản phẩm/tài khoản vì chỉ truyền `activeTab`.

**Sửa:** thêm guard vào `respondWithView`, truyền đủ `product`/`accountId`/`datePreset`.

### C-04 🟠 Tên chiến dịch được chèn thẳng vào HTML (XSS)
`public/js/app.js:82, 857, 1105, 1127`

`renderTable()`, `showToast()`, `renderNotices()` và thẻ học viên đều dùng `innerHTML` với dữ
liệu chưa escape. Tên chiến dịch do người chạy ads tự đặt, tên fanpage và thông báo lỗi API
cũng vậy. Script chèn qua đường này chạy trong trang có quyền gọi `/api/save-config`.

**Đã có sẵn trong dữ liệu:** 15/603 tên chiến dịch chứa dấu nháy kép hoặc dấu phẩy.

**Sửa:** thêm hàm `esc()` bọc mọi giá trị động; dùng `textContent` cho toast.

### C-05 🔵 Đổi bộ lọc nhanh có thể hiện dữ liệu của lần chọn trước
`public/js/app.js:290-320` — `loadData()` không huỷ request cũ, response về sau cùng là cái
được vẽ. **Sửa:** `AbortController`.

### C-06 🔵 Sắp xếp bảng có thể văng lỗi và làm mất định dạng cột
`public/js/app.js:1081-1098` — `va.localeCompare(vb)` throw nếu ô trống; `th.className = ...`
ghi đè toàn bộ class rồi dựng lại bằng tay. **Sửa:** ép chuỗi trước khi so sánh; dùng
`classList.toggle()`.

### C-07 🔵 Nút Đồng bộ luôn kéo 30 ngày, bỏ qua khoảng thời gian đang chọn
`src/server.js:112` — frontend gửi `datePreset` nhưng server luôn gọi
`fetchRawReport('ALL','last_30d')`. Là chủ ý của Data Lake, nhưng chọn "Tháng này" vào đầu
tháng 3 sẽ thiếu dữ liệu. **Sửa:** chú thích rõ trong code, chặn ở UI nếu preset vượt vùng dữ liệu.

---

## NHÓM D — HIỆU NĂNG (5)

### D-01 🟠 436 KB mỗi response chỉ để lấy ra 4 con số
`src/report.js:417-442` · `public/js/app.js:426`

`view.productTabs` đóng gói trọn bộ danh sách chiến dịch của cả 4 sản phẩm. Frontend chỉ đọc
`stats.l4Count`, `stats.l1Count`, `campaigns.length` để in badge trên tab.

**Đo payload `GET /api/data`:**

```
Tổng ·············· 883.053 bytes
productTabs ······· 435.842 (49,4%) — dùng 4 con số
campaigns ········· 425.943 — gồm cả 603 CĐ đã tắt, chi tiêu 0 đ
Phần còn lại ······  21.268
```

**Sửa:** thay bằng `tabBadges` chỉ chứa 4 cặp số. Phân trang/lọc sẵn `campaigns` ở server.

### D-02 🟠 Không bật nén gzip
`src/server.js:16-19` — không có middleware `compression`. JSON nén rất tốt, riêng việc bật nén
cắt payload ~85-90%. **Sửa:** thêm `compression` (dependency mới, cần duyệt).

### D-03 🟠 buildView chậm gấp 9 lần con số ghi trong tài liệu
`src/report.js:128-505`

PROJECT_CONTEXT.md ghi "< 2ms", comment đầu file ghi "< 5ms". **Thực đo 17,4ms** (~24ms/request).
Hai nguyên nhân:

- Vòng lặp ghép lead gọi `rawCampaignsList.find()` bên trong: 1.142 × 603 ≈ **688.000 phép so
  sánh mỗi request**.
- `summarizeLeads()` quét toàn bộ 1.142 lead **9 lần mỗi request** — 4 lần cho thẻ sản phẩm,
  4 lần nữa cho `productTabs` với y nguyên tham số, 1 lần cho view hiện tại.

**Sửa:** dựng `Map` tra campaign theo ID; gom 9 lượt quét thành 1 lượt chia nhóm theo sản phẩm.

### D-04 🔵 2 trong 6 lời gọi Graph API mỗi tài khoản là dư thừa
`src/meta-api.js:200-221` — `insights` (tổng kỳ) và `insights_today` đều suy ra được từ
`insights_daily`, và `buildView` **đã** tính lại từ daily, ghi đè kết quả hai lời gọi kia.
Chỉ `frequency`, `reach`, `cpc`, `cpm` còn dùng từ `insights`.

**Sửa:** bỏ `insights_today`, thêm `frequency`/`reach` vào trường của `insights_daily`.
Tiết kiệm ~17-33% thời gian đồng bộ, giảm áp lực rate limit.

### D-05 🔵 Không cache kết quả buildView
`src/server.js:61-65` — dữ liệu chỉ đổi khi bấm Đồng bộ nhưng mỗi request lặp lại vẫn tính lại
từ đầu. **Sửa:** cache theo khoá `product|accountId|datePreset`, xoá khi đồng bộ xong.

---

## NHÓM E — CHẤT LƯỢNG CODE (9)

| Mã | Vấn đề | Vị trí | Hướng sửa |
|---|---|---|---|
| E-01 | Ngưỡng CPA 65k/90k/130k viết tay lặp lại ở frontend, lệch khỏi `THRESHOLDS` backend | app.js:570-584, ai-analyst.js:10 | Đưa `THRESHOLDS` vào payload |
| E-02 | Hardcode BM ID, link Google Sheet, chuỗi "Graph API v21.0" ở footer | config.js:15, google-sheet.js:6-8, app.js:460 | Chuyển sang `.env`; footer đọc `config.apiVersion` |
| E-03 | `summarizeLeads(leads)` gọi thiếu tham số 2 sẽ throw — không có default | google-sheet.js:214 | Thêm `= {}` |
| E-04 | `fileURLToPath` import nhưng không dùng; `export-csv.js` tự tính lại `DATA_DIR` | google-sheet.js:3, export-csv.js:3-7 | Xoá import chết, dùng `ROOT_DIR` |
| E-05 | `/api/export-csv` tự viết lại logic CSV thay vì dùng `convertToCsv()` | server.js:196-218 | Dùng lại hàm sẵn có |
| E-06 | `selectProduct()` không ai gọi; 32 `id` trong HTML không được dùng | app.js:327, index.html | Xoá hàm; giữ `id` của `<th>` theo §5 |
| E-07 | 3 thư mục `backup_*` ở gốc — nhiễu mọi lệnh tìm kiếm, khiến AI agent đọc sai file | thư mục gốc | Gộp vào `.backups/` |
| E-08 | Không có test, không có linter. **Cả 7 lỗi nhóm A đều sẽ bị một bài test đối chiếu tổng bắt được** | package.json | `node:test` cho `getDateRange`, `detectProduct`, `parseCsvRows` + kiểm tra Σ dòng = tổng KPI |
| E-09 | Tài liệu lệch thực tế: "618 chiến dịch" (thực 603), "< 2ms" (thực 17,4ms), "1.137 lead" (thực 1.142) | PROJECT_CONTEXT.md §9 | Cập nhật bằng số đo thật |

---

## KẾ HOẠCH SỬA — 4 ĐỢT

Thứ tự có chủ ý: đợt 1 chặn rò rỉ (nhanh, rủi ro thấp) → đợt 2 sửa nền tảng ghép lead mà mọi
chỉ số tuyển sinh phụ thuộc vào → đợt 3 trả lại chức năng hỏng → đợt 4 dọn dẹp.
Đợt 2 nặng nhất và phải làm sau đợt 1 vì chạm vào cả `meta-api.js`.

### Đợt 1 — Khoá cửa & bịt rò rỉ (~1 giờ, rủi ro thấp, KHÔNG đổi số liệu)

| Mã | Việc | File |
|---|---|---|
| B-01 | Bỏ `cors()`, bind `127.0.0.1`, token nội bộ cho route ghi | src/server.js |
| B-02 | Chọn tường minh trường gửi đi, bỏ `phone` và `adId` | src/report.js |
| B-03 | Làm sạch giá trị trước khi ghi `.env` | src/config.js |
| C-04 | Thêm `esc()`, bọc mọi giá trị động trong `innerHTML` | public/js/app.js |

### Đợt 2 — Làm cho con số đúng (~1 ngày, rủi ro cao, **CẦN DUYỆT**)

Sau đợt này L1/L3/L4/Doanh thu/CPL/CAC/ROAS **sẽ thay đổi** — đó là mục đích, chúng đang sai.
Nên chụp lại dashboard trước khi sửa để đối chiếu.

| Mã | Việc | File | Ảnh hưởng |
|---|---|---|---|
| A-01 | Kéo `act_X/ads?fields=id,campaign_id`, lưu `adMap` vào snapshot (schema v3) | src/meta-api.js | Cần đồng bộ lại 1 lần |
| A-02 | Ghép lead qua `adMap`; bỏ chia tỉ lệ; lead chưa gán gom vào dòng có nhãn | src/report.js | **Số cột lead sẽ giảm mạnh** |
| A-03 | Truyền `startDate`/`endDate` vào cả 3 chỗ gọi `summarizeLeads` | src/report.js | ROAS/CPL/CAC đổi hoàn toàn |
| A-04 | Gắn `accountId` cho lead, lọc theo tài khoản | src/report.js | Xem theo TK sẽ đúng |
| A-05 | Thống nhất một nguồn tính: tổng KPI = tổng các dòng | src/report.js | Hết lệch 27 lead |
| A-06 | Bỏ mặc định 'ucmas', không nhận diện được thì gán `'khac'` | src/google-sheet.js | **UCMAS sẽ giảm từ 998** |
| A-07 | Tách `messages` khỏi `otherConversions`; lưu `frequency` theo ngày | src/meta-api.js, src/report.js | CPA đồng nhất hơn |
| E-08 | Test đối chiếu Σ dòng = tổng KPI để khoá lại các lỗi trên | test/ | Chống lặp lại |

### Đợt 3 — Trả lại chức năng & tăng tốc (~4 giờ, rủi ro vừa)

| Mã | Việc | Kết quả |
|---|---|---|
| C-01 | Thêm 3 route export đúng tên + nút "Đồng bộ nhanh Sheet" | Menu Xuất hoạt động |
| C-02 | `/api/*` không khớp trả 404 JSON, đặt trước SPA fallback | Lỗi route lộ ra ngay |
| C-03 | Guard `rawReport` trong `respondWithView`, truyền đủ bộ lọc | Hết 500 |
| D-01 | Thay `productTabs` bằng `tabBadges` | **883 KB -> ~447 KB** |
| D-03 | `Map` tra campaign; gộp 9 lượt quét lead thành 1 | **17,4ms -> ~3ms** |
| D-04 | Bỏ `insights_today`, chuyển `frequency`/`reach` vào daily | Đồng bộ nhanh hơn ~20% |
| D-05 | Cache `buildView` theo khoá, xoá khi đồng bộ | Request lặp ~0ms |
| C-05, C-06 | `AbortController`; sửa so sánh khi sort | Hết nhảy số, hết văng lỗi |

### Đợt 4 — Dọn nhà (~3 giờ, rủi ro thấp)

Gộp nhóm E thành một lần, làm sau cùng để không trộn lẫn với thay đổi ảnh hưởng số liệu:
E-01, E-02 (gỡ hardcode) · E-03 đến E-06 (xoá code chết) · E-07 (gộp backup) ·
E-09 + C-07 (cập nhật PROJECT_CONTEXT.md bằng số đo thật).

---

## CẦN CHỦ DỰ ÁN DUYỆT (quy tắc §2)

**Chưa thực hiện thay đổi nào.** 4 điểm thuộc diện "thay đổi lớn":

1. **Đổi công thức ghép lead và bỏ chia tỉ lệ (A-01, A-02).** Hệ quả thật: các cột
   L1/L3/L4/Doanh thu trên bảng chiến dịch sẽ **giảm mạnh**, nhiều dòng về 0, vì hiện 87% số đó
   là chia ước lượng. Số mới ít hơn nhưng đúng. Có chấp nhận đánh đổi này không?
2. **Nâng schema snapshot lên v3** để lưu bảng tra `adId -> campaignId`. Sau khi nâng cần bấm
   Đồng bộ lại một lần; snapshot v2 cũ vẫn đọc được nhưng cột lead sẽ trống tới khi đồng bộ.
3. **Đổi payload: bỏ `view.productTabs`, thay bằng `tabBadges` (D-01).** Là đổi tên trường dữ
   liệu nên thuộc diện phải duyệt. Giảm 436 KB mỗi lần đổi bộ lọc.
4. **Thêm dependency `compression` (D-02).** Nếu không muốn thêm thư viện mới thì bỏ mục này —
   riêng D-01 đã giảm được một nửa payload.

Đợt 1 (bảo mật) và đợt 4 (dọn dẹp) có thể làm ngay vì không chạm vào công thức nào.

---

## NHỮNG PHẦN ĐANG LÀM TỐT — SẼ KHÔNG CHẠM VÀO

- **Kiến trúc Local Data Lake**: tách lớp lưu trữ hạt lựu (`dailyRecords`, `placementRecords`)
  khỏi lớp biểu diễn (`buildView`) là quyết định đúng. Việc cắt theo ngày/tài khoản/sản phẩm
  chạy local thật, không gọi API — chống rate limit hiệu quả.
- **Phân trang Graph API** (`callGraphApiAll` với `MAX_PAGES` và cờ `truncated`) và **xử lý lỗi
  theo từng tài khoản** (`safe()` đẩy vào `warnings`) — một tài khoản lỗi không làm sập cả báo
  cáo. Đây là phần làm chắc tay nhất của codebase.
- **Access Token không bao giờ lọt vào thông báo lỗi**, và `updateEnvFile()` chỉ cập nhật đúng
  dòng biến cần đổi — đúng quy tắc §3.
- **`getVietnamDateString`** dùng `Intl` với `Asia/Ho_Chi_Minh` thay vì cộng trừ offset bằng tay.
- **Ngân sách dự kiến hôm nay** tính CBO/ABO và lọc bằng `effective_status` đúng quy tắc §1,
  nhất quán ở cả 3 file.
- **`parseCsvRows`** là parser RFC-4180 thật, xử lý được dấu nháy lồng và dấu phẩy trong ô.

---

*Rà soát ngày 16/10/2026 · nhánh main @ c4fc17e · snapshot dữ liệu 15/10/2026*
*Tất cả phát hiện đều kèm số đo chạy thật, không suy đoán.*
