import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The sync id is a bearer token for the whole row, so the first test here is
 * that it never reaches a URL. The rest pin the two behaviours the orchestrator
 * builds on: a 409 hands back the winning blob (so one retry converges), and a
 * 503 means "try later", never "you are unpaired".
 */

vi.mock('../feeds/proxy-chain', () => ({ API_BASE: 'https://api.test' }));

const SYNC_ID = 'A'.repeat(43);
const CAP = 32 * 1024;

async function loadTransport(enabled = '1'): Promise<typeof import('./transport')> {
  vi.stubEnv('VITE_SYNC', enabled);
  vi.resetModules();
  return import('./transport');
}

function res(
  status: number,
  opts: { body?: Uint8Array; headers?: Record<string, string> } = {},
): Response {
  const body = status === 204 ? null : (opts.body ?? new Uint8Array(0));
  return new Response(body as unknown as BodyInit, { status, headers: opts.headers ?? {} });
}

function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn(async () => responses[Math.min(i++, responses.length - 1)] as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const call = fn.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('pullBlob', () => {
  it('sends the sync id in a header and never in the url', async () => {
    const { pullBlob } = await loadTransport();
    const fetchMock = stubFetch(res(404));

    await pullBlob(SYNC_ID);

    const { url, init } = lastCall(fetchMock);
    expect(url).not.toContain(SYNC_ID);
    expect((init.headers as Record<string, string>)['x-sync-id']).toBe(SYNC_ID);
  });

  it('reports an empty remote rather than an error when nothing was ever pushed', async () => {
    const { pullBlob } = await loadTransport();
    stubFetch(res(404));

    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'empty' });
  });

  it('returns the stored blob and its rev', async () => {
    const { pullBlob } = await loadTransport();
    const blob = Uint8Array.from([1, 2, 3, 4]);
    stubFetch(res(200, { body: blob, headers: { etag: '"7"' } }));

    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'ok', blob, rev: 7 });
  });

  it('records the clock skew from the round-trip midpoint', async () => {
    const { pullBlob, getSkewMs } = await loadTransport();
    // Request leaves at 1000, reply lands at 3000: the server was read at 2000.
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    stubFetch(res(404, { headers: { 'x-sync-time': String(2000 + 3_600_000) } }));

    await pullBlob(SYNC_ID);

    expect(getSkewMs()).toBe(3_600_000);
  });

  it('treats a sub-two-second reading as no skew at all', async () => {
    const { pullBlob, getSkewMs } = await loadTransport();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    stubFetch(res(404, { headers: { 'x-sync-time': '3500' } }));

    await pullBlob(SYNC_ID);

    expect(getSkewMs()).toBe(0);
  });

  it('reports a disabled server as unavailable', async () => {
    const { pullBlob } = await loadTransport();
    stubFetch(res(503));

    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'unavailable' });
  });

  it('surfaces retry-after on a rate limit', async () => {
    const { pullBlob } = await loadTransport();
    stubFetch(res(429, { headers: { 'retry-after': '60' } }));

    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'error', retryAfterMs: 60_000 });
  });

  it('reports a network failure as an error rather than throwing', async () => {
    const { pullBlob } = await loadTransport();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'error', retryAfterMs: 0 });
  });
});

describe('pushBlob', () => {
  it('sends the last known rev as if-match', async () => {
    const { pushBlob } = await loadTransport();
    const fetchMock = stubFetch(res(204, { headers: { etag: '"4"' } }));

    await pushBlob(SYNC_ID, Uint8Array.from([1]), 3);

    const headers = lastCall(fetchMock).init.headers as Record<string, string>;
    expect(headers['if-match']).toBe('"3"');
    expect(headers['content-type']).toBe('application/octet-stream');
  });

  it('reports the new rev after a successful push', async () => {
    const { pushBlob } = await loadTransport();
    stubFetch(res(204, { headers: { etag: '"4"' } }));

    expect(await pushBlob(SYNC_ID, Uint8Array.from([1]), 3)).toEqual({ kind: 'ok', rev: 4 });
  });

  it('hands back the winning blob on a conflict, without a second request', async () => {
    const { pushBlob } = await loadTransport();
    const winner = Uint8Array.from([9, 8, 7]);
    const fetchMock = stubFetch(res(409, { body: winner, headers: { etag: '"5"' } }));

    expect(await pushBlob(SYNC_ID, Uint8Array.from([1]), 3)).toEqual({
      kind: 'conflict',
      blob: winner,
      rev: 5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['under the keepalive cap', 1000, true],
    ['over the keepalive cap', CAP + 1, false],
  ])('%s: keepalive is %s', async (_label, size, allowed) => {
    const { pushBlob } = await loadTransport();
    const fetchMock = stubFetch(res(204, { headers: { etag: '"1"' } }));

    const out = await pushBlob(SYNC_ID, new Uint8Array(size), 0, { keepalive: true });

    if (allowed) {
      expect(lastCall(fetchMock).init.keepalive).toBe(true);
    } else {
      // Skipped, not downgraded: a plain fetch at unload is cancelled anyway.
      expect(out).toEqual({ kind: 'skipped' });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('still sends a large payload when it is not an unload-time push', async () => {
    const { pushBlob } = await loadTransport();
    const fetchMock = stubFetch(res(204, { headers: { etag: '"1"' } }));

    await pushBlob(SYNC_ID, new Uint8Array(CAP + 1), 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('when the feature is switched off', () => {
  it('makes no request at all', async () => {
    const { pullBlob, pushBlob, deleteBlob, SYNC_AVAILABLE } = await loadTransport('0');
    const fetchMock = stubFetch(res(200));

    expect(SYNC_AVAILABLE).toBe(false);
    expect(await pullBlob(SYNC_ID)).toEqual({ kind: 'unavailable' });
    expect(await pushBlob(SYNC_ID, Uint8Array.from([1]), 0)).toEqual({ kind: 'unavailable' });
    expect(await deleteBlob(SYNC_ID)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
