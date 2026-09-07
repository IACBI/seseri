import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The desktop shell loads the live site, so it runs the same code against the
 * same hosts — but it carries its OWN Content-Security-Policy, written by hand
 * in `tauri.conf.json` and never exercised by any smoke script.
 *
 * The web `connect-src` was an allow-list until 4.2.2, which silently blocked
 * episode downloads and background caching for every third-party host in
 * production; SECURITY.md records it. The desktop copy was not part of that fix
 * and stayed an allow-list. This guards the three directives the podcast
 * internet actually lands on — the app fetches an enclosure from whichever host
 * a feed names, and no list can enumerate those — so the two policies cannot
 * drift apart again.
 *
 * `default-src` and `script-src` deliberately differ: the desktop window has to
 * allow the origin the app is served from, and the web page is that origin.
 */

const root = new URL('../../', import.meta.url);

/** The three directives that decide whether a stranger's CDN is reachable. */
const SHARED = ['connect-src', 'media-src', 'img-src'] as const;

function directives(csp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values.join(' ');
  }
  return out;
}

/**
 * The production web policy: index.html's meta minus the dev-only origins that
 * `stripDevCsp` in vite.config.ts removes at build time.
 */
function webCsp(): Record<string, string> {
  const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
  const block = html.slice(html.indexOf('http-equiv="Content-Security-Policy"'));
  const content = /content="([^"]+)"/.exec(block);
  if (!content?.[1]) throw new Error('no CSP meta found in index.html');
  return directives(
    content[1].replace(/\s+/g, ' ').replaceAll(' http://127.0.0.1:8787', '').replaceAll(' ws:', ''),
  );
}

function desktopCsp(): Record<string, string> {
  const conf = JSON.parse(
    readFileSync(fileURLToPath(new URL('desktop/src-tauri/tauri.conf.json', root)), 'utf8'),
  ) as { app: { security: { csp: string } } };
  return directives(conf.app.security.csp);
}

describe('desktop CSP tracks the shipped web CSP', () => {
  const web = webCsp();
  const desktop = desktopCsp();

  it.each(SHARED)('%s is identical in both policies', (name) => {
    expect(desktop[name]).toBe(web[name]);
  });

  it('does not enumerate podcast hosts, which cannot be enumerated', () => {
    // The failure this exists for: a fixed list of CDNs in connect-src.
    const sources = (desktop['connect-src'] ?? '').split(' ');
    expect(sources).toContain('https:');
    expect(sources.filter((s) => s.startsWith('https://'))).toEqual([]);
  });

  it('keeps script-src off the open internet in both', () => {
    // A wildcard scheme here would let any https host execute; a named origin
    // (the site the desktop window loads) is fine.
    for (const csp of [web, desktop]) {
      expect((csp['script-src'] ?? '').split(' ')).not.toContain('https:');
    }
  });
});
