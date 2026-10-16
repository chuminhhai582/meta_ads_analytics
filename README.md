# Ucmas Ads Analytics — Hệ thống Phân tích & Tối ưu Meta Ads

Hệ thống quản lý, trích xuất dữ liệu và phân tích quảng cáo Meta (Facebook & Instagram Ads) chuyên sâu dành riêng cho **BM Ucmas Việt Nam (`2590933284556026`)**, tích hợp **Model Context Protocol (MCP)**, **Meta Marketing API v21.0** và **AI Analytics Dashboard** tối ưu cho mô hình chuyển đổi tin nhắn giáo dục.

> 📖 **Dành cho Developer / AI Agents:** Đọc kỹ [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) và tuân thủ quy tắc bắt buộc tại [`.agents/rules/quy-tac-du-an.md`](./.agents/rules/quy-tac-du-an.md).

---

## 🌟 Tính Năng Nổi Bật

1. **Kết Nối Meta Marketing API Với Phân Trang Toàn Diện (`src/meta-api.js`)**:
   - Tự động duyệt hết `paging.next` trên tất cả 10 tài khoản thuộc BM `2590933284556026`.
   - Quét đồng thời toàn bộ ~600 chiến dịch, nhóm quảng cáo, quảng cáo và chỉ số hiệu quả thực tế trong ~10 giây.
   - Không có dữ liệu giả lập/demo — 100% số liệu được lấy trực tiếp từ Graph API.

2. **Phân Tích 2 Chiều: Theo Tài Khoản & 4 Sản Phẩm Trọng Điểm**:
   - Nhận diện sản phẩm tự động theo quy tắc text giữa 2 dấu `/` trong tên chiến dịch:
     - 🔵 **UCMAS** (`/ucmas/`): Toán tư duy não bộ
     - 🟣 **UCKID** (`/uckid/`): Tiền tiểu học & Mầm non
     - 🟠 **MATHCA** (`/mathca/`): Toán trải nghiệm
     - 🟢 **TRẠI HÈ** (`/traihe/` hoặc `/trại hè/`): Summer Camp trải nghiệm
   - Lọc sản phẩm tức thì không cần gọi lại Meta API, đồng bộ thẻ sản phẩm, biểu đồ và bảng dữ liệu.

3. **Quản Lý Ngân Sách Ngày Dự Kiến & Tiến Độ Giải Ngân (CBO + ABO)**:
   - Tự động tính toán chuẩn xác cho cả CBO (`campaign.daily_budget`) và ABO (tổng `adset.daily_budget` của các nhóm có `effective_status === 'ACTIVE'`).
   - Theo dõi chi tiêu thực tế hôm nay so với kế hoạch ngày với thanh tiến độ pacing trực quan.

4. **Động Cơ AI Chẩn Đoán & Chấm Điểm (Rule-based Performance)**:
   - Điểm sức khỏe tài khoản (0 - 100).
   - Tự động phát hiện chiến dịch hiệu quả cao cần scale ngân sách an toàn.
   - Cảnh báo chiến dịch chi tiêu cao nhưng không ra tin nhắn hoặc CPA quá đắt.
   - Cảnh báo bão hòa Creative khi tần suất hiển thị (Frequency) ≥ 3.0 — chỉ khi kỳ đang xem trùng kỳ đồng bộ.

5. **Trực Quan Hóa Biểu Đồ & Xuất Báo Cáo**:
   - Biểu đồ xu hướng hàng ngày kết hợp Chi tiêu và Số tin nhắn (di chuột xem CPA).
   - Phễu chuyển đổi 3 tầng thực tế: Hiển thị ➔ Lượt click ➔ Tin nhắn.
   - Phân bổ chi tiêu thật theo nền tảng (`publisher_platform`: Facebook, Instagram, Messenger...).
   - Xuất dữ liệu ra **CSV UTF-8 BOM** tương thích hoàn hảo với Microsoft Excel và **JSON snapshot**.

---

## 📁 Cấu Trúc Dự Án

```text
Local_phantich_ads/
├── .agents/
│   ├── rules/
│   │   └── quy-tac-du-an.md        # Quy tắc bắt buộc cho AI agent (always_on)
│   └── plugins/meta-ads/           # Tích hợp MCP Server Meta Ads cho Antigravity
│       ├── plugin.json
│       ├── mcp_config.json
│       └── skills/meta-ads/SKILL.md
├── data/                           # Dữ liệu xuất ra (JSON & CSV)
│   ├── latest_insights.json        # Snapshot raw report v3 (có adMap)
│   ├── leads_cache.json            # Cache lead CRM từ Google Sheet
│   ├── campaigns.csv               # Báo cáo chiến dịch (Excel UTF-8 BOM)
│   └── daily_performance.csv       # Báo cáo theo ngày
├── public/                         # Giao diện Web Dashboard
│   ├── index.html                  # Layout dashboard
│   ├── css/style.css               # Hệ thống design system Dark Glassmorphism
│   └── js/app.js                   # Logic ứng dụng client & Chart.js
├── src/
│   ├── config.js                   # Quản lý .env, validate đầu vào, token phiên
│   ├── meta-api.js                 # Client Graph API với phân trang toàn diện
│   ├── google-sheet.js             # Kéo & chuẩn hoá lead CRM từ Google Sheet
│   ├── report.js                   # View builder tổng hợp chỉ số 4 sản phẩm
│   ├── ai-analyst.js               # Động cơ chẩn đoán & chấm điểm AI
│   ├── export-csv.js               # Module trích xuất file CSV UTF-8
│   └── server.js                   # Máy chủ Express nội bộ (chỉ loopback)
├── launch.js                       # Khởi động server + mở trình duyệt (shortcut gọi file này)
├── Mo-Dashboard.cmd                # Đích của shortcut ngoài Desktop
├── assets/dashboard.ico            # Icon cho shortcut (sinh bởi tools/make-icon.js)
├── tools/
│   ├── make-icon.js                # Sinh file .ico, không cần thư viện ngoài
│   └── make-shortcut.ps1           # Tạo lại shortcut ngoài Desktop
├── test/report.test.js             # 32 test khoá lại các chỉ số quan trọng
├── .env                            # Token & App secret (bảo mật, không commit)
├── .env.example                    # File mẫu biến môi trường
├── .backups/                       # Các bản sao lưu cũ (không commit)
├── mcp-launcher.js                 # Khởi chạy Meta Ads MCP Server
├── package.json
├── HUONG_DAN_LAY_TOKEN_META.md     # Cẩm nang lấy token Meta trong 2 phút
├── HUONG_DAN_LAY_TOKEN_TU_N8N.md   # Lấy lại token Meta có sẵn trong n8n (cPanel)
├── PROJECT_CONTEXT.md              # Bối cảnh & tài liệu kiến trúc toàn diện
├── BAO_CAO_RA_SOAT_2026-10-16.md   # Báo cáo rà soát & 31 phát hiện đã sửa
└── README.md
```

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh

### 1. Khởi động Web Dashboard

**Cách thường dùng — double-click shortcut `Ucmas Ads Analytics` ngoài Desktop.**
Nó tự khởi động server, chờ sẵn sàng rồi mở trình duyệt. Bấm lần nữa khi dashboard
đang chạy thì chỉ mở lại tab, không khởi động trùng. **Đóng cửa sổ console đen là tắt
dashboard.**

Chưa có shortcut (máy mới, hoặc vừa di chuyển thư mục dự án):
```bash
npm run shortcut
```

Hoặc chạy bằng terminal:
```bash
npm run launch
```
Truy cập trình duyệt tại: **`http://localhost:3000`**

> `npm start` cũng chạy được, nhưng chỉ bật server — không tự mở trình duyệt và
> không kiểm tra cổng có đang bị chiếm hay không.

### 2. Cấu hình Access Token

- Bấm nút **Cài đặt Token** (biểu tượng chìa khóa ở góc trên bên phải trang web).
- Dán Access Token của bạn rồi bấm **Lưu & Đồng bộ**.
- Hoặc chỉnh sửa trực tiếp biến `META_ADS_ACCESS_TOKEN` trong file `.env`.

*(Xem chi tiết cách lấy token tại: [`HUONG_DAN_LAY_TOKEN_META.md`](./HUONG_DAN_LAY_TOKEN_META.md))*

### 3. Đồng bộ dữ liệu & Xuất file

- Bấm nút **Đồng bộ** để kéo số liệu mới nhất từ Meta **và** lead từ Google Sheet (~10 giây).
- Bấm nút **bảng** cạnh đó để chỉ làm mới lead từ Google Sheet (~0,3 giây, không gọi Meta API).
- Menu **tải xuống** xuất CSV chiến dịch, CSV theo ngày hoặc JSON dữ liệu đã lọc.
- Hoặc từ Terminal: chạy `npm run fetch` để tự động kéo dữ liệu và xuất file ra thư mục `data/`.

### 4. Kiểm thử

```bash
npm test
```
32 test khoá lại các chỉ số dễ sai nhất: ghép lead vào chiến dịch, lọc theo kỳ và theo
tài khoản, bất biến `Σ các dòng + chưa gán = tổng KPI`, và việc không gửi số điện thoại
thật về browser. **Chạy trước khi commit mọi thay đổi trong `src/report.js`.**

## 🔒 Về bảo mật

Dashboard hiển thị chi tiêu, doanh thu và số điện thoại phụ huynh, nên:

- Server **chỉ nhận kết nối từ chính máy cài đặt**. Máy khác trong mạng LAN nhận 403.
  Muốn mở ra LAN có chủ ý: đặt `ALLOW_REMOTE=true` trong `.env`.
- **Không gửi header CORS** — website khác bạn đang mở không đọc được dữ liệu BM.
- Các thao tác ghi (lưu token, đồng bộ) yêu cầu token phiên nội bộ, chống việc một trang
  web lạ âm thầm ghi đè Access Token.
- Payload trả về browser chỉ chứa **số điện thoại đã che** (ví dụ `0912***345`), không có số gốc.
- Bấm nút **Xuất dữ liệu** để tải file CSV mở trong Excel hoặc file JSON.
