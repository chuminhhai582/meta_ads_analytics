/**
 * Ucmas Ads Analytics — Client Application Logic v3
 * Offline-First Local Data Lake + Google Sheet Lead Funnel (L1 ➔ L4)
 * Dedicated Tabs for UCMAS, UCKID, MATHCA, TRẠI HÈ & Toàn BM.
 */

// Global Chart.js instances
let dailyChart = null;
let campaignChart = null;
let placementChart = null;

// Application State
const appState = {
  view: null,
  analysis: null,
  activeTab: 'all',
  selectedProduct: 'ALL',
  selectedAccount: 'ALL',
  selectedDatePreset: 'last_30d',
  sortField: 'spend',
  sortAsc: false,
  searchQuery: '',
  statusFilter: 'ACTIVE',
  /** CSRF token from GET /api/session, echoed on every mutating request. */
  sessionToken: null,
  /** Aborts the previous /api/data request so a slow one can't overwrite a newer one. */
  pendingLoad: null,
  /** Campaign IDs selected for replication (Set<string>) */
  selectedCampaignIds: new Set()
};

/**
 * CPA verdict thresholds. Seeded with the backend defaults and overwritten by
 * analysis.thresholds on the first response, so the two can never drift apart.
 */
let thresholds = { CPA_GOOD: 65000, CPA_OK: 90000, WASTE_HIGH_CPA: 130000 };

const PRODUCT_COLORS = {
  ucmas: '#38bdf8',
  uckid: '#c084fc',
  mathca: '#fbbf24',
  traihe: '#34d399',
  khac: '#94a3b8'
};

const PRESET_LABELS = {
  today: '(Hôm nay)',
  yesterday: '(Hôm qua)',
  last_7d: '(7 ngày qua)',
  last_14d: '(14 ngày qua)',
  last_30d: '(30 ngày qua)',
  last_90d: '(90 ngày qua)',
  this_month: '(Tháng này)',
  last_month: '(Tháng trước)',
  this_quarter: '(Quý này)',
  this_year: '(Cả năm nay)',
  custom: '(Khoảng tự chọn)'
};

const STATUS_TEXT = {
  ACTIVE: 'Đang chạy',
  PAUSED: 'Tạm dừng',
  CAMPAIGN_PAUSED: 'CĐ cha tắt',
  ADSET_PAUSED: 'Nhóm QC tắt',
  ARCHIVED: 'Lưu trữ',
  DELETED: 'Đã xoá',
  IN_PROCESS: 'Đang xử lý',
  WITH_ISSUES: 'Có lỗi'
};

// Utilities

/**
 * Escape text before it goes into innerHTML. Campaign and fanpage names are typed by
 * whoever runs the ads, and Meta error messages are echoed verbatim, so none of it can
 * be trusted as markup — a stray `<` used to break the table outright.
 */
function esc(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(val, currency = 'VND') {
  if (val === undefined || val === null || isNaN(val)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  }).format(val);
}

function formatNumber(val) {
  if (val === undefined || val === null || isNaN(val)) return '0';
  return new Intl.NumberFormat('vi-VN').format(val);
}

function formatCompactNumber(val) {
  if (val === undefined || val === null || isNaN(val) || val === 0) return '0';
  const abs = Math.abs(val);
  if (abs >= 1e9) return (val / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (val / 1e6).toFixed(1) + 'Tr';
  if (abs >= 1e3) return Math.round(val / 1e3) + 'K';
  return String(val);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const span = document.createElement('span');
  span.textContent = message; // messages can carry Meta API text — never parse as HTML
  toast.appendChild(span);
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Fetch the same-origin session token once. Mutating endpoints reject requests without it.
 */
async function ensureSessionToken() {
  if (appState.sessionToken) return appState.sessionToken;
  const res = await fetch('/api/session');
  if (!res.ok) throw new Error('Không lấy được phiên làm việc từ server.');
  const json = await res.json();
  appState.sessionToken = json.token;
  appState.apiVersion = json.apiVersion;
  appState.businessId = json.businessId;
  return appState.sessionToken;
}

/** POST helper that attaches the session token. */
async function postJson(url, body) {
  const token = await ensureSessionToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify(body || {})
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server trả về dữ liệu không hợp lệ (HTTP ${res.status}).`);
  }
  return { res, json };
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// Lifecycle Init
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  ensureSessionToken().catch(err => console.warn('[Session]', err.message));
  loadData();
});

function initEventListeners() {
  // Tabs Navigation
  const tabButtons = document.querySelectorAll('.tab-btn[data-tab]');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Sync button (Meta API + Google Sheet)
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => triggerSync());
  }

  // Sheet-only refresh — skips the Meta API entirely (~0.3s instead of ~10s)
  const syncSheetBtn = document.getElementById('syncSheetBtn');
  if (syncSheetBtn) {
    syncSheetBtn.addEventListener('click', () => triggerSheetSync());
  }

  // Account select (100% Local slicing)
  const accountSelect = document.getElementById('accountSelect');
  if (accountSelect) {
    accountSelect.addEventListener('change', () => {
      appState.selectedAccount = accountSelect.value;
      loadData();
    });
  }

  // Date preset select (100% Local slicing)
  const datePresetSelect = document.getElementById('datePresetSelect');
  const customRangeBox = document.getElementById('customRangeBox');
  const startInput = document.getElementById('customStartDate');
  const endInput = document.getElementById('customEndDate');
  const applyRangeBtn = document.getElementById('applyRangeBtn');

  if (datePresetSelect) {
    datePresetSelect.addEventListener('change', () => {
      const v = datePresetSelect.value;
      if (v === 'custom') {
        // Hiện 2 ô ngày, điền sẵn khoảng đang xem để người dùng chỉnh từ đó.
        customRangeBox?.classList.remove('d-none');
        const r = appState.view?.dateRange;
        if (startInput && !startInput.value) startInput.value = r?.startDate || '';
        if (endInput && !endInput.value) endInput.value = r?.endDate || '';
        clampDateInputs();
        // Chưa gọi API — đợi bấm "Áp dụng" để không tải 2 lần khi đang chọn dở.
        return;
      }
      customRangeBox?.classList.add('d-none');
      appState.selectedDatePreset = v;
      appState.customStart = null;
      appState.customEnd = null;
      loadData();
    });
  }

  /** Không cho chọn ngày tương lai, và giới hạn theo vùng dữ liệu đã tải. */
  function clampDateInputs() {
    const cov = appState.view?.coverage;
    const today = new Date().toISOString().slice(0, 10);
    [startInput, endInput].forEach(el => {
      if (!el) return;
      el.max = today;
      if (cov?.since) el.min = cov.since;
    });
  }

  function applyCustomRange() {
    const s = startInput?.value;
    const e = endInput?.value;
    if (!s || !e) {
      showToast('Chọn đủ cả ngày bắt đầu và ngày kết thúc.', 'warning');
      return;
    }
    // Người dùng chọn ngược thì tự đảo thay vì báo lỗi.
    appState.customStart = s <= e ? s : e;
    appState.customEnd = s <= e ? e : s;
    appState.selectedDatePreset = 'custom';
    loadData();
  }

  if (applyRangeBtn) applyRangeBtn.addEventListener('click', applyCustomRange);
  [startInput, endInput].forEach(el => {
    el?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') applyCustomRange(); });
  });

  // Table search & status filter
  const tableSearchInput = document.getElementById('tableSearchInput');
  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      renderTable();
    });
  }

  const statusFilterSelect = document.getElementById('statusFilterSelect');
  if (statusFilterSelect) {
    statusFilterSelect.addEventListener('change', (e) => {
      appState.statusFilter = e.target.value;
      renderTable();
    });
  }

  // Sortable table headers
  const tableHead = document.querySelector('#campaignsDataTable thead');
  if (tableHead) {
    tableHead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const field = th.getAttribute('data-sort');
      if (appState.sortField === field) {
        appState.sortAsc = !appState.sortAsc;
      } else {
        appState.sortField = field;
        appState.sortAsc = field === 'name' || field === 'productLabel';
      }
      renderTable();
    });
  }

  // Export dropdown
  const exportDropdown = document.getElementById('exportDropdown');
  const exportDropdownBtn = document.getElementById('exportDropdownBtn');
  if (exportDropdown && exportDropdownBtn) {
    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => exportDropdown.classList.remove('open'));
  }

  // Config Modal
  const configModal = document.getElementById('configModal');
  const openConfigBtn = document.getElementById('openConfigBtn');
  const closeConfigModalBtn = document.getElementById('closeConfigModalBtn');
  const cancelConfigBtn = document.getElementById('cancelConfigBtn');
  const emptyActionBtn = document.getElementById('emptyActionBtn');
  const configForm = document.getElementById('configForm');

  const openModal = () => configModal.classList.add('open');
  const closeModal = () => {
    configModal.classList.remove('open');
    const alertBox = document.getElementById('configAlertBox');
    if (alertBox) alertBox.classList.add('d-none');
  };

  if (openConfigBtn) openConfigBtn.addEventListener('click', openModal);
  if (emptyActionBtn) emptyActionBtn.addEventListener('click', openModal);
  if (closeConfigModalBtn) closeConfigModalBtn.addEventListener('click', closeModal);
  if (cancelConfigBtn) cancelConfigBtn.addEventListener('click', closeModal);
  if (configModal) {
    configModal.addEventListener('click', (e) => {
      if (e.target === configModal) closeModal();
    });
  }

  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('cfgToken').value.trim();
      const appId = document.getElementById('cfgAppId')?.value.trim() || '';
      const appSecret = document.getElementById('cfgAppSecret')?.value.trim() || '';
      const sheetUrl = document.getElementById('cfgSheetUrl')?.value.trim() || '';
      const alertBox = document.getElementById('configAlertBox');
      const saveBtn = document.getElementById('saveConfigBtn');

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Đang lưu...</span>';

      try {
        const { res, json: result } = await postJson('/api/save-config', {
          accessToken: token, appId, appSecret, sheetUrl
        });
        if (res.ok && result.success) {
          alertBox.className = 'alert-box alert-success';
          alertBox.textContent = 'Đã lưu cấu hình thành công! Đang đồng bộ dữ liệu...';
          alertBox.classList.remove('d-none');
          setTimeout(() => {
            closeModal();
            triggerSync();
          }, 800);
        } else {
          alertBox.className = 'alert-box alert-error';
          alertBox.textContent = result.error || 'Lỗi khi lưu cấu hình';
          alertBox.classList.remove('d-none');
        }
      } catch (err) {
        alertBox.className = 'alert-box alert-error';
        alertBox.textContent = 'Lỗi kết nối: ' + err.message;
        alertBox.classList.remove('d-none');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i data-lucide="check"></i> Lưu & Đồng bộ';
        refreshIcons();
      }
    });
  }
}

function switchTab(tabKey) {
  appState.activeTab = tabKey;
  appState.selectedProduct = tabKey === 'all' ? 'ALL' : tabKey;
  updateActiveTabUI();
  loadData();
}

function updateActiveTabUI() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const key = btn.getAttribute('data-tab');
    if (key === appState.activeTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

}

/**
 * Load sliced view from Local Data Lake in < 5ms (100% Offline / Local)
 */
async function loadData() {
  const params = new URLSearchParams({
    product: appState.selectedProduct || 'ALL',
    accountId: appState.selectedAccount || 'ALL',
    datePreset: appState.selectedDatePreset || 'last_30d',
    tab: appState.activeTab || 'all'
  });
  if (appState.selectedDatePreset === 'custom' && appState.customStart && appState.customEnd) {
    params.set('startDate', appState.customStart);
    params.set('endDate', appState.customEnd);
  }

  // Cancel any request still in flight: changing account → date → product in quick
  // succession used to render whichever response happened to land last.
  if (appState.pendingLoad) appState.pendingLoad.abort();
  const controller = new AbortController();
  appState.pendingLoad = controller;

  try {
    const res = await fetch(`/api/data?${params}`, { signal: controller.signal });
    const json = await res.json();

    if (json.needsConfig) {
      showEmptyState('Chưa cấu hình Token Meta Ads', 'Vui lòng bấm "Cài đặt Token" để điền Access Token kết nối Marketing API.');
      return;
    }
    if (json.needsSync) {
      showEmptyState('Chưa có dữ liệu đồng bộ', 'Hệ thống đã sẵn sàng kết nối. Bấm nút "Đồng bộ" để tải dữ liệu.');
      return;
    }

    applyPayload(json);
  } catch (err) {
    if (err.name === 'AbortError') return; // superseded by a newer filter change
    console.error('Lỗi tải dữ liệu local:', err);
    showToast('Lỗi khi tải dữ liệu: ' + err.message, 'error');
  } finally {
    if (appState.pendingLoad === controller) appState.pendingLoad = null;
  }
}

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
  if (!view) return;
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

  // Nói rõ sẽ xuất cái gì, để người dùng không phải mở file lên mới biết.
  const note = document.getElementById('exportScopeNote');
  if (note && view.dateRange && view.summary) {
    const prod = view.product === 'ALL' ? 'Tất cả 4 SP' : (view.product ? view.product.toUpperCase() : 'TẤT CẢ');
    const acc  = view.accountId === 'ALL' ? 'Toàn BM' : `TK ${view.accountId}`;
    note.textContent =
      `${prod} • ${acc} • ${view.dateRange.startDate} → ${view.dateRange.endDate} ` +
      `• ${view.summary.campaignCount} CĐ`;
  }
}

/** Adopt a {view, analysis} payload and repaint everything. */
function applyPayload(json) {
  hideEmptyState();
  appState.view = json.view;
  appState.analysis = json.analysis;
  appState.selectedProduct = json.view.product || 'ALL';
  appState.selectedAccount = json.view.accountId || 'ALL';
  appState.selectedDatePreset = json.view.datePreset || 'last_30d';
  if (json.analysis?.thresholds) thresholds = json.analysis.thresholds;

  // Giữ ô chọn kỳ và 2 ô ngày khớp với những gì server thực sự áp dụng —
  // server có thể quay về last_30d nếu khoảng tự chọn không dùng được.
  const presetSel = document.getElementById('datePresetSelect');
  if (presetSel) presetSel.value = json.view.datePreset || 'last_30d';
  const box = document.getElementById('customRangeBox');
  if (box) box.classList.toggle('d-none', !json.view.isCustomRange);
  if (json.view.isCustomRange && json.view.dateRange) {
    const s = document.getElementById('customStartDate');
    const e = document.getElementById('customEndDate');
    if (s) s.value = json.view.dateRange.startDate;
    if (e) e.value = json.view.dateRange.endDate;
    appState.customStart = json.view.dateRange.startDate;
    appState.customEnd = json.view.dateRange.endDate;
  }

  syncExportLinks(json.view);
  renderAll();
}

/** Shared chrome for the two sync buttons. */
function setSyncing(on, btnId, iconId) {
  const btn = document.getElementById(btnId);
  const icon = document.getElementById(iconId);
  document.body.classList.toggle('is-syncing', on);
  if (btn) btn.disabled = on;
  if (icon) icon.classList.toggle('spin', on);
}

/**
 * Trigger fresh sync from Meta API & Google Sheet
 */
async function triggerSync() {
  setSyncing(true, 'syncBtn', 'syncIcon');
  try {
    const { res, json: result } = await postJson('/api/sync', {
      datePreset: appState.selectedDatePreset,
      accountId: appState.selectedAccount,
      productFilter: appState.selectedProduct,
      activeTab: appState.activeTab
    });

    if (res.ok && result.success) {
      applyPayload(result);
      showToast(result.message || 'Đồng bộ dữ liệu thành công!', result.metaWarning ? 'warning' : 'success');
    } else {
      showToast('Không thể đồng bộ: ' + (result.error || 'Lỗi không xác định'), 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi đồng bộ: ' + err.message, 'error');
  } finally {
    setSyncing(false, 'syncBtn', 'syncIcon');
  }
}

/**
 * Refresh only the Google Sheet leads — no Meta API call, so it returns in ~0.3s.
 */
async function triggerSheetSync() {
  setSyncing(true, 'syncSheetBtn', 'syncSheetIcon');
  try {
    const { res, json: result } = await postJson('/api/sync-sheet', {
      product: appState.selectedProduct,
      accountId: appState.selectedAccount,
      datePreset: appState.selectedDatePreset,
      activeTab: appState.activeTab
    });

    if (res.ok && result.success) {
      applyPayload(result);
      showToast(result.message || 'Đã làm mới dữ liệu Google Sheet!', 'success');
    } else {
      showToast('Không thể làm mới Google Sheet: ' + (result.error || 'Lỗi không xác định'), 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi làm mới Google Sheet: ' + err.message, 'error');
  } finally {
    setSyncing(false, 'syncSheetBtn', 'syncSheetIcon');
  }
}

function showEmptyState(title, desc) {
  const empty = document.getElementById('emptyState');
  const report = document.getElementById('reportContent');
  const titleEl = document.getElementById('emptyTitle');
  const descEl = document.getElementById('emptyDesc');
  const badge = document.getElementById('liveBadge');
  const badgeText = document.getElementById('liveBadgeText');

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (empty) empty.classList.remove('d-none');
  if (report) report.classList.add('d-none');

  if (badge) badge.className = 'account-badge badge-idle';
  if (badgeText) badgeText.textContent = 'Chưa kết nối';

  // Xoá dữ liệu phiên trước: giữ lại số cũ khiến người dùng tưởng trạng thái rỗng
  // chỉ là thông báo phụ, chứ không phải "chưa có dữ liệu".
  appState.view = null;
  appState.analysis = null;
  appState.selectedCampaignIds.clear();

  refreshIcons();
}

function hideEmptyState() {
  const empty = document.getElementById('emptyState');
  const report = document.getElementById('reportContent');
  if (empty) empty.classList.add('d-none');
  if (report) report.classList.remove('d-none');
}

/**
 * Render all dashboard components from current state
 */
function renderAll() {
  updateHeaderAndBadges();
  renderNotices();
  renderAiHero();
  renderKpis();
  renderProductCards();
  renderCharts();
  renderFunnel();
  renderEnrolledStudents();
  renderRecommendations();
  renderTable();
  refreshIcons();
}

function updateHeaderAndBadges() {
  const view = appState.view;
  if (!view) return;

  // Live badge
  const badge = document.getElementById('liveBadge');
  const badgeText = document.getElementById('liveBadgeText');
  const dateStr = view.fetchedAt ? new Date(view.fetchedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  if (badge) badge.className = 'account-badge badge-live';
  if (badgeText) badgeText.textContent = `Snapshot lúc ${dateStr} • Local Data Lake`;

  // Update tab badges from the lightweight `tabBadges` payload (used to require shipping
  // every campaign of all 4 products just to read these numbers).
  const badges = view.tabBadges || {};
  const badgeIds = {
    ucmas: 'tabBadgeUcmas',
    uckid: 'tabBadgeUckid',
    mathca: 'tabBadgeMathca',
    traihe: 'tabBadgeTraihe'
  };
  Object.entries(badgeIds).forEach(([key, id]) => {
    const el = document.getElementById(id);
    const b = badges[key];
    if (!el || !b) return;
    el.textContent = b.l4Count > 0 ? `${formatNumber(b.l4Count)} L4` : `${formatNumber(b.campaignCount || 0)} CĐ`;
  });

  // Account select options
  const accountSelect = document.getElementById('accountSelect');
  if (accountSelect && view.bmAccounts) {
    const currentVal = appState.selectedAccount || 'ALL';
    let html = `<option value="ALL">🏢 Toàn BM Ucmas Việt Nam (${view.bmAccounts.length} tài khoản)</option>`;
    view.bmAccounts.forEach(acc => {
      const isSelected = acc.numericId === currentVal ? 'selected' : '';
      html += `<option value="${esc(acc.numericId)}" ${isSelected}>📊 ${esc(acc.name)} (${esc(acc.id)})</option>`;
    });
    accountSelect.innerHTML = html;
  }

  // Scope line in hero
  const scopeLine = document.getElementById('scopeLine');
  if (scopeLine) {
    const prodLabel = view.product === 'ALL' ? 'Tất cả 4 sản phẩm' : (view.products.find(p => p.key === view.product)?.name || view.product);
    const rangeInfo = view.dateRange ? ` (${view.dateRange.startDate} → ${view.dateRange.endDate})` : '';
    scopeLine.textContent = `Đang xem: ${view.scope?.name || 'Toàn BM'} • Sản phẩm: ${prodLabel} • Kỳ: ${PRESET_LABELS[view.datePreset] || view.datePreset}${rangeInfo}`;
  }

  // Footer info
  const footerInfo = document.getElementById('footerInfo');
  if (footerInfo) {
    const bm = view.scope?.businessId || appState.businessId || '—';
    const api = appState.apiVersion || '—';
    const attr = view.leadAttribution || {};
    const cov = view.coverage
      ? `Kho dữ liệu ${view.coverage.since} → ${view.coverage.until}`
      : 'Kho dữ liệu: chưa rõ phạm vi';
    footerInfo.textContent =
      `BM Ucmas Việt Nam (${bm}) • Graph API ${api} • ${cov} • ` +
      `${view.summary.campaignCount} chiến dịch • ${formatNumber(attr.matched || 0)} lead đã ghép / ` +
      `${formatNumber(attr.unmatched || 0)} chưa ghép • Chế độ Offline-First`;
  }
}

function renderNotices() {
  const container = document.getElementById('noticeArea');
  if (!container) return;
  const view = appState.view || {};
  const warnings = view.warnings || [];
  const notes = view.dataNotes || [];

  if (warnings.length === 0 && notes.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  if (warnings.length > 0) {
    html += `
      <div class="notice">
        <i data-lucide="alert-triangle"></i>
        <div>
          <strong>Cảnh báo đồng bộ Meta API:</strong>
          <ul>
            ${warnings.map(w => `<li>[${esc(w.account)}] ${esc(w.step)}: ${esc(w.message)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  // Data-quality notes: facts about what the snapshot can and cannot prove.
  notes.forEach(n => {
    html += `
      <div class="notice notice-${esc(n.level || 'info')}">
        <i data-lucide="${n.level === 'warning' ? 'alert-triangle' : 'info'}"></i>
        <div><span>${esc(n.message)}</span></div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderAiHero() {
  const analysis = appState.analysis || {};
  const score = analysis.healthScore || 75;

  const scoreEl = document.getElementById('aiHealthScore');
  if (scoreEl) scoreEl.textContent = score;

  const heroTabTitle = document.getElementById('heroTabTitle');
  if (heroTabTitle) {
    const tabTitles = {
      all: 'Chẩn Đoán Toàn BM Ucmas Việt Nam',
      ucmas: 'Phân Tích Chuyên Sâu UCMAS (Toán Trí Tuệ)',
      uckid: 'Phân Tích Chuyên Sâu UCKID (Tiền Tiểu Học)',
      mathca: 'Phân Tích Chuyên Sâu MATHCA',
      traihe: 'Phân Tích Chuyên Sâu TRẠI HÈ'
    };
    heroTabTitle.textContent = tabTitles[appState.activeTab] || 'Chẩn Đoán Tự Động';
  }

  const statusPill = document.getElementById('aiStatusPill');
  if (statusPill) {
    statusPill.textContent = analysis.statusLabel || 'Ổn định';
    statusPill.className = `health-pill level-${analysis.statusLevel || 'good'}`;
  }

  const summaryEl = document.getElementById('aiExecutiveSummary');
  if (summaryEl) summaryEl.textContent = analysis.executiveSummary || '';

  // SVG circle progress
  const circle = document.getElementById('scoreCircleProgress');
  if (circle) {
    const circumference = 2 * Math.PI * 42;
    const offset = circumference - (score / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = analysis.statusLevel === 'good' ? '#10b981' : (analysis.statusLevel === 'warn' ? '#f59e0b' : '#ef4444');
  }

  const winnerEl = document.getElementById('winnerCount');
  const wasterEl = document.getElementById('wasterCount');
  const fatigueEl = document.getElementById('fatigueCount');
  if (winnerEl) winnerEl.textContent = (analysis.topPerformers || []).length;
  if (wasterEl) wasterEl.textContent = (analysis.moneyWasters || []).length;
  if (fatigueEl) fatigueEl.textContent = (analysis.fatigueAlerts || []).length;
}

function renderKpis() {
  const s = appState.view?.summary || {};
  const datePreset = appState.view?.datePreset || 'last_30d';
  const periodText = PRESET_LABELS[datePreset] || `(${datePreset})`;

  document.querySelectorAll('.period-label').forEach(el => {
    el.textContent = periodText;
  });

  // 1. Expected daily budget & Pacing
  const kpiBudget = document.getElementById('kpiBudget');
  const kpiTodaySpend = document.getElementById('kpiTodaySpend');
  const kpiPacingBar = document.getElementById('kpiPacingBar');
  const kpiPacingText = document.getElementById('kpiPacingText');
  if (kpiBudget) kpiBudget.textContent = formatCurrency(s.expectedDailyBudget);
  if (kpiTodaySpend) kpiTodaySpend.textContent = `Đã chi: ${formatCurrency(s.todaySpend)}`;
  if (kpiPacingBar) {
    const pct = Math.min(100, Math.max(0, s.pacingPct || 0));
    kpiPacingBar.style.width = `${pct}%`;
    if (s.pacingPct > 100) kpiPacingBar.classList.add('over');
    else kpiPacingBar.classList.remove('over');
  }
  if (kpiPacingText) {
    kpiPacingText.textContent = s.expectedDailyBudget > 0
      ? `Tiến độ: ${s.pacingPct}% (${formatNumber(s.todayMessages || 0)} tin hôm nay)`
      : `${s.activeCount || 0} CĐ đang chạy`;
  }

  // 2. Period spend, CPM, CTR
  const kpiSpend = document.getElementById('kpiSpend');
  const kpiCpm = document.getElementById('kpiCpm');
  const kpiCtr = document.getElementById('kpiCtr');
  if (kpiSpend) kpiSpend.textContent = formatCurrency(s.totalSpend);
  if (kpiCpm) kpiCpm.textContent = `CPM: ${formatCurrency(s.avgCpm)}`;
  if (kpiCtr) kpiCtr.textContent = `CTR: ${(s.avgCtr || 0).toFixed(2)}% (${formatNumber(s.totalClicks)} clicks)`;

  // 3. Messages & CPA
  const kpiMessages = document.getElementById('kpiMessages');
  const kpiCpa = document.getElementById('kpiCpa');
  const kpiCpaVerdict = document.getElementById('kpiCpaVerdict');
  if (kpiMessages) kpiMessages.textContent = `${formatNumber(s.totalMessages)} tin`;
  if (kpiCpa) kpiCpa.textContent = `CPA: ${formatCurrency(s.avgCpa)}`;
  if (kpiCpaVerdict) {
    if (s.totalMessages === 0) {
      kpiCpaVerdict.textContent = 'Chưa có tin';
      kpiCpaVerdict.className = 'kpi-badge tone-neutral';
    } else if (s.avgCpa <= thresholds.CPA_GOOD) {
      kpiCpaVerdict.textContent = 'CPA rất tốt';
      kpiCpaVerdict.className = 'kpi-badge tone-success';
    } else if (s.avgCpa <= thresholds.CPA_OK) {
      kpiCpaVerdict.textContent = 'CPA chuẩn';
      kpiCpaVerdict.className = 'kpi-badge tone-primary';
    } else {
      kpiCpaVerdict.textContent = 'CPA cao';
      kpiCpaVerdict.className = 'kpi-badge tone-danger';
    }
  }

  // 4. Số điện thoại (L1) & Giá/SĐT (CPL)
  const kpiLeads = document.getElementById('kpiLeads');
  const kpiCpl = document.getElementById('kpiCpl');
  const kpiConvMsgToL1 = document.getElementById('kpiConvMsgToL1');
  if (kpiLeads) kpiLeads.textContent = `${formatNumber(s.l1Count || s.totalLeads || 0)} SĐT`;
  if (kpiCpl) kpiCpl.textContent = `Giá/SĐT: ${formatCurrency(s.cpl)}`;
  if (kpiConvMsgToL1) {
    kpiConvMsgToL1.textContent = s.convMsgToL1 > 0 ? `% Ra số: ${s.convMsgToL1}%` : `L2 tiếp cận: ${formatNumber(s.l2Count || 0)}`;
  }

  // 5. Học viên chốt (L4) & Giá/Học viên (CAC)
  const kpiL4 = document.getElementById('kpiL4');
  const kpiCac = document.getElementById('kpiCac');
  const kpiConvTotal = document.getElementById('kpiConvTotal');
  if (kpiL4) kpiL4.textContent = `${formatNumber(s.l4Count || 0)} học viên`;
  if (kpiCac) kpiCac.textContent = `Chi phí/HV (CAC): ${formatCurrency(s.cac)}`;
  if (kpiConvTotal) kpiConvTotal.textContent = `% Chốt tuyển sinh: ${s.convTotal || 0}%`;

  // 6. Doanh thu học phí & ROAS
  const kpiRevenue = document.getElementById('kpiRevenue');
  const kpiRoas = document.getElementById('kpiRoas');
  const kpiL3Count = document.getElementById('kpiL3Count');
  if (kpiRevenue) kpiRevenue.textContent = formatCurrency(s.totalRevenue);
  if (kpiRoas) kpiRoas.textContent = `ROAS thực: ${s.roas || 0}x`;
  if (kpiL3Count) kpiL3Count.textContent = `Hẹn test (L3): ${formatNumber(s.l3Count || 0)}`;
}

function renderProductCards() {
  const container = document.getElementById('productsGrid');
  const section = document.getElementById('productsSection');
  if (!container || !section) return;

  // Show 4-product comparison cards on Overview tab (all), or allow switching
  if (appState.activeTab !== 'all') {
    section.classList.add('d-none');
    return;
  }
  section.classList.remove('d-none');

  const products = appState.view?.products || [];
  let html = '';
  products.forEach(p => {
    const pacing = Math.min(100, Math.max(0, p.pacingPct || 0));

    html += `
      <button type="button" class="product-card prod-${esc(p.key)}" data-tab="${esc(p.key)}">
        <div class="product-card-header">
          <div>
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-subtitle">${esc(p.subtitle)}</div>
          </div>
          <span class="product-count">${p.count} CĐ (${p.activeCount} chạy)</span>
        </div>

        <div class="product-stats">
          <div class="pstat-item">
            <span class="pstat-label">Chi tiêu kỳ</span>
            <span class="pstat-val" style="color: var(--prod);">${formatCurrency(p.spend)}</span>
          </div>
          <div class="pstat-item">
            <span class="pstat-label">Tin nhắn (CPA)</span>
            <span class="pstat-val">${formatNumber(p.messages)} tin (${formatCurrency(p.cpa)})</span>
          </div>
          <div class="pstat-item">
            <span class="pstat-label">SĐT (L1) / Hẹn (L3)</span>
            <span class="pstat-val text-primary">${formatNumber(p.l1Count || 0)} / ${formatNumber(p.l3Count || 0)}</span>
          </div>
          <div class="pstat-item">
            <span class="pstat-label">Học viên chốt (L4)</span>
            <span class="pstat-val text-success"><strong>${formatNumber(p.l4Count || 0)} HV</strong> (${formatCurrency(p.cac)})</span>
          </div>
        </div>

        <div class="product-today">
          <div class="product-today-row">
            <span>Doanh thu: <strong class="text-warning">${formatCurrency(p.revenue || 0)}</strong></span>
            <span>Chi hôm nay: ${formatCurrency(p.todaySpend)}</span>
          </div>
          <div class="progress-track" aria-hidden="true">
            <div class="progress-bar" style="width: ${pacing}%;"></div>
          </div>
        </div>
      </button>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const tab = card.getAttribute('data-tab');
      switchTab(tab);
    });
  });
}

function renderCharts() {
  renderDailyChart();
  renderCampaignChart();
  renderPlacementChart();
}

function renderDailyChart() {
  const canvas = document.getElementById('dailyPerformanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (dailyChart) dailyChart.destroy();

  const daily = appState.view?.dailyTrend || [];
  if (daily.length === 0) {
    dailyChart = null;
    return;
  }

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";

  // Nhãn trục X đổi theo độ mịn: ngày "16/10", tuần "T.16/10", tháng "10/2026".
  const unit = appState.view?.trendGranularity?.unit || 'day';
  const labels = daily.map(d => {
    const parts = d.date.split('-');
    if (unit === 'month') return parts.length >= 2 ? `${parts[1]}/${parts[0]}` : d.date;
    if (parts.length < 3) return d.date;
    return unit === 'week' ? `T.${parts[2]}/${parts[1]}` : `${parts[2]}/${parts[1]}`;
  });

  // Nói rõ biểu đồ đang gộp theo gì, để không ai đọc nhầm cột tháng thành cột ngày.
  const trendHint = document.getElementById('dailyChartHint');
  if (trendHint) {
    const g = appState.view?.trendGranularity;
    trendHint.textContent = g && g.unit !== 'day'
      ? `Cột: chi tiêu • Đường: số tin nhắn — đang gộp ${g.label} (khoảng thời gian dài)`
      : 'Cột: chi tiêu • Đường: số tin nhắn (di chuột để xem giá/tin)';
  }

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Chi tiêu',
          data: daily.map(d => d.spend),
          backgroundColor: 'rgba(56, 189, 248, 0.45)',
          borderColor: '#38bdf8',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'Tin nhắn',
          data: daily.map(d => d.messages),
          type: 'line',
          borderColor: '#c084fc',
          backgroundColor: '#c084fc',
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          backgroundColor: '#0f1523',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.yAxisID === 'y') {
                return `Chi tiêu: ${formatCurrency(ctx.parsed.y)}`;
              }
              const d = daily[ctx.dataIndex];
              const cpaStr = d && d.cpa ? ` (CPA: ${formatCurrency(d.cpa)})` : '';
              return `Tin nhắn: ${ctx.parsed.y} tin${cpaStr}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)' } },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            callback: (v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}Tr` : v
          }
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { precision: 0 }
        }
      }
    }
  });
}

/**
 * 6-Stage Education Sales Funnel
 */
function renderFunnel() {
  const container = document.getElementById('funnelVisual');
  if (!container) return;
  const f = appState.view?.funnel || {};

  const impressions = f.impressions || 0;
  const clicks = f.clicks || 0;
  const messages = f.messages || 0;
  const l1 = f.l1 || 0;
  const l2 = f.l2 || 0;
  const l3 = f.l3 || 0;
  const l4 = f.l4 || 0;

  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
  const cvr = clicks > 0 ? ((messages / clicks) * 100).toFixed(2) : '0.00';
  const msgToL1 = messages > 0 ? ((l1 / messages) * 100).toFixed(1) : '0.0';
  const l1ToL2 = l1 > 0 ? ((l2 / l1) * 100).toFixed(1) : '0.0';
  const l2ToL3 = l2 > 0 ? ((l3 / l2) * 100).toFixed(1) : '0.0';
  const l3ToL4 = l3 > 0 ? ((l4 / l3) * 100).toFixed(1) : '0.0';

  const stages = [
    { label: '1. Hiển thị (Impressions)', val: impressions, color: 'linear-gradient(90deg, #38bdf8, #0284c7)', rate: `CTR: ${ctr}%` },
    { label: '2. Lượt nhấp (Clicks)', val: clicks, color: 'linear-gradient(90deg, #818cf8, #4f46e5)', rate: `Click/Hiển thị` },
    { label: '3. Tin nhắn (Messaging)', val: messages, color: 'linear-gradient(90deg, #c084fc, #9333ea)', rate: `Ra tin: ${cvr}%` },
    { label: '4. SĐT mới (L1 Lead)', val: l1, color: 'linear-gradient(90deg, #38bdf8, #0369a1)', rate: `Xin số: ${msgToL1}%` },
    { label: '5. Đặt lịch hẹn (L3)', val: l3, color: 'linear-gradient(90deg, #fb923c, #ea580c)', rate: `Hẹn test: ${l2ToL3}%` },
    { label: '6. Nhập học (L4 Chốt)', val: l4, color: 'linear-gradient(90deg, #34d399, #059669)', rate: `Chốt: ${l3ToL4}%` }
  ];

  const maxVal = Math.max(impressions, 1);

  let html = '';
  stages.forEach(st => {
    // Relative visual width for nice display
    const w = st.val > 0 ? Math.max(15, Math.min(100, Math.log10(st.val + 1) / Math.log10(maxVal + 1) * 100)) : 4;
    html += `
      <div class="funnel-stage-row">
        <div class="funnel-stage-label">
          <span>${st.label}</span>
        </div>
        <div class="funnel-stage-bar-bg" aria-hidden="true">
          <div class="funnel-stage-bar-fill" style="width: ${w}%; background: ${st.color};">
            ${formatNumber(st.val)}
          </div>
        </div>
        <div class="funnel-stage-rate">${st.rate}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderEnrolledStudents() {
  const section = document.getElementById('enrolledSection');
  const container = document.getElementById('enrolledGrid');
  const countBadge = document.getElementById('enrolledCountBadge');
  const title = document.getElementById('enrolledTitle');
  if (!section || !container) return;

  const enrolled = appState.view?.recentEnrolled || [];
  if (enrolled.length === 0) {
    section.classList.add('d-none');
    return;
  }

  section.classList.remove('d-none');
  const tabName = appState.activeTab === 'all' ? 'Toàn BM' : appState.activeTab.toUpperCase();
  if (title) title.textContent = `Học viên chốt thành công gần nhất (${tabName} • ${enrolled.length} học viên)`;
  if (countBadge) countBadge.textContent = `${enrolled.length} học viên`;

  let html = '';
  enrolled.forEach(item => {
    html += `
      <div class="enrolled-card">
        <div>
          <div class="enrolled-phone">📱 ${esc(item.phoneMasked)}</div>
          <div class="enrolled-date">Ngày chốt: <strong>${esc(item.l4Date || item.entryDate || '—')}</strong> • ${esc(item.fanpage || 'Trang chính')}</div>
        </div>
        <div class="text-right">
          <span class="badge-level badge-l4">Đã chốt L4</span>
          <div class="enrolled-rev">${item.revenue > 0 ? formatCurrency(item.revenue) : 'Đã nhập học'}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderCampaignChart() {
  const canvas = document.getElementById('campaignComparisonChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (campaignChart) campaignChart.destroy();

  const campaigns = [...(appState.view?.campaigns || [])]
    .filter(c => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  if (campaigns.length === 0) {
    campaignChart = null;
    return;
  }

  campaignChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: campaigns.map(c => c.name.length > 28 ? c.name.slice(0, 26) + '...' : c.name),
      datasets: [{
        label: 'Chi tiêu',
        data: campaigns.map(c => c.spend),
        backgroundColor: campaigns.map(c => PRODUCT_COLORS[c.product] || '#38bdf8'),
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1523',
          callbacks: {
            title: (items) => campaigns[items[0].dataIndex]?.name || '',
            label: (ctx) => {
              const c = campaigns[ctx.dataIndex];
              return [
                `Sản phẩm: ${c.productLabel}`,
                `Chi tiêu: ${formatCurrency(c.spend)}`,
                `Tin nhắn: ${formatNumber(c.messages)} tin (CPA: ${formatCurrency(c.cpa)})`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { callback: (v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}Tr` : v }
        },
        y: { grid: { display: false } }
      }
    }
  });
}

function renderPlacementChart() {
  const canvas = document.getElementById('placementDoughnutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (placementChart) placementChart.destroy();

  const placements = (appState.view?.placements || []).filter(p => p.spend > 0);
  if (placements.length === 0) {
    placementChart = null;
    return;
  }

  const colors = ['#0080fb', '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#94a3b8'];

  placementChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: placements.map(p => p.label || p.platform),
      datasets: [{
        data: placements.map(p => p.spend),
        backgroundColor: colors.slice(0, placements.length),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          backgroundColor: '#0f1523',
          callbacks: {
            label: (ctx) => {
              const p = placements[ctx.dataIndex];
              return `${p.label}: ${formatCurrency(p.spend)} (${p.percentage}%)`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

function renderRecommendations() {
  const insightContainer = document.getElementById('insightList');
  const gridContainer = document.getElementById('recommendationsGrid');
  if (!insightContainer || !gridContainer) return;

  const analysis = appState.analysis || {};
  const recs = analysis.recommendations || [];

  insightContainer.innerHTML = recs.map(r => `
    <div class="insight-item type-${esc(r.type || 'info')}">
      <strong>${esc(r.title)}</strong>
      <span>${esc(r.message)}</span>
    </div>
  `).join('');

  const cards = [];
  const prodBadge = (item) => {
    const key = (item.product || '').toLowerCase() || 'khac';
    return `<span class="product-badge prod-${esc(key)}">${esc(item.product || '')}</span>`;
  };

  (analysis.topPerformers || []).slice(0, 4).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-success">Scale ngân sách</span>
          ${prodBadge(item)}
        </div>
        <div class="rec-item-title">${esc(item.name)}</div>
        <div class="rec-item-meta">${esc(item.accountName)} • ${formatNumber(item.messages)} tin • CPA: ${formatCurrency(item.cpa)}</div>
        <div class="rec-item-desc">Chiến dịch tạo nhiều tin nhắn với chi phí rất tối ưu.</div>
        <div class="rec-item-action text-success">
          <i data-lucide="arrow-up-right"></i> ${esc(item.advice)}
        </div>
      </div>
    `);
  });

  (analysis.moneyWasters || []).slice(0, 4).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-danger">Cần rà soát</span>
          ${prodBadge(item)}
        </div>
        <div class="rec-item-title">${esc(item.name)}</div>
        <div class="rec-item-meta">${esc(item.accountName)} • Đã chi: ${formatCurrency(item.spend)}</div>
        <div class="rec-item-desc">${esc(item.reason)}</div>
        <div class="rec-item-action text-danger">
          <i data-lucide="pause-circle"></i> ${esc(item.action)}
        </div>
      </div>
    `);
  });

  (analysis.fatigueAlerts || []).slice(0, 3).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-warning">Bão hòa Creative</span>
          ${prodBadge(item)}
        </div>
        <div class="rec-item-title">${esc(item.name)}</div>
        <div class="rec-item-meta">${esc(item.accountName)} • Tần suất: ${(item.frequency || 0).toFixed(2)}</div>
        <div class="rec-item-desc">${esc(item.advice)}</div>
        <div class="rec-item-action text-warning">
          <i data-lucide="refresh-cw"></i> Thay mới Creative / mở rộng tệp
        </div>
      </div>
    `);
  });

  if (cards.length === 0) {
    cards.push(`
      <div class="rec-card" style="grid-column: 1 / -1;">
        <div class="rec-item-title text-success">Tất cả chiến dịch đang chạy đều ổn định</div>
        <div class="rec-item-desc">Không phát hiện chiến dịch nào bị đốt tiền hoặc có CPA quá cao vượt ngưỡng cảnh báo.</div>
      </div>
    `);
  }

  gridContainer.innerHTML = cards.join('');
}

function renderPlatformTags(c) {
  if (!c.spend || c.spend <= 0) return '<span class="text-muted">–</span>';
  const plats = c.platformBreakdown || [];
  if (plats.length === 0) return '<span class="plat-badge plat-fb">FB 100%</span>';

  return `
    <div class="plat-tags-cell">
      ${plats.map(p => {
        let cls = 'plat-fb';
        if (p.platform === 'instagram') cls = 'plat-ig';
        else if (p.platform === 'messenger') cls = 'plat-msg';
        else if (p.platform === 'audience_network') cls = 'plat-aud';
        else if (p.platform === 'other') cls = 'plat-other';
        return `<span class="plat-badge ${cls}" title="${esc(p.label)}: ${formatCurrency(p.spend)} (${p.pct}%)"><strong>${esc(p.short)}:</strong> ${formatCompactNumber(p.spend)}</span>`;
      }).join('')}
    </div>
  `;
}

function renderTable() {
  const tbody = document.getElementById('campaignsTableBody');
  const countBadge = document.getElementById('campaignCountBadge');
  if (!tbody) return;

  const all = appState.view?.campaigns || [];
  const q = appState.searchQuery;
  const statusFilter = appState.statusFilter;

  // 1. Filter
  let filtered = all.filter(c => {
    if (q) {
      const matchName = c.name.toLowerCase().includes(q);
      const matchId = String(c.id).includes(q);
      const matchAcc = (c.accountName || '').toLowerCase().includes(q);
      if (!matchName && !matchId && !matchAcc) return false;
    }

    if (statusFilter === 'ACTIVE') return c.effective_status === 'ACTIVE';
    if (statusFilter === 'INACTIVE') return c.effective_status !== 'ACTIVE';
    if (statusFilter === 'SPENT') return c.spend > 0;
    return true;
  });

  // 2. Sort. Values are coerced first: sorting a column where some rows are missing a
  // value used to throw inside localeCompare.
  const field = appState.sortField;
  const asc = appState.sortAsc ? 1 : -1;
  const STRING_FIELDS = ['name', 'productLabel', 'accountName', 'effective_status', 'recommendation', 'budgetType'];
  filtered.sort((a, b) => {
    if (STRING_FIELDS.includes(field)) {
      return asc * String(a[field] ?? '').localeCompare(String(b[field] ?? ''), 'vi');
    }
    return asc * ((Number(a[field]) || 0) - (Number(b[field]) || 0));
  });

  // Update table header sort indicators (toggle only — assigning className wiped the
  // alignment classes the layout depends on).
  document.querySelectorAll('#campaignsDataTable th[data-sort]').forEach(th => {
    const isActive = th.getAttribute('data-sort') === field;
    th.classList.toggle('sorted', isActive);
    th.classList.toggle('asc', isActive && appState.sortAsc);
  });

  if (countBadge) countBadge.textContent = `${filtered.length} chiến dịch`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" class="table-empty">Không tìm thấy chiến dịch nào phù hợp với bộ lọc hiện tại</td></tr>`;
    updateSelectionToolbar();
    return;
  }

  let html = '';
  filtered.forEach(c => {
    const isWin = c.recommendation === 'scale';
    const isWaster = c.recommendation === 'cut_or_review';
    const isFatigue = c.recommendation === 'fatigue_alert';

    let tagHtml = `<span class="pill tone-neutral">Duy trì</span>`;
    if (isWin) tagHtml = `<span class="pill tone-success">🔥 Scale</span>`;
    else if (isWaster) tagHtml = `<span class="pill tone-danger">🛑 Rà soát</span>`;
    else if (isFatigue) tagHtml = `<span class="pill tone-warning">⚠️ Fatigue</span>`;

    const statusPillClass = c.effective_status === 'ACTIVE' ? 'tone-success' : 'tone-neutral';
    const statusLabel = STATUS_TEXT[c.effective_status] || c.effective_status;
    const cpaClass = c.messages > 0 && c.cpa <= thresholds.CPA_GOOD
      ? 'text-success'
      : (c.cpa > thresholds.WASTE_HIGH_CPA ? 'text-danger' : '');

    const l1Html = c.l1Count > 0
      ? `<span class="camp-l1-val">${formatNumber(c.l1Count)}</span><span class="sub-stat">${formatCurrency(c.cpl)}/số</span>`
      : `<span class="text-muted">–</span>`;

    const l3Html = c.l3Count > 0
      ? `<span class="camp-l3-val">${formatNumber(c.l3Count)}</span><span class="sub-stat">${formatCurrency(c.cpaL3)}/hẹn</span>`
      : `<span class="text-muted">–</span>`;

    const l4Html = c.l4Count > 0
      ? `<span class="camp-l4-val">${formatNumber(c.l4Count)}</span><span class="sub-stat">CAC: ${formatCurrency(c.cac)}</span>`
      : `<span class="text-muted">–</span>`;

    const revHtml = c.revenue > 0
      ? `<span class="camp-rev-val">${formatCurrency(c.revenue)}</span><span class="sub-stat">ROAS: ${c.roas || 0}x</span>`
      : `<span class="text-muted">–</span>`;

    const platformHtml = renderPlatformTags(c);

    const isSelected = appState.selectedCampaignIds.has(c.id);

    html += `
      <tr class="${isSelected ? 'row-selected' : ''}" data-campaign-id="${esc(c.id)}">
        <td class="td-checkbox"><input type="checkbox" class="campaign-row-chk" data-cid="${esc(c.id)}" ${isSelected ? 'checked' : ''}></td>
        <td>
          <div class="camp-name">${esc(c.name)}</div>
          <div class="camp-id">ID: ${esc(c.id)}</div>
        </td>
        <td>
          <span class="product-badge prod-${esc(c.product)}">${esc(c.productLabel || c.product)}</span>
        </td>
        <td>
          <span class="account-tag">${esc(c.accountName)}</span>
        </td>
        <td>
          <span class="pill ${statusPillClass}">${esc(statusLabel)}</span>
        </td>
        <td class="num text-success">
          ${c.expectedDailyBudget > 0 ? formatCurrency(c.expectedDailyBudget) : '<span class="text-muted">–</span>'}
        </td>
        <td class="num">
          ${c.todaySpend > 0 ? formatCurrency(c.todaySpend) : '<span class="text-muted">–</span>'}
        </td>
        <td class="num">
          ${formatCurrency(c.spend)}
        </td>
        <td class="num text-primary">
          ${formatNumber(c.messages)}
        </td>
        <td class="num ${cpaClass}">
          ${c.messages > 0 ? formatCurrency(c.cpa) : '<span class="text-muted">–</span>'}
        </td>
        <td class="num">
          ${l1Html}
        </td>
        <td class="num">
          ${l3Html}
        </td>
        <td class="num">
          ${l4Html}
        </td>
        <td class="num">
          ${revHtml}
        </td>
        <td>
          ${platformHtml}
        </td>
        <td class="num">
          ${(c.ctr || 0).toFixed(2)}%
        </td>
        <td class="text-center">
          ${tagHtml}
        </td>
      </tr>
    `;
  });

  html += renderUnassignedRow();
  tbody.innerHTML = html;
  updateSelectionToolbar();
}

/**
 * Leads whose Ad ID could not be resolved to a campaign get their own labelled row
 * instead of being spread across campaigns by spend weight. This is what makes
 * "Σ các dòng = tổng KPI" hold while staying honest about what was actually measured.
 */
function renderUnassignedRow() {
  const u = appState.view?.unassignedLeads;
  if (!u || u.totalLeads === 0) return '';

  return `
    <tr class="row-unassigned">
      <td class="td-checkbox"></td>
      <td>
        <div class="camp-name text-muted">Chưa gán được nguồn</div>
        <div class="camp-id">${formatNumber(u.totalLeads)} lead có Ad ID trống hoặc không thuộc BM</div>
      </td>
      <td><span class="product-badge prod-khac">—</span></td>
      <td><span class="account-tag">—</span></td>
      <td><span class="pill tone-neutral">Không rõ CĐ</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="num"><span class="camp-l1-val">${formatNumber(u.l1Count)}</span></td>
      <td class="num"><span class="camp-l3-val">${formatNumber(u.l3Count)}</span></td>
      <td class="num"><span class="camp-l4-val">${formatNumber(u.l4Count)}</span></td>
      <td class="num"><span class="camp-rev-val">${u.revenue > 0 ? formatCurrency(u.revenue) : '–'}</span></td>
      <td><span class="text-muted">–</span></td>
      <td class="num"><span class="text-muted">–</span></td>
      <td class="text-center"><span class="pill tone-neutral">Cần map Ad ID</span></td>
    </tr>
  `;
}

// =====================================================================
// Campaign Selection & Replication Toolbar
// =====================================================================

/**
 * Update floating toolbar visibility and count based on selectedCampaignIds.
 * Also syncs the "select all" checkbox state.
 */
function updateSelectionToolbar() {
  const toolbar = document.getElementById('replicateToolbar');
  const countEl = document.getElementById('selectedCampaignCount');
  const selectAllChk = document.getElementById('selectAllCampaignsChk');
  const n = appState.selectedCampaignIds.size;

  if (toolbar) toolbar.style.display = n > 0 ? 'block' : 'none';
  if (countEl) countEl.innerHTML = `Đã chọn: <strong>${n}</strong> chiến dịch`;

  // Sync select-all checkbox
  if (selectAllChk) {
    const allCampaigns = appState.view?.campaigns || [];
    selectAllChk.checked = allCampaigns.length > 0 && n >= allCampaigns.length;
    selectAllChk.indeterminate = n > 0 && n < allCampaigns.length;
  }

  // Refresh lucide icons in toolbar
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/** Get campaign objects for selected IDs */
function getSelectedCampaigns() {
  const all = appState.view?.campaigns || [];
  return all.filter(c => appState.selectedCampaignIds.has(c.id));
}

// --- Event delegation on campaign table for checkboxes ---
document.addEventListener('click', (e) => {
  // Individual row checkbox
  const chk = e.target.closest('.campaign-row-chk');
  if (chk) {
    const cid = chk.dataset.cid;
    if (chk.checked) {
      if (appState.selectedCampaignIds.size >= 20) {
        chk.checked = false;
        alert('Tối đa 20 chiến dịch mỗi lần nhân bản.');
        return;
      }
      appState.selectedCampaignIds.add(cid);
    } else {
      appState.selectedCampaignIds.delete(cid);
    }
    // Highlight row
    const row = chk.closest('tr');
    if (row) row.classList.toggle('row-selected', chk.checked);
    updateSelectionToolbar();
    return;
  }
});

// Select All checkbox
document.getElementById('selectAllCampaignsChk')?.addEventListener('change', (e) => {
  const all = appState.view?.campaigns || [];
  if (e.target.checked) {
    const limited = all.slice(0, 20);
    limited.forEach(c => appState.selectedCampaignIds.add(c.id));
  } else {
    appState.selectedCampaignIds.clear();
  }
  renderTable();
});

// Deselect All button
document.getElementById('deselectAllCampaignsBtn')?.addEventListener('click', () => {
  appState.selectedCampaignIds.clear();
  renderTable();
});

// Open Replicate Modal button
document.getElementById('openReplicateModalBtn')?.addEventListener('click', () => {
  if (appState.selectedCampaignIds.size === 0) return;
  // Trigger the modal from replicate-modal.js
  if (typeof window.openReplicateModal === 'function') {
    window.openReplicateModal(getSelectedCampaigns(), appState.sessionToken);
  }
});

// Toggle Recommendations Section (Collapse / Expand)
document.getElementById('toggleRecsBtn')?.addEventListener('click', () => {
  const body = document.getElementById('recommendationsBody');
  const icon = document.getElementById('toggleRecsIcon');
  const text = document.getElementById('toggleRecsText');
  if (!body) return;

  const isCollapsed = body.classList.toggle('collapsed');
  if (text) text.textContent = isCollapsed ? 'Mở rộng' : 'Thu gọn';
  if (icon) {
    icon.setAttribute('data-lucide', isCollapsed ? 'chevron-down' : 'chevron-up');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
});

