/* Live smoke against the production site + worker (real network, no mocks).
 * Usage: node scripts/smoke-live.cjs [url]  (default: https://iacbi.github.io/seseri/) */
const puppeteer = require('puppeteer-core');
const { launchOptions } = require('./lib/harness.cjs');

const BASE = process.argv[2] || 'https://iacbi.github.io/seseri/';

(async () => {
  const results = [];
  const ok = (name, pass, extra = '') => {
    results.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  };
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    const workerCalls = [];
    const cspErrors = [];
    page.on('request', (r) => {
      if (r.url().includes('workers.dev')) workerCalls.push(r.url().split('?')[0]);
    });
    page.on('console', (m) => {
      if (m.text().includes('Content Security Policy')) cspErrors.push(m.text().slice(0, 120));
    });
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    ok('site loads', (await page.title()).includes('Seseri'));
    await page.evaluate(() => navigator.serviceWorker.ready);
    ok('service worker active', true);

    // Real search → results through the deployed worker. Search is a view now,
    // so navigate to it (the nav bar is always mounted) before typing.
    await page.click('#navSearch');
    await page.waitForSelector('#searchInput', { visible: true, timeout: 15000 });
    await page.type('#searchInput', 'the daily');
    await page.click('#searchBtn');
    await page.waitForSelector('#resultsList .row', { timeout: 60000 });
    const res = await page.evaluate(() => ({
      rows: document.querySelectorAll('#resultsList .row').length,
      hints: [...document.querySelectorAll('.search-hint')].map((h) => h.textContent.trim()),
    }));
    ok('search returns results', res.rows > 0, `${res.rows} rows · ${res.hints.join(' | ')}`);

    // Open the first podcast and play an episode (real audio CDN)
    await page.click('#resultsList .row');
    await page.waitForSelector('.ep-item', { timeout: 60000 });
    const eps = await page.$$eval('.ep-item', (n) => n.length);
    ok('feed opens', eps > 5, `${eps} eps`);
    await page.click('.ep-item');
    const playing = await page
      .waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    ok('episode plays', playing);

    /**
     * Downloading pulls the enclosure from the podcast's own CDN, the case a
     * local run never covers: same-origin audio satisfies any connect-src.
     *
     * This used to print "not finished in 90s" and pass regardless, which
     * cannot tell a slow transfer from a dead one — and while it said that,
     * 4.2.8's bug was live: the handoff to the browser worked and the app
     * reported "download link not found" over it. Whether the copy *completes*
     * is still the host's business, so the assertion is on the outcome the app
     * claims. Two of the three are fine:
     *
     *   - `.ep-dl-btn.done`  the episode was cached for offline use
     *   - an info toast      the CDN refuses CORS and the URL went to the
     *                        browser, which is the documented fallback
     *   - an error toast     the app told the listener it failed  → FAIL
     *
     * The toast *class* is what is asserted, not its text, so this does not
     * depend on the storefront language the deployed site happens to load.
     */
    await page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver((recs) => {
        for (const r of recs)
          for (const n of r.addedNodes)
            if (n.nodeType === 1 && n.classList?.contains('toast'))
              window.__toasts.push({
                error: n.classList.contains('toast-error'),
                text: n.textContent.trim(),
              });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.click('.ep-dl-btn');
    /**
     * Polled from here, not with `waitForFunction`. The handoff opens a new
     * tab, which backgrounds this page — and `waitForFunction` polls on
     * `requestAnimationFrame`, which a hidden page does not run. That is why
     * the old check reported "not finished in 90s" for a host it had actually
     * handed off to in under a second. `page.evaluate` is not throttled.
     */
    const read = () =>
      page.evaluate(() => ({
        done: !!document.querySelector('.ep-dl-btn.done'),
        toasts: window.__toasts || [],
      }));
    let dl = await read();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !dl.done && dl.toasts.length === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      dl = await read();
    }
    const outcome = dl.done || dl.toasts.length > 0;
    const failed = dl.toasts.filter((t) => t.error);
    ok(
      'a download either caches or hands off, and says so correctly',
      outcome && failed.length === 0 && (dl.done || dl.toasts.length > 0),
      dl.done
        ? 'cached for offline use'
        : failed.length
          ? 'error toast: ' + failed[0].text
          : dl.toasts.length
            ? 'handed to the browser: ' + dl.toasts[0].text
            : 'nothing happened in 90s',
    );

    ok('no CSP violations', cspErrors.length === 0, cspErrors[0] ?? '');
    console.log('INFO  worker calls:', [...new Set(workerCalls)].join(' ') || 'none');
  } catch (e) {
    ok('smoke run', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
