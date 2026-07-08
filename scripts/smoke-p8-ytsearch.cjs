/* YT-by-name smoke: search a name → YouTube section renders → open a channel
 * → episodes list → attempt playback (worker audio proxy or embed fallback).
 * Needs worker:dev on 8787 and real network. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 5205;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOT = process.argv[2];

function waitServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (n) => http.get(url, (r) => { r.resume(); resolve(); }).on('error', () =>
      n <= 0 ? reject(new Error(url + ' down')) : setTimeout(() => ping(n - 1), 500));
    ping(tries);
  });
}

(async () => {
  await waitServer('http://127.0.0.1:8787/');
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  const results = [];
  const ok = (name, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const workerYt = [];
    page.on('request', (r) => { if (r.url().includes('8787/v1/yt/')) workerYt.push(r.url().replace(/^.*8787/, '')); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' });

    await page.type('#searchInput', 'lex fridman podcast');
    await page.click('#searchBtn');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-hint')].some((el) => el.textContent.includes('YouTube')),
      { timeout: 30000 },
    );
    const rows = await page.evaluate(() => {
      const hints = [...document.querySelectorAll('.search-hint')].map((h) => h.textContent.trim());
      return { hints, items: document.querySelectorAll('.result-item').length };
    });
    ok('search shows YouTube section', rows.hints.some((t) => t.includes('YouTube')), rows.hints.join(' | ') + ` · ${rows.items} rows`);
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'yt-search.png') });

    // open the first CHANNEL/PLAYLIST under the YouTube hint (author "YouTube"
    // and no duration badge marks channels), else fall back to the first row
    await page.evaluate(() => {
      const nodes = [...document.getElementById('resultsList').children];
      const yi = nodes.findIndex((n) => n.classList.contains('search-hint') && n.textContent.includes('YouTube'));
      const ytRows = nodes.slice(yi + 1);
      const chan = ytRows.find((n) => n.querySelector('.result-author')?.textContent === 'YouTube' && !n.querySelector('.result-count'));
      (chan ?? ytRows[0]).click();
    });
    await page.waitForSelector('.ep-item', { timeout: 60000 });
    const eps = await page.$$eval('.ep-item', (n) => n.length);
    ok('YouTube feed opens with episodes', eps >= 1, `${eps} eps`);

    // try playback: click first episode, wait for either audio playing or embed mode
    await page.click('.ep-item');
    const outcome = await page
      .waitForFunction(
        () =>
          document.body.classList.contains('is-playing')
            ? (document.querySelector('#pPlayer').classList.contains('yt-mode') && document.querySelector('audio')) ? 'audio' : 'playing'
            : null,
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    const mode = await page.evaluate(() => ({
      playing: document.body.classList.contains('is-playing'),
      status: document.getElementById('statusText')?.textContent,
    }));
    ok('playback starts (stream or embed)', outcome, JSON.stringify(mode));
    const usedProxy = workerYt.some((u) => u.includes('/v1/yt/audio'));
    console.log('INFO  worker yt calls:', [...new Set(workerYt.map((u) => u.split('?')[0]))].join(' '), usedProxy ? '→ REAL AUDIO via worker proxy' : '→ embed/pool path');
  } catch (e) {
    ok('smoke run', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    try { process.kill(server.pid); } catch {}
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
