import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { carriesCredential } from './credential-url';

/**
 * The Worker keeps its own copy (separate npm package, own tsconfig). The two
 * decide the same thing in two places — what may reach a third party, and what
 * may reach the shared edge cache — so a fix applied to one and not the other
 * is a silent credential leak. They had already drifted by a stray comment.
 */
describe('worker copy parity', () => {
  it('is byte-identical to worker/src/credential-url.ts', () => {
    const here = readFileSync(fileURLToPath(new URL('./credential-url.ts', import.meta.url)));
    const worker = readFileSync(
      fileURLToPath(new URL('../../worker/src/credential-url.ts', import.meta.url)),
    );
    expect(worker.equals(here)).toBe(true);
  });
});

describe('carriesCredential — protects private feeds', () => {
  it.each([
    ['https://www.patreon.com/rss/creator?auth=Ab3xK9zQ11mNpQrStUvWxYz', 'Patreon auth param'],
    ['https://example.com/feed?token=abc123def456ghi789jkl012', 'token param'],
    ['https://example.com/feed?access_token=xyz', 'access_token by name'],
    ['https://example.com/feed?api_key=k', 'api_key by name'],
    ['https://example.com/feed?apiKey=k', 'camelCase apiKey'],
    ['https://example.com/feed?signature=deadbeef', 'signature by name'],
    ['https://example.com/rss?key=short', 'key by name even when short'],
    ['https://user:pw@example.com/feed.xml', 'embedded userinfo'],
    ['https://example.substack.com/feed/private?s=Xy7Kq2Bv9Lm4Np8Rt5Ws1Zc6', 'opaque value'],
    ['https://example.com/feed?u=a1b2c3d4e5f60718293a4b5c6d7e8f90', 'long hex value'],
  ])('flags %s (%s)', (url) => {
    expect(carriesCredential(url)).toBe(true);
  });

  it.each([
    ['https://feeds.megaphone.fm/thedaily', 'plain public feed'],
    ['https://rss.art19.com/the-daily', 'word slug'],
    ['https://feeds.simplecast.com/54nAGcIl', 'short opaque id'],
    ['https://feeds.buzzsprout.com/123456.rss', 'numeric id'],
    // Public Acast feeds carry a UUID in the path — the exact false positive a
    // path-token rule would cause.
    ['https://feeds.acast.com/public/shows/6c7f0a2e-1234-4abc-9def-0123456789ab', 'public UUID path'],
    ['https://example.com/feed?fmt=rss', 'harmless param'],
    ['https://example.com/feed?page=2&sort=desc', 'harmless params'],
    ['https://example.com/feed?category=true-crime-stories', 'slug value'],
    ['not a url', 'unparseable'],
  ])('does not flag %s (%s)', (url) => {
    expect(carriesCredential(url)).toBe(false);
  });
});
