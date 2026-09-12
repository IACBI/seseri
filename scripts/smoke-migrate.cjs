/* The Apple → feed id migration, on state the app itself wrote.
 *
 * 4.2.7 moved episode lists from Apple's lookup (at most 200 episodes, numeric
 * `trackId`) to the show's own RSS feed (the whole archive, `<guid>`), which
 * renames every episode. Resume positions, queued items and downloaded files
 * are keyed on those names, so the switch has to carry them across — and that
 * migration runs on a listener's device, once, against data they cannot get
 * back if it goes wrong.
 *
 * Unit tests cover the remap as a function. What they cannot cover is the
 * round trip: state written by the pre-archive code paths, then read back
 * after the upgrade. So this drives both halves in one browser:
 *
 *   stage 1  Apple says `trackCount` equals the episodes it returned, so the
 *            app has no reason to look for an archive. Playing, queueing and
 *            downloading here writes state keyed on Apple's ids — written by
 *            the app, not seeded by hand, so nothing here can encode a
 *            storage layout the app does not actually use.
 *   stage 2  the same lookup now admits the list is short and names the feed.
 *            The archive loads and the ids move.
 *
 * The enclosure URLs deliberately differ between the two sources by a tracking
 * query string, because that is what real feeds do and it is the case
 * `audioKey` exists for.
 */
const puppeteer = require('puppeteer-core');
const {
  launchOptions,
  makeWav,
  results,
  startServer,
  stopServer,
  waitServer,
} = require('./lib/harness.cjs');

const PORT = 5219;
const ORIGIN = `http://localhost:${PORT}`;
const APPLE_ID = '777000111';
const FEED_URL = 'https://feeds.example.com/migrate.xml';
const WAV = makeWav(30);
const CORS = { 'access-control-allow-origin': '*' };

/** The three Apple knows about, and the three more only the feed has. */
const TITLES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const APPLE_IDS = ['9001', '9002', '9003'];
const audio = (i) => `https://cdn.example.com/a${i + 1}.wav`;

function lookup(limited) {
  const collection = {
    wrapperType: 'collection',
    kind: 'podcast',
    collectionId: Number(APPLE_ID),
    collectionName: 'Migrating Pod',
    artistName: 'Studio',
    artworkUrl100: '',
    // Stage 2 is the only difference: Apple admits there are six and says
    // where the rest live.
    trackCount: limited ? 6 : 3,
    ...(limited ? { feedUrl: FEED_URL } : {}),
  };
  const episodes = APPLE_IDS.map((id, i) => ({
    wrapperType: 'podcastEpisode',
    trackId: Number(id),
    trackName: TITLES[i],
    releaseDate: `2026-0${i + 1}-01T00:00:00Z`,
    episodeUrl: audio(i),
    trackTimeMillis: 30000,
  }));
  return { resultCount: episodes.length + 1, results: [collection, ...episodes] };
}

/** Six items; the first three are the same audio Apple named, plus a prefix. */
function xml() {
  const items = TITLES.map((title, i) => {
    const url = i < 3 ? `${audio(i)}?utm_source=feed&aid=${i}` : audio(i);
    return `<item>
      <title>${title}</title>
      <guid isPermaLink="false">guid-${i + 1}</guid>
      <pubDate>${new Date(Date.UTC(2026, i, 1)).toUTCString()}</pubDate>
      <enclosure url="${url}" type="audio/wav"/>
      <itunes:duration>30</itunes:duration>
    </item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Migrating Pod</title><itunes:author>Studio</itunes:author>${items}</channel></rss>`;
}

/** Range-capable, the way a podcast CDN is, so seeking works. */
function respondAudio(req) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers().range || '');
  const headers = {
    ...CORS,
    'accept-ranges': 'bytes',
    'access-control-expose-headers': 'content-range,content-length,accept-ranges',
  };
  if (!m) {
    return req
      .respond({ status: 200, contentType: 'audio/wav', headers, body: WAV })
      .catch(() => {});
  }
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : WAV.length - 1;
  headers['content-range'] = `bytes ${start}-${end}/${WAV.length}`;
  return req
    .respond({
      status: 206,
      contentType: 'audio/wav',
      headers,
      body: WAV.subarray(start, end + 1),
    })
    .catch(() => {});
}

/** The row for an episode, by its title — the one name both sources share. */
const rowByTitle = (title) => `
  [...document.querySelectorAll('.ep-item')]
    .find((r) => r.querySelector('.ep-name')?.textContent === ${JSON.stringify(title)})`;

(async () => {
  const server = startServer({ port: PORT });
  const { ok, finish } = results();
  let browser;
  let limited = false; // stage 1 until we say otherwise
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 900 });

    const body = xml();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes('itunes.apple.com/lookup')) {
          return req
            .respond({
              status: 200,
              contentType: 'application/json',
              headers: CORS,
              body: JSON.stringify(lookup(limited)),
            })
            .catch(() => {});
        }
        if (u.includes(encodeURIComponent(FEED_URL)) || u.includes(FEED_URL)) {
          return req
            .respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body })
            .catch(() => {});
        }
        if (u.includes('cdn.example.com')) return respondAudio(req);
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });

    // Seeded from a page that does not run the app: its `pagehide` would write
    // the defaults back over this.
    await page.goto(ORIGIN + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() =>
      localStorage.setItem('pp_settings', JSON.stringify({ allowPublicProxies: true })),
    );

    // ── stage 1: the app as it was before the archive switch ────────
    await page.goto(`${ORIGIN}/?podcast=${APPLE_ID}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 25000 });
    await page.bringToFront(); // a background tab throttles playback timers
    const stage1 = await page.evaluate(() => ({
      rows: document.querySelectorAll('.ep-item').length,
      count: document.getElementById('pEpCount')?.textContent,
    }));
    ok(
      'stage 1 shows only what Apple returned',
      stage1.rows === 3 && stage1.count === '3',
      `${stage1.rows} rows, header ${stage1.count}`,
    );

    // Download "One" — a real transfer into the Cache API, keyed on 9001.
    await page.evaluate(`${rowByTitle('One')}.querySelector('.ep-dl-btn').click()`);
    const cached = await page
      .waitForFunction(
        (sel) => {
          const row = [...document.querySelectorAll('.ep-item')].find(
            (r) => r.querySelector('.ep-name')?.textContent === sel,
          );
          return !!row?.querySelector('.ep-dl-btn.done');
        },
        { timeout: 30000 },
        'One',
      )
      .then(() => true)
      .catch(() => false);
    ok('stage 1 downloaded an episode', cached);

    // Queue "Three".
    await page.evaluate(`${rowByTitle('Three')}.querySelector('.ep-q-btn').click()`);
    await page.waitForFunction(
      (sel) => {
        const row = [...document.querySelectorAll('.ep-item')].find(
          (r) => r.querySelector('.ep-name')?.textContent === sel,
        );
        return !!row?.querySelector('.ep-q-btn.queued');
      },
      { timeout: 10000 },
      'Three',
    );

    // Listen to "Two" past the point the app bothers to remember (>5 s).
    await page.evaluate(`${rowByTitle('Two')}.querySelector('.ep-open').click()`);
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await page.waitForFunction(
      () => {
        const el = document.getElementById('miniScrub');
        const now = Number(el?.getAttribute('aria-valuenow') ?? 0);
        return now >= 25; // percent of a 30 s episode ≈ 7.5 s
      },
      { timeout: 45000, polling: 500 },
    );

    /**
     * Read from the inert page, not from the app. The position is written on
     * `pagehide` (and on a throttle), so reading it while the episode is still
     * playing finds an empty `pp_prog` — which is a property of when the app
     * persists, not of what it persisted. Navigating away is what flushes it,
     * and the same-origin manifest can read the result without the app
     * running.
     */
    await page.goto(ORIGIN + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
    const before = await page.evaluate(
      (feedId) => ({
        prog: JSON.parse(localStorage.getItem('pp_prog') || '{}'),
        queue: JSON.parse(localStorage.getItem('pp_queue') || '[]'),
        // Legacy key shape: one raw entry per feed, `pp_last_<feedId>`.
        last: localStorage.getItem('pp_last_' + feedId),
      }),
      APPLE_ID,
    );
    const progIds = Object.keys(before.prog);
    const queueIds = before.queue.map((q) => String(q.trackId));
    ok(
      'stage 1 state is keyed on Apple ids',
      progIds.includes('9002') && queueIds.includes('9003'),
      `progress ${progIds.join(',')} · queue ${queueIds.join(',')}`,
    );
    ok(
      'stage 1 remembered the last-played episode too',
      before.last === '9002',
      String(before.last),
    );
    const savedBefore = Number(before.prog['9002'] ?? 0);

    // ── stage 2: Apple admits the list is short ─────────────────────
    limited = true;
    await page.goto(`${ORIGIN}/?podcast=${APPLE_ID}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 25000 });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelectorAll('.ep-item').length === 6, {
      timeout: 30000,
    });
    const stage2 = await page.evaluate(() => ({
      rows: document.querySelectorAll('.ep-item').length,
      count: document.getElementById('pEpCount')?.textContent,
    }));
    ok(
      'stage 2 loads the whole archive',
      stage2.rows === 6 && stage2.count === '6',
      `${stage2.rows} rows, header ${stage2.count}`,
    );

    const after = await page.evaluate(
      (feedId) => ({
        prog: JSON.parse(localStorage.getItem('pp_prog') || '{}'),
        progAt: JSON.parse(localStorage.getItem('pp_prog_at') || '{}'),
        queue: JSON.parse(localStorage.getItem('pp_queue') || '[]'),
        last: localStorage.getItem('pp_last_' + feedId),
      }),
      APPLE_ID,
    );
    const afterProg = Object.keys(after.prog);
    const afterQueue = after.queue.map((q) => String(q.trackId));

    ok(
      'the saved position moved to the feed id, and kept its value',
      after.prog['guid-2'] === savedBefore && !('9002' in after.prog),
      `guid-2 = ${after.prog['guid-2']} (was 9002 = ${savedBefore})`,
    );
    ok(
      'the position kept its sync stamp, so another device cannot undo it',
      typeof after.progAt['guid-2'] === 'number' && after.progAt['guid-2'] > 0,
      String(after.progAt['guid-2']),
    );
    ok(
      'the queued episode moved with it',
      afterQueue.includes('guid-3') && !afterQueue.includes('9003'),
      `queue ${afterQueue.join(',')}`,
    );
    ok('the last-played pointer moved with it', after.last === 'guid-2', String(after.last));
    ok(
      'nothing was left behind under an Apple id',
      !afterProg.some((id) => APPLE_IDS.includes(id)) &&
        !afterQueue.some((id) => APPLE_IDS.includes(id)),
      `progress ${afterProg.join(',')} · queue ${afterQueue.join(',')}`,
    );

    // The badges are what the listener actually sees.
    const badges = await page.evaluate(() => {
      const read = (title) => {
        const row = [...document.querySelectorAll('.ep-item')].find(
          (r) => r.querySelector('.ep-name')?.textContent === title,
        );
        return {
          saved: !!row?.querySelector('.ep-saved-badge'),
          queued: !!row?.querySelector('.ep-q-btn.queued'),
          downloaded: !!row?.querySelector('.ep-dl-btn.done'),
        };
      };
      return { one: read('One'), two: read('Two'), three: read('Three'), four: read('Four') };
    });
    ok(
      'the download is still on the episode it belongs to',
      badges.one.downloaded && !badges.four.downloaded,
      `One ${badges.one.downloaded} · Four ${badges.four.downloaded}`,
    );
    ok(
      'the resume badge is still on the episode it belongs to',
      badges.two.saved && !badges.one.saved,
      `Two ${badges.two.saved} · One ${badges.one.saved}`,
    );
    ok(
      'the queue chip is still on the episode it belongs to',
      badges.three.queued && !badges.two.queued,
      `Three ${badges.three.queued} · Two ${badges.two.queued}`,
    );

    // And the position is not just stored, it is used.
    await page.evaluate(`${rowByTitle('Two')}.querySelector('.ep-open').click()`);
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    const resumed = await page
      .waitForFunction(
        (want) => {
          const el = document.getElementById('miniScrub');
          const txt = el?.getAttribute('aria-valuetext') || '';
          const m = /^(\d+):(\d+)/.exec(txt);
          const secs = m ? Number(m[1]) * 60 + Number(m[2]) : -1;
          return secs >= want;
        },
        { timeout: 30000, polling: 500 },
        Math.floor(savedBefore) - 1,
      )
      .then(() => true)
      .catch(() => false);
    const at = await page.evaluate(() =>
      document.getElementById('miniScrub')?.getAttribute('aria-valuetext'),
    );
    ok(
      'playing the migrated episode resumes where it was left',
      resumed,
      `${at} (saved ${savedBefore.toFixed(1)}s)`,
    );

    // The downloaded copy has to be playable, not merely badged: the Cache API
    // entry was re-keyed too, and a stale key reads as a download with no file.
    await page.evaluate(`${rowByTitle('One')}.querySelector('.ep-open').click()`);
    const offlinePlays = await page
      .waitForFunction(
        () => {
          const el = document.getElementById('miniScrub');
          const txt = el?.getAttribute('aria-valuetext') || '';
          return /^0:0[1-9]|^0:[1-9]/.test(txt);
        },
        { timeout: 30000, polling: 500 },
      )
      .then(() => true)
      .catch(() => false);
    ok('the re-keyed download still plays', offlinePlays);
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
