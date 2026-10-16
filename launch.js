/**
 * Desktop launcher for the Ucmas Ads Analytics dashboard.
 *
 * Double-clicking the desktop shortcut runs this. It:
 *   1. Reads PORT from .env (same source the server uses).
 *   2. Checks whether the dashboard is ALREADY running on that port — if so it just
 *      opens the browser instead of starting a second copy and hitting EADDRINUSE.
 *   3. Otherwise starts src/server.js in this same console window (so the log is
 *      visible and closing the window stops the dashboard), waits until it answers,
 *      then opens the browser.
 *
 * Run directly with:  node launch.js
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = config.port;
const URL_ROOT = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 300;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** True when something answers an HTTP request on the port. */
async function isDashboardUp() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${URL_ROOT}/api/session`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  // `start` is a cmd builtin, so it needs a shell. The empty "" is the window title
  // argument — without it cmd treats a quoted URL as the title and opens nothing.
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  console.log('');
  console.log('  ===============================================');
  console.log('   UCMAS ADS ANALYTICS — Dashboard noi bo');
  console.log('  ===============================================');
  console.log('');

  if (await isDashboardUp()) {
    console.log(`  Dashboard dang chay san roi. Dang mo trinh duyet...`);
    console.log(`  >> ${URL_ROOT}`);
    openBrowser(URL_ROOT);
    console.log('');
    console.log('  Cua so nay se tu dong dong sau 3 giay.');
    await sleep(3000);
    return;
  }

  if (!config.hasToken()) {
    console.log('  [!] Chua cau hinh Access Token trong .env.');
    console.log('      Dashboard van mo duoc — bam "Cai dat Token" tren trang web de dan token.');
    console.log('');
  }

  console.log(`  Dang khoi dong server tren cong ${PORT}...`);

  const server = spawn(process.execPath, [path.join(__dirname, 'src', 'server.js')], {
    cwd: __dirname,
    stdio: 'inherit'   // log cua server hien ngay trong cua so nay
  });

  server.on('error', (err) => {
    console.error('  [LOI] Khong khoi dong duoc server:', err.message);
    process.exitCode = 1;
  });

  // Closing the window / Ctrl+C must take the server down with it.
  const stop = () => { if (!server.killed) server.kill(); };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('exit', stop);

  // Wait for the server to actually answer before opening the browser, so the user
  // never lands on a "can't reach this page" screen.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let up = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      console.error('');
      console.error('  [LOI] Server da thoat. Xem thong bao loi phia tren.');
      console.error('  Nguyen nhan thuong gap: cong dang bi chuong trinh khac dung.');
      process.exitCode = 1;
      return;
    }
    if (await isDashboardUp()) { up = true; break; }
    await sleep(POLL_INTERVAL_MS);
  }

  if (!up) {
    console.error(`  [LOI] Server khong phan hoi sau ${READY_TIMEOUT_MS / 1000} giay.`);
    process.exitCode = 1;
    return;
  }

  openBrowser(URL_ROOT);
  console.log('');
  console.log('  -----------------------------------------------');
  console.log(`   Dashboard da mo: ${URL_ROOT}`);
  console.log('   DONG CUA SO NAY de tat dashboard.');
  console.log('  -----------------------------------------------');
  console.log('');

  // Keep this process alive as long as the server runs.
  await new Promise(resolve => server.on('close', resolve));
}

main().catch(err => {
  console.error('  [LOI]', err.message);
  process.exitCode = 1;
});
