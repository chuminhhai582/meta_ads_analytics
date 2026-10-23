/**
 * Tiện ích dùng chung cho cả 3 tab của Cross-Post Manager.
 * Tách khỏi cross-post-app.js ngày 23/10/2026 khi file đó đạt 1712 dòng —
 * tab 3 và phần nâng cấp tab 2 cần dùng lại đúng các hàm này.
 */
window.CPShared = (function () {
  'use strict';

  let sessionToken = '';
  let pages = [];
  let adAccounts = [];
  const readyWaiters = [];
  let isReady = false;

  async function bootstrap() {
    if (isReady) return;
    try {
      const r = await fetch('/api/session');
      if (r.ok) sessionToken = (await r.json()).token || '';
    } catch (e) {
      console.warn('[CPShared] Không lấy được session token:', e);
    }
    isReady = true;
    readyWaiters.splice(0).forEach(fn => fn());
  }

  function onReady(fn) {
    if (isReady) fn();
    else readyWaiters.push(fn);
  }

  function getToken() { return sessionToken; }
  function setPages(p) { pages = p || []; }
  function getPages() { return pages; }
  function setAdAccounts(a) { adAccounts = a || []; }
  function getAdAccounts() { return adAccounts; }

  /** fetch có kèm X-Internal-Token cho mọi request GHI */
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': sessionToken },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);
    return data;
  }

  async function apiGet(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);
    return data;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

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

  function formatNum(num) {
    return Number(num || 0).toLocaleString('vi-VN');
  }

  const CTA_SUGGESTIONS = [
    'SEND_MESSAGE', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE', 'LEARN_MORE', 'SIGN_UP',
    'APPLY_NOW', 'CONTACT_US', 'CALL_NOW', 'GET_QUOTE', 'GET_OFFER',
    'SUBSCRIBE', 'BOOK_TRAVEL', 'SHOP_NOW', 'DOWNLOAD', 'NO_BUTTON'
  ];

  const HOOK_LIBRARY = {
    ucmas:  ['Con tính nhẩm chậm hơn bạn cùng lớp?', 'Bé 6 tuổi nhân 3 chữ số trong 5 giây — bằng cách nào?'],
    uckid:  ['Bé vào lớp 1 mà chưa ngồi yên được 10 phút?', 'Giai đoạn vàng 4-6 tuổi trôi qua rất nhanh'],
    mathca: ['Con sợ môn Toán từ lớp mấy?', 'Giải toán bằng tư duy, không học thuộc mẹo'],
    traihe: ['Hè này con ở nhà với điện thoại?', 'Trại hè không chỉ để chơi']
  };

  /**
   * Bung spintax phía client: "Con {chưa tập trung|học mãi không vào}?"
   */
  function expandSpintax(text, max = 6) {
    const src = String(text || '');
    const PAT = /\{([^{}]*)\}/;
    if (!PAT.test(src)) return [src];

    const expandOnce = (s) => {
      const m = PAT.exec(s);
      if (!m) return [s];
      const head = s.slice(0, m.index);
      const tail = s.slice(m.index + m[0].length);
      const opts = m[1].split('|');
      return opts.map(o => head + o.trim() + tail);
    };

    let frontier = [src];
    let guard = 0;
    while (frontier.some(s => PAT.test(s)) && guard++ < 12) {
      frontier = frontier.flatMap(expandOnce);
      if (frontier.length > 200) break;
    }

    const out = [];
    for (const s of frontier) {
      const v = s.replace(/\s{2,}/g, ' ').trim();
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= max) break;
    }
    return out.length > 0 ? out : [src];
  }

  /**
   * Upload ảnh qua /api/cp/upload-ad-image lấy image_hash
   */
  async function uploadImage(file, accountId) {
    const MAX = 8 * 1024 * 1024;
    if (!file) throw new Error('Chưa chọn tệp ảnh.');
    if (!/^image\/(jpeg|png)$/i.test(file.type)) throw new Error('Chỉ nhận ảnh JPEG hoặc PNG.');
    if (file.size > MAX) throw new Error(`Ảnh ${(file.size / 1048576).toFixed(1)} MB — vượt 8 MB.`);
    const acc = String(accountId || '').replace(/^act_/, '').trim();
    if (!acc) throw new Error('Hãy chọn Tài khoản quảng cáo trước khi tải ảnh.');

    const dataBase64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.readAsDataURL(file);
    });

    const data = await apiPost('/api/cp/upload-ad-image', {
      accountId: acc,
      fileName: file.name,
      dataBase64
    });
    return { imageHash: data.imageHash, url: data.url, cached: data.cached };
  }

  /**
   * ContentEditor — module soạn nội dung quảng cáo dùng chung 2 tab
   */
  const ContentEditor = {
    mount({ containerId, max = 12, accountId, pages, onChange }) {
      const container = document.getElementById(containerId);
      if (!container) throw new Error(`ContentEditor: container #${containerId} không tồn tại.`);

      let cards = [
        {
          id: 'card_' + Math.random().toString(36).slice(2, 9),
          key: 'c1',
          name: 'QC 01',
          type: 'custom',
          message: 'Chương trình học trải nghiệm giúp bé phát triển tư duy toàn diện. Inbox ngay để nhận ưu đãi đặc biệt!',
          headline: 'Ưu Đãi Tuyển Sinh Đăng Ký Hôm Nay',
          description: 'Nhận ưu đãi tuyển sinh',
          ctaType: 'SEND_MESSAGE',
          ctaCustom: '',
          linkUrl: '',
          imageHash: '',
          imageUrl: '',
          videoId: '',
          fileName: '',
          sourcePostId: '',
          sourceAdId: ''
        }
      ];

      let activeSubTab = 'custom'; // custom | posts | clone_ads | library
      let postsList = [];
      let cloneAdsList = [];

      function getAccId() {
        return typeof accountId === 'function' ? accountId() : accountId;
      }

      function getPagesList() {
        return typeof pages === 'function' ? pages() : (pages || getPages());
      }

      function notify() {
        if (typeof onChange === 'function') {
          onChange(getContents());
        }
      }

      function getContents() {
        return cards.map((c, i) => {
          let cta = c.ctaType;
          if (cta === '__custom__') {
            cta = (c.ctaCustom || '').trim() || 'SEND_MESSAGE';
          }
          return {
            key: c.key || `c${i + 1}`,
            name: (c.name || `Nội dung ${i + 1}`).trim(),
            type: c.type || 'custom',
            message: c.message || '',
            headline: c.headline || '',
            description: c.description || '',
            ctaType: cta,
            linkUrl: (c.linkUrl || '').trim(),
            imageHash: c.imageHash || '',
            imageUrl: c.imageUrl || '',
            videoId: c.videoId || '',
            sourcePostId: c.sourcePostId || '',
            sourceAdId: c.sourceAdId || ''
          };
        });
      }

      function setContents(items) {
        if (!Array.isArray(items) || items.length === 0) return;
        cards = items.map((it, idx) => ({
          id: 'card_' + Math.random().toString(36).slice(2, 9),
          key: it.key || `c${idx + 1}`,
          name: it.name || `Nội dung ${idx + 1}`,
          type: it.type || 'custom',
          message: it.message || '',
          headline: it.headline || '',
          description: it.description || '',
          ctaType: CTA_SUGGESTIONS.includes(it.ctaType) ? it.ctaType : (it.ctaType ? '__custom__' : 'SEND_MESSAGE'),
          ctaCustom: CTA_SUGGESTIONS.includes(it.ctaType) ? '' : (it.ctaType || ''),
          linkUrl: it.linkUrl || '',
          imageHash: it.imageHash || '',
          imageUrl: it.imageUrl || '',
          videoId: it.videoId || '',
          fileName: it.fileName || '',
          sourcePostId: it.sourcePostId || '',
          sourceAdId: it.sourceAdId || ''
        }));
        render();
        notify();
      }

      function render() {
        container.innerHTML = `
          <div class="cpc-container">
            <!-- 4 Sub-Tabs -->
            <div class="cpc-subtabs">
              <button type="button" class="cpc-subtab-btn ${activeSubTab === 'custom' ? 'active' : ''}" data-cpc-tab="custom">
                <i data-lucide="edit-3"></i><span>Soạn mới</span>
              </button>
              <button type="button" class="cpc-subtab-btn ${activeSubTab === 'posts' ? 'active' : ''}" data-cpc-tab="posts">
                <i data-lucide="share-2"></i><span>Từ bài Fanpage</span>
              </button>
              <button type="button" class="cpc-subtab-btn ${activeSubTab === 'clone_ads' ? 'active' : ''}" data-cpc-tab="clone_ads">
                <i data-lucide="copy"></i><span>Từ Ads mẫu</span>
              </button>
              <button type="button" class="cpc-subtab-btn ${activeSubTab === 'library' ? 'active' : ''}" data-cpc-tab="library">
                <i data-lucide="bookmark"></i><span>Thư viện nội dung</span>
              </button>
            </div>

            <!-- Toolbar -->
            <div class="cpc-toolbar">
              <div class="cpc-badge">
                Đang có <strong id="cpcCountText">${cards.length}</strong> / <strong>${max}</strong> nội dung
              </div>
              <div class="cpc-toolbar-actions">
                ${activeSubTab === 'custom' ? `
                  <button type="button" class="btn btn-secondary btn-sm" id="cpcBtnSpintax">
                    <i data-lucide="wand-2"></i><span>Tạo biến thể (Spintax / Hook)</span>
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" id="cpcBtnSaveLib">
                    <i data-lucide="save"></i><span>Lưu vào Thư viện</span>
                  </button>
                  <button type="button" class="btn btn-primary btn-sm" id="cpcBtnAddCard" ${cards.length >= max ? 'disabled' : ''}>
                    <i data-lucide="plus"></i><span>Thêm thẻ nội dung</span>
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Tab Content View -->
            <div id="cpcSubTabContent"></div>
          </div>
        `;

        // Render subtab view
        const subView = container.querySelector('#cpcSubTabContent');
        if (activeSubTab === 'custom') {
          renderCustomTab(subView);
        } else if (activeSubTab === 'posts') {
          renderPostsTab(subView);
        } else if (activeSubTab === 'clone_ads') {
          renderCloneAdsTab(subView);
        } else if (activeSubTab === 'library') {
          renderLibraryTab(subView);
        }

        bindTabEvents();
        refreshIcons();
      }

      function bindTabEvents() {
        container.querySelectorAll('.cpc-subtab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            activeSubTab = btn.dataset.cpcTab;
            render();
          });
        });

        const btnAdd = container.querySelector('#cpcBtnAddCard');
        btnAdd?.addEventListener('click', () => {
          if (cards.length >= max) {
            alert(`Tối đa ${max} nội dung.`);
            return;
          }
          const idx = cards.length + 1;
          cards.push({
            id: 'card_' + Math.random().toString(36).slice(2, 9),
            key: `c${idx}`,
            name: `QC ${idx < 10 ? '0' + idx : idx}`,
            type: 'custom',
            message: '',
            headline: '',
            description: '',
            ctaType: 'SEND_MESSAGE',
            ctaCustom: '',
            linkUrl: '',
            imageHash: '',
            imageUrl: '',
            videoId: '',
            fileName: '',
            sourcePostId: '',
            sourceAdId: ''
          });
          render();
          notify();
        });

        const btnSaveLib = container.querySelector('#cpcBtnSaveLib');
        btnSaveLib?.addEventListener('click', async () => {
          if (cards.length === 0) {
            alert('Chưa có nội dung nào để lưu.');
            return;
          }
          try {
            btnSaveLib.disabled = true;
            btnSaveLib.innerHTML = '<span class="cp-spinner"></span> Đang lưu...';
            const data = await apiPost('/api/cp/content-library', { items: getContents() });
            alert(`Đã lưu ${data.saved || cards.length} nội dung vào Thư viện thành công!`);
          } catch (e) {
            alert(`Lỗi lưu thư viện: ${e.message}`);
          } finally {
            btnSaveLib.disabled = false;
            btnSaveLib.innerHTML = '<i data-lucide="save"></i><span>Lưu vào Thư viện</span>';
            refreshIcons();
          }
        });

        const btnSpintax = container.querySelector('#cpcBtnSpintax');
        btnSpintax?.addEventListener('click', openSpintaxModal);
      }

      // ================================================================
      // Tab 1: Soạn mới
      // ================================================================
      function renderCustomTab(viewEl) {
        viewEl.innerHTML = `<div class="cpc-cards-list" id="cpcCardsList"></div>`;
        const listEl = viewEl.querySelector('#cpcCardsList');

        cards.forEach((card, index) => {
          const cardEl = document.createElement('div');
          cardEl.className = 'cpc-card';
          cardEl.id = `cpcCard-${card.id}`;

          const isOverMsg = (card.message || '').length > 125;
          const isOverHead = (card.headline || '').length > 40;
          const isOverDesc = (card.description || '').length > 30;

          const isCustomCta = card.ctaType === '__custom__';
          const ctaVal = isCustomCta ? (card.ctaCustom || '') : card.ctaType;
          const ctaRegexValid = !isCustomCta || /^[A-Z_]{3,40}$/.test(ctaVal);

          let ctaOptions = CTA_SUGGESTIONS.map(cta =>
            `<option value="${cta}" ${card.ctaType === cta ? 'selected' : ''}>${cta}</option>`
          ).join('');
          ctaOptions += `<option value="__custom__" ${isCustomCta ? 'selected' : ''}>-- Tự nhập CTA khác --</option>`;

          cardEl.innerHTML = `
            <div class="cpc-card-header">
              <div class="cpc-card-title">
                <i data-lucide="file-text" style="width:16px;height:16px;color:var(--primary);"></i>
                <span>Nội dung #${index + 1} (${card.type === 'page_post' ? 'Bài Fanpage' : (card.type === 'clone_ad' ? 'Ads mẫu' : 'Soạn mới')})</span>
              </div>
              <div class="cpc-card-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="cpcDup-${card.id}" title="Nhân bản thẻ này" ${cards.length >= max ? 'disabled' : ''}>
                  <i data-lucide="copy"></i><span>Nhân bản</span>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="cpcDel-${card.id}" title="Xoá thẻ này" ${cards.length <= 1 ? 'disabled' : ''}>
                  <i data-lucide="trash-2"></i><span>Xoá</span>
                </button>
              </div>
            </div>

            <div class="cpc-form-grid">
              <div class="cp-form-group cpc-field-full">
                <label for="cpcName-${card.id}" class="cp-form-label">
                  Tên nội bộ <span class="cp-label-hint">(dùng cho biến {content} trong tên quảng cáo)</span>
                </label>
                <input type="text" id="cpcName-${card.id}" class="cp-input" value="${escapeHtml(card.name)}" placeholder="VD: QC01 - Ưu đãi tuyển sinh">
              </div>

              <div class="cp-form-group cpc-field-full">
                <label for="cpcMessage-${card.id}" class="cp-form-label">
                  Văn bản chính (Primary Text) <span class="cp-label-hint">(khuyến nghị ≤ 125 ký tự)</span>
                </label>
                <textarea id="cpcMessage-${card.id}" class="cp-textarea" rows="3" placeholder="Nhập thông điệp quảng cáo...">${escapeHtml(card.message)}</textarea>
                <div class="cp-char-counter ${isOverMsg ? 'cp-char-counter--over' : ''}" id="cpcMsgCountBox-${card.id}">
                  <span id="cpcMsgCount-${card.id}">${(card.message || '').length}</span>/125 ký tự khuyến nghị
                </div>
              </div>

              <div class="cp-form-group">
                <label for="cpcHeadline-${card.id}" class="cp-form-label">
                  Tiêu đề (Headline) <span class="cp-label-hint">(khuyến nghị ≤ 40 ký tự)</span>
                </label>
                <input type="text" id="cpcHeadline-${card.id}" class="cp-input" value="${escapeHtml(card.headline)}" placeholder="VD: Đăng ký ngay hôm nay">
                <div class="cp-char-counter ${isOverHead ? 'cp-char-counter--over' : ''}" id="cpcHeadCountBox-${card.id}">
                  <span id="cpcHeadCount-${card.id}">${(card.headline || '').length}</span>/40 ký tự
                </div>
              </div>

              <div class="cp-form-group">
                <label for="cpcDesc-${card.id}" class="cp-form-label">
                  Mô tả phụ (Description) <span class="cp-label-hint">(khuyến nghị ≤ 30 ký tự)</span>
                </label>
                <input type="text" id="cpcDesc-${card.id}" class="cp-input" value="${escapeHtml(card.description)}" placeholder="VD: Ưu đãi 30% học phí">
                <div class="cp-char-counter ${isOverDesc ? 'cp-char-counter--over' : ''}" id="cpcDescCountBox-${card.id}">
                  <span id="cpcDescCount-${card.id}">${(card.description || '').length}</span>/30 ký tự
                </div>
              </div>

              <div class="cp-form-group">
                <label for="cpcCta-${card.id}" class="cp-form-label">Nút kêu gọi hành động (CTA)</label>
                <select id="cpcCta-${card.id}" class="select-filter cp-w-full">
                  ${ctaOptions}
                </select>
                <div id="cpcCtaCustomBox-${card.id}" class="cpc-cta-custom-input" style="${isCustomCta ? 'display:block;' : 'display:none;'}">
                  <input type="text" id="cpcCtaCustom-${card.id}" class="cp-input" value="${escapeHtml(card.ctaCustom || '')}" placeholder="VD: SEND_MESSAGE, CONTACT_US">
                  <div class="cpc-cta-error" id="cpcCtaError-${card.id}" style="${ctaRegexValid ? 'display:none;' : 'display:block;'}">
                    CTA không hợp lệ (cần chữ IN HOA và _, từ 3–40 ký tự).
                  </div>
                </div>
              </div>

              <div class="cp-form-group">
                <label for="cpcLink-${card.id}" class="cp-form-label">
                  Liên kết đích (Link URL) <span class="cp-label-hint">(để trống tự dùng m.me/Fanpage)</span>
                </label>
                <input type="url" id="cpcLink-${card.id}" class="cp-input" value="${escapeHtml(card.linkUrl)}" placeholder="https://m.me/...">
              </div>

              <!-- Media Upload & Video -->
              <div class="cp-form-group cpc-field-full">
                <label class="cp-form-label">Hình ảnh hoặc Video quảng cáo</label>
                <div class="cpc-dropzone" id="cpcDrop-${card.id}">
                  <i data-lucide="image" class="cpc-dropzone-icon"></i>
                  <div>
                    <strong>Kéo thả ảnh vào đây</strong> hoặc <span style="color:var(--primary);text-decoration:underline;">chọn từ máy tính</span>
                  </div>
                  <span style="font-size:0.75rem;color:var(--text-muted);">(Chấp nhận JPEG, PNG tối đa 8 MB)</span>
                  <input type="file" id="cpcFileInput-${card.id}" accept="image/jpeg,image/png" style="display:none;">
                </div>

                <div id="cpcPreviewBox-${card.id}" class="cpc-preview-row" style="${(card.imageUrl || card.imageHash) ? 'display:flex;' : 'display:none;'}">
                  <img src="${card.imageUrl || ''}" id="cpcThumbImg-${card.id}" class="cpc-thumb-img" alt="Ảnh quảng cáo" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'56\\' height=\\'56\\'%3E%3Crect width=\\'100%25\\' height=\\'100%25\\' fill=\\'%23334155\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' fill=\\'%2394a3b8\\' text-anchor=\\'middle\\' dy=\\'.3em\\' font-size=\\'10\\'%3EAnh QC%3C/text%3E%3C/svg%3E'">
                  <div class="cpc-thumb-meta">
                    <strong id="cpcFileName-${card.id}">${escapeHtml(card.fileName || 'Ảnh quảng cáo')}</strong>
                    <span id="cpcHashBadge-${card.id}" style="color:var(--success-text);">
                      ${card.imageHash ? `✓ Đã upload Meta (hash: ${card.imageHash.slice(0, 10)}...)` : 'URL ảnh'}
                    </span>
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" id="cpcClearImg-${card.id}" title="Xoá ảnh">
                    <i data-lucide="x"></i><span>Bỏ ảnh</span>
                  </button>
                </div>

                <div style="margin-top:var(--space-2);display:flex;gap:var(--space-2);align-items:center;">
                  <span style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">Hoặc Video ID:</span>
                  <input type="text" id="cpcVideo-${card.id}" class="cp-input" value="${escapeHtml(card.videoId || '')}" placeholder="VD: 1234567890123 (tùy chọn)">
                </div>
              </div>
            </div>
          `;

          // Gắn sự kiện cho card
          bindCardEvents(cardEl, card);
          listEl.appendChild(cardEl);
        });
      }

      function bindCardEvents(cardEl, card) {
        // Inputs
        const nameIn = cardEl.querySelector(`#cpcName-${card.id}`);
        nameIn?.addEventListener('input', (e) => {
          card.name = e.target.value;
          notify();
        });

        const msgIn = cardEl.querySelector(`#cpcMessage-${card.id}`);
        const msgCnt = cardEl.querySelector(`#cpcMsgCount-${card.id}`);
        const msgBox = cardEl.querySelector(`#cpcMsgCountBox-${card.id}`);
        msgIn?.addEventListener('input', (e) => {
          card.message = e.target.value;
          const len = card.message.length;
          if (msgCnt) msgCnt.textContent = len;
          if (msgBox) msgBox.classList.toggle('cp-char-counter--over', len > 125);
          notify();
        });

        const headIn = cardEl.querySelector(`#cpcHeadline-${card.id}`);
        const headCnt = cardEl.querySelector(`#cpcHeadCount-${card.id}`);
        const headBox = cardEl.querySelector(`#cpcHeadCountBox-${card.id}`);
        headIn?.addEventListener('input', (e) => {
          card.headline = e.target.value;
          const len = card.headline.length;
          if (headCnt) headCnt.textContent = len;
          if (headBox) headBox.classList.toggle('cp-char-counter--over', len > 40);
          notify();
        });

        const descIn = cardEl.querySelector(`#cpcDesc-${card.id}`);
        const descCnt = cardEl.querySelector(`#cpcDescCount-${card.id}`);
        const descBox = cardEl.querySelector(`#cpcDescCountBox-${card.id}`);
        descIn?.addEventListener('input', (e) => {
          card.description = e.target.value;
          const len = card.description.length;
          if (descCnt) descCnt.textContent = len;
          if (descBox) descBox.classList.toggle('cp-char-counter--over', len > 30);
          notify();
        });

        const linkIn = cardEl.querySelector(`#cpcLink-${card.id}`);
        linkIn?.addEventListener('input', (e) => {
          card.linkUrl = e.target.value;
          notify();
        });

        const videoIn = cardEl.querySelector(`#cpcVideo-${card.id}`);
        videoIn?.addEventListener('input', (e) => {
          card.videoId = e.target.value.trim();
          notify();
        });

        // CTA
        const ctaSel = cardEl.querySelector(`#cpcCta-${card.id}`);
        const ctaCustomBox = cardEl.querySelector(`#cpcCtaCustomBox-${card.id}`);
        const ctaCustomIn = cardEl.querySelector(`#cpcCtaCustom-${card.id}`);
        const ctaErr = cardEl.querySelector(`#cpcCtaError-${card.id}`);

        ctaSel?.addEventListener('change', (e) => {
          card.ctaType = e.target.value;
          const isCust = card.ctaType === '__custom__';
          if (ctaCustomBox) ctaCustomBox.style.display = isCust ? 'block' : 'none';
          notify();
        });

        ctaCustomIn?.addEventListener('input', (e) => {
          card.ctaCustom = e.target.value.trim().toUpperCase();
          const valid = /^[A-Z_]{3,40}$/.test(card.ctaCustom);
          if (ctaErr) ctaErr.style.display = valid ? 'none' : 'block';
          notify();
        });

        // Duplicate
        const dupBtn = cardEl.querySelector(`#cpcDup-${card.id}`);
        dupBtn?.addEventListener('click', () => {
          if (cards.length >= max) {
            alert(`Tối đa ${max} nội dung.`);
            return;
          }
          const idx = cards.length + 1;
          const newCard = {
            ...card,
            id: 'card_' + Math.random().toString(36).slice(2, 9),
            key: `c${idx}`,
            name: `${card.name || 'QC'} (bản sao)`
          };
          const curIndex = cards.findIndex(c => c.id === card.id);
          cards.splice(curIndex + 1, 0, newCard);
          render();
          notify();
        });

        // Delete
        const delBtn = cardEl.querySelector(`#cpcDel-${card.id}`);
        delBtn?.addEventListener('click', () => {
          if (cards.length <= 1) {
            alert('Cần tối thiểu 1 nội dung quảng cáo.');
            return;
          }
          cards = cards.filter(c => c.id !== card.id);
          render();
          notify();
        });

        // Dropzone & Upload
        const dropzone = cardEl.querySelector(`#cpcDrop-${card.id}`);
        const fileInput = cardEl.querySelector(`#cpcFileInput-${card.id}`);
        const previewBox = cardEl.querySelector(`#cpcPreviewBox-${card.id}`);
        const thumbImg = cardEl.querySelector(`#cpcThumbImg-${card.id}`);
        const fileNameEl = cardEl.querySelector(`#cpcFileName-${card.id}`);
        const hashBadge = cardEl.querySelector(`#cpcHashBadge-${card.id}`);
        const clearImgBtn = cardEl.querySelector(`#cpcClearImg-${card.id}`);

        dropzone?.addEventListener('click', () => fileInput?.click());
        dropzone?.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('cpc-dropzone--dragover');
        });
        dropzone?.addEventListener('dragleave', () => {
          dropzone.classList.remove('cpc-dropzone--dragover');
        });
        dropzone?.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('cpc-dropzone--dragover');
          if (e.dataTransfer?.files?.[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
          }
        });

        fileInput?.addEventListener('change', (e) => {
          if (e.target.files?.[0]) {
            handleFileUpload(e.target.files[0]);
          }
        });

        clearImgBtn?.addEventListener('click', () => {
          card.imageHash = '';
          card.imageUrl = '';
          card.fileName = '';
          if (fileInput) fileInput.value = '';
          if (previewBox) previewBox.style.display = 'none';
          notify();
        });

        async function handleFileUpload(file) {
          const accId = getAccId();
          if (!accId) {
            alert('Vui lòng chọn Tài khoản quảng cáo đích ở Bước 1 trước khi tải ảnh.');
            return;
          }
          try {
            dropzone.innerHTML = `<span class="cp-spinner"></span> <span>Đang tải ảnh lên Meta (/adimages)...</span>`;
            const res = await uploadImage(file, accId);
            card.imageHash = res.imageHash;
            card.imageUrl = res.url || '';
            card.fileName = file.name;

            if (thumbImg) thumbImg.src = res.url || '';
            if (fileNameEl) fileNameEl.textContent = file.name;
            if (hashBadge) {
              hashBadge.textContent = `✓ Đã upload Meta (hash: ${res.imageHash.slice(0, 10)}...)${res.cached ? ' [cache]' : ''}`;
            }
            if (previewBox) previewBox.style.display = 'flex';
            notify();
          } catch (err) {
            alert(`Lỗi upload ảnh: ${err.message}`);
          } finally {
            dropzone.innerHTML = `
              <i data-lucide="image" class="cpc-dropzone-icon"></i>
              <div><strong>Kéo thả ảnh vào đây</strong> hoặc <span style="color:var(--primary);text-decoration:underline;">chọn từ máy tính</span></div>
              <span style="font-size:0.75rem;color:var(--text-muted);">(Chấp nhận JPEG, PNG tối đa 8 MB)</span>
              <input type="file" id="cpcFileInput-${card.id}" accept="image/jpeg,image/png" style="display:none;">
            `;
            refreshIcons();
            // Re-bind fileInput click
            const newFileInput = cardEl.querySelector(`#cpcFileInput-${card.id}`);
            newFileInput?.addEventListener('change', (e) => {
              if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
            });
          }
        }
      }

      // ================================================================
      // Tab 2: Từ bài Fanpage
      // ================================================================
      function renderPostsTab(viewEl) {
        const pagesList = getPagesList();
        viewEl.innerHTML = `
          <div class="cp-form-group">
            <label for="cpcPageSelect" class="cp-form-label">Chọn Fanpage lấy bài viết</label>
            <select id="cpcPageSelect" class="select-filter cp-w-full">
              <option value="">-- Chọn Fanpage --</option>
              ${pagesList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Chọn bài viết để chuyển thành nội dung quảng cáo:</div>
            <div style="display:flex;gap:var(--space-2);">
              <button type="button" class="btn btn-secondary btn-sm" id="cpcBtnPostSelAll">Chọn tất cả</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cpcBtnPostClear">Bỏ chọn</button>
              <button type="button" class="btn btn-primary btn-sm" id="cpcBtnPostApply">
                <i data-lucide="plus"></i><span>Thêm các bài đã chọn</span>
              </button>
            </div>
          </div>
          <div id="cpcPostsGrid" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:480px;overflow-y:auto;padding-right:4px;">
            <div class="cp-empty-state">Vui lòng chọn Fanpage ở trên để nạp bài viết.</div>
          </div>
        `;

        const pageSel = viewEl.querySelector('#cpcPageSelect');
        const postsGrid = viewEl.querySelector('#cpcPostsGrid');
        const selectedPostIds = new Set();

        pageSel?.addEventListener('change', async (e) => {
          const pageId = e.target.value;
          if (!pageId) {
            postsGrid.innerHTML = '<div class="cp-empty-state">Vui lòng chọn Fanpage.</div>';
            return;
          }
          postsGrid.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span> Đang tải bài viết...</div>';
          try {
            const data = await apiGet(`/api/cp/pages/${pageId}/posts?limit=25`);
            postsList = data.posts || [];
            selectedPostIds.clear();
            if (postsList.length === 0) {
              postsGrid.innerHTML = '<div class="cp-empty-state">Không có bài viết nào trên trang này.</div>';
              return;
            }
            renderPostsList();
          } catch (err) {
            postsGrid.innerHTML = `<div class="cp-empty-state cp-text-danger">Lỗi nạp bài: ${escapeHtml(err.message)}</div>`;
          }
        });

        function renderPostsList() {
          postsGrid.innerHTML = postsList.map(post => {
            const isChecked = selectedPostIds.has(post.id);
            const thumb = post.fullPicture
              ? `<img src="${post.fullPicture}" class="cp-post-thumb" alt="Thumb" loading="lazy">`
              : `<div class="cp-post-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">Bài viết</div>`;
            return `
              <div class="post-multi-item ${isChecked ? 'selected' : ''}" data-post-id="${post.id}" style="cursor:pointer;">
                <input type="checkbox" id="chk_cpc_post_${post.id}" ${isChecked ? 'checked' : ''} style="pointer-events:none;">
                ${thumb}
                <div class="cp-post-info">
                  <div class="cp-post-text">${escapeHtml(post.message || '(Không có văn bản)')}</div>
                  <div class="cp-post-meta">
                    <span><i data-lucide="clock" style="width:12px;height:12px;"></i> ${formatDate(post.createdTime)}</span>
                    <span><i data-lucide="thumbs-up" style="width:12px;height:12px;"></i> ${formatNum(post.reactionsCount)}</span>
                    <span><i data-lucide="message-square" style="width:12px;height:12px;"></i> ${formatNum(post.commentsCount)}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('');

          postsGrid.querySelectorAll('.post-multi-item').forEach(item => {
            item.addEventListener('click', () => {
              const pid = item.dataset.postId;
              if (selectedPostIds.has(pid)) {
                selectedPostIds.delete(pid);
                item.classList.remove('selected');
                item.querySelector('input').checked = false;
              } else {
                selectedPostIds.add(pid);
                item.classList.add('selected');
                item.querySelector('input').checked = true;
              }
            });
          });
          refreshIcons();
        }

        viewEl.querySelector('#cpcBtnPostSelAll')?.addEventListener('click', () => {
          postsList.forEach(p => selectedPostIds.add(p.id));
          renderPostsList();
        });

        viewEl.querySelector('#cpcBtnPostClear')?.addEventListener('click', () => {
          selectedPostIds.clear();
          renderPostsList();
        });

        viewEl.querySelector('#cpcBtnPostApply')?.addEventListener('click', () => {
          if (selectedPostIds.size === 0) {
            alert('Vui lòng tích chọn ít nhất 1 bài viết.');
            return;
          }
          const chosen = postsList.filter(p => selectedPostIds.has(p.id));
          if (cards.length + chosen.length > max) {
            alert(`Tổng số nội dung sẽ vượt ${max} (đang có ${cards.length} + thêm ${chosen.length}). Hãy chọn ít hơn.`);
            return;
          }

          chosen.forEach((p, i) => {
            const idx = cards.length + 1;
            cards.push({
              id: 'card_' + Math.random().toString(36).slice(2, 9),
              key: `c${idx}`,
              name: `Bài viết: ${(p.message || 'Post').slice(0, 30)}...`,
              type: 'page_post',
              message: p.message || '',
              headline: '',
              description: '',
              ctaType: 'SEND_MESSAGE',
              ctaCustom: '',
              linkUrl: '',
              imageHash: '',
              imageUrl: p.fullPicture || '',
              videoId: '',
              fileName: '',
              sourcePostId: p.id,
              sourceAdId: ''
            });
          });

          activeSubTab = 'custom';
          render();
          notify();
        });
      }

      // ================================================================
      // Tab 3: Từ Ads mẫu
      // ================================================================
      function renderCloneAdsTab(viewEl) {
        const accId = getAccId();
        viewEl.innerHTML = `
          <div class="cp-form-group">
            <label for="cpcCloneAdsetSelect" class="cp-form-label">Chọn Nhóm quảng cáo mẫu để nạp Ads</label>
            <select id="cpcCloneAdsetSelect" class="select-filter cp-w-full">
              <option value="">-- Đang tải danh sách nhóm quảng cáo... --</option>
            </select>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Chọn Ads mẫu cần nạp:</div>
            <button type="button" class="btn btn-primary btn-sm" id="cpcBtnCloneApply">
              <i data-lucide="plus"></i><span>Nạp các Ads đã chọn</span>
            </button>
          </div>
          <div id="cpcCloneAdsGrid" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:480px;overflow-y:auto;padding-right:4px;">
            <div class="cp-empty-state">Vui lòng chọn nhóm quảng cáo mẫu ở trên.</div>
          </div>
        `;

        const adsetSel = viewEl.querySelector('#cpcCloneAdsetSelect');
        const adsGrid = viewEl.querySelector('#cpcCloneAdsGrid');
        const selectedAdIds = new Set();

        if (!accId) {
          adsetSel.innerHTML = '<option value="">Hãy chọn tài khoản ở Bước 1 trước</option>';
        } else {
          loadCampaignsForAdsets();
        }

        async function loadCampaignsForAdsets() {
          try {
            const data = await apiGet(`/api/cp/ad-accounts/${accId}/campaigns?statuses=all`);
            const camps = data.campaigns || [];
            if (camps.length === 0) {
              adsetSel.innerHTML = '<option value="">Không có chiến dịch nào</option>';
              return;
            }
            const campIds = camps.slice(0, 20).map(c => c.id).join(',');
            const asData = await apiGet(`/api/cp/ad-accounts/${accId}/adsets?campaignIds=${campIds}`);
            const adsets = asData.adsets || [];
            if (adsets.length === 0) {
              adsetSel.innerHTML = '<option value="">Không tìm thấy nhóm quảng cáo nào</option>';
              return;
            }
            adsetSel.innerHTML = '<option value="">-- Chọn nhóm quảng cáo mẫu --</option>' +
              adsets.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (ID: ${a.id})</option>`).join('');
          } catch (e) {
            adsetSel.innerHTML = `<option value="">Lỗi: ${escapeHtml(e.message)}</option>`;
          }
        }

        adsetSel?.addEventListener('change', async (e) => {
          const adsetId = e.target.value;
          if (!adsetId) {
            adsGrid.innerHTML = '<div class="cp-empty-state">Vui lòng chọn nhóm quảng cáo mẫu.</div>';
            return;
          }
          adsGrid.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span> Đang nạp danh sách ads...</div>';
          try {
            const data = await apiGet(`/api/cp/adsets/${adsetId}/ads`);
            cloneAdsList = data.ads || [];
            selectedAdIds.clear();
            if (cloneAdsList.length === 0) {
              adsGrid.innerHTML = '<div class="cp-empty-state">Nhóm này chưa có quảng cáo nào.</div>';
              return;
            }
            renderCloneList();
          } catch (err) {
            adsGrid.innerHTML = `<div class="cp-empty-state cp-text-danger">Lỗi nạp ads: ${escapeHtml(err.message)}</div>`;
          }
        });

        function renderCloneList() {
          adsGrid.innerHTML = cloneAdsList.map(ad => {
            const isChecked = selectedAdIds.has(ad.id);
            const thumb = ad.creative?.image_url
              ? `<img src="${ad.creative.image_url}" class="cp-post-thumb" alt="Thumb" loading="lazy">`
              : `<div class="cp-post-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">Ad</div>`;
            return `
              <div class="post-multi-item ${isChecked ? 'selected' : ''}" data-ad-id="${ad.id}" style="cursor:pointer;">
                <input type="checkbox" id="chk_cpc_clone_${ad.id}" ${isChecked ? 'checked' : ''} style="pointer-events:none;">
                ${thumb}
                <div class="cp-post-info">
                  <div class="cp-post-text"><strong>${escapeHtml(ad.name)}</strong></div>
                  <div style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(ad.creative?.body || '(Không có nội dung)')}</div>
                </div>
              </div>
            `;
          }).join('');

          adsGrid.querySelectorAll('.post-multi-item').forEach(item => {
            item.addEventListener('click', () => {
              const aid = item.dataset.adId;
              if (selectedAdIds.has(aid)) {
                selectedAdIds.delete(aid);
                item.classList.remove('selected');
                item.querySelector('input').checked = false;
              } else {
                selectedAdIds.add(aid);
                item.classList.add('selected');
                item.querySelector('input').checked = true;
              }
            });
          });
        }

        viewEl.querySelector('#cpcBtnCloneApply')?.addEventListener('click', () => {
          if (selectedAdIds.size === 0) {
            alert('Vui lòng chọn ít nhất 1 ad mẫu.');
            return;
          }
          const chosen = cloneAdsList.filter(a => selectedAdIds.has(a.id));
          if (cards.length + chosen.length > max) {
            alert(`Tổng số nội dung sẽ vượt ${max}. Hãy chọn ít hơn.`);
            return;
          }

          chosen.forEach((a, i) => {
            const idx = cards.length + 1;
            cards.push({
              id: 'card_' + Math.random().toString(36).slice(2, 9),
              key: `c${idx}`,
              name: `Mẫu: ${a.name.slice(0, 30)}`,
              type: 'custom',
              message: a.creative?.body || '',
              headline: a.creative?.title || '',
              description: '',
              ctaType: 'SEND_MESSAGE',
              ctaCustom: '',
              linkUrl: '',
              imageHash: '',
              imageUrl: a.creative?.image_url || '',
              videoId: '',
              fileName: '',
              sourcePostId: '',
              sourceAdId: a.id
            });
          });

          activeSubTab = 'custom';
          render();
          notify();
        });
      }

      // ================================================================
      // Tab 4: Thư viện nội dung
      // ================================================================
      async function renderLibraryTab(viewEl) {
        viewEl.innerHTML = '<div class="cp-empty-state"><span class="cp-spinner"></span> Đang tải thư viện nội dung...</div>';
        try {
          const data = await apiGet('/api/cp/content-library');
          const items = data.items || [];
          if (items.length === 0) {
            viewEl.innerHTML = `
              <div class="cp-empty-state">
                Thư viện chưa có nội dung nào được lưu. Bạn có thể soạn nội dung ở tab "Soạn mới" rồi bấm "Lưu vào Thư viện".
              </div>
            `;
            return;
          }

          viewEl.innerHTML = `
            <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:var(--space-3);">
              Các nội dung đã lưu từ trước. Bấm <strong>"Sử dụng"</strong> để nạp vào danh sách đợt này:
            </div>
            <div class="cpc-library-grid" id="cpcLibGrid"></div>
          `;

          const grid = viewEl.querySelector('#cpcLibGrid');
          items.forEach(it => {
            const itemEl = document.createElement('div');
            itemEl.className = 'cpc-library-item';
            itemEl.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <strong>${escapeHtml(it.name || 'Nội dung')}</strong>
                <span class="bulk-chip">${escapeHtml(it.ctaType || 'SEND_MESSAGE')}</span>
              </div>
              <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.4;max-height:4.2em;overflow:hidden;">
                ${escapeHtml(it.message || it.headline || '(Không có văn bản)')}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:var(--space-2);border-top:1px solid var(--border-subtle);">
                <span style="font-size:0.75rem;color:var(--text-muted);">${it.savedAt ? formatDate(it.savedAt) : ''}</span>
                <button type="button" class="btn btn-primary btn-sm cpc-lib-use-btn">
                  <i data-lucide="plus"></i><span>Sử dụng</span>
                </button>
              </div>
            `;

            itemEl.querySelector('.cpc-lib-use-btn')?.addEventListener('click', () => {
              if (cards.length >= max) {
                alert(`Tối đa ${max} nội dung.`);
                return;
              }
              const idx = cards.length + 1;
              cards.push({
                id: 'card_' + Math.random().toString(36).slice(2, 9),
                key: `c${idx}`,
                name: it.name || `QC ${idx}`,
                type: 'custom',
                message: it.message || '',
                headline: it.headline || '',
                description: it.description || '',
                ctaType: CTA_SUGGESTIONS.includes(it.ctaType) ? it.ctaType : (it.ctaType ? '__custom__' : 'SEND_MESSAGE'),
                ctaCustom: CTA_SUGGESTIONS.includes(it.ctaType) ? '' : (it.ctaType || ''),
                linkUrl: it.linkUrl || '',
                imageHash: it.imageHash || '',
                imageUrl: it.imageUrl || '',
                videoId: it.videoId || '',
                fileName: '',
                sourcePostId: '',
                sourceAdId: ''
              });
              activeSubTab = 'custom';
              render();
              notify();
            });

            grid.appendChild(itemEl);
          });
          refreshIcons();
        } catch (e) {
          viewEl.innerHTML = `<div class="cp-empty-state cp-text-danger">Lỗi tải thư viện: ${escapeHtml(e.message)}</div>`;
        }
      }

      // ================================================================
      // Modal: Sinh biến thể (Spintax / Hook)
      // ================================================================
      function openSpintaxModal() {
        const modal = document.createElement('div');
        modal.className = 'cpc-modal-backdrop';
        modal.id = 'cpcSpintaxModal';

        modal.innerHTML = `
          <div class="cpc-modal-content">
            <div class="cpc-modal-header">
              <h3 style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:8px;">
                <i data-lucide="wand-2" style="color:var(--primary);"></i>
                <span>Tạo biến thể nội dung (Spintax / Hook)</span>
              </h3>
              <button type="button" class="btn btn-secondary btn-sm" id="cpcCloseModalBtn">
                <i data-lucide="x"></i>
              </button>
            </div>

            <div class="cp-form-group">
              <label class="cp-form-label">Hook mở đầu gợi ý theo sản phẩm (bấm để chèn vào văn bản):</label>
              <div class="cpc-hook-pills">
                <span class="cpc-hook-pill" data-hook="Con tính nhẩm chậm hơn bạn cùng lớp?">UCMAS: Con tính nhẩm chậm...</span>
                <span class="cpc-hook-pill" data-hook="Bé 6 tuổi nhân 3 chữ số trong 5 giây — bằng cách nào?">UCMAS: Bé 6 tuổi nhân 3 chữ số...</span>
                <span class="cpc-hook-pill" data-hook="Bé vào lớp 1 mà chưa ngồi yên được 10 phút?">UCKID: Bé vào lớp 1...</span>
                <span class="cpc-hook-pill" data-hook="Con sợ môn Toán từ lớp mấy?">MATHCA: Con sợ môn Toán...</span>
                <span class="cpc-hook-pill" data-hook="Hè này con ở nhà với điện thoại?">TRẠI HÈ: Hè này con ở nhà...</span>
              </div>
            </div>

            <div class="cp-form-group">
              <label for="cpcSpintaxInput" class="cp-form-label">
                Văn bản có Spintax <span class="cp-label-hint">(cú pháp {A|B|C})</span>
              </label>
              <textarea id="cpcSpintaxInput" class="cp-textarea" rows="4" placeholder="VD: {Con tính nhẩm chậm|Bé học toán mãi không vào}? Chương trình học trải nghiệm giúp bé {phát triển tư duy|tự tin làm chủ con số}."></textarea>
            </div>

            <div style="display:flex;gap:var(--space-3);align-items:center;">
              <div class="cp-form-group" style="flex:1;">
                <label for="cpcVariantCount" class="cp-form-label">Số biến thể cần sinh (2–6)</label>
                <input type="number" id="cpcVariantCount" class="cp-input" value="3" min="2" max="6">
              </div>
              <button type="button" class="btn btn-secondary" id="cpcBtnPreviewVariants" style="margin-top:20px;">
                Xem trước
              </button>
            </div>

            <div id="cpcVariantsPreviewBox" style="display:none;">
              <label class="cp-form-label">Các biến thể sinh ra:</label>
              <div id="cpcVariantsList" style="max-height:180px;overflow-y:auto;"></div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:var(--space-2);border-top:1px solid var(--border-subtle);padding-top:var(--space-3);">
              <button type="button" class="btn btn-secondary" id="cpcCancelModalBtn">Đóng</button>
              <button type="button" class="btn btn-primary" id="cpcApplyVariantsBtn">
                <i data-lucide="check"></i><span>Thêm biến thể vào danh sách</span>
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(modal);
        refreshIcons();

        const inputArea = modal.querySelector('#cpcSpintaxInput');
        const countInput = modal.querySelector('#cpcVariantCount');
        const prevBox = modal.querySelector('#cpcVariantsPreviewBox');
        const prevList = modal.querySelector('#cpcVariantsList');

        // Điền sẵn mẫu nếu có card đầu tiên
        if (cards[0]?.message) {
          inputArea.value = cards[0].message;
        }

        // Click hook pills
        modal.querySelectorAll('.cpc-hook-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            const h = pill.dataset.hook;
            inputArea.value = h + '\n' + inputArea.value;
          });
        });

        function getGeneratedVariants() {
          const text = inputArea.value.trim();
          const cnt = Math.min(6, Math.max(2, parseInt(countInput.value, 10) || 3));
          return expandSpintax(text, cnt);
        }

        modal.querySelector('#cpcBtnPreviewVariants')?.addEventListener('click', () => {
          const variants = getGeneratedVariants();
          prevList.innerHTML = variants.map((v, i) =>
            `<div class="cpc-variant-preview-item"><strong>Biến thể #${i + 1}:</strong> ${escapeHtml(v)}</div>`
          ).join('');
          prevBox.style.display = 'block';
        });

        modal.querySelector('#cpcApplyVariantsBtn')?.addEventListener('click', () => {
          const variants = getGeneratedVariants();
          if (variants.length === 0) {
            alert('Không có biến thể nào được sinh ra.');
            return;
          }
          if (cards.length + variants.length > max) {
            alert(`Tổng số nội dung sẽ vượt ${max} (đang có ${cards.length} + thêm ${variants.length}).`);
            return;
          }

          const baseCard = cards[0] || {};
          variants.forEach((v, i) => {
            const idx = cards.length + 1;
            cards.push({
              ...baseCard,
              id: 'card_' + Math.random().toString(36).slice(2, 9),
              key: `c${idx}`,
              name: `Biến thể #${i + 1} - ${baseCard.name || 'QC'}`,
              type: 'custom',
              message: v
            });
          });

          document.body.removeChild(modal);
          render();
          notify();
        });

        const close = () => { if (document.body.contains(modal)) document.body.removeChild(modal); };
        modal.querySelector('#cpcCloseModalBtn')?.addEventListener('click', close);
        modal.querySelector('#cpcCancelModalBtn')?.addEventListener('click', close);
      }

      // Khởi tạo ban đầu
      render();
      notify();

      return {
        getContents,
        setContents,
        destroy() {
          container.innerHTML = '';
        }
      };
    }
  };

  bootstrap();

  return {
    onReady,
    getToken,
    apiGet,
    apiPost,
    escapeHtml,
    refreshIcons,
    formatDate,
    formatNum,
    setPages,
    getPages,
    setAdAccounts,
    getAdAccounts,
    CTA_SUGGESTIONS,
    HOOK_LIBRARY,
    expandSpintax,
    uploadImage,
    ContentEditor
  };
})();
