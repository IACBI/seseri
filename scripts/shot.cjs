/* Screenshot helper for UI review of the "Sinyal" UI: home, search view, feed
 * (desktop/tablet/mobile), the settings VIEW and the Now Playing sheet. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 5202;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'screens-p5');

function makeWav(seconds = 120) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128); // 8-bit silence
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const WAV = makeWav();

const LOOKUP = {
  resultCount: 4,
  results: [
    { wrapperType: 'collection', kind: 'podcast', collectionId: 777000111, collectionName: 'Design Notes', artistName: 'Studio FM', artworkUrl100: '' },
    { wrapperType: 'podcastEpisode', trackId: 111, trackName: 'The grid is a promise you make to the reader', releaseDate: '2026-01-05T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep1.wav', trackTimeMillis: 2520000 },
    { wrapperType: 'podcastEpisode', trackId: 222, trackName: 'Typography as interface', releaseDate: '2026-02-11T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep2.wav', trackTimeMillis: 1980000 },
    { wrapperType: 'podcastEpisode', trackId: 333, trackName: 'Color systems that survive dark mode', releaseDate: '2026-03-02T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep3.wav', trackTimeMillis: 3120000 },
  ],
};

function waitServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (n) => http.get(url, (r) => { r.resume(); resolve(); }).on('error', () =>
      n <= 0 ? reject(new Error('no server')) : setTimeout(() => ping(n - 1), 500));
    ping(tries);
  });
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (u.includes('itunes.apple.com/lookup')) {
          return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LOOKUP) }).catch(() => {});
        }
        if (u.includes('itunes.apple.com/search')) {
          return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [ { collectionId: 777000111, collectionName: 'Design Notes', artistName: 'Studio FM', artworkUrl100: '', trackCount: 3 } ] }) }).catch(() => {});
        }
        if (u.includes('/fake/ep')) {
          return req.respond({ status: 200, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' }, body: WAV }).catch(() => {});
        }
        return req.continue().catch(() => {});
      } catch { /* disabled */ }
    });

    const shots = [
      { name: 'desktop-home', w: 1280, h: 800, url: '/' },
      { name: 'desktop-feed', w: 1280, h: 800, url: '/?podcast=777000111' },
      { name: 'tablet-feed', w: 768, h: 1024, url: '/?podcast=777000111' },
      { name: 'mobile-home', w: 390, h: 844, url: '/' },
      { name: 'mobile-feed', w: 390, h: 844, url: '/?podcast=777000111' },
    ];
    for (const s of shots) {
      await page.setViewport({ width: s.w, height: s.h });
      await page.goto(ORIGIN + s.url, { waitUntil: 'networkidle2' });
      if (s.url.includes('podcast')) await page.waitForSelector('.ep-item', { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
      await page.screenshot({ path: path.join(OUT, s.name + '.png') });
      console.log('shot', s.name);
    }

    // Search view — type a query and capture the results list
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(ORIGIN + '/?view=search', { waitUntil: 'networkidle2' });
    await page.type('#searchInput', 'design');
    await page.click('#searchBtn');
    await page.waitForSelector('#resultsList .row', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, 'desktop-search.png') });
    console.log('shot desktop-search');

    // Settings VIEW (formerly a native <dialog>) — now a plain page view
    await page.goto(ORIGIN + '/?view=settings', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#s_theme', { visible: true, timeout: 15000 }).catch(() => {});
    const settingsOk = await page.evaluate(() => {
      const themeSel = document.getElementById('s_theme');
      const view = document.getElementById('view-settings');
      return { themeVisible: !!themeSel && !themeSel.closest('[hidden]'), view: document.body.dataset.view, hasSwatches: !!document.getElementById('colorSwatches')?.children.length };
    });
    console.log('settings view', JSON.stringify(settingsOk));
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, 'settings-view.png') });
    console.log('shot settings-view');

    // Now Playing sheet — play an episode, then open the sheet from the active row
    await page.goto(ORIGIN + '/?podcast=777000111', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 15000 }).catch(() => {});
    await page.click('.ep-item').catch(() => {});
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 15000 }).catch(() => {});
    await page.click('.ep-item.active').catch(() => {});
    await page.waitForFunction(() => document.getElementById('npSheet')?.classList.contains('open'), { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, 'now-playing-sheet.png') });
    console.log('shot now-playing-sheet');
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    try { process.kill(server.pid); } catch {}
  }
})();
