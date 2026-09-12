/**
 * Hard reset — every byte the app has stored, wiped in one pass.
 *
 * Two callers: the crash-recovery screen (`ui/fatal.ts`) and Settings →
 * "clear all data". Both mean the same thing to the user, and both need it to
 * be *complete*: localStorage alone leaves the IndexedDB stores and, worst of
 * all, the `seseri-audio` Cache API bucket holding every downloaded episode.
 *
 * Every step stands alone and swallows its own failure. The reason a user
 * reaches this is often that one of these stores is the broken thing, and a
 * reset that aborts on the first error would leave the app exactly as unusable
 * as it was.
 */

import { closeDb, DB_NAME } from './db';

/** What actually succeeded. Surfaced in the recovery screen's detail block. */
export interface HardResetReport {
  localStorage: boolean;
  caches: boolean;
  indexedDB: boolean;
  serviceWorker: boolean;
}

/**
 * `deleteDatabase` has no timeout of its own: another tab holding a connection
 * makes it fire `blocked` and then wait forever. The reset must not hang on
 * that, so an unanswered delete is reported as a failure and the rest of the
 * wipe still lands.
 */
const DELETE_TIMEOUT_MS = 3000;

function deleteDatabase(name: string, timeoutMs = DELETE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(true); // nothing to delete
      return;
    }
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => finish(true);
      req.onerror = () => finish(false);
      // `onblocked` deliberately does nothing: the timeout is the answer, and
      // the delete may still complete once the other tab goes away.
    } catch {
      finish(false);
    }
  });
}

export async function hardReset(): Promise<HardResetReport> {
  const report: HardResetReport = {
    localStorage: false,
    caches: false,
    indexedDB: false,
    serviceWorker: false,
  };

  try {
    localStorage.clear();
    report.localStorage = true;
  } catch {
    /* private mode / storage disabled — nothing stored to clear either */
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    report.caches = true;
  } catch {
    /* Cache API unavailable or already gone */
  }

  // Must precede the delete: our own open connection would block it.
  closeDb();
  report.indexedDB = await deleteDatabase(DB_NAME);

  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    report.serviceWorker = true;
  } catch {
    /* no SW (dev, or an unsupported browser) */
  }

  return report;
}
