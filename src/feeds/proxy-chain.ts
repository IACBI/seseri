/**
 * Network layer for feed/API access.
 * Order of preference: own Worker (VITE_API_BASE, added in P4) → public CORS
 * proxies raced in parallel. Every attempt has its own timeout so a hanging
 * proxy never blocks a load (legacy behavior preserved).
 */

export type ProxyFn = (url: string) => string;

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

/** One JSON GET with its own timeout + the load's abort signal. */
export async function svcJson<T = unknown>(
  url: string,
  signal?: AbortSignal,
  perTimeout = 8000,
): Promise<T> {
  const res = await fetchWithTimeout(url, signal, perTimeout);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as T;
}

/**
 * Race a path across several instances; resolve {base, json} for the first
 * that passes `valid` (dead/empty instances are skipped).
 */
export async function svcFirst<T>(
  bases: readonly string[],
  path: string,
  signal: AbortSignal | undefined,
  valid: (json: T) => boolean,
): Promise<{ base: string; json: T }> {
  if (signal?.aborted) throw abortError();
  try {
    return await Promise.any(
      bases.map(async (base) => {
        const json = await svcJson<T>(base + path, signal);
        if (!valid(json)) throw new Error('invalid');
        return { base, json };
      }),
    );
  } catch {
    if (signal?.aborted) throw abortError();
    throw new Error('no instance');
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
