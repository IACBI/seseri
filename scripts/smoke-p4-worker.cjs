/* P4 smoke: the app loads a real RSS feed through the local Worker.
 *
 * Runs against `vite dev`, not a built bundle, and that is the whole point.
 * `stripDevCsp` in vite.config.ts removes `http://127.0.0.1:8787` from
 * `connect-src` in every build, so a built bundle pointed at the local Worker
 * has its own fetch refused by the CSP before it leaves the page — and since
 * 4.2.2 the third-party proxy fallback is off by default, so nothing renders
 * and the failure looks like a dead network. This script used `vite preview`
 * and was therefore silently unrunnable from the release that added the strip
 * until 4.2.4. The dev server keeps the loopback origin in the CSP and
 * registers no service worker, which is also what a developer running
 * `npm run worker:dev` actually has in front of them.
 *
 * Cross-origin on purpose: the deployed Worker is on another origin too, so the
 * browser sends a real `Origin` and the Worker's open-proxy guard is exercised
 * rather than bypassed.
 *
 * Prereq: `npm run worker:dev` already listening on 127.0.0.1:8787.
 */
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = 5201;
const ORIGIN = `http://localhost:${PORT}`;
const WORKER = 'http://127.0.0.1:8787';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FEED = 'https://feeds.simplecast.com/54nAGcIl'; // The Daily (~20 MB, ~3000 items)

/**
 * A cold fetch of a full archive is tens of megabytes from the origin CDN, and
 * the Worker edge-caches it for 15 minutes — so the first run of the day is far
 * slower than the next. Budget for the cold case.
 */
const LOAD_TIMEOUT_MS = 120_000;

function waitServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (n) =>
      http
        .get(url, (r) => {
          r.resume();
          resolve();
        })
        .on('error', () =>
          n <= 0 ? reject(new Error(url + ' never came up')) : setTimeout(() => ping(n - 1), 500),
        );
    ping(tries);
  });
}

/** True when something is already listening on `port`. */
function portTaken(port) {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(true))
      .once('listening', () => probe.close(() => resolve(false)))
      .listen(port, '127.0.0.1');
  });
}

(async () => {
  const results = [];
  const ok = (name, pass, extra = '') => {
    results.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  };

  await waitServer(WORKER + '/'); // worker must be up

  /**
   * A leftover dev/preview server from an earlier run keeps the port and serves
   * a STALE bundle — one built against a different API base. The app then loads
   * the SPA fallback HTML where it expected a feed and reports "invalid rss",
   * which looks like a parser bug and is not one. `--strictPort` does not help:
   * vite exits, and this script would happily drive whatever is still there.
   * (SIGTERM through `shell: true` on Windows leaves the real process alive,
   * which is how those zombies accumulate.)
   */
  if (await portTaken(PORT)) {
    console.log(`FAIL  port ${PORT} is already in use — kill the leftover server first`);
    process.exit(1);
  }

  const server = spawn('npx.cmd', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    shell: true,
    stdio: 'ignore',
  });

  let browser;
  let page;
  const workerHits = [];
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: 'new',
      args: ['--mute-audio'],
    });
    page = await browser.newPage();

    page.on('request', (r) => {
      if (r.url().startsWith(WORKER + '/')) workerHits.push(r.url());
    });
    // A CSP refusal is the exact failure this script exists to catch.
    const blocked = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) blocked.push(m.text().slice(0, 140));
      if (process.env.SMOKE_DEBUG) console.log('  [console]', m.type(), m.text().slice(0, 180));
    });

    const t0 = Date.now();
    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ep-item', { timeout: LOAD_TIMEOUT_MS });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const eps = await page.$$eval('.ep-item', (n) => n.length);
    ok('feed renders via worker', eps > 100, `${eps} eps in ${secs}s`);
    ok('worker /v1/feed was called', workerHits.some((u) => u.includes('/v1/feed')), workerHits[0] || 'no hits');
    ok('nothing was refused by the CSP', blocked.length === 0, blocked[0] || '');
    const title = await page.$eval('#pTitle', (e) => e.textContent);
    ok('feed title parsed', !!title && title !== '—', title);
  } catch (e) {
    ok('smoke run', false, e.message);
    // Without this a failure is just a selector timeout and says nothing about
    // why — the interesting cases all leave a message on screen.
    if (page) {
      const seen = await page
        .evaluate(() => ({
          status: document.querySelector('#pStatus, .p-status')?.textContent?.trim().slice(0, 200),
          title: document.querySelector('#pTitle')?.textContent,
          rows: document.querySelectorAll('.ep-item').length,
        }))
        .catch(() => null);
      console.log('  [page]', JSON.stringify(seen));
      console.log('  [worker hits]', workerHits.length, workerHits[0] || '(none)');
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    try {
      process.kill(server.pid);
    } catch {
      /* already gone */
    }
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
