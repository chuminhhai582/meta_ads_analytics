# Ucmas Ads Analytics — Hệ thống Phân tích & Tối ưu Meta Ads

Hệ thống quản lý, trích xuất dữ liệu và phân tích quảng cáo Meta (Facebook & Instagram Ads) chuyên sâu dành riêng cho **BM Ucmas Việt Nam (`2590933284556026`)**, tích hợp **Model Context Protocol (MCP)**, **Meta Marketing API v21.0** và **AI Analytics Dashboard** tối ưu cho mô hình chuyển đổi tin nhắn giáo dục.

> 📖 **Dành cho Developer / AI Agents:** Đọc kỹ [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) và tuân thủ quy tắc bắt buộc tại [`.agents/rules/quy-tac-du-an.md`](./.agents/rules/quy-tac-du-an.md).

---

## 🌟 Tính Năng Nổi Bật

1. **Kết Nối Meta Marketing API Với Phân Trang Toàn Diện (`src/meta-api.js`)**:
   - Tự động duyệt hết `paging.next` trên tất cả 10 tài khoản thuộc BM `2590933284556026`.
   - Quét đồng thời toàn bộ 618+ chiến dịch, nhóm quảng cáo và chỉ số hiệu quả thực tế chỉ trong ~9.6 giây.
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
   - Cảnh báo bão hòa Creative khi tần suất hiển thị (Frequency) ≥ 3.0.

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
├── backup_2026-10-15/              # Bản sao lưu an toàn
├── data/                           # Dữ liệu xuất ra (JSON & CSV)
│   ├── latest_insights.json        # Snapshot raw report v2
│   ├── campaigns.csv               # Báo cáo chiến dịch (Excel UTF-8 BOM)
│   └── daily_performance.csv       # Báo cáo theo ngày
├── public/                         # Giao diện Web Dashboard
│   ├── index.html                  # Layout dashboard
│   ├── css/style.css               # Hệ thống design system Dark Glassmorphism
│   └── js/app.js                   # Logic ứng dụng client & Chart.js
├── src/
│   ├── config.js                   # Quản lý .env và cập nhật an toàn
│   ├── meta-api.js                 # Client Graph API với phân trang toàn diện
│   ├── report.js                   # View builder tổng hợp chỉ số 4 sản phẩm
│   ├── ai-analyst.js               # Động cơ chẩn đoán & chấm điểm AI
│   ├── export-csv.js               # Module trích xuất file CSV UTF-8
│   └── server.js                   # Máy chủ Express nội bộ
├── .env                            # Token & App secret (bảo mật, không commit)
├── .env.example                    # File mẫu biến môi trường
├── mcp-launcher.js                 # Khởi chạy Meta Ads MCP Server
├── package.json
├── HUONG_DAN_LAY_TOKEN_META.md     # Cẩm nang lấy token Meta trong 2 phút
├── PROJECT_CONTEXT.md              # Bối cảnh & tài liệu kiến trúc toàn diện
└── README.md
```

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh

### 1. Khởi động Web Dashboard

Mở terminal tại thư mục này và chạy:
```bash
npm start
```
Truy cập trình duyệt tại: **`http://localhost:3000`**

### 2. Cấu hình Access Token

- Bấm nút **Cài đặt Token** (biểu tượng chìa khóa ở góc trên bên phải trang web).
- Dán Access Token của bạn rồi bấm **Lưu & Đồng bộ**.
- Hoặc chỉnh sửa trực tiếp biến `META_ADS_ACCESS_TOKEN` trong file `.env`.

*(Xem chi tiết cách lấy token tại: [`HUONG_DAN_LAY_TOKEN_META.md`](./HUONG_DAN_LAY_TOKEN_META.md))*

### 3. Đồng bộ dữ liệu & Xuất file

- Bấm nút **Đồng bộ** trên thanh điều khiển web để kéo số liệu mới nhất từ Meta.
- Hoặc từ Terminal: chạy `npm run fetch` để tự động kéo dữ liệu và xuất file ra thư mục `data/`.
- Bấm nút **Xuất dữ liệu** để tải file CSV mở trong Excel hoặc file JSON.
