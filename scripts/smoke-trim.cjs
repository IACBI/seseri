/* Intro and outro skip, driven in a real browser.
 *
 * The unit tests fake `timeupdate`; this lets a real media element play. What
 * only shows up here: the seek past the intro landing on a source that has
 * just started loading, the outro firing from the element's own ticks, and the
 * difference between playing into the outro and skipping into it.
 *
 * Same plumbing as smoke-chapters.cjs: the public-proxy route, one request
 * interceptor standing in for the feed and the audio.
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

const PORT = 5209;
const ORIGIN = `http://localhost:${PORT}`;
const FEED = 'https://feeds.example.com/trimmed.xml';
const LENGTH = 180;
const INTRO = 20;
const OUTRO = 30;
const WAV = makeWav(LENGTH);

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Trimmed Pod</title>
  <itunes:author>Studio</itunes:author>
  <item>
    <title>Newest</title>
    <guid>trim-ep-2</guid>
    <pubDate>Sat, 12 Sep 2026 09:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/ep2.wav" type="audio/wav"/>
    <itunes:duration>${LENGTH}</itunes:duration>
  </item>
  <item>
    <title>Older</title>
    <guid>trim-ep-1</guid>
    <pubDate>Fri, 11 Sep 2026 09:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/ep1.wav" type="audio/wav"/>
    <itunes:duration>${LENGTH}</itunes:duration>
  </item>
</channel>
</rss>`;

const CORS = { 'access-control-allow-origin': '*' };

/** Range requests answered like a podcast CDN, so the element can seek. */
function respondAudio(req, body) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers().range || '');
  const headers = {
    ...CORS,
    'accept-ranges': 'bytes',
    'access-control-expose-headers': 'content-range,content-length,accept-ranges',
  };
  if (!m) {
    return req.respond({ status: 200, contentType: 'audio/wav', headers, body }).catch(() => {});
  }
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : body.length - 1;
  headers['content-range'] = `bytes ${start}-${end}/${body.length}`;
  return req
    .respond({
      status: 206,
      contentType: 'audio/wav',
      headers,
      body: body.subarray(start, end + 1),
    })
    .catch(() => {});
}

(async () => {
  const server = startServer({ port: PORT });
  const { ok, finish } = results();
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 900 });
    // The outro is reached by real playback time; a background tab would
    // throttle the ticks that carry it.
    await page.bringToFront();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        // The app's own URL carries the feed in `?rss=`; never answer it with XML.
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req
            .respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body: XML })
            .catch(() => {});
        }
        if (u.includes('ep1.wav') || u.includes('ep2.wav')) return respondAudio(req, WAV);
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });

    // Seeded from an inert page: the app writes its own settings back on pagehide.
    await page.goto(ORIGIN + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() =>
      localStorage.setItem(
        'pp_settings',
        JSON.stringify({ allowPublicProxies: true, autoNext: true, skipForward: 30 }),
      ),
    );

    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 20000 });

    // ── the dialog ──────────────────────────────────────────────────
    const before = await page.evaluate(() => ({
      pressed: document.getElementById('trimBtn')?.getAttribute('aria-pressed'),
      label: document.getElementById('trimBtn')?.getAttribute('aria-label'),
    }));
    ok(
      'the header offers the skip, off',
      before.pressed === 'false' && !!before.label,
      before.label,
    );

    await page.click('#trimBtn');
    await page.waitForFunction(() => document.querySelector('dialog.trim-dialog')?.open === true, {
      timeout: 5000,
    });
    const offered = await page.evaluate(() => ({
      options: document.getElementById('trim_intro')?.options.length,
      value: document.getElementById('trim_intro')?.value,
      focused: document.activeElement?.id,
    }));
    ok(
      'the dialog opens on the intro, with every length and nothing chosen',
      offered.options === 11 && offered.value === '0' && offered.focused === 'trim_intro',
      JSON.stringify(offered),
    );
    await page.select('#trim_intro', String(INTRO));
    await page.select('#trim_outro', String(OUTRO));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.trim-dialog')?.open, {
      timeout: 5000,
    });
    const after = await page.evaluate(() => ({
      pressed: document.getElementById('trimBtn')?.getAttribute('aria-pressed'),
      stored: localStorage.getItem('pp_feed_trim'),
    }));
    ok(
      'a choice applies at once and lights the button',
      after.pressed === 'true' &&
        /"intro":20/.test(after.stored) &&
        /"outro":30/.test(after.stored),
      after.stored,
    );

    // ── intro ───────────────────────────────────────────────────────
    const position = () =>
      page.evaluate(
        (len) =>
          (Number(document.getElementById('miniScrub')?.getAttribute('aria-valuenow')) / 100) * len,
        LENGTH,
      );
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    // Whichever end of the list the default sort puts first, the other one is next.
    const GUID = { Newest: 'trim-ep-2', Older: 'trim-ep-1' };
    const firstTitle = await page.evaluate(() => document.getElementById('miniTitle')?.textContent);
    const secondTitle = firstTitle === 'Newest' ? 'Older' : 'Newest';
    const started = await position();
    ok(
      'a fresh episode starts past the intro',
      started >= INTRO && started < INTRO + 5,
      `${started.toFixed(1)}s`,
    );

    // ── outro, played into ──────────────────────────────────────────
    // 20 → 140 in four skips, then ten seconds of real playback up to 150.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await new Promise((r) => setTimeout(r, 150));
    }
    const nearEnd = await position();
    ok(
      'skipping forward lands before the outro',
      nearEnd < LENGTH - OUTRO,
      `${nearEnd.toFixed(1)}s`,
    );
    await page.waitForFunction(
      (want) => document.getElementById('miniTitle')?.textContent === want,
      { timeout: 20000 },
      secondTitle,
    );
    ok('playing into the outro finishes the episode and auto-next moves on', true);
    const heard = await page.evaluate(() => localStorage.getItem('pp_played') || '');
    ok(
      'the trimmed episode is marked heard',
      heard.includes(GUID[firstTitle]) && !heard.includes(GUID[secondTitle]),
      heard,
    );
    await new Promise((r) => setTimeout(r, 1500));
    const next = await position();
    ok(
      'the next episode also starts past the intro',
      next >= INTRO && next < INTRO + 5,
      `${next.toFixed(1)}s`,
    );

    // ── outro, skipped into ─────────────────────────────────────────
    // 20 → 170: the last skip jumps over the outro's start, which is a seek.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 2500));
    const inside = await page.evaluate(() => ({
      title: document.getElementById('miniTitle')?.textContent,
      playing: document.body.classList.contains('is-playing'),
    }));
    const insideAt = await position();
    ok(
      'a seek into the outro plays on',
      inside.playing && inside.title === secondTitle && insideAt > LENGTH - OUTRO,
      `${inside.title} at ${insideAt.toFixed(1)}s, playing=${inside.playing}`,
    );

    // ── off again ───────────────────────────────────────────────────
    await page.click('#trimBtn');
    await page.waitForFunction(() => document.querySelector('dialog.trim-dialog')?.open === true);
    await page.select('#trim_intro', '0');
    await page.select('#trim_outro', '0');
    await page.keyboard.press('Escape');
    const cleared = await page.evaluate(() => ({
      pressed: document.getElementById('trimBtn')?.getAttribute('aria-pressed'),
      stored: localStorage.getItem('pp_feed_trim'),
    }));
    ok(
      'turning both ends off forgets the show',
      cleared.pressed === 'false' && cleared.stored === '{}',
      cleared.stored,
    );
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
