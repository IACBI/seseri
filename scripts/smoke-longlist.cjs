/* A long archive, rendered a window at a time.
 *
 * The Apple→RSS archive switch turned a 41-row list into a 2900-row one.
 * Measured on The Daily's real archive before this: 44595 DOM nodes and ~510 ms
 * to rebuild the list (125 ms of DOM work, 390 ms of layout) on a desktop.
 * After: 3001 nodes and ~26 ms. None of that is visible to a unit test — it
 * needs a real layout engine and a real IntersectionObserver.
 */
const puppeteer = require('puppeteer-core');
const { launchOptions, makeWav, results, startServer, stopServer, waitServer } = require('./lib/harness.cjs');

const PORT = 5217;
const ORIGIN = `http://localhost:${PORT}`;
const FEED = 'https://feeds.example.com/long.xml';
const COUNT = 900;
const BATCH = 200; // RENDER_BATCH in src/ui/views/podcast.ts
const WAV = makeWav(30);

/** Oldest first, one a day, with one oddly-named episode to filter for. */
function xml() {
  const items = Array.from({ length: COUNT }, (_, i) => {
    const day = new Date(Date.UTC(2020, 0, 1 + i)).toUTCString();
    const title = i === COUNT - 5 ? 'A Needle In The Haystack' : `Episode ${i + 1}`;
    return `<item>
      <title>${title}</title>
      <guid>ep-${i}</guid>
      <pubDate>${day}</pubDate>
      <enclosure url="https://cdn.example.com/${i}.wav" type="audio/wav"/>
      <itunes:duration>30</itunes:duration>
    </item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Long Pod</title><itunes:author>Studio</itunes:author>${items}</channel></rss>`;
}

const CORS = { 'access-control-allow-origin': '*' };

(async () => {
  const server = startServer({ port: PORT });
  const { ok, finish } = results();
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 800 });

    const body = xml();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      try {
        // The app's own page URL carries the feed URL in `?rss=`, so anything
        // same-origin has to go to the preview server untouched.
        if (u.startsWith(ORIGIN)) return req.continue().catch(() => {});
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req
            .respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body })
            .catch(() => {});
        }
        if (u.includes('cdn.example.com')) {
          return req
            .respond({ status: 200, contentType: 'audio/wav', headers: CORS, body: WAV })
            .catch(() => {});
        }
        return req.continue().catch(() => {});
      } catch {
        /* the page moved on */
      }
    });

    // The public proxies are opt-in. Seeded from a page that does not run the
    // app, whose `pagehide` would write the defaults back over this.
    await page.goto(ORIGIN + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() =>
      localStorage.setItem('pp_settings', JSON.stringify({ allowPublicProxies: true })),
    );

    await page.goto(`${ORIGIN}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ep-item', { timeout: 25000 });
    await page.waitForFunction(
      (n) => document.querySelectorAll('.ep-item').length === n,
      { timeout: 15000 },
      BATCH,
    );

    const initial = await page.evaluate(() => ({
      rendered: document.querySelectorAll('.ep-item').length,
      nodes: document.getElementById('epList')?.querySelectorAll('*').length ?? 0,
      count: document.getElementById('pEpCount')?.textContent,
      more: document.querySelector('.ep-more')?.textContent ?? null,
      contentVisibility: getComputedStyle(document.querySelector('.ep-item')).contentVisibility,
    }));
    ok('only one batch is in the DOM', initial.rendered === BATCH, `${initial.rendered} rows`);
    ok(
      'the count still reports the whole archive',
      initial.count === String(COUNT),
      `header says ${initial.count}`,
    );
    ok(
      'the remainder is offered',
      (initial.more || '').includes(String(COUNT - BATCH)),
      initial.more,
    );
    ok(
      'rows skip layout while off screen',
      initial.contentVisibility === 'auto',
      initial.contentVisibility,
    );
    ok(
      'the node count is a fraction of the archive',
      initial.nodes < COUNT * 4,
      `${initial.nodes} nodes for ${COUNT} episodes`,
    );

    // ── growing ─────────────────────────────────────────────────────
    await page.click('.ep-more');
    await page.waitForFunction((n) => document.querySelectorAll('.ep-item').length === n, {}, BATCH * 2);
    ok('the button grows the window', true, `${BATCH * 2} rows`);

    // Scrolling to the end should grow it again without a tap.
    await page.evaluate(() => {
      document.querySelector('.ep-more')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForFunction((n) => document.querySelectorAll('.ep-item').length > n, { timeout: 10000 }, BATCH * 2);
    ok('scrolling to the end grows it on its own', true);

    // ── the window resets on a new question ─────────────────────────
    await page.click('#sortToggle');
    await page.waitForFunction((n) => document.querySelectorAll('.ep-item').length === n, { timeout: 10000 }, BATCH);
    ok('changing the order starts the window over', true);

    await page.type('#filterInput', 'Needle');
    await page.waitForFunction(() => document.querySelectorAll('.ep-item').length === 1, {
      timeout: 10000,
    });
    const filtered = await page.evaluate(() => ({
      rows: document.querySelectorAll('.ep-item').length,
      title: document.querySelector('.ep-name')?.textContent,
      more: document.querySelector('.ep-more')?.textContent ?? null,
    }));
    ok(
      'a filter searches the whole archive, not the window',
      filtered.rows === 1 && filtered.title === 'A Needle In The Haystack' && filtered.more === null,
      `${filtered.rows} row: ${filtered.title}`,
    );

    // ── the playing row stays reachable past the window ─────────────
    await page.click('.ep-item');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), {
      timeout: 20000,
    });
    await page.evaluate(() => {
      const input = document.getElementById('filterInput');
      input.value = '';
      input.dispatchEvent(new Event('input'));
    });
    // The filter is debounced; wait for the archive to be back.
    await page.waitForFunction((n) => document.querySelectorAll('.ep-item').length >= n, { timeout: 15000 }, BATCH);
    /**
     * Put the playing episode deep in the list. It is the fifth from the end of
     * the feed, so newest-first leaves it near the top and oldest-first leaves
     * it at index 895 — past the window, which the order change just reset.
     */
    await page.click('#sortToggle');
    await page.waitForFunction(
      (n) => {
        const active = document.querySelector('.ep-item.active');
        return !!active && Number(active.dataset.idx) > n;
      },
      { timeout: 15000 },
      BATCH,
    );
    const deep = await page.evaluate(() => {
      const active = document.querySelector('.ep-item.active');
      return {
        index: active?.dataset.idx,
        title: active?.querySelector('.ep-name')?.textContent,
        rendered: document.querySelectorAll('.ep-item').length,
      };
    });
    ok(
      'the window grows to include whatever is playing',
      deep.title === 'A Needle In The Haystack' && Number(deep.index) > BATCH,
      `index ${deep.index} of ${deep.rendered} rendered`,
    );
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
