# Lấy Access Token Meta từ n8n trên hosting cPanel

> Dùng khi n8n đã có sẵn một token Meta chạy ổn định lâu dài và muốn dùng lại token đó
> cho dashboard, thay vì tạo token mới.
>
> Credential cần lấy trong dự án này: **`Facebook Graph account 2`** — ID `FNWK4H9ul326EfmG`
> (đọc được 8/10 tài khoản quảng cáo của BM `2590933284556026`).

---

## ⚠️ Đọc trước khi làm

- File export chứa token ở **dạng chữ thường, không mã hoá**. **Xoá ngay sau khi copy xong.**
- **Luôn dùng `--id=<ID>`**, đừng dùng `--all` — `--all` xuất *toàn bộ* credential của n8n
  (gồm cả OAuth Google Sheets `tienlx@iecc.vn`) ra một file plaintext.
- Không dán token vào chat, email, ảnh chụp màn hình.
- Lệnh `export` chỉ **đọc**, không sửa gì trong n8n. Luồng đang chạy không bị ảnh hưởng.

---

## Bước 1 — Mở dòng lệnh

**Cách A: Terminal ngay trong cPanel (dễ nhất)**

cPanel → mục **Advanced** → **Terminal**. Nếu thấy thì dùng luôn, bỏ qua cách B.

**Cách B: SSH**

1. cPanel → **SSH Access** → **Manage SSH Keys** → `Generate a New Key`
   (hoặc bật *Password Authentication* nếu nhà cung cấp cho phép)
2. Sau khi tạo key, bấm **Manage** → **Authorize**
3. Tải private key về máy
4. Trên Windows, mở PowerShell:

```powershell
ssh -i C:\duong\dan\private_key USERNAME@domain-hoac-ip -p 22
```

> Nhiều hosting shared dùng **cổng khác 22** (2222, 2200...). Xem lại trang SSH Access
> trong cPanel để biết cổng đúng. Nếu cả Terminal lẫn SSH đều bị khoá, phải liên hệ
> nhà cung cấp hosting mở quyền.

---

## Bước 2 — Vào đúng môi trường Node của app n8n

n8n trên cPanel thường được cài qua **Setup Node.js App**, và nó chạy trong một môi trường
ảo riêng. Lệnh `n8n` sẽ **không** chạy được nếu gõ thẳng.

1. cPanel → **Setup Node.js App** → tìm app n8n
2. Copy dòng lệnh ở mục **"Enter to the virtual environment"**

Dòng đó trông như:

```bash
source /home/USERNAME/nodevenv/n8n/20/bin/activate && cd /home/USERNAME/n8n
```

3. Dán vào Terminal/SSH, Enter. Kiểm tra đã vào đúng môi trường:

```bash
node -v
which n8n || ls node_modules/.bin/n8n
```

---

## Bước 3 — Tìm khoá mã hoá

`--decrypted` chỉ hoạt động khi n8n đọc được **đúng khoá mã hoá** đã dùng để lưu credential.
Khoá nằm ở một trong hai chỗ:

```bash
# Chỗ 1: file config của n8n
cat ~/.n8n/config
```

Nếu thấy dạng `{"encryptionKey":"abc123..."}` thì **không phải làm gì thêm** — CLI tự đọc.

Nếu file không tồn tại hoặc không có `encryptionKey`, khoá đang được đặt bằng biến môi trường.
Xem trong cPanel → **Setup Node.js App** → app n8n → mục **Environment variables** →
tìm `N8N_ENCRYPTION_KEY`, rồi khai báo lại trong phiên làm việc:

```bash
export N8N_ENCRYPTION_KEY='dan_gia_tri_vao_day'
```

> ⚠️ Sai khoá thì lệnh vẫn chạy nhưng token xuất ra sẽ là chuỗi rác hoặc báo lỗi giải mã.
> Đừng dùng kết quả đó.

Tiện thể kiểm tra n8n đang dùng database nào:

```bash
ls -la ~/.n8n/
```

Thấy `database.sqlite` là dùng SQLite (mặc định). Nếu không thấy, n8n đang dùng MySQL/Postgres —
khi đó các biến `DB_*` cũng phải có mặt, xem trong Environment variables như trên.

---

## Bước 4 — Xuất credential

```bash
n8n export:credentials --id=FNWK4H9ul326EfmG --decrypted --output=$HOME/fb-token.json
```

Nếu báo `n8n: command not found`, dùng một trong hai cách:

```bash
./node_modules/.bin/n8n export:credentials --id=FNWK4H9ul326EfmG --decrypted --output=$HOME/fb-token.json
# hoặc
npx n8n export:credentials --id=FNWK4H9ul326EfmG --decrypted --output=$HOME/fb-token.json
```

---

## Bước 5 — Lấy riêng token ra

Đừng `cat` cả file (sẽ in thừa thông tin ra màn hình). Chỉ lấy đúng trường cần:

```bash
node -e "const c=require(process.env.HOME+'/fb-token.json'); console.log(c[0].data.accessToken)"
```

Kết quả là một chuỗi dài bắt đầu bằng `EAA...`. **Copy toàn bộ**, cẩn thận không sót ký tự đầu/cuối.

Nếu lệnh trên báo `undefined`, xem cấu trúc file để biết tên trường:

```bash
node -e "const c=require(process.env.HOME+'/fb-token.json'); console.log(Object.keys(c[0].data))"
```

---

## Bước 6 — XOÁ FILE NGAY

```bash
shred -u $HOME/fb-token.json 2>/dev/null || rm -f $HOME/fb-token.json
ls -la $HOME/fb-token.json    # phải báo "No such file"
```

Nếu có dùng `export N8N_ENCRYPTION_KEY` ở bước 3, thoát phiên để xoá biến khỏi bộ nhớ:

```bash
unset N8N_ENCRYPTION_KEY
exit
```

---

## Bước 7 — Kiểm tra token trước khi dùng

Về máy Windows, mở thư mục dự án và chạy:

```bash
npm run check-token EAAxxxxx...
```

Kết quả cần đạt:

| Dòng | Giá trị mong muốn |
|---|---|
| `Loai token` | `System User token` |
| `Han su dung` | **`VINH VIEN - khong het han`** |
| Quyền | `[CO] ads_read` |
| Tài khoản | liệt kê được các tài khoản của BM |

**Nếu `Han su dung` ghi một ngày cụ thể** → đây chỉ là token 60 ngày, sẽ lại chết.
Lúc đó đừng dùng, hãy tạo System User token mới theo
[`HUONG_DAN_LAY_TOKEN_META.md`](./HUONG_DAN_LAY_TOKEN_META.md).

---

## Bước 8 — Nạp vào dashboard

Double-click shortcut **Ucmas Ads Analytics** ngoài Desktop → nút **Cài đặt Token**
(biểu tượng chìa khoá) → dán token → **Lưu & Đồng bộ**.

Lần đồng bộ này sinh snapshot v3 có bảng tra `adMap`, và các cột
**SĐT (L1) / Hẹn test (L3) / Nhập học (L4) / Doanh thu** ở từng chiến dịch sẽ có số thật.

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `n8n: command not found` | Chưa chạy lệnh activate ở Bước 2, hoặc dùng sai đường dẫn. Thử `./node_modules/.bin/n8n`. |
| Token xuất ra là chuỗi rác | Sai `N8N_ENCRYPTION_KEY`. Lấy lại đúng khoá ở Bước 3. |
| `Cannot find module` khi chạy `node -e` | Sai đường dẫn file. Dùng đường dẫn tuyệt đối `/home/USERNAME/fb-token.json`. |
| Báo lỗi kết nối database | n8n dùng MySQL/Postgres. Phải khai báo thêm các biến `DB_*` giống app n8n. |
| Không có cả Terminal lẫn SSH | Hosting khoá. Liên hệ nhà cung cấp, hoặc bỏ hướng này và tạo System User token mới (nhanh hơn). |
| `database is locked` | SQLite đang bị n8n giữ. Thử lại sau, hoặc tạm dừng app n8n trong Setup Node.js App rồi chạy lại. |

---

## Nếu đường này tắc

Tạo System User token mới mất khoảng 2 phút và cho kết quả tương đương — xem
[`HUONG_DAN_LAY_TOKEN_META.md`](./HUONG_DAN_LAY_TOKEN_META.md).
Ưu điểm: gắn được **cả 10** tài khoản (token trong n8n hiện chỉ dùng cho 8).
