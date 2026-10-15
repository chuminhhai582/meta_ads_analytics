# HƯỚNG DẪN LẤY META ACCESS TOKEN VÀ AD ACCOUNT ID

Tài liệu này hướng dẫn bạn cách lấy **Access Token** và **Ad Account ID** từ Meta (Facebook) để kết nối với MCP Server và hệ thống phân tích quảng cáo nội bộ.

---

## 1. Cách Lấy Ad Account ID (Mã tài khoản quảng cáo)

1. Mở trình duyệt và truy cập: **[Trình quản lý quảng cáo (Meta Ads Manager)](https://adsmanager.facebook.com/)**
2. Nhìn lên góc trên bên trái (bên dưới chữ "Trình quản lý quảng cáo"), bạn sẽ thấy tên tài khoản và mã tài khoản dạng: `Tên bạn (act_123456789012345)` hoặc hiển thị trên URL: `act=123456789012345`.
3. **Lưu ý quan trọng**: Bạn chỉ lấy dãy số **bỏ đi chữ `act_`**.
   - Ví dụ: `act_987654321012` ➔ Ad Account ID là `987654321012`.
   - Điền dãy số này vào `META_AD_ACCOUNT_ID` trong file `.env`.

---

## 2. Cách Lấy Access Token

Bạn có thể chọn 1 trong 2 cách sau:

### Cách 1: Lấy Token nhanh qua Graph API Explorer (Khuyên dùng để thử nghiệm ngay - 2 phút)

1. Truy cập **[Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/)**.
2. Nếu chưa đăng ký tài khoản Meta for Developers: Bấm **Bắt đầu (Get Started)** và làm theo hướng dẫn (rất nhanh).
3. Tại giao diện Graph API Explorer:
   - Mục **Meta App**: Chọn app của bạn (hoặc tạo một App dạng "Khác / Other" -> "Doanh nghiệp / Business").
   - Mục **User or Page**: Chọn **User Token** (Tài khoản người dùng).
   - Mục **Add a Permission** (Thêm quyền): Tìm và tích chọn các quyền sau:
     - `ads_read` (Bắt buộc - để đọc dữ liệu quảng cáo)
     - `read_insights` (Bắt buộc - để đọc báo cáo chỉ số Spend, ROAS, CTR...)
     - `ads_management` (Tùy chọn - nếu sau này muốn AI chỉnh sửa, bật/tắt campaign)
     - `business_management` (Tùy chọn - quản lý BM)
4. Bấm nút **Generate Access Token** (Tạo mã truy cập) màu xanh.
5. Facebook sẽ hiện popup yêu cầu bạn xác nhận cấp quyền ➔ Bấm **Tiếp tục**.
6. Copy đoạn mã token dài vừa tạo ra ➔ Dán vào `META_ADS_ACCESS_TOKEN` trong file `.env`.

> **Mẹo kéo dài hạn Token (Token vĩnh viễn / 60 ngày):**
> Token mặc định của Graph Explorer chỉ có hạn 1-2 giờ. Để đổi sang Token 60 ngày:
> - Bấm vào biểu tượng chữ `(i)` bên cạnh ô Access Token trong Graph Explorer.
> - Bấm **Mở trong Công cụ kiểm tra mã truy cập (Open in Access Token Tool)**.
> - Kéo xuống dưới bấm nút **Kéo dài mã truy cập (Extend Access Token)**. Bạn sẽ nhận được token có hạn 60 ngày.

---

### Cách 2: Lấy Token vĩnh viễn qua System User (Dành cho chạy cố định, chuyên nghiệp)

Nếu bạn quản lý bằng **Meta Business Manager (Trình quản lý kinh doanh)**:
1. Vào **[Cài đặt doanh nghiệp (Business Settings)](https://business.facebook.com/settings/)**.
2. Ở thanh bên trái, chọn **Người dùng (Users)** ➔ **Người dùng hệ thống (System Users)**.
3. Bấm **Thêm (Add)** ➔ Đặt tên (vd: `MCP_Ads_Analyst`) ➔ Vai trò: **Quản trị viên (Admin)**.
4. Bấm **Thêm tài sản (Add Assets)**:
   - Chọn mục **Tài khoản quảng cáo (Ad Accounts)**.
   - Chọn tài khoản quảng cáo bạn muốn phân tích.
   - Bật toàn bộ quyền **Quản lý tài khoản quảng cáo (Manage Ad Account)** hoặc **Xem hiệu quả (View Performance)** ➔ Lưu thay đổi.
5. Bấm nút **Tạo mã mới (Generate New Token)**:
   - Chọn App của bạn.
   - Thời hạn token: Chọn **Không bao giờ hết hạn (Never)** hoặc **60 ngày**.
   - Tích chọn các quyền: `ads_read`, `read_insights`, `ads_management`.
   - Bấm **Tạo mã (Generate Token)**.
6. Copy mã Token này và dán vào `META_ADS_ACCESS_TOKEN` trong file `.env`.

---

## 3. Hoàn tất và Kiểm tra

Sau khi đã điền thông tin vào file `.env`:
```env
META_ADS_ACCESS_TOKEN=EAAG...
META_AD_ACCOUNT_ID=123456789012345
```

1. Mở Terminal và chạy lệnh test tải dữ liệu:
   ```bash
   npm run fetch
   ```
2. Khởi động Web Dashboard phân tích:
   ```bash
   npm start
   ```
3. Mở trình duyệt tại địa chỉ: **`http://localhost:3000`** để xem biểu đồ và phân tích AI!
