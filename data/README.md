# Data Directory

Thư mục lưu trữ dữ liệu cache nội bộ (Local Data Lake) sinh ra tự động:
- `latest_insights.json`: Snapshot dữ liệu quảng cáo từ Meta Marketing API.
- `report_*.csv`: Các file xuất báo cáo dạng CSV.
- `leads_cache.json`: Dữ liệu số điện thoại từ Google Sheet (khi tích hợp).

Các file `.json` và `.csv` trong thư mục này được `.gitignore` bỏ qua để bảo mật thông tin và tránh xung đột mã nguồn.
