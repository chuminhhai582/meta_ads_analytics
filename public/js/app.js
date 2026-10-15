/**
 * Ucmas Ads Analytics — Client Application Logic
 * Offline-First / Local Data Lake Engine
 * Only #syncBtn triggers Meta API calls. All dropdowns & filters run 100% Local in < 10ms.
 */

// Global Chart.js instances
let dailyChart = null;
let campaignChart = null;
let placementChart = null;

// Application State
const appState = {
  view: null,
  analysis: null,
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
  }, 3500);
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
  // Sync button (ONLY user action that calls Meta API)
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

  // Product select dropdown (100% Local slicing)
  const productSelect = document.getElementById('productSelect');
  if (productSelect) {
    productSelect.addEventListener('change', () => {
      selectProduct(productSelect.value);
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
      const alertBox = document.getElementById('configAlertBox');
      const saveBtn = document.getElementById('saveConfigBtn');

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Đang lưu...</span>';

      try {
        const res = await fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token, appId, appSecret })
        });
        const result = await res.json();
        if (res.ok && result.success) {
          alertBox.className = 'alert-box alert-success';
          alertBox.textContent = 'Đã lưu token thành công! Đang đồng bộ dữ liệu...';
          alertBox.classList.remove('d-none');
          setTimeout(() => {
            closeModal();
            triggerSync();
          }, 900);
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

/**
 * Load sliced view from Local Data Lake in < 10ms (100% Offline / Local)
 */
async function loadData() {
  const p = encodeURIComponent(appState.selectedProduct || 'ALL');
  const a = encodeURIComponent(appState.selectedAccount || 'ALL');
  const d = encodeURIComponent(appState.selectedDatePreset || 'last_30d');

  try {
    const res = await fetch(`/api/data?product=${p}&accountId=${a}&datePreset=${d}`);
    const json = await res.json();

    if (json.needsConfig) {
      showEmptyState('Chưa cấu hình Token Meta Ads', 'Vui lòng bấm "Cài đặt Token" để điền Access Token kết nối Marketing API.');
      return;
    }
    if (json.needsSync) {
      showEmptyState('Chưa có dữ liệu đồng bộ', 'Hệ thống đã sẵn sàng kết nối. Bấm nút "Đồng bộ Meta Ads" để tải dữ liệu.');
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
  appState.selectedProduct = productKey;
  const select = document.getElementById('productSelect');
  if (select && select.value !== productKey) select.value = productKey;
  await loadData();
}

/**
 * Trigger fresh sync from Meta API (ONLY called on #syncBtn)
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
        productFilter: appState.selectedProduct
      })
    });
    const result = await res.json();

    if (res.ok && result.success) {
      hideEmptyState();
      appState.view = result.view;
      appState.analysis = result.analysis;
      renderAll();
      showToast(result.message || 'Đồng bộ dữ liệu thành công!', 'success');
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

  // Product select sync
  const productSelect = document.getElementById('productSelect');
  if (productSelect && productSelect.value !== view.product) {
    productSelect.value = view.product || 'ALL';
  }

  // Date preset sync
  const dateSelect = document.getElementById('datePresetSelect');
  if (dateSelect && view.datePreset && dateSelect.value !== view.datePreset) {
    dateSelect.value = view.datePreset;
    appState.selectedDatePreset = view.datePreset;
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
    footerInfo.textContent = `BM Ucmas Việt Nam (${view.scope?.businessId || '2590933284556026'}) • Graph API v21.0 • ${view.summary.campaignCount} chiến dịch • Chế độ Offline-First`;
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

  // 1. Expected daily budget
  const kpiBudget = document.getElementById('kpiBudget');
  const kpiBudgetSub = document.getElementById('kpiBudgetSub');
  if (kpiBudget) kpiBudget.textContent = formatCurrency(s.expectedDailyBudget);
  if (kpiBudgetSub) kpiBudgetSub.textContent = `${s.activeCount || 0} chiến dịch đang chạy thực tế`;

  // 2. Today spend & pacing
  const kpiTodaySpend = document.getElementById('kpiTodaySpend');
  const kpiPacingBar = document.getElementById('kpiPacingBar');
  const kpiPacingText = document.getElementById('kpiPacingText');
  if (kpiTodaySpend) kpiTodaySpend.textContent = formatCurrency(s.todaySpend);
  if (kpiPacingBar) {
    const pct = Math.min(100, Math.max(0, s.pacingPct || 0));
    kpiPacingBar.style.width = `${pct}%`;
    if (s.pacingPct > 100) kpiPacingBar.classList.add('over');
    else kpiPacingBar.classList.remove('over');
  }
  if (kpiPacingText) {
    kpiPacingText.textContent = s.expectedDailyBudget > 0
      ? `Tiến độ: ${s.pacingPct}% ngân sách ngày`
      : 'Không có ngân sách ngày';
  }

  // 3. Today messages
  const kpiTodayMessages = document.getElementById('kpiTodayMessages');
  const kpiTodayCpa = document.getElementById('kpiTodayCpa');
  if (kpiTodayMessages) kpiTodayMessages.textContent = `${formatNumber(s.todayMessages)} tin`;
  if (kpiTodayCpa) {
    kpiTodayCpa.textContent = s.todayMessages > 0
      ? `Giá/tin hôm nay: ${formatCurrency(s.todayCpa)}`
      : 'Chưa có tin nhắn hôm nay';
  }

  // 4. Period spend
  const kpiSpend = document.getElementById('kpiSpend');
  const kpiCpm = document.getElementById('kpiCpm');
  if (kpiSpend) kpiSpend.textContent = formatCurrency(s.totalSpend);
  if (kpiCpm) kpiCpm.textContent = `CPM: ${formatCurrency(s.avgCpm)}`;

  // 5. Period messages & CPA
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

  // 6. CTR & CPC
  const kpiCtr = document.getElementById('kpiCtr');
  const kpiCpc = document.getElementById('kpiCpc');
  const kpiClicks = document.getElementById('kpiClicks');
  if (kpiCtr) kpiCtr.textContent = `${(s.avgCtr || 0).toFixed(2)}%`;
  if (kpiCpc) kpiCpc.textContent = `CPC: ${formatCurrency(s.avgCpc)}`;
  if (kpiClicks) kpiClicks.textContent = `${formatNumber(s.totalClicks)} lượt click`;
}

function renderProductCards() {
  const container = document.getElementById('productsGrid');
  if (!container) return;
  const products = appState.view?.products || [];
  const activeKey = appState.selectedProduct;

  let html = '';
  products.forEach(p => {
    const isActive = activeKey === p.key;
    const isDimmed = activeKey !== 'ALL' && !isActive;
    const pacing = Math.min(100, Math.max(0, p.pacingPct || 0));

    html += `
      <button type="button" class="product-card prod-${p.key} ${isActive ? 'active' : ''} ${isDimmed ? 'dimmed' : ''}" data-product="${p.key}">
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
            <span class="pstat-label">Ngân sách/ngày</span>
            <span class="pstat-val text-success">${p.expectedDailyBudget > 0 ? formatCurrency(p.expectedDailyBudget) : '0 ₫'}</span>
          </div>
          <div class="pstat-item">
            <span class="pstat-label">Tin nhắn</span>
            <span class="pstat-val">${formatNumber(p.messages)} tin</span>
          </div>
          <div class="pstat-item">
            <span class="pstat-label">Giá/tin (CPA)</span>
            <span class="pstat-val ${p.cpa > 0 && p.cpa <= 65000 ? 'text-success' : (p.cpa > 90000 ? 'text-danger' : '')}">
              ${p.messages > 0 ? formatCurrency(p.cpa) : (p.spend === 0 ? 'Chưa chi tiêu' : '0 tin nhắn')}
            </span>
          </div>
        </div>

        <div class="product-today">
          <div class="product-today-row">
            <span>Chi hôm nay: <strong>${formatCurrency(p.todaySpend)}</strong></span>
            <span>${p.todayMessages} tin</span>
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
      const key = card.getAttribute('data-product');
      const nextKey = appState.selectedProduct === key ? 'ALL' : key;
      selectProduct(nextKey);
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
          backgroundColor: 'rgba(0, 128, 251, 0.65)',
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'Tin nhắn',
          type: 'line',
          data: daily.map(d => d.messages),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          borderWidth: 3,
          pointRadius: 3,
          pointHoverRadius: 6,
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
        legend: { position: 'top', align: 'end', labels: { boxWidth: 10, padding: 12 } },
        tooltip: {
          backgroundColor: '#0f1523',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y1') {
                const row = daily[ctx.dataIndex];
                const cpaStr = row && row.cpa > 0 ? ` (CPA: ${formatCurrency(row.cpa)})` : '';
                return `Tin nhắn: ${formatNumber(ctx.parsed.y)}${cpaStr}`;
              }
              return `Chi tiêu: ${formatCurrency(ctx.parsed.y)}`;
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

function renderFunnel() {
  const container = document.getElementById('funnelVisual');
  if (!container) return;
  const f = appState.view?.funnel || {};

  const impressions = f.impressions || 0;
  const clicks = f.clicks || 0;
  const messages = f.messages || 0;

  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
  const cvr = clicks > 0 ? ((messages / clicks) * 100).toFixed(2) : '0.00';

  const steps = [
    { name: '1. Lượt hiển thị (Impressions)', val: impressions, pct: 100, rate: null },
    { name: '2. Lượt nhấp (Clicks)', val: clicks, pct: impressions > 0 ? Math.max(12, Math.min(100, (clicks / impressions) * 100 * 15)) : 0, rate: `Tỷ lệ click (CTR): ${ctr}%` },
    { name: '3. Tin nhắn / Chuyển đổi', val: messages, pct: clicks > 0 ? Math.max(8, Math.min(100, (messages / clicks) * 100 * 5)) : 0, rate: `Tỷ lệ nhắn tin / click: ${cvr}%` }
  ];

  let html = '';
  steps.forEach(step => {
    html += `
      <div class="funnel-step">
        <div class="funnel-step-header">
          <span class="funnel-step-name">${step.name}</span>
          <span class="funnel-step-val">${formatNumber(step.val)}</span>
        </div>
        <div class="funnel-track" aria-hidden="true">
          <div class="funnel-bar" style="width: ${step.pct}%;"></div>
        </div>
        ${step.rate ? `<span class="funnel-rate">${step.rate}</span>` : ''}
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
        backgroundColor: campaigns.map(c => PRODUCT_COLORS[c.product] || '#0080fb'),
        borderRadius: 6
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
            label: (ctx) => {
              const camp = campaigns[ctx.dataIndex];
              return `Chi: ${formatCurrency(camp.spend)} • ${camp.messages} tin (CPA: ${formatCurrency(camp.cpa)})`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            callback: (v) => v >= 1000000 ? `${(v / 1000000).toFixed(0)}Tr` : v
          }
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

  // Macro insights
  insightContainer.innerHTML = recs.map(r => `
    <div class="insight-item type-${r.type || 'info'}">
      <strong>${r.title}</strong>
      <span>${r.message}</span>
    </div>
  `).join('');

  // Micro campaign cards
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
    // Search
    if (q) {
      const matchName = c.name.toLowerCase().includes(q);
      const matchId = String(c.id).includes(q);
      const matchAcc = (c.accountName || '').toLowerCase().includes(q);
      if (!matchName && !matchId && !matchAcc) return false;
    }

    // Status filter
    if (statusFilter === 'ACTIVE') return c.effective_status === 'ACTIVE';
    if (statusFilter === 'INACTIVE') return c.effective_status !== 'ACTIVE';
    if (statusFilter === 'SPENT') return c.spend > 0;
    return true; // 'ALL'
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
