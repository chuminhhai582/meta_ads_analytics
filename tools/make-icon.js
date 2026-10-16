/**
 * Generate assets/dashboard.ico for the desktop shortcut.
 *
 * Written with zero dependencies: PNG and ICO are both simple enough to emit by hand,
 * and adding an image library to a 3-dependency project for one build-time asset
 * would not be a good trade (quy-tac-du-an.md §5).
 *
 * Design: the dashboard's own palette — dark slate card (#0f1523) with a rising
 * bar chart in the product cyan (#38bdf8) and a UCMAS-green top bar, so the icon
 * reads as "ads performance" at 16px as well as 256px.
 *
 * Run with:  node tools/make-icon.js
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'assets');
const OUT_FILE = path.join(OUT_DIR, 'dashboard.ico');

const SIZES = [16, 32, 48, 64, 128, 256];

// Palette lifted from public/css/style.css
const BG_DARK = [15, 21, 35];      // #0f1523 card
const BG_EDGE = [30, 41, 59];      // #1e293b border
const CYAN = [56, 189, 248];       // #38bdf8 ucmas
const GREEN = [52, 211, 153];      // #34d399 traihe / success
const PURPLE = [192, 132, 252];    // #c084fc uckid

/** Allocate a transparent RGBA canvas. */
function canvas(size) {
  return { size, px: new Uint8Array(size * size * 4) };
}

function setPx(c, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  // Source-over blend so anti-aliased edges sit correctly on what's underneath.
  const sa = a / 255;
  const da = c.px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { c.px[i] = c.px[i + 1] = c.px[i + 2] = c.px[i + 3] = 0; return; }
  c.px[i]     = Math.round((r * sa + c.px[i]     * da * (1 - sa)) / oa);
  c.px[i + 1] = Math.round((g * sa + c.px[i + 1] * da * (1 - sa)) / oa);
  c.px[i + 2] = Math.round((b * sa + c.px[i + 2] * da * (1 - sa)) / oa);
  c.px[i + 3] = Math.round(oa * 255);
}

/** Filled rounded rectangle with 4x supersampled edges. */
function roundRect(c, x0, y0, w, h, radius, color, alpha = 255) {
  const SS = 4;
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (px < x0 || py < y0 || px > x0 + w || py > y0 + h) continue;
          // Distance into the nearest corner box
          const dx = Math.max(x0 + radius - px, px - (x0 + w - radius), 0);
          const dy = Math.max(y0 + radius - py, py - (y0 + h - radius), 0);
          if (dx * dx + dy * dy <= radius * radius) hits++;
        }
      }
      if (hits > 0) setPx(c, x, y, color, Math.round((hits / (SS * SS)) * alpha));
    }
  }
}

/** Draw the icon at a given size. All geometry is proportional so it scales cleanly. */
function drawIcon(size) {
  const c = canvas(size);
  const u = size / 256; // design is authored at 256px

  // Card: border then inner fill, giving a 1-2px rim that survives downscaling.
  roundRect(c, 6 * u, 6 * u, 244 * u, 244 * u, 52 * u, BG_EDGE);
  roundRect(c, 12 * u, 12 * u, 232 * u, 232 * u, 46 * u, BG_DARK);

  // Rising bars — the "performance" motif.
  const barW = 30 * u;
  const gap = 16 * u;
  const baseY = 196 * u;
  const leftX = 54 * u;
  const bars = [
    { h: 44 * u, color: CYAN, alpha: 110 },
    { h: 78 * u, color: CYAN, alpha: 170 },
    { h: 112 * u, color: CYAN, alpha: 255 },
    { h: 146 * u, color: GREEN, alpha: 255 }
  ];
  bars.forEach((b, i) => {
    const x = leftX + i * (barW + gap);
    roundRect(c, x, baseY - b.h, barW, b.h, Math.min(7 * u, barW / 2), b.color, b.alpha);
  });

  // Baseline
  roundRect(c, 48 * u, baseY + 6 * u, 160 * u, 5 * u, 2.5 * u, BG_EDGE);

  // Accent dot top-right: the "live snapshot" badge.
  roundRect(c, 178 * u, 40 * u, 30 * u, 30 * u, 15 * u, PURPLE);

  return c;
}

// ---------------------------------------------------------------------------
// PNG encoder (RGBA, 8-bit, no interlace)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
    t[n] = crc;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.size, 0);
  ihdr.writeUInt32BE(c.size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = c.size * 4;
  const raw = Buffer.alloc((stride + 1) * c.size);
  for (let y = 0; y < c.size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(c.px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------------------
// ICO container (PNG-compressed entries — supported since Windows Vista)
// ---------------------------------------------------------------------------
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type 1 = icon
  header.writeUInt16LE(pngs.length, 4);  // image count

  const dirSize = 16 * pngs.length;
  let offset = header.length + dirSize;
  const dir = [];

  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;       // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;                            // palette colours
    e[3] = 0;                            // reserved
    e.writeUInt16LE(1, 4);               // colour planes
    e.writeUInt16LE(32, 6);              // bits per pixel
    e.writeUInt32BE(0, 8);
    e.writeUInt32LE(data.length, 8);     // bytes of this image
    e.writeUInt32LE(offset, 12);         // offset to image data
    dir.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...dir, ...pngs.map(p => p.data)]);
}

// ---------------------------------------------------------------------------
const pngs = SIZES.map(size => ({ size, data: encodePng(drawIcon(size)) }));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, encodeIco(pngs));

// A standalone PNG is handy for the README / any future web use.
fs.writeFileSync(path.join(OUT_DIR, 'dashboard-256.png'), pngs[pngs.length - 1].data);

console.log(`Da tao ${OUT_FILE}`);
console.log(`  kich thuoc: ${SIZES.join(', ')} px`);
console.log(`  dung luong: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
