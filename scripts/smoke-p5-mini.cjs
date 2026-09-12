/* P5 smoke: play an episode, navigate home — playback continues and the
 * mini player appears; tapping it returns to the feed without reloading. */
const path = require('path');
const puppeteer = require('puppeteer-core');
const {
  launchOptions,
  makeWav,
  results,
  startServer,
  stopServer,
  waitServer,
} = require('./lib/harness.cjs');

const PORT = 5203;
const ORIGIN = `http://localhost:${PORT}`;
const SHOT_DIR = process.argv[2];

const WAV = makeWav();

const LOOKUP = {
  resultCount: 3,
  results: [
    { wrapperType: 'collection', kind: 'podcast', collectionId: 777000111, collectionName: 'Design Notes', artistName: 'Studio FM', artworkUrl100: '' },
    { wrapperType: 'podcastEpisode', trackId: 111, trackName: 'The grid is a promise you make to the reader', releaseDate: '2026-01-05T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep1.wav', trackTimeMillis: 120000 },
    { wrapperType: 'podcastEpisode', trackId: 222, trackName: 'Typography as interface', releaseDate: '2026-02-11T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep2.wav', trackTimeMillis: 120000 },
  ],
};

(async () => {
  const server = startServer({ port: PORT });
  const { ok, finish } = results();
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (u.includes('itunes.apple.com/lookup')) return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LOOKUP) }).catch(() => {});
        if (u.includes('/fake/ep')) return req.respond({ status: 200, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' }, body: WAV }).catch(() => {});
        return req.continue().catch(() => {});
      } catch {}
    });

    await page.goto(`${ORIGIN}/?podcast=777000111`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 20000 });
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 15000 });
    ok('episode playing', true);

    // Queue: toggle on the 2nd episode shows position chip, toggle off clears
    // (done here, while the feed's episode list is on screen)
    await page.click('.ep-item:nth-child(2) .ep-q-btn');
    const chip = await page.$eval('.ep-item:nth-child(2) .ep-q-btn', (b) => ({ q: b.classList.contains('queued'), txt: b.textContent.trim() }));
    ok('queue chip shows position', chip.q && chip.txt === '1', chip.txt);
    await page.click('.ep-item:nth-child(2) .ep-q-btn');
    const off = await page.$eval('.ep-item:nth-child(2) .ep-q-btn', (b) => b.classList.contains('queued'));
    ok('queue toggle off', !off);

    // Back to home — playback must survive
    await page.click('#backBtn');
    await page.waitForFunction(() => !document.body.classList.contains('feed-open'), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 1200));
    const state = await page.evaluate(() => ({
      hasTrack: document.body.classList.contains('has-track'),
      miniVisible: getComputedStyle(document.getElementById('miniPlayer')).display !== 'none',
      playing: document.body.classList.contains('is-playing'),
      title: document.getElementById('miniTitle')?.textContent,
    }));
    ok('home: playback continues', state.playing);
    ok('home: mini player visible', state.hasTrack && state.miniVisible, state.title);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, 'mobile-home-mini.png') });

    // Mini play button pauses without navigating
    await page.click('#miniPlay');
    await new Promise((r) => setTimeout(r, 500));
    const paused = await page.evaluate(() => !document.body.classList.contains('is-playing') && !document.body.classList.contains('feed-open'));
    ok('mini button pauses in place', paused);
    await page.click('#miniPlay');

    // The expand chevron (or title area) opens the Now Playing sheet — the bar
    // itself now hosts inline transport controls, so it is no longer a button.
    await page.click('#miniExpand');
    await page.waitForFunction(() => document.getElementById('npSheet')?.classList.contains('open'), { timeout: 8000 });
    const sheet = await page.evaluate(() => ({
      playing: document.body.classList.contains('is-playing'),
      open: document.getElementById('npSheet').classList.contains('open'),
      title: document.getElementById('nowTitle')?.textContent,
    }));
    ok('mini opens Now Playing sheet, still playing', sheet.playing && sheet.open, sheet.title);
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
