/**
 * Skipping the Worker for iTunes while Apple refuses it.
 *
 * Apple has answered the Worker's lookups with 403 and its searches with 429
 * from Cloudflare's egress. The app survived — it falls back to Apple directly
 * — but every call paid a round trip to the Worker first. The Worker's answers
 * below are the exact bodies it sends in that case (`worker/src/index.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.test';
const LOOKUP = 'https://itunes.apple.com/lookup?id=1200361736';
const APPLE = { resultCount: 1, results: [{ collectionName: 'The Daily' }] };

type WorkerAnswer = Response | 'unreachable';

/** Routes the Worker and Apple separately, and counts what each was asked. */
function network(worker: () => WorkerAnswer) {
  const calls = { worker: 0, apple: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(API)) {
        calls.worker++;
        const answer = worker();
        if (answer === 'unreachable') throw new TypeError('Failed to fetch');
        return answer;
      }
      if (url.startsWith('https://itunes.apple.com/')) {
        calls.apple++;
        return Response.json(APPLE);
      }
      throw new Error('unexpected request: ' + url);
    }),
  );
  return calls;
}

const refused = (upstream: number) =>
  Response.json({ error: 'upstream ' + upstream }, { status: 502 });

async function load() {
  vi.stubEnv('VITE_API_BASE', API);
  vi.resetModules();
  return import('./proxy-chain');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('itunesFetch and an Apple that refuses the Worker', () => {
  it.each([403, 429])('skips the Worker after it reports upstream %s', async (status) => {
    const calls = network(() => refused(status));
    const { itunesFetch } = await load();

    expect(await itunesFetch(LOOKUP)).toEqual(APPLE); // falls back, as before
    expect(calls).toEqual({ worker: 1, apple: 1 });

    expect(await itunesFetch(LOOKUP)).toEqual(APPLE);
    expect(await itunesFetch(LOOKUP)).toEqual(APPLE);
    expect(calls).toEqual({ worker: 1, apple: 3 }); // no more detours
  });

  it("does the same for the Worker's own rate limit", async () => {
    const calls = network(() => Response.json({ error: 'rate limited' }, { status: 429 }));
    const { itunesFetch } = await load();
    await itunesFetch(LOOKUP);
    await itunesFetch(LOOKUP);
    expect(calls.worker).toBe(1);
  });

  it('tries the Worker again once the bypass has run its course', async () => {
    let answer: WorkerAnswer = refused(403);
    const calls = network(() => answer);
    const { itunesFetch, ITUNES_BYPASS_MS } = await load();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    await itunesFetch(LOOKUP);
    clock.mockReturnValue(now + ITUNES_BYPASS_MS - 1);
    await itunesFetch(LOOKUP);
    expect(calls.worker).toBe(1);

    answer = Response.json({ resultCount: 0, results: [] });
    clock.mockReturnValue(now + ITUNES_BYPASS_MS);
    expect(await itunesFetch(LOOKUP)).toEqual({ resultCount: 0, results: [] });
    expect(calls.worker).toBe(2);
  });

  it.each<[string, () => WorkerAnswer]>([
    ['an unreachable Worker', () => 'unreachable'],
    ['a rejected URL', () => Response.json({ error: 'invalid url' }, { status: 400 })],
    ['an upstream server error', () => refused(500)],
    ['an upstream timeout', () => Response.json({ error: 'upstream timeout' }, { status: 504 })],
    ['a 502 that is not JSON', () => new Response('<html>Bad gateway</html>', { status: 502 })],
  ])('keeps asking the Worker after %s, which is not a refusal', async (_label, answer) => {
    const calls = network(answer);
    const { itunesFetch } = await load();
    await itunesFetch(LOOKUP);
    await itunesFetch(LOOKUP);
    expect(calls).toEqual({ worker: 2, apple: 2 });
  });

  it('never leaves the Worker while it answers', async () => {
    const calls = network(() => Response.json(APPLE));
    const { itunesFetch } = await load();
    await itunesFetch(LOOKUP);
    await itunesFetch(LOOKUP);
    expect(calls).toEqual({ worker: 2, apple: 0 });
  });
});
