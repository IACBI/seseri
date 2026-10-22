/* Show notes never make the browser fetch what the feed HTML points at.
 *
 * `parseShowNotes()` hands attacker-controlled episode-description HTML to
 * `new DOMParser().parseFromString(raw, 'text/html')` before anything is
 * filtered. A DOMParser document has no browsing context, so parsing it should
 * not start loads for `<img>`, `<iframe>`, `<link>`, CSS `url()`, `<video>`,
 * and so on. This smoke locks that in at the browser level: a future refactor
 * that moves the parse onto a live element (`innerHTML` on something in the
 * document) would start those fetches and fail here.
 *
 * Every request to the probe host is recorded and aborted; nothing reaches the
 * network. The feed and the audio are served the same way smoke-chapters does.
 *
 * Positive control: `SMOKE_CONTROL=1` inserts a real `<img>` pointing at the
 * probe host into the live page after the notes render. The probe counter must
 * catch it and the smoke must FAIL. Run it once with the flag to prove the
 * counter is not vacuous:
 *
 *   SMOKE_CONTROL=1 node scripts/smoke-shownotes.cjs   # expect FAIL on "no probe"
 *
 * Needs a built bundle (`npx vite build`), like the other smokes.
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

const PORT = 5212;
const ORIGIN = `http://localhost:${PORT}`;
const FEED = 'https://feeds.example.com/shownotes.xml';
const PROBE_HOST = 'probe.invalid';
const WAV = makeWav(120);
const CONTROL = process.env.SMOKE_CONTROL === '1';

const SENTINEL_FIRST = 'First paragraph of the notes';
const SENTINEL_LAST = 'Closing paragraph after the media.';

/**
 * Every load-bearing element points at the probe host. Text is kept in
 * paragraphs so the prose assertions have something to find.
 */
const DESCRIPTION = `
<p>${SENTINEL_FIRST}, with a plain https link: <a href="https://ok.example/page">Show page</a>.</p>
<p>Second paragraph. <a href="javascript:alert(1)">Bad link</a> should keep its words only.</p>
<p><img src="https://probe.invalid/img.png" alt="cover"></p>
<img srcset="https://probe.invalid/set-1x.png 1x, https://probe.invalid/set-2x.png 2x" src="https://probe.invalid/srcset-fallback.png">
<picture><source srcset="https://probe.invalid/pic.webp" type="image/webp"><img src="https://probe.invalid/pic.png" alt=""></picture>
<iframe src="https://probe.invalid/frame.html"></iframe>
<video poster="https://probe.invalid/poster.jpg"><source src="https://probe.invalid/clip.mp4" type="video/mp4"></video>
<audio src="https://probe.invalid/sound.mp3"></audio>
<link rel="stylesheet" href="https://probe.invalid/sheet.css">
<style>@import url("https://probe.invalid/import.css"); p { background: url(https://probe.invalid/bg-style.png); }</style>
<div style="background: url(https://probe.invalid/inline.png)">Styled block text.</div>
<object data="https://probe.invalid/thing.swf"></object>
<embed src="https://probe.invalid/embed.swf">
<input type="image" src="https://probe.invalid/button.png">
<script src="https://probe.invalid/script.js"></script>
<meta http-equiv="refresh" content="0;url=https://probe.invalid/redirect">
<base href="https://probe.invalid/">
<p>${SENTINEL_LAST}</p>
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Show Notes Pod</title>
  <itunes:author>Studio</itunes:author>
  <item>
    <title>An episode with hostile notes</title>
    <guid>notes-ep-1</guid>
    <pubDate>Fri, 11 Sep 2026 09:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/notes-ep1.wav" type="audio/wav"/>
    <itunes:duration>120</itunes:duration>
    <description><![CDATA[${DESCRIPTION}]]></description>
  </item>
</channel>
</rss>`;

const CORS = { 'access-control-allow-origin': '*' };

/** Same range-aware audio responder as smoke-chapters. */
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
    .respond({ status: 206, contentType: 'audio/wav', headers, body: body.subarray(start, end + 1) })
    .catch(() => {});
}

function isProbe(u) {
  try {
    return new URL(u).hostname === PROBE_HOST;
  } catch {
    return false;
  }
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

    /** Every request the page makes to the probe host, in order. */
    const probeHits = [];

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        if (isProbe(u)) {
          probeHits.push(u);
          return req.abort().catch(() => {});
        }
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req
            .respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body: XML })
            .catch(() => {});
        }
        if (u.includes('notes-ep1.wav')) return respondAudio(req, WAV);
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });

    // Public proxies are opt-in; switch them on from a page that does not run
    // the app (see smoke-chapters for why).
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

    // ── the notes render ────────────────────────────────────────────
    await page.waitForFunction(
      () => {
        const el = document.getElementById('npNotes');
        return !!el && !el.hidden && document.querySelectorAll('#npNotesBody .np-note-p').length > 0;
      },
      { timeout: 15000 },
    );
    await page.click('#npNotes > summary');
    await page.waitForFunction(() => document.getElementById('npNotes')?.open === true, {
      timeout: 5000,
    });

    if (CONTROL) {
      await page.evaluate(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<img src="https://probe.invalid/control.png" alt="">',
        );
      });
    }

    await new Promise((r) => setTimeout(r, 2000));

    const state = await page.evaluate(
      () => {
        const body = document.getElementById('npNotesBody');
        const paragraphs = [...body.querySelectorAll('.np-note-p')].map((p) => p.textContent);
        const anchors = [...body.querySelectorAll('a')].map((a) => ({
          text: a.textContent,
          href: a.getAttribute('href'),
        }));
        const anyJsAnchor = [...document.querySelectorAll('a')].some((a) =>
          /^\s*javascript:/i.test(a.getAttribute('href') || ''),
        );
        const mediaInNotes = body.querySelectorAll(
          'img,iframe,video,audio,object,embed,style,script,link,source,picture,input,base,meta',
        ).length;
        return { paragraphs, anchors, anyJsAnchor, mediaInNotes };
      },
    );

    ok(
      'no request reached the probe host',
      probeHits.length === 0,
      probeHits.length ? `${probeHits.length} seen: ${probeHits.slice(0, 3).join(', ')}` : 'none',
    );
    ok(
      'the paragraph text survives the parse',
      state.paragraphs.some((p) => p.includes(SENTINEL_FIRST)) &&
        state.paragraphs.some((p) => p.includes(SENTINEL_LAST)),
      `${state.paragraphs.length} paragraphs`,
    );
    ok(
      'exactly the https link is an anchor',
      state.anchors.length === 1 &&
        state.anchors[0].href === 'https://ok.example/page' &&
        state.anchors[0].text === 'Show page',
      JSON.stringify(state.anchors),
    );
    ok('no javascript: href exists on the page', !state.anyJsAnchor);
    ok(
      'no media, style, script or link element exists inside the notes',
      state.mediaInNotes === 0,
      `${state.mediaInNotes} found`,
    );
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
