import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchWithTimeout,
  inflightDrainBytes,
  isPrivateHost,
  readCapped,
  safeTarget,
} from '../src/safe-fetch';
import { clientKey } from '../src/ratelimit';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('isPrivateHost', () => {
  // These four passed the old regex. IPv4-mapped IPv6 is the dangerous one:
  // the URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, which no longer
  // looks like loopback to a textual match.
  it.each([
    ['[::ffff:127.0.0.1]', 'IPv4-mapped loopback'],
    ['[::ffff:7f00:1]', 'IPv4-mapped loopback, normalized'],
    ['[::ffff:169.254.169.254]', 'IPv4-mapped cloud metadata'],
    ['[::ffff:a9fe:a9fe]', 'IPv4-mapped cloud metadata, normalized'],
    ['[::]', 'unspecified address'],
    ['100.64.1.1', 'CGNAT 100.64/10'],
    ['100.127.255.255', 'CGNAT upper bound'],
  ])('blocks %s (%s)', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    ['localhost'],
    ['foo.internal'],
    ['printer.local'],
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['0.0.0.0'],
    ['[::1]'],
    ['[fc00::1]'],
    ['[fd12:3456::1]'],
    ['[fe80::1]'],
    ['[64:ff9b::7f00:1]'],
    ['224.0.0.1'],
  ])('keeps blocking %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    ['example.com'],
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['100.63.255.255'],
    ['100.128.0.1'],
    ['172.15.0.1'],
    ['172.32.0.1'],
    ['[2606:4700::1111]'],
    ['feeds.megaphone.fm'],
    ['localhost.example.com'],
  ])('allows public host %s', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('safeTarget', () => {
  it('rejects the bypasses through the public entry point', () => {
    expect(safeTarget('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBeNull();
    expect(safeTarget('http://100.64.1.1/')).toBeNull();
    expect(safeTarget('http://[::]/')).toBeNull();
  });

  it('still rejects non-http schemes and embedded credentials', () => {
    expect(safeTarget('file:///etc/passwd')).toBeNull();
    expect(safeTarget('gopher://example.com/')).toBeNull();
    expect(safeTarget('https://user:pass@example.com/')).toBeNull();
    expect(safeTarget(undefined)).toBeNull();
  });

  it('accepts an ordinary feed url', () => {
    expect(safeTarget('https://feeds.simplecast.com/abc')?.hostname).toBe('feeds.simplecast.com');
  });
});

describe('fetchWithTimeout redirect handling', () => {
  it('rejects a 302 that points at a private target', async () => {
    fetchMock
      .get('https://redir.example.com')
      .intercept({ path: '/start' })
      .reply(302, '', { headers: { location: 'http://169.254.169.254/' } });
    await expect(fetchWithTimeout('https://redir.example.com/start', 5000)).rejects.toThrow(
      'unsafe redirect',
    );
  });

  it('follows a 302 to a valid https host and returns the final body', async () => {
    fetchMock
      .get('https://redir.example.com')
      .intercept({ path: '/start' })
      .reply(302, '', { headers: { location: 'https://final.example.com/audio' } });
    fetchMock
      .get('https://final.example.com')
      .intercept({ path: '/audio' })
      .reply(200, 'FINAL-BODY', { headers: { 'content-type': 'audio/mpeg' } });
    const res = await fetchWithTimeout('https://redir.example.com/start', 5000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('FINAL-BODY');
  });

  it('rejects a redirect chain longer than 3 hops', async () => {
    const origin = fetchMock.get('https://chain.example.com');
    origin
      .intercept({ path: '/1' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/2' } });
    origin
      .intercept({ path: '/2' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/3' } });
    origin
      .intercept({ path: '/3' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/4' } });
    origin
      .intercept({ path: '/4' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/5' } });
    await expect(fetchWithTimeout('https://chain.example.com/1', 5000)).rejects.toThrow(
      'too many redirects',
    );
  });

  it('resolves a relative Location against the current url and follows it', async () => {
    const origin = fetchMock.get('https://rel.example.com');
    origin.intercept({ path: '/start' }).reply(302, '', { headers: { location: '/next' } });
    origin.intercept({ path: '/next' }).reply(200, 'REL-BODY');
    const res = await fetchWithTimeout('https://rel.example.com/start', 5000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('REL-BODY');
  });
});

/**
 * A response whose body arrives as the given chunks. `open: true` leaves the
 * stream hanging after the last one, which is how a slow-drip upstream parks a
 * request: the fetch timeout is long gone by then, it covers reaching the
 * response and not draining it.
 */
function streamed(chunks: Uint8Array[], open = false): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        if (!open) controller.close();
      },
    }),
  );
}

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(65);

describe('readCapped', () => {
  afterEach(() => expect(inflightDrainBytes()).toBe(0));

  it('returns the whole body', async () => {
    const out = await readCapped(streamed([bytes(4), bytes(6)]), 1024);
    expect(out.byteLength).toBe(10);
    expect(out.every((b) => b === 65)).toBe(true);
  });

  it('refuses a body past the cap, declared or not', async () => {
    await expect(readCapped(streamed([bytes(40)]), 16)).rejects.toThrow('too large');
    const declared = new Response('x', { headers: { 'content-length': '999' } });
    await expect(readCapped(declared, 16)).rejects.toThrow('too large');
  });

  it('gives up on an upstream that stops sending mid-body', async () => {
    // Without a deadline here the request, its connection and its buffer stay
    // pinned for as long as the upstream cares to hold the socket open.
    await expect(readCapped(streamed([bytes(8)], true), 1024, { timeoutMs: 50 })).rejects.toThrow(
      'read timeout',
    );
  });

  it('refuses a drain that would take the isolate past its shared budget', async () => {
    // The budget is isolate-wide, so a drain parked in another request counts:
    // that is the whole point — `maxBytes` bounds one body, never the sum.
    const parked = readCapped(streamed([bytes(8)], true), 1024, { timeoutMs: 100, budget: 10 });
    await expect(readCapped(streamed([bytes(8)]), 1024, { budget: 10 })).rejects.toThrow('busy');
    await expect(parked).rejects.toThrow('read timeout');
  });
});

describe('clientKey', () => {
  it('keeps an IPv4 address literal', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('collapses an IPv6 address to its /64', () => {
    // One host owns every interface id in its own /64, so counting per address
    // handed a client that changed the last four groups 2^64 free budgets.
    const key = clientKey('2001:db8:1:2:3:4:5:6');
    expect(clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(key);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(key);
  });

  it('does not over-aggregate a compressed address', () => {
    // '2001::1' compresses six zero groups away; taking the text before '::'
    // would key it as 2001::/16 and put unrelated networks in one bucket.
    expect(clientKey('2001::1')).toBe('2001:0:0:0::/64');
    expect(clientKey('2001:0:0:1::1')).not.toBe(clientKey('2001::1'));
  });
});
