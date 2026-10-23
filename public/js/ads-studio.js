/**
 * Tab 2: Ads Creation Studio (4-Step Batch Wizard)
 * Nâng cấp ngày 23/10/2026: hỗ trợ tạo nhiều Chiến dịch (tối đa 15) và nhiều Nhóm (tối đa 3 mẫu, max 45 nhóm),
 * tích hợp bộ soạn nội dung dùng chung CPShared.ContentEditor và chuyển sang POST /api/cp/build-structure.
 *
 * MỌI ĐỐI TƯỢNG TẠO MỚI LUÔN Ở TRẠNG THÁI PAUSED.
 */
window.AdsStudio = (function () {
  'use strict';

  const S = window.CPShared;

  const LIMITS = {
    MAX_CAMPAIGNS: 15,
    MAX_ADSET_CARDS: 3,
    MAX_TARGETS: 45,
    MAX_CONTENTS: 12,
    MAX_ADS: 135
  };

  // DOM Navigation Buttons
  const btnStudioBack = document.getElementById('btnStudioBack');
  const btnStudioNext = document.getElementById('btnStudioNext');
  const btnStudioExecute = document.getElementById('btnStudioExecute');

  const studioState = {
    step: 1,
    campMode: 'existing', // 'existing' | 'new' | 'multi'
    adsetMode: 'existing', // 'existing' | 'new' | 'multi'
    adsetAttachMode: 'all', // 'all' | 'each'

    // Step 1: Account & Existing Campaigns
    accountId: '',
    accountName: '',
    existingCampaigns: [], // mảng { id, name, effective_status, hasCbo }
    existingCampaignId: '',
    existingCampaignName: '',

    // Step 1: Single Campaign New
    campPrefix: 'haicm',
    campProduct: 'ucmas',
    campDesc: 'mess/khaigiang',
    campCboBudget: '',

    // Step 1: Multi Campaign Cards
    campaignCards: [], // { id, key, prefix, product, desc, cboBudget, name }

    // Step 2: Existing Adsets
    selectedExistingAdsetIds: new Set(),
    existingAdsetsList: [],

    // Step 2: Single Adset New
    newAdsetName: 'Nhóm QC - Nữ 25-45 HN',
    newAdsetPageId: '',
    newAdsetBudget: 100000,
    targetAgeMin: 25,
    targetAgeMax: 45,
    targetGender: 'female',
    targetLocation: 'HN',
    placementMode: 'auto',

    // Step 2: Multi Adset Cards
    adsetCards: [], // { id, key, name, pageId, dailyBudget, targetAgeMin, targetAgeMax, targetGender, targetLocation, placementMode, attachToCampKey }

    // Step 3: Contents (Managed by CPShared.ContentEditor)
    contentEditor: null,
    contents: [],

    // Preview
    matrixAds: [],

    // Step 4: Job execution
    planId: '',
    jobId: '',
    polling: null,
    isExecuting: false,
    lastJobResult: null,

    initialized: false
  };

  function genKey(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 8);
  }

  function formatCleanDesc(desc) {
    return (desc || 'khaigiang').replace(/^mess\//, '').trim() || 'khaigiang';
  }

  function makeCampaignName(prefix, product, desc) {
    const p = (prefix || 'haicm').trim() || 'haicm';
    const prod = (product || 'ucmas').trim().toLowerCase();
    const d = formatCleanDesc(desc);
    return `${p}/${prod}/mess/${d}`;
  }

  // ------------------------------------------------------------------
  // KHỞI TẠO VÀ SỰ KIỆN GIAO DIỆN
  // ------------------------------------------------------------------
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
    studioAccountSelect?.addEventListener('change', async (e) => {
      const accId = e.target.value;
      if (studioState.selectedExistingAdsetIds.size > 0 &&
          !confirm('Đổi tài khoản sẽ xoá toàn bộ nhóm quảng cáo đã chọn. Tiếp tục?')) {
        studioAccountSelect.value = studioState.accountId;
        return;
      }
      studioState.accountId = accId;
      const adAccounts = S.getAdAccounts();
      const acc = adAccounts.find(a => a.accountId === accId);
      studioState.accountName = acc ? acc.name : accId;

      studioState.selectedExistingAdsetIds.clear();
      studioState.existingCampaignId = '';
      studioState.existingCampaignName = '';

      if (accId) {
        await loadStudioCampaigns(accId);
      } else {
        const campSelect = document.getElementById('studioCampaignSelect');
        if (campSelect) {
          campSelect.innerHTML = '<option value="">-- Chọn tài khoản ở trên trước --</option>';
          campSelect.disabled = true;
        }
      }
      syncBudgetLock();
    });

    // Step 1: Campaign select
    const studioCampaignSelect = document.getElementById('studioCampaignSelect');
    studioCampaignSelect?.addEventListener('change', (e) => {
      studioState.existingCampaignId = e.target.value;
      const opt = e.target.selectedOptions[0];
      studioState.existingCampaignName = opt ? opt.textContent : e.target.value;
      syncBudgetLock();
    });

    // Step 1: Campaign Mode switcher (3 buttons: existing, new, multi)
    const btnModeExistingCamp = document.getElementById('btnModeExistingCamp');
    const btnModeNewCamp = document.getElementById('btnModeNewCamp');
    const btnModeMultiCamp = document.getElementById('btnModeMultiCamp');

    const boxExistingCamp = document.getElementById('boxExistingCamp');
    const boxNewCamp = document.getElementById('boxNewCamp');
    const boxMultiCamp = document.getElementById('boxMultiCamp');

    btnModeExistingCamp?.addEventListener('click', () => {
      setCampMode('existing');
    });

    btnModeNewCamp?.addEventListener('click', () => {
      setCampMode('new');
    });

    btnModeMultiCamp?.addEventListener('click', () => {
      setCampMode('multi');
    });

    // Step 1B: Single Campaign Naming Helper inputs
    const campPrefixInput = document.getElementById('campPrefixInput');
    const campDescInput = document.getElementById('campDescInput');
    const campCboBudget = document.getElementById('campCboBudget');

    campPrefixInput?.addEventListener('input', (e) => {
      studioState.campPrefix = e.target.value.trim() || 'haicm';
      updateSingleCampNamePreview();
    });

    campDescInput?.addEventListener('input', (e) => {
      studioState.campDesc = e.target.value.trim();
      updateSingleCampNamePreview();
    });

    campCboBudget?.addEventListener('input', (e) => {
      studioState.campCboBudget = e.target.value;
      syncBudgetLock();
    });

    document.querySelectorAll('#campProductTags .product-tag-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#campProductTags .product-tag-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        studioState.campProduct = btn.dataset.product || 'ucmas';
        updateSingleCampNamePreview();
      });
    });

    // Step 1C: Multi Campaign actions
    const btnAddCampaignCard = document.getElementById('btnAddCampaignCard');
    const btnQuickGenCampaigns = document.getElementById('btnQuickGenCampaigns');

    btnAddCampaignCard?.addEventListener('click', () => {
      addCampaignCard();
    });

    btnQuickGenCampaigns?.addEventListener('click', () => {
      quickGenCampaigns();
    });

    // 4. Step 2: Ad Set Mode Switcher (3 buttons: existing, new, multi)
    const btnModeExistingAdset = document.getElementById('btnModeExistingAdset');
    const btnModeNewAdset = document.getElementById('btnModeNewAdset');
    const btnModeMultiAdset = document.getElementById('btnModeMultiAdset');

    btnModeExistingAdset?.addEventListener('click', () => {
      if (studioState.campMode === 'new' || studioState.campMode === 'multi') {
        alert('Chiến dịch tạo mới chưa có nhóm quảng cáo trên Meta. Vui lòng chọn "Tạo Nhóm mới" hoặc "Tạo nhiều Nhóm".');
        return;
      }
      setAdsetMode('existing');
    });

    btnModeNewAdset?.addEventListener('click', () => {
      setAdsetMode('new');
    });

    btnModeMultiAdset?.addEventListener('click', () => {
      setAdsetMode('multi');
    });

    // Step 2B: Single New Adset inputs
    document.getElementById('newAdsetNameInput')?.addEventListener('input', e => {
      studioState.newAdsetName = e.target.value;
    });
    document.getElementById('newAdsetPageSelect')?.addEventListener('change', e => {
      studioState.newAdsetPageId = e.target.value;
    });
    document.getElementById('newAdsetBudget')?.addEventListener('input', e => {
      studioState.newAdsetBudget = Number(e.target.value) || 100000;
    });
    document.getElementById('targetAgeMin')?.addEventListener('input', e => {
      studioState.targetAgeMin = Number(e.target.value) || 25;
    });
    document.getElementById('targetAgeMax')?.addEventListener('input', e => {
      studioState.targetAgeMax = Number(e.target.value) || 45;
    });
    document.getElementById('targetGender')?.addEventListener('change', e => {
      studioState.targetGender = e.target.value;
    });
    document.getElementById('targetLocationPreset')?.addEventListener('change', e => {
      studioState.targetLocation = e.target.value;
    });
    document.querySelectorAll('input[name="placementMode"]').forEach(radio => {
      radio.addEventListener('change', e => {
        studioState.placementMode = e.target.value;
      });
    });

    // Step 2C: Multi Adset inputs & actions
    const btnAddAdsetCard = document.getElementById('btnAddAdsetCard');
    const studioAdsetAttachMode = document.getElementById('studioAdsetAttachMode');

    btnAddAdsetCard?.addEventListener('click', () => {
      addAdsetCard();
    });

    studioAdsetAttachMode?.addEventListener('change', (e) => {
      studioState.adsetAttachMode = e.target.value;
      renderAdsetCards();
      renderStructurePreview();
    });

    // Retry failed button
    const retryBtn = document.getElementById('studioRetryFailedBtn');
    retryBtn?.addEventListener('click', () => {
      retryFailedItems();
    });
  }

  // ------------------------------------------------------------------
  // STEP 1 LOGIC
  // ------------------------------------------------------------------
  function setCampMode(mode) {
    studioState.campMode = mode;

    const btnExisting = document.getElementById('btnModeExistingCamp');
    const btnNew = document.getElementById('btnModeNewCamp');
    const btnMulti = document.getElementById('btnModeMultiCamp');

    const boxExisting = document.getElementById('boxExistingCamp');
    const boxNew = document.getElementById('boxNewCamp');
    const boxMulti = document.getElementById('boxMultiCamp');

    btnExisting?.classList.toggle('active', mode === 'existing');
    btnNew?.classList.toggle('active', mode === 'new');
    btnMulti?.classList.toggle('active', mode === 'multi');

    if (boxExisting) boxExisting.style.display = mode === 'existing' ? 'block' : 'none';
    if (boxNew) boxNew.style.display = mode === 'new' ? 'block' : 'none';
    if (boxMulti) boxMulti.style.display = mode === 'multi' ? 'block' : 'none';

    if (mode === 'new') {
      updateSingleCampNamePreview();
    } else if (mode === 'multi') {
      if (studioState.campaignCards.length === 0) {
        addCampaignCard();
      } else {
        renderCampaignCards();
      }
    }

    // Nếu campMode đổi sang new/multi thì adset không thể dùng existing
    if (mode !== 'existing' && studioState.adsetMode === 'existing') {
      setAdsetMode('new');
    }

    syncBudgetLock();
    S.refreshIcons();
  }

  function updateSingleCampNamePreview() {
    const previewEl = document.getElementById('campFullNamePreview');
    if (!previewEl) return;
    previewEl.value = makeCampaignName(studioState.campPrefix, studioState.campProduct, studioState.campDesc);
  }

  function addCampaignCard(customData) {
    if (studioState.campaignCards.length >= LIMITS.MAX_CAMPAIGNS) {
      alert(`Đã đạt tối đa ${LIMITS.MAX_CAMPAIGNS} chiến dịch.`);
      return;
    }

    const idx = studioState.campaignCards.length + 1;
    const item = customData || {
      id: genKey('sc'),
      key: `camp_${Date.now()}_${idx}`,
      prefix: studioState.campPrefix || 'haicm',
      product: 'ucmas',
      desc: studioState.campDesc || 'mess/khaigiang',
      cboBudget: '',
      name: ''
    };
    item.name = makeCampaignName(item.prefix, item.product, item.desc);

    studioState.campaignCards.push(item);
    renderCampaignCards();
    syncBudgetLock();
    renderStructurePreview();
  }

  function quickGenCampaigns() {
    const products = ['ucmas', 'uckid', 'mathca', 'traihe'];
    const p = studioState.campPrefix || 'haicm';
    const d = studioState.campDesc || 'mess/khaigiang';

    studioState.campaignCards = products.map((prod, i) => {
      const item = {
        id: genKey('sc'),
        key: `camp_quick_${prod}_${i + 1}`,
        prefix: p,
        product: prod,
        desc: d,
        cboBudget: studioState.campCboBudget || '',
        name: makeCampaignName(p, prod, d)
      };
      return item;
    });

    renderCampaignCards();
    syncBudgetLock();
    renderStructurePreview();
  }

  function renderCampaignCards() {
    const container = document.getElementById('studioCampaignCards');
    const addBtn = document.getElementById('btnAddCampaignCard');
    if (!container) return;

    if (addBtn) addBtn.disabled = studioState.campaignCards.length >= LIMITS.MAX_CAMPAIGNS;

    if (studioState.campaignCards.length === 0) {
      container.innerHTML = '<div class="cp-empty-state">Chưa có chiến dịch nào. Bấm "Thêm chiến dịch" hoặc "Sinh nhanh 4 sản phẩm".</div>';
      return;
    }

    const products = [
      { id: 'ucmas', label: 'UCMAS' },
      { id: 'uckid', label: 'UCKID' },
      { id: 'mathca', label: 'MATHCA' },
      { id: 'traihe', label: 'TRẠI HÈ' }
    ];

    container.innerHTML = studioState.campaignCards.map((card, idx) => {
      const pills = products.map(pr => `
        <button type="button" class="product-tag-pill ${card.product === pr.id ? 'active' : ''}"
                data-card-id="${card.id}" data-product="${pr.id}">
          ${pr.label}
        </button>
      `).join('');

      return `
        <div class="cp-card" style="margin-bottom:0;background:var(--bg-card-solid);border:1px solid var(--border-subtle);padding:var(--space-3);" data-card-id="${card.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
            <div style="font-weight:700;font-size:0.85rem;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
              <span class="badge" style="background:var(--primary);color:#fff;">#${idx + 1}</span>
              <span>Chiến dịch ${idx + 1}</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button type="button" class="btn btn-secondary btn-sm sc-dup-btn" data-card-id="${card.id}" title="Nhân bản thẻ">
                <i data-lucide="copy" style="width:14px;height:14px;"></i>
              </button>
              <button type="button" class="btn btn-secondary btn-sm sc-del-btn" data-card-id="${card.id}" title="Xoá thẻ"
                      ${studioState.campaignCards.length <= 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              </button>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 2fr;gap:var(--space-2);margin-bottom:var(--space-2);">
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">NV phụ trách</label>
              <input type="text" class="cp-input sc-prefix-input" data-card-id="${card.id}" value="${S.escapeHtml(card.prefix)}" placeholder="haicm">
            </div>
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Sản phẩm</label>
              <div class="product-tag-group" style="margin-top:2px;">
                ${pills}
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-2);margin-bottom:var(--space-2);">
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Thông điệp gợi nhớ (VD: mess/khaigiang)</label>
              <input type="text" class="cp-input sc-desc-input" data-card-id="${card.id}" value="${S.escapeHtml(card.desc)}" placeholder="mess/khaigiang">
            </div>
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Ngân sách CBO (VNĐ)</label>
              <input type="number" class="cp-input sc-cbo-input" data-card-id="${card.id}" value="${card.cboBudget || ''}" placeholder="Để trống nếu ABO" min="50000" step="10000">
            </div>
          </div>

          <div class="cp-form-group" style="margin-bottom:0;">
            <label class="cp-form-label" style="font-size:0.75rem;">Tên hoàn chỉnh trên Meta</label>
            <input type="text" class="cp-input sc-name-preview" data-card-id="${card.id}" value="${S.escapeHtml(card.name)}" readonly style="font-weight:600;color:var(--cyan-text);background:var(--bg-input);">
          </div>
        </div>
      `;
    }).join('');

    // Attach card event listeners
    container.querySelectorAll('.sc-prefix-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = e.target.dataset.cardId;
        const c = studioState.campaignCards.find(x => x.id === id);
        if (c) {
          c.prefix = e.target.value.trim() || 'haicm';
          c.name = makeCampaignName(c.prefix, c.product, c.desc);
          const pr = container.querySelector(`.sc-name-preview[data-card-id="${id}"]`);
          if (pr) pr.value = c.name;
          renderStructurePreview();
        }
      });
    });

    container.querySelectorAll('.product-tag-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cardId;
        const prod = btn.dataset.product;
        const c = studioState.campaignCards.find(x => x.id === id);
        if (c) {
          c.product = prod;
          c.name = makeCampaignName(c.prefix, c.product, c.desc);
          container.querySelectorAll(`.product-tag-pill[data-card-id="${id}"]`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const pr = container.querySelector(`.sc-name-preview[data-card-id="${id}"]`);
          if (pr) pr.value = c.name;
          renderStructurePreview();
        }
      });
    });

    container.querySelectorAll('.sc-desc-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = e.target.dataset.cardId;
        const c = studioState.campaignCards.find(x => x.id === id);
        if (c) {
          c.desc = e.target.value.trim();
          c.name = makeCampaignName(c.prefix, c.product, c.desc);
          const pr = container.querySelector(`.sc-name-preview[data-card-id="${id}"]`);
          if (pr) pr.value = c.name;
          renderStructurePreview();
        }
      });
    });

    container.querySelectorAll('.sc-cbo-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = e.target.dataset.cardId;
        const c = studioState.campaignCards.find(x => x.id === id);
        if (c) {
          c.cboBudget = e.target.value;
          syncBudgetLock();
          renderStructurePreview();
        }
      });
    });

    container.querySelectorAll('.sc-dup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cardId;
        const c = studioState.campaignCards.find(x => x.id === id);
        if (c) {
          addCampaignCard({
            id: genKey('sc'),
            key: genKey('camp'),
            prefix: c.prefix,
            product: c.product,
            desc: c.desc + ' copy',
            cboBudget: c.cboBudget,
            name: ''
          });
        }
      });
    });

    container.querySelectorAll('.sc-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (studioState.campaignCards.length <= 1) return;
        const id = btn.dataset.cardId;
        studioState.campaignCards = studioState.campaignCards.filter(x => x.id !== id);
        renderCampaignCards();
        syncBudgetLock();
        renderStructurePreview();
      });
    });

    S.refreshIcons();
  }

  // ------------------------------------------------------------------
  // STEP 2 LOGIC
  // ------------------------------------------------------------------
  function setAdsetMode(mode) {
    studioState.adsetMode = mode;

    const btnExisting = document.getElementById('btnModeExistingAdset');
    const btnNew = document.getElementById('btnModeNewAdset');
    const btnMulti = document.getElementById('btnModeMultiAdset');

    const boxExisting = document.getElementById('boxExistingAdset');
    const boxNew = document.getElementById('boxNewAdset');
    const boxMulti = document.getElementById('boxMultiAdset');

    btnExisting?.classList.toggle('active', mode === 'existing');
    btnNew?.classList.toggle('active', mode === 'new');
    btnMulti?.classList.toggle('active', mode === 'multi');

    if (boxExisting) boxExisting.style.display = mode === 'existing' ? 'block' : 'none';
    if (boxNew) boxNew.style.display = mode === 'new' ? 'block' : 'none';
    if (boxMulti) boxMulti.style.display = mode === 'multi' ? 'block' : 'none';

    if (mode === 'multi') {
      if (studioState.adsetCards.length === 0) {
        addAdsetCard();
      } else {
        renderAdsetCards();
      }
    }

    syncBudgetLock();
    renderStructurePreview();
    S.refreshIcons();
  }

  function addAdsetCard(customData) {
    if (studioState.adsetCards.length >= LIMITS.MAX_ADSET_CARDS) {
      alert(`Đã đạt tối đa ${LIMITS.MAX_ADSET_CARDS} mẫu nhóm quảng cáo.`);
      return;
    }

    const idx = studioState.adsetCards.length + 1;
    const pages = S.getPages();
    const defaultPageId = pages[0]?.id || '';

    const item = customData || {
      id: genKey('sa'),
      key: `as_${Date.now()}_${idx}`,
      name: `Nhóm QC 0${idx} - Nữ 25-45 HN`,
      pageId: defaultPageId,
      dailyBudget: 100000,
      targetAgeMin: 25,
      targetAgeMax: 45,
      targetGender: 'female',
      targetLocation: 'HN',
      placementMode: 'auto',
      attachToCampKey: studioState.campaignCards[0]?.key || ''
    };

    studioState.adsetCards.push(item);
    renderAdsetCards();
    syncBudgetLock();
    renderStructurePreview();
  }

  function renderAdsetCards() {
    const container = document.getElementById('studioAdsetCards');
    const addBtn = document.getElementById('btnAddAdsetCard');
    if (!container) return;

    if (addBtn) addBtn.disabled = studioState.adsetCards.length >= LIMITS.MAX_ADSET_CARDS;

    if (studioState.adsetCards.length === 0) {
      container.innerHTML = '<div class="cp-empty-state">Chưa có mẫu nhóm nào. Bấm "Thêm mẫu nhóm".</div>';
      return;
    }

    const pages = S.getPages();
    const isEach = studioState.adsetAttachMode === 'each';

    // Tạo options chiến dịch khi attachMode === 'each'
    let campOptions = '';
    if (studioState.campMode === 'multi') {
      campOptions = studioState.campaignCards.map(c => `
        <option value="${c.key}">${S.escapeHtml(c.name)}</option>
      `).join('');
    } else if (studioState.campMode === 'new') {
      const singleName = document.getElementById('campFullNamePreview')?.value || 'Chiến dịch mới';
      campOptions = `<option value="single_new">${S.escapeHtml(singleName)}</option>`;
    } else {
      campOptions = `<option value="existing:${studioState.existingCampaignId}">${S.escapeHtml(studioState.existingCampaignName || 'CĐ có sẵn')}</option>`;
    }

    container.innerHTML = studioState.adsetCards.map((card, idx) => {
      const pageOptions = pages.map(p => `
        <option value="${p.id}" ${card.pageId === p.id ? 'selected' : ''}>${S.escapeHtml(p.name)}</option>
      `).join('');

      return `
        <div class="cp-card" style="margin-bottom:0;background:var(--bg-card-solid);border:1px solid var(--border-subtle);padding:var(--space-3);" data-card-id="${card.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);flex-wrap:wrap;gap:var(--space-2);">
            <div style="font-weight:700;font-size:0.85rem;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
              <span class="badge" style="background:var(--cyan);color:#fff;">Mẫu #${idx + 1}</span>
              <span>Mẫu nhóm quảng cáo ${idx + 1}</span>
            </div>
            <div style="display:flex;gap:4px;align-items:center;">
              ${isEach ? `
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-size:0.75rem;color:var(--text-muted);">Gán vào:</span>
                  <select class="select-filter sa-attach-select" data-card-id="${card.id}" style="font-size:0.75rem;padding:3px 6px;">
                    ${campOptions}
                  </select>
                </div>
              ` : ''}
              <button type="button" class="btn btn-secondary btn-sm sa-dup-btn" data-card-id="${card.id}" title="Nhân bản mẫu">
                <i data-lucide="copy" style="width:14px;height:14px;"></i>
              </button>
              <button type="button" class="btn btn-secondary btn-sm sa-del-btn" data-card-id="${card.id}" title="Xoá mẫu"
                      ${studioState.adsetCards.length <= 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              </button>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-2);">
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Tên Nhóm quảng cáo</label>
              <input type="text" class="cp-input sa-name-input" data-card-id="${card.id}" value="${S.escapeHtml(card.name)}" placeholder="Nhập tên nhóm...">
            </div>
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Fanpage đích nhận tin nhắn</label>
              <select class="select-filter sa-page-select" data-card-id="${card.id}" style="width:100%;font-size:0.8rem;">
                ${pageOptions}
              </select>
            </div>
          </div>

          <div class="cp-form-group" style="margin-bottom:var(--space-2);">
            <label class="cp-form-label" style="font-size:0.75rem;">Ngân sách ngày (ABO - VNĐ)</label>
            <input type="number" class="cp-input sa-budget-input" data-card-id="${card.id}" id="saBudget-${card.id}" value="${card.dailyBudget || 100000}" min="20000" step="10000">
          </div>

          <!-- Targeting gọn -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-2);">
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Độ tuổi</label>
              <div style="display:flex;align-items:center;gap:4px;">
                <input type="number" class="cp-input sa-age-min" data-card-id="${card.id}" value="${card.targetAgeMin}" min="18" max="65" style="width:55px;padding:4px;">
                <span style="font-size:0.75rem;color:var(--text-muted);">-</span>
                <input type="number" class="cp-input sa-age-max" data-card-id="${card.id}" value="${card.targetAgeMax}" min="18" max="65" style="width:55px;padding:4px;">
              </div>
            </div>
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Giới tính</label>
              <select class="select-filter sa-gender-select" data-card-id="${card.id}" style="font-size:0.8rem;padding:4px;">
                <option value="all" ${card.targetGender === 'all' ? 'selected' : ''}>Tất cả</option>
                <option value="female" ${card.targetGender === 'female' ? 'selected' : ''}>Nữ</option>
                <option value="male" ${card.targetGender === 'male' ? 'selected' : ''}>Nam</option>
              </select>
            </div>
            <div class="cp-form-group" style="margin-bottom:0;">
              <label class="cp-form-label" style="font-size:0.75rem;">Khu vực</label>
              <select class="select-filter sa-geo-select" data-card-id="${card.id}" style="font-size:0.8rem;padding:4px;">
                <option value="HN" ${card.targetLocation === 'HN' ? 'selected' : ''}>Hà Nội</option>
                <option value="HCM" ${card.targetLocation === 'HCM' ? 'selected' : ''}>TP.HCM</option>
                <option value="HN_HCM" ${card.targetLocation === 'HN_HCM' ? 'selected' : ''}>HN & HCM</option>
                <option value="VN" ${card.targetLocation === 'VN' ? 'selected' : ''}>Toàn quốc</option>
              </select>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners
    container.querySelectorAll('.sa-name-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) { c.name = e.target.value; renderStructurePreview(); }
      });
    });

    container.querySelectorAll('.sa-page-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.pageId = e.target.value;
      });
    });

    container.querySelectorAll('.sa-budget-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.dailyBudget = Number(e.target.value) || 100000;
      });
    });

    container.querySelectorAll('.sa-age-min').forEach(inp => {
      inp.addEventListener('input', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.targetAgeMin = Number(e.target.value) || 25;
      });
    });

    container.querySelectorAll('.sa-age-max').forEach(inp => {
      inp.addEventListener('input', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.targetAgeMax = Number(e.target.value) || 45;
      });
    });

    container.querySelectorAll('.sa-gender-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.targetGender = e.target.value;
      });
    });

    container.querySelectorAll('.sa-geo-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) c.targetLocation = e.target.value;
      });
    });

    container.querySelectorAll('.sa-attach-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const c = studioState.adsetCards.find(x => x.id === e.target.dataset.cardId);
        if (c) { c.attachToCampKey = e.target.value; renderStructurePreview(); }
      });
    });

    container.querySelectorAll('.sa-dup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = studioState.adsetCards.find(x => x.id === btn.dataset.cardId);
        if (c) {
          addAdsetCard({
            id: genKey('sa'),
            key: genKey('as'),
            name: c.name + ' copy',
            pageId: c.pageId,
            dailyBudget: c.dailyBudget,
            targetAgeMin: c.targetAgeMin,
            targetAgeMax: c.targetAgeMax,
            targetGender: c.targetGender,
            targetLocation: c.targetLocation,
            placementMode: c.placementMode,
            attachToCampKey: c.attachToCampKey
          });
        }
      });
    });

    container.querySelectorAll('.sa-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (studioState.adsetCards.length <= 1) return;
        studioState.adsetCards = studioState.adsetCards.filter(x => x.id !== btn.dataset.cardId);
        renderAdsetCards();
        syncBudgetLock();
        renderStructurePreview();
      });
    });

    S.refreshIcons();
  }

  // ------------------------------------------------------------------
  // RÀNG BUỘC CBO & PREVIEW SƠ ĐỒ CÂY
  // ------------------------------------------------------------------
  function syncBudgetLock() {
    let anyCbo = false;

    if (studioState.campMode === 'new') {
      anyCbo = Number(studioState.campCboBudget) > 0;
    } else if (studioState.campMode === 'multi') {
      anyCbo = studioState.campaignCards.some(c => Number(c.cboBudget) > 0);
    } else if (studioState.campMode === 'existing') {
      const curCamp = studioState.existingCampaigns.find(c => c.id === studioState.existingCampaignId);
      anyCbo = Boolean(curCamp?.hasCbo);
    }

    // Step 2B: Single adset budget input
    const singleBudget = document.getElementById('newAdsetBudget');
    if (singleBudget) {
      singleBudget.disabled = anyCbo;
      singleBudget.title = anyCbo ? 'Chiến dịch đang dùng CBO — nhóm không đặt ngân sách riêng.' : '';
    }

    // Step 2C: Multi adset cards budget inputs
    studioState.adsetCards.forEach(card => {
      const el = document.getElementById(`saBudget-${card.id}`);
      if (el) {
        el.disabled = anyCbo;
        el.title = anyCbo ? 'Chiến dịch đang dùng CBO — nhóm không đặt ngân sách riêng.' : '';
      }
    });

    const note = document.getElementById('studioBudgetLockNote');
    if (note) note.style.display = anyCbo ? 'flex' : 'none';
  }

  function renderStructurePreview() {
    const previewEl = document.getElementById('studioStructurePreview');
    if (!previewEl) return;

    let lines = [];
    let totalCamps = 0;
    let totalAdsets = 0;

    if (studioState.campMode === 'multi') {
      totalCamps = studioState.campaignCards.length;
      studioState.campaignCards.forEach((camp, cIdx) => {
        const cboStr = Number(camp.cboBudget) > 0 ? ` (CBO ${S.formatNum(camp.cboBudget)}đ)` : ' (ABO)';
        lines.push(`${camp.name || 'Chiến dịch ' + (cIdx + 1)}${cboStr}`);

        let attachedAdsets = [];
        if (studioState.adsetMode === 'multi') {
          if (studioState.adsetAttachMode === 'all') {
            attachedAdsets = studioState.adsetCards;
          } else {
            attachedAdsets = studioState.adsetCards.filter(a => a.attachToCampKey === camp.key);
          }
        } else if (studioState.adsetMode === 'new') {
          attachedAdsets = [{ name: studioState.newAdsetName || 'Nhóm QC mới' }];
        }

        totalAdsets += attachedAdsets.length;
        attachedAdsets.forEach((as, aIdx) => {
          const isLast = aIdx === attachedAdsets.length - 1;
          const prefix = isLast ? '  └─ ' : '  ├─ ';
          lines.push(`${prefix}${as.name}`);
        });

        if (attachedAdsets.length === 0) {
          lines.push(`  └─ (Chưa có nhóm nào gán vào)`);
        }
      });
    } else if (studioState.campMode === 'new') {
      totalCamps = 1;
      const cName = document.getElementById('campFullNamePreview')?.value || 'Chiến dịch mới';
      const cboStr = Number(studioState.campCboBudget) > 0 ? ` (CBO ${S.formatNum(studioState.campCboBudget)}đ)` : ' (ABO)';
      lines.push(`${cName}${cboStr}`);

      let attachedAdsets = [];
      if (studioState.adsetMode === 'multi') {
        attachedAdsets = studioState.adsetCards;
      } else {
        attachedAdsets = [{ name: studioState.newAdsetName || 'Nhóm QC mới' }];
      }
      totalAdsets = attachedAdsets.length;
      attachedAdsets.forEach((as, aIdx) => {
        const isLast = aIdx === attachedAdsets.length - 1;
        lines.push(`${isLast ? '  └─ ' : '  ├─ '}${as.name}`);
      });
    } else {
      totalCamps = 1;
      lines.push(`${studioState.existingCampaignName || 'Chiến dịch có sẵn'}`);
      if (studioState.adsetMode === 'existing') {
        totalAdsets = studioState.selectedExistingAdsetIds.size;
        lines.push(`  └─ ${totalAdsets} nhóm đã chọn trong chiến dịch`);
      } else if (studioState.adsetMode === 'new') {
        totalAdsets = 1;
        lines.push(`  └─ [Tạo mới] ${studioState.newAdsetName}`);
      } else {
        totalAdsets = studioState.adsetCards.length;
        studioState.adsetCards.forEach((as, aIdx) => {
          const isLast = aIdx === studioState.adsetCards.length - 1;
          lines.push(`${isLast ? '  └─ ' : '  ├─ '}[Tạo mới] ${as.name}`);
        });
      }
    }

    const contentCount = Math.max(1, studioState.contents.length);
    const estAds = totalAdsets * contentCount;
    const etaSec = Math.round((totalCamps * 2500 + totalAdsets * 2500 + contentCount * 1200 + estAds * 2000) / 1000);
    const etaMin = (etaSec / 60).toFixed(1);

    lines.push('────────────────────────────────────────');
    lines.push(`→ Dự kiến: ${totalCamps} chiến dịch · ${totalAdsets} nhóm · ${estAds} quảng cáo`);
    lines.push(`→ Ước tính thời gian thực thi: ≈ ${etaMin} phút (${etaSec}s)`);

    if (totalAdsets > LIMITS.MAX_TARGETS) {
      lines.push(`⚠️ CẢNH BÁO: Đạt ${totalAdsets} nhóm — vượt trần tối đa ${LIMITS.MAX_TARGETS} nhóm!`);
    }

    previewEl.textContent = lines.join('\n');
  }

  // ------------------------------------------------------------------
  // LOAD DATA TỪ META GRAPH API
  // ------------------------------------------------------------------
  async function initStudio() {
    initStudioEvents();
    goToStudioStep(1);
    await loadStudioAccounts();
    updateSingleCampNamePreview();
  }

  async function loadStudioAccounts() {
    const sel = document.getElementById('studioAccountSelect');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Đang tải tài khoản quảng cáo... --</option>';
    sel.disabled = true;

    try {
      const data = await S.apiGet('/api/cp/ad-accounts');
      const accounts = data.accounts || [];
      S.setAdAccounts(accounts);

      if (accounts.length === 0) {
        sel.innerHTML = '<option value="">(Không có tài khoản quảng cáo nào)</option>';
        return;
      }

      let html = '<option value="">-- Chọn tài khoản quảng cáo đích --</option>';
      accounts.forEach(acc => {
        html += `<option value="${acc.accountId}">${S.escapeHtml(acc.name)} (act_${acc.accountId})</option>`;
      });
      sel.innerHTML = html;
      sel.disabled = false;

      // Auto select first account if none selected
      if (!studioState.accountId && accounts.length > 0) {
        sel.value = accounts[0].accountId;
        studioState.accountId = accounts[0].accountId;
        studioState.accountName = accounts[0].name;
        await loadStudioCampaigns(studioState.accountId);
      }
    } catch (err) {
      sel.innerHTML = `<option value="">Lỗi: ${S.escapeHtml(err.message)}</option>`;
    }
  }

  async function loadStudioCampaigns(accountId) {
    const campSelect = document.getElementById('studioCampaignSelect');
    if (!campSelect) return;

    campSelect.innerHTML = '<option value="">-- Đang tải chiến dịch... --</option>';
    campSelect.disabled = true;

    try {
      const data = await S.apiGet(`/api/cp/ad-accounts/${accountId}/campaigns?statuses=all`);
      const camps = data.campaigns || [];
      studioState.existingCampaigns = camps;

      if (camps.length === 0) {
        campSelect.innerHTML = '<option value="">(Tài khoản chưa có chiến dịch nào)</option>';
        return;
      }

      let html = '<option value="">-- Chọn chiến dịch có sẵn --</option>';
      camps.forEach(c => {
        const cboTag = c.hasCbo ? ' [CBO]' : '';
        html += `<option value="${c.id}">${S.escapeHtml(c.name)} (${c.effective_status})${cboTag}</option>`;
      });
      campSelect.innerHTML = html;
      campSelect.disabled = false;

      if (camps.length > 0) {
        campSelect.value = camps[0].id;
        studioState.existingCampaignId = camps[0].id;
        studioState.existingCampaignName = camps[0].name;
      }
    } catch (err) {
      campSelect.innerHTML = `<option value="">Lỗi: ${S.escapeHtml(err.message)}</option>`;
    }
  }

  async function loadExistingAdsets(campaignId) {
    const listEl = document.getElementById('studioExistingAdsetsList');
    if (!listEl || !campaignId) return;

    listEl.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span><p style="margin-top:8px;">Đang tải danh sách nhóm quảng cáo...</p></div>';

    try {
      const data = await S.apiGet(`/api/cp/campaigns/${campaignId}/adsets`);
      const adsets = data.adsets || [];
      studioState.existingAdsetsList = adsets;

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
            <span class="cp-target-name">${S.escapeHtml(adset.name)}</span>
            <span class="cp-target-sub">ID: ${adset.id} • ${adset.effective_status}</span>
          </div>
        `;

        item.addEventListener('click', () => {
          if (studioState.selectedExistingAdsetIds.has(adset.id)) {
            studioState.selectedExistingAdsetIds.delete(adset.id);
            item.classList.remove('checked');
            item.querySelector('input').checked = false;
          } else {
            if (studioState.selectedExistingAdsetIds.size >= LIMITS.MAX_TARGETS) {
              alert(`Tối đa ${LIMITS.MAX_TARGETS} nhóm đích.`);
              return;
            }
            studioState.selectedExistingAdsetIds.add(adset.id);
            item.classList.add('checked');
            item.querySelector('input').checked = true;
          }
          const cntEl = document.getElementById('studioSelectedAdsetsCount');
          if (cntEl) cntEl.textContent = studioState.selectedExistingAdsetIds.size;
          renderStructurePreview();
        });

        listEl.appendChild(item);
      });

      // Auto select first adset
      if (adsets.length > 0) {
        const first = listEl.querySelector('.cp-target-item');
        if (first) first.click();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="cp-empty-state" style="color:var(--danger-text)">Lỗi: ${S.escapeHtml(err.message)}</div>`;
    }
  }

  // ------------------------------------------------------------------
  // CHUYỂN BƯỚC & VALIDATION
  // ------------------------------------------------------------------
  function goToStudioStep(targetStep) {
    if (targetStep < 1 || targetStep > 4) return;

    // Validate step trước khi chuyển sang bước cao hơn
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
        if (studioState.campMode === 'multi') {
          if (studioState.campaignCards.length === 0) {
            alert('Vui lòng thêm ít nhất 1 chiến dịch.');
            return;
          }
          if (studioState.campaignCards.length > LIMITS.MAX_CAMPAIGNS) {
            alert(`Tối đa ${LIMITS.MAX_CAMPAIGNS} chiến dịch.`);
            return;
          }
        }
      } else if (studioState.step === 2) {
        if (studioState.adsetMode === 'existing') {
          if (studioState.selectedExistingAdsetIds.size === 0) {
            alert('Vui lòng chọn ít nhất 1 Nhóm quảng cáo đích trong chiến dịch.');
            return;
          }
        } else if (studioState.adsetMode === 'new') {
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
        } else if (studioState.adsetMode === 'multi') {
          if (studioState.adsetCards.length === 0) {
            alert('Vui lòng thêm ít nhất 1 mẫu nhóm quảng cáo.');
            return;
          }
          for (let i = 0; i < studioState.adsetCards.length; i++) {
            const card = studioState.adsetCards[i];
            if (!card.name.trim()) {
              alert(`Mẫu nhóm #${i + 1} chưa có tên.`);
              return;
            }
            if (!card.pageId) {
              alert(`Mẫu nhóm #${i + 1} chưa chọn Fanpage.`);
              return;
            }
          }
        }
      } else if (studioState.step === 3) {
        if (studioState.contents.length === 0) {
          alert('Vui lòng chuẩn bị ít nhất 1 nội dung quảng cáo để tiếp tục.');
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

    S.refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onEnterStep2() {
    // Populate fanpage select
    const pageSel = document.getElementById('newAdsetPageSelect');
    const pages = S.getPages();
    if (pageSel && pageSel.options.length <= 1) {
      let html = '<option value="">-- Chọn Fanpage nhận tin nhắn --</option>';
      pages.forEach(p => {
        html += `<option value="${p.id}">${S.escapeHtml(p.name)}</option>`;
      });
      pageSel.innerHTML = html;
      if (pages.length > 0) {
        pageSel.value = pages[0].id;
        studioState.newAdsetPageId = pages[0].id;
      }
    }

    const btnModeExisting = document.getElementById('btnModeExistingAdset');
    if (studioState.campMode === 'new' || studioState.campMode === 'multi') {
      if (btnModeExisting) {
        btnModeExisting.style.opacity = '0.5';
        btnModeExisting.title = 'Chiến dịch tạo mới chưa có nhóm có sẵn trên Meta';
      }
      if (studioState.adsetMode === 'existing') {
        setAdsetMode('new');
      }
    } else {
      if (btnModeExisting) {
        btnModeExisting.style.opacity = '1';
        btnModeExisting.title = '';
      }
      if (studioState.adsetMode === 'existing') {
        loadExistingAdsets(studioState.existingCampaignId);
      }
    }

    syncBudgetLock();
    renderStructurePreview();
  }

  async function onEnterStep3() {
    if (!studioState.contentEditor) {
      studioState.contentEditor = S.ContentEditor.mount({
        containerId: 'studioContentContainer',
        max: LIMITS.MAX_CONTENTS,
        accountId: () => studioState.accountId,
        pages: () => S.getPages(),
        onChange: (contents) => {
          studioState.contents = contents;
          updateMatrixPreview();
        }
      });
    }

    studioState.contents = studioState.contentEditor.getContents();
    updateMatrixPreview();
  }

  function updateMatrixPreview() {
    const previewGrid = document.getElementById('studioMatrixPreview');
    const summaryBadge = document.getElementById('matrixSummaryBadge');
    const countBadge = document.getElementById('studioCreativeCountBadge');

    const contents = studioState.contents || [];
    const totalCreatives = contents.length;

    let targetCount = 1;
    if (studioState.campMode === 'multi') {
      const campCount = studioState.campaignCards.length;
      if (studioState.adsetMode === 'multi') {
        targetCount = studioState.adsetAttachMode === 'all'
          ? campCount * studioState.adsetCards.length
          : studioState.adsetCards.length;
      } else {
        targetCount = campCount;
      }
    } else if (studioState.campMode === 'new') {
      targetCount = studioState.adsetMode === 'multi' ? studioState.adsetCards.length : 1;
    } else {
      if (studioState.adsetMode === 'existing') {
        targetCount = Math.max(1, studioState.selectedExistingAdsetIds.size);
      } else if (studioState.adsetMode === 'multi') {
        targetCount = studioState.adsetCards.length;
      } else {
        targetCount = 1;
      }
    }

    const totalWillCreate = totalCreatives * targetCount;

    if (countBadge) countBadge.textContent = `${totalCreatives} nội dung sẵn sàng`;
    if (summaryBadge) summaryBadge.textContent = `${totalCreatives} nội dung × ${targetCount} nhóm = ${totalWillCreate} Ads`;

    if (!previewGrid) return;

    if (totalCreatives === 0) {
      previewGrid.innerHTML = '<div class="cp-empty-state" style="grid-column:1/-1;">Chưa có nội dung nào được chọn. Hãy soạn nội dung ở trên.</div>';
      return;
    }

    let html = '';
    contents.forEach((ad, i) => {
      const thumb = ad.imageUrl
        ? `<img src="${ad.imageUrl}" class="matrix-ad-thumb" alt="Thumb" loading="lazy">`
        : `<div class="matrix-ad-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;">Ad #${i + 1}</div>`;

      html += `
        <div class="matrix-ad-card">
          ${thumb}
          <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${S.escapeHtml(ad.name)}</div>
          ${ad.headline ? `<div style="font-size:0.75rem;color:var(--primary-text);font-weight:600;">${S.escapeHtml(ad.headline)}</div>` : ''}
          <div style="font-size:0.75rem;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${S.escapeHtml(ad.message || '(Không có văn bản)')}</div>
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
    const accEl = document.getElementById('sumAccountName');
    const campEl = document.getElementById('sumCampaignName');
    const adsetEl = document.getElementById('sumAdsetName');
    const countEl = document.getElementById('sumTotalAdsCount');

    if (accEl) accEl.textContent = `${studioState.accountName} (act_${studioState.accountId})`;

    let targetCount = 1;
    if (campEl) {
      if (studioState.campMode === 'multi') {
        campEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới ${studioState.campaignCards.length} CĐ]</span>`;
      } else if (studioState.campMode === 'new') {
        const preview = document.getElementById('campFullNamePreview')?.value || 'Chiến dịch mới';
        campEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${S.escapeHtml(preview)}</span>`;
      } else {
        campEl.textContent = studioState.existingCampaignName || studioState.existingCampaignId;
      }
    }

    if (adsetEl) {
      if (studioState.campMode === 'multi') {
        const campCount = studioState.campaignCards.length;
        if (studioState.adsetMode === 'multi') {
          targetCount = studioState.adsetAttachMode === 'all'
            ? campCount * studioState.adsetCards.length
            : studioState.adsetCards.length;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${targetCount} nhóm (${studioState.adsetCards.length} mẫu)</span>`;
        } else {
          targetCount = campCount;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${targetCount} nhóm (1 mẫu gán vào mọi CĐ)</span>`;
        }
      } else if (studioState.campMode === 'new') {
        if (studioState.adsetMode === 'multi') {
          targetCount = studioState.adsetCards.length;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${targetCount} nhóm</span>`;
        } else {
          targetCount = 1;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${S.escapeHtml(studioState.newAdsetName)}</span>`;
        }
      } else {
        if (studioState.adsetMode === 'existing') {
          targetCount = Math.max(1, studioState.selectedExistingAdsetIds.size);
          adsetEl.textContent = `${targetCount} nhóm có sẵn trong CĐ`;
        } else if (studioState.adsetMode === 'multi') {
          targetCount = studioState.adsetCards.length;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${targetCount} nhóm</span>`;
        } else {
          targetCount = 1;
          adsetEl.innerHTML = `<span style="color:var(--cyan-text)">[Tạo mới] ${S.escapeHtml(studioState.newAdsetName)}</span>`;
        }
      }
    }

    const totalCreatives = studioState.contents.length;
    const totalWillCreate = totalCreatives * targetCount;
    if (countEl) countEl.textContent = `${totalWillCreate} Ads`;

    const pArea = document.getElementById('studioProgressArea');
    if (pArea) pArea.style.display = 'none';

    const resArea = document.getElementById('studioResultArea');
    if (resArea) resArea.style.display = 'none';

    if (btnStudioExecute) {
      btnStudioExecute.disabled = false;
      btnStudioExecute.innerHTML = `<i data-lucide="rocket"></i><span>Tiến hành tạo Quảng cáo (PAUSED)</span>`;
    }
    S.refreshIcons();
  }

  // ------------------------------------------------------------------
  // XÂY DỰNG KẾ HOẠCH & GỬI BUILD-STRUCTURE
  // ------------------------------------------------------------------
  function buildPlanFromStudioState() {
    const campaigns = [];
    const adsets = [];
    const existingTargets = [];
    const existingCampaigns = [];

    const defaultPageId = S.getPages()[0]?.id || '';

    // A. CAMPAIGNS
    if (studioState.campMode === 'multi') {
      studioState.campaignCards.forEach((c, idx) => {
        campaigns.push({
          key: c.key || `camp_${idx + 1}`,
          name: c.name || makeCampaignName(c.prefix, c.product, c.desc),
          objective: 'OUTCOME_ENGAGEMENT',
          dailyBudget: Number(c.cboBudget) > 0 ? Number(c.cboBudget) : undefined
        });
      });
    } else if (studioState.campMode === 'new') {
      const cName = document.getElementById('campFullNamePreview')?.value || makeCampaignName(studioState.campPrefix, studioState.campProduct, studioState.campDesc);
      campaigns.push({
        key: 'camp_1',
        name: cName,
        objective: 'OUTCOME_ENGAGEMENT',
        dailyBudget: Number(studioState.campCboBudget) > 0 ? Number(studioState.campCboBudget) : undefined
      });
    } else {
      const curCamp = studioState.existingCampaigns.find(c => c.id === studioState.existingCampaignId);
      existingCampaigns.push({
        id: studioState.existingCampaignId,
        name: studioState.existingCampaignName || studioState.existingCampaignId,
        hasCbo: Boolean(curCamp?.hasCbo)
      });
    }

    // Helper sinh spec targeting
    const makeTargeting = (geoCode, genderCode, ageMin, ageMax, placement) => {
      let geo = { countries: ['VN'] };
      if (geoCode === 'HN') geo = { regions: [{ key: '3875' }] };
      else if (geoCode === 'HCM') geo = { regions: [{ key: '3878' }] };

      let genders = undefined;
      if (genderCode === 'female') genders = [2];
      else if (genderCode === 'male') genders = [1];

      return {
        ageMin: ageMin || 25,
        ageMax: ageMax || 45,
        genders,
        geoLocations: geo,
        placements: placement === 'custom' ? ['facebook'] : undefined
      };
    };

    // B. ADSETS & EXISTING TARGETS
    if (studioState.adsetMode === 'existing') {
      studioState.selectedExistingAdsetIds.forEach(id => {
        const found = studioState.existingAdsetsList.find(a => a.id === id);
        existingTargets.push({
          campaignId: studioState.existingCampaignId,
          campaignName: studioState.existingCampaignName,
          adsetId: id,
          adsetName: found?.name || id,
          pageId: found?.pageId || defaultPageId
        });
      });
    } else if (studioState.adsetMode === 'new') {
      const attach = studioState.campMode === 'existing'
        ? `existing:${studioState.existingCampaignId}`
        : 'all';

      adsets.push({
        key: 'as_1',
        name: studioState.newAdsetName || 'Nhóm QC mới',
        pageId: studioState.newAdsetPageId || defaultPageId,
        dailyBudget: Number(studioState.newAdsetBudget) || 100000,
        targeting: makeTargeting(
          studioState.targetLocation,
          studioState.targetGender,
          studioState.targetAgeMin,
          studioState.targetAgeMax,
          studioState.placementMode
        ),
        attachTo: attach
      });
    } else if (studioState.adsetMode === 'multi') {
      studioState.adsetCards.forEach((card, idx) => {
        let attach = 'all';
        if (studioState.campMode === 'existing') {
          attach = `existing:${studioState.existingCampaignId}`;
        } else if (studioState.adsetAttachMode === 'each' && card.attachToCampKey) {
          attach = card.attachToCampKey;
        }

        adsets.push({
          key: card.key || `as_${idx + 1}`,
          name: card.name || `Nhóm QC 0${idx + 1}`,
          pageId: card.pageId || defaultPageId,
          dailyBudget: Number(card.dailyBudget) || 100000,
          targeting: makeTargeting(
            card.targetLocation,
            card.targetGender,
            card.targetAgeMin,
            card.targetAgeMax,
            card.placementMode
          ),
          attachTo: attach
        });
      });
    }

    return {
      accountId: studioState.accountId,
      campaigns,
      adsets,
      existingTargets,
      existingCampaigns,
      contents: studioState.contents,
      pairingMode: 'matrix',
      namePattern: '{content} — {adset}',
      excludedPairs: []
    };
  }

  function confirmExecute(adCount, etaSeconds) {
    const typed = prompt(
      `Sắp tạo ${adCount} quảng cáo THẬT trên Meta (tất cả PAUSED).\n` +
      `Ước tính thời gian thực thi: ≈ ${Math.ceil(etaSeconds / 60)} phút.\n\n` +
      `Gõ đúng số ${adCount} để xác nhận:`
    );
    return String(typed || '').trim() === String(adCount);
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
    row.innerHTML = `<span style="color:var(--text-muted)">[${time}]</span> ${S.escapeHtml(msg)}`;
    logBox.appendChild(row);
    logBox.scrollTop = logBox.scrollHeight;
  }

  async function executeStudioBatch() {
    if (studioState.isExecuting) return;

    const payload = buildPlanFromStudioState();

    if (payload.contents.length === 0) {
      alert('Chưa có nội dung quảng cáo nào.');
      return;
    }

    // Đếm đối tượng dự kiến
    let targetCount = payload.existingTargets.length;
    if (payload.adsets.length > 0) {
      if (payload.campaigns.length > 0) {
        if (studioState.adsetAttachMode === 'all') {
          targetCount += payload.campaigns.length * payload.adsets.length;
        } else {
          targetCount += payload.adsets.length;
        }
      } else {
        targetCount += payload.adsets.length;
      }
    }

    const expectedAds = targetCount * payload.contents.length;
    const creativeCount = payload.contents.length;
    const etaSeconds = Math.round((payload.campaigns.length * 2500 + targetCount * 2500 + creativeCount * 1200 + expectedAds * 2000) / 1000);

    if (!confirmExecute(expectedAds, etaSeconds)) {
      alert('Đã huỷ thao tác tạo quảng cáo.');
      return;
    }

    studioState.isExecuting = true;
    studioState.planId = crypto.randomUUID();

    if (btnStudioBack) btnStudioBack.style.display = 'none';
    if (btnStudioExecute) {
      btnStudioExecute.disabled = true;
      btnStudioExecute.innerHTML = `<span class="cp-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span><span>Đang xử lý trên Meta...</span>`;
    }

    const pArea = document.getElementById('studioProgressArea');
    const pFill = document.getElementById('studioProgressBarFill');
    const pText = document.getElementById('studioProgressStatusText');
    const pPct = document.getElementById('studioProgressPercentText');
    const pJobId = document.getElementById('studioJobIdText');
    const logBox = document.getElementById('studioExecutionLog');

    if (pArea) pArea.style.display = 'block';
    if (logBox) logBox.innerHTML = '';
    if (pFill) pFill.style.width = '0%';
    if (pPct) pPct.textContent = '0%';
    if (pText) pText.textContent = 'Đang khởi tạo job thực thi...';
    if (pJobId) pJobId.textContent = '';

    logStudio('Bắt đầu khởi tạo tiến trình tạo cấu trúc hàng loạt...', 'info');

    try {
      payload.planId = studioState.planId;
      const data = await S.apiPost('/api/cp/build-structure', payload);
      studioState.jobId = data.jobId;

      if (pJobId) {
        pJobId.innerHTML = `Mã Job: <strong>${data.jobId}</strong> · <em>Đóng tab vẫn chạy, có thể mở <code>/api/cp/job/${data.jobId}</code> để kiểm tra.</em>`;
      }

      pollJob(data.jobId);
    } catch (err) {
      logStudio(`Không thể khởi tạo đợt chạy: ${err.message}`, 'error');
      alert(`Lỗi khởi tạo: ${err.message}`);
      studioState.isExecuting = false;
      if (btnStudioBack) btnStudioBack.style.display = 'inline-flex';
      if (btnStudioExecute) {
        btnStudioExecute.disabled = false;
        btnStudioExecute.innerHTML = `<i data-lucide="rocket"></i><span>Tiến hành tạo Quảng cáo (PAUSED)</span>`;
      }
    }
  }

  function pollJob(jobId) {
    clearInterval(studioState.polling);
    studioState.polling = setInterval(async () => {
      try {
        const j = await S.apiGet(`/api/cp/job/${jobId}`);
        studioState.lastJobResult = j;

        const pFill = document.getElementById('studioProgressBarFill');
        const pText = document.getElementById('studioProgressStatusText');
        const pPct = document.getElementById('studioProgressPercentText');

        const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
        if (pFill) pFill.style.width = `${pct}%`;
        if (pPct) pPct.textContent = `${pct}%`;

        let phaseName = 'Đang xử lý';
        if (j.phase === 'campaigns') phaseName = 'Đang tạo Chiến dịch';
        else if (j.phase === 'adsets') phaseName = 'Đang tạo Nhóm quảng cáo';
        else if (j.phase === 'ads') phaseName = 'Đang tạo Quảng cáo';
        if (pText) pText.textContent = `${phaseName} (${j.done}/${j.total})`;

        // Render logs
        renderLogs(j.logs || []);

        if (j.status === 'done' || j.status === 'error') {
          clearInterval(studioState.polling);
          studioState.polling = null;
          studioState.isExecuting = false;

          if (btnStudioBack) btnStudioBack.style.display = 'inline-flex';
          if (btnStudioExecute) {
            btnStudioExecute.disabled = false;
            btnStudioExecute.innerHTML = `<i data-lucide="check-circle"></i><span>Đã hoàn tất</span>`;
          }

          if (j.status === 'done') {
            if (pText) pText.textContent = `Hoàn tất toàn bộ (${j.done}/${j.total})!`;
            logStudio('🎉 Hoàn tất toàn bộ kế hoạch tạo đối tượng trên Meta! Mọi đối tượng đều ở trạng thái PAUSED.', 'success');
          } else {
            if (pText) pText.textContent = `Dừng với lỗi: ${j.error || 'Lỗi không xác định'}`;
            logStudio(`❌ Đợt chạy gặp lỗi dừng: ${j.error || ''}`, 'error');
          }

          renderResultTable(j);
        }
      } catch (err) {
        logStudio(`Mất kết nối kiểm tra tiến độ: ${err.message} — đang thử lại...`, 'warn');
      }
    }, 2000);
  }

  function renderLogs(logs) {
    const logBox = document.getElementById('studioExecutionLog');
    if (!logBox) return;

    logBox.innerHTML = logs.map(l => {
      let color = 'var(--text-secondary)';
      if (l.level === 'success') color = 'var(--success-text)';
      else if (l.level === 'error') color = 'var(--danger-text)';
      else if (l.level === 'warn') color = 'var(--warning-text)';
      const t = l.at ? new Date(l.at).toLocaleTimeString('vi-VN') : '';
      return `<div style="color:${color};margin-bottom:3px;"><span style="color:var(--text-muted)">[${t}]</span> ${S.escapeHtml(l.msg)}</div>`;
    }).join('');

    logBox.scrollTop = logBox.scrollHeight;
  }

  function renderResultTable(job) {
    const resArea = document.getElementById('studioResultArea');
    const tableBody = document.querySelector('#studioResultTable tbody');
    const csvBtn = document.getElementById('studioDownloadCsvBtn');
    const retryBtn = document.getElementById('studioRetryFailedBtn');

    if (!resArea || !tableBody) return;
    resArea.style.display = 'block';

    if (csvBtn) {
      csvBtn.href = `/api/cp/job/${job.id}/csv`;
    }

    const created = job.created || { campaigns: [], adsets: [], ads: [] };
    let rowsHtml = '';
    let hasFailed = false;

    created.campaigns?.forEach(c => {
      if (!c.success) hasFailed = true;
      rowsHtml += `
        <tr>
          <td><span class="badge" style="font-size:0.7rem;">Chiến dịch</span></td>
          <td style="font-weight:600;">${S.escapeHtml(c.name)}</td>
          <td><code>${c.id || '--'}</code></td>
          <td><span class="badge ${c.success ? 'badge-success' : 'badge-danger'}">${c.success ? 'PAUSED' : 'LỖI'}</span></td>
          <td style="color:${c.success ? 'var(--text-secondary)' : 'var(--danger-text)'};">${S.escapeHtml(c.error || 'Thành công')}</td>
        </tr>
      `;
    });

    created.adsets?.forEach(a => {
      if (!a.success) hasFailed = true;
      rowsHtml += `
        <tr>
          <td><span class="badge" style="font-size:0.7rem;">Nhóm</span></td>
          <td style="font-weight:600;">${S.escapeHtml(a.name)}</td>
          <td><code>${a.id || '--'}</code></td>
          <td><span class="badge ${a.success ? 'badge-success' : 'badge-danger'}">${a.success ? 'PAUSED' : (a.skipped ? 'BỎ QUA' : 'LỖI')}</span></td>
          <td style="color:${a.success ? 'var(--text-secondary)' : 'var(--danger-text)'};">${S.escapeHtml(a.error || 'Thành công')}</td>
        </tr>
      `;
    });

    created.ads?.forEach(ad => {
      if (!ad.success) hasFailed = true;
      rowsHtml += `
        <tr>
          <td><span class="badge" style="font-size:0.7rem;">Quảng cáo</span></td>
          <td style="font-weight:600;">${S.escapeHtml(ad.name)}</td>
          <td><code>${ad.id || '--'}</code></td>
          <td><span class="badge ${ad.success ? 'badge-success' : 'badge-danger'}">${ad.success ? 'PAUSED' : (ad.skipped ? 'BỎ QUA' : 'LỖI')}</span></td>
          <td style="color:${ad.success ? 'var(--text-secondary)' : 'var(--danger-text)'};">${S.escapeHtml(ad.error || 'Thành công')}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = rowsHtml || '<tr><td colspan="5" style="text-align:center;">Chưa có dữ liệu đối tượng nào.</td></tr>';

    if (retryBtn) {
      retryBtn.style.display = hasFailed ? 'inline-flex' : 'none';
    }
  }

  function retryFailedItems() {
    alert('Để thử lại các mục bị lỗi, vui lòng kiểm tra thông điệp lỗi trong bảng và bấm Tiếp tục hoặc điều chỉnh nội dung.');
  }

  return {
    init: initStudio
  };
})();
