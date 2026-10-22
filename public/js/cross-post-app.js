/**
 * Cross-Post & Creative Replication Frontend Controller
 * Giao tiếp an toàn với backend qua /api/cp/* và sử dụng X-Internal-Token (CSRF guard)
 */

(function () {
  'use strict';

  // State Management
  const state = {
    sessionToken: '',
    pages: [],
    selectedSourcePageId: '',
    posts: [],
    selectedPost: null,
    selectedTargetPageIds: new Set(),

    // Ads state (Phase 2)
    adAccounts: [],
    campaigns: [],
    adsets: [],
    ads: [],
    selectedAd: null,
    selectedTargetAdsetIds: new Set(),
    activeTab: 'fanpage' // 'fanpage' | 'ads'
  };

  // DOM Elements - Navigation & Common
  const tabFanpageBtn = document.getElementById('tabFanpageBtn');
  const tabAdsBtn = document.getElementById('tabAdsBtn');
  const fanpageSection = document.getElementById('fanpageSection');
  const adsSection = document.getElementById('adsSection');

  // DOM Elements - Fanpage Section
  const sourcePageSelect = document.getElementById('sourcePageSelect');
  const refreshPagesBtn = document.getElementById('refreshPagesBtn');
  const postCountBadge = document.getElementById('postCountBadge');
  const postsLoadingState = document.getElementById('postsLoadingState');
  const postsEmptyState = document.getElementById('postsEmptyState');
  const pagePostsList = document.getElementById('pagePostsList');

  const editPostMessage = document.getElementById('editPostMessage');
  const editPostImageUrl = document.getElementById('editPostImageUrl');
  const editPostLinkUrl = document.getElementById('editPostLinkUrl');
  const resetEditorBtn = document.getElementById('resetEditorBtn');
  const previewMediaContainer = document.getElementById('previewMediaContainer');
  const previewMediaImg = document.getElementById('previewMediaImg');

  const targetPagesList = document.getElementById('targetPagesList');
  const selectAllPagesBtn = document.getElementById('selectAllPagesBtn');
  const deselectAllPagesBtn = document.getElementById('deselectAllPagesBtn');
  const selectedCountText = document.getElementById('selectedCountText');
  const startPublishBtn = document.getElementById('startPublishBtn');

  const publishResultsCard = document.getElementById('publishResultsCard');
  const publishStatusBadge = document.getElementById('publishStatusBadge');
  const publishProgressBar = document.getElementById('publishProgressBar');
  const publishResultsList = document.getElementById('publishResultsList');

  // DOM Elements - Ads Studio Section
  const studioStepper = document.getElementById('studioStepper');
  const btnStudioBack = document.getElementById('btnStudioBack');
  const btnStudioNext = document.getElementById('btnStudioNext');
  const btnStudioExecute = document.getElementById('btnStudioExecute');

  // DOM Elements - Modal
  const confirmModal = document.getElementById('confirmModal');
  const confirmModalTitle = document.getElementById('confirmModalTitle');
  const confirmModalDesc = document.getElementById('confirmModalDesc');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const confirmExecuteBtn = document.getElementById('confirmExecuteBtn');

  let pendingAction = null; // 'publish' | 'replicate-ad'

  // Helper function refresh lucide icons
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Format date helper
  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  }

  // Format number
  function formatNum(num) {
    return Number(num || 0).toLocaleString('vi-VN');
  }

  // -------------------------------------------------------------
  // INITIALIZATION & SESSION TOKEN
  // -------------------------------------------------------------
  async function init() {
    try {
      // 1. Lấy CSRF session token
      const sessionRes = await fetch('/api/session');
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        state.sessionToken = sessionData.token || '';
      }
    } catch (e) {
      console.warn('Không thể lấy session token:', e);
    }

    // 2. Setup Event Listeners
    setupEventListeners();

    // 3. Load Danh sách Fanpage ban đầu
    await loadFanpages();

    refreshIcons();
  }

  function setupEventListeners() {
    // Tab switching
    tabFanpageBtn.addEventListener('click', () => switchTab('fanpage'));
    tabAdsBtn.addEventListener('click', () => switchTab('ads'));

    // Fanpage source change
    sourcePageSelect.addEventListener('change', (e) => {
      const pageId = e.target.value;
      state.selectedSourcePageId = pageId;
      renderTargetPages();
      if (pageId) {
        loadPagePosts(pageId);
      } else {
        postsEmptyState.style.display = 'block';
        pagePostsList.style.display = 'none';
        postCountBadge.style.display = 'none';
      }
    });

    // Global refresh cache buttons
    const cpGlobalRefreshBtn = document.getElementById('cpGlobalRefreshBtn');
    if (cpGlobalRefreshBtn) cpGlobalRefreshBtn.addEventListener('click', () => refreshAllCache());
    if (refreshPagesBtn) refreshPagesBtn.addEventListener('click', () => refreshAllCache());

    // Editor inputs live update
    editPostImageUrl.addEventListener('input', () => {
      updateMediaPreview(editPostImageUrl.value.trim());
    });

    resetEditorBtn.addEventListener('click', () => {
      if (state.selectedPost) {
        selectPost(state.selectedPost);
      } else {
        editPostMessage.value = '';
        editPostImageUrl.value = '';
        editPostLinkUrl.value = '';
        updateMediaPreview('');
      }
    });

    // Target pages bulk selection
    selectAllPagesBtn.addEventListener('click', () => {
      state.pages.forEach(p => {
        if (p.id !== state.selectedSourcePageId) {
          state.selectedTargetPageIds.add(p.id);
        }
      });
      updateTargetPageUI();
    });

    deselectAllPagesBtn.addEventListener('click', () => {
      state.selectedTargetPageIds.clear();
      updateTargetPageUI();
    });

    // Start publish button -> open modal
    startPublishBtn.addEventListener('click', () => {
      if (state.selectedTargetPageIds.size === 0) {
        alert('Vui lòng chọn ít nhất 1 Fanpage đích để đăng bài.');
        return;
      }
      const msg = editPostMessage.value.trim();
      const img = editPostImageUrl.value.trim();
      const link = editPostLinkUrl.value.trim();
      if (!msg && !img && !link) {
        alert('Nội dung bài viết không được để trống (cần có văn bản hoặc hình ảnh/liên kết).');
        return;
      }

      pendingAction = 'publish';
      confirmModalTitle.innerHTML = `<i data-lucide="help-circle" style="color:var(--warning);"></i> <span>Xác nhận đăng bài</span>`;
      confirmModalDesc.innerHTML = `Bạn chuẩn bị đăng bài viết này lên <strong>${state.selectedTargetPageIds.size} Fanpage</strong>.<br>Hệ thống tự động giãn cách 1.5s giữa các lần đăng để bảo vệ trang an toàn.`;
      confirmModal.style.display = 'flex';
      refreshIcons();
    });

    // Ads Studio section events
    initStudioEvents();

    // Modal buttons
    cancelModalBtn.addEventListener('click', () => {
      confirmModal.style.display = 'none';
      pendingAction = null;
    });

    confirmExecuteBtn.addEventListener('click', () => {
      confirmModal.style.display = 'none';
      if (pendingAction === 'publish') {
        executePublish();
      } else if (pendingAction === 'replicate-ad') {
        executeReplicateAd();
      }
      pendingAction = null;
    });
  }

  function switchTab(tab) {
    state.activeTab = tab;
    if (tab === 'fanpage') {
      tabFanpageBtn.classList.add('active');
      tabAdsBtn.classList.remove('active');
      fanpageSection.style.display = 'block';
      adsSection.style.display = 'none';
    } else {
      tabAdsBtn.classList.add('active');
      tabFanpageBtn.classList.remove('active');
      fanpageSection.style.display = 'none';
      adsSection.style.display = 'block';

      // Khởi tạo Ads Studio
      initStudio();
    }
    refreshIcons();
  }

  // -------------------------------------------------------------
  // GLOBAL CACHE REFRESH (FANPAGES & AD ACCOUNTS)
  // -------------------------------------------------------------
  async function refreshAllCache() {
    const btn = document.getElementById('cpGlobalRefreshBtn');
    const statusEl = document.getElementById('cpCacheStatusText');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="cp-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span><span>Đang làm mới...</span>`;
    }
    if (statusEl) statusEl.textContent = 'Đang gọi Meta API...';

    try {
      const res = await fetch('/api/cp/refresh-cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': state.sessionToken
        }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi khi làm mới cache');

      state.pages = data.pages || [];
      state.adAccounts = data.adAccounts || [];

      // Render lại giao diện Fanpage nguồn
      let optionsHtml = '<option value="">-- Chọn Fanpage nguồn để lấy bài đăng --</option>';
      state.pages.forEach(p => {
        optionsHtml += `<option value="${p.id}">${escapeHtml(p.name)} (${formatNum(p.fanCount)} fans)</option>`;
      });
      sourcePageSelect.innerHTML = optionsHtml;
      sourcePageSelect.disabled = false;
      renderTargetPages();

      // Render lại giao diện Tài khoản Ads
      if (sourceAccountSelect) {
        let accHtml = '<option value="">-- Chọn tài khoản quảng cáo --</option>';
        state.adAccounts.forEach(acc => {
          accHtml += `<option value="${acc.accountId}">${escapeHtml(acc.name)} (act_${acc.accountId})</option>`;
        });
        sourceAccountSelect.innerHTML = accHtml;
        sourceAccountSelect.disabled = false;
      }

      if (statusEl) statusEl.textContent = 'Cache: Vừa cập nhật';
      alert(`✅ Đã làm mới thành công từ Meta API!\n• ${state.pages.length} Fanpage\n• ${state.adAccounts.length} Tài khoản quảng cáo`);
    } catch (err) {
      alert('❌ Lỗi làm mới: ' + err.message);
      if (statusEl) statusEl.textContent = 'Lỗi làm mới';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
        refreshIcons();
      }
    }
  }

  // -------------------------------------------------------------
  // TAB 1: FANPAGE LOGIC
  // -------------------------------------------------------------
  async function loadFanpages() {
    sourcePageSelect.innerHTML = '<option value="">-- Đang tải danh sách Fanpage... --</option>';
    sourcePageSelect.disabled = true;

    try {
      const res = await fetch('/api/cp/pages');
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Lỗi khi tải danh sách Fanpage');
      }

      state.pages = data.pages || [];

      if (data.cacheAge) {
        const statusEl = document.getElementById('cpCacheStatusText');
        if (statusEl) statusEl.textContent = `Cache: ${data.cacheAge}`;
      }

      if (state.pages.length === 0) {
        sourcePageSelect.innerHTML = '<option value="">(Không tìm thấy Fanpage nào có quyền quản trị)</option>';
        return;
      }

      let optionsHtml = '<option value="">-- Chọn Fanpage nguồn để lấy bài đăng --</option>';
      state.pages.forEach(p => {
        optionsHtml += `<option value="${p.id}">${escapeHtml(p.name)} (${formatNum(p.fanCount)} fans)</option>`;
      });

      sourcePageSelect.innerHTML = optionsHtml;
      sourcePageSelect.disabled = false;

      // Render danh sách đích
      renderTargetPages();
    } catch (err) {
      console.error('Lỗi tải Fanpages:', err);
      sourcePageSelect.innerHTML = `<option value="">Lỗi: ${escapeHtml(err.message)}</option>`;
    }
  }

  function renderTargetPages() {
    targetPagesList.innerHTML = '';
    state.selectedTargetPageIds.clear();

    const availablePages = state.pages.filter(p => p.id !== state.selectedSourcePageId);

    if (availablePages.length === 0) {
      targetPagesList.innerHTML = '<div class="cp-empty-state" style="grid-column:1/-1;">Không có Fanpage đích khả dụng.</div>';
      updateTargetPageUI();
      return;
    }

    availablePages.forEach(p => {
      const item = document.createElement('div');
      item.className = 'cp-target-item';
      item.id = `targetPageItem_${p.id}`;
      item.dataset.pageId = p.id;

      const avatarSrc = p.pictureUrl || 'https://via.placeholder.com/36?text=FP';

      item.innerHTML = `
        <input type="checkbox" id="chk_page_${p.id}" style="pointer-events:none;">
        <img src="${avatarSrc}" class="cp-target-avatar" alt="Avatar">
        <div class="cp-target-details">
          <span class="cp-target-name">${escapeHtml(p.name)}</span>
          <span class="cp-target-sub">${formatNum(p.fanCount)} người theo dõi</span>
        </div>
      `;

      item.addEventListener('click', () => {
        if (state.selectedTargetPageIds.has(p.id)) {
          state.selectedTargetPageIds.delete(p.id);
        } else {
          if (state.selectedTargetPageIds.size >= 10) {
            alert('Mỗi lần đăng tối đa 10 Fanpage để đảm bảo an toàn.');
            return;
          }
          state.selectedTargetPageIds.add(p.id);
        }
        updateTargetPageUI();
      });

      targetPagesList.appendChild(item);
    });

    updateTargetPageUI();
  }

  function updateTargetPageUI() {
    const items = targetPagesList.querySelectorAll('.cp-target-item');
    items.forEach(el => {
      const pid = el.dataset.pageId;
      const isChecked = state.selectedTargetPageIds.has(pid);
      el.classList.toggle('checked', isChecked);
      const chk = el.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = isChecked;
    });

    const count = state.selectedTargetPageIds.size;
    selectedCountText.innerHTML = `Đã chọn: <strong>${count}</strong> / 10 Fanpage đích`;
    startPublishBtn.disabled = count === 0;
  }

  async function loadPagePosts(pageId) {
    postsEmptyState.style.display = 'none';
    pagePostsList.style.display = 'none';
    postsLoadingState.style.display = 'block';
    postCountBadge.style.display = 'none';

    try {
      const res = await fetch(`/api/cp/pages/${pageId}/posts?limit=25`);
      const data = await res.json();

      postsLoadingState.style.display = 'none';

      if (!data.ok) {
        throw new Error(data.error || 'Lỗi khi tải bài đăng');
      }

      state.posts = data.posts || [];

      if (state.posts.length === 0) {
        postsEmptyState.innerHTML = '<i data-lucide="info"></i><p>Trang này chưa có bài đăng gần đây nào.</p>';
        postsEmptyState.style.display = 'block';
        refreshIcons();
        return;
      }

      postCountBadge.textContent = `${state.posts.length} bài gần đây`;
      postCountBadge.style.display = 'inline-block';
      renderPostsList(state.posts);
    } catch (err) {
      postsLoadingState.style.display = 'none';
      postsEmptyState.innerHTML = `<i data-lucide="alert-triangle" style="color:var(--danger)"></i><p>Lỗi: ${escapeHtml(err.message)}</p>`;
      postsEmptyState.style.display = 'block';
      refreshIcons();
    }
  }

  function renderPostsList(posts) {
    pagePostsList.innerHTML = '';
    pagePostsList.style.display = 'flex';

    posts.forEach((post, index) => {
      const item = document.createElement('div');
      item.className = 'cp-post-item';
      item.id = `postItem_${post.id}`;

      const thumb = post.fullPicture
        ? `<img src="${post.fullPicture}" class="cp-post-thumb" alt="Thumb" loading="lazy">`
        : `<div class="cp-post-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">Text</div>`;

      const snippet = post.message || '(Bài viết không có văn bản)';

      item.innerHTML = `
        ${thumb}
        <div class="cp-post-info">
          <div class="cp-post-text">${escapeHtml(snippet)}</div>
          <div class="cp-post-meta">
            <span><i data-lucide="clock" style="width:12px;height:12px;"></i> ${formatDate(post.createdTime)}</span>
            <span><i data-lucide="thumbs-up" style="width:12px;height:12px;"></i> ${formatNum(post.reactionsCount)}</span>
            <span><i data-lucide="message-square" style="width:12px;height:12px;"></i> ${formatNum(post.commentsCount)}</span>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        // Highlight active
        const allItems = pagePostsList.querySelectorAll('.cp-post-item');
        allItems.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        selectPost(post);
      });

      pagePostsList.appendChild(item);

      // Auto select post đầu tiên
      if (index === 0) {
        item.classList.add('selected');
        selectPost(post);
      }
    });

    refreshIcons();
  }

  function selectPost(post) {
    state.selectedPost = post;
    editPostMessage.value = post.message || '';
    editPostImageUrl.value = post.fullPicture || '';
    editPostLinkUrl.value = post.permalinkUrl || '';
    updateMediaPreview(post.fullPicture || '');
  }

  function updateMediaPreview(url) {
    if (url) {
      previewMediaImg.src = url;
      previewMediaContainer.style.display = 'flex';
      previewMediaImg.onerror = () => {
        previewMediaContainer.style.display = 'none';
      };
    } else {
      previewMediaContainer.style.display = 'none';
    }
  }

  async function executePublish() {
    publishResultsCard.style.display = 'block';
    publishStatusBadge.textContent = 'Đang đăng bài...';
    publishStatusBadge.className = 'badge';
    publishProgressBar.style.width = '20%';
    publishResultsList.innerHTML = '<div style="color:var(--text-secondary);padding:8px 0;">Đang khởi tạo các luồng đăng bài...</div>';

    startPublishBtn.disabled = true;

    try {
      const payload = {
        targetPageIds: Array.from(state.selectedTargetPageIds),
        message: editPostMessage.value.trim(),
        imageUrl: editPostImageUrl.value.trim() || undefined,
        link: editPostLinkUrl.value.trim() || undefined
      };

      const res = await fetch('/api/cp/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': state.sessionToken
        },
        body: JSON.stringify(payload)
      });

      publishProgressBar.style.width = '100%';
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Lỗi xử lý yêu cầu đăng bài');
      }

      publishStatusBadge.textContent = `Thành công ${data.summary.success}/${data.summary.total} trang`;
      publishStatusBadge.className = data.summary.failed === 0 ? 'badge badge-success' : 'badge badge-warning';

      let resultsHtml = '';
      data.results.forEach(r => {
        if (r.success) {
          resultsHtml += `
            <div class="cp-result-item cp-result-success">
              <span><strong>${escapeHtml(r.pageName)}</strong>: Đã đăng thành công</span>
              <span><i data-lucide="check" style="width:16px;height:16px;"></i></span>
            </div>
          `;
        } else {
          resultsHtml += `
            <div class="cp-result-item cp-result-failed">
              <span><strong>${escapeHtml(r.pageName)}</strong>: Lỗi - ${escapeHtml(r.error)}</span>
              <span><i data-lucide="alert-circle" style="width:16px;height:16px;"></i></span>
            </div>
          `;
        }
      });

      publishResultsList.innerHTML = resultsHtml;
      refreshIcons();
    } catch (err) {
      publishStatusBadge.textContent = 'Có lỗi xảy ra';
      publishStatusBadge.className = 'badge badge-danger';
      publishResultsList.innerHTML = `<div class="cp-result-item cp-result-failed">Lỗi: ${escapeHtml(err.message)}</div>`;
    } finally {
      startPublishBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------
  // TAB 2: ADS CREATION STUDIO (4-STEP BATCH WIZARD)
  // -------------------------------------------------------------

  const studioState = {
    step: 1,
    campMode: 'existing', // 'existing' | 'new'
    adsetMode: 'existing', // 'existing' | 'new'

    // Step 1: Campaign
    accountId: '',
    accountName: '',
    existingCampaignId: '',
    existingCampaignName: '',
    campPrefix: 'haicm',
    campProduct: 'ucmas',
    campDesc: 'mess/khaigiang',
    campCboBudget: '',

    // Step 2: Ad Set
    selectedExistingAdsetIds: new Set(),
    newAdsetName: 'Nhóm QC - Nữ 25-45 HN',
    newAdsetPageId: '',
    newAdsetBudget: 100000,
    targetAgeMin: 25,
    targetAgeMax: 45,
    targetGender: 'female',
    targetLocation: 'HN',
    placementMode: 'auto',

    // Step 3: Content / Creatives
    contentMethod: 'posts', // 'posts' | 'custom' | 'clone_ads'
    selectedPosts: new Map(), // postId -> post
    customCards: [
      {
        id: 1,
        name: 'Quảng cáo 01 - Tập trung',
        title: 'Bí Quyết Giúp Con Tập Trung Học Tập',
        message: 'Con ngồi vào bàn học nhưng chỉ vài phút đã xao nhãng? Đăng ký ngay để nhận tư vấn lộ trình học toán tư duy!',
        imageUrl: '',
        videoId: ''
      }
    ],
    selectedCloneAds: new Map(), // adId -> ad

    // Matrix preview items
    matrixAds: [],

    // Execution state
    isExecuting: false,
    initialized: false
  };

  function initStudioEvents() {
    if (studioState.initialized) return;
    studioState.initialized = true;

    // 1. Navigation buttons
    btnStudioBack?.addEventListener('click', () => {
      if (studioState.step > 1 && !studioState.isExecuting) {
        goToStudioStep(studioState.step - 1);
      }
    });

    btnStudioNext?.addEventListener('click', () => {
      if (studioState.step < 4 && !studioState.isExecuting) {
        goToStudioStep(studioState.step + 1);
      }
    });

    btnStudioExecute?.addEventListener('click', () => {
      if (!studioState.isExecuting) {
        executeStudioBatch();
      }
    });

    // 2. Stepper indicators
    document.querySelectorAll('.studio-step-item').forEach(item => {
      item.addEventListener('click', () => {
        if (studioState.isExecuting) return;
        const targetStep = parseInt(item.dataset.step, 10);
        if (targetStep < studioState.step) {
          goToStudioStep(targetStep);
        }
      });
    });

    // 3. Step 1: Account selection
    const studioAccountSelect = document.getElementById('studioAccountSelect');
    studioAccountSelect?.addEventListener('change', (e) => {
      const accId = e.target.value;
      studioState.accountId = accId;
      const acc = state.adAccounts.find(a => a.accountId === accId);
      studioState.accountName = acc ? acc.name : accId;

      if (accId) {
        loadStudioCampaigns(accId);
      } else {
        const campSelect = document.getElementById('studioCampaignSelect');
        if (campSelect) {
          campSelect.innerHTML = '<option value="">-- Chọn tài khoản ở trên trước --</option>';
          campSelect.disabled = true;
        }
      }
    });

    // Step 1: Campaign select
    const studioCampaignSelect = document.getElementById('studioCampaignSelect');
    studioCampaignSelect?.addEventListener('change', (e) => {
      studioState.existingCampaignId = e.target.value;
      const opt = e.target.selectedOptions[0];
      studioState.existingCampaignName = opt ? opt.textContent : e.target.value;
    });

    // Step 1: Campaign Mode switcher
    const btnModeExistingCamp = document.getElementById('btnModeExistingCamp');
    const btnModeNewCamp = document.getElementById('btnModeNewCamp');
    const boxExistingCamp = document.getElementById('boxExistingCamp');
    const boxNewCamp = document.getElementById('boxNewCamp');

    btnModeExistingCamp?.addEventListener('click', () => {
      studioState.campMode = 'existing';
      btnModeExistingCamp.classList.add('active');
      btnModeNewCamp.classList.remove('active');
      if (boxExistingCamp) boxExistingCamp.style.display = 'block';
      if (boxNewCamp) boxNewCamp.style.display = 'none';
    });

    btnModeNewCamp?.addEventListener('click', () => {
      studioState.campMode = 'new';
      btnModeNewCamp.classList.add('active');
      btnModeExistingCamp.classList.remove('active');
      if (boxExistingCamp) boxExistingCamp.style.display = 'none';
      if (boxNewCamp) boxNewCamp.style.display = 'block';
      updateCampNamePreview();
    });

    // Step 1: Campaign Naming Helper inputs
    const campPrefixInput = document.getElementById('campPrefixInput');
    const campDescInput = document.getElementById('campDescInput');
    const campCboBudget = document.getElementById('campCboBudget');

    campPrefixInput?.addEventListener('input', (e) => {
      studioState.campPrefix = e.target.value.trim() || 'haicm';
      updateCampNamePreview();
    });

    campDescInput?.addEventListener('input', (e) => {
      studioState.campDesc = e.target.value.trim();
      updateCampNamePreview();
    });

    campCboBudget?.addEventListener('input', (e) => {
      studioState.campCboBudget = e.target.value;
    });

    // Product tags click
    document.querySelectorAll('#campProductTags .product-tag-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#campProductTags .product-tag-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        studioState.campProduct = btn.dataset.product || 'ucmas';
        updateCampNamePreview();
      });
    });

    // 4. Step 2: Ad Set Mode Switcher
    const btnModeExistingAdset = document.getElementById('btnModeExistingAdset');
    const btnModeNewAdset = document.getElementById('btnModeNewAdset');
    const boxExistingAdset = document.getElementById('boxExistingAdset');
    const boxNewAdset = document.getElementById('boxNewAdset');

    btnModeExistingAdset?.addEventListener('click', () => {
      if (studioState.campMode === 'new') {
        alert('Chiến dịch tạo mới chưa có nhóm quảng cáo sẵn. Vui lòng thiết lập Nhóm mới.');
        return;
      }
      studioState.adsetMode = 'existing';
      btnModeExistingAdset.classList.add('active');
      btnModeNewAdset.classList.remove('active');
      if (boxExistingAdset) boxExistingAdset.style.display = 'block';
      if (boxNewAdset) boxNewAdset.style.display = 'none';
    });

    btnModeNewAdset?.addEventListener('click', () => {
      studioState.adsetMode = 'new';
      btnModeNewAdset.classList.add('active');
      btnModeExistingAdset.classList.remove('active');
      if (boxExistingAdset) boxExistingAdset.style.display = 'none';
      if (boxNewAdset) boxNewAdset.style.display = 'block';
    });

    // Step 2: New Adset inputs
    document.getElementById('newAdsetNameInput')?.addEventListener('input', e => { studioState.newAdsetName = e.target.value; });
    document.getElementById('newAdsetPageSelect')?.addEventListener('change', e => { studioState.newAdsetPageId = e.target.value; });
    document.getElementById('newAdsetBudget')?.addEventListener('input', e => { studioState.newAdsetBudget = Number(e.target.value) || 100000; });
    document.getElementById('targetAgeMin')?.addEventListener('input', e => { studioState.targetAgeMin = Number(e.target.value) || 25; });
    document.getElementById('targetAgeMax')?.addEventListener('input', e => { studioState.targetAgeMax = Number(e.target.value) || 45; });
    document.getElementById('targetGender')?.addEventListener('change', e => { studioState.targetGender = e.target.value; });
    document.getElementById('targetLocationPreset')?.addEventListener('change', e => { studioState.targetLocation = e.target.value; });
    document.querySelectorAll('input[name="placementMode"]').forEach(radio => {
      radio.addEventListener('change', e => { studioState.placementMode = e.target.value; });
    });

    // 5. Step 3: Content Tabs
    const tabPosts = document.getElementById('tabContentFromPosts');
    const tabCustom = document.getElementById('tabContentCustom');
    const tabClone = document.getElementById('tabContentCloneAds');

    tabPosts?.addEventListener('click', () => setContentMethod('posts'));
    tabCustom?.addEventListener('click', () => setContentMethod('custom'));
    tabClone?.addEventListener('click', () => setContentMethod('clone_ads'));

    // Step 3A: Posts picker
    document.getElementById('sourceContentPageSelect')?.addEventListener('change', (e) => {
      if (e.target.value) loadStudioPosts(e.target.value);
    });

    document.getElementById('btnSelectAllPosts')?.addEventListener('click', () => {
      const items = document.querySelectorAll('#studioPostsGrid .post-multi-item');
      items.forEach(el => {
        const id = el.dataset.postId;
        const post = state.posts.find(p => p.id === id);
        if (post) {
          studioState.selectedPosts.set(id, post);
          el.classList.add('selected');
          const chk = el.querySelector('input[type="checkbox"]');
          if (chk) chk.checked = true;
        }
      });
      updateMatrixAds();
    });

    document.getElementById('btnDeselectAllPosts')?.addEventListener('click', () => {
      studioState.selectedPosts.clear();
      document.querySelectorAll('#studioPostsGrid .post-multi-item').forEach(el => {
        el.classList.remove('selected');
        const chk = el.querySelector('input[type="checkbox"]');
        if (chk) chk.checked = false;
      });
      updateMatrixAds();
    });

    // Step 3B: Custom cards
    document.getElementById('btnAddCustomCard')?.addEventListener('click', () => {
      const nextId = (studioState.customCards.length || 0) + 1;
      studioState.customCards.push({
        id: nextId,
        name: `Quảng cáo 0${nextId} - Nội dung mới`,
        title: 'Ưu Đãi Tuyển Sinh Đăng Ký Hôm Nay',
        message: 'Chương trình học trải nghiệm giúp bé phát triển tư duy toàn diện. Inbox ngay để nhận ưu đãi đặc biệt!',
        imageUrl: '',
        videoId: ''
      });
      renderCustomCards();
      updateMatrixAds();
    });

    // Step 3C: Clone sample adset
    document.getElementById('cloneAdSourceAdsetSelect')?.addEventListener('change', (e) => {
      if (e.target.value) loadCloneAds(e.target.value);
    });
  }

  function updateCampNamePreview() {
    const previewEl = document.getElementById('campFullNamePreview');
    if (!previewEl) return;
    const cleanDesc = (studioState.campDesc || 'khaigiang').replace(/^mess\//, '').trim();
    const fullName = `${studioState.campPrefix}/${studioState.campProduct}/mess/${cleanDesc}`;
    previewEl.value = fullName;
  }

  function setContentMethod(method) {
    studioState.contentMethod = method;

    const tabPosts = document.getElementById('tabContentFromPosts');
    const tabCustom = document.getElementById('tabContentCustom');
    const tabClone = document.getElementById('tabContentCloneAds');

    const secPosts = document.getElementById('creativeSectionPosts');
    const secCustom = document.getElementById('creativeSectionCustom');
    const secClone = document.getElementById('creativeSectionCloneAds');

    tabPosts?.classList.toggle('active', method === 'posts');
    tabCustom?.classList.toggle('active', method === 'custom');
    tabClone?.classList.toggle('active', method === 'clone_ads');

    if (secPosts) secPosts.style.display = method === 'posts' ? 'block' : 'none';
    if (secCustom) secCustom.style.display = method === 'custom' ? 'block' : 'none';
    if (secClone) secClone.style.display = method === 'clone_ads' ? 'block' : 'none';

    updateMatrixAds();
    refreshIcons();
  }

  async function initStudio() {
    initStudioEvents();
    goToStudioStep(1);
    await loadStudioAccounts();
    updateCampNamePreview();
  }

  async function loadStudioAccounts() {
    const sel = document.getElementById('studioAccountSelect');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Đang tải tài khoản quảng cáo... --</option>';
    sel.disabled = true;

    try {
      const res = await fetch('/api/cp/ad-accounts');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi tải danh sách tài khoản');

      state.adAccounts = data.accounts || [];
      if (state.adAccounts.length === 0) {
        sel.innerHTML = '<option value="">(Không có tài khoản quảng cáo nào)</option>';
        return;
      }

      let html = '<option value="">-- Chọn tài khoản quảng cáo đích --</option>';
      state.adAccounts.forEach(acc => {
        html += `<option value="${acc.accountId}">${escapeHtml(acc.name)} (act_${acc.accountId})</option>`;
      });
      sel.innerHTML = html;
      sel.disabled = false;

      // Auto select first account if none selected
      if (!studioState.accountId && state.adAccounts.length > 0) {
        sel.value = state.adAccounts[0].accountId;
        studioState.accountId = state.adAccounts[0].accountId;
        studioState.accountName = state.adAccounts[0].name;
        loadStudioCampaigns(studioState.accountId);
      }
    } catch (err) {
      sel.innerHTML = `<option value="">Lỗi: ${escapeHtml(err.message)}</option>`;
    }
  }

  async function loadStudioCampaigns(accountId) {
    const campSelect = document.getElementById('studioCampaignSelect');
    if (!campSelect) return;

    campSelect.innerHTML = '<option value="">-- Đang tải chiến dịch... --</option>';
    campSelect.disabled = true;

    try {
      const res = await fetch(`/api/cp/ad-accounts/${accountId}/campaigns`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi tải chiến dịch');

      const camps = data.campaigns || [];
      if (camps.length === 0) {
        campSelect.innerHTML = '<option value="">(Tài khoản chưa có chiến dịch nào)</option>';
        return;
      }

      let html = '<option value="">-- Chọn chiến dịch có sẵn --</option>';
      camps.forEach(c => {
        html += `<option value="${c.id}">${escapeHtml(c.name)} (${c.effective_status})</option>`;
      });
      campSelect.innerHTML = html;
      campSelect.disabled = false;

      if (camps.length > 0) {
        campSelect.value = camps[0].id;
        studioState.existingCampaignId = camps[0].id;
        studioState.existingCampaignName = camps[0].name;
      }
    } catch (err) {
      campSelect.innerHTML = `<option value="">Lỗi: ${escapeHtml(err.message)}</option>`;
    }
  }

  function goToStudioStep(targetStep) {
    if (targetStep < 1 || targetStep > 4) return;

    // Validate step before advancing
    if (targetStep > studioState.step) {
      if (studioState.step === 1) {
        if (!studioState.accountId) {
          alert('Vui lòng chọn Tài khoản Quảng cáo đích.');
          return;
        }
        if (studioState.campMode === 'existing' && !studioState.existingCampaignId) {
          alert('Vui lòng chọn Chiến dịch đích có sẵn.');
          return;
        }
      } else if (studioState.step === 2) {
        if (studioState.adsetMode === 'existing') {
          if (studioState.selectedExistingAdsetIds.size === 0) {
            alert('Vui lòng chọn ít nhất 1 Nhóm quảng cáo đích trong chiến dịch.');
            return;
          }
        } else {
          const nameInput = document.getElementById('newAdsetNameInput');
          const pageSelect = document.getElementById('newAdsetPageSelect');
          if (!nameInput || !nameInput.value.trim()) {
            alert('Vui lòng nhập tên Nhóm quảng cáo mới.');
            return;
          }
          if (!pageSelect || !pageSelect.value) {
            alert('Vui lòng chọn Fanpage nhận tin nhắn.');
            return;
          }
          studioState.newAdsetName = nameInput.value.trim();
          studioState.newAdsetPageId = pageSelect.value;
        }
      } else if (studioState.step === 3) {
        updateMatrixAds();
        if (studioState.matrixAds.length === 0) {
          alert('Vui lòng chọn ít nhất 1 bài viết hoặc thêm 1 nội dung quảng cáo để tiếp tục.');
          return;
        }
      }
    }

    studioState.step = targetStep;

    // Show/hide step panels
    for (let s = 1; s <= 4; s++) {
      const stepEl = document.getElementById(`studioStep${s}`);
      const indEl = document.getElementById(`stepIndicator${s}`);
      if (stepEl) stepEl.style.display = s === targetStep ? 'block' : 'none';
      if (indEl) {
        indEl.classList.toggle('active', s === targetStep);
        indEl.classList.toggle('done', s < targetStep);
      }
    }

    // Step-specific onEnter
    if (targetStep === 2) onEnterStep2();
    else if (targetStep === 3) onEnterStep3();
    else if (targetStep === 4) onEnterStep4();

    // Nav buttons update
    if (btnStudioBack) btnStudioBack.style.display = targetStep > 1 ? 'inline-flex' : 'none';
    if (btnStudioNext) btnStudioNext.style.display = targetStep < 4 ? 'inline-flex' : 'none';
    if (btnStudioExecute) btnStudioExecute.style.display = targetStep === 4 ? 'inline-flex' : 'none';

    refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onEnterStep2() {
    // Populate fanpage select
    const pageSel = document.getElementById('newAdsetPageSelect');
    if (pageSel && pageSel.options.length <= 1) {
      let html = '<option value="">-- Chọn Fanpage nhận tin nhắn --</option>';
      state.pages.forEach(p => {
        html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
      });
      pageSel.innerHTML = html;
      if (state.pages.length > 0) {
        pageSel.value = state.pages[0].id;
        studioState.newAdsetPageId = state.pages[0].id;
      }
    }

    const btnModeExistingAdset = document.getElementById('btnModeExistingAdset');
    const btnModeNewAdset = document.getElementById('btnModeNewAdset');
    const boxExistingAdset = document.getElementById('boxExistingAdset');
    const boxNewAdset = document.getElementById('boxNewAdset');

    if (studioState.campMode === 'new') {
      // New campaign -> force new adset
      studioState.adsetMode = 'new';
      if (btnModeExistingAdset) btnModeExistingAdset.style.opacity = '0.5';
      if (btnModeNewAdset) btnModeNewAdset.classList.add('active');
      if (boxExistingAdset) boxExistingAdset.style.display = 'none';
      if (boxNewAdset) boxNewAdset.style.display = 'block';
    } else {
      if (btnModeExistingAdset) btnModeExistingAdset.style.opacity = '1';
      if (studioState.adsetMode === 'existing') {
        btnModeExistingAdset?.classList.add('active');
        btnModeNewAdset?.classList.remove('active');
        if (boxExistingAdset) boxExistingAdset.style.display = 'block';
        if (boxNewAdset) boxNewAdset.style.display = 'none';
        loadExistingAdsets(studioState.existingCampaignId);
      }
    }
  }

  async function loadExistingAdsets(campaignId) {
    const listEl = document.getElementById('studioExistingAdsetsList');
    if (!listEl || !campaignId) return;

    listEl.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span><p style="margin-top:8px;">Đang tải danh sách nhóm quảng cáo...</p></div>';

    try {
      const res = await fetch(`/api/cp/campaigns/${campaignId}/adsets`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi tải nhóm quảng cáo');

      const adsets = data.adsets || [];
      if (adsets.length === 0) {
        listEl.innerHTML = '<div class="cp-empty-state">Chiến dịch này chưa có nhóm quảng cáo nào. Hãy chuyển sang "Tạo Nhóm mới".</div>';
        return;
      }

      listEl.innerHTML = '';
      studioState.selectedExistingAdsetIds.clear();

      adsets.forEach(adset => {
        const item = document.createElement('div');
        item.className = 'cp-target-item';
        item.dataset.adsetId = adset.id;

        item.innerHTML = `
          <input type="checkbox" id="chk_studio_adset_${adset.id}" style="pointer-events:none;">
          <div class="cp-target-details">
            <span class="cp-target-name">${escapeHtml(adset.name)}</span>
            <span class="cp-target-sub">ID: ${adset.id} • ${adset.effective_status}</span>
          </div>
        `;

        item.addEventListener('click', () => {
          if (studioState.selectedExistingAdsetIds.has(adset.id)) {
            studioState.selectedExistingAdsetIds.delete(adset.id);
            item.classList.remove('checked');
            item.querySelector('input').checked = false;
          } else {
            studioState.selectedExistingAdsetIds.add(adset.id);
            item.classList.add('checked');
            item.querySelector('input').checked = true;
          }
          const cntEl = document.getElementById('studioSelectedAdsetsCount');
          if (cntEl) cntEl.textContent = studioState.selectedExistingAdsetIds.size;
        });

        listEl.appendChild(item);
      });

      // Auto select first adset
      if (adsets.length > 0) {
        const first = listEl.querySelector('.cp-target-item');
        if (first) first.click();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="cp-empty-state" style="color:var(--danger-text)">Lỗi: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function onEnterStep3() {
    // Populate Page Select for Content from Fanpage
    const pSel = document.getElementById('sourceContentPageSelect');
    if (pSel && pSel.options.length <= 1) {
      let html = '<option value="">-- Chọn Fanpage lấy bài viết --</option>';
      state.pages.forEach(p => {
        html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
      });
      pSel.innerHTML = html;

      // Match target page if chosen
      if (studioState.newAdsetPageId) {
        pSel.value = studioState.newAdsetPageId;
        loadStudioPosts(studioState.newAdsetPageId);
      } else if (state.pages.length > 0) {
        pSel.value = state.pages[0].id;
        loadStudioPosts(state.pages[0].id);
      }
    }

    // Populate adset select for Clone Ads mode
    const adsetSel = document.getElementById('cloneAdSourceAdsetSelect');
    if (adsetSel && adsetSel.options.length <= 1 && studioState.accountId) {
      try {
        const res = await fetch(`/api/cp/ad-accounts/${studioState.accountId}/campaigns`);
        const data = await res.json();
        const camps = data.campaigns || [];
        if (camps.length > 0) {
          const asRes = await fetch(`/api/cp/campaigns/${camps[0].id}/adsets`);
          const asData = await asRes.json();
          let html = '<option value="">-- Chọn nhóm quảng cáo mẫu --</option>';
          (asData.adsets || []).forEach(as => {
            html += `<option value="${as.id}">${escapeHtml(as.name)}</option>`;
          });
          adsetSel.innerHTML = html;
        }
      } catch (e) { /* ignore */ }
    }

    renderCustomCards();
    updateMatrixAds();
  }

  async function loadStudioPosts(pageId) {
    const grid = document.getElementById('studioPostsGrid');
    const loading = document.getElementById('studioPostsLoading');
    if (!grid) return;

    if (loading) loading.style.display = 'block';
    grid.style.display = 'none';

    try {
      const res = await fetch(`/api/cp/pages/${pageId}/posts?limit=25`);
      const data = await res.json();
      if (loading) loading.style.display = 'none';
      grid.style.display = 'flex';

      if (!data.ok) throw new Error(data.error || 'Lỗi tải bài viết');

      state.posts = data.posts || [];
      if (state.posts.length === 0) {
        grid.innerHTML = '<div class="cp-empty-state">Trang này chưa có bài đăng nào gần đây.</div>';
        return;
      }

      grid.innerHTML = '';
      studioState.selectedPosts.clear();

      state.posts.forEach((post, index) => {
        const item = document.createElement('div');
        item.className = 'post-multi-item';
        item.dataset.postId = post.id;

        const thumb = post.fullPicture
          ? `<img src="${post.fullPicture}" class="cp-post-thumb" alt="Thumb" loading="lazy">`
          : `<div class="cp-post-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">Bài viết</div>`;

        const snippet = post.message || '(Bài viết không có văn bản)';

        item.innerHTML = `
          <input type="checkbox" id="chk_post_${post.id}" style="pointer-events:none;margin-top:4px;">
          ${thumb}
          <div class="cp-post-info">
            <div class="cp-post-text">${escapeHtml(snippet)}</div>
            <div class="cp-post-meta">
              <span><i data-lucide="clock" style="width:12px;height:12px;"></i> ${formatDate(post.createdTime)}</span>
              <span><i data-lucide="thumbs-up" style="width:12px;height:12px;"></i> ${formatNum(post.reactionsCount)}</span>
              <span><i data-lucide="message-square" style="width:12px;height:12px;"></i> ${formatNum(post.commentsCount)}</span>
            </div>
          </div>
        `;

        item.addEventListener('click', () => {
          if (studioState.selectedPosts.has(post.id)) {
            studioState.selectedPosts.delete(post.id);
            item.classList.remove('selected');
            item.querySelector('input').checked = false;
          } else {
            studioState.selectedPosts.set(post.id, post);
            item.classList.add('selected');
            item.querySelector('input').checked = true;
          }
          updateMatrixAds();
        });

        grid.appendChild(item);

        // Auto select first post
        if (index === 0) {
          item.click();
        }
      });

      refreshIcons();
    } catch (err) {
      if (loading) loading.style.display = 'none';
      grid.style.display = 'flex';
      grid.innerHTML = `<div class="cp-empty-state" style="color:var(--danger-text)">Lỗi: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderCustomCards() {
    const container = document.getElementById('customCardsContainer');
    if (!container) return;

    container.innerHTML = '';

    studioState.customCards.forEach((card, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'custom-creative-card';
      cardEl.id = `customCard_${card.id}`;

      cardEl.innerHTML = `
        <div class="creative-card-header">
          <div style="font-size:0.85rem;font-weight:700;color:var(--primary-text);display:flex;align-items:center;gap:6px;">
            <span class="step-num" style="width:20px;height:20px;font-size:0.75rem;">${index + 1}</span>
            <span>Nội dung Quảng cáo #${index + 1}</span>
          </div>
          ${studioState.customCards.length > 1 ? `
            <button type="button" class="btn btn-secondary btn-sm btn-delete-card" data-card-id="${card.id}" style="color:var(--danger);padding:2px 8px;">
              <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              <span>Xóa</span>
            </button>
          ` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-2);">
          <div class="cp-form-group">
            <label class="cp-form-label">Tên quảng cáo (Ad Name)</label>
            <input type="text" class="cp-input card-input-name" value="${escapeHtml(card.name)}" placeholder="Tên Ad...">
          </div>
          <div class="cp-form-group">
            <label class="cp-form-label">Tiêu đề (Headline)</label>
            <input type="text" class="cp-input card-input-title" value="${escapeHtml(card.title)}" placeholder="Tiêu đề nổi bật...">
          </div>
        </div>

        <div class="cp-form-group" style="margin-bottom:var(--space-2);">
          <label class="cp-form-label">Nội dung / Caption bài quảng cáo</label>
          <textarea class="cp-textarea card-input-msg" style="min-height:80px;" placeholder="Nhập nội dung quảng cáo...">${escapeHtml(card.message)}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-3);">
          <div class="cp-form-group">
            <label class="cp-form-label">URL Hình ảnh (Public image link)</label>
            <input type="url" class="cp-input card-input-img" value="${escapeHtml(card.imageUrl)}" placeholder="https://... URL ảnh">
          </div>
          <div class="cp-form-group">
            <label class="cp-form-label">Nút kêu gọi</label>
            <input type="text" class="cp-input" value="Gửi tin nhắn (m.me)" readonly disabled>
          </div>
        </div>
      `;

      // Event listeners for card inputs
      cardEl.querySelector('.card-input-name')?.addEventListener('input', e => { card.name = e.target.value; updateMatrixAds(); });
      cardEl.querySelector('.card-input-title')?.addEventListener('input', e => { card.title = e.target.value; updateMatrixAds(); });
      cardEl.querySelector('.card-input-msg')?.addEventListener('input', e => { card.message = e.target.value; updateMatrixAds(); });
      cardEl.querySelector('.card-input-img')?.addEventListener('input', e => { card.imageUrl = e.target.value; updateMatrixAds(); });

      cardEl.querySelector('.btn-delete-card')?.addEventListener('click', () => {
        studioState.customCards = studioState.customCards.filter(c => c.id !== card.id);
        renderCustomCards();
        updateMatrixAds();
      });

      container.appendChild(cardEl);
    });

    refreshIcons();
  }

  async function loadCloneAds(adsetId) {
    const listEl = document.getElementById('cloneAdsList');
    if (!listEl) return;

    listEl.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span><p>Đang tải quảng cáo mẫu...</p></div>';

    try {
      const res = await fetch(`/api/cp/adsets/${adsetId}/ads`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi tải ads');

      const ads = data.ads || [];
      if (ads.length === 0) {
        listEl.innerHTML = '<div class="cp-empty-state">Nhóm này không có quảng cáo nào.</div>';
        return;
      }

      listEl.innerHTML = '';
      studioState.selectedCloneAds.clear();

      ads.forEach((ad, idx) => {
        const item = document.createElement('div');
        item.className = 'post-multi-item';
        item.dataset.adId = ad.id;

        const cr = ad.creative || {};
        const img = cr.image_url || cr.thumbnail_url || '';
        const thumb = img
          ? `<img src="${img}" class="cp-post-thumb" alt="Thumb" loading="lazy">`
          : `<div class="cp-post-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">Ad</div>`;

        item.innerHTML = `
          <input type="checkbox" id="chk_clone_${ad.id}" style="pointer-events:none;margin-top:4px;">
          ${thumb}
          <div class="cp-post-info">
            <div class="cp-post-text"><strong>${escapeHtml(ad.name)}</strong></div>
            <div class="cp-post-meta">
              <span>ID: ${ad.id}</span>
              <span class="badge ${ad.effective_status === 'ACTIVE' ? 'badge-success' : ''}">${ad.effective_status}</span>
            </div>
          </div>
        `;

        item.addEventListener('click', () => {
          if (studioState.selectedCloneAds.has(ad.id)) {
            studioState.selectedCloneAds.delete(ad.id);
            item.classList.remove('selected');
            item.querySelector('input').checked = false;
          } else {
            studioState.selectedCloneAds.set(ad.id, ad);
            item.classList.add('selected');
            item.querySelector('input').checked = true;
          }
          updateMatrixAds();
        });

        listEl.appendChild(item);
        if (idx === 0) item.click();
      });

      refreshIcons();
    } catch (err) {
      listEl.innerHTML = `<div class="cp-empty-state" style="color:var(--danger-text)">Lỗi: ${escapeHtml(err.message)}</div>`;
    }
  }

  function updateMatrixAds() {
    studioState.matrixAds = [];

    if (studioState.contentMethod === 'posts') {
      studioState.selectedPosts.forEach(post => {
        studioState.matrixAds.push({
          type: 'page_post',
          name: `[Post Ad] ${(post.message || 'Quảng cáo Fanpage').slice(0, 40)}`,
          sourcePostId: post.id,
          message: post.message || '',
          imageUrl: post.fullPicture || '',
          title: ''
        });
      });
    } else if (studioState.contentMethod === 'custom') {
      studioState.customCards.forEach(c => {
        if (c.name || c.message || c.imageUrl) {
          studioState.matrixAds.push({
            type: 'custom',
            name: c.name || 'Quảng cáo mới',
            title: c.title || '',
            message: c.message || '',
            imageUrl: c.imageUrl || '',
            videoId: c.videoId || ''
          });
        }
      });
    } else if (studioState.contentMethod === 'clone_ads') {
      studioState.selectedCloneAds.forEach(ad => {
        studioState.matrixAds.push({
          type: 'clone_ad',
          name: `[Nhân bản] ${ad.name}`,
          sourceAdId: ad.id,
          message: ad.creative?.body || '',
          title: ad.creative?.title || '',
          imageUrl: ad.creative?.image_url || ad.creative?.thumbnail_url || ''
        });
      });
    }

    // Render Matrix Preview Grid
    const previewGrid = document.getElementById('studioMatrixPreview');
    const summaryBadge = document.getElementById('matrixSummaryBadge');
    const countBadge = document.getElementById('studioCreativeCountBadge');

    const totalCreatives = studioState.matrixAds.length;
    const targetCount = studioState.adsetMode === 'new' ? 1 : Math.max(1, studioState.selectedExistingAdsetIds.size);
    const totalWillCreate = totalCreatives * targetCount;

    if (countBadge) countBadge.textContent = `${totalCreatives} nội dung sẵn sàng`;
    if (summaryBadge) summaryBadge.textContent = `${totalCreatives} nội dung × ${targetCount} nhóm = ${totalWillCreate} Ads`;

    if (!previewGrid) return;

    if (totalCreatives === 0) {
      previewGrid.innerHTML = '<div class="cp-empty-state" style="grid-column:1/-1;">Chưa có nội dung nào được chọn. Hãy chọn bài viết hoặc thêm nội dung ở trên.</div>';
      return;
    }

    let html = '';
    studioState.matrixAds.forEach((ad, i) => {
      const thumb = ad.imageUrl
        ? `<img src="${ad.imageUrl}" class="matrix-ad-thumb" alt="Thumb" loading="lazy">`
        : `<div class="matrix-ad-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;">Ad #${i + 1}</div>`;

      html += `
        <div class="matrix-ad-card">
          ${thumb}
          <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ad.name)}</div>
          ${ad.title ? `<div style="font-size:0.75rem;color:var(--primary-text);font-weight:600;">${escapeHtml(ad.title)}</div>` : ''}
          <div style="font-size:0.75rem;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(ad.message || '(Không có văn bản)')}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:6px;border-top:1px solid var(--border-subtle);font-size:0.72rem;color:var(--text-muted);">
            <span class="badge" style="font-size:0.7rem;">PAUSED</span>
            <span>Đích: ${targetCount} nhóm</span>
          </div>
        </div>
      `;
    });

    previewGrid.innerHTML = html;
  }

  function onEnterStep4() {
    // Fill summary details
    const accEl = document.getElementById('sumAccountName');
    const campEl = document.getElementById('sumCampaignName');
    const adsetEl = document.getElementById('sumAdsetName');
    const countEl = document.getElementById('sumTotalAdsCount');

    if (accEl) accEl.textContent = `${studioState.accountName} (act_${studioState.accountId})`;

    if (campEl) {
      if (studioState.campMode === 'new') {
        const preview = document.getElementById('campFullNamePreview')?.value || 'Chiến dịch mới';
        campEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${escapeHtml(preview)}</span>`;
      } else {
        campEl.textContent = studioState.existingCampaignName || studioState.existingCampaignId;
      }
    }

    if (adsetEl) {
      if (studioState.adsetMode === 'new') {
        adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${escapeHtml(studioState.newAdsetName)}</span>`;
      } else {
        adsetEl.textContent = `${studioState.selectedExistingAdsetIds.size} nhóm có sẵn trong chiến dịch`;
      }
    }

    const totalCreatives = studioState.matrixAds.length;
    const targetCount = studioState.adsetMode === 'new' ? 1 : Math.max(1, studioState.selectedExistingAdsetIds.size);
    const totalWillCreate = totalCreatives * targetCount;

    if (countEl) countEl.textContent = `${totalWillCreate} Ads`;

    // Reset progress area
    const pArea = document.getElementById('studioProgressArea');
    if (pArea) pArea.style.display = 'none';

    if (btnStudioExecute) {
      btnStudioExecute.disabled = false;
      btnStudioExecute.innerHTML = `<i data-lucide="rocket"></i><span>Tiến hành tạo Quảng cáo (PAUSED)</span>`;
    }
    refreshIcons();
  }

  function logStudio(msg, type = 'info') {
    const logBox = document.getElementById('studioExecutionLog');
    if (!logBox) return;

    const time = new Date().toLocaleTimeString('vi-VN');
    let color = 'var(--text-secondary)';
    if (type === 'success') color = 'var(--success-text)';
    else if (type === 'error') color = 'var(--danger-text)';
    else if (type === 'warn') color = 'var(--warning-text)';

    const row = document.createElement('div');
    row.style.color = color;
    row.style.marginBottom = '4px';
    row.innerHTML = `<span style="color:var(--text-muted)">[${time}]</span> ${escapeHtml(msg)}`;
    logBox.appendChild(row);
    logBox.scrollTop = logBox.scrollHeight;
  }

  async function executeStudioBatch() {
    if (!confirm('Xác nhận tiến hành tạo hàng loạt quảng cáo lên Meta?\nToàn bộ sẽ ở trạng thái TẠM DỪNG (PAUSED) an toàn.')) {
      return;
    }

    const execBtn = document.getElementById('studioExecuteBtn');
    if (execBtn && execBtn.dataset.running === '1') return;
    if (execBtn) execBtn.dataset.running = '1';

    studioState.isExecuting = true;
    if (btnStudioBack) btnStudioBack.style.display = 'none';
    if (btnStudioExecute) {
      btnStudioExecute.disabled = true;
      btnStudioExecute.innerHTML = `<span class="cp-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span><span>Đang xử lý trên Meta...</span>`;
    }

    const pArea = document.getElementById('studioProgressArea');
    const pFill = document.getElementById('studioProgressBarFill');
    const pText = document.getElementById('studioProgressStatusText');
    const pPct = document.getElementById('studioProgressPercentText');
    const logBox = document.getElementById('studioExecutionLog');

    if (pArea) pArea.style.display = 'block';
    if (logBox) logBox.innerHTML = '';
    if (pFill) pFill.style.width = '10%';
    if (pPct) pPct.textContent = '10%';
    if (pText) pText.textContent = 'Đang chuẩn bị tiến trình...';

    logStudio('Bắt đầu quy trình tạo quảng cáo chuẩn Meta Ads Manager...', 'info');

    try {
      let finalCampId = studioState.existingCampaignId;
      let finalAdsetIds = Array.from(studioState.selectedExistingAdsetIds);
      let pageId = studioState.newAdsetPageId || (state.pages[0]?.id || '');

      // STEP A: TẠO CAMPAIGN MỚI NẾU CẦN
      if (studioState.campMode === 'new') {
        const campName = document.getElementById('campFullNamePreview')?.value || `haicm/${studioState.campProduct}/mess/cd`;
        logStudio(`[1/3] Đang gửi yêu cầu tạo Chiến dịch mới "${campName}"...`, 'info');

        const campPayload = {
          accountId: studioState.accountId,
          name: campName,
          objective: 'OUTCOME_ENGAGEMENT',
          dailyBudget: studioState.campCboBudget ? Number(studioState.campCboBudget) : undefined
        };

        const res = await fetch('/api/cp/create-campaign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': state.sessionToken },
          body: JSON.stringify(campPayload)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Lỗi khi tạo chiến dịch');

        finalCampId = data.campaign.id;
        logStudio(`✓ Đã tạo thành công Chiến dịch: ID ${finalCampId} (PAUSED)`, 'success');
        if (pFill) pFill.style.width = '30%';
        if (pPct) pPct.textContent = '30%';
        await new Promise(r => setTimeout(r, 1500));
      } else {
        logStudio(`[1/3] Sử dụng Chiến dịch có sẵn: ID ${finalCampId}`, 'info');
      }

      // STEP B: TẠO ADSET MỚI NẾU CẦN
      if (studioState.adsetMode === 'new') {
        logStudio(`[2/3] Đang gửi yêu cầu tạo Nhóm QC mới "${studioState.newAdsetName}" kèm Targeting...`, 'info');

        let geoSpec = { countries: ['VN'] };
        if (studioState.targetLocation === 'HN') geoSpec = { regions: [{ key: '3875' }] }; // Ha Noi region
        else if (studioState.targetLocation === 'HCM') geoSpec = { regions: [{ key: '3878' }] }; // Ho Chi Minh city

        let gendersSpec = undefined;
        if (studioState.targetGender === 'female') gendersSpec = [2];
        else if (studioState.targetGender === 'male') gendersSpec = [1];

        const adsetPayload = {
          accountId: studioState.accountId,
          campaignId: finalCampId,
          name: studioState.newAdsetName,
          pageId,
          dailyBudget: studioState.newAdsetBudget,
          targeting: {
            ageMin: studioState.targetAgeMin,
            ageMax: studioState.targetAgeMax,
            genders: gendersSpec,
            geoLocations: geoSpec,
            placements: studioState.placementMode === 'custom' ? ['facebook'] : undefined
          }
        };

        const res = await fetch('/api/cp/create-adset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': state.sessionToken },
          body: JSON.stringify(adsetPayload)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Lỗi khi tạo nhóm quảng cáo');

        finalAdsetIds = [data.adset.id];
        logStudio(`✓ Đã tạo thành công Nhóm QC: ID ${data.adset.id} (PAUSED)`, 'success');
        if (pFill) pFill.style.width = '60%';
        if (pPct) pPct.textContent = '60%';
        await new Promise(r => setTimeout(r, 1500));
      } else {
        logStudio(`[2/3] Nhân bản vào ${finalAdsetIds.length} nhóm quảng cáo đích`, 'info');
      }

      // STEP C: TẠO ĐỒNG THỜI NHIỀU QUẢNG CÁO
      logStudio(`[3/3] Bắt đầu tạo đồng thời ${studioState.matrixAds.length} nội dung Ads (Giãn cách an toàn 1.5s)...`, 'info');
      if (pText) pText.textContent = 'Đang khởi tạo các nội dung quảng cáo...';

      const batchPayload = {
        accountId: studioState.accountId,
        adsetIds: finalAdsetIds,
        pageId,
        items: studioState.matrixAds
      };

      const res = await fetch('/api/cp/batch-create-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': state.sessionToken },
        body: JSON.stringify(batchPayload)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi khi tạo danh sách quảng cáo');

      // Process results
      data.results.forEach(item => {
        if (item.success) {
          const adId = item.createdAds[0]?.adId || 'OK';
          logStudio(`✓ Đã tạo thành công: "${item.itemName}" → Ad ID: ${adId} (PAUSED)`, 'success');
        } else {
          logStudio(`✗ Lỗi tạo "${item.itemName}": ${item.error || 'Không rõ lỗi'}`, 'error');
        }
      });

      if (pFill) pFill.style.width = '100%';
      if (pPct) pPct.textContent = '100%';
      if (pText) pText.textContent = `Hoàn tất! Thành công ${data.summary.successItems}/${data.summary.totalItems} nội dung.`;

      logStudio(`🎉 HOÀN TẤT THÀNH CÔNG! Đã tạo ${data.summary.successItems}/${data.summary.totalItems} nội dung quảng cáo trên Meta. Tất cả đều ở trạng thái PAUSED an toàn.`, 'success');
      alert(`Đã hoàn tất tạo ${data.summary.successItems}/${data.summary.totalItems} nội dung quảng cáo thành công ở trạng thái PAUSED!`);
    } catch (err) {
      logStudio(`❌ Quá trình bị gián đoạn: ${err.message}`, 'error');
      if (pText) pText.textContent = 'Có lỗi xảy ra khi thực thi';
      alert(`Lỗi thực thi: ${err.message}`);
    } finally {
      if (execBtn) execBtn.dataset.running = '0';
      studioState.isExecuting = false;
      if (btnStudioBack) btnStudioBack.style.display = 'inline-flex';
      if (btnStudioExecute) {
        btnStudioExecute.disabled = false;
        btnStudioExecute.innerHTML = `<i data-lucide="check"></i><span>Đã thực thi xong</span>`;
      }
      refreshIcons();
    }
  }

  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
