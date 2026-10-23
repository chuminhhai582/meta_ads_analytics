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
    document.getElementById('tabBulkAdsBtn')?.addEventListener('click', () => switchTab('bulk'));

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

  const TABS = {
    fanpage: { btn: 'tabFanpageBtn', section: 'fanpageSection' },
    ads:     { btn: 'tabAdsBtn',     section: 'adsSection'     },
    bulk:    { btn: 'tabBulkAdsBtn', section: 'bulkAdsSection' }
  };

  function switchTab(tab) {
    state.activeTab = tab;
    for (const [k, v] of Object.entries(TABS)) {
      document.getElementById(v.btn)?.classList.toggle('active', k === tab);
      const sec = document.getElementById(v.section);
      if (sec) sec.style.display = (k === tab) ? 'block' : 'none';
    }
    if (tab === 'ads')  window.AdsStudio?.init();   // lazy init
    if (tab === 'bulk') window.BulkAds?.init();     // lazy init
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
      window.CPShared?.setPages(state.pages);
      window.CPShared?.setAdAccounts(state.adAccounts);

      // Render lại giao diện Fanpage nguồn
      if (sourcePageSelect) {
        let optionsHtml = '<option value="">-- Chọn Fanpage nguồn để lấy bài đăng --</option>';
        state.pages.forEach(p => {
          optionsHtml += `<option value="${p.id}">${escapeHtml(p.name)} (${formatNum(p.fanCount)} fans)</option>`;
        });
        sourcePageSelect.innerHTML = optionsHtml;
        sourcePageSelect.disabled = false;
        if (state.selectedSourcePageId) {
          sourcePageSelect.value = state.selectedSourcePageId;
        }
      }
      renderTargetPages();

      // Render lại giao diện Tài khoản Ads
      const studioAccountSelect = document.getElementById('studioAccountSelect');
      if (studioAccountSelect) {
        if (state.adAccounts.length === 0) {
          studioAccountSelect.innerHTML = '<option value="">(Không có tài khoản quảng cáo nào)</option>';
        } else {
          let accHtml = '<option value="">-- Chọn tài khoản quảng cáo đích --</option>';
          state.adAccounts.forEach(acc => {
            accHtml += `<option value="${acc.accountId}">${escapeHtml(acc.name)} (act_${acc.accountId})</option>`;
          });
          studioAccountSelect.innerHTML = accHtml;
          studioAccountSelect.disabled = false;
          if (typeof studioState !== 'undefined' && studioState && studioState.accountId) {
            studioAccountSelect.value = studioState.accountId;
          }
        }
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
      window.CPShared?.setPages(state.pages);

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



  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
