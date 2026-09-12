/**
 * A diagnostic snapshot, for pasting into a bug report.
 *
 * The app collects nothing and sends nothing, which is the right default and
 * also means a report arrives as "it stopped working" with no way to tell a
 * broken feed from a full disk from a build three versions old. This closes
 * that gap without giving anything up: it is assembled on demand, it goes to
 * the clipboard, and nothing here leaves the device unless the person reading
 * it decides to paste it somewhere.
 *
 * What it must never contain: the sync pairing code (it is the only credential
 * for the whole synced copy), any feed URL (a private feed's URL *is* a
 * subscriber token — see `credential-url.ts`), or an episode title. Counts and
 * capabilities only.
 */

import { API_BASE } from '../feeds/proxy-chain';
import { SYNC_AVAILABLE } from '../sync/transport';
import { feedCacheInfo } from '../storage/db';
import { inbox } from '../feeds/inbox';
import { playedSnapshot } from '../storage/played';
import { progressSnapshot } from '../storage/progress';
import { queue } from '../state/queue';
import { settings } from '../state/settings';
import { storageInfo } from '../player/offline';
import { subscriptions } from '../storage/subscriptions';
import { feedSpeedCount } from '../state/feed-speed';

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** One `key: value` per line — the shape that survives a paste into an issue. */
export async function collectDiagnostics(): Promise<string> {
  const s = settings();
  const storage = await storageInfo();
  const feeds = await feedCacheInfo();
  const progress = progressSnapshot();
  const heard = playedSnapshot();

  const lines: string[] = [
    `seseri: ${__APP_VERSION__ || 'dev'}`,
    `when: ${new Date().toISOString()}`,
    `ua: ${navigator.userAgent}`,
    `languages: ui=${s.lang} browser=${navigator.language}`,
    `display: ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
    // Guarded the way `theme.ts` guards it: not every webview has it, and a
    // diagnostics button that throws is worse than one that says less.
    `standalone: ${typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)').matches : 'unknown'}`,
    `online: ${navigator.onLine}`,
    // Whether a backend is configured, never which one.
    `worker: ${API_BASE ? 'configured' : 'none'}`,
    `sync: ${SYNC_AVAILABLE ? 'available' : 'off at build time'}`,
    `public proxies: ${s.allowPublicProxies ? 'allowed' : 'off'}`,
    `prefetch: ${s.prefetchAudio}`,
    `subscriptions: ${subscriptions().length}`,
    `queue: ${queue().length}`,
    `inbox: ${inbox().length}`,
    `saved positions: ${Object.keys(progress.prog).length}`,
    `played marks: ${Object.keys(heard.played).length} + ${Object.keys(heard.unplayed).length} reset`,
    `per-show speeds: ${feedSpeedCount()}`,
    `downloads: ${storage.downloadCount} (${mb(storage.downloadBytes)})`,
    `feed cache: ${feeds.count} feeds (~${mb(feeds.bytes)})`,
    `origin storage: ${mb(storage.usageBytes)} of ${mb(storage.quotaBytes)}`,
    `service worker: ${'serviceWorker' in navigator ? 'supported' : 'unsupported'}`,
  ];
  return lines.join('\n');
}
