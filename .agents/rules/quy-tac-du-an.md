---
trigger: always_on
description: Quy tắc bắt buộc cho mọi AI/Developer khi làm việc trong dự án Meta Ads Analytics (BM Ucmas Việt Nam).
---

# QUY TẮC BẮT BUỘC — Dự án Meta Ads Analytics (BM Ucmas Việt Nam)

> Áp dụng cho **mọi AI agent và developer**. Vi phạm các quy tắc dưới đây được coi là làm sai yêu cầu của chủ dự án.

## 0. Việc đầu tiên khi bắt đầu một phiên làm việc

1. **Đọc [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md)** ở thư mục gốc để nắm mục tiêu, ràng buộc nghiệp vụ, kiến trúc và Known Issues.
2. Đọc code liên quan **trước khi** đề xuất sửa. Không đoán cấu trúc dữ liệu — kiểm tra trong `src/meta-api.js` hoặc `data/latest_insights.json`.
3. Giao tiếp với chủ dự án bằng **tiếng Việt**.

## 1. Ràng buộc nghiệp vụ KHÔNG ĐƯỢC THAY ĐỔI nếu chưa được chủ dự án cho phép

- Chỉ lấy dữ liệu từ **BM `2590933284556026`** (Ucmas Việt Nam).
- Chỉ hiển thị & phân tích **4 sản phẩm: UCMAS, UCKID, MATHCA, TRẠI HÈ**.
- Nhận diện sản phẩm = đoạn text **giữa dấu `/` thứ 1 và thứ 2** của tên chiến dịch.
- Ngân sách dự kiến hôm nay = CBO `campaign.daily_budget`, hoặc tổng `adset.daily_budget` của adset có **`effective_status === 'ACTIVE'`** (ABO).
- Chuyển đổi chính = **tin nhắn / lead** (không phải mua hàng). CPA = giá/tin nhắn.

## 2. Phân loại mức độ thay đổi — PHẢI XIN DUYỆT với thay đổi lớn

### 🟢 Thay đổi nhỏ — được làm ngay, báo cáo sau
- Sửa lỗi chính tả, lỗi hiển thị nhỏ, sai màu/khoảng cách CSS.
- Sửa bug rõ ràng trong **1 hàm**, không đổi output/định dạng dữ liệu.
- Thêm comment, cập nhật tài liệu (không xoá nội dung cũ).

### 🔴 Thay đổi lớn — BẮT BUỘC lập kế hoạch và chờ chủ dự án DUYỆT trước khi làm
Bao gồm nhưng không giới hạn:
- **Xoá file, xoá thư mục**, xoá tính năng, xoá section giao diện, xoá cột bảng, xoá KPI.
- Đổi cấu trúc payload / tên trường dữ liệu / REST endpoint.
- Đổi công thức tính toán chỉ số (CPA, ngân sách, health score, ngưỡng cảnh báo…).
- Đổi quy tắc phân loại sản phẩm, danh sách sản phẩm, phạm vi BM / tài khoản.
- Refactor nhiều file, đổi framework/thư viện, thêm/xoá dependency trong `package.json`.
- Thay đổi bố cục (layout) tổng thể giao diện.
- Bất kỳ thao tác nào **ghi/sửa đổi dữ liệu trên Meta** (tạo/sửa/tắt/xoá chiến dịch, adset, ad, audience, ngân sách) qua API hoặc MCP.

**Quy trình xin duyệt:**
1. Viết kế hoạch gồm: *Mục tiêu → Danh sách file sẽ sửa/xoá → Ảnh hưởng tới số liệu/giao diện → Rủi ro → Cách hoàn tác*.
2. Gửi cho chủ dự án và **dừng lại chờ phản hồi**. Không "làm trước, báo sau".
3. Chỉ thực hiện đúng phạm vi đã được duyệt. Phát sinh ngoài phạm vi → xin duyệt lại.

> Khi không chắc thay đổi là nhỏ hay lớn → **coi là thay đổi lớn**.

## 3. Bảo vệ thông tin quan trọng — KHÔNG ĐƯỢC XOÁ

- `.env` — chứa Access Token & App Secret. **Không xoá, không ghi đè toàn bộ, không commit, không in token ra log/chat/screenshot.** Khi cần sửa: chỉ cập nhật đúng dòng biến cần đổi.
- `PROJECT_CONTEXT.md`, `README.md`, `HUONG_DAN_LAY_TOKEN_META.md`, thư mục `.agents/` — chỉ được **bổ sung/cập nhật**, không xoá nội dung đang đúng.
- `data/` — dữ liệu sinh tự động, không sửa tay; không xoá nếu chưa được yêu cầu.
- Không xoá comment/docstring không liên quan tới thay đổi đang làm.

## 4. Trung thực về số liệu

- **Chỉ báo cáo số liệu đã thực sự lấy được** từ Meta API / file dữ liệu. Không ước lượng, không bịa số, không tự chia tách số liệu khi chưa tính.
- Nếu số liệu có thể thiếu (VD: chưa phân trang API, token hết hạn, lỗi một tài khoản) → **nói rõ giới hạn đó**.
- Không hiển thị số giả lập/cố định trên giao diện như thể là dữ liệu thật. Dữ liệu mẫu phải được gắn nhãn rõ "Demo".

## 5. Tiêu chuẩn kỹ thuật

- Stack: Node.js (ESM) + Express 5, frontend HTML/CSS/JS thuần, Chart.js, Lucide icons. Không thêm framework/Tailwind nếu chưa được duyệt.
- Màu sắc, bo góc, khoảng cách: dùng **CSS variables trong `:root` của `public/css/style.css`**. Style inline chỉ được dùng cho giá trị **tính ở runtime** (`width: ${pct}%`, `background: ${color}`). Mọi thuộc tính khác phải viết thành class trong file CSS để đảm bảo tính nhất quán của design system.
- Gọi Meta Graph API qua `callGraphApi()` trong `src/meta-api.js`; luôn xử lý lỗi theo từng tài khoản để 1 tài khoản lỗi không làm hỏng toàn bộ.
- Lọc trạng thái "đang chạy" dùng `effective_status`, không dùng `status`.
- Mọi element tương tác trong HTML phải có `id` duy nhất.

## 6. Sau khi hoàn thành một thay đổi

1. Khởi động lại server (`npm start`) và kiểm tra `http://localhost:3000` không lỗi console.
2. Đồng bộ thử dữ liệu nếu thay đổi liên quan tới API.
3. **Cập nhật `PROJECT_CONTEXT.md`**: mục Known Issues (đánh dấu ✅) và Lịch sử thay đổi.
4. Báo cáo ngắn gọn cho chủ dự án: đã sửa gì, file nào, số liệu có thay đổi không.
