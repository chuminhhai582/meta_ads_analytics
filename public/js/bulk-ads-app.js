/**
 * Tab 3 — Đăng Ads hàng loạt vào chiến dịch / nhóm CÓ SẴN (gồm chiến dịch nháp).
 *
 * Khác tab 2 (ads-studio.js): tab này KHÔNG tạo chiến dịch/nhóm mới, chỉ gắn
 * quảng cáo vào cấu trúc đã có. Cả hai dùng chung engine POST /api/cp/build-structure.
 *
 * Mỗi đợt chỉ 1 tài khoản quảng cáo (chốt chủ dự án 23/10/2026).
 */
window.BulkAds = (function () {
  'use strict';

  const S = window.CPShared;

  const LIMITS = { // phải khớp SAFETY_LIMITS ở backend
    MAX_TARGETS: 45,
    MAX_CONTENTS: 12,
    MAX_ADS: 135
  };

  const st = {
    initialized: false,
    step: 1,
    accountId: '',
    accountName: '',
    campaigns: [],                   // đã normalize, có isDraft
    adsetsByCampaign: new Map(),     // campaignId -> adset[]
    expandedCampaigns: new Set(),
    selectedAdsets: new Map(),       // adsetId -> { campaignId, campaignName, adsetId, adsetName, pageId }
    filter: 'all',
    search: '',
    contents: [],                    // do ContentEditor quản lý
    pairingMode: 'matrix',
    namePattern: '{content} — {adset}',
    excludedPairs: new Set(),
    planId: '',
    jobId: '',
    polling: null,
    isExecuting: false
  };

  const DRAFT_REASON_TEXT = {
    no_ad:       'Chưa có quảng cáo nào',
    no_adset:    'Chưa có nhóm quảng cáo',
    in_process:  'Meta đang xử lý',
    with_issues: 'Đang có vấn đề cần xử lý'
  };

  function init() {
    if (st.initialized) return;
    st.initialized = true;
    bindEvents();
    loadAccounts();
  }

  function bindEvents() {
    const accSelect = document.getElementById('bulkAccountSelect');
    accSelect?.addEventListener('change', (e) => onAccountChange(e.target.value));

    const searchInput = document.getElementById('bulkCampaignSearch');
    searchInput?.addEventListener('input', (e) => {
      st.search = e.target.value;
      renderTree();
    });

    const filterSelect = document.getElementById('bulkCampaignFilter');
    filterSelect?.addEventListener('change', (e) => {
      st.filter = e.target.value;
      renderTree();
    });

    document.getElementById('bulkReloadCampaignsBtn')?.addEventListener('click', () => {
      if (st.accountId) loadCampaigns();
    });

    document.getElementById('bulkExpandAllBtn')?.addEventListener('click', () => expandAll());

    document.getElementById('bulkClearTargetsBtn')?.addEventListener('click', () => {
      st.selectedAdsets.clear();
      renderTree();
      updateCounts();
    });

    // Stepper navigation
    document.querySelectorAll('#bulkStepper .studio-step-item').forEach(item => {
      item.addEventListener('click', () => {
        if (st.isExecuting) return;
        const targetStep = parseInt(item.dataset.bulkStep, 10);
        if (targetStep < st.step) {
          goToStep(targetStep);
        }
      });
    });

    const backBtn = document.getElementById('bulkBackBtn');
    backBtn?.addEventListener('click', () => {
      if (st.step > 1 && !st.isExecuting) {
        goToStep(st.step - 1);
      }
    });

    const nextBtn = document.getElementById('bulkNextBtn');
    nextBtn?.addEventListener('click', () => {
      if (st.step < 4 && !st.isExecuting) {
        goToStep(st.step + 1);
      }
    });

    const execBtn = document.getElementById('bulkExecuteBtn');
    execBtn?.addEventListener('click', () => {
      if (!st.isExecuting && typeof window.BulkAds?.execute === 'function') {
        window.BulkAds.execute();
      }
    });
  }

  // ------------------------------------------------------------------
  // BƯỚC 1 — chọn đích
  // ------------------------------------------------------------------
  async function loadAccounts() {
    const sel = document.getElementById('bulkAccountSelect');
    if (!sel) return;

    try {
      const data = await S.apiGet('/api/cp/ad-accounts');
      const accs = data.accounts || [];
      S.setAdAccounts(accs);

      sel.innerHTML = '<option value="">-- Chọn tài khoản quảng cáo --</option>' +
        accs.map(a => `<option value="${a.accountId}">${S.escapeHtml(a.name)} (act_${a.accountId})</option>`).join('');

      if (accs.length === 1) {
        sel.value = accs[0].accountId;
        sel.dispatchEvent(new Event('change'));
      }
    } catch (err) {
      sel.innerHTML = `<option value="">Lỗi tải tài khoản: ${S.escapeHtml(err.message)}</option>`;
    }
  }

  /** Đổi tài khoản = đổi toàn bộ ngữ cảnh → xoá lựa chọn cũ, cảnh báo rõ. */
  async function onAccountChange(accountId) {
    if (st.selectedAdsets.size > 0 &&
        !confirm('Đổi tài khoản sẽ xoá toàn bộ nhóm đích đang chọn. Tiếp tục?')) {
      document.getElementById('bulkAccountSelect').value = st.accountId;
      return;
    }
    st.accountId = accountId;
    st.accountName = document.getElementById('bulkAccountSelect')?.selectedOptions[0]?.textContent || accountId;
    st.campaigns = [];
    st.adsetsByCampaign.clear();
    st.selectedAdsets.clear();
    st.expandedCampaigns.clear();
    renderTree();
    updateCounts();
    if (accountId) await loadCampaigns();
  }

  /**
   * Nạp chiến dịch KÈM cờ nháp.
   * statuses=all → thêm IN_PROCESS & WITH_ISSUES; withDraftFlag=1 → đếm adset/ad.
   */
  async function loadCampaigns() {
    const box = document.getElementById('bulkTargetTree');
    if (!box) return;

    box.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span><p>Đang tải chiến dịch...</p></div>';
    try {
      const data = await S.apiGet(
        `/api/cp/ad-accounts/${st.accountId}/campaigns?statuses=all&withDraftFlag=1&limit=200`
      );
      st.campaigns = data.campaigns || [];
      renderTree();
      updateCounts(data.counts);
    } catch (err) {
      box.innerHTML = `<div class="cp-empty-state cp-text-danger">Lỗi tải chiến dịch: ${S.escapeHtml(err.message)}</div>`;
    }
  }

  function visibleCampaigns() {
    const q = st.search.trim().toLowerCase();
    return st.campaigns.filter(c => {
      if (q && !String(c.name).toLowerCase().includes(q)) return false;
      if (st.filter === 'draft')  return c.isDraft;
      if (st.filter === 'active') return c.effective_status === 'ACTIVE';
      if (st.filter === 'paused') return c.effective_status === 'PAUSED';
      return true;
    });
  }

  function renderTree() {
    const box = document.getElementById('bulkTargetTree');
    if (!box) return;

    if (!st.accountId) {
      box.innerHTML = '<div class="cp-empty-state">Hãy chọn Tài khoản quảng cáo ở trên.</div>';
      return;
    }

    const list = visibleCampaigns();
    if (list.length === 0) {
      box.innerHTML = '<div class="cp-empty-state">Không có chiến dịch nào khớp bộ lọc.</div>';
      return;
    }

    box.innerHTML = list.map(c => {
      const adsets = st.adsetsByCampaign.get(c.id) || null;
      const open = st.expandedCampaigns.has(c.id);
      const noAdset = c.adsetsCount === 0;

      const chips = [
        `<span class="bulk-chip bulk-chip--status">${S.escapeHtml(c.effective_status)}</span>`,
        c.isDraft ? `<span class="bulk-chip bulk-chip--draft" title="${S.escapeHtml(DRAFT_REASON_TEXT[c.draftReason] || 'Bản nháp')}">Nháp</span>` : '',
        c.hasCbo ? '<span class="bulk-chip bulk-chip--cbo">CBO</span>' : '',
        `<span class="bulk-chip">${c.adsetsCount ?? '?'} nhóm · ${c.adsCount ?? '?'} ads</span>`
      ].filter(Boolean).join('');

      // Chiến dịch nháp CHƯA CÓ NHÓM thì không đăng ad vào được — nói thẳng,
      // không cho tick, và chỉ sang tab 2 để tạo nhóm.
      const body = noAdset
        ? `<div class="bulk-tree-warn">Chiến dịch này chưa có nhóm quảng cáo — không thể đăng ads vào.
             Hãy sang tab <strong>Nhân bản Quảng cáo</strong> để tạo nhóm trước.</div>`
        : (adsets === null
            ? `<div class="bulk-tree-loading">Bấm để tải danh sách nhóm...</div>`
            : adsets.map(a => `
                <label class="bulk-tree-node bulk-tree-node--adset">
                  <input type="checkbox" class="bulk-adset-cb" data-adset-id="${a.id}" data-campaign-id="${c.id}"
                         ${st.selectedAdsets.has(a.id) ? 'checked' : ''}>
                  <span class="bulk-adset-name">${S.escapeHtml(a.name)}</span>
                  <span class="bulk-chip">${S.escapeHtml(a.effective_status)}</span>
                  ${a.pageId ? '' : '<span class="bulk-chip bulk-chip--warn">Thiếu Fanpage</span>'}
                </label>`).join(''));

      return `
        <div class="bulk-tree-group" data-campaign-id="${c.id}">
          <div class="bulk-tree-node bulk-tree-node--campaign" data-toggle-campaign="${c.id}">
            <i data-lucide="${open ? 'chevron-down' : 'chevron-right'}"></i>
            <input type="checkbox" class="bulk-campaign-cb" data-campaign-id="${c.id}" ${noAdset ? 'disabled' : ''}>
            <span class="bulk-campaign-name">${S.escapeHtml(c.name)}</span>
            ${chips}
          </div>
          <div class="bulk-tree-children" ${open ? '' : 'style="display:none;"'}>${body}</div>
        </div>`;
    }).join('');

    // Attach tree item event handlers
    box.querySelectorAll('.bulk-tree-node--campaign').forEach(node => {
      node.addEventListener('click', (e) => {
        if (e.target.closest('.bulk-campaign-cb')) return;
        const cid = node.dataset.toggleCampaign;
        if (cid) toggleCampaign(cid);
      });
    });

    box.querySelectorAll('.bulk-campaign-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const cid = cb.dataset.campaignId;
        if (cid) onCampaignCheckbox(cid, e.target.checked);
      });
    });

    box.querySelectorAll('.bulk-adset-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const asId = cb.dataset.adsetId;
        const cid = cb.dataset.campaignId;
        if (asId && cid) onAdsetCheckbox(asId, cid, e.target.checked);
      });
    });

    S.refreshIcons();
    syncTriState();
  }

  async function toggleCampaign(campaignId) {
    if (st.expandedCampaigns.has(campaignId)) {
      st.expandedCampaigns.delete(campaignId);
      renderTree();
      return;
    }

    st.expandedCampaigns.add(campaignId);
    if (!st.adsetsByCampaign.has(campaignId)) {
      renderTree();
      await loadAdsets([campaignId]);
    } else {
      renderTree();
    }
  }

  async function loadAdsets(campaignIds) {
    if (!campaignIds || campaignIds.length === 0 || !st.accountId) return;

    try {
      const data = await S.apiGet(
        `/api/cp/ad-accounts/${st.accountId}/adsets?campaignIds=${campaignIds.join(',')}`
      );
      const list = data.adsets || [];
      const grouped = new Map();
      list.forEach(a => {
        const arr = grouped.get(a.campaignId) || [];
        arr.push(a);
        grouped.set(a.campaignId, arr);
      });

      campaignIds.forEach(cid => {
        st.adsetsByCampaign.set(cid, grouped.get(cid) || []);
      });

      renderTree();
    } catch (err) {
      console.error('[BulkAds] Lỗi tải adsets:', err.message);
    }
  }

  async function onCampaignCheckbox(campaignId, checked) {
    if (!st.adsetsByCampaign.has(campaignId)) {
      await loadAdsets([campaignId]);
    }

    const adsets = st.adsetsByCampaign.get(campaignId) || [];
    const camp = st.campaigns.find(c => c.id === campaignId);

    if (checked) {
      for (const a of adsets) {
        if (st.selectedAdsets.size >= LIMITS.MAX_TARGETS) {
          alert(`Đã đạt giới hạn tối đa ${LIMITS.MAX_TARGETS} nhóm quảng cáo đích.`);
          break;
        }
        st.selectedAdsets.set(a.id, {
          campaignId,
          campaignName: camp?.name || campaignId,
          adsetId: a.id,
          adsetName: a.name,
          pageId: a.pageId || ''
        });
      }
    } else {
      for (const a of adsets) {
        st.selectedAdsets.delete(a.id);
      }
    }

    renderTree();
    updateCounts();
  }

  function onAdsetCheckbox(adsetId, campaignId, checked) {
    if (checked) {
      if (st.selectedAdsets.size >= LIMITS.MAX_TARGETS) {
        alert(`Đã đạt giới hạn tối đa ${LIMITS.MAX_TARGETS} nhóm quảng cáo đích.`);
        renderTree();
        return;
      }
      const adsets = st.adsetsByCampaign.get(campaignId) || [];
      const adset = adsets.find(a => a.id === adsetId);
      const camp = st.campaigns.find(c => c.id === campaignId);

      st.selectedAdsets.set(adsetId, {
        campaignId,
        campaignName: camp?.name || campaignId,
        adsetId,
        adsetName: adset?.name || adsetId,
        pageId: adset?.pageId || ''
      });
    } else {
      st.selectedAdsets.delete(adsetId);
    }

    syncTriState();
    updateCounts();
  }

  function syncTriState() {
    document.querySelectorAll('.bulk-tree-group').forEach(grp => {
      const cid = grp.dataset.campaignId;
      const cb = grp.querySelector('.bulk-campaign-cb');
      if (!cb || !cid) return;

      const adsets = st.adsetsByCampaign.get(cid);
      if (!adsets || adsets.length === 0) {
        cb.checked = false;
        cb.indeterminate = false;
        return;
      }

      let selectedCount = 0;
      adsets.forEach(a => {
        if (st.selectedAdsets.has(a.id)) selectedCount++;
      });

      if (selectedCount === 0) {
        cb.checked = false;
        cb.indeterminate = false;
      } else if (selectedCount === adsets.length) {
        cb.checked = true;
        cb.indeterminate = false;
      } else {
        cb.checked = false;
        cb.indeterminate = true;
      }
    });
  }

  function updateCounts(counts) {
    const targetsCountEl = document.getElementById('bulkSelectedTargetsCount');
    const campsCountEl = document.getElementById('bulkSelectedCampaignsCount');
    const badgeEl = document.getElementById('bulkTargetBadge');

    const totalAdsets = st.selectedAdsets.size;
    const uniqueCamps = new Set(Array.from(st.selectedAdsets.values()).map(x => x.campaignId)).size;

    if (targetsCountEl) targetsCountEl.textContent = totalAdsets;
    if (campsCountEl) campsCountEl.textContent = uniqueCamps;
    if (badgeEl) badgeEl.textContent = `${totalAdsets} nhóm đích`;
  }

  async function expandAll() {
    const list = visibleCampaigns();
    const missing = list.filter(c => !st.adsetsByCampaign.has(c.id)).map(c => c.id);

    list.forEach(c => st.expandedCampaigns.add(c.id));

    if (missing.length > 0) {
      // Chunk 50 campaign IDs / request
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        await loadAdsets(chunk);
      }
    } else {
      renderTree();
    }
  }

  function goToStep(targetStep) {
    if (targetStep < 1 || targetStep > 4) return;

    if (targetStep > st.step) {
      if (st.step === 1) {
        if (!st.accountId) {
          alert('Vui lòng chọn Tài khoản Quảng cáo.');
          return;
        }
        if (st.selectedAdsets.size === 0) {
          alert('Vui lòng chọn ít nhất 1 nhóm quảng cáo đích.');
          return;
        }
      } else if (st.step === 2) {
        if (st.contents.length === 0) {
          alert('Vui lòng soạn ít nhất 1 nội dung quảng cáo.');
          return;
        }
      }
    }

    st.step = targetStep;

    for (let s = 1; s <= 4; s++) {
      const stepEl = document.getElementById(`bulkStep${s}`);
      const indEl = document.getElementById(`bulkStepInd${s}`);
      if (stepEl) stepEl.style.display = s === targetStep ? 'block' : 'none';
      if (indEl) {
        indEl.classList.toggle('active', s === targetStep);
        indEl.classList.toggle('done', s < targetStep);
      }
    }

    if (targetStep === 2 && !st.contentEditor) {
      st.contentEditor = S.ContentEditor.mount({
        containerId: 'bulkContentContainer',
        max: LIMITS.MAX_CONTENTS,
        accountId: () => st.accountId,
        pages: () => S.getPages(),
        onChange: (contents) => {
          st.contents = contents;
          const badge = document.getElementById('bulkContentBadge');
          if (badge) badge.textContent = `${contents.length} nội dung`;
        }
      });
    }

    const backBtn = document.getElementById('bulkBackBtn');
    const nextBtn = document.getElementById('bulkNextBtn');
    const execBtn = document.getElementById('bulkExecuteBtn');

    if (backBtn) backBtn.style.display = targetStep > 1 ? 'inline-flex' : 'none';
    if (nextBtn) nextBtn.style.display = targetStep < 4 ? 'inline-flex' : 'none';
    if (execBtn) execBtn.style.display = targetStep === 4 ? 'inline-flex' : 'none';

    S.refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return {
    init,
    getState: () => st,
    goToStep
  };
})();
