import { API_BASE } from '../feeds/proxy-chain';

/**
 * Talking to `/v1/sync`.
 *
 * Two rules shape everything here. The sync id is a bearer token, so it travels
 * in a header and never in a URL — a URL lands in request logs, browser history
 * and `Referer`. And the client tracks the server's clock, because the payload
 * is encrypted and the server therefore cannot stamp anything inside it.
 */

/**
 * Sync has its own flag rather than riding on `VITE_API_BASE`: unsetting that
 * would also kill the feed and iTunes proxies, which is a far worse outage than
 * whatever sync bug prompted the rollback.
 */
export const SYNC_AVAILABLE: boolean = !!API_BASE && import.meta.env?.VITE_SYNC === '1';

const ENDPOINT = API_BASE + '/v1/sync';

const TIMEOUT_MS = 10_000;

/**
 * The 64 KiB keepalive allowance is shared across every in-flight keepalive
 * request on the page, so half of it is the honest working limit. Above it an
 * unload-time push is skipped rather than downgraded to a normal fetch, which
 * would be cancelled at unload anyway.
 */
const KEEPALIVE_MAX_BYTES = 32 * 1024;

/** Below this, the reading is network jitter and would churn on every call. */
const SKEW_FLOOR_MS = 2000;

export type PullResult =
  | { kind: 'ok'; blob: Uint8Array; rev: number }
  | { kind: 'empty' }
  | { kind: 'unavailable' }
  | { kind: 'error'; retryAfterMs: number };

export type PushResult =
  | { kind: 'ok'; rev: number }
  | { kind: 'conflict'; blob: Uint8Array; rev: number }
  | { kind: 'skipped' }
  | { kind: 'unavailable' }
  | { kind: 'error'; retryAfterMs: number };

let skewMs = 0;

export function getSkewMs(): number {
  return skewMs;
}

export function setSkewMs(value: number): void {
  skewMs = Number.isFinite(value) ? value : 0;
}

/** Round-trip compensated: the server's clock is read at the midpoint. */
function noteServerTime(res: Response, t0: number, t1: number): void {
  const stamp = Number(res.headers.get('x-sync-time'));
  if (!Number.isFinite(stamp) || stamp <= 0) return;
  const measured = stamp - (t0 + t1) / 2;
  skewMs = Math.abs(measured) < SKEW_FLOOR_MS ? 0 : measured;
}

function retryAfterMs(res: Response): number {
  const secs = Number(res.headers.get('retry-after'));
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
}

function revOf(res: Response): number {
  const raw = (res.headers.get('etag') ?? '').replace(/"/g, '');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function call(syncId: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(ENDPOINT, {
      ...init,
      signal: init.signal ?? ctrl.signal,
      credentials: 'omit',
      mode: 'cors',
      headers: { ...init.headers, 'x-sync-id': syncId },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function bytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

export async function pullBlob(syncId: string): Promise<PullResult> {
  if (!SYNC_AVAILABLE) return { kind: 'unavailable' };
  try {
    const t0 = Date.now();
    const res = await call(syncId, { method: 'GET' });
    noteServerTime(res, t0, Date.now());

    if (res.status === 404) return { kind: 'empty' };
    if (res.status === 503) return { kind: 'unavailable' };
    if (!res.ok) return { kind: 'error', retryAfterMs: retryAfterMs(res) };
    return { kind: 'ok', blob: await bytes(res), rev: revOf(res) };
  } catch {
    return { kind: 'error', retryAfterMs: 0 }; // offline, aborted, CORS
  }
}

export async function pushBlob(
  syncId: string,
  blob: Uint8Array,
  rev: number,
  opts: { keepalive?: boolean } = {},
): Promise<PushResult> {
  if (!SYNC_AVAILABLE) return { kind: 'unavailable' };
  const keepalive = opts.keepalive === true;
  if (keepalive && blob.byteLength > KEEPALIVE_MAX_BYTES) return { kind: 'skipped' };

  try {
    const t0 = Date.now();
    const res = await call(syncId, {
      method: 'PUT',
      body: blob as unknown as BodyInit,
      keepalive,
      headers: { 'content-type': 'application/octet-stream', 'if-match': '"' + rev + '"' },
    });
    noteServerTime(res, t0, Date.now());

    if (res.status === 204) return { kind: 'ok', rev: revOf(res) };
    // The winning blob comes back with the 409, so one retry converges instead
    // of needing a separate pull first.
    if (res.status === 409) return { kind: 'conflict', blob: await bytes(res), rev: revOf(res) };
    if (res.status === 503) return { kind: 'unavailable' };
    return { kind: 'error', retryAfterMs: retryAfterMs(res) };
  } catch {
    return { kind: 'error', retryAfterMs: 0 };
  }
}

export async function deleteBlob(syncId: string): Promise<boolean> {
  if (!SYNC_AVAILABLE) return false;
  try {
    const res = await call(syncId, { method: 'DELETE' });
    return res.status === 204;
  } catch {
    return false;
  }
}
