/* Chapters and transcripts, driven in a real browser.
 *
 * Neither can be checked from a unit test: the chapter markers need a laid-out
 * scrubber and a real duration, and the highlight that follows the audio is
 * driven by `timeupdate` — which the Now Playing sheet deliberately skips while
 * `document.hidden`, so it only happens in a page that is actually on screen.
 *
 * The feed is served through the public-proxy path (switched on in
 * localStorage for this run) because that is the route a built bundle with no
 * Worker configured takes, and it lets one request interceptor stand in for
 * the feed, the chapters file, the transcript and the audio.
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

const PORT = 5208;
const ORIGIN = `http://localhost:${PORT}`;
const FEED = 'https://feeds.example.com/chaptered.xml';
const WAV = makeWav(600);

/** Three chapters, one of them art-only, and one out of order on purpose. */
const CHAPTERS = {
  version: '1.2.0',
  chapters: [
    { startTime: 120, title: 'The middle bit' },
    { startTime: 0, title: 'Cold open' },
    { startTime: 60, title: 'Art only', img: 'https://img.example/a.jpg', toc: false },
    { startTime: 300, title: 'Credits' },
  ],
};

const VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000
The first thing that is said.

00:00:05.000 --> 00:00:12.000
The second thing, a little later.

00:02:00.000 --> 00:02:06.000
Something from the middle bit.

00:05:00.000 --> 00:05:04.000
And the credits roll.
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>Chaptered Pod</title>
  <itunes:author>Studio</itunes:author>
  <item>
    <title>An episode with chapters</title>
    <guid>chapter-ep-1</guid>
    <pubDate>Fri, 11 Sep 2026 09:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/ep1.wav" type="audio/wav"/>
    <itunes:duration>600</itunes:duration>
    <podcast:chapters url="https://cdn.example.com/ep1.chapters.json" type="application/json+chapters"/>
    <podcast:transcript url="https://cdn.example.com/ep1.vtt" type="text/vtt" language="en"/>
  </item>
</channel>
</rss>`;

const CORS = { 'access-control-allow-origin': '*' };

/**
 * Serve the audio the way a podcast CDN does: range requests answered with a
 * 206 and `Accept-Ranges`. A plain 200 leaves the element unable to seek until
 * the whole body has arrived, so a chapter jump reads back as 0:00 — which is
 * a property of the fixture, not of the app.
 */
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

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        /**
         * The app's own page URL contains the feed URL (`?rss=<encoded>`), so a
         * bare substring match answers the NAVIGATION with the feed XML and
         * there is no app left to test. Everything same-origin goes to the
         * preview server; only the outside world is mocked.
         */
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req
            .respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body: XML })
            .catch(() => {});
        }
        if (u.includes('ep1.chapters.json')) {
          return req
            .respond({
              status: 200,
              contentType: 'application/json',
              headers: CORS,
              body: JSON.stringify(CHAPTERS),
            })
            .catch(() => {});
        }
        if (u.includes('ep1.vtt')) {
          return req
            .respond({ status: 200, contentType: 'text/vtt', headers: CORS, body: VTT })
            .catch(() => {});
        }
        if (u.includes('ep1.wav')) return respondAudio(req, WAV);
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });

    /**
     * The public proxies are opt-in, so this run has to switch them on — and
     * it has to do that from a page that does NOT run the app. `boot()`
     * registers a `pagehide` handler that writes its in-memory settings back to
     * storage, so a value seeded from the app's own page is overwritten by the
     * defaults on the way out. The manifest is same-origin and inert.
     */
    await page.goto(ORIGIN + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() =>
      localStorage.setItem('pp_settings', JSON.stringify({ allowPublicProxies: true })),
    );

    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 20000 });
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await page.click('#miniExpand');
    await page.waitForFunction(
      () => document.getElementById('npSheet')?.classList.contains('open'),
      { timeout: 15000 },
    );

    // ── chapters ────────────────────────────────────────────────────
    await page.waitForFunction(() => document.querySelectorAll('.np-chapter').length > 0, {
      timeout: 15000,
    });
    // The markers are laid out against a duration, which arrives with the
    // element's metadata rather than with the chapters.
    await page.waitForFunction(() => document.querySelectorAll('.signal-chapters i').length > 0, {
      timeout: 15000,
    });
    const chapters = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.np-chapter-title')].map((e) => e.textContent),
      times: [...document.querySelectorAll('.np-chapter-time')].map((e) => e.textContent),
      summary: document.getElementById('npChaptersToggle')?.textContent,
      marks: [...document.querySelectorAll('.signal-chapters i')].map((e) =>
        e.style.getPropertyValue('inset-inline-start'),
      ),
    }));
    ok(
      'chapters are listed in order',
      JSON.stringify(chapters.titles) ===
        JSON.stringify(['Cold open', 'The middle bit', 'Credits']),
      chapters.titles.join(' / '),
    );
    ok('the art-only chapter is not offered', !chapters.titles.includes('Art only'));
    ok('the count is in the heading', /3/.test(chapters.summary || ''), chapters.summary);
    ok(
      'chapter times are formatted',
      JSON.stringify(chapters.times) === JSON.stringify(['0:00', '2:00', '5:00']),
      chapters.times.join(' / '),
    );
    // 120/600 = 20%, 300/600 = 50%. The one at 0 is deliberately not drawn.
    ok(
      'markers land on the scrubber at the right places',
      chapters.marks.length === 2 &&
        chapters.marks[0].startsWith('20') &&
        chapters.marks[1].startsWith('50'),
      chapters.marks.join(' / '),
    );

    // Jumping: click the third chapter, the audio has to move there.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.np-chapter')];
      rows[rows.length - 1].click();
    });
    await new Promise((r) => setTimeout(r, 900));
    const jumped = await page.evaluate(() => ({
      position: Math.round(document.querySelector('audio')?.currentTime ?? -1),
      activeTitle: document.querySelector('.np-chapter.active .np-chapter-title')?.textContent,
    }));
    // The element is not in the DOM (`new Audio()`), so read the position the
    // way the app surfaces it instead.
    const positionFromUi = await page.evaluate(
      () => document.getElementById('tCur')?.textContent ?? '',
    );
    ok('jumping to a chapter moves the audio', positionFromUi === '5:00', positionFromUi);
    ok(
      'the chapter jumped to is highlighted',
      jumped.activeTitle === 'Credits',
      jumped.activeTitle,
    );

    // Following: seek back to the middle chapter and let playback report it.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.np-chapter')];
      rows[1].click();
    });
    await page.waitForFunction(
      () =>
        document.querySelector('.np-chapter.active .np-chapter-title')?.textContent ===
        'The middle bit',
      { timeout: 8000 },
    );
    ok('the highlight follows the audio', true);

    // ── transcript ──────────────────────────────────────────────────
    const beforeOpen = await page.evaluate(() => ({
      hidden: document.getElementById('npTranscript')?.hidden,
      rows: document.querySelectorAll('.np-cue').length,
    }));
    ok(
      'the transcript is offered but not fetched until it is opened',
      beforeOpen.hidden === false && beforeOpen.rows === 0,
      `hidden=${beforeOpen.hidden} rows=${beforeOpen.rows}`,
    );

    await page.evaluate(() => {
      const el = document.getElementById('npTranscript');
      el.open = true;
      el.dispatchEvent(new Event('toggle'));
    });
    await page.waitForFunction(() => document.querySelectorAll('.np-cue').length > 0, {
      timeout: 15000,
    });
    const cues = await page.evaluate(() => ({
      count: document.querySelectorAll('.np-cue').length,
      first: document.querySelector('.np-cue-text')?.textContent,
      times: [...document.querySelectorAll('.np-cue-time')].map((e) => e.textContent),
    }));
    ok('the transcript renders its cues', cues.count === 4, `${cues.count} cues`);
    ok('cue text survives the parse', cues.first === 'The first thing that is said.', cues.first);
    ok(
      'cue times are formatted',
      JSON.stringify(cues.times) === JSON.stringify(['0:00', '0:05', '2:00', '5:00']),
      cues.times.join(' / '),
    );

    // Tapping a line seeks, and the line it tapped is the one highlighted.
    await page.evaluate(() => {
      [...document.querySelectorAll('.np-cue')][2].click();
    });
    await new Promise((r) => setTimeout(r, 700));
    const afterCue = await page.evaluate(() => ({
      position: document.getElementById('tCur')?.textContent,
      activeText: document.querySelector('.np-cue.active .np-cue-text')?.textContent,
    }));
    ok('tapping a line seeks to it', afterCue.position === '2:00', afterCue.position);
    ok(
      'the line tapped is the one highlighted',
      afterCue.activeText === 'Something from the middle bit.',
      afterCue.activeText,
    );

    // ── an episode with neither shows neither ───────────────────────
    const plain = XML.replace(/<podcast:(chapters|transcript)[^>]*\/>/g, '');
    await page.setRequestInterception(false);
    await page.setRequestInterception(true);
    page.removeAllListeners('request');
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req
            .respond({
              status: 200,
              contentType: 'application/rss+xml',
              headers: CORS,
              body: plain,
            })
            .catch(() => {});
        }
        if (u.includes('ep1.wav')) return respondAudio(req, WAV);
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });
    await page.evaluate(() => {
      localStorage.removeItem('pp_inbox');
      localStorage.removeItem('pp_feed_seen');
    });
    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}&fresh=1`, {
      waitUntil: 'networkidle2',
    });
    await page.waitForSelector('.ep-item', { timeout: 20000 });
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await page.click('#miniExpand');
    await new Promise((r) => setTimeout(r, 1500));
    const neither = await page.evaluate(() => ({
      chapters: document.getElementById('npChapters')?.hidden,
      transcript: document.getElementById('npTranscript')?.hidden,
    }));
    ok(
      'an episode with neither shows neither panel',
      neither.chapters === true && neither.transcript === true,
      `chapters hidden=${neither.chapters} transcript hidden=${neither.transcript}`,
    );
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
