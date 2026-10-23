import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3571;   // cổng riêng để không đụng server đang chạy

/** Khởi động server thật trên cổng tạm rồi đợi nó trả lời. */
async function startServer() {
  const proc = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/session`);
      if (r.ok) return proc;
    } catch { /* chưa lên */ }
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Server không khởi động được trong 6s');
}

/**
 * S-01: mọi route GHI dưới /api/cp phải đòi X-Internal-Token.
 * Test này bắt cả loại lỗi "route mới quên thêm vào danh sách bảo vệ" —
 * đúng loại lỗi đã xảy ra với 3 route của Ads Creation Studio.
 */
test('S-01: mọi route ghi /api/cp đòi X-Internal-Token', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const writeRoutes = [
    'publish', 'replicate-ad', 'analyze-campaigns', 'bulk-replicate',
    'refresh-cache', 'create-campaign', 'create-adset', 'batch-create-ads',
    'build-structure', 'upload-ad-image', 'content-library'
  ];

  for (const p of writeRoutes) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/cp/${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 403, `POST /api/cp/${p} phải trả 403 khi thiếu token`);
  }
});

test('S-01: route đọc /api/cp vẫn gọi được không cần token', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`http://127.0.0.1:${PORT}/api/cp/ad-accounts`);
  assert.notEqual(res.status, 403, 'GET /api/cp/ad-accounts không được bị chặn');
});
