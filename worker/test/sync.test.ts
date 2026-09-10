import {
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env, RateLimiter } from '../src/env';

/**
 * The sync route is a blob store whose whole security model is "possession of
 * the id is the credential". So the tests care about three things above
 * correctness of the happy path: that the worker cannot read what it stores,
 * that a stale write is refused rather than silently winning, and that sync
 * cannot spend the budget the feed and iTunes proxies depend on.
 *
 * D1 here is a real local database, not a fake — the schema comes from
 * `migrations/`, applied by `test/apply-migrations.ts`.
 */

const APP_ORIGIN = 'https://iacbi.github.io';
const OCTET = 'application/octet-stream';

let idSeq = 0;

/** A distinct id per test: rows stay isolated and the per-id limiter does not
 *  accumulate across the file. */
function freshId(): string {
  return ('id' + ++idSeq).padEnd(43, 'x');
}

interface CallOpts {
  id?: string | null;
  ifMatch?: string;
  body?: Uint8Array;
  contentType?: string | null;
  origin?: string | null;
  ip?: string;
  env?: Partial<Env>;
}

async function syncCall(method: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers['origin'] = opts.origin ?? APP_ORIGIN;
  if (opts.id !== null) headers['x-sync-id'] = opts.id ?? freshId();
  if (opts.ifMatch !== undefined) headers['if-match'] = opts.ifMatch;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  if (opts.body && opts.contentType !== null) headers['content-type'] = opts.contentType ?? OCTET;

  const ctx = createExecutionContext();
  const req = new Request('https://api.test/v1/sync', {
    method,
    headers,
    ...(opts.body ? { body: opts.body as unknown as BodyInit } : {}),
  });
  const res = await worker.fetch(req, { ...env, ...opts.env }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function bodyBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

function blob(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

function randomBlob(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** `getRandomValues` caps at 64 KiB, and the size tests only care about length. */
function filledBlob(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_v, i) => i & 255);
}

async function rowCount(): Promise<number> {
  const r = await env.DB.prepare('SELECT count(*) AS n FROM sync').first<{ n: number }>();
  return r?.n ?? 0;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM sync').run();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('GET /v1/sync', () => {
  it('reports an unknown id as having no data rather than as an error', async () => {
    const res = await syncCall('GET');

    expect(res.status).toBe(404);
    expect(res.headers.get('x-sync-time')).toMatch(/^\d+$/);
  });

  it('returns exactly the bytes that were pushed', async () => {
    const id = freshId();
    const payload = randomBlob(256);
    await syncCall('PUT', { id, ifMatch: '"0"', body: payload });

    const res = await syncCall('GET', { id });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(OCTET);
    expect(await bodyBytes(res)).toEqual(payload);
  });
});

describe('PUT /v1/sync', () => {
  it('creates the row at rev 1', async () => {
    const res = await syncCall('PUT', { ifMatch: '"0"', body: blob(1, 2, 3) });

    expect(res.status).toBe(204);
    expect(res.headers.get('etag')).toBe('"1"');
  });

  it('stores ciphertext it cannot itself read', async () => {
    const id = freshId();
    // Not valid UTF-8 and not valid JSON — what a real sealed blob looks like.
    const cipher = blob(2, 0xff, 0xfe, 0x00, 0x80, 0xc0, 0x01, 0xf7, 0x9a);
    await syncCall('PUT', { id, ifMatch: '"0"', body: cipher });

    const row = await env.DB.prepare('SELECT blob FROM sync WHERE id = ?')
      .bind(id)
      .first<{ blob: ArrayBuffer }>();

    expect(new Uint8Array(row?.blob ?? new ArrayBuffer(0))).toEqual(cipher);
    expect(() => JSON.parse(new TextDecoder().decode(row?.blob))).toThrow();
  });

  it('refuses a push built on a stale rev and hands back the winning blob', async () => {
    // Without this, the second device's write would overwrite the first's
    // entries wholesale and the merge would never run.
    const id = freshId();
    const a = randomBlob(32);
    const b = randomBlob(48);
    const c = randomBlob(64);
    await syncCall('PUT', { id, ifMatch: '"0"', body: a });
    await syncCall('PUT', { id, ifMatch: '"1"', body: b });

    const res = await syncCall('PUT', { id, ifMatch: '"1"', body: c });

    expect(res.status).toBe(409);
    expect(res.headers.get('etag')).toBe('"2"');
    expect(res.headers.get('x-sync-conflict')).toBe('1');
    expect(await bodyBytes(res)).toEqual(b);
    expect(await bodyBytes(await syncCall('GET', { id }))).toEqual(b);
  });

  it('refuses a create when the row already exists', async () => {
    const id = freshId();
    await syncCall('PUT', { id, ifMatch: '"0"', body: blob(1) });

    const res = await syncCall('PUT', { id, ifMatch: '"0"', body: blob(2) });

    expect(res.status).toBe(409);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['non-numeric', '"abc"'],
    ['a wildcard', '*'],
  ])('rejects a push whose if-match is %s', async (_label, ifMatch) => {
    const opts: CallOpts = { body: blob(1, 2, 3) };
    if (ifMatch !== undefined) opts.ifMatch = ifMatch;

    const res = await syncCall('PUT', opts);

    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it('rejects a body over the cap and does not create a row', async () => {
    const res = await syncCall('PUT', {
      ifMatch: '"0"',
      body: filledBlob(128 * 1024 + 1),
    });

    expect(res.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  it('accepts a body of exactly the cap', async () => {
    const res = await syncCall('PUT', { ifMatch: '"0"', body: filledBlob(128 * 1024) });

    expect(res.status).toBe(204);
  });

  it('rejects a body that is not an octet stream', async () => {
    const res = await syncCall('PUT', {
      ifMatch: '"0"',
      body: blob(1, 2, 3),
      contentType: 'application/json',
    });

    expect(res.status).toBe(415);
  });

  it('rejects an empty body', async () => {
    const res = await syncCall('PUT', { ifMatch: '"0"', body: new Uint8Array(0) });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/sync', () => {
  it('removes the row, and a later pull reports no data', async () => {
    const id = freshId();
    await syncCall('PUT', { id, ifMatch: '"0"', body: blob(1, 2, 3) });

    const res = await syncCall('DELETE', { id });

    expect(res.status).toBe(204);
    expect((await syncCall('GET', { id })).status).toBe(404);
    expect(await rowCount()).toBe(0);
  });

  it('answers the same for an id that never existed, so nothing can be probed', async () => {
    const res = await syncCall('DELETE');

    expect(res.status).toBe(204);
  });
});

describe('sync id validation', () => {
  it.each([
    ['absent', null],
    ['empty', ''],
    ['too short', 'short'],
    ['too long', 'a'.repeat(100)],
    ['base64 rather than base64url', 'a'.repeat(41) + '+/'],
  ])('rejects an id that is %s', async (_label, id) => {
    const res = await syncCall('GET', { id });

    expect(res.status).toBe(400);
  });
});

describe('sync and the shared budgets', () => {
  /**
   * A stand-in for the limiter namespace that records the instance names it is
   * asked for and answers with a fixed verdict. The name is the only place the
   * budget's identity lives, so this is how "never the raw code" is checked.
   */
  function spyLimiters(retryAfterMs = 0): {
    ns: Env['LIMITERS'];
    seen: string[];
  } {
    const seen: string[] = [];
    const ns = {
      idFromName: (name: string) => {
        seen.push(name);
        return name as unknown as DurableObjectId;
      },
      get: () => ({ take: () => retryAfterMs }),
    } as unknown as Env['LIMITERS'];
    return { ns, seen };
  }

  it('does not spend the budget the proxies depend on', async () => {
    // Sync is chatty by design — every device pushes on every change — and the
    // proxies are what a listener notices when they are gone. Separate budgets,
    // so a busy sync cannot refuse a feed refresh.
    const { ns, seen } = spyLimiters();

    for (let i = 0; i < 5; i++) {
      await syncCall('GET', { ip: '203.0.113.9', env: { LIMITERS: ns } });
    }
    expect(seen.filter((k) => k.startsWith('proxy:'))).toEqual([]);

    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/pod.xml' })
      .reply(200, '<rss></rss>', { headers: { 'content-type': 'application/rss+xml' } });
    const ctx = createExecutionContext();
    await worker.fetch(
      new Request('https://api.test/v1/feed?url=https%3A%2F%2Ffeeds.example.com%2Fpod.xml', {
        headers: { origin: APP_ORIGIN, 'cf-connecting-ip': '203.0.113.9' },
      }),
      { ...env, LIMITERS: ns },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(seen.filter((k) => k.startsWith('proxy:'))).toEqual(['proxy:203.0.113.9']);
  });

  it('counts against a hash of the sync id, never the id itself', async () => {
    const id = freshId();
    const { ns, seen } = spyLimiters();

    await syncCall('GET', { id, ip: '203.0.113.10', env: { LIMITERS: ns } });

    expect(seen).toEqual(['sync-ip:203.0.113.10', expect.stringMatching(/^sync-id:[0-9a-f]{64}$/)]);
    expect(seen.join()).not.toContain(id);
  });

  it('turns a refusal into a 429 the client can back off on', async () => {
    const { ns } = spyLimiters(5000);

    const res = await syncCall('GET', { ip: '198.51.100.7', env: { LIMITERS: ns } });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('falls back to the platform limiter when the object cannot be reached', async () => {
    // Unreachable must not mean unlimited: that is exactly how the KV counter
    // failed, and it failed silently for every caller on every route.
    const broken = {
      idFromName: () => {
        throw new Error('no limiters here');
      },
    } as unknown as Env['LIMITERS'];
    const full: RateLimiter = { limit: async () => ({ success: false }) };

    const res = await syncCall('GET', {
      ip: '198.51.100.9',
      env: { LIMITERS: broken, SYNC_IP: full },
    });

    expect(res.status).toBe(429);
  });

  it('enforces the per-IP budget against the real object', async () => {
    // 60 a minute, counted in one place rather than per machine — so the
    // refusal lands right after the budget, not at the 130th and not never.
    // The exact index floats by a few when the loop straddles a window
    // boundary; the first 60 are always allowed.
    const ip = '198.51.100.8';
    const id = freshId();
    const codes: number[] = [];

    for (let i = 0; i < 70; i++) codes.push((await syncCall('GET', { id, ip })).status);

    expect(codes.slice(0, 60)).toEqual(Array<number>(60).fill(404));
    expect(codes).toContain(429);
  });

  it('refuses without asking the object again once a client is over budget', async () => {
    // The flood is the cheap path: a refusal is remembered in the isolate, so
    // it costs nothing to keep saying no until the window rolls over.
    const ip = '198.51.100.11';
    const id = freshId();
    for (let i = 0; i < 70; i++) await syncCall('GET', { id, ip });

    const broken = {
      idFromName: () => {
        throw new Error('must not be consulted');
      },
    } as unknown as Env['LIMITERS'];

    expect((await syncCall('GET', { id, ip, env: { LIMITERS: broken } })).status).toBe(429);
  });
});

describe('CORS', () => {
  it('allows a push preflight to carry x-sync-id and if-match', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request('https://api.test/v1/sync', {
        method: 'OPTIONS',
        headers: {
          origin: APP_ORIGIN,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'x-sync-id,if-match,content-type',
        },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(allowed).toContain('x-sync-id');
    expect(allowed).toContain('if-match');
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });

  it('exposes the headers the client needs to follow compare-and-set', async () => {
    const exposed = (
      (await syncCall('GET')).headers.get('access-control-expose-headers') ?? ''
    ).toLowerCase();

    expect(exposed).toContain('etag');
    expect(exposed).toContain('x-sync-time');
  });

  it.each([
    ['a foreign origin', 'https://evil.example'],
    ['no origin at all', null],
  ])('refuses a sync request from %s', async (_label, origin) => {
    const res = await syncCall('GET', { origin });

    expect(res.status).toBe(403);
  });
});

describe('caching', () => {
  it('never lets a blob reach a shared cache', async () => {
    const id = freshId();
    await syncCall('PUT', { id, ifMatch: '"0"', body: blob(1, 2, 3) });

    const res = await syncCall('GET', { id });

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-seseri-cache')).toBeNull();
  });
});

describe('kill switch', () => {
  it('answers 503 on every sync route while the feed proxy keeps working', async () => {
    const off = { SYNC_DISABLED: '1' };

    for (const method of ['GET', 'PUT', 'DELETE']) {
      const opts: CallOpts = { env: off };
      if (method === 'PUT') {
        opts.ifMatch = '"0"';
        opts.body = blob(1);
      }
      const res = await syncCall(method, opts);
      expect(res.status).toBe(503);
    }

    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/live.xml' })
      .reply(200, '<rss></rss>', { headers: { 'content-type': 'application/rss+xml' } });
    const ctx = createExecutionContext();
    const feed = await worker.fetch(
      new Request('https://api.test/v1/feed?url=https%3A%2F%2Ffeeds.example.com%2Flive.xml', {
        headers: { origin: APP_ORIGIN },
      }),
      { ...env, ...off },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(feed.status).toBe(200);
  });
});

describe('retention sweep', () => {
  it('deletes rows untouched past the retention window and keeps the rest', async () => {
    const now = Date.now();
    const old = freshId();
    const recent = freshId();
    const insert = 'INSERT INTO sync (id, rev, blob, size, updated_at) VALUES (?, 1, ?, 1, ?)';
    await env.DB.prepare(insert)
      .bind(old, blob(1), now - 181 * 24 * 60 * 60 * 1000)
      .run();
    await env.DB.prepare(insert)
      .bind(recent, blob(1), now - 30 * 24 * 60 * 60 * 1000)
      .run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '17 4 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    const left = await env.DB.prepare('SELECT id FROM sync').all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual([recent]);
  });
});
