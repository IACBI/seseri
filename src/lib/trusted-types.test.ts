import { describe, expect, it } from 'vitest';
import { allowedScriptUrl, unsafeMarkup } from './trusted-types';

describe('unsafeMarkup', () => {
  it.each([
    '<img src=x onerror=alert(1)>',
    '<svg onload="x()">',
    '<script>x()</script>',
    '< script src="a.js">',
    '<iframe srcdoc="x">',
    '<a href="javascript:alert(1)">',
    '<a href="JaVaScRiPt:x">',
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0">',
    '<link rel="import" href="x">',
    '<form action="https://evil.example">',
    '<object data="x">',
  ])('refuses %s', (html) => {
    expect(unsafeMarkup(html)).toBe(true);
  });

  it.each([
    '<div class="np-sheet"><button class="icon-btn" aria-label="x"></button></div>',
    '<svg class="icon"><use href="#ic-play"></use></svg>',
    '<span data-i18n="online">Online</span>',
    '<p>Sonic boom: a word that contains on but no handler</p>',
  ])('allows constant shell markup: %s', (html) => {
    expect(unsafeMarkup(html)).toBe(false);
  });
});

describe('allowedScriptUrl', () => {
  const base = 'https://iacbi.github.io/seseri/';
  it('allows this origin’s service worker', () => {
    expect(allowedScriptUrl('./sw.js', base)).toBe(true);
    expect(allowedScriptUrl('https://iacbi.github.io/seseri/sw.js', base)).toBe(true);
  });
  it('refuses anything else', () => {
    expect(allowedScriptUrl('https://evil.example/sw.js', base)).toBe(false);
    expect(allowedScriptUrl('./app.js', base)).toBe(false);
    expect(allowedScriptUrl('data:text/javascript,x', base)).toBe(false);
  });
});
