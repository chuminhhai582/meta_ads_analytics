import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('U-04: bảng campaignsDataTable có caption, scope="col" và nút th-sort cho 16 cột sắp xếp', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');

  // Có thẻ caption
  assert.match(html, /<caption[^>]*class=["']visually-hidden["']/, 'Bảng phải có caption ẩn cho screen reader');

  // Đếm số lượng th-sort button
  const sortButtons = [...html.matchAll(/<button[^>]*class=["']th-sort["']/g)];
  assert.equal(sortButtons.length, 16, 'Phải có đúng 16 nút button.th-sort trong thead');

  // Đếm số th có scope="col"
  const scopeCols = [...html.matchAll(/<th\s+[^>]*scope=["']col["']/g)];
  assert.equal(scopeCols.length, 17, 'Cả 17 thẻ th phải có scope="col"');
});

test('U-04 + U-05: app.js duy trì aria-sort và cung cấp trapModal bẫy focus modal', () => {
  const appJs = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf-8');

  assert.match(appJs, /aria-sort/, 'renderTable phải gán thuộc tính aria-sort cho th');
  assert.match(appJs, /function\s+trapModal\s*\(/, 'app.js phải cung cấp hàm trapModal');
  assert.match(appJs, /window\.trapModal\s*=\s*trapModal/, 'trapModal phải được xuất ra window cho replicate-modal');
});
