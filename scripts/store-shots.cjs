/* Store screenshots for the web manifest / store listings:
 * 1920×1080 wide + 1080×1920 narrow, saved into public/screenshots/. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const PORT = 5204;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.join(__dirname, '..', 'public', 'screenshots');

const LOOKUP = {
  resultCount: 6,
  results: [
    { wrapperType: 'collection', kind: 'podcast', collectionId: 777000111, collectionName: 'Gündem Özel', artistName: 'Seseri Stüdyo', artworkUrl100: '' },
    { wrapperType: 'podcastEpisode', trackId: 111, trackName: 'Yapay zekâ haberciliği nasıl değiştiriyor?', releaseDate: '2026-06-29T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep1.wav', trackTimeMillis: 2520000 },
    { wrapperType: 'podcastEpisode', trackId: 222, trackName: 'Derin deniz madenciliği: fırsat mı, felaket mi?', releaseDate: '2026-06-22T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep2.wav', trackTimeMillis: 1980000 },
    { wrapperType: 'podcastEpisode', trackId: 333, trackName: 'Şehirler ısınırken mimari nasıl uyum sağlıyor', releaseDate: '2026-06-15T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep3.wav', trackTimeMillis: 3120000 },
    { wrapperType: 'podcastEpisode', trackId: 444, trackName: 'Kayıp diller arşivlerden geri dönüyor', releaseDate: '2026-06-08T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep4.wav', trackTimeMillis: 2760000 },
    { wrapperType: 'podcastEpisode', trackId: 555, trackName: 'Uyku bilimi: az bilinen 5 bulgu', releaseDate: '2026-06-01T00:00:00Z', episodeUrl: 'https://api.allorigins.win/fake/ep5.wav', trackTimeMillis: 2280000 },
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
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore' });
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (u.includes('itunes.apple.com/lookup')) return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LOOKUP) }).catch(() => {});
        if (u.includes('/fake/ep')) return req.abort().catch(() => {});
        return req.continue().catch(() => {});
      } catch {}
    });

    const grab = async (name, w, h, url, waitEp) => {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(ORIGIN + url, { waitUntil: 'networkidle2' });
      if (waitEp) await page.waitForSelector('.ep-item', { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1600)); // let the S finish drawing
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('store-shot', name);
    };

    await grab('wide-feed', 1920, 1080, '/?podcast=777000111', true);
    await grab('narrow-home', 1080, 1920, '/', false);
    await grab('narrow-feed', 1080, 1920, '/?podcast=777000111', true);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    try { process.kill(server.pid); } catch {}
  }
})();
