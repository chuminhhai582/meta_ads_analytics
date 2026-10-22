/**
 * Replicate Modal — 4-Step Wizard for Full Cross-Account Campaign Replication
 *
 * Flow:
 *   Step 1: Phân tích Ads — lấy ads + creative + targeting từ campaigns đã chọn
 *   Step 2: Chọn đích — Tài khoản QC đích + Fanpage đích (thay thế page gốc)
 *   Step 3: Tuỳ chọn — Clone targeting/audiences/placements + Ngân sách
 *   Step 4: Thực thi — Tạo Campaign → Adset → Creative → Ad trên account đích
 *
 * Anti-spam: max 10 items/batch, 2-3s delay, PAUSED mặc định, mutex
 */

(function () {
  'use strict';

  const mState = {
    step: 1,
    sessionToken: '',
    selectedCampaigns: [],
    analyzedAds: [],
    // Step 2: đích
    pages: [],
    adAccounts: [],
    selectedAccountId: '',   // 1 tài khoản đích
    selectedPageId: '',      // 1 fanpage đích (thay thế page gốc)
    cacheAge: '',
    // Step 3: clone options
    cloneTargeting: true,
    cloneAudiences: true,
    clonePlacements: true,
    budgetType: 'daily_budget',
    budgetAmount: 200000,
    // Execution
    isExecuting: false
  };

  const modal = document.getElementById('replicateModal');
  const stepContent = document.getElementById('replicateStepContent');
  const prevBtn = document.getElementById('replicatePrevBtn');
  const nextBtn = document.getElementById('replicateNextBtn');
  const closeBtn = document.getElementById('closeReplicateModalBtn');
  const wizardSteps = document.querySelectorAll('.wizard-step');

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatNum(n) { return Number(n || 0).toLocaleString('vi-VN'); }
  function refreshIcons() { if (typeof lucide !== 'undefined') lucide.createIcons(); }

  let replicateTrap = null;
  function getTrap() {
    if (!replicateTrap && modal && typeof window.trapModal === 'function') {
      replicateTrap = window.trapModal(modal, () => {
        if (mState.isExecuting && !confirm('Đang tạo quảng cáo trên Meta. Đóng cửa sổ?')) return false;
        modal.style.display = 'none';
      });
    }
    return replicateTrap;
  }

  // ---- PUBLIC ----
  window.openReplicateModal = function (campaigns, sessionToken) {
    mState.selectedCampaigns = campaigns;
    mState.sessionToken = sessionToken;
    mState.step = 1;
    mState.analyzedAds = [];
    mState.selectedAccountId = '';
    mState.selectedPageId = '';
    mState.cloneTargeting = true;
    mState.cloneAudiences = true;
    mState.clonePlacements = true;
    mState.budgetAmount = 200000;
    mState.isExecuting = false;
    if (modal) {
      modal.style.display = 'flex';
      getTrap()?.open();
    }
    goToStep(1);
    loadStep1();
  };

  // ---- Navigation ----
  function goToStep(n) {
    mState.step = n;
    wizardSteps.forEach(el => {
      const s = parseInt(el.dataset.step);
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
    prevBtn.style.display = n > 1 && n < 4 ? 'inline-flex' : 'none';
    nextBtn.style.display = n < 4 ? 'inline-flex' : 'none';
    updateNextBtn();
  }

  function updateNextBtn() {
    const n = mState.step;
    if (n === 1) {
      nextBtn.textContent = 'Tiếp theo →';
      nextBtn.disabled = mState.analyzedAds.length === 0;
    } else if (n === 2) {
      nextBtn.textContent = 'Tiếp theo →';
      nextBtn.disabled = !mState.selectedAccountId || !mState.selectedPageId;
    } else if (n === 3) {
      nextBtn.textContent = '🚀 Tiến hành nhân bản';
      nextBtn.disabled = false;
    }
  }

  prevBtn?.addEventListener('click', () => {
    if (mState.step > 1 && mState.step < 4) {
      goToStep(mState.step - 1);
      if (mState.step === 1) renderStep1Results();
      else if (mState.step === 2) renderStep2();
    }
  });

  nextBtn?.addEventListener('click', () => {
    const n = mState.step;
    if (n === 1 && mState.analyzedAds.length > 0) { goToStep(2); loadStep2(); }
    else if (n === 2 && mState.selectedAccountId && mState.selectedPageId) { goToStep(3); renderStep3(); }
    else if (n === 3) { goToStep(4); executeStep4(); }
  });

  closeBtn?.addEventListener('click', () => {
    const trap = getTrap();
    if (trap) {
      trap.close();
    } else {
      if (mState.isExecuting && !confirm('Đang tạo quảng cáo trên Meta. Đóng cửa sổ?')) return;
      if (modal) modal.style.display = 'none';
    }
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        const trap = getTrap();
        if (trap) {
          trap.close();
        } else {
          if (mState.isExecuting && !confirm('Đang tạo quảng cáo trên Meta. Đóng cửa sổ?')) return;
          modal.style.display = 'none';
        }
      }
    });
  }

  // ============================================================
  // STEP 1: Analyze Campaigns
  // ============================================================
  async function loadStep1() {
    stepContent.innerHTML = `
      <div style="text-align:center;padding:24px;">
        <div class="cp-spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 12px;"></div>
        <p style="color:var(--text-secondary);">Đang phân tích ${mState.selectedCampaigns.length} chiến dịch…</p>
      </div>`;
    nextBtn.disabled = true;

    try {
      const res = await fetch('/api/cp/analyze-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': mState.sessionToken },
        body: JSON.stringify({ campaignIds: mState.selectedCampaigns.map(c => c.id) })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi phân tích');
      mState.analyzedAds = data.ads || [];
      const nameMap = new Map(mState.selectedCampaigns.map(c => [c.id, c]));
      mState.analyzedAds.forEach(ad => {
        const camp = nameMap.get(ad.campaignId);
        ad.campaignName = camp?.name || ad.campaignId;
      });
      renderStep1Results();
    } catch (err) {
      stepContent.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger-text);">Lỗi: ${esc(err.message)}</div>`;
    }
  }

  function renderStep1Results() {
    const ads = mState.analyzedAds;
    const ppC = ads.filter(a => a.type === 'page_post').length;
    const daC = ads.filter(a => a.type === 'direct_ad').length;

    let html = `<div style="margin-bottom:12px;">
      <p style="color:var(--text-secondary);font-size:0.9rem;">
        Tìm thấy <strong>${ads.length}</strong> quảng cáo:
        <span class="rep-type-badge page-post">📝 Page Post: ${ppC}</span>
        <span class="rep-type-badge direct-ad">🎯 Direct Ad: ${daC}</span>
      </p>
    </div>`;

    if (ads.length === 0) {
      html += `<p style="color:var(--text-muted);text-align:center;padding:20px;">Không tìm thấy quảng cáo nào.</p>`;
    } else {
      // Giới hạn hiển thị 20 ad để không lag
      const showAds = ads.slice(0, 20);
      showAds.forEach(ad => {
        const badge = ad.type === 'page_post'
          ? '<span class="rep-type-badge page-post">Page Post</span>'
          : '<span class="rep-type-badge direct-ad">Direct Ad</span>';
        const img = ad.creative.imageUrl || '';
        const thumb = img ? `<img src="${img}" class="rep-ad-thumb" loading="lazy">` :
          `<div class="rep-ad-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.7rem;">Ad</div>`;
        const body = (ad.creative.body || '').slice(0, 80);

        let tgtHtml = '';
        const ts = ad.targetingSummary;
        if (ts) {
          const p = [];
          if (ts.ageMin || ts.ageMax) p.push(`👤 ${ts.ageMin||'?'}–${ts.ageMax||'?'} tuổi`);
          if (ts.genders?.length) p.push(ts.genders.map(g => g===1?'Nam':g===2?'Nữ':'Tất cả').join(', '));
          if (ts.geoNames?.length) p.push(`📍 ${ts.geoNames.slice(0,3).join(', ')}${ts.geoNames.length>3?` +${ts.geoNames.length-3}`:''}`);
          if (ts.customAudiences?.length) p.push(`🎯 ${ts.customAudiences.length} tệp ĐT`);
          if (ts.excludedCustomAudiences?.length) p.push(`🚫 ${ts.excludedCustomAudiences.length} loại trừ`);
          if (ts.platforms?.length) p.push(`📱 ${ts.platforms.join(', ')}`);
          if (p.length) tgtHtml = `<div class="rep-ad-meta" style="margin-top:4px;color:var(--cyan-text);font-size:0.72rem;">🎯 ${p.join(' • ')}</div>`;
        }

        html += `<div class="rep-ad-card">${thumb}<div class="rep-ad-info">
          <div class="rep-ad-name">${esc(ad.adName)} ${badge}</div>
          <div class="rep-ad-meta">Chiến dịch: ${esc(ad.campaignName)}</div>
          ${body ? `<div class="rep-ad-meta" style="margin-top:2px;color:var(--text-secondary);">${esc(body)}${ad.creative.body.length>80?'…':''}</div>` : ''}
          ${tgtHtml}
        </div></div>`;
      });
      if (ads.length > 20) html += `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;">…và ${ads.length - 20} quảng cáo nữa</p>`;
    }

    stepContent.innerHTML = html;
    updateNextBtn();
    refreshIcons();
  }

  // ============================================================
  // STEP 2: Chọn Tài khoản QC đích + Fanpage đích
  // ============================================================
  async function loadStep2() {
    stepContent.innerHTML = `<div style="text-align:center;padding:24px;">
      <div class="cp-spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 12px;"></div>
      <p style="color:var(--text-secondary);">Đang tải tài khoản & fanpage…</p>
    </div>`;

    try {
      const [pRes, aRes] = await Promise.all([
        fetch('/api/cp/pages').then(r => r.json()),
        fetch('/api/cp/ad-accounts').then(r => r.json())
      ]);
      if (!pRes.ok) throw new Error(pRes.error || 'Lỗi lấy pages');
      mState.pages = pRes.pages || [];
      mState.adAccounts = aRes.accounts || [];
      mState.cacheAge = pRes.cacheAge || aRes.cacheAge || '';
      renderStep2();
    } catch (err) {
      stepContent.innerHTML = `<p style="color:var(--danger-text);text-align:center;">Lỗi: ${esc(err.message)}</p>`;
    }
  }

  function renderStep2() {
    let html = `<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <h4 style="color:var(--text-primary);font-size:1rem;margin:0;">Chọn đích nhân bản</h4>
      <div style="display:flex;gap:8px;align-items:center;">
        ${mState.cacheAge ? `<span style="font-size:0.72rem;color:var(--text-muted);">Cache: ${esc(mState.cacheAge)}</span>` : ''}
        <button id="repRefreshAll" class="btn btn-secondary btn-sm" type="button">🔄 Làm mới</button>
      </div>
    </div>`;

    // --- Tài khoản QC đích ---
    html += `<div style="margin-bottom:14px;">
      <label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">
        📊 Tài khoản quảng cáo đích
      </label>
      <select id="repTargetAccount" style="width:100%;height:38px;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0 12px;font-size:0.85rem;">
        <option value="">-- Chọn tài khoản --</option>`;

    mState.adAccounts.forEach(a => {
      const sel = a.accountId === mState.selectedAccountId ? ' selected' : '';
      html += `<option value="${a.accountId}"${sel}>${esc(a.name)} (${a.accountId})</option>`;
    });
    html += `</select></div>`;

    // --- Fanpage đích ---
    html += `<div>
      <label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">
        📄 Fanpage đích <span style="font-weight:400;color:var(--text-muted);">(thay thế page gốc trong creative)</span>
      </label>
      <div class="rep-page-grid" id="repPageGrid2">`;

    mState.pages.forEach(p => {
      const isChecked = p.id === mState.selectedPageId;
      const avatar = p.pictureUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect fill="%23334155" width="30" height="30" rx="15"/></svg>';
      html += `<div class="rep-page-item ${isChecked ? 'checked' : ''}" data-page-id="${p.id}">
        <input type="radio" name="repTargetPage" ${isChecked ? 'checked' : ''} style="pointer-events:none;accent-color:var(--primary);">
        <img src="${avatar}" class="rep-page-avatar" alt="">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">${formatNum(p.fanCount)} fans</div>
        </div>
      </div>`;
    });
    html += `</div></div>`;

    // Info box
    html += `<div style="margin-top:10px;background:rgba(0,128,251,0.08);border:1px solid rgba(0,128,251,0.15);border-radius:var(--radius-sm);padding:10px 14px;font-size:0.8rem;color:var(--primary-text);">
      💡 Quảng cáo sẽ được tạo <strong>mới hoàn toàn</strong> trên tài khoản đích với fanpage đích — bao gồm Campaign, Adset, Creative và Ad. Nội dung (text, ảnh/video) được sao chép từ quảng cáo gốc.
    </div>`;

    stepContent.innerHTML = html;

    // Events
    document.getElementById('repTargetAccount')?.addEventListener('change', e => {
      mState.selectedAccountId = e.target.value;
      updateNextBtn();
    });

    document.getElementById('repPageGrid2')?.addEventListener('click', e => {
      const item = e.target.closest('.rep-page-item');
      if (!item) return;
      mState.selectedPageId = item.dataset.pageId;
      document.querySelectorAll('#repPageGrid2 .rep-page-item').forEach(el => {
        const isSel = el.dataset.pageId === mState.selectedPageId;
        el.classList.toggle('checked', isSel);
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = isSel;
      });
      updateNextBtn();
    });

    document.getElementById('repRefreshAll')?.addEventListener('click', async () => {
      const btn = document.getElementById('repRefreshAll');
      if (btn) { btn.disabled = true; btn.textContent = 'Đang làm mới...'; }
      try {
        const res = await fetch('/api/cp/refresh-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': mState.sessionToken }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        mState.pages = data.pages || [];
        mState.adAccounts = data.adAccounts || [];
        mState.cacheAge = 'Vừa cập nhật';
        renderStep2();
      } catch (err) {
        alert('Lỗi: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Làm mới'; }
      }
    });

    updateNextBtn();
  }

  // ============================================================
  // STEP 3: Tuỳ chọn clone + Ngân sách
  // ============================================================
  function renderStep3() {
    const totalAds = mState.analyzedAds.length;
    const selAcc = mState.adAccounts.find(a => a.accountId === mState.selectedAccountId);
    const selPage = mState.pages.find(p => p.id === mState.selectedPageId);

    let html = `<div style="margin-bottom:16px;">
      <h4 style="color:var(--text-primary);font-size:1rem;margin:0 0 8px;">Tóm tắt nhân bản</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px;">
          <div style="font-size:0.75rem;color:var(--text-muted);">Quảng cáo</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--primary-text);">${totalAds} ads</div>
        </div>
        <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px;">
          <div style="font-size:0.75rem;color:var(--text-muted);">TK đích</div>
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(selAcc?.name || mState.selectedAccountId)}</div>
        </div>
        <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px;">
          <div style="font-size:0.75rem;color:var(--text-muted);">Page đích</div>
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(selPage?.name || mState.selectedPageId)}</div>
        </div>
      </div>
    </div>`;

    // Clone options
    html += `<div style="margin-bottom:16px;">
      <h4 style="color:var(--text-primary);font-size:1rem;margin:0 0 8px;">Tuỳ chọn nhân bản từ nhóm QC gốc</h4>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label class="rep-clone-option" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);">
          <input type="checkbox" id="repCloneTargeting" ${mState.cloneTargeting ? 'checked' : ''} style="accent-color:var(--primary);width:16px;height:16px;">
          <div><div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">🎯 Targeting (Tuổi, Giới tính, Vị trí)</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Clone age_min, age_max, genders, geo_locations từ adset gốc</div></div>
        </label>
        <label class="rep-clone-option" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);">
          <input type="checkbox" id="repCloneAudiences" ${mState.cloneAudiences ? 'checked' : ''} style="accent-color:var(--primary);width:16px;height:16px;">
          <div><div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">👥 Tệp đối tượng (Custom/Lookalike Audience)</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Clone custom_audiences + excluded_custom_audiences (cần share quyền từ BM)</div></div>
        </label>
        <label class="rep-clone-option" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);">
          <input type="checkbox" id="repClonePlacements" ${mState.clonePlacements ? 'checked' : ''} style="accent-color:var(--primary);width:16px;height:16px;">
          <div><div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">📱 Vị trí quảng cáo (Placements)</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Clone publisher_platforms, facebook_positions, device_platforms</div></div>
        </label>
      </div>
    </div>`;

    // Budget
    html += `<div class="rep-budget-form">
      <h4 style="color:var(--text-primary);font-size:1rem;margin:0;">Ngân sách Adset</h4>
      <div class="rep-budget-row">
        <div class="form-group">
          <label for="repBudgetType">Loại ngân sách</label>
          <select id="repBudgetType">
            <option value="daily_budget" ${mState.budgetType==='daily_budget'?'selected':''}>Ngân sách ngày</option>
            <option value="lifetime_budget" ${mState.budgetType==='lifetime_budget'?'selected':''}>Ngân sách trọn đời</option>
          </select>
        </div>
        <div class="form-group">
          <label for="repBudgetAmount">Số tiền (VND)</label>
          <input type="number" id="repBudgetAmount" value="${mState.budgetAmount}" min="10000" step="10000">
        </div>
      </div>
    </div>`;

    // Targeting preview
    const adsWithTs = mState.analyzedAds.filter(a => a.targetingSummary);
    if (adsWithTs.length > 0) {
      const seen = new Set();
      html += `<div style="margin-top:12px;background:rgba(0,128,251,0.08);border:1px solid rgba(0,128,251,0.2);border-radius:var(--radius-sm);padding:12px;">
        <div style="font-size:0.85rem;font-weight:600;color:var(--primary-text);margin-bottom:4px;">Targeting gốc sẽ được clone</div>`;
      adsWithTs.forEach(a => {
        if (a.adsetId && seen.has(a.adsetId)) return;
        if (a.adsetId) seen.add(a.adsetId);
        const ts = a.targetingSummary;
        const p = [];
        if (ts.ageMin||ts.ageMax) p.push(`Tuổi: ${ts.ageMin||'?'}–${ts.ageMax||'?'}`);
        if (ts.genders?.length) p.push(`Giới: ${ts.genders.map(g=>g===1?'Nam':g===2?'Nữ':'Tất cả').join(', ')}`);
        if (ts.geoNames?.length) p.push(`Vùng: ${ts.geoNames.slice(0,3).join(', ')}${ts.geoNames.length>3?` +${ts.geoNames.length-3}`:''}`);
        if (ts.customAudiences?.length) p.push(`Tệp ĐT: ${ts.customAudiences.length}`);
        if (ts.platforms?.length) p.push(`Platforms: ${ts.platforms.join(', ')}`);
        html += `<div style="font-size:0.78rem;color:var(--text-secondary);padding:3px 0;">${p.join(' • ')}</div>`;
      });
      html += `</div>`;
    }

    // Warning
    html += `<div style="margin-top:12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-sm);padding:10px 14px;font-size:0.825rem;color:var(--warning-text);display:flex;align-items:flex-start;gap:8px;">
      <i data-lucide="alert-triangle" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;"></i>
      <div><strong>An toàn:</strong> Tất cả quảng cáo tạo ở trạng thái <strong>PAUSED</strong>.
      Giãn cách 2–3s giữa mỗi thao tác. Ước tính: ~${estimateTime()}s.</div>
    </div>`;

    stepContent.innerHTML = html;

    // Events
    document.getElementById('repCloneTargeting')?.addEventListener('change', e => { mState.cloneTargeting = e.target.checked; });
    document.getElementById('repCloneAudiences')?.addEventListener('change', e => { mState.cloneAudiences = e.target.checked; });
    document.getElementById('repClonePlacements')?.addEventListener('change', e => { mState.clonePlacements = e.target.checked; });
    document.getElementById('repBudgetType')?.addEventListener('change', e => { mState.budgetType = e.target.value; });
    document.getElementById('repBudgetAmount')?.addEventListener('input', e => { mState.budgetAmount = parseInt(e.target.value) || 0; });

    updateNextBtn();
    refreshIcons();
  }

  function estimateTime() {
    return Math.max(5, mState.analyzedAds.length * 8); // ~8s per ad (3 API calls + delays)
  }

  // ============================================================
  // STEP 4: Execute — Tạo Campaign → Adset → Creative → Ad
  // ============================================================
  async function executeStep4() {
    mState.isExecuting = true;
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';

    // Build items (max 10)
    const items = [];
    const adsToReplicate = mState.analyzedAds.slice(0, 10);

    adsToReplicate.forEach(ad => {
      // Build targeting spec based on clone options
      let clonedTargeting = null;
      if (ad.adsetInfo?.targeting) {
        const src = ad.adsetInfo.targeting;
        clonedTargeting = {};

        if (mState.cloneTargeting) {
          if (src.age_min) clonedTargeting.age_min = src.age_min;
          if (src.age_max) clonedTargeting.age_max = src.age_max;
          if (src.genders) clonedTargeting.genders = src.genders;
          if (src.geo_locations) clonedTargeting.geo_locations = src.geo_locations;
          if (src.excluded_geo_locations) clonedTargeting.excluded_geo_locations = src.excluded_geo_locations;
          if (src.flexible_spec) clonedTargeting.flexible_spec = src.flexible_spec;
          if (src.exclusions) clonedTargeting.exclusions = src.exclusions;
        }

        if (mState.cloneAudiences) {
          if (src.custom_audiences) clonedTargeting.custom_audiences = src.custom_audiences;
          if (src.excluded_custom_audiences) clonedTargeting.excluded_custom_audiences = src.excluded_custom_audiences;
        }

        if (mState.clonePlacements) {
          if (src.publisher_platforms) clonedTargeting.publisher_platforms = src.publisher_platforms;
          if (src.facebook_positions) clonedTargeting.facebook_positions = src.facebook_positions;
          if (src.instagram_positions) clonedTargeting.instagram_positions = src.instagram_positions;
          if (src.messenger_positions) clonedTargeting.messenger_positions = src.messenger_positions;
          if (src.audience_network_positions) clonedTargeting.audience_network_positions = src.audience_network_positions;
          if (src.device_platforms) clonedTargeting.device_platforms = src.device_platforms;
        }

        // Nếu không clone gì → null
        if (Object.keys(clonedTargeting).length === 0) clonedTargeting = null;
      }

      items.push({
        adId: ad.adId,
        type: 'cross_account_replicate',
        campaignName: ad.campaignName || ad.adName,
        targetAccountId: mState.selectedAccountId,
        targetPageId: mState.selectedPageId,
        adsetInfo: ad.adsetInfo || null,
        clonedTargeting,
        creative: ad.creative,
        budgetType: mState.budgetType,
        budgetAmount: String(mState.budgetAmount),
        optimizationGoal: ad.adsetInfo?.optimizationGoal || 'CONVERSATIONS',
        billingEvent: ad.adsetInfo?.billingEvent || 'IMPRESSIONS'
      });
    });

    stepContent.innerHTML = `<div style="margin-bottom:16px;">
      <h4 style="color:var(--text-primary);font-size:1rem;margin:0 0 8px;">Đang nhân bản ${items.length} quảng cáo...</h4>
      <p style="font-size:0.85rem;color:var(--text-secondary);">
        Tạo Campaign → Adset → Creative → Ad trên TK ${mState.selectedAccountId}.<br>
        Giãn cách 2-3s/thao tác. Vui lòng không đóng cửa sổ.
      </p>
    </div>
    <div class="rep-progress-bar"><div id="repProgressFill" class="rep-progress-fill"></div></div>
    <div id="repResultsList"></div>`;

    const progressFill = document.getElementById('repProgressFill');
    const resultsList = document.getElementById('repResultsList');
    if (progressFill) progressFill.style.width = '10%';

    try {
      const res = await fetch('/api/cp/bulk-replicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': mState.sessionToken },
        body: JSON.stringify({ items })
      });

      if (progressFill) progressFill.style.width = '100%';
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Lỗi');

      let rHtml = `<div style="background:var(--bg-input);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;">
        <strong style="color:var(--text-primary);">Kết quả:</strong>
        <span style="color:var(--success-text);margin-left:8px;">✅ ${data.summary.success} thành công</span>
        ${data.summary.failed > 0 ? `<span style="color:var(--danger-text);margin-left:8px;">❌ ${data.summary.failed} thất bại</span>` : ''}
      </div>`;

      data.results.forEach(r => {
        r.targets.forEach(t => {
          const label = t.success
            ? `${esc(t.targetName||'')} — Đã tạo QC (PAUSED)${t.targetingCloned ? ' + Targeting' : ''}`
            : `${esc(t.targetName||t.targetId)} — ${esc(t.error)}`;
          rHtml += `<div class="rep-result-item ${t.success?'rep-result-ok':'rep-result-fail'}">
            <span>${label}</span><span>${t.success?'✅':'❌'}</span>
          </div>`;
        });
      });

      resultsList.innerHTML = rHtml;
      nextBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Đóng';
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        const trap = getTrap();
        if (trap) trap.close();
        else modal.style.display = 'none';
        nextBtn.onclick = null;
      };

    } catch (err) {
      if (progressFill) progressFill.style.width = '100%';
      resultsList.innerHTML = `<div class="rep-result-item rep-result-fail">Lỗi: ${esc(err.message)}</div>`;
      nextBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Đóng';
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        const trap = getTrap();
        if (trap) trap.close();
        else modal.style.display = 'none';
        nextBtn.onclick = null;
      };
    } finally {
      mState.isExecuting = false;
    }
  }

})();
