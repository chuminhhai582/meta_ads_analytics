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

    if (targetStep === 3) {
      initStep3Events();
      renderMatrix();
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

  // ------------------------------------------------------------------
  // BƯỚC 3 — Ma trận ghép nội dung × nhóm đích
  // ------------------------------------------------------------------
  let step3EventsBound = false;

  function initStep3Events() {
    if (step3EventsBound) return;
    step3EventsBound = true;

    const modeSel = document.getElementById('bulkPairingMode');
    modeSel?.addEventListener('change', (e) => {
      st.pairingMode = e.target.value;
      st.excludedPairs.clear();
      renderMatrix();
    });

    const patIn = document.getElementById('bulkNamePattern');
    patIn?.addEventListener('input', (e) => {
      st.namePattern = e.target.value;
      updateNamePreview();
    });
  }

  /**
   * Sinh danh sách cặp theo chế độ ghép.
   * Logic PHẢI khớp expandPairs() ở backend.
   */
  function buildPairs() {
    const targets = Array.from(st.selectedAdsets.values());
    const contents = st.contents || [];
    const mode = st.pairingMode || 'matrix';
    const out = [];

    if (targets.length === 0) {
      return { error: 'Chưa có nhóm quảng cáo đích nào được chọn ở Bước 1.', pairs: [] };
    }
    if (contents.length === 0) {
      return { error: 'Chưa có nội dung quảng cáo nào được soạn ở Bước 2.', pairs: [] };
    }

    if (mode === 'matrix') {
      for (const c of contents) {
        for (const t of targets) {
          out.push({ content: c, target: t });
        }
      }
    } else if (mode === 'one_to_one') {
      if (contents.length !== targets.length) {
        return {
          error: `Chế độ 1-1 cần số nội dung bằng số nhóm đích (${contents.length} nội dung ≠ ${targets.length} nhóm).`,
          pairs: []
        };
      }
      for (let i = 0; i < contents.length; i++) {
        out.push({ content: contents[i], target: targets[i] });
      }
    } else if (mode === 'round_robin') {
      const n = Math.max(contents.length, targets.length);
      for (let i = 0; i < n; i++) {
        out.push({
          content: contents[i % contents.length],
          target: targets[i % targets.length]
        });
      }
    } else {
      return { error: `Chế độ ghép không hợp lệ: "${mode}".`, pairs: [] };
    }

    const pairs = out
      .filter(p => !st.excludedPairs.has(`${p.content.key}|${p.target.adsetId}`))
      .map((p, i) => ({
        ...p,
        index: i + 1,
        pairKey: `${p.content.key}|${p.target.adsetId}`
      }));

    return { error: null, pairs };
  }

  function estimateSeconds(adCount, creativeCount) {
    return Math.round((creativeCount * 1200 + adCount * 2000) / 1000);
  }

  function renderAdName(pattern, ctx = {}) {
    const tokens = {
      content: ctx.contentName || '',
      adset: ctx.adsetName || '',
      campaign: ctx.campaignName || '',
      index: ctx.index != null ? String(ctx.index) : '',
      date: ctx.date || new Date().toISOString().slice(0, 10)
    };
    const raw = String(pattern || '{content} — {adset}')
      .replace(/\{(content|adset|campaign|index|date)\}/g, (_, k) => tokens[k] || '');
    const clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return (clean || 'Quảng cáo').slice(0, 200);
  }

  function updateNamePreview() {
    const prevEl = document.getElementById('bulkNamePreview');
    if (!prevEl) return;
    const { pairs, error } = buildPairs();
    if (error || pairs.length === 0) {
      prevEl.innerHTML = `<span style="color:var(--warning-text);">${S.escapeHtml(error || '(Chưa có cặp quảng cáo nào)')}</span>`;
      return;
    }
    const sample = pairs.slice(0, 3).map(p => {
      const name = renderAdName(st.namePattern, {
        contentName: p.content.name,
        adsetName: p.target.adsetName,
        campaignName: p.target.campaignName,
        index: p.index
      });
      return `[${p.index}] ${S.escapeHtml(name)}`;
    });
    prevEl.innerHTML = sample.join('<br>') + (pairs.length > 3 ? `<br><span style="color:var(--text-muted);">...và ${pairs.length - 3} quảng cáo khác</span>` : '');
  }

  function renderMatrix() {
    const table = document.getElementById('bulkMatrixTable');
    if (!table) return;

    const targets = Array.from(st.selectedAdsets.values());
    const contents = st.contents || [];
    const mode = st.pairingMode || 'matrix';

    if (targets.length === 0 || contents.length === 0) {
      table.innerHTML = `<tbody><tr><td class="cp-empty-state">Chưa đủ dữ liệu (cần cả nhóm đích và nội dung).</td></tr></tbody>`;
      updateMatrixSummary();
      return;
    }

    if (mode === 'matrix') {
      renderFullMatrix(table, contents, targets);
    } else {
      renderListPairs(table, contents, targets, mode);
    }

    updateMatrixSummary();
    updateNamePreview();
  }

  function renderFullMatrix(table, contents, targets) {
    let thead = `<thead class="bulk-matrix-head"><tr>
      <th style="min-width:200px;text-align:left;">Nội dung \\ Nhóm đích</th>`;
    targets.forEach(t => {
      thead += `
        <th title="${S.escapeHtml(t.campaignName)}">
          <div style="font-size:0.82rem;font-weight:700;">${S.escapeHtml(t.adsetName)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${S.escapeHtml(t.campaignName)}</div>
        </th>`;
    });
    thead += `</tr></thead>`;

    let tbody = `<tbody>`;
    contents.forEach(c => {
      tbody += `<tr>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-subtle);border-right:1px solid var(--border-subtle);background:var(--bg-card);">
          <strong>${S.escapeHtml(c.name || 'QC')}</strong>
          <div style="font-size:0.72rem;color:var(--text-muted);">${S.escapeHtml(c.ctaType || 'SEND_MESSAGE')}</div>
        </td>`;
      targets.forEach(t => {
        const pairKey = `${c.key}|${t.adsetId}`;
        const isOff = st.excludedPairs.has(pairKey);
        tbody += `
          <td class="bulk-matrix-cell ${isOff ? 'bulk-matrix-cell--off' : ''}" data-pair-key="${pairKey}" title="Bấm để bật/tắt quảng cáo này">
            ${isOff ? '✕' : '✓'}
          </td>`;
      });
      tbody += `</tr>`;
    });
    tbody += `</tbody>`;

    table.innerHTML = thead + tbody;

    table.querySelectorAll('.bulk-matrix-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const key = cell.dataset.pairKey;
        if (st.excludedPairs.has(key)) {
          st.excludedPairs.delete(key);
          cell.classList.remove('bulk-matrix-cell--off');
          cell.textContent = '✓';
        } else {
          st.excludedPairs.add(key);
          cell.classList.add('bulk-matrix-cell--off');
          cell.textContent = '✕';
        }
        updateMatrixSummary();
        updateNamePreview();
      });
    });
  }

  function renderListPairs(table, contents, targets, mode) {
    const { pairs, error } = buildPairs();
    if (error) {
      table.innerHTML = `<tbody><tr><td class="cp-empty-state cp-text-danger">${S.escapeHtml(error)}</td></tr></tbody>`;
      return;
    }

    let html = `
      <thead class="bulk-matrix-head">
        <tr>
          <th style="width:40px;">#</th>
          <th>Nội dung</th>
          <th>Nhóm đích &amp; Chiến dịch</th>
          <th>Tên Ad dự kiến</th>
          <th style="width:70px;">Bật/Tắt</th>
        </tr>
      </thead>
      <tbody>`;

    pairs.forEach(p => {
      const isOff = st.excludedPairs.has(p.pairKey);
      const adName = renderAdName(st.namePattern, {
        contentName: p.content.name,
        adsetName: p.target.adsetName,
        campaignName: p.target.campaignName,
        index: p.index
      });
      html += `
        <tr>
          <td style="text-align:center;color:var(--text-muted);">${p.index}</td>
          <td><strong>${S.escapeHtml(p.content.name)}</strong></td>
          <td>
            <div>${S.escapeHtml(p.target.adsetName)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${S.escapeHtml(p.target.campaignName)}</div>
          </td>
          <td style="font-family:monospace;font-size:0.8rem;">${S.escapeHtml(adName)}</td>
          <td class="bulk-matrix-cell ${isOff ? 'bulk-matrix-cell--off' : ''}" data-pair-key="${p.pairKey}" style="text-align:center;">
            ${isOff ? '✕' : '✓'}
          </td>
        </tr>`;
    });
    html += `</tbody>`;
    table.innerHTML = html;

    table.querySelectorAll('.bulk-matrix-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const key = cell.dataset.pairKey;
        if (st.excludedPairs.has(key)) {
          st.excludedPairs.delete(key);
          cell.classList.remove('bulk-matrix-cell--off');
          cell.textContent = '✓';
        } else {
          st.excludedPairs.add(key);
          cell.classList.add('bulk-matrix-cell--off');
          cell.textContent = '✕';
        }
        updateMatrixSummary();
        updateNamePreview();
      });
    });
  }

  function updateMatrixSummary() {
    const sumEl = document.getElementById('bulkMatrixSummary');
    const badgeEl = document.getElementById('bulkMatrixBadge');
    const warnEl = document.getElementById('bulkMatrixWarn');
    const nextBtn = document.getElementById('bulkNextBtn');
    if (!sumEl) return;

    const { pairs, error } = buildPairs();
    const adCount = pairs.length;
    const creativeCount = new Set(pairs.map(p => `${p.target.pageId || 'p'}|${p.content.key}`)).size;
    const etaSec = estimateSeconds(adCount, creativeCount);
    const etaMin = (etaSec / 60).toFixed(1);

    if (badgeEl) badgeEl.textContent = `${adCount} quảng cáo`;

    sumEl.innerHTML = `Sẽ tạo <strong>${adCount}</strong> quảng cáo · ` +
      `<strong>${creativeCount}</strong> creative mới · ước tính ≈ <strong>${etaSec >= 60 ? `${etaMin} phút` : `${etaSec} giây`}</strong>`;

    const warnings = [];

    if (error) {
      warnings.push(`<div class="cp-empty-state cp-text-danger">${S.escapeHtml(error)}</div>`);
    }

    if (adCount === 0) {
      warnings.push('<div class="bulk-notice-draft cp-text-danger"><i data-lucide="alert-triangle"></i><span>Chưa có cặp quảng cáo nào được chọn.</span></div>');
    }

    if (adCount > LIMITS.MAX_ADS) {
      warnings.push(
        `<div class="bulk-notice-draft cp-text-danger"><i data-lucide="alert-triangle"></i>` +
        `<span><strong>Vượt trần an toàn:</strong> Đang chọn ${adCount} quảng cáo — tối đa ${LIMITS.MAX_ADS}. Hãy loại trừ bớt ô hoặc giảm nội dung/nhóm đích.</span></div>`
      );
    }

    if (etaSec > 300) {
      warnings.push(
        `<div class="bulk-notice-draft" style="border-color:var(--warning);background:rgba(245, 158, 11, 0.1);"><i data-lucide="clock" style="color:var(--warning-text);"></i>` +
        `<span>Ước tính đợt chạy mất hơn <strong>${etaMin} phút</strong>. Đừng tắt trình duyệt hoặc tắt server trong lúc thực thi.</span></div>`
      );
    }

    // Kiểm tra nhóm thiếu Fanpage
    const missingPageAdsets = Array.from(st.selectedAdsets.values()).filter(t => !t.pageId);
    if (missingPageAdsets.length > 0) {
      warnings.push(
        `<div class="bulk-notice-draft"><i data-lucide="info"></i>` +
        `<span>Có <strong>${missingPageAdsets.length}</strong> nhóm chưa rõ Fanpage — hệ thống sẽ tự động dùng Fanpage đầu tiên của tài khoản.</span></div>`
      );
    }

    if (warnEl) {
      if (warnings.length > 0) {
        warnEl.innerHTML = warnings.join('');
        warnEl.style.display = 'block';
        S.refreshIcons();
      } else {
        warnEl.innerHTML = '';
        warnEl.style.display = 'none';
      }
    }

    if (nextBtn && st.step === 3) {
      nextBtn.disabled = Boolean(error || adCount === 0 || adCount > LIMITS.MAX_ADS);
    }
  }

  // ------------------------------------------------------------------
  // BƯỚC 4 — Thực thi & Poll Job
  // ------------------------------------------------------------------

  function confirmExecute(adCount, etaSeconds) {
    const min = Math.ceil(etaSeconds / 60);
    const typed = prompt(
      `Sắp tạo ${adCount} quảng cáo THẬT trên Meta (tất cả PAUSED).\n` +
      `Ước tính ≈ ${min} phút.\n\n` +
      `Gõ đúng số ${adCount} để xác nhận:`
    );
    return String(typed || '').trim() === String(adCount);
  }

  async function executeBulk() {
    if (st.isExecuting) return;

    const { pairs, error } = buildPairs();
    if (error) {
      alert(error);
      return;
    }
    if (pairs.length === 0) {
      alert('Chưa có quảng cáo nào để tạo.');
      return;
    }
    if (pairs.length > LIMITS.MAX_ADS) {
      alert(`Vượt trần an toàn ${LIMITS.MAX_ADS} quảng cáo (đang chọn ${pairs.length}).`);
      return;
    }

    const creativeCount = new Set(pairs.map(p => `${p.target.pageId || 'p'}|${p.content.key}`)).size;
    const etaSec = estimateSeconds(pairs.length, creativeCount);

    if (!confirmExecute(pairs.length, etaSec)) {
      return;
    }

    st.isExecuting = true;
    st.planId = crypto.randomUUID ? crypto.randomUUID() : ('plan_' + Math.random().toString(36).slice(2, 9));
    goToStep(4);

    const execBtn = document.getElementById('bulkExecuteBtn');
    if (execBtn) execBtn.disabled = true;

    const phaseText = document.getElementById('bulkPhaseText');
    const badge = document.getElementById('bulkJobStatusBadge');
    if (phaseText) phaseText.textContent = 'Đang gửi kế hoạch tạo quảng cáo tới server...';
    if (badge) {
      badge.textContent = 'Đang chạy';
      badge.className = 'badge';
    }

    const logBox = document.getElementById('bulkExecLog');
    if (logBox) logBox.innerHTML = '<div style="color:var(--primary);">Khởi tạo đợt chạy...</div>';

    try {
      const data = await S.apiPost('/api/cp/build-structure', {
        planId: st.planId,
        accountId: st.accountId,
        campaigns: [],                 // tab 3 KHÔNG tạo chiến dịch mới
        adsets: [],                    // tab 3 KHÔNG tạo nhóm mới
        existingTargets: Array.from(st.selectedAdsets.values()),
        contents: st.contents,
        pairingMode: st.pairingMode,
        namePattern: st.namePattern,
        excludedPairs: Array.from(st.excludedPairs)
      });

      st.jobId = data.jobId;
      const jobIdText = document.getElementById('bulkJobIdText');
      if (jobIdText) jobIdText.textContent = data.jobId;

      const csvBtn = document.getElementById('bulkDownloadCsvBtn');
      if (csvBtn) csvBtn.href = `/api/cp/job/${data.jobId}/csv`;

      pollJob(data.jobId);
    } catch (err) {
      st.isExecuting = false;
      if (phaseText) phaseText.textContent = `Lỗi: ${err.message}`;
      if (badge) {
        badge.textContent = 'Lỗi';
        badge.className = 'badge';
      }
      if (logBox) logBox.innerHTML += `<div class="cp-log-row cp-log-row--error">Lỗi khởi tạo: ${S.escapeHtml(err.message)}</div>`;
    }
  }

  function pollJob(jobId) {
    if (st.polling) clearInterval(st.polling);

    st.polling = setInterval(async () => {
      try {
        const j = await S.apiGet(`/api/cp/job/${jobId}`);
        renderProgress(j);
        renderLogs(j.logs || []);

        if (j.status === 'done' || j.status === 'error') {
          clearInterval(st.polling);
          st.polling = null;
          st.isExecuting = false;
          renderResultTable(j);
        }
      } catch (err) {
        renderLogs([{
          at: new Date().toISOString(),
          level: 'warn',
          msg: `Mất kết nối thăm dò (${err.message}) — đang thử lại...`
        }]);
      }
    }, 2000);
  }

  function renderProgress(job) {
    const total = job.total || 1;
    const done = job.done || 0;
    const pct = Math.min(100, Math.round((done / total) * 100));

    const fill = document.getElementById('bulkProgressFill');
    if (fill) fill.style.width = `${pct}%`;

    const txt = document.getElementById('bulkProgressText');
    if (txt) txt.textContent = `${done} / ${total} đối tượng (${pct}%)`;

    const phase = document.getElementById('bulkPhaseText');
    if (phase) {
      if (job.status === 'done') {
        phase.textContent = '✓ Hoàn tất đợt tạo quảng cáo!';
        phase.style.color = 'var(--success-text)';
      } else if (job.status === 'error') {
        phase.textContent = `✕ Có lỗi xảy ra: ${job.error || 'Dừng đợt chạy'}`;
        phase.style.color = 'var(--danger-text)';
      } else {
        const phaseNames = {
          campaigns: 'Đang tạo Chiến dịch mới...',
          adsets: 'Đang tạo Nhóm quảng cáo mới...',
          ads: 'Đang tạo Quảng cáo mới...'
        };
        phase.textContent = phaseNames[job.phase] || `Đang xử lý (${job.phase || '...'})...`;
        phase.style.color = 'var(--text-primary)';
      }
    }

    const badge = document.getElementById('bulkJobStatusBadge');
    if (badge) {
      if (job.status === 'done') {
        badge.textContent = 'Hoàn thành';
      } else if (job.status === 'error') {
        badge.textContent = 'Thất bại';
      } else {
        badge.textContent = `Đang chạy (${pct}%)`;
      }
    }
  }

  function renderLogs(logs = []) {
    const box = document.getElementById('bulkExecLog');
    if (!box) return;
    box.innerHTML = logs.map(l => {
      const cls = l.level === 'error' ? 'cp-log-row--error' : (l.level === 'warn' ? 'cp-log-row--warn' : 'cp-log-row--success');
      const time = l.at ? new Date(l.at).toLocaleTimeString('vi-VN') : '';
      return `<div class="cp-log-row ${cls}">[${time}] ${S.escapeHtml(l.msg)}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderResultTable(job) {
    const resSec = document.getElementById('bulkResultSection');
    const table = document.getElementById('bulkResultTable');
    if (resSec) resSec.style.display = 'block';
    if (!table) return;

    const ads = job.created?.ads || [];
    if (ads.length === 0) {
      table.innerHTML = `<tbody><tr><td class="cp-empty-state">Không có quảng cáo nào được tạo.</td></tr></tbody>`;
      return;
    }

    let html = `
      <thead class="bulk-matrix-head">
        <tr>
          <th style="width:40px;">#</th>
          <th>Chiến dịch</th>
          <th>Nhóm quảng cáo</th>
          <th>Tên Quảng cáo</th>
          <th>Ad ID</th>
          <th>Creative ID</th>
          <th>Trạng thái</th>
          <th>Chi tiết</th>
        </tr>
      </thead>
      <tbody>`;

    let failedCount = 0;
    ads.forEach((a, i) => {
      if (!a.success) failedCount++;
      html += `
        <tr>
          <td style="text-align:center;color:var(--text-muted);">${i + 1}</td>
          <td>${S.escapeHtml(a.campaignName || a.campaignId || '')}</td>
          <td>${S.escapeHtml(a.adsetName || a.adsetId || '')}</td>
          <td><strong>${S.escapeHtml(a.adName || a.contentName || 'QC')}</strong></td>
          <td>${a.adId ? `<code>${a.adId}</code>` : '<span style="color:var(--text-muted);">-</span>'}</td>
          <td>${a.creativeId ? `<code>${a.creativeId}</code>` : '<span style="color:var(--text-muted);">-</span>'}</td>
          <td>
            ${a.success
              ? '<span class="bulk-chip bulk-chip--draft" style="background:rgba(16, 185, 129, 0.2);color:var(--success-text);">PAUSED</span>'
              : (a.skipped
                  ? '<span class="bulk-chip bulk-chip--warn">Bỏ qua</span>'
                  : '<span class="bulk-chip" style="background:rgba(239, 68, 68, 0.2);color:var(--danger-text);">Lỗi</span>')}
          </td>
          <td style="font-size:0.75rem;color:${a.error ? 'var(--danger-text)' : 'var(--text-muted)'};">
            ${S.escapeHtml(a.error || (a.success ? 'Thành công (PAUSED)' : ''))}
          </td>
        </tr>`;
    });
    html += `</tbody>`;
    table.innerHTML = html;

    const retryBtn = document.getElementById('bulkRetryFailedBtn');
    if (retryBtn) {
      retryBtn.style.display = failedCount > 0 ? 'inline-flex' : 'none';
      retryBtn.onclick = () => retryFailed(job);
    }

    S.refreshIcons();
  }

  function retryFailed(job) {
    const failedAds = (job.created?.ads || []).filter(a => !a.success && a.pairKey);
    if (failedAds.length === 0) {
      alert('Không có quảng cáo nào bị lỗi để thử lại.');
      return;
    }
    const failedPairKeys = new Set(failedAds.map(a => a.pairKey));
    const { pairs } = buildPairs();
    st.excludedPairs.clear();
    pairs.forEach(p => {
      if (!failedPairKeys.has(p.pairKey)) {
        st.excludedPairs.add(p.pairKey);
      }
    });

    goToStep(3);
    renderMatrix();
    alert(`Đã chuẩn bị thử lại cho ${failedAds.length} quảng cáo bị lỗi. Vui lòng bấm Thực thi để chạy.`);
  }

  return {
    init,
    getState: () => st,
    goToStep,
    execute: executeBulk
  };
})();
