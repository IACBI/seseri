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
const http = require('http');
const net = require('net');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { launchOptions, startServer, stopServer, waitServer } = require('./lib/harness.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = 5201;
const ORIGIN = `http://localhost:${PORT}`;
const WORKER = 'http://127.0.0.1:8787';
const FEED = 'https://feeds.simplecast.com/54nAGcIl'; // The Daily (~20 MB, ~3000 items)

/**
 * A cold fetch of a full archive is tens of megabytes from the origin CDN, and
 * the Worker edge-caches it for 15 minutes — so the first run of the day is far
 * slower than the next. Budget for the cold case.
 */
const LOAD_TIMEOUT_MS = 120_000;

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

  const server = startServer({ port: PORT, mode: 'dev' });

  let browser;
  let page;
  const workerHits = [];
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
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
    /**
     * The feed is parsed at the edge now, so the client asks `/v1/parse` for
     * JSON and never downloads the ~20 MB of XML. `/v1/feed` remains as the
     * fallback, so seeing it here would mean the parse route failed and the
     * measurement this script exists for is not what it looks like.
     */
    ok(
      'worker /v1/parse was called',
      workerHits.some((u) => u.includes('/v1/parse')),
      workerHits[0] || 'no hits',
    );
    ok(
      'the raw XML was never downloaded',
      !workerHits.some((u) => u.includes('/v1/feed')),
      workerHits.filter((u) => u.includes('/v1/feed'))[0] || '',
    );
    /**
     * Measured from here rather than from the page: `transferSize` is zeroed
     * for a cross-origin response without `Timing-Allow-Origin`, so the page
     * reports 0 and the assertion would pass or fail for the wrong reason.
     *
     * The feed itself is ~20 MB of XML (`curl` it if you doubt the number);
     * what the client actually downloads now has to be nothing like that.
     */
    const parsedBytes = await new Promise((resolve) => {
      http
        .get(
          `${WORKER}/v1/parse?url=${encodeURIComponent(FEED)}&notes=0`,
          { headers: { origin: ORIGIN } },
          (r) => {
            let n = 0;
            r.on('data', (c) => (n += c.length));
            r.on('end', () => resolve(n));
          },
        )
        .on('error', () => resolve(0));
    });
    ok(
      'the list itself is a fraction of the feed',
      parsedBytes > 100_000 && parsedBytes < 4 * 1024 * 1024,
      `${(parsedBytes / 1024 / 1024).toFixed(2)} MB of JSON for a ~20 MB feed`,
    );
    ok('nothing was refused by the CSP', blocked.length === 0, blocked[0] || '');
    const title = await page.$eval('#pTitle', (e) => e.textContent);
    ok('feed title parsed', !!title && title !== '—', title);

    /**
     * Show notes are not in the list payload. Opening the sheet has to fetch
     * the one episode's notes and render them — the whole reason the list can
     * be this small.
     */
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await page.click('.ep-item.active').catch(() => {});
    const notes = await page
      .waitForFunction(
        () => {
          const el = document.getElementById('npNotes');
          return el && !el.hidden ? document.getElementById('npNotesBody')?.textContent : null;
        },
        { timeout: 20000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    ok('show notes are fetched on demand', !!notes && notes.length > 20, (notes || '').slice(0, 60));
    ok(
      'the notes came from /v1/parse',
      workerHits.some((u) => u.includes('notesFor=')),
      workerHits.filter((u) => u.includes('notesFor='))[0] || 'no notesFor call',
    );
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
    await stopServer(server);
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
