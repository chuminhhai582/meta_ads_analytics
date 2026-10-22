import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3572;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer() {
  const proc = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/session`)).ok) return proc; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Server không khởi động được');
}

/**
 * F-01: href tĩnh trong index.html làm mọi lần xuất đều ra file ALL/last_30d.
 * Backend vẫn đúng — test này khoá lại điều đó để lần sau nếu ai sửa readOptions()
 * làm mất khả năng lọc thì biết ngay.
 */
test('F-01: /api/export/campaigns tôn trọng bộ lọc trong query', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const dem = async (url) => (await (await fetch(url)).text()).split('\n').length;

  const all  = await dem(`${BASE}/api/export/campaigns?includeEmpty=1`);
  const uckid = await dem(`${BASE}/api/export/campaigns?product=uckid&includeEmpty=1`);

  assert.ok(uckid < all, `lọc UCKID (${uckid}) phải ít dòng hơn tất cả (${all})`);
  assert.ok(uckid > 1,   'phải có ít nhất 1 dòng dữ liệu ngoài header');
});

test('F-01: tên file tải về mang đúng bộ lọc', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`${BASE}/api/export/campaigns?product=uckid&datePreset=last_month`);
  const cd = res.headers.get('content-disposition');
  assert.match(cd, /chien_dich_uckid_last_month\.csv/);
});

test('/api/* không khớp route nào phải trả 404 JSON, không phải index.html', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  const res = await fetch(`${BASE}/api/khong-ton-tai`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
});
