/* Live smoke against the production site + worker (real network, no mocks).
 * Usage: node scripts/smoke-live.cjs [url]  (default: https://iacbi.github.io/seseri/) */
const puppeteer = require('puppeteer-core');
const { launchOptions } = require('./lib/harness.cjs');

const BASE = process.argv[2] || 'https://iacbi.github.io/seseri/';

(async () => {
  const results = [];
  const ok = (name, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    const workerCalls = [];
    const cspErrors = [];
    page.on('request', (r) => { if (r.url().includes('workers.dev')) workerCalls.push(r.url().split('?')[0]); });
    page.on('console', (m) => { if (m.text().includes('Content Security Policy')) cspErrors.push(m.text().slice(0, 120)); });
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
      .then(() => true).catch(() => false);
    ok('episode plays', playing);

    // Downloading pulls the enclosure from the podcast's own CDN, which is the
    // case a local run never covers: same-origin audio satisfies any
    // connect-src. Whether it *finishes* is the host's business — CORS through
    // a redirect chain, and its speed — so the assertion is that nothing of
    // ours blocks it, which the CSP check below now also covers. The outcome
    // is reported for information.
    await page.click('.ep-dl-btn');
    const saved = await page
      .waitForFunction(() => !!document.querySelector('.ep-dl-btn.done'), { timeout: 90000 })
      .then(() => true).catch(() => false);
    console.log(`INFO  download from the podcast's CDN: ${saved ? 'completed' : 'not finished in 90s'}`);

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
