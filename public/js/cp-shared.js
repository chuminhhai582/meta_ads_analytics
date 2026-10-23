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
    getAdAccounts
  };
})();
