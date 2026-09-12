import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The fonts are ours to ship now, which means they are ours to break.
 *
 * A `url()` pointing at a file that is not there fails silently: the face is
 * skipped, the text falls back to a system font, and nothing in the build or
 * the type checker says a word. The same goes for a family named in
 * `tokens.css` that no `@font-face` ever declares. Both are one careless
 * rename away, so both are asserted here against the files on disk.
 */

const dir = new URL('./', import.meta.url);
const fontsCss = readFileSync(fileURLToPath(new URL('fonts.css', dir)), 'utf8');
const tokensCss = readFileSync(fileURLToPath(new URL('tokens.css', dir)), 'utf8');
const indexCss = readFileSync(fileURLToPath(new URL('index.css', dir)), 'utf8');

const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] as string);
const urls = [...fontsCss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1] as string);

function declaredFamilies(css: string): Set<string> {
  return new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1] as string));
}

describe('self-hosted fonts', () => {
  it('declares faces at all', () => {
    expect(faces.length).toBeGreaterThan(0);
  });

  it('is loaded by the style barrel', () => {
    expect(indexCss).toContain("@import './fonts.css';");
  });

  it.each(urls)('%s exists and is a real woff2 file', (rel) => {
    const path = fileURLToPath(new URL(rel, dir));
    const bytes = readFileSync(path);
    // `wOF2` — a 404 page or an HTML error saved under the name would not be.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(path).size).toBeGreaterThan(1000);
  });

  it('every face names a file and a unicode-range', () => {
    for (const body of faces) {
      expect(body).toMatch(/url\('\.\/fonts\/[^']+\.woff2'\) format\('woff2'\)/);
      expect(body).toMatch(/unicode-range:/);
      // Without `swap` the text is invisible while the face loads, which on a
      // cold cache is the whole first paint.
      expect(body).toMatch(/font-display:\s*swap/);
    }
  });

  it('covers every family the design tokens ask for', () => {
    const available = declaredFamilies(fontsCss);
    const wanted = [...tokensCss.matchAll(/--font-[a-z]+:\s*([^;]+);/g)].map((m) => m[1] as string);
    expect(wanted.length).toBeGreaterThan(0);
    for (const stack of wanted) {
      // The first entry is the intended face; the rest are fallbacks and are
      // expected to be system fonts.
      const first = /'([^']+)'/.exec(stack)?.[1];
      expect(first, `no quoted family in "${stack}"`).toBeTruthy();
      expect(available).toContain(first as string);
    }
  });

  it('asks for no remote font host', () => {
    expect(fontsCss).not.toContain('http://');
    expect(fontsCss).not.toContain('https://fonts.');
  });
});
