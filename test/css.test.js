import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * U-02: var(--x) không giải được sẽ làm cả khai báo vô hiệu, im lặng, không có
 * lỗi console — nên lỗi này sống được 1 tuần trước khi bị phát hiện bằng tay.
 * Test này bắt được bằng grep thuần, không cần trình duyệt.
 */
test('U-02: không có biến CSS nào được dùng mà chưa định nghĩa', () => {
  const all = ['style.css', 'replicate.css', 'cross-post.css']
    .map(f => readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf-8'))
    .join('\n');

  const defined = new Set([...all.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gmi)].map(m => m[1]));
  const used = new Set([...all.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(v => !defined.has(v));

  assert.deepEqual(missing, [], `Biến CSS chưa định nghĩa: ${missing.join(', ')}`);
});
