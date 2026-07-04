/* P5 smoke: play an episode, navigate home — playback continues and the
 * mini player appears; tapping it returns to the feed without reloading. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 5203;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOT_DIR = process.argv[2];

function makeWav(seconds = 120) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const WAV = makeWav();

const LOOKUP = {
  resultCount: 3,
  results: [
    { wrapperType: 'collection', kind: 'podcast', collectionId: 777000111, collectionName: 'Design Notes', artistName: 'Studio FM', artworkUrl100: '' },
    { wrapperType: 'podcastEpisode', trackId: 111, trackName: 'The grid is a promise you make to the reader', releaseDate: '2026-01-05T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep1.wav', trackTimeMillis: 120000 },
    { wrapperType: 'podcastEpisode', trackId: 222, trackName: 'Typography as interface', releaseDate: '2026-02-11T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep2.wav', trackTimeMillis: 120000 },
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
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  const results = [];
  const ok = (name, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
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

    // Tapping the bar returns to the same feed without a reload
    await page.click('#miniPlayer');
    await page.waitForFunction(() => document.body.classList.contains('feed-open'), { timeout: 8000 });
    const back = await page.evaluate(() => ({
      playing: document.body.classList.contains('is-playing'),
      eps: document.querySelectorAll('.ep-item').length,
      active: !!document.querySelector('.ep-item.active'),
      url: location.search,
    }));
    ok('mini opens feed again, still playing', back.playing && back.eps === 2 && back.active, back.url);
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    try { process.kill(server.pid); } catch {}
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
