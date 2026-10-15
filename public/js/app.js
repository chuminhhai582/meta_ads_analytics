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
  statusFilter: 'ACTIVE'
};

const PRODUCT_COLORS = {
  ucmas: '#38bdf8',
  uckid: '#c084fc',
  mathca: '#fbbf24',
  traihe: '#34d399',
  khac: '#94a3b8'
};

const PRESET_LABELS = {
  last_30d: '(30 ngày qua)',
  last_14d: '(14 ngày qua)',
  last_7d: '(7 ngày qua)',
  this_month: '(Tháng này)',
  yesterday: '(Hôm qua)',
  today: '(Hôm nay)'
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

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// Lifecycle Init
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
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
  if (datePresetSelect) {
    datePresetSelect.addEventListener('change', () => {
      appState.selectedDatePreset = datePresetSelect.value;
      loadData();
    });
  }

  // Product select dropdown
  const productSelect = document.getElementById('productSelect');
  if (productSelect) {
    productSelect.addEventListener('change', () => {
      const p = productSelect.value;
      appState.activeTab = p === 'ALL' ? 'all' : p;
      appState.selectedProduct = p;
      updateActiveTabUI();
      loadData();
    });
  }

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
        const res = await fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token, appId, appSecret, sheetUrl })
        });
        const result = await res.json();
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

  const productSelect = document.getElementById('productSelect');
  if (productSelect) {
    productSelect.value = appState.selectedProduct;
  }
}

/**
 * Load sliced view from Local Data Lake in < 5ms (100% Offline / Local)
 */
async function loadData() {
  const p = encodeURIComponent(appState.selectedProduct || 'ALL');
  const a = encodeURIComponent(appState.selectedAccount || 'ALL');
  const d = encodeURIComponent(appState.selectedDatePreset || 'last_30d');
  const tab = encodeURIComponent(appState.activeTab || 'all');

  try {
    const res = await fetch(`/api/data?product=${p}&accountId=${a}&datePreset=${d}&tab=${tab}`);
    const json = await res.json();

    if (json.needsConfig) {
      showEmptyState('Chưa cấu hình Token Meta Ads', 'Vui lòng bấm "Cài đặt Token" để điền Access Token kết nối Marketing API.');
      return;
    }
    if (json.needsSync) {
      showEmptyState('Chưa có dữ liệu đồng bộ', 'Hệ thống đã sẵn sàng kết nối. Bấm nút "Đồng bộ" để tải dữ liệu.');
      return;
    }

    hideEmptyState();
    appState.view = json.view;
    appState.analysis = json.analysis;
    appState.selectedProduct = json.view.product || 'ALL';
    appState.selectedAccount = json.view.accountId || 'ALL';
    appState.selectedDatePreset = json.view.datePreset || 'last_30d';

    renderAll();
  } catch (err) {
    console.error('Lỗi tải dữ liệu local:', err);
    showToast('Lỗi khi tải dữ liệu: ' + err.message, 'error');
  }
}

/**
 * Switch product filter locally
 */
async function selectProduct(productKey) {
  switchTab(productKey === 'ALL' ? 'all' : productKey);
}

/**
 * Trigger fresh sync from Meta API & Google Sheet
 */
async function triggerSync() {
  const syncBtn = document.getElementById('syncBtn');
  const syncIcon = document.getElementById('syncIcon');
  document.body.classList.add('is-syncing');
  if (syncBtn) syncBtn.disabled = true;
  if (syncIcon) syncIcon.classList.add('spin');

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datePreset: appState.selectedDatePreset,
        accountId: appState.selectedAccount,
        productFilter: appState.selectedProduct,
        activeTab: appState.activeTab
      })
    });
    const result = await res.json();

    if (res.ok && result.success) {
      hideEmptyState();
      appState.view = result.view;
      appState.analysis = result.analysis;
      renderAll();
      showToast(result.message || 'Đồng bộ dữ liệu thành công!', result.metaWarning ? 'warning' : 'success');
    } else {
      showToast('Không thể đồng bộ: ' + (result.error || 'Lỗi không xác định'), 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi đồng bộ: ' + err.message, 'error');
  } finally {
    document.body.classList.remove('is-syncing');
    if (syncBtn) syncBtn.disabled = false;
    if (syncIcon) syncIcon.classList.remove('spin');
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

  // Update Tab Badges (Showing L4 count or campaigns)
  const tabs = view.productTabs || {};
  const badgeUcmas = document.getElementById('tabBadgeUcmas');
  const badgeUckid = document.getElementById('tabBadgeUckid');
  const badgeMathca = document.getElementById('tabBadgeMathca');
  const badgeTraihe = document.getElementById('tabBadgeTraihe');

  if (badgeUcmas && tabs.ucmas) badgeUcmas.textContent = `${tabs.ucmas.stats?.l4Count || 0} L4`;
  if (badgeUckid && tabs.uckid) badgeUckid.textContent = `${tabs.uckid.stats?.l4Count || 0} L4`;
  if (badgeMathca && tabs.mathca) badgeMathca.textContent = `${tabs.mathca.stats?.l1Count || tabs.mathca.campaigns?.length || 0} tin`;
  if (badgeTraihe && tabs.traihe) badgeTraihe.textContent = `${tabs.traihe.campaigns?.length || 0} CĐ`;

  // Account select options
  const accountSelect = document.getElementById('accountSelect');
  if (accountSelect && view.bmAccounts) {
    const currentVal = appState.selectedAccount || 'ALL';
    let html = `<option value="ALL">🏢 Toàn BM Ucmas Việt Nam (${view.bmAccounts.length} tài khoản)</option>`;
    view.bmAccounts.forEach(acc => {
      const isSelected = acc.numericId === currentVal ? 'selected' : '';
      html += `<option value="${acc.numericId}" ${isSelected}>📊 ${acc.name} (${acc.id})</option>`;
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
    footerInfo.textContent = `BM Ucmas Việt Nam (${view.scope?.businessId || '2590933284556026'}) • Graph API v21.0 • Google Sheets CRM • ${view.summary.campaignCount} chiến dịch • Chế độ Offline-First`;
  }
}

function renderNotices() {
  const container = document.getElementById('noticeArea');
  if (!container) return;
  const warnings = appState.view?.warnings || [];
  if (warnings.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="notice">
      <i data-lucide="alert-triangle"></i>
      <div>
        <strong>Cảnh báo đồng bộ Meta API:</strong>
        <ul>
          ${warnings.map(w => `<li>[${w.account}] ${w.step}: ${w.message}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
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
    } else if (s.avgCpa <= 65000) {
      kpiCpaVerdict.textContent = 'CPA rất tốt';
      kpiCpaVerdict.className = 'kpi-badge tone-success';
    } else if (s.avgCpa <= 90000) {
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
      <button type="button" class="product-card prod-${p.key}" data-tab="${p.key}">
        <div class="product-card-header">
          <div>
            <div class="product-name">${p.name}</div>
            <div class="product-subtitle">${p.subtitle}</div>
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

  const labels = daily.map(d => {
    const parts = d.date.split('-');
    return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : d.date;
  });

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
          <div class="enrolled-phone">📱 ${item.phoneMasked}</div>
          <div class="enrolled-date">Ngày chốt: <strong>${item.l4Date || item.entryDate}</strong> • ${item.fanpage || 'Trang chính'}</div>
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
    <div class="insight-item type-${r.type || 'info'}">
      <strong>${r.title}</strong>
      <span>${r.message}</span>
    </div>
  `).join('');

  const cards = [];

  (analysis.topPerformers || []).slice(0, 4).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-success">Scale ngân sách</span>
          <span class="product-badge prod-${item.product?.toLowerCase() || 'ucmas'}">${item.product || ''}</span>
        </div>
        <div class="rec-item-title">${item.name}</div>
        <div class="rec-item-meta">${item.accountName} • ${formatNumber(item.messages)} tin • CPA: ${formatCurrency(item.cpa)}</div>
        <div class="rec-item-desc">Chiến dịch tạo nhiều tin nhắn với chi phí rất tối ưu.</div>
        <div class="rec-item-action text-success">
          <i data-lucide="arrow-up-right"></i> ${item.advice}
        </div>
      </div>
    `);
  });

  (analysis.moneyWasters || []).slice(0, 4).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-danger">Cần rà soát</span>
          <span class="product-badge prod-${item.product?.toLowerCase() || 'ucmas'}">${item.product || ''}</span>
        </div>
        <div class="rec-item-title">${item.name}</div>
        <div class="rec-item-meta">${item.accountName} • Đã chi: ${formatCurrency(item.spend)}</div>
        <div class="rec-item-desc">${item.reason}</div>
        <div class="rec-item-action text-danger">
          <i data-lucide="pause-circle"></i> ${item.action}
        </div>
      </div>
    `);
  });

  (analysis.fatigueAlerts || []).slice(0, 3).forEach(item => {
    cards.push(`
      <div class="rec-card">
        <div class="rec-card-header">
          <span class="rec-badge tone-warning">Bão hòa Creative</span>
          <span class="product-badge prod-${item.product?.toLowerCase() || 'ucmas'}">${item.product || ''}</span>
        </div>
        <div class="rec-item-title">${item.name}</div>
        <div class="rec-item-meta">${item.accountName} • Tần suất: ${item.frequency.toFixed(2)}</div>
        <div class="rec-item-desc">${item.advice}</div>
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

  // 2. Sort
  const field = appState.sortField;
  const asc = appState.sortAsc ? 1 : -1;
  filtered.sort((a, b) => {
    let va = a[field];
    let vb = b[field];
    if (typeof va === 'string') return asc * va.localeCompare(vb);
    return asc * ((va || 0) - (vb || 0));
  });

  // Update table header sort indicators
  document.querySelectorAll('#campaignsDataTable th[data-sort]').forEach(th => {
    const f = th.getAttribute('data-sort');
    if (f === field) {
      th.className = `sorted ${appState.sortAsc ? 'asc' : ''} ${th.classList.contains('text-right') ? 'text-right' : ''} ${th.classList.contains('text-center') ? 'text-center' : ''}`;
    } else {
      th.classList.remove('sorted', 'asc');
    }
  });

  if (countBadge) countBadge.textContent = `${filtered.length} chiến dịch`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty">Không tìm thấy chiến dịch nào phù hợp với bộ lọc hiện tại</td></tr>`;
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
    const cpaClass = c.messages > 0 && c.cpa <= 65000 ? 'text-success' : (c.cpa > 130000 ? 'text-danger' : '');

    html += `
      <tr>
        <td>
          <div class="camp-name">${c.name}</div>
          <div class="camp-id">ID: ${c.id}</div>
        </td>
        <td>
          <span class="product-badge prod-${c.product}">${c.productLabel || c.product}</span>
        </td>
        <td>
          <span class="account-tag">${c.accountName}</span>
        </td>
        <td>
          <span class="pill ${statusPillClass}">${statusLabel}</span>
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
          ${(c.ctr || 0).toFixed(2)}%
        </td>
        <td class="text-center">
          ${tagHtml}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}
