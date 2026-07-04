/* P4 smoke: frontend built with VITE_API_BASE loads a real RSS feed through
 * the local Worker (public CORS proxies are unreachable from this network,
 * so a rendered episode list proves the Worker path end-to-end).
 * Prereq: `npm run worker:dev` already listening on 127.0.0.1:8787. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 5201;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FEED = 'https://feeds.simplecast.com/54nAGcIl'; // The Daily (~18 MB)

function waitServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (n) => http.get(url, (r) => { r.resume(); resolve(); }).on('error', () =>
      n <= 0 ? reject(new Error(url + ' never came up')) : setTimeout(() => ping(n - 1), 500));
    ping(tries);
  });
}

(async () => {
  await waitServer('http://127.0.0.1:8787/'); // worker must be up
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  const results = [];
  const ok = (name, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio'] });
    const page = await browser.newPage();
    const workerHits = [];
    page.on('request', (r) => { if (r.url().startsWith('http://127.0.0.1:8787/')) workerHits.push(r.url()); });

    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ep-item', { timeout: 60000 });
    const eps = await page.$$eval('.ep-item', (n) => n.length);
    ok('feed renders via worker', eps > 100, `${eps} eps`);
    ok('worker /v1/feed was called', workerHits.some((u) => u.includes('/v1/feed')), workerHits[0] || 'no hits');
    const title = await page.$eval('#pTitle', (e) => e.textContent);
    ok('feed title parsed', !!title && title !== '—', title);
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
