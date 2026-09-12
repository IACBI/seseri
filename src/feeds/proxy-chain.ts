/**
 * Network layer for feed/API access.
 * Order of preference: own Worker (VITE_API_BASE, added in P4) → public CORS
 * proxies raced in parallel. Every attempt has its own timeout so a hanging
 * proxy never blocks a load (legacy behavior preserved).
 */

import { settings } from '../state/settings';
import type { Episode } from './types';
import { carriesCredential, PRIVATE_FEED_ERROR } from './credential-url';

export type ProxyFn = (url: string) => string;

/**
 * Thrown when the Worker could not answer and the third-party proxy fallback
 * is switched off (the default). Recognised by the UI so it can explain the
 * setting instead of showing a generic network failure.
 */
export const PROXIES_DISABLED_ERROR = 'proxies-disabled';

/**
 * True when the user has opted into the third-party CORS proxies. They are off
 * by default: three operators are raced for every feed, so each of them learns
 * what the user listens to, and whichever answers first decides what the app
 * parses — enclosure URLs included.
 */
function publicProxiesAllowed(): boolean {
  return settings().allowPublicProxies;
}

/** Public CORS proxies (feeds rarely send CORS headers themselves). */
export const RSS_PROXIES: ProxyFn[] = [
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
];

/** Own backend (Cloudflare Worker) — empty string disables it. */
export const API_BASE: string = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/+$/, '');

function abortError(): DOMException {
  return new DOMException('aborted', 'AbortError');
}

/** fetch with a per-attempt timeout linked to an outer signal. */
export function fetchWithTimeout(
  url: string,
  outerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onAbort, { once: true });
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { signal: ctrl.signal, credentials: 'omit', mode: 'cors' }).finally(() => {
    clearTimeout(to);
    outerSignal?.removeEventListener('abort', onAbort);
  });
}

/** What `/v1/parse` answers with: the feed, already parsed, minus the bulk. */
export interface ParsedFeedResponse {
  meta: { name: string; artist: string; art: string };
  /** Episodes the feed contains, whatever slice was returned. */
  total: number;
  offset: number;
  episodes: Episode[];
}

/**
 * Ask the Worker to parse the feed and hand back JSON.
 *
 * Returns null — rather than throwing — whenever this route cannot answer, so
 * the caller falls through to the raw-XML path it has always had. That covers
 * a build with no Worker configured, a Worker that is down, and an older
 * Worker deployment that has no `/v1/parse` yet (it answers 404).
 *
 * Show notes are left out by default. They are most of a feed's bytes and none
 * of a list's content: The Daily's archive is 1.31 MB of brotli as XML and
 * 0.28 MB as a notes-free JSON list. `fetchEpisodeNotes` fills in the one
 * episode that is about to be read.
 */
export async function fetchParsedFeed(
  url: string,
  signal?: AbortSignal,
  { notes = false, perTimeout = 20000 }: { notes?: boolean; perTimeout?: number } = {},
): Promise<ParsedFeedResponse | null> {
  if (!API_BASE) return null;
  if (signal?.aborted) throw abortError();
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/v1/parse?url=${encodeURIComponent(url)}${notes ? '' : '&notes=0'}`,
      signal,
      perTimeout,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as ParsedFeedResponse;
    // A 200 with nothing in it is not an answer; let the XML path try.
    if (!body || !Array.isArray(body.episodes) || !body.episodes.length) return null;
    return body;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/**
 * The show notes for a single episode, from the document the Worker has
 * already parsed and cached. `''` when there are none, or when the notes
 * cannot be reached — the caller cannot tell the difference and does not need
 * to; both mean "nothing to render".
 */
export async function fetchEpisodeNotes(
  url: string,
  trackId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!API_BASE || !trackId) return '';
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/v1/parse?url=${encodeURIComponent(url)}&notesFor=${encodeURIComponent(trackId)}`,
      signal,
      10000,
    );
    if (!res.ok) return '';
    const body = (await res.json()) as ParsedFeedResponse;
    return body?.episodes?.[0]?.description ?? '';
  } catch {
    return '';
  }
}

/**
 * Fetch a text feed. Worker first (when configured), then all public proxies
 * in parallel — first non-empty body wins.
 */
export async function fetchTextProxied(
  url: string,
  outerSignal?: AbortSignal,
  perTimeout = 15000,
): Promise<string> {
  if (outerSignal?.aborted) throw abortError();

  if (API_BASE) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/v1/feed?url=${encodeURIComponent(url)}`,
        outerSignal,
        perTimeout,
      );
      if (res.ok) {
        const txt = await res.text();
        if (txt.trim()) return txt;
      }
    } catch (e) {
      if (outerSignal?.aborted) throw e;
      // Worker down → fall through to public proxies
    }
  }

  // A credential-bearing feed URL must never reach a public proxy operator —
  // and all three are raced in parallel, so it would leak to three at once.
  if (carriesCredential(url)) throw new Error(PRIVATE_FEED_ERROR);
  if (!publicProxiesAllowed()) throw new Error(PROXIES_DISABLED_ERROR);

  const attempts = RSS_PROXIES.map((proxy) =>
    fetchWithTimeout(proxy(url), outerSignal, perTimeout)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((txt) => {
        if (!txt || !txt.trim()) throw new Error('empty response');
        return txt;
      }),
  );
  try {
    return await Promise.any(attempts);
  } catch {
    if (outerSignal?.aborted) throw abortError();
    throw new Error('fetch failed');
  }
}

/**
 * Fetch JSON from the iTunes API, working around its CDN CORS bug: responses
 * are cached without varying on Origin, so a cache-busting param forces a
 * fresh, correctly-attributed response. Worker (P4) → direct → proxies.
 */
export async function itunesFetch<T = unknown>(url: string, signal?: AbortSignal): Promise<T> {
  const bust =
    url +
    (url.includes('?') ? '&' : '?') +
    '_cb=' +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);

  if (API_BASE) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/v1/itunes?url=${encodeURIComponent(url)}`,
        signal,
        10000,
      );
      if (res.ok) return (await res.json()) as T;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }

  try {
    const res = await fetch(bust, { signal: signal ?? null, credentials: 'omit', mode: 'cors', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    if (!publicProxiesAllowed()) throw e;
    for (const proxy of RSS_PROXIES) {
      try {
        const res = await fetch(proxy(bust), {
          signal: signal ?? null,
          credentials: 'omit',
          mode: 'cors',
          cache: 'no-store',
        });
        if (!res.ok) continue;
        return JSON.parse(await res.text()) as T;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
      }
    }
    throw e;
  }
}
