/* P3 offline smoke test: download an episode → go offline → reload → feed
 * renders from idb cache and the downloaded episode plays from Cache API. */
const puppeteer = require('puppeteer-core');
const {
  launchOptions,
  makeWav,
  startServer,
  stopServer,
  waitServer,
} = require('./lib/harness.cjs');

const PORT = 5200;
const ORIGIN = `http://localhost:${PORT}`;

const WAV = makeWav();

const LOOKUP = {
  resultCount: 3,
  results: [
    { wrapperType: 'collection', kind: 'podcast', collectionId: 777000111, collectionName: 'Offline Test Pod', artistName: 'Tester', artworkUrl100: '' },
    { wrapperType: 'podcastEpisode', trackId: 111, trackName: 'Episode One', releaseDate: '2026-01-01T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep1.wav', trackTimeMillis: 120000 },
    { wrapperType: 'podcastEpisode', trackId: 222, trackName: 'Episode Two', releaseDate: '2026-02-01T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep2.wav', trackTimeMillis: 120000 },
  ],
};

(async () => {
  const server = startServer({ port: PORT });
  const results = [];
  const ok = (name, pass, extra = '') => { results.push({ name, pass, extra }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    page.on('console', (m) => console.log('  [console]', m.type(), m.text().slice(0, 200)));
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
    page.on('requestfailed', (r) => console.log('  [reqfail]', r.url().slice(0, 120), r.failure()?.errorText));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (!u.startsWith(ORIGIN)) console.log('  [req]', u.slice(0, 120));
      try {
        if (u.includes('itunes.apple.com/lookup') || u.includes('itunes.apple.com%2Flookup')) {
          return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LOOKUP) }).catch(() => {});
        }
        if (u.includes('/fake/ep')) {
          return req.respond({ status: 200, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' }, body: WAV }).catch(() => {});
        }
        return req.continue().catch(() => {});
      } catch {
        /* interception already disabled — ignore stragglers */
      }
    });

    // 1) Online: open feed via deep link, wait for SW + list
    await page.goto(`${ORIGIN}/?podcast=777000111`, { waitUntil: 'networkidle2' });
    console.log('  [state]', JSON.stringify(await page.evaluate(() => ({
      href: location.href,
      view: document.body.dataset.view,
      feedOpen: document.body.classList.contains('feed-open'),
      idb: typeof indexedDB,
    }))));
    await page.waitForSelector('.ep-item', { timeout: 20000 });
    const count1 = await page.$$eval('.ep-item', (n) => n.length);
    ok('online: feed renders', count1 === 2, `${count1} eps`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    ok('service worker ready', true);

    // 2) Download episode 1 offline
    await page.click('.ep-dl-btn[data-act="dl"]');
    await page.waitForSelector('.ep-dl-btn.done', { timeout: 20000 });
    const cacheState = await page.evaluate(async () => {
      const has = await caches.has('seseri-audio');
      const c = has ? await caches.open('seseri-audio') : null;
      const keys = c ? (await c.keys()).map((r) => r.url) : [];
      return { has, keys };
    });
    ok('download cached in seseri-audio', cacheState.has && cacheState.keys.some((k) => k.includes('__offline')), cacheState.keys.join(','));

    // 3) Go offline and hard-reload
    await page.setRequestInterception(false);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ep-item', { timeout: 20000 });
    const count2 = await page.$$eval('.ep-item', (n) => n.length);
    ok('offline: app + cached feed render', count2 === 2, `${count2} eps`);
    const title = await page.$eval('#pTitle', (e) => e.textContent);
    ok('offline: feed meta from cache', title === 'Offline Test Pod', title);
    const stillDone = await page.$('.ep-dl-btn.done');
    ok('offline: download badge persists', !!stillDone);

    // 4) Play the downloaded episode offline. The sheet's own readout stays at
    //    0:00 by design while it is closed (views/now-playing.ts skips the work
    //    nobody can see), so the dock's slider is what reports the time here.
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    const t1 = await page.$eval('#miniScrub', (e) =>
      (e.getAttribute('aria-valuetext') || '').split(' / ')[0],
    );
    ok('offline: downloaded episode plays', !!t1 && t1 !== '0:00', `t=${t1}`);

    // 5) Seek works on the blob source — the seek keys live on the Now Playing
    //    scrubber, so open the sheet (click the active row) and focus it first
    await page.click('.ep-item.active');
    await page.waitForFunction(() => document.getElementById('npSheet')?.classList.contains('open'), { timeout: 8000 });
    await page.focus('#progressWrap');
    await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 800));
    const t2 = await page.$eval('#tCur', (e) => e.textContent);
    const secs = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);
    ok('offline: seek on downloaded audio', secs(t2) >= secs(t1) + 10, `${t1} -> ${t2}`);

    // 6) Duration comes from the decoded blob (the sheet's #tTot)
    const dur = await page.$eval('#tTot', (e) => e.textContent);
    ok('offline: duration from blob', dur === '2:00', dur);
  } catch (e) {
    ok('smoke run', false, e.message);
    try {
      const pages = await browser.pages();
      const p = pages[pages.length - 1];
      const dump = await p.evaluate(() => ({
        status: document.getElementById('statusText')?.textContent,
        epList: document.getElementById('epList')?.textContent?.slice(0, 150),
        title: document.getElementById('pTitle')?.textContent,
        view: document.body.dataset.view,
        sheetOpen: document.getElementById('npSheet')?.classList.contains('open'),
      }));
      console.log('  [dump]', JSON.stringify(dump));
    } catch {}
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    const fails = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
