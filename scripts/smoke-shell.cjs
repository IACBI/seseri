/* Shell smoke: a healthy boot, and a broken one.
 *
 * Two things here are only observable in a real browser:
 *
 *   1. The fonts. They are served from our own origin now, and the failure mode
 *      of getting that wrong is silent — the face is skipped and the text falls
 *      back to a system font with nothing logged anywhere.
 *
 *   2. The crash-recovery screen. `boot()` is wrapped in a try/catch, and the
 *      only way to know the catch does something useful is to break the boot
 *      and look. The break is real: a MutationObserver removes `#app` before
 *      the module script runs, so `must('app')` throws exactly the way it did
 *      in production when a stored value was unusable.
 *
 * The wipe is then driven end to end — seeded localStorage, a Cache API entry
 * and the IndexedDB database all have to be gone afterwards.
 */
const puppeteer = require('puppeteer-core');
const { launchOptions, results, startServer, stopServer, waitServer } = require('./lib/harness.cjs');

const PORT = 5206;
const ORIGIN = `http://localhost:${PORT}`;

/**
 * Runs before any of the page's own scripts. Removing `#app` only when the URL
 * asks for it keeps the break switchable per navigation, with nothing to undo.
 *
 * The observer target is `document`, not `document.documentElement` — this runs
 * so early that `<html>` does not exist yet, and observing null throws inside
 * the injected script, where the failure is invisible to the smoke.
 */
function breakBootScript() {
  if (!location.search.includes('breakboot')) return;
  new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app) app.remove();
  }).observe(document, { childList: true, subtree: true });
}

(async () => {
  const server = startServer({ port: PORT });
  const { ok, finish } = results();
  let browser;
  try {
    await waitServer(ORIGIN + '/');
    browser = await puppeteer.launch(launchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 800 });
    await page.evaluateOnNewDocument(breakBootScript);

    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    });

    // ── 1. healthy boot ─────────────────────────────────────────────
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.app-nav', { timeout: 20000 });
    ok('app shell renders', true);
    ok('no console errors on a healthy boot', consoleErrors.length === 0, consoleErrors.join(' | '));

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded');
      return {
        families: [...new Set(loaded.map((f) => f.family))].sort(),
        external: [...document.styleSheets]
          .map((s) => s.href)
          .filter((h) => h && !h.startsWith(location.origin)),
        remoteLinks: [...document.querySelectorAll('link[rel="stylesheet"]')]
          .map((l) => l.href)
          .filter((h) => !h.startsWith(location.origin)),
      };
    });
    ok(
      'all three families load',
      fonts.families.length === 3 &&
        fonts.families.includes('Bricolage Grotesque') &&
        fonts.families.includes('Schibsted Grotesk') &&
        fonts.families.includes('Spline Sans Mono'),
      fonts.families.join(', '),
    );
    ok(
      'no cross-origin stylesheet',
      fonts.external.length === 0 && fonts.remoteLinks.length === 0,
      [...fonts.external, ...fonts.remoteLinks].join(' '),
    );

    // Seed every store the reset is supposed to empty.
    await page.evaluate(async () => {
      localStorage.setItem('pp_settings', JSON.stringify({ theme: 'oled' }));
      localStorage.setItem('pp_prog', JSON.stringify({ 111: 42 }));
      const cache = await caches.open('seseri-audio');
      await cache.put('/__offline/smoke', new Response('audio bytes'));
      // Same name, version and stores as src/storage/db.ts. Nothing on a bare
      // Home page opens the database, so the wipe would have had nothing to
      // delete and the assertion would have passed for the wrong reason.
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('seseri', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const s of ['feeds', 'downloads', 'resume']) {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const d = req.result;
          const tx = d.transaction('downloads', 'readwrite');
          tx.objectStore('downloads').put({
            id: '111',
            feedId: '777000111',
            title: 'seeded',
            bytes: 11,
            addedAt: Date.now(),
          });
          tx.oncomplete = () => {
            d.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('seed transaction failed'));
        };
        req.onerror = () => reject(new Error('could not open the database'));
      });
    });
    const seeded = await page.evaluate(async () => ({
      keys: localStorage.length,
      caches: await caches.keys(),
      dbs: (await indexedDB.databases()).map((d) => d.name),
    }));
    ok(
      'stores seeded for the wipe',
      seeded.keys >= 2 && seeded.caches.includes('seseri-audio') && seeded.dbs.includes('seseri'),
      `ls=${seeded.keys} caches=${seeded.caches.length} dbs=${seeded.dbs.join(',')}`,
    );

    // ── 2. broken boot ──────────────────────────────────────────────
    consoleErrors.length = 0;
    await page.goto(ORIGIN + '/?breakboot=1', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.fatal', { timeout: 15000 });
    const screen = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.fatal-actions button')];
      return {
        role: document.querySelector('.fatal')?.getAttribute('role'),
        title: document.querySelector('.fatal-title')?.textContent,
        buttons: buttons.map((b) => b.textContent),
        detail: document.querySelector('.fatal-detail')?.textContent?.slice(0, 120),
        shellHidden: !document.querySelector('.app-nav'),
      };
    });
    ok('recovery screen replaces the blank page', !!screen.title, screen.title);
    ok('it announces itself', screen.role === 'alert');
    ok('it offers reload and wipe', screen.buttons.length === 2, screen.buttons.join(' / '));
    ok('it names the failure', /app|Error|missing/i.test(screen.detail || ''), screen.detail);
    ok('the half-built shell is out of the way', screen.shellHidden);
    ok('the throw is logged for a bug report', consoleErrors.some((e) => /boot failed/.test(e)));

    // First click only arms the button — nothing may be deleted yet.
    await page.click('.fatal-actions button:nth-child(2)');
    const afterFirst = await page.evaluate(() => ({
      label: document.querySelector('.fatal-actions button:nth-child(2)')?.textContent,
      keys: localStorage.length,
    }));
    ok('one click does not wipe', afterFirst.keys >= 2, `label="${afterFirst.label}"`);

    // ── 3. the wipe, for real ───────────────────────────────────────
    const reloaded = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
    await page.click('.fatal-actions button:nth-child(2)');
    await reloaded;
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.app-nav', { timeout: 20000 });
    const after = await page.evaluate(async () => ({
      keys: localStorage.length,
      caches: await caches.keys(),
      dbs: (await indexedDB.databases()).map((d) => d.name),
    }));
    ok('localStorage is empty', after.keys === 0, `keys=${after.keys}`);
    ok(
      'the audio cache is gone',
      !after.caches.includes('seseri-audio'),
      after.caches.join(',') || 'none',
    );
    // The app reopens the database on boot, so "gone" is only observable as an
    // empty one — the downloads that lived in it are what had to go.
    const downloads = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('seseri');
          req.onsuccess = () => {
            const d = req.result;
            if (!d.objectStoreNames.contains('downloads')) return resolve(0);
            const all = d.transaction('downloads').objectStore('downloads').getAll();
            all.onsuccess = () => resolve(all.result.length);
            all.onerror = () => resolve(-1);
          };
          req.onerror = () => resolve(-1);
        }),
    );
    ok('no download records survived', downloads === 0, `records=${downloads}`);
    ok('the app boots again after the wipe', true);
  } catch (e) {
    ok('smoke run', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    process.exit(finish());
  }
})();
