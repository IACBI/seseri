// @vitest-environment jsdom
/**
 * The reset has one job that matters: finish. A user only reaches it because
 * something is already wrong, so every step has to survive the others failing,
 * and `deleteDatabase` — which waits forever when another tab holds the
 * database — must not be able to hang the wipe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const closeDb = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({ closeDb, DB_NAME: 'seseri' }));

import { hardReset } from './reset';

type DeleteMode = 'success' | 'error' | 'blocked' | 'throw';

interface FakeRequest {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

/** Records every deleted cache name so the assertions can be about behaviour. */
let deletedCaches: string[];
let cacheKeys: string[];
let deleteMode: DeleteMode;
let deletedDbs: string[];
let unregistered: number;

function installFakes(): void {
  deletedCaches = [];
  cacheKeys = ['seseri-shell-abc', 'seseri-audio'];
  deleteMode = 'success';
  deletedDbs = [];
  unregistered = 0;

  vi.stubGlobal('caches', {
    keys: () => Promise.resolve([...cacheKeys]),
    delete: (k: string) => {
      deletedCaches.push(k);
      return Promise.resolve(true);
    },
  });

  vi.stubGlobal('indexedDB', {
    deleteDatabase(name: string): FakeRequest {
      if (deleteMode === 'throw') throw new Error('SecurityError');
      deletedDbs.push(name);
      const req: FakeRequest = { onsuccess: null, onerror: null };
      // Handlers are attached synchronously right after this returns, so fire
      // on a later turn the way the real implementation does.
      queueMicrotask(() => {
        if (deleteMode === 'success') req.onsuccess?.();
        else if (deleteMode === 'error') req.onerror?.();
        // 'blocked': neither — the timeout has to answer.
      });
      return req;
    },
  });

  vi.stubGlobal('navigator', {
    userAgent: 'test',
    serviceWorker: {
      getRegistrations: () =>
        Promise.resolve([
          {
            unregister: () => {
              unregistered++;
              return Promise.resolve(true);
            },
          },
        ]),
    },
  });
}

beforeEach(() => {
  installFakes();
  localStorage.clear();
  closeDb.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('hardReset', () => {
  it('clears localStorage, every cache, the database and the service worker', async () => {
    localStorage.setItem('pp_settings', '{"theme":"oled"}');
    localStorage.setItem('pp_favs', '[]');

    const report = await hardReset();

    expect(localStorage.length).toBe(0);
    expect(deletedCaches.sort()).toEqual(['seseri-audio', 'seseri-shell-abc']);
    expect(deletedDbs).toEqual(['seseri']);
    expect(unregistered).toBe(1);
    expect(report).toEqual({
      localStorage: true,
      caches: true,
      indexedDB: true,
      serviceWorker: true,
    });
  });

  it('closes our own connection before deleting, or the delete would block', async () => {
    await hardReset();
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it('reports the database step as failed when nothing answers, instead of hanging', async () => {
    vi.useFakeTimers();
    deleteMode = 'blocked';

    const pending = hardReset();
    // Nothing has resolved yet: the request neither succeeded nor errored.
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(report.indexedDB).toBe(false);
    // The rest of the wipe still landed.
    expect(report.localStorage).toBe(true);
    expect(report.caches).toBe(true);
  });

  it('keeps going when the Cache API throws', async () => {
    vi.stubGlobal('caches', {
      keys: () => Promise.reject(new Error('SecurityError')),
      delete: () => Promise.resolve(true),
    });
    localStorage.setItem('pp_prog', '{}');

    const report = await hardReset();

    expect(report.caches).toBe(false);
    expect(report.indexedDB).toBe(true);
    expect(report.serviceWorker).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('keeps going when deleteDatabase throws outright', async () => {
    deleteMode = 'throw';
    const report = await hardReset();
    expect(report.indexedDB).toBe(false);
    expect(report.serviceWorker).toBe(true);
  });

  it('survives a browser with no Cache API, no IndexedDB and no service worker', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('navigator', { userAgent: 'test' });

    const report = await hardReset();

    expect(report.localStorage).toBe(true);
    // Nothing to delete is not a failure.
    expect(report.caches).toBe(true);
    expect(report.indexedDB).toBe(true);
    // No service worker to unregister — the optional chain answers, so the
    // step is reported as done rather than broken.
    expect(report.serviceWorker).toBe(true);
  });
});
