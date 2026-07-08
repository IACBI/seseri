import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchWithTimeout } from '../src/safe-fetch';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

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
