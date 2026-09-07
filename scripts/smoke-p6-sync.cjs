/* P6 smoke: two devices, one pairing code. Device A listens, device B picks up
 * the position — and the bytes on the wire never contain the plaintext.
 *
 * The two "devices" are separate Puppeteer browser contexts, which have
 * genuinely isolated localStorage/IndexedDB. The sync backend is faked in-page
 * over a Map shared by both contexts, with a real If-Match compare-and-set, so
 * the whole client runs for real: crypto, merge, triggers and the 409 path.
 * The Worker itself is covered by worker/test/sync.test.ts.
 *
 * This script builds the app itself, because VITE_API_BASE and VITE_SYNC are
 * baked in at build time. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 5205;
const ORIGIN = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.join(__dirname, '..');

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
const CLIP_SECONDS = 120;

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

// ── the fake sync backend, shared by both contexts ───────────────────
const rows = new Map(); // syncId -> { rev, blob: Buffer }
const wire = { gets: 0, puts: 0, conflicts: 0, bodies: [], urls: [] };
let forceConflictOnce = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function syncApi(req, res, body) {
  const id = String(req.headers['x-sync-id'] || '').trim();
  const send = (status, headers, payload) => {
    res.writeHead(status, { 'cache-control': 'no-store', 'x-sync-time': String(Date.now()), ...headers });
    res.end(payload);
  };
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) {
    return send(400, { 'content-type': 'application/json' }, '{"error":"bad sync id"}');
  }

  if (req.method === 'GET') {
    wire.gets++;
    const row = rows.get(id);
    if (!row) return send(404, { 'content-type': 'application/json' }, '{"error":"no sync data"}');
    return send(200, { 'content-type': 'application/octet-stream', etag: `"${row.rev}"` }, row.blob);
  }

  if (req.method === 'PUT') {
    wire.puts++;
    wire.bodies.push(body);
    const want = Number(String(req.headers['if-match'] || '').replace(/"/g, ''));
    const row = rows.get(id);
    const current = row ? row.rev : 0;
    // Real compare-and-set, plus a one-shot forced conflict so the client's 409
    // recovery path is actually exercised.
    if (forceConflictOnce || want !== current) {
      forceConflictOnce = false;
      wire.conflicts++;
      if (!row) return send(400, { 'content-type': 'application/json' }, '{"error":"bad if-match"}');
      return send(409, { 'content-type': 'application/octet-stream', etag: `"${row.rev}"`, 'x-sync-conflict': '1' }, row.blob);
    }
    const rev = current + 1;
    rows.set(id, { rev, blob: body });
    return send(204, { etag: `"${rev}"` }, '');
  }

  if (req.method === 'DELETE') {
    rows.delete(id);
    return send(204, {}, '');
  }
  return send(405, {}, '');
}

/**
 * A real same-origin server rather than Puppeteer request interception.
 * Interception hands the body to Node as a UTF-8 string, which silently mangles
 * every byte above 0x7F — and the payload here is ciphertext. It also cannot see
 * requests the service worker makes on the page's behalf.
 */
function startServer() {
  const dist = path.join(ROOT, 'dist');
  return http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    if (url.pathname === '/api/v1/sync') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => syncApi(req, res, Buffer.concat(chunks)));
      return;
    }
    let file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}

/** Only the third-party bits still need faking in the page. */
async function attach(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    try {
      wire.urls.push(u);
      if (u.includes('itunes.apple.com/lookup')) return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LOOKUP) }).catch(() => {});
      if (u.includes('/fake/ep')) return req.respond({ status: 200, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-length': String(WAV.length) }, body: WAV }).catch(() => {});
      return req.continue().catch(() => {});
    } catch { /* interception already disabled — ignore stragglers */ }
  });
}

const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const progOf = async (page, id) => {
  const raw = await store(page, 'pp_prog');
  return raw ? (JSON.parse(raw)[id] ?? null) : null;
};

/** Settings view is where every sync control lives. */
async function openSettings(page) {
  await page.evaluate(() => { location.hash = ''; location.search = '?view=settings'; });
  await page.waitForSelector('#s_syncSection', { timeout: 15000 });
}

async function syncNow(page) {
  await page.click('#btnSyncNow');
  await new Promise((r) => setTimeout(r, 1500));
}

/**
 * Read the position off the mini dock. The Now Playing sheet skips timeupdate
 * work while closed, and `mini-player.ts` skips it while `document.hidden` —
 * so the page has to be frontmost before this is meaningful.
 */
async function scrubSeconds(page, minSeconds = 0) {
  await page.bringToFront();
  // "0:00" matches the shape immediately, so waiting only for a well-formed
  // readout would measure the moment before the resume seek lands. Waiting for
  // a position past the floor is what distinguishes "resumed" from "started
  // from the top": at 1x, reaching it by playing would take that many seconds.
  await page.waitForFunction((floor) => {
    const t = document.getElementById('miniScrub')?.getAttribute('aria-valuetext') || '';
    const m = t.match(/(\d+):(\d\d)/);
    return !!m && Number(m[1]) * 60 + Number(m[2]) > floor;
  }, { timeout: 15000 }, minSeconds);
  return page.evaluate(() => {
    const el = document.getElementById('miniScrub');
    const txt = el.getAttribute('aria-valuetext') || '';
    const m = txt.match(/(\d+):(\d\d)/);
    return { seconds: m ? Number(m[1]) * 60 + Number(m[2]) : null, percent: Number(el.getAttribute('aria-valuenow')) };
  });
}

(async () => {
  const results = [];
  const ok = (name, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

  console.log(`build: VITE_API_BASE=${ORIGIN}/api VITE_SYNC=1`);
  const built = spawnSync('npx.cmd', ['vite', 'build'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
    env: { ...process.env, VITE_API_BASE: ORIGIN + '/api', VITE_SYNC: '1' },
  });
  if (built.status !== 0) {
    console.log('FAIL  build');
    process.exit(1);
  }

  const server = startServer();
  // Bind loudly: a leftover preview server from an earlier run would otherwise
  // serve the app AND answer /api/v1/sync with the SPA fallback, which the
  // client faithfully reports as unreadable ciphertext.
  server.on('error', (e) => {
    console.log('FAIL  server bind', e.message);
    process.exit(1);
  });
  server.listen(PORT);
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

    // Two contexts = two devices: isolated localStorage, one browser process.
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    for (const p of [a, b]) {
      await p.setViewport({ width: 390, height: 844 });
      await attach(p);
      // SYNC_DEBUG=1 surfaces what the page saw when a step fails.
      if (process.env.SYNC_DEBUG) {
        p.on('console', (m) => {
          const tx = m.text();
          if (/sync|Sync|CORS|Failed/.test(tx)) console.log('  [console]', tx.slice(0, 180));
        });
        p.on('requestfailed', (r) => {
          if (r.url().includes('/api/')) console.log('  [reqfail]', r.method(), r.url(), r.failure() && r.failure().errorText);
        });
      }
    }

    // ── device A: listen, subscribe, pair ────────────────────────────
    await a.goto(`${ORIGIN}/?podcast=777000111`, { waitUntil: 'networkidle2' });
    await a.waitForSelector('.ep-item', { timeout: 20000 });
    await a.click('#favBtn');
    const subscribedAt = Date.now();
    await a.click('.ep-item');
    await a.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 15000 });
    await a.waitForFunction(() => {
      const raw = localStorage.getItem('pp_prog');
      return !!raw && (JSON.parse(raw)['111'] ?? 0) > 20;
    }, { timeout: 40000 });

    await openSettings(a);
    ok('sync section is available', await a.$('#s_syncSection') !== null);

    await a.click('#btnSyncStart');
    await a.waitForFunction(() => /\S/.test(document.getElementById('syncCode')?.textContent || ''), { timeout: 10000 });
    const code = await a.$eval('#syncCode', (el) => el.textContent.trim());
    ok('code generated', /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z*~$=U]{5}){4}$/.test(code), code);

    await syncNow(a);
    const pushed = await progOf(a, '111');
    ok('device A pushed its position', wire.puts >= 1 && pushed > 20, `t=${pushed} puts=${wire.puts}`);

    // ── device B: empty, then paired ─────────────────────────────────
    await b.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2' });
    ok('device B starts empty', (await store(b, 'pp_prog')) === null);

    await openSettings(b);
    await b.click('#btnSyncLink');
    await b.type('#syncCodeInput', code);
    const getsBefore = wire.gets;
    await b.click('#btnSyncLinkGo');
    await b.waitForFunction(() => !!localStorage.getItem('pp_sync'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    ok('pairing round-tripped', wire.gets > getsBefore);

    const received = await progOf(b, '111');
    const bStatus = await b.$eval('#syncStatus', (el) => el.textContent.trim()).catch(() => '?');
    ok('device B received the position', received !== null && Math.abs(received - pushed) <= 2, `A=${pushed} B=${received} status=${bStatus}`);
    ok('last-played pointer arrived', (await store(b, 'pp_last_777000111')) === '111');
    const favsB = await store(b, 'pp_favs');
    ok('subscription arrived', !!favsB && favsB.includes('777000111'), favsB ? favsB.slice(0, 60) : 'none');

    // ── device B resumes at the right position ───────────────────────
    await b.goto(`${ORIGIN}/?podcast=777000111`, { waitUntil: 'networkidle2' });
    await b.waitForSelector('.ep-item', { timeout: 20000 });
    // Let the boot sync finish writing before starting playback: the resume
    // reads the in-memory progress map, and a cycle still in flight is about to
    // rewrite it.
    await new Promise((r) => setTimeout(r, 2500));
    await b.click('.ep-item');
    await b.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 15000 });
    const beforeClick = await progOf(b, '111');
    await new Promise((r) => setTimeout(r, 2500));
    const at = await scrubSeconds(b);
    const expectedPct = Math.round((beforeClick / CLIP_SECONDS) * 100);
    ok('device B resumes at the right position', at.seconds !== null && Math.abs(at.seconds - beforeClick) <= 6, `stored=${beforeClick} resumed=${at.seconds}s`);
    ok('the scrub agrees', Math.abs(at.percent - expectedPct) <= 6, `valuenow=${at.percent} expected≈${expectedPct}`);

    // ── reverse direction ────────────────────────────────────────────
    await b.evaluate(() => { const el = document.getElementById('npSheet'); if (el) el.dispatchEvent(new Event('x')); });
    await b.waitForFunction(() => {
      const raw = localStorage.getItem('pp_prog');
      return !!raw && (JSON.parse(raw)['111'] ?? 0) > 45;
    }, { timeout: 60000 });
    await openSettings(b);
    await syncNow(b);
    await openSettings(a);
    await syncNow(a);
    const back = await progOf(a, '111');
    const bNow = await progOf(b, '111');
    ok('the reverse direction works too', back !== null && bNow !== null && Math.abs(back - bNow) <= 3, `B=${bNow} A=${back}`);

    // ── unsubscribe propagates and stays gone ────────────────────────
    await b.evaluate(() => {
      const favs = JSON.parse(localStorage.getItem('pp_favs') || '[]');
      return favs.length;
    });
    // Inside the merge's 60 s simultaneity window a removal deliberately loses
    // to a subscribe (least destructive when two clocks cannot be ordered), so
    // the unsubscribe has to land outside it for this to test propagation
    // rather than that rule. See SIMULTANEITY_MS in src/sync/merge.ts.
    const wait = subscribedAt + 61_000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    await b.goto(`${ORIGIN}/?podcast=777000111`, { waitUntil: 'networkidle2' });
    await b.waitForSelector('#favBtn', { timeout: 15000 });
    await b.click('#favBtn');
    // Unsubscribing asks first — the sync only has something to carry once the
    // confirmation is accepted.
    await b.waitForSelector('.confirm-ok', { timeout: 8000 });
    await b.click('.confirm-ok');
    await b.waitForFunction(() => !JSON.parse(localStorage.getItem('pp_favs') || '[]').length, { timeout: 8000 });
    const favsBafter = await store(b, 'pp_favs');
    const rmB = await store(b, 'pp_subs_rm');
    await openSettings(b);
    await syncNow(b);
    await openSettings(a);
    await syncNow(a);
    await syncNow(a);
    await syncNow(a);
    const favsA = await store(a, 'pp_favs');
    const atA = await store(a, 'pp_subs_at');
    const rmA = await store(a, 'pp_subs_rm');
    ok('unsubscribe propagates and stays gone', !!favsA && !favsA.includes('777000111'), `A_at=${atA} A_rm=${rmA} B_rm=${rmB}`);

    // ── the stale-push path ──────────────────────────────────────────
    const beforeConflict = await progOf(a, '111');
    forceConflictOnce = true;
    await syncNow(a);
    const afterConflict = await progOf(a, '111');
    ok('a stale push recovers without losing ground', wire.conflicts >= 1 && afterConflict >= beforeConflict, `conflicts=${wire.conflicts} ${beforeConflict}→${afterConflict}`);

    // ── the end-to-end encryption claim ──────────────────────────────
    const leaks = [];
    for (const body of wire.bodies) {
      for (const needle of ['777000111', 'pp_prog', 'trackId', 'Design Notes', '111']) {
        if (body.includes(Buffer.from(needle))) leaks.push(needle);
      }
    }
    ok('no plaintext on the wire', leaks.length === 0, leaks.length ? [...new Set(leaks)].join(',') : `${wire.bodies.length} bodies, ${wire.bodies[0] ? wire.bodies[0].length : 0}B first`);

    const groups = code.split('-');
    const inUrl = wire.urls.filter((u) => u.includes(code) || groups.some((g) => u.includes(g)));
    ok('the code never appears in a url', inUrl.length === 0, inUrl[0] || '');

    // ── unlinking is local only ──────────────────────────────────────
    await openSettings(b);
    await b.click('#btnSyncUnlink');
    await new Promise((r) => setTimeout(r, 300));
    const stillHasData = await progOf(b, '111');
    ok('unlinking keeps local data', (await store(b, 'pp_sync')) === null && stillHasData !== null, `t=${stillHasData}`);
  } catch (e) {
    ok('smoke run', false, e.message);
    try {
      console.log('  [wire]', JSON.stringify({ gets: wire.gets, puts: wire.puts, conflicts: wire.conflicts, rows: rows.size }));
      console.log('  [api urls seen by the page]', JSON.stringify(wire.urls.filter((u) => u.includes('/api/')).slice(0, 6)));
    } catch { /* nothing useful to add */ }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    const fails = results.filter((p) => !p).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
  }
})();
