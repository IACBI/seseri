import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The scanner is shared with the Worker by duplication, the same arrangement
 * `credential-url.ts` uses: two files, one behaviour, this test as the seam. A
 * fix applied to one copy and not the other would mean the edge and the client
 * disagreed about an episode's `trackId`, which is what every saved resume
 * position is keyed on.
 *
 * Deliberately not in `rss-scan.test.ts`: that file runs under jsdom for the
 * DOMParser reference, and `import.meta.url` is not a file URL there.
 */
describe('worker/src/rss-scan.ts', () => {
  it('is byte-identical to src/feeds/rss-scan.ts', () => {
    const here = readFileSync(fileURLToPath(new URL('./rss-scan.ts', import.meta.url)));
    const there = readFileSync(
      fileURLToPath(new URL('../../worker/src/rss-scan.ts', import.meta.url)),
    );
    expect(there.equals(here)).toBe(true);
  });
});
