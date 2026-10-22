# HƯỚNG DẪN FIX CHI TIẾT — Rà soát 21/10/2026

> **Tài liệu thi công.** Đi kèm báo cáo rà soát (28 phát hiện).
> Mỗi mục có: vị trí chính xác → code trước/sau → lệnh kiểm chứng.
> Làm theo đúng thứ tự đợt: có ràng buộc phụ thuộc thật, không phải sắp theo mức độ.
>
> Ngày tạo: 2026-10-22 · Áp dụng cho commit `10095c2` trở đi

---

## 0. Chuẩn bị trước khi sửa

### 0.1. Ghi lại số đo nền

Chạy **trước khi sửa gì**, lưu lại để so sánh sau:

```bash
npm test
```

```bash
node src/server.js
```

Mở terminal thứ hai:

```bash
curl -s -o /dev/null -w 'payload: %{size_download} bytes | %{time_total}s\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

**Số đo nền ngày 21/10/2026** (snapshot v4, 617 chiến dịch, 6.626 bản ghi ngày, 1.214 lead):

| Chỉ số | Giá trị |
|---|---|
| `npm test` | 49/49 pass |
| Payload `/api/data` | 419.764 bytes (389,7 KB JSON) |
| Thời gian HTTP | 4,6 – 24,6 ms |
| `buildView` 30 ngày | 2,22 ms |
| `renderTable` 605 dòng | 84,3 ms |
| `renderAll` | 58,1 ms |
| Footer vs header | lệch 32 px mỗi bên |
| Biến CSS chưa định nghĩa | 7 biến / 12 chỗ dùng |

### 0.2. Tạo nhánh làm việc

```bash
git checkout -b fix/ra-soat-2026-10-21
```

### 0.3. Quy tắc bắt buộc giữ xuyên suốt

Bất biến này được 49 test khoá lại — **phải đúng sau mỗi lần sửa**:

```
Σ(view.campaigns[].l1Count) + view.unassignedLeads.l1Count === view.summary.l1Count
```

Đúng cho cả L2 / L3 / L4 / `revenue`, với mọi tổ hợp kỳ × sản phẩm × tài khoản.
Chỉ có **P-01** trong danh sách này chạm tới nó. Chạy `npm test` sau mỗi mục.

---

# ĐỢT 1 — Lỗi người dùng gặp trực tiếp (~1 giờ)

5 mục. Sau đợt này giao diện thẳng hàng, xuất file đúng, và route ghi được bảo vệ đầy đủ.

---

## U-01 + F-03 — Thêm lại `<div id="reportContent">`

**Mức độ:** Nặng (2 lỗi, 1 bản sửa)
**File:** `public/index.html`

### Vấn đề

Thẻ mở `<div id="reportContent">` đã bị xoá nhưng thẻ đóng `</div>` vẫn còn ở dòng 459. Gây ra 2 lỗi cùng lúc:

1. Trình phân tích HTML đóng luôn `div.app-layout` tại đó, rồi bỏ qua `</main>`. `<footer>` thành con trực tiếp của `<body>`, mất `max-width: 1480px` và `padding: 24px 32px` → lệch 32 px mỗi bên.
2. `showEmptyState()` và `hideEmptyState()` tìm `#reportContent` → trả về `null` → trạng thái rỗng hiện **chồng lên** dashboard còn nguyên số liệu cũ.

Dấu vết: các section từ dòng 166 vẫn thụt lề 8 khoảng trắng như thể đang nằm trong một wrapper.

### Bước 1 — Thêm thẻ mở

Mở `public/index.html`, tìm **dòng 163–165**:

```html
        <button id="emptyActionBtn" class="btn btn-primary">Cài đặt Token</button>
      </section>

        <!-- ============ 5 TABS NAVIGATION ============ -->
```

Thay dòng comment `<!-- ============ 5 TABS NAVIGATION ============ -->` (comment chết, tabs đã chuyển vào header từ lâu) bằng:

```html
      <!-- Bọc toàn bộ nội dung báo cáo. app.js ẩn/hiện khối này theo trạng thái
           rỗng (showEmptyState / hideEmptyState), và CSS làm mờ nó khi đang đồng bộ
           (body.is-syncing .report-content). Thẻ đóng của nó ở cuối <main>. -->
      <div id="reportContent" class="report-content">
```

### Bước 2 — Không cần sửa thẻ đóng

Thẻ `</div>` ở **dòng 459** giờ đã có thẻ mở. Giữ nguyên:

```html
        </section>
      </div>
    </main>
```

### Bước 3 — Dọn trạng thái cũ trong `showEmptyState()`

`public/js/app.js`, hàm `showEmptyState()` (dòng 524). Thêm vào **cuối hàm**, ngay trước `refreshIcons();`:

```js
  // Xoá dữ liệu phiên trước: giữ lại số cũ khiến người dùng tưởng trạng thái rỗng
  // chỉ là thông báo phụ, chứ không phải "chưa có dữ liệu".
  appState.view = null;
  appState.analysis = null;
  appState.selectedCampaignIds.clear();
```

### Kiểm chứng

Mở `http://localhost:3000`, dán vào DevTools Console:

```js
['.app-header', '.table-section', '.app-footer'].map(s => {
  const b = document.querySelector(s).getBoundingClientRect();
  return `${s}: ${Math.round(b.left)} → ${Math.round(b.right)}`;
});
```

**Kỳ vọng:** cả ba đều `32 → 1241` (ở viewport 1280).
**Trước khi sửa:** footer là `0 → 1273`.

Rồi kiểm tra trạng thái rỗng:

```js
showEmptyState('TEST', 'TEST');
({
  emptyHienRa: !document.getElementById('emptyState').classList.contains('d-none'),
  dashboardDaAn: document.getElementById('reportContent').classList.contains('d-none')
});
// Kỳ vọng: { emptyHienRa: true, dashboardDaAn: true }
// Gõ hideEmptyState() để trả lại bình thường
```

---

## U-02 — Định nghĩa 7 biến CSS còn thiếu

**Mức độ:** Nặng
**File:** `public/css/style.css`

### Vấn đề

Phần CSS của Tabs / Funnel / Enrolled (dòng ~647–800) dùng tên biến của một hệ token khác, không có trong `:root`. Trong CSS, `var()` không giải được mà không có fallback sẽ làm **cả khai báo vô hiệu ở thời điểm tính giá trị** — thuộc tính rơi về giá trị khởi tạo hoặc kế thừa. Im lặng, không báo lỗi console.

Giá trị tính toán thật trên trình duyệt:

| Selector | Thuộc tính | Thực tế | Mong đợi |
|---|---|---|---|
| `.tab-btn.active` | `background` | `rgba(0, 0, 0, 0)` | nền nổi |
| `.tab-btn:hover` | `background` | `rgba(0, 0, 0, 0)` | phản hồi hover |
| `.tab-btn` | `transition` | `0s` | 0,18s |
| `.enrolled-card` | `background` | `rgba(0, 0, 0, 0)` | nền thẻ |
| `.funnel-stage-rate` | `color` | `rgb(248,250,252)` | màu nhấn |
| `.enrolled-phone` | `font-family` | kế thừa Inter | mono |

Thiếu: `--transition-fast`, `--surface-hover`, `--surface-1`, `--surface-2`, `--border-medium`, `--primary-accent`, `--font-mono`.

> `replicate.css` và `cross-post.css`: **0 biến thiếu** — chỉ `style.css` bị.

### Cách sửa

`public/css/style.css`, tìm **dòng 57** (`--font-display: 'Outfit', sans-serif;`). Thêm ngay sau nó, **trước dấu `}` đóng khối `:root`**:

```css
  /* Bí danh cho các token mà phần Tabs / Funnel / Enrolled đang gọi. Chúng được
     viết theo tên của một hệ token khác và chưa từng giải được, nên nền tab đang
     chọn, hover và transition im lặng biến mất (không có lỗi console).
     Giữ dạng bí danh để màu vẫn chỉ có MỘT nguồn duy nhất ở trên. */
  --surface-1:       var(--bg-card-solid);
  --surface-2:       rgba(255, 255, 255, 0.07);
  --surface-hover:   var(--bg-hover);
  --border-medium:   var(--border-strong);
  --primary-accent:  var(--primary-text);
  --transition-fast: 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  --font-mono:       'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
```

### Thêm test chống tái diễn

Tạo `test/css.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * U-02: var(--x) không giải được sẽ làm cả khai báo vô hiệu, im lặng, không có
 * lỗi console — nên lỗi này sống được 1 tuần trước khi bị phát hiện bằng tay.
 * Test này bắt được bằng grep thuần, không cần trình duyệt.
 */
test('U-02: không có biến CSS nào được dùng mà chưa định nghĩa', () => {
  const all = ['style.css', 'replicate.css', 'cross-post.css']
    .map(f => readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf-8'))
    .join('\n');

  const defined = new Set([...all.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gmi)].map(m => m[1]));
  const used = new Set([...all.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(v => !defined.has(v));

  assert.deepEqual(missing, [], `Biến CSS chưa định nghĩa: ${missing.join(', ')}`);
});
```

### Kiểm chứng

```bash
npm test
```

Và trên DevTools Console (sau khi hard-reload `Ctrl+Shift+R`):

```js
const t = document.querySelector('.tab-btn.active');
({
  background: getComputedStyle(t).backgroundColor,   // ≠ rgba(0, 0, 0, 0)
  transition: getComputedStyle(t).transitionDuration // ≠ 0s
});
```

---

## F-01 — Gắn bộ lọc vào 3 link Xuất file

**Mức độ:** Nặng
**File:** `public/js/app.js`

### Vấn đề

Các thẻ `<a href="/api/export/campaigns">` trong `index.html` (dòng 111–119) là href **tĩnh**, không mang query nào, và không chỗ nào trong `app.js` cập nhật chúng. Server đọc bộ lọc từ query string nên tự quay về mặc định `product=ALL`, `datePreset=last_30d`.

Người dùng đang xem UCKID / tháng trước, bấm Xuất → nhận file của toàn BM / 30 ngày. Tên file có ghi `ALL_last_30d` nhưng không ai để ý.

Đo thực tế:

```
curl .../api/export/campaigns                              → 604 dòng, chien_dich_ALL_last_30d.csv
curl '.../api/export/campaigns?product=uckid&datePreset=last_month' → 56 dòng
```

> Backend **đã nhận query đúng rồi**. Chỉ thiếu phía client gắn query vào href.

### Bước 1 — Thêm hàm `syncExportLinks()`

`public/js/app.js`, thêm vào **ngay trước** hàm `applyPayload()` (dòng 436):

```js
/**
 * Đồng bộ 3 link Xuất file với bộ lọc server ĐANG áp dụng.
 *
 * Href tĩnh trong index.html khiến mọi lần xuất đều ra file ALL / last_30d bất kể
 * đang xem gì — im lặng, chỉ nhận ra khi mở file lên đếm dòng.
 *
 * Dùng `view.*` (server trả về) chứ KHÔNG dùng `appState.*` (người dùng vừa chọn):
 * server có thể quay về last_30d nếu khoảng tự chọn không dùng được.
 */
function syncExportLinks(view) {
  const q = new URLSearchParams({
    product:    view.product    || 'ALL',
    accountId:  view.accountId  || 'ALL',
    datePreset: view.datePreset || 'last_30d',
    tab:        view.activeTab  || 'all'
  });
  if (view.isCustomRange && view.dateRange) {
    q.set('startDate', view.dateRange.startDate);
    q.set('endDate',   view.dateRange.endDate);
  }

  const links = {
    exportCampaignsLink: '/api/export/campaigns',
    exportDailyLink:     '/api/export/daily',
    exportJsonLink:      '/api/export/json'
  };
  for (const [id, base] of Object.entries(links)) {
    const el = document.getElementById(id);
    if (el) el.href = `${base}?${q}`;
  }
}
```

### Bước 2 — Gọi trong `applyPayload()`

`public/js/app.js` **dòng 460**. Tìm:

```js
  renderAll();
}
```

Sửa thành:

```js
  syncExportLinks(json.view);
  renderAll();
}
```

### Bước 3 (tùy chọn) — Hiện bộ lọc trong menu Xuất

`public/index.html`, thêm vào đầu `#exportMenu` (dòng 110):

```html
<div class="dropdown-note" id="exportScopeNote"></div>
```

`public/css/style.css`:

```css
.dropdown-note {
  padding: 8px 12px;
  font-size: 0.74rem;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
}
```

Thêm vào cuối `syncExportLinks()`:

```js
  // Nói rõ sẽ xuất cái gì, để người dùng không phải mở file lên mới biết.
  const note = document.getElementById('exportScopeNote');
  if (note) {
    const prod = view.product === 'ALL' ? 'Tất cả 4 SP' : view.product.toUpperCase();
    const acc  = view.accountId === 'ALL' ? 'Toàn BM' : `TK ${view.accountId}`;
    note.textContent =
      `${prod} • ${acc} • ${view.dateRange.startDate} → ${view.dateRange.endDate} ` +
      `• ${view.summary.campaignCount} CĐ`;
  }
```

### Kiểm chứng

1. Mở dashboard → chọn tab **UCKID** → kỳ **Tháng trước**
2. DevTools Console:

```js
document.getElementById('exportCampaignsLink').href;
// Kỳ vọng: .../api/export/campaigns?product=uckid&accountId=ALL&datePreset=last_month&tab=uckid
```

3. Bấm Xuất CSV Chiến dịch → tên file phải là `chien_dich_uckid_last_month.csv`

---

## S-01 — Chặn CSRF theo phương thức cho `/api/cp`

**Mức độ:** Nặng
**File:** `src/server.js`

### Vấn đề

Danh sách bảo vệ ở `src/server.js:373–377` liệt kê **thủ công từng đường dẫn**. Khi Ads Creation Studio được thêm ngày 21/10, ba route mới không được thêm vào:

| Route | Tạo gì trên Meta | `requireSessionToken` |
|---|---|---|
| `publish` | Bài đăng Fanpage | ✅ |
| `replicate-ad` | Quảng cáo | ✅ |
| `analyze-campaigns` | — (chỉ đọc) | ✅ |
| `bulk-replicate` | Campaign + Adset + Ad | ✅ |
| `refresh-cache` | — | ✅ |
| **`create-campaign`** | **Chiến dịch thật** | ❌ |
| **`create-adset`** | **Nhóm QC thật** | ❌ |
| **`batch-create-ads`** | **Tối đa 15 QC thật** | ❌ |

Frontend **đã gửi** header rồi (`cross-post-app.js:1578, 1622, 1650`) — chỉ thiếu bước kiểm ở server.

### Mức độ thực tế

Vì client gửi `Content-Type: application/json`, một trang lạ muốn gọi sang sẽ bị preflight CORS chặn (server không phát header CORS nào). Nên đây là **lớp phòng vệ thứ hai bị thiếu**, không phải lỗ hổng đang bị khai thác được.

Nó trở thành rủi ro thật nếu:
- bật `ALLOW_REMOTE=true` để xem từ máy khác trong LAN,
- hoặc sau này có route nào nhận `form-urlencoded`.

### Cách sửa — đảo chiều mặc định

Nguyên nhân gốc là **cách** bảo vệ: liệt kê từng đường dẫn thì mỗi route mới lại là một lần có thể quên.

`src/server.js` **dòng 372–378**. Thay:

```js
// Cross-Post & Creative Replication
app.use('/api/cp/publish', requireSessionToken);
app.use('/api/cp/replicate-ad', requireSessionToken);
app.use('/api/cp/analyze-campaigns', requireSessionToken);
app.use('/api/cp/bulk-replicate', requireSessionToken);
app.use('/api/cp/refresh-cache', requireSessionToken);
app.use('/api/cp', crossPostRouter);
```

bằng:

```js
// Cross-Post & Creative Replication
//
// Mọi request GHI dưới /api/cp đều cần token phiên. Danh sách trắng theo đường dẫn
// đã bỏ sót 3 route của Ads Creation Studio (create-campaign, create-adset,
// batch-create-ads) khi chúng được thêm vào ngày 21/10 — đó là những route TẠO
// chiến dịch / nhóm QC / quảng cáo THẬT trên BM.
// Mặc-định-an-toàn: route ghi mới tự được bảo vệ, không cần nhớ thêm vào danh sách.
app.use('/api/cp', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireSessionToken(req, res, next);
});
app.use('/api/cp', crossPostRouter);
```

### Thêm test khoá lại

Tạo `test/cp-guard.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3571;   // cổng riêng để không đụng server đang chạy

/** Khởi động server thật trên cổng tạm rồi đợi nó trả lời. */
async function startServer() {
  const proc = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/session`);
      if (r.ok) return proc;
    } catch { /* chưa lên */ }
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Server không khởi động được trong 6s');
}

/**
 * S-01: mọi route GHI dưới /api/cp phải đòi X-Internal-Token.
 * Test này bắt cả loại lỗi "route mới quên thêm vào danh sách bảo vệ" —
 * đúng loại lỗi đã xảy ra với 3 route của Ads Creation Studio.
 */
test('S-01: mọi route ghi /api/cp đòi X-Internal-Token', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const writeRoutes = [
    'publish', 'replicate-ad', 'analyze-campaigns', 'bulk-replicate',
    'refresh-cache', 'create-campaign', 'create-adset', 'batch-create-ads'
  ];

  for (const p of writeRoutes) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/cp/${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 403, `POST /api/cp/${p} phải trả 403 khi thiếu token`);
  }
});

test('S-01: route đọc /api/cp vẫn gọi được không cần token', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`http://127.0.0.1:${PORT}/api/cp/ad-accounts`);
  assert.notEqual(res.status, 403, 'GET /api/cp/ad-accounts không được bị chặn');
});
```

### Kiểm chứng

```bash
npm test
```

Hoặc bằng tay (server đang chạy):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/cp/create-campaign
```

**Kỳ vọng:** `403`. **Trước khi sửa:** `400` (nghĩa là đã vào tới logic route).

---

## ✅ Checkpoint đợt 1

```bash
npm test
```

| Kiểm tra | Kỳ vọng |
|---|---|
| `npm test` | 51/51 pass (49 cũ + 2 test mới) |
| Footer / header / table | cùng `32 → 1241` |
| `.tab-btn.active` background | ≠ `rgba(0,0,0,0)` |
| Xuất CSV khi xem UCKID/tháng trước | `chien_dich_uckid_last_month.csv`, 56 dòng |
| `POST /api/cp/create-campaign` không token | `403` |

```bash
git add -A && git commit -m "fix: dot 1 - footer lech, empty state, bien CSS chet, export bo loc, chan CSRF /api/cp"
```

---

# ĐỢT 2 — Hiệu suất payload (~2 giờ)

Chỗ tiết kiệm lớn nhất **không nằm ở thuật toán** — `buildView` đã rất nhanh (2,2–4,3 ms).

---

## P-01 — Lọc chiến dịch rỗng khỏi payload

**Mức độ:** Nặng
**File:** `src/report.js`
**⚠️ Đây là mục DUY NHẤT trong tài liệu này chạm tới bất biến KPI. Đọc kỹ phần an toàn.**

### Vấn đề

Mỗi lần đổi tab / tài khoản / khoảng ngày, server gửi về cả 604 chiến dịch. Nhưng bộ lọc trạng thái mặc định của bảng là `ACTIVE`, nên giao diện chỉ vẽ 27 dòng.

Phân tích payload đo được:

```
view tổng                    : 389,7 KB
├─ campaigns                 : 379,5 KB  (97% toàn payload)
│  ├─ có tín hiệu  :  43 dòng =  32,3 KB
│  └─ rỗng hoàn toàn: 561 dòng = 347,2 KB   ← 89% payload
└─ tất cả phần còn lại       :  10,2 KB

Dòng bảng thực vẽ (lọc ACTIVE): 27
```

561 dòng kia có `spend = 0`, `expectedDailyBudget = 0`, `l1Count = 0`, và không chạy.

### Vì sao an toàn với bất biến

Tiêu chí lọc **bao gồm** `l1Count === 0` và `spend === 0`. Nên mọi dòng bị bỏ đóng góp **đúng 0** vào mọi tổng:

- `summary.l1Count` ← không đổi (dòng bỏ có `l1Count = 0`)
- `summary.totalSpend` ← không đổi (dòng bỏ có `spend = 0`)
- `unassignedLeads` ← không liên quan (tính từ `leadAttr`, không từ danh sách dòng)

**Điều kiện bắt buộc:** `aggregate()` phải chạy trên tập **trước khi lọc** (`scoped`), không phải sau (`viewCampaigns`). Nếu `npm test` đỏ sau mục này, nguyên nhân gần như chắc chắn là chỗ này.

### Cách sửa

`src/report.js` **dòng 521–526**. Thay:

```js
  // Campaigns to display in table
  const viewCampaigns = targetCampaigns
    .filter(c => selectedProduct === 'ALL' || c.product === selectedProduct)
    .sort((a, b) => b.spend - a.spend || b.expectedDailyBudget - a.expectedDailyBudget);

  const s = aggregate(viewCampaigns);
```

bằng:

```js
  // Campaigns to display in table
  const scoped = targetCampaigns
    .filter(c => selectedProduct === 'ALL' || c.product === selectedProduct);

  /**
   * Một chiến dịch chỉ cần gửi về client khi nó có thứ gì để xem: tiêu tiền,
   * đang giữ ngân sách, ra lead, hoặc đang chạy.
   *
   * Đo thực tế 21/10/2026: 561/604 dòng trong kho không thoả điều kiện nào —
   * chúng tốn 347 KB mỗi request chỉ để vẽ ra số 0, trong khi bộ lọc mặc định
   * của bảng (ACTIVE) chỉ hiện 27 dòng.
   *
   * BẤT BIẾN: tiêu chí này bao gồm spend === 0 VÀ l1Count === 0, nên mọi dòng
   * bị bỏ đóng góp đúng 0 vào tổng KPI. Vì vậy aggregate() BẮT BUỘC chạy trên
   * `scoped` (trước khi lọc), không phải trên `viewCampaigns`.
   * Xem test/report.test.js — "A-05: Σ các dòng chiến dịch + chưa gán = tổng KPI".
   */
  const hasSignal = (c) =>
    c.spend > 0 ||
    c.expectedDailyBudget > 0 ||
    c.l1Count > 0 ||
    c.effective_status === 'ACTIVE';

  const includeEmpty = opts.includeEmpty === true || opts.includeEmpty === '1';

  const viewCampaigns = (includeEmpty ? scoped : scoped.filter(hasSignal))
    .sort((a, b) => b.spend - a.spend || b.expectedDailyBudget - a.expectedDailyBudget);

  const hiddenEmptyCampaigns = scoped.length - viewCampaigns.length;

  // Tổng KPI tính trên `scoped` để không phụ thuộc bộ lọc hiển thị ở trên.
  const s = aggregate(scoped);
```

### Trả `hiddenEmptyCampaigns` về client

Cùng file, trong `return { ... }` (khối bắt đầu dòng 623). Thêm cạnh `campaigns`:

```js
    campaigns: viewCampaigns,
    /** Số chiến dịch bị ẩn vì không chi tiêu / không lead / không chạy (P-01). */
    hiddenEmptyCampaigns,
```

### Cho phép bỏ qua bộ lọc khi cần soi chiến dịch đã tắt

`src/server.js`, hàm `readOptions()` (khoảng dòng 125). Thêm vào object trả về:

```js
    includeEmpty: source.includeEmpty === '1' || source.includeEmpty === true,
```

Và thêm vào `cacheKey()` (dòng 53) để 2 chế độ không dùng chung cache:

```js
function cacheKey({ product, accountId, datePreset, activeTab, startDate, endDate, includeEmpty }) {
  return [product, accountId, datePreset, activeTab, startDate || '', endDate || '',
          includeEmpty ? 'all' : ''].join('|');
}
```

### Hiện số dòng bị ẩn trên giao diện

`public/js/app.js`, trong `renderTable()`, tìm:

```js
  if (countBadge) countBadge.textContent = `${filtered.length} chiến dịch`;
```

Thay bằng:

```js
  if (countBadge) {
    const hidden = appState.view?.hiddenEmptyCampaigns || 0;
    countBadge.textContent = hidden > 0
      ? `${filtered.length} chiến dịch (ẩn ${formatNumber(hidden)} CĐ không chi tiêu)`
      : `${filtered.length} chiến dịch`;
  }
```

Thêm nút "Hiện tất cả" vào `.table-controls` trong `public/index.html` (sau `#statusFilterSelect`):

```html
<button id="toggleEmptyCampaignsBtn" class="btn btn-secondary btn-sm" type="button"
        title="Hiện cả các chiến dịch không chi tiêu, không lead, không chạy">
  <i data-lucide="eye"></i>
  <span id="toggleEmptyText">Hiện tất cả</span>
</button>
```

`public/js/app.js` — thêm `includeEmpty: false` vào `appState`, rồi:

```js
// Hiện / ẩn các chiến dịch rỗng. Mặc định ẩn (P-01): chúng chiếm 89% payload
// mà bộ lọc ACTIVE của bảng không bao giờ hiển thị.
document.getElementById('toggleEmptyCampaignsBtn')?.addEventListener('click', () => {
  appState.includeEmpty = !appState.includeEmpty;
  const txt = document.getElementById('toggleEmptyText');
  if (txt) txt.textContent = appState.includeEmpty ? 'Ẩn CĐ rỗng' : 'Hiện tất cả';
  loadData();
});
```

Và trong `loadData()`, thêm vào `URLSearchParams`:

```js
  if (appState.includeEmpty) params.set('includeEmpty', '1');
```

### Kiểm chứng

```bash
npm test
```

**Phải vẫn 51/51 pass.** Nếu đỏ ở test `A-05` → kiểm tra lại `aggregate(scoped)`.

```bash
curl -s -o /dev/null -w 'mac dinh : %{size_download} bytes\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

```bash
curl -s -o /dev/null -w 'includeEmpty: %{size_download} bytes\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d&includeEmpty=1"
```

| | Trước | Sau |
|---|---|---|
| Mặc định | 419.764 bytes | **~43.000 bytes** |
| `includeEmpty=1` | — | ~419.764 bytes |

Kiểm tra bất biến bằng tay:

```bash
node -e "const r=JSON.parse(require('fs').readFileSync('data/latest_insights.json','utf8'));r.leadsRecords=JSON.parse(require('fs').readFileSync('data/leads_cache.json','utf8')).leads;import('./src/report.js').then(({buildView})=>{for(const p of ['ALL','ucmas','uckid','mathca','traihe'])for(const d of ['today','last_7d','last_30d','this_year']){const v=buildView(r,{product:p,accountId:'ALL',datePreset:d});for(const k of ['l1Count','l2Count','l3Count','l4Count']){const sum=v.campaigns.reduce((a,c)=>a+c[k],0)+v.unassignedLeads[k];if(sum!==v.summary[k]){console.log('FAIL',p,d,k,sum,'!==',v.summary[k]);process.exit(1)}}}console.log('Bat bien OK cho moi to hop')})"
```

---

## P-02 — Nén gzip bằng `zlib` có sẵn

**Mức độ:** Nặng
**File:** `src/server.js`

### Vấn đề

Phản hồi `/api/data` không có header `Content-Encoding`:

```
$ curl -D - -H 'Accept-Encoding: gzip, br' .../api/data
  Content-Length: 419764
  (không có Content-Encoding)
```

Đợt rà soát 16/10 đã bỏ qua việc này (mục D-02) để tránh thêm dependency `compression`. Nhưng **Node có sẵn module `zlib`** — không cần cài gì, stack vẫn chỉ 3 package.

Đo thực tế: `zlib.gzipSync(payload)` → **23 KB trong 4,9 ms**, nhỏ hơn **94%**.

### Cách sửa

`src/server.js`. Thêm import ở đầu file:

```js
import zlib from 'zlib';
```

Rồi tìm **dòng 44–45**:

```js
app.use(express.json({ limit: '256kb' }));
app.use(express.static(publicDir));
```

Chèn **giữa** hai dòng đó:

```js
/**
 * Nén gzip cho phản hồi JSON lớn.
 *
 * Dùng zlib có sẵn trong Node thay vì thêm dependency `compression` — stack vẫn
 * chỉ 3 package (giữ nguyên quyết định D-02 của đợt rà soát 16/10, nhưng không
 * phải trả giá bằng việc bỏ nén).
 *
 * Đo 21/10/2026: payload 390 KB → 23 KB (−94%) trong 4,9 ms.
 * Ngưỡng 8 KB: dưới mức đó chi phí nén lớn hơn phần tiết kiệm được.
 */
const GZIP_MIN_BYTES = 8192;
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();

  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const buf = Buffer.from(JSON.stringify(body));
    if (buf.length < GZIP_MIN_BYTES) return sendJson(body);

    const gz = zlib.gzipSync(buf, { level: 6 });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');   // proxy/cache không trộn 2 biến thể
    return res.end(gz);
  };
  next();
});
```

> **Lưu ý thứ tự:** phải đặt **sau** `express.json()` và **trước** `express.static()`.
> Nó chỉ bọc `res.json` nên không ảnh hưởng tới các route xuất CSV (dùng `res.send`).

### Kiểm chứng

```bash
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

**Kỳ vọng:** có `Content-Encoding: gzip` và `Vary: Accept-Encoding`.

```bash
curl -s -o /dev/null --compressed -w 'tren day: %{size_download} bytes\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

**Kết hợp P-01 + P-02:** 419.764 bytes → **~6.000 bytes trên dây**.

Mở dashboard, kiểm tra DevTools → Network → `data?...` → `Size` phải nhỏ hơn hẳn `Content`.

---

## F-02 — Tỉa lựa chọn chiến dịch theo view

**Mức độ:** Nặng
**File:** `public/js/app.js`

### Vấn đề

`appState.selectedCampaignIds` không bị dọn khi đổi tab, tài khoản hay khoảng ngày.

Tái hiện trên trình duyệt:

```
1. chọn 3 chiến dịch UCMAS     → selectedCampaignIds.size = 3
2. switchTab('uckid')          → toolbar: "Đã chọn: 3 chiến dịch"  ← vẫn hiện
3. getSelectedCampaigns()      → 0                                 ← rỗng
4. bấm "Phân tích & Nhân bản"  → POST campaignIds: []
5. server                      → 400 "Cần chọn ít nhất 1 chiến dịch."
```

Mâu thuẫn trực tiếp với dòng chữ đang hiển thị trên màn hình.

### Bước 1 — Thêm hàm `pruneSelection()`

`public/js/app.js`, thêm cạnh `syncExportLinks()`:

```js
/**
 * Bỏ khỏi lựa chọn những chiến dịch không còn nằm trong view hiện tại.
 *
 * Tỉa theo tập chiến dịch mới chứ KHÔNG xoá sạch: đổi khoảng ngày (vẫn cùng tập
 * chiến dịch) thì giữ được lựa chọn, còn đổi tab/tài khoản thì tự loại những cái
 * không còn thuộc phạm vi.
 *
 * Không có bước này, thanh công cụ báo "đã chọn N" trong khi getSelectedCampaigns()
 * trả về rỗng, và wizard nhân bản báo lỗi "chưa chọn chiến dịch nào".
 */
function pruneSelection(view) {
  const present = new Set((view.campaigns || []).map(c => c.id));
  for (const id of appState.selectedCampaignIds) {
    if (!present.has(id)) appState.selectedCampaignIds.delete(id);
  }
}
```

### Bước 2 — Gọi trong `applyPayload()`

`public/js/app.js` dòng 460 (chỗ vừa thêm `syncExportLinks`):

```js
  syncExportLinks(json.view);
  pruneSelection(json.view);
  renderAll();
}
```

### Bước 3 — Chốt phòng vệ ở nút mở modal

`public/js/app.js` **dòng 1542–1548**. Thay:

```js
document.getElementById('openReplicateModalBtn')?.addEventListener('click', () => {
  if (appState.selectedCampaignIds.size === 0) return;
  // Trigger the modal from replicate-modal.js
  if (typeof window.openReplicateModal === 'function') {
    window.openReplicateModal(getSelectedCampaigns(), appState.sessionToken);
  }
});
```

bằng:

```js
document.getElementById('openReplicateModalBtn')?.addEventListener('click', () => {
  // Kiểm tra trên tập THỰC SỰ lấy được, không phải trên size của Set: hai con số
  // này từng lệch nhau khi đổi tab, dẫn tới wizard mở ra rồi báo lỗi 400.
  const picked = getSelectedCampaigns();
  if (picked.length === 0) {
    showToast('Các chiến dịch đã chọn không thuộc tab/tài khoản đang xem. Hãy chọn lại.', 'warning');
    appState.selectedCampaignIds.clear();
    renderTable();
    return;
  }
  if (typeof window.openReplicateModal === 'function') {
    window.openReplicateModal(picked, appState.sessionToken);
  }
});
```

### Kiểm chứng

DevTools Console:

```js
(async () => {
  const ucmas = appState.view.campaigns.filter(c => c.product === 'ucmas').slice(0, 3);
  ucmas.forEach(c => appState.selectedCampaignIds.add(c.id));
  renderTable();
  switchTab('uckid');
  await new Promise(r => setTimeout(r, 900));
  return {
    giuLai: appState.selectedCampaignIds.size,          // kỳ vọng: 0
    layDuoc: getSelectedCampaigns().length,             // kỳ vọng: 0
    toolbar: document.getElementById('replicateToolbar').style.display // kỳ vọng: "none"
  };
})()
```

Rồi thử giữ lựa chọn khi **chỉ đổi kỳ** (cùng tab) — lựa chọn phải còn.

---

## ✅ Checkpoint đợt 2

```bash
npm test
```

| Kiểm tra | Kỳ vọng |
|---|---|
| `npm test` | 51/51 pass |
| Payload mặc định | 419.764 → ~43.000 bytes |
| Payload nén trên dây | ~6.000 bytes |
| Header `Content-Encoding` | `gzip` |
| Bất biến KPI mọi tổ hợp | OK (lệnh `node -e` ở P-01) |
| Đổi tab khi đang chọn CĐ | toolbar biến mất, không còn lỗi 400 |

```bash
git add -A && git commit -m "perf: dot 2 - loc CD rong khoi payload (-89%), gzip bang zlib (-94%), tia lua chon CD theo view"
```

---

# ĐỢT 3 — Test, an toàn thao tác, trải nghiệm (~4 giờ)

---

## Q-01 — Test cho `cross-post.js`

**Mức độ:** Nặng
**File:** `test/cross-post.test.js` (tạo mới) + `src/cross-post.js`

### Vấn đề

49 test hiện có bao phủ toàn bộ code **đọc**. `cross-post.js` (1.381 dòng) là module **duy nhất ghi lên Meta** — tạo chiến dịch, nhóm QC, quảng cáo, bài đăng — và không có test nào.

| Module | Số test |
|---|---|
| `report.js` | ~28 |
| `meta-api.js` | ~8 |
| `google-sheet.js` | ~6 |
| `ai-analyst.js` / `export-csv.js` | ~4 |
| `server.js` | 3 (grep nội dung file, không gọi HTTP) |
| **`cross-post.js` (1.381 dòng)** | **0** |

Không route nào của `server.js` được test qua HTTP thật — **đó chính là lý do F-01 và S-01 đi qua được**.

### Bước 1 — Tách hàm dựng payload ra để test được

`src/cross-post.js`, route `/create-adset` (dòng 691). Rút phần dựng body ra thành hàm export, **ngay trước** route:

```js
/**
 * Dựng body gửi Meta cho một Adset mới.
 *
 * Tách khỏi route để test được mà không cần mock fetch hay gọi Meta thật.
 * Những bất biến ở đây bảo vệ tài khoản quảng cáo: status LUÔN PAUSED, và
 * targeting không bao giờ rỗng (geo mặc định VN) để Meta không tự mở toàn cầu.
 */
export function buildAdsetBody({
  campaignId, name, pageId, dailyBudget = 100000,
  targeting = {}, optimizationGoal = 'CONVERSATIONS'
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

  return {
    name: String(name).trim(),
    campaign_id: campaignId,
    status: 'PAUSED',              // BẮT BUỘC — không bao giờ tạo ở trạng thái chạy
    optimization_goal: optimizationGoal,
    billing_event: 'IMPRESSIONS',
    daily_budget: String(Math.round(Number(dailyBudget))),
    promoted_object: { page_id: pageId },
    targeting: finalTargeting
  };
}
```

Rồi trong route, thay toàn bộ khối dựng `finalTargeting` + `adsetBody` bằng:

```js
  const adsetBody = buildAdsetBody({
    campaignId, name, pageId, dailyBudget, targeting, optimizationGoal
  });
```

Làm tương tự cho `/create-campaign` → `buildCampaignBody({ name, objective, dailyBudget })`.

### Bước 2 — Tập trung các giới hạn an toàn vào một nơi

`src/cross-post.js`, gần đầu file (cạnh `const BASE_URL`):

```js
/**
 * Giới hạn chống spam API Meta. Đây là những con số BẢO VỆ TÀI KHOẢN QUẢNG CÁO —
 * đừng đổi mà không có lý do nghiệp vụ, và có test khoá lại từng con số.
 */
export const SAFETY_LIMITS = {
  PUBLISH_MAX_PAGES:     10,
  BULK_REPLICATE_MAX:    10,
  BATCH_ADS_MAX:         15,
  ANALYZE_CAMPAIGNS_MAX: 20,
  DELAY_PUBLISH_MS:      1500,
  DELAY_CREATE_MS:       2000,
  DELAY_TARGET_MS:       2500
};
```

Rồi thay các số viết cứng trong file bằng `SAFETY_LIMITS.*`.

### Bước 3 — Viết test

Tạo `test/cross-post.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdsetBody, SAFETY_LIMITS } from '../src/cross-post.js';

// ---------------------------------------------------------------------------
// Dựng payload — không gọi mạng
// ---------------------------------------------------------------------------

test('create-adset: luôn PAUSED', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p' });
  assert.equal(b.status, 'PAUSED');
});

test('create-adset: không truyền geo thì mặc định Việt Nam', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p' });
  assert.deepEqual(b.targeting.geo_locations, { countries: ['VN'] });
});

test('create-adset: placements rỗng thì KHÔNG gửi publisher_platforms', () => {
  // Gửi mảng rỗng khiến Meta từ chối toàn bộ request; để trống thì Meta tự
  // chọn tất cả placements — đó mới là hành vi mong muốn.
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', targeting: { placements: [] } });
  assert.equal('publisher_platforms' in b.targeting, false);
});

test('create-adset: ngân sách được làm tròn và gửi dạng chuỗi', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'p', dailyBudget: 99999.7 });
  assert.equal(b.daily_budget, '100000');
  assert.equal(typeof b.daily_budget, 'string');
});

test('create-adset: tên bị cắt khoảng trắng hai đầu', () => {
  const b = buildAdsetBody({ campaignId: '1', name: '  Nhom QC  ', pageId: 'p' });
  assert.equal(b.name, 'Nhom QC');
});

test('create-adset: promoted_object luôn mang page_id', () => {
  const b = buildAdsetBody({ campaignId: '1', name: 'x', pageId: 'page_123' });
  assert.deepEqual(b.promoted_object, { page_id: 'page_123' });
});

// ---------------------------------------------------------------------------
// Giới hạn an toàn — khoá lại để không bị đổi âm thầm
// ---------------------------------------------------------------------------

test('giới hạn chống spam API giữ đúng giá trị đã chốt', () => {
  assert.equal(SAFETY_LIMITS.PUBLISH_MAX_PAGES,     10);
  assert.equal(SAFETY_LIMITS.BULK_REPLICATE_MAX,    10);
  assert.equal(SAFETY_LIMITS.BATCH_ADS_MAX,         15);
  assert.equal(SAFETY_LIMITS.ANALYZE_CAMPAIGNS_MAX, 20);
  assert.ok(SAFETY_LIMITS.DELAY_PUBLISH_MS >= 1500, 'giãn cách đăng bài ≥ 1,5s');
  assert.ok(SAFETY_LIMITS.DELAY_CREATE_MS  >= 2000, 'giãn cách tạo QC ≥ 2s');
});
```

### Bước 4 — Test cho các route xuất file (khoá lại F-01)

Tạo `test/export-routes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3572;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer() {
  const proc = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/session`)).ok) return proc; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Server không khởi động được');
}

/**
 * F-01: href tĩnh trong index.html làm mọi lần xuất đều ra file ALL/last_30d.
 * Backend vẫn đúng — test này khoá lại điều đó để lần sau nếu ai sửa readOptions()
 * làm mất khả năng lọc thì biết ngay.
 */
test('F-01: /api/export/campaigns tôn trọng bộ lọc trong query', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const dem = async (url) => (await (await fetch(url)).text()).split('\n').length;

  const all  = await dem(`${BASE}/api/export/campaigns?includeEmpty=1`);
  const uckid = await dem(`${BASE}/api/export/campaigns?product=uckid&includeEmpty=1`);

  assert.ok(uckid < all, `lọc UCKID (${uckid}) phải ít dòng hơn tất cả (${all})`);
  assert.ok(uckid > 1,   'phải có ít nhất 1 dòng dữ liệu ngoài header');
});

test('F-01: tên file tải về mang đúng bộ lọc', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`${BASE}/api/export/campaigns?product=uckid&datePreset=last_month`);
  const cd = res.headers.get('content-disposition');
  assert.match(cd, /chien_dich_uckid_last_month\.csv/);
});

test('/api/* không khớp route nào phải trả 404 JSON, không phải index.html', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`${BASE}/api/khong-ton-tai`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
});
```

### Kiểm chứng

```bash
npm test
```

**Kỳ vọng:** ~64 test pass (49 cũ + 2 CSS/guard + 7 cross-post + 3 export + 3 route).

---

## F-05 — Chốt chống chạy trùng cho `publish` và `batch-create-ads`

**Mức độ:** Vừa
**File:** `src/cross-post.js`

### Vấn đề

`/bulk-replicate` có cờ `bulkInFlight` và trả 429 nếu đang chạy. Hai route còn lại — **cũng tạo đối tượng thật trên Meta** — không có chốt nào.

| Route | Chốt | Max | PAUSED | Giãn cách |
|---|---|---|---|---|
| `bulk-replicate` | ✅ `bulkInFlight` | 10 | ✅ | 2–3 s |
| `batch-create-ads` | ❌ **không có** | 15 | ✅ | 1,2–1,5 s |
| `publish` | ❌ **không có** | 10 trang | — | 1,5 s |

Request chạy 20–40 giây mà không có phản hồi trung gian, nên việc người dùng bấm lại nút **Thực thi** là hoàn toàn dễ hiểu. Kết quả: mọi bài đăng / quảng cáo bị tạo **hai lần**.

### Cách sửa

`src/cross-post.js`, thêm gần `let bulkInFlight = false;` (dòng 947):

```js
/**
 * Chặn chạy trùng theo tên việc.
 *
 * Các route này tạo đối tượng THẬT trên Meta và mất 20–60 s mới trả lời, nên
 * người dùng rất dễ bấm lại nút Thực thi — và tạo gấp đôi mọi thứ.
 *
 * Dùng res.on('finish'/'close') chứ không dùng try/finally trong handler: nếu
 * client đóng kết nối giữa đường, 'close' vẫn bắn và chốt được nhả ra.
 */
const running = new Set();
function withLock(jobName) {
  return (req, res, next) => {
    if (running.has(jobName)) {
      return res.status(429).json({
        ok: false,
        error: 'Lệnh trước chưa xong. Đợi hoàn tất rồi thử lại để tránh tạo trùng.'
      });
    }
    running.add(jobName);
    const release = () => running.delete(jobName);
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}
```

Rồi gắn vào 2 route. Dòng 372:

```js
crossPostRouter.post('/publish', withLock('publish'), async (req, res) => {
```

Dòng 764:

```js
crossPostRouter.post('/batch-create-ads', withLock('batchAds'), async (req, res) => {
```

### Phía client — khóa nút ngay khi bấm

`public/js/cross-post-app.js`, bước 4 của Studio (khoảng dòng 1648). Bọc toàn bộ thao tác:

```js
const execBtn = document.getElementById('studioExecuteBtn');
if (execBtn.dataset.running === '1') return;   // chốt phía client
execBtn.dataset.running = '1';
execBtn.disabled = true;
try {
  // ... toàn bộ chuỗi create-campaign → create-adset → batch-create-ads ...
} finally {
  execBtn.dataset.running = '0';
  execBtn.disabled = false;
}
```

### Kiểm chứng

Hai terminal, chạy gần như đồng thời:

```bash
curl -s -X POST -H 'Content-Type: application/json' -H "X-Internal-Token: $TOKEN" -d '{"targetPageIds":["1"],"sourcePostId":"x"}' http://127.0.0.1:3000/api/cp/publish
```

Lần thứ hai (trong lúc lần đầu đang chạy) phải trả:

```json
{ "ok": false, "error": "Lệnh trước chưa xong. Đợi hoàn tất rồi thử lại để tránh tạo trùng." }
```

với HTTP `429`.

---

## P-03 — Debounce ô tìm kiếm

**Mức độ:** Vừa
**File:** `public/js/app.js`

### Vấn đề

`tableSearchInput` gọi `renderTable()` trên **từng** sự kiện `input`:

```
renderTable · 605 dòng (lọc ALL)  : 84,3 ms
renderTable ·  28 dòng (lọc ACTIVE): 15,1 ms

Gõ 16 ký tự × 84,3 ms = ~1.349 ms chặn luồng chính
```

Người dùng thấy chữ nhảy từng nhịp.

### Cách sửa

`public/js/app.js` **dòng 259–266**. Thay:

```js
  // Table search & status filter
  const tableSearchInput = document.getElementById('tableSearchInput');
  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      renderTable();
    });
  }
```

bằng:

```js
  // Table search & status filter
  const tableSearchInput = document.getElementById('tableSearchInput');
  if (tableSearchInput) {
    // Hoãn 180 ms: đủ để người dùng gõ xong một từ, vẫn cảm giác tức thì.
    // Không hoãn thì mỗi ký tự dựng lại cả bảng (84 ms với 605 dòng) — gõ một
    // từ khoá 16 ký tự tạo ra ~1,3 giây công việc chặn luồng chính.
    const applySearch = debounce(() => renderTable(), 180);
    tableSearchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      applySearch();
    });
  }
```

Và thêm helper vào khu **Utilities** (cạnh `formatNumber`, khoảng dòng 100):

```js
/** Gộp các lần gọi liên tiếp thành một lần, sau `ms` kể từ lần gọi cuối. */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
```

### Kiểm chứng

DevTools → Performance → record → gõ nhanh `ucmas khai giang` vào ô tìm kiếm → stop.
**Kỳ vọng:** 1 khối `renderTable` (không phải 16). Sau P-01 mỗi khối cũng chỉ còn ~16 ms.

---

## P-04 — Cập nhật biểu đồ tại chỗ

**Mức độ:** Vừa
**File:** `public/js/app.js`

### Vấn đề

Cả 3 hàm `renderDailyChart`, `renderCampaignChart`, `renderPlacementChart` đều mở đầu bằng `if (chart) chart.destroy()` rồi `new Chart(...)`.

```
renderAll (3 × destroy + 3 × new Chart) : 58,1 ms
renderTable chỉ chiếm                   : 15,1 ms
→ phần còn lại (~43 ms) phần lớn là dựng lại biểu đồ
```

Chart.js hỗ trợ cập nhật dữ liệu tại chỗ — rẻ hơn nhiều và giữ được animation chuyển tiếp thay vì nháy canvas.

### Cách sửa — mẫu cho `renderDailyChart`

Tách phần config ra, rồi:

```js
function renderDailyChart() {
  const canvas = document.getElementById('dailyPerformanceChart');
  if (!canvas) return;

  const daily = appState.view?.dailyTrend || [];
  const unit = appState.view?.trendGranularity?.unit || 'day';

  // Không có dữ liệu: huỷ hẳn để canvas trống, không để biểu đồ cũ sót lại.
  if (daily.length === 0) {
    if (dailyChart) { dailyChart.destroy(); dailyChart = null; }
    return;
  }

  const labels = buildTrendLabels(daily, unit);
  updateTrendHint();

  // Lần đầu thì tạo; các lần sau chỉ thay dữ liệu.
  // destroy + new Chart mỗi lần đổi bộ lọc tốn ~14 ms/biểu đồ và làm canvas nháy.
  if (!dailyChart) {
    dailyChart = new Chart(canvas.getContext('2d'), dailyChartConfig(daily, labels));
    return;
  }

  dailyChart.data.labels = labels;
  dailyChart.data.datasets[0].data = daily.map(d => d.spend);
  dailyChart.data.datasets[1].data = daily.map(d => d.messages);
  dailyChart.update('none');   // 'none' = không animate khi chỉ đổi bộ lọc
}
```

Trong đó `dailyChartConfig(daily, labels)` là đúng object `{ type, data, options }` đang viết inline hiện tại — tách ra thành hàm riêng, nhận `daily` qua closure cho callback tooltip.

> **Lưu ý:** callback tooltip của biểu đồ ngày dùng biến `daily` để tra CPA.
> Khi cập nhật tại chỗ, đổi nó sang đọc `appState.view.dailyTrend[ctx.dataIndex]`
> thay vì biến `daily` bị đóng băng lúc tạo chart.

Làm tương tự cho 2 biểu đồ còn lại (`campaignChart` dùng top-8 theo chi tiêu, `placementChart` dùng doughnut — chỉ cần thay `data.labels` và `datasets[0].data` + `backgroundColor`).

### Kiểm chứng

DevTools Console:

```js
let t = performance.now(); renderAll(); console.log('renderAll:', (performance.now() - t).toFixed(1), 'ms');
// Kỳ vọng: < 20 ms (trước: 58,1 ms)
```

---

## U-04 — Sắp xếp bảng bằng bàn phím + `aria-sort`

**Mức độ:** Vừa
**File:** `public/index.html`, `public/css/style.css`, `public/js/app.js`

### Vấn đề

Trình xử lý sắp xếp gắn trên `<th>` qua sự kiện `click`. `<th>` không nhận focus và không có xử lý bàn phím → **không có cách nào sắp xếp bảng mà không dùng chuột**.

```
th[data-sort]          : 16
th[aria-sort]          : 0
th[scope]              : 0
th có tabindex/button  : 0
<caption>              : không có
```

### Bước 1 — Bọc nội dung `<th>` bằng `<button>`

`public/index.html` dòng 416–431. Mẫu cho từng `<th>` sắp xếp được:

```html
<th scope="col" data-sort="spend" class="text-right">
  <button type="button" class="th-sort">Chi tiêu kỳ</button>
</th>
```

Áp dụng cho cả 16 `<th data-sort="...">`. Riêng `<th class="th-checkbox">` giữ nguyên (không sắp xếp).

Thêm `<caption>` cho trình đọc màn hình, ngay sau `<table ...>`:

```html
<caption class="visually-hidden">
  Danh sách chiến dịch với chi tiêu, tin nhắn, CPA và phễu tuyển sinh L1–L4.
  Bấm tiêu đề cột để sắp xếp.
</caption>
```

### Bước 2 — CSS

`public/css/style.css`:

```css
/* Nút trong tiêu đề bảng: chỉ thêm khả năng focus + phím Enter/Space,
   không đổi hình dạng. `all: unset` xoá style mặc định của button, rồi
   `justify-content: inherit` giữ được căn phải của .text-right. */
.th-sort {
  all: unset;
  cursor: pointer;
  font: inherit;
  color: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  justify-content: inherit;
}
.th-sort:focus-visible {
  outline: 2px solid var(--primary-text);
  outline-offset: 2px;
  border-radius: 3px;
}
```

### Bước 3 — Duy trì `aria-sort`

`public/js/app.js`, trong `renderTable()`. Tìm:

```js
  document.querySelectorAll('#campaignsDataTable th[data-sort]').forEach(th => {
    const isActive = th.getAttribute('data-sort') === field;
    th.classList.toggle('sorted', isActive);
    th.classList.toggle('asc', isActive && appState.sortAsc);
  });
```

Thêm vào trong vòng lặp:

```js
    // Cho trình đọc màn hình biết cột nào đang sắp xếp và theo chiều nào.
    th.setAttribute('aria-sort',
      isActive ? (appState.sortAsc ? 'ascending' : 'descending') : 'none');
```

> Listener `click` trên `thead` **vẫn hoạt động nguyên vẹn** vì
> `e.target.closest('th[data-sort]')` bắt được click phát ra từ bên trong `<button>`.

### Kiểm chứng

1. Bấm `Tab` nhiều lần → focus phải đi qua từng tiêu đề cột, có viền focus rõ
2. Nhấn `Enter` trên một tiêu đề → bảng sắp xếp lại
3. DevTools Console:

```js
[...document.querySelectorAll('#campaignsDataTable th[data-sort]')]
  .map(th => `${th.dataset.sort}: ${th.getAttribute('aria-sort')}`);
// Kỳ vọng: đúng 1 cột là "descending"/"ascending", còn lại "none"
```

---

## U-05 — Bẫy focus + đóng modal bằng Esc

**Mức độ:** Vừa
**File:** `public/js/app.js`, `public/css/style.css`

### Vấn đề

`#configModal` và `#replicateModal` là `div.modal-overlay` thường:

```
.modal-overlay[tabindex]    : 0
xử lý phím Escape           : không có
click ra ngoài để đóng      : chỉ configModal
quy tắc :focus-visible      : 3 (date-input, select/input, product-card)
```

Mở modal rồi nhấn `Tab` sẽ đi lạc ra các control phía sau lớp phủ. Modal nhân bản còn nguy hiểm hơn vì nó **tạo quảng cáo thật**.

### Cách sửa

`public/js/app.js`, thêm vào khu Utilities:

```js
/**
 * Bẫy focus trong modal và đóng bằng Esc.
 *
 * Không có nó, Tab đi lạc ra các control sau lớp phủ — đặc biệt nguy hiểm với
 * modal nhân bản vì nó tạo quảng cáo THẬT trên Meta và người dùng bàn phím
 * không thấy mình đang ở đâu.
 *
 * Trả về { open, close } để bên gọi tự quyết định khi nào bật/tắt lớp phủ.
 */
function trapModal(modal, onClose) {
  const SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  let restoreTo = null;

  function focusables() {
    return [...modal.querySelectorAll(SEL)].filter(el => !el.disabled && el.offsetParent);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    onClose();
    restoreTo?.focus();   // trả focus về chỗ người dùng đang đứng trước khi mở
  }

  return {
    open() {
      restoreTo = document.activeElement;
      document.addEventListener('keydown', onKey);
      focusables()[0]?.focus();
    },
    close
  };
}
```

Dùng cho `#configModal` — thay 2 hàm `openModal` / `closeModal` hiện tại:

```js
  const configTrap = trapModal(configModal, () => {
    configModal.classList.remove('open');
    const alertBox = document.getElementById('configAlertBox');
    if (alertBox) alertBox.classList.add('d-none');
  });

  const openModal = () => { configModal.classList.add('open'); configTrap.open(); };
  const closeModal = () => configTrap.close();
```

Làm tương tự trong `replicate-modal.js` cho `#replicateModal`.
**Lưu ý:** modal nhân bản phải **từ chối đóng** khi `mState.isExecuting` — thêm vào `onClose`:

```js
    if (mState.isExecuting && !confirm('Đang tạo quảng cáo trên Meta. Đóng cửa sổ?')) return;
```

### Thêm quy tắc focus chung

`public/css/style.css`:

```css
/* Trạng thái focus cho mọi control tương tác. Trước đây chỉ 3 selector có
   :focus-visible, nên phần lớn giao diện không dùng được bằng bàn phím. */
.btn:focus-visible,
.btn-tool-item:focus-visible,
.tab-btn:focus-visible,
.btn-close:focus-visible,
.dropdown-item:focus-visible,
.campaign-row-chk:focus-visible {
  outline: 2px solid var(--primary-text);
  outline-offset: 2px;
}
```

### Kiểm chứng

1. Mở modal Cài đặt Token → nhấn `Tab` liên tục → focus **chỉ** đi trong modal, quay vòng
2. Nhấn `Esc` → modal đóng, focus trở về nút "Cài đặt Token"
3. Mở modal nhân bản → nhấn `Esc` → đóng; nếu đang thực thi → hỏi xác nhận

---

## ✅ Checkpoint đợt 3

```bash
npm test
```

| Kiểm tra | Kỳ vọng |
|---|---|
| `npm test` | ~64 pass |
| `renderAll` | < 20 ms (trước 58,1 ms) |
| Gõ 16 ký tự vào ô tìm kiếm | 1 lần `renderTable` |
| POST `publish` lần 2 khi đang chạy | `429` |
| `Tab` + `Enter` trên tiêu đề cột | sắp xếp được |
| `Esc` trong modal | đóng, focus trở về |

```bash
git add -A && git commit -m "test+ux: dot 3 - test cross-post & export routes, chot chong chay trung, debounce, chart tai cho, a11y bang & modal"
```

---

# ĐỢT 4 — Khi có thời gian

---

## U-03 — Nhóm cột bật/tắt cho bảng 17 cột

**Mức độ:** Vừa · **File:** `index.html`, `style.css`, `app.js`

Đo được: `.table-responsive` rộng **1.152 px**, bảng cần **1.931 px** → phải cuộn ngang **779 px** (≈11/17 cột). Các cột tuyển sinh (L1, L3, L4, Doanh thu) và cột Nền tảng — phần giá trị nhất — luôn nằm ngoài tầm mắt.

Hai cột ghim đã hoạt động đúng (`td[0] left 0px`, `td[1] left 44px`).

### Cách sửa

`public/index.html` — thêm vào `.table-controls`:

```html
<div class="col-group-toggle" role="group" aria-label="Nhóm cột hiển thị">
  <button type="button" data-colgroup="meta"     class="chip active">Chỉ số Meta</button>
  <button type="button" data-colgroup="funnel"   class="chip active">Tuyển sinh</button>
  <button type="button" data-colgroup="platform" class="chip">Nền tảng</button>
</div>
```

Gắn nhãn nhóm vào từng `<th>`:

```html
<th scope="col" data-sort="cpa"     data-col="meta"     class="text-right"><button type="button" class="th-sort">Giá/tin</button></th>
<th scope="col" data-sort="l1Count" data-col="funnel"   class="text-right"><button type="button" class="th-sort">SĐT (L1)</button></th>
<th scope="col" data-sort="fbSpend" data-col="platform"><button type="button" class="th-sort">Nền tảng</button></th>
```

`public/css/style.css`:

```css
.data-table.hide-platform [data-col="platform"] { display: none; }
.data-table.hide-funnel   [data-col="funnel"]   { display: none; }
.data-table.hide-meta     [data-col="meta"]     { display: none; }

.col-group-toggle { display: flex; gap: 4px; }
.chip {
  padding: 4px 10px; border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle); background: transparent;
  color: var(--text-muted); font-size: 0.76rem; font-weight: 600; cursor: pointer;
  transition: var(--transition-fast);
}
.chip.active { background: var(--surface-2); color: var(--text-primary); border-color: var(--border-medium); }
```

`public/js/app.js`:

```js
/**
 * 17 cột cần 1.931 px nhưng khung chỉ có 1.152 px. Cho người dùng chọn nhóm cột
 * cần xem; nhớ lựa chọn giữa các phiên để không phải bật lại mỗi lần mở.
 */
const COL_GROUPS = ['meta', 'funnel', 'platform'];

function hiddenColGroups() {
  try { return JSON.parse(localStorage.getItem('hiddenColGroups') || '["platform"]'); }
  catch { return ['platform']; }
}

function applyColGroups() {
  const off = hiddenColGroups();
  const table = document.getElementById('campaignsDataTable');
  if (!table) return;
  COL_GROUPS.forEach(g => table.classList.toggle(`hide-${g}`, off.includes(g)));
  document.querySelectorAll('[data-colgroup]').forEach(b =>
    b.classList.toggle('active', !off.includes(b.dataset.colgroup)));
}

document.querySelectorAll('[data-colgroup]').forEach(btn => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.colgroup;
    const off = hiddenColGroups();
    const next = off.includes(g) ? off.filter(x => x !== g) : [...off, g];
    localStorage.setItem('hiddenColGroups', JSON.stringify(next));
    applyColGroups();
  });
});
```

Gọi `applyColGroups()` ở cuối `renderTable()`.

> **Hai việc dễ quên khi làm mục này:**
> 1. Hàm dựng dòng trong `renderTable()` **cũng phải** gắn `data-col` tương ứng cho từng `<td>`
> 2. `colspan="17"` của dòng "không tìm thấy" → đổi thành `colspan="99"`

### Kiểm chứng

```js
const tr = document.querySelector('.table-responsive');
({ khung: tr.clientWidth, bang: tr.scrollWidth, canCuon: tr.scrollWidth > tr.clientWidth });
// Kỳ vọng với nhóm mặc định (ẩn Nền tảng): canCuon = false
```

---

## F-04 — Tiến độ thật cho nhân bản hàng loạt

**Mức độ:** Vừa · **File:** `src/cross-post.js`, `public/js/replicate-modal.js`

`POST /api/cp/bulk-replicate` chạy vòng lặp tối đa 10 mục, mỗi mục 2–3 s giãn cách cộng nhiều lượt gọi Meta:

```
10 mục × (2.000 + 2.000 + 2.500 ms) ≈ 65 s trong MỘT request
callMeta timeout                     : 35.000 ms / mỗi lượt gọi
Tiến trình client                    : 10% → (chờ mù) → 100%
Tiến trình server                    : không có endpoint nào để hỏi
```

Nếu kết nối đứt hoặc người dùng đóng tab, các chiến dịch/quảng cáo **đã được tạo thật trên Meta** mà không có cách nào biết đã tạo tới đâu.

### Cách sửa — mô hình job

`src/cross-post.js`:

```js
import crypto from 'node:crypto';

/**
 * Các việc tạo hàng loạt chạy 30–60 s. Giữ trạng thái ở server để client hỏi
 * được tiến độ, và để kết quả không mất khi rớt kết nối giữa đường — những gì
 * đã tạo trên Meta là THẬT và tốn tiền.
 *
 * Job tự hết hạn sau 1 giờ để Map không phình mãi.
 */
const jobs = new Map();
const JOB_TTL_MS = 3600000;

function newJob(total) {
  const id = crypto.randomUUID();
  jobs.set(id, { status: 'running', done: 0, total, results: [], error: null, at: Date.now() });
  // Dọn job cũ mỗi lần tạo job mới — không cần timer riêng.
  for (const [k, v] of jobs) if (Date.now() - v.at > JOB_TTL_MS) jobs.delete(k);
  return id;
}

crossPostRouter.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Không tìm thấy tiến trình (có thể đã hết hạn).' });
  res.json({ ok: true, ...job });
});
```

Sửa `/bulk-replicate` để trả về ngay:

```js
crossPostRouter.post('/bulk-replicate', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Danh sách nhân bản trống.' });
  }
  if (items.length > SAFETY_LIMITS.BULK_REPLICATE_MAX) {
    return res.status(400).json({ ok: false, error: `Tối đa ${SAFETY_LIMITS.BULK_REPLICATE_MAX} mục mỗi lần để bảo vệ tài khoản Meta.` });
  }
  if (bulkInFlight) {
    return res.status(429).json({ ok: false, error: 'Đang có 1 lệnh nhân bản khác đang chạy.' });
  }

  const jobId = newJob(items.length);
  res.json({ ok: true, jobId, total: items.length });   // trả về NGAY, không chờ

  bulkInFlight = true;
  const job = jobs.get(jobId);
  runBulkReplicate(items, job)            // vòng lặp hiện tại, tách thành hàm riêng
    .then(() => { job.status = 'done'; })
    .catch(err => { job.status = 'error'; job.error = err.message; })
    .finally(() => { bulkInFlight = false; });
});
```

Trong `runBulkReplicate()`, sau mỗi mục xong:

```js
    job.results.push(result);
    job.done += 1;
```

`public/js/replicate-modal.js` — thay chỗ `await` một request dài:

```js
const { jobId, total } = await (await fetch('/api/cp/bulk-replicate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Internal-Token': mState.sessionToken },
  body: JSON.stringify({ items })
})).json();

// Hỏi mỗi 1,5 s: đủ mượt cho thao tác 2–3 s/mục, không dồn request lên server.
while (true) {
  await new Promise(r => setTimeout(r, 1500));
  const job = await (await fetch(`/api/cp/job/${jobId}`)).json();
  if (!job.ok) throw new Error(job.error);

  progressFill.style.width = `${Math.round((job.done / total) * 100)}%`;
  renderPartialResults(job.results);        // hiện từng dòng NGAY khi xong
  if (job.status !== 'running') {
    if (job.status === 'error') throw new Error(job.error);
    break;
  }
}
```

Hiện `jobId` trên giao diện để người dùng tra lại được nếu rớt mạng:

```js
stepContent.insertAdjacentHTML('beforeend',
  `<p style="font-size:0.74rem;color:var(--text-muted);margin-top:8px;">
     Mã tiến trình: <code>${esc(jobId)}</code> — nếu mất kết nối, mở
     <code>/api/cp/job/${esc(jobId)}</code> để xem kết quả.
   </p>`);
```

Áp dụng cùng mô hình cho `/batch-create-ads` (15 mục × nhiều nhóm đích, còn lâu hơn) và `/publish`.

---

## Q-02 — Dọn `fatigueApplicable`

**Mức độ:** Vừa · **File:** `report.js`, `ai-analyst.js`, `export-csv.js`, `PROJECT_CONTEXT.md`

`report.js:647` trả về **cứng** `fatigueApplicable: true` (vì tần suất đã chuyển sang cửa sổ cố định 30 ngày). Nhưng bộ máy phân nhánh cho trường hợp `false` vẫn còn, và tài liệu nói ngược:

```
report.js:647     : fatigueApplicable: true (hằng số)
ai-analyst.js:105 : view.fatigueApplicable !== false   ← luôn true
ai-analyst.js:131 : nhánh fatiguePart cho false        ← code chết
export-csv.js:45  : campaignFields(fatigueApplicable)  ← tham số vô dụng
export-csv.js:72  : nhãn 'Tần suất (kỳ đồng bộ)'       ← nay là 30 ngày
PROJECT_CONTEXT §8: nói false khi lệch kỳ              ← sai
```

### Có một quyết định nghiệp vụ, không chỉ dọn code

Khi người dùng chọn **"Hôm qua"**, một chiến dịch vẫn bị gắn nhãn **⚠️ Fatigue** dựa trên tần suất của **30 ngày**. Điều đó hợp lý (bão hoà creative là hiện tượng dài hạn) nhưng **giao diện không nói ra**, và cột CSV mang nhãn sai.

### Việc cần làm

1. Bỏ tham số `fatigueApplicable` khỏi `classifyCampaign()` và `campaignFields()`
2. Xoá nhánh `fatiguePart` cho trường hợp `false` trong `ai-analyst.js:131`
3. Giữ `view.fatigueApplicable` trong payload (client đang đọc) nhưng ghi comment rõ: luôn `true` từ 21/10/2026
4. `src/export-csv.js:72` — đổi nhãn:

```js
    { key: 'frequency', label: 'Tần suất (30 ngày gần nhất)' },
```

5. Thêm tooltip cho nhãn Fatigue trong bảng (`public/js/app.js`, `renderTable()`), lấy từ `view.frequencyWindow` thay vì viết cứng:

```js
    const fatigueHint = appState.view?.frequencyWindow === 'last_30d'
      ? 'Tần suất 30 ngày gần nhất — không phụ thuộc kỳ đang xem'
      : `Tần suất kỳ ${appState.view?.frequencyWindow}`;
    if (isFatigue) tagHtml = `<span class="pill tone-warning" title="${esc(fatigueHint)}">⚠️ Fatigue</span>`;
```

6. Cập nhật `PROJECT_CONTEXT.md §8`

---

## Q-03 — Thống nhất số phiên bản schema

**Mức độ:** Vừa · **File:** `meta-api.js`, `server.js`, `report.js`, `PROJECT_CONTEXT.md`

Bốn con số khác nhau cho cùng một thứ:

```
meta-api.js:465    : return { version: 4, ... }   ← giá trị thật
meta-api.js:391    : comment "format version 2"   ← sai
server.js:47       : comment "format version 3"   ← sai
report.js:624      : schemaVersion: 5             ← của VIEW, khác khái niệm
PROJECT_CONTEXT §7 : "schemaVersion": 4           ← sai
```

### Cách sửa — tách tên hai khái niệm

`src/meta-api.js`, gần đầu file:

```js
/**
 * SNAPSHOT_VERSION — phiên bản của data/latest_insights.json (dữ liệu hạt lựu).
 * VIEW_VERSION     — phiên bản của payload buildView() gửi cho client.
 *
 * Hai số này KHÁC nhau và tăng độc lập. Trước đây cả hai bị gọi lẫn là
 * "format version" với bốn giá trị khác nhau rải trong comment.
 */
export const SNAPSHOT_VERSION = 4;
export const SNAPSHOT_MIN_SUPPORTED = 2;
```

Dùng trong `fetchRawReport()`:

```js
    version: SNAPSHOT_VERSION,
```

`src/server.js`, `loadSnapshot()` — thay số viết cứng:

```js
import { fetchRawReport, SNAPSHOT_VERSION, SNAPSHOT_MIN_SUPPORTED } from './meta-api.js';

// ...
      if (parsed.version >= SNAPSHOT_MIN_SUPPORTED && parsed.version <= SNAPSHOT_VERSION) {
        rawReport = parsed;
      } else {
        console.warn(`[Server] Bỏ qua snapshot schema v${parsed.version} (hỗ trợ v${SNAPSHOT_MIN_SUPPORTED}–v${SNAPSHOT_VERSION}).`);
      }
```

Và sửa comment sai ở `src/server.js:47`:

```js
// Raw report cached in memory (snapshot schema v4, xem PROJECT_CONTEXT.md §7)
```

`src/report.js`:

```js
/** Phiên bản payload view gửi cho client. Khác SNAPSHOT_VERSION của kho dữ liệu. */
export const VIEW_VERSION = 5;
// ...
    schemaVersion: VIEW_VERSION,
```

Rồi cập nhật `PROJECT_CONTEXT.md §7` với bảng hai cột **snapshot** / **view**, và xoá comment sai ở `meta-api.js:391`.

---

## Các mục nhẹ còn lại

### P-05 — `analyze-campaigns` đọc lại 2 MB JSON từ disk mỗi lần gọi

**File:** `src/cross-post.js:968`, `src/server.js`

`data/latest_insights.json` = **2,03 MB**, `JSON.parse` = **14,7 ms** chặn event loop — cho dữ liệu đã có sẵn trong `rawReport` ở RAM.

`src/cross-post.js`, thêm gần đầu file:

```js
/**
 * server.js bơm hàm đọc rawReport vào đây khi khởi động.
 *
 * Tránh đọc + parse lại 2 MB JSON (14,7 ms) cho dữ liệu đã nằm trong RAM, và
 * tránh đọc được bản disk cũ hơn bản trong bộ nhớ.
 */
let getRawReport = () => null;
export function setRawReportProvider(fn) { getRawReport = fn; }
```

Trong `/analyze-campaigns`, thay khối `try { readFileSync(...) }`:

```js
  const raw = getRawReport();
  const campaignAccountMap = new Map(
    (raw?.campaigns || [])
      .filter(c => c.id && c.accountId)
      .map(c => [c.id, c.accountId])
  );
```

`src/server.js`, sau import:

```js
import { crossPostRouter, setRawReportProvider } from './cross-post.js';
// ...
setRawReportProvider(() => rawReport);
```

### P-06 — File cache ghi pretty-print, phình 31%

**File:** `src/google-sheet.js`

Đo được: `leads_cache.json` pretty **562 KB** → compact **389 KB** (−31%).

```diff
- fs.writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2), 'utf-8');
+ // Compact: file này chỉ được nạp lại khi server khởi động, không ai đọc bằng mắt.
+ // Pretty-print làm nó phình 31% (562 KB → 389 KB khi compact).
+ fs.writeFileSync(CACHE_PATH, JSON.stringify(result), 'utf-8');
```

Giữ nguyên `null, 2` cho `cp_pages_cache.json` và `cp_accounts_cache.json` — chúng chỉ 4–20 KB và hay cần kiểm tra bằng mắt.

### P-07 — `VIEW_CACHE_MAX = 32`

**File:** `src/server.js:19` — **không cần sửa** sau P-01.

Trước P-01: 32 × 390 KB ≈ 12,5 MB RAM giữ lại. Sau P-01: 32 × 42 KB ≈ 1,3 MB — hợp lý.
Thêm comment để không ai tăng con số này mà không tính lại:

```js
// 32 bản × ~42 KB ≈ 1,3 MB sau khi P-01 lọc chiến dịch rỗng khỏi payload.
// Nếu payload phình lại, tính lại con số này.
const VIEW_CACHE_MAX = 32;
```

### F-06 — `GET /api/cp/ad-accounts` khai báo hai lần

**File:** `src/cross-post.js:283` và `:477`

Express lấy route khớp đầu tiên → bản ở dòng 283 (đọc cache) luôn thắng, 30 dòng ở 477 (gọi Meta trực tiếp) **không bao giờ chạy**. Bản chết lại trả về nhiều trường hơn (`currency`, `status`, `amountSpent`) — ai đọc code sẽ tưởng các trường đó có sẵn.

Chọn **một** trong hai:

**Cách A (gọn nhất):** xoá route dòng 477.

**Cách B (tốt hơn cho giao diện):** giữ route 283 nhưng khi cache rỗng thì gọi Meta, và bổ sung trường:

```js
crossPostRouter.get('/ad-accounts', async (req, res) => {
  try {
    // Cache rỗng (chưa từng refresh, hoặc mất file disk) thì gọi Meta thay vì
    // trả mảng rỗng — người dùng không hiểu vì sao danh sách trống.
    if (adAccountsCache.length === 0) await fetchAndCachePages();
    res.json({
      ok: true,
      accounts: adAccountsCache,
      cacheAge: cacheUpdatedAt ? `${Math.round((Date.now() - cacheUpdatedAt) / 60000)} phút trước` : 'Chưa có'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

Và thêm vào `fields` của `fetchAndCachePages()` (dòng 207):

```js
      params: { fields: 'id,account_id,name,account_status,currency', limit: 100 }
```

```js
    adAccountsCache = (accResult.data || []).map(a => ({
      id: a.id,
      accountId: a.account_id || a.id.replace(/^act_/, ''),
      name: a.name,
      status: a.account_status,
      currency: a.currency || 'VND'
    }));
```

Rồi **xoá** route dòng 477.

### S-02 — `cross-post.html` nạp `lucide@latest`

**File:** `public/cross-post.html:14–18`

`index.html` ghim `lucide@0.460.0` kèm comment *"Pinned library versions (avoid breaking changes from @latest)"*. Trang Cross-Post vi phạm chính quy tắc đó, và còn 2 điểm lệch nữa:

| | index.html | cross-post.html |
|---|---|---|
| lucide | `0.460.0` ✅ | `latest` ❌ |
| `defer` | có ✅ | không ❌ |
| CSS `?v=` | `?v=20261020` ✅ | không có ❌ |

```diff
- <script src="https://unpkg.com/lucide@latest"></script>
- <link rel="stylesheet" href="/css/style.css">
- <link rel="stylesheet" href="/css/cross-post.css">
+ <!-- Ghim phiên bản như index.html: @latest có thể đổi bất cứ lúc nào và
+      làm vỡ trang mà không có thay đổi nào trong code của mình. -->
+ <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js" defer></script>
+ <link rel="stylesheet" href="/css/style.css?v=20261022">
+ <link rel="stylesheet" href="/css/cross-post.css?v=20261022">
```

Cập nhật `?v=` trong `index.html` thành cùng một chuỗi. Hoặc tốt hơn — bỏ hẳn việc phải nhớ, dùng cache dài hạn trong `src/server.js`:

```js
app.use(express.static(publicDir, {
  // Các asset được version hoá bằng ?v= trong HTML, nên cache dài hạn an toàn
  // và không còn phải lo trình duyệt giữ stylesheet cũ sau khi sửa.
  setHeaders(res, filePath) {
    if (/\.(css|js|png|ico|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
```

### U-06 — `--text-muted` dưới ngưỡng tương phản AA

**File:** `public/css/style.css:20`

```
--text-muted : #64748b → rgb(100, 116, 139)
--bg-main    : #07090e → rgb(7, 9, 14)
tương phản   : ≈ 4,2 : 1        (AA chữ thường cần 4,5)
đề xuất #7c8ba3 : ≈ 5,8 : 1
```

Màu này dùng cho `.sub-stat` (10,5 px), `.enrolled-date` (11 px), `.camp-id`, footer — **đúng những chỗ chữ nhỏ nhất**.

```diff
- --text-muted: #64748b;
+ /* Nâng từ #64748b (≈4,2:1 — dưới ngưỡng AA 4,5:1) lên ≈5,8:1. Màu này dùng
+    cho .sub-stat 10,5px và .enrolled-date 11px — đúng chỗ chữ nhỏ nhất. */
+ --text-muted: #7c8ba3;
```

Cùng lúc nâng cỡ chữ nhỏ nhất (vẫn vừa chỗ trong ô bảng):

```css
.sub-stat      { font-size: 11.5px; }   /* từ 10.5px */
.enrolled-date { font-size: 12px;   }   /* từ 11px   */
```

### U-07 — Thêm `prefers-reduced-motion` và stylesheet cho in

**File:** `public/css/style.css` — thêm vào cuối file

```
quy tắc @media (prefers-reduced-motion) : 0
quy tắc @media print                    : 0
```

Trang có animation vô hạn (`.top-progress`), transition 0,6 s cho thanh phễu, hover `translateY` trên thẻ.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .card-surface:hover, .product-card:hover, .enrolled-card:hover { transform: none; }
}

@media print {
  /* Giấy trắng mực đen: nền tối + glow in ra vừa tốn mực vừa khó đọc.
     Dashboard này hay được in / chụp để mang vào họp. */
  .bg-glow, .top-progress, .toast-container, .replicate-toolbar,
  .header-tool-group, #syncBtn, #navCrossPostBtn, .modal-overlay,
  .col-group-toggle, .table-controls { display: none !important; }

  body { background: #fff; color: #000; }

  .card-surface, .app-header, .kpi-card, .chart-card, .table-section, .ai-hero-card {
    background: #fff !important;
    border: 1px solid #999 !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
  }

  .table-responsive { overflow: visible !important; }
  .data-table { font-size: 9pt; }
  thead { display: table-header-group; }   /* lặp tiêu đề mỗi trang */
  tr { page-break-inside: avoid; }

  /* Cột ghim không có nghĩa trên giấy */
  .data-table th, .data-table td { position: static !important; }
}
```

**Kiểm chứng:** `Ctrl+P` → xem trước bản in; và bật "Emulate CSS prefers-reduced-motion" trong DevTools → Rendering.

### U-08 — 223 thuộc tính `style=` inline

**File:** `cross-post.html` (101), `replicate-modal.js` (69), `cross-post-app.js` (43), `index.html` (10)

Toàn bộ giao diện Cross-Post và wizard nhân bản dựng bằng style inline → đổi một token trong `style.css` **không lan tới đó**. Hai trang đã lệch nhau: `.cp-container` giới hạn **1400 px** còn `.app-layout` là **1480 px**.

Làm dần, không cần sửa hết một lượt:

1. **Ngay lập tức (1 dòng):** `public/css/cross-post.css:7` → `max-width: 1480px;` cho khớp dashboard
2. **Rút 3 class dùng nhiều nhất** trong wizard vào `replicate.css` — chỉ 3 class này đã thay được ~40 style inline:

```css
/* Thay thế các style inline lặp lại trong replicate-modal.js */
.rep-summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.rep-stat-box {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px;
}
.rep-hint { font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
```

3. **Quy ước mới** — ghi vào `.agents/rules/quy-tac-du-an.md`:

> Style inline chỉ được dùng cho giá trị **tính ở runtime** (`width: ${pct}%`, `background: ${color}`).
> Mọi thứ khác phải là class trong file CSS. Lý do: 223 thuộc tính `style=` hiện tại khiến design system không chạm được tới trang Cross-Post và wizard nhân bản.

### Q-04 — Trường payload không ai đọc

**File:** `src/report.js`

Đối chiếu từng trường của payload với toàn bộ frontend và danh sách cột CSV:

| Trường | Chi phí / 604 dòng | Frontend | CSV | Kết luận |
|---|---|---|---|---|
| `objective` | 12,0 KB | 0 | 0 | **bỏ được** |
| `status` | 5,3 KB | — | 0 | trùng `effective_status`, **bỏ được** |
| `igSpend` | 1,2 KB | 0 | 0 | có trong `platformBreakdown` |
| `msgSpend` | 1,2 KB | 0 | 0 | nt |
| `audSpend` | 1,2 KB | 0 | 0 | nt |
| `otherSpend` | 1,2 KB | 0 | 0 | nt |
| `fbSpend` | 1,5 KB | — | — | **phải giữ** — là khoá sort của cột Nền tảng |

Trong `buildView`, đổi `{ ...c, ... }` thành chọn trường tường minh. Việc này cũng khiến hình dạng payload trở nên rõ ràng, thay vì "bất cứ thứ gì `meta-api.js` tình cờ gắn vào".

Sau P-01 giá trị tuyệt đối tiết kiệm được nhỏ đi (chỉ còn 43 dòng), nhưng **lợi ích về tính rõ ràng thì vẫn nguyên**.

### Q-05 — 1,9 MB bản chụp code cũ trong thư mục làm việc

`.backups/backup_2026-10-15/`, `backup_before_data_lake/`, `backup_before_tabs_and_sheet/` đều chứa bản sao đầy đủ của `src/` và `public/`. Đã được `.gitignore` loại ra, nhưng vẫn nằm cạnh code thật — rủi ro là ai đó (hoặc một công cụ AI tìm kiếm cả cây thư mục) sửa nhầm file trong `.backups` và tưởng đã sửa code.

Git đã giữ toàn bộ lịch sử này rồi. Gắn tag cho các mốc rồi xoá:

```bash
git log --oneline -8
```

```bash
git tag snapshot/truoc-data-lake <commit-hash>
```

```bash
git tag snapshot/truoc-tabs-sheet <commit-hash>
```

```bash
git tag -l 'snapshot/*'
```

Chỉ khi lệnh trên liệt kê đủ tag mới xoá:

```bash
rm -rf .backups
```

---

# Checklist hoàn thành

| Mã | Mục | Đợt | ☐ |
|---|---|---|---|
| U-01 + F-03 | Thêm lại `<div id="reportContent">` | 1 | ☐ |
| U-02 | Định nghĩa 7 biến CSS còn thiếu | 1 | ☐ |
| F-01 | Gắn bộ lọc vào 3 link Xuất file | 1 | ☐ |
| S-01 | Chặn CSRF theo phương thức cho `/api/cp` | 1 | ☐ |
| P-01 | Lọc chiến dịch rỗng khỏi payload | 2 | ☐ |
| P-02 | Nén gzip bằng `zlib` | 2 | ☐ |
| F-02 | Tỉa lựa chọn chiến dịch theo view | 2 | ☐ |
| Q-01 | Test cho `cross-post.js` + route xuất file | 3 | ☐ |
| F-05 | Chốt chống chạy trùng | 3 | ☐ |
| P-03 | Debounce ô tìm kiếm | 3 | ☐ |
| P-04 | Cập nhật biểu đồ tại chỗ | 3 | ☐ |
| U-04 | Sắp xếp bằng bàn phím + `aria-sort` | 3 | ☐ |
| U-05 | Bẫy focus + Esc cho modal | 3 | ☐ |
| U-03 | Nhóm cột bật/tắt | 4 | ☐ |
| F-04 | Tiến độ thật cho nhân bản | 4 | ☐ |
| Q-02 | Dọn `fatigueApplicable` | 4 | ☐ |
| Q-03 | Thống nhất số phiên bản schema | 4 | ☐ |
| P-05 | Bỏ đọc lại JSON từ disk | 4 | ☐ |
| P-06 | Cache ghi compact | 4 | ☐ |
| P-07 | Comment cho `VIEW_CACHE_MAX` | 4 | ☐ |
| F-06 | Gộp route `ad-accounts` trùng | 4 | ☐ |
| S-02 | Ghim `lucide`, thêm `defer` + `?v=` | 4 | ☐ |
| U-06 | Nâng tương phản `--text-muted` | 4 | ☐ |
| U-07 | `prefers-reduced-motion` + print | 4 | ☐ |
| U-08 | Giảm style inline, thống nhất `max-width` | 4 | ☐ |
| Q-04 | Bỏ trường payload không ai đọc | 4 | ☐ |
| Q-05 | Gắn tag git rồi xoá `.backups/` | 4 | ☐ |

---

# Bảng tra nhanh: mã → file cần sửa

| File | Mã liên quan |
|---|---|
| `public/index.html` | U-01, F-03, F-01, U-03, U-04 |
| `public/css/style.css` | U-02, U-03, U-04, U-05, U-06, U-07 |
| `public/css/cross-post.css` | U-08 |
| `public/css/replicate.css` | U-08 |
| `public/js/app.js` | F-01, F-02, F-03, P-01, P-03, P-04, U-03, U-04, U-05, Q-02 |
| `public/js/cross-post-app.js` | F-05, U-08 |
| `public/js/replicate-modal.js` | F-04, U-05, U-08 |
| `public/cross-post.html` | S-02, U-08 |
| `src/server.js` | S-01, P-01, P-02, P-05, P-07, Q-03, S-02 |
| `src/report.js` | P-01, Q-02, Q-03, Q-04 |
| `src/meta-api.js` | Q-03 |
| `src/cross-post.js` | F-05, F-06, F-04, P-05, Q-01 |
| `src/export-csv.js` | Q-02 |
| `src/google-sheet.js` | P-06 |
| `test/` (tạo mới) | U-02, S-01, Q-01, F-01 |
| `PROJECT_CONTEXT.md` | Q-02, Q-03 |
| `.agents/rules/quy-tac-du-an.md` | U-08 |

---

# Lệnh kiểm chứng chạy sau mỗi đợt

```bash
npm test
```

```bash
curl -s -o /dev/null -w 'raw: %{size_download} bytes | %{time_total}s\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

```bash
curl -s -o /dev/null --compressed -w 'nen: %{size_download} bytes\n' "http://127.0.0.1:3000/api/data?datePreset=last_30d"
```

Bất biến KPI trên mọi tổ hợp kỳ × sản phẩm:

```bash
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('data/latest_insights.json','utf8'));r.leadsRecords=JSON.parse(fs.readFileSync('data/leads_cache.json','utf8')).leads;import('./src/report.js').then(({buildView})=>{let n=0;for(const p of ['ALL','ucmas','uckid','mathca','traihe'])for(const d of ['today','yesterday','last_7d','last_30d','last_90d','this_month','last_month','this_year']){const v=buildView(r,{product:p,accountId:'ALL',datePreset:d});for(const k of ['l1Count','l2Count','l3Count','l4Count']){const s=v.campaigns.reduce((a,c)=>a+c[k],0)+v.unassignedLeads[k];if(s!==v.summary[k]){console.log('FAIL',p,d,k,s,'!==',v.summary[k]);process.exit(1)}n++}}console.log('Bat bien OK -',n,'phep kiem tra')})"
```

Giao diện (dán vào DevTools Console):

```js
(() => {
  const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return `${Math.round(b.left)} → ${Math.round(b.right)}`; };
  const tab = document.querySelector('.tab-btn.active');
  const tr = document.querySelector('.table-responsive');
  return {
    header: r('.app-header'),
    table: r('.table-section'),
    footer: r('.app-footer'),            // phải giống 2 dòng trên
    tabActiveBg: getComputedStyle(tab).backgroundColor,   // ≠ rgba(0,0,0,0)
    tabTransition: getComputedStyle(tab).transitionDuration, // ≠ 0s
    bangCanCuon: tr.scrollWidth > tr.clientWidth,
    soCampaignTrongPayload: appState.view.campaigns.length,  // ~43 sau P-01
    soCampaignBiAn: appState.view.hiddenEmptyCampaigns,      // ~561 sau P-01
    exportHref: document.getElementById('exportCampaignsLink').href
  };
})()
```

---

# Lưu ý cuối

- **Bất biến KPI là thứ phải bảo vệ xuyên suốt.** Chỉ **P-01** chạm tới nó, và chạm một cách an toàn vì tiêu chí lọc đã bao gồm `l1Count === 0` và `spend === 0`. Nếu `npm test` đỏ sau P-01 → kiểm tra `aggregate()` có đang chạy trên `scoped` thay vì `viewCampaigns` không.
- **Không đổi các con số trong `SAFETY_LIMITS`** mà không có lý do nghiệp vụ — chúng bảo vệ tài khoản quảng cáo khỏi bị Meta hạn chế.
- **Mọi route tạo đối tượng trên Meta phải giữ `status: 'PAUSED'`.** Đây là ràng buộc an toàn tuyệt đối, có test khoá lại sau Q-01.
- **Sau khi xong đợt 1–2, cập nhật `PROJECT_CONTEXT.md`** mục "Vấn đề đã biết" và bảng "Lịch sử thay đổi quan trọng" — để đợt rà soát sau không đi lại đường cũ.
