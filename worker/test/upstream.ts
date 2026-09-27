import { vi } from 'vitest';

/**
 * Upstream mocking for the Worker's own outbound `fetch`.
 *
 * `fetchMock` from `cloudflare:test` was removed in vitest-pool-workers 0.22;
 * the documented replacement is to mock `globalThis.fetch`. This keeps the
 * part of the old API these tests used — `get(origin).intercept({ path })
 * .reply(...)`, `.times(n)`, no real network, and a check that every expected
 * upstream call happened — so the tests themselves did not have to change.
 *
 * Each interceptor answers once unless `.times(n)` says otherwise, and a
 * request nothing intercepts fails the way a refused connection does: the
 * tests must never reach the real network.
 */

type Body = string | Uint8Array | ArrayBuffer | null;

interface Interceptor {
  origin: string;
  path: string | RegExp;
  method: string;
  status: number;
  body: Body;
  headers: Record<string, string>;
  remaining: number;
}

const interceptors: Interceptor[] = [];

function matches(i: Interceptor, method: string, url: URL): boolean {
  if (i.remaining <= 0 || i.origin !== url.origin || i.method !== method) return false;
  const path = url.pathname + url.search;
  return typeof i.path === 'string' ? i.path === path : i.path.test(path);
}

async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const hit = interceptors.find((i) => matches(i, request.method, url));
  if (!hit) throw new TypeError(`no upstream mock for ${request.method} ${url.href}`);
  hit.remaining--;
  const empty = hit.status === 204 || hit.status === 304;
  const res = new Response(empty ? null : (hit.body as BodyInit | null), {
    status: hit.status,
    headers: hit.headers,
  });
  // `new Response(string)` adds `text/plain`; an upstream that sends no
  // content type must reach the Worker without one, as it would for real.
  const declared = Object.keys(hit.headers).some((k) => k.toLowerCase() === 'content-type');
  if (!declared) res.headers.delete('content-type');
  return res;
}

export const fetchMock = {
  /** Route every outbound `fetch` through the interceptors. */
  activate(): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation(answer);
  },
  /** Already the case: an unmatched request always fails. Kept for readability. */
  disableNetConnect(): void {},
  get(origin: string) {
    return {
      intercept({ path, method = 'GET' }: { path: string | RegExp; method?: string }) {
        return {
          reply(status: number, body: Body = '', opts: { headers?: Record<string, string> } = {}) {
            const i: Interceptor = {
              origin: new URL(origin).origin,
              path,
              method: method.toUpperCase(),
              status,
              body,
              headers: opts.headers ?? {},
              remaining: 1,
            };
            interceptors.push(i);
            return {
              times(n: number): void {
                i.remaining = n;
              },
            };
          },
        };
      },
    };
  },
  /** Every interceptor a test set up was used; clears them for the next test. */
  assertNoPendingInterceptors(): void {
    const left = interceptors.filter((i) => i.remaining > 0);
    interceptors.length = 0;
    if (left.length) {
      throw new Error(
        'upstream mocks never called: ' +
          left.map((i) => `${i.method} ${i.origin}${i.path}`).join(', '),
      );
    }
  },
};
