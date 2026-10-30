import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_SWATCHES,
  accentInkFor,
  accentTextFor,
  contrast,
  themeSurfaces,
  themeToken,
  washedSurfaces,
} from './theme';

/**
 * Parity guard: the pre-hydration CSS defaults in tokens.css must equal the
 * values THEME_VALUES.dark injects at runtime, so there is no flash/drift
 * between the static :root and the JS-applied dark theme. Both files are read
 * as text (no import) to avoid theme.ts's module-load side effects.
 */

const themeSrc = readFileSync(fileURLToPath(new URL('./theme.ts', import.meta.url)), 'utf8');
const tokensSrc = readFileSync(
  fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
  'utf8',
);

function quotedList(block: string): string[] {
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
}

function extract(re: RegExp, label: string): string {
  const m = themeSrc.match(re);
  if (!m || !m[1]) throw new Error(`could not parse ${label} from theme.ts`);
  return m[1];
}

const THEME_KEYS = quotedList(extract(/const THEME_KEYS = \[([\s\S]*?)\]/, 'THEME_KEYS'));
const DARK_VALUES = quotedList(extract(/dark:\s*\[([^\]]*)\]/, 'dark values'));

function tokensDefault(varName: string): string | undefined {
  // The literal ':' anchors the match so '--bg' never captures '--bg2'.
  const m = tokensSrc.match(new RegExp(`${varName}:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

describe('theme / tokens parity', () => {
  it('parsed a non-empty, aligned key/value list from theme.ts', () => {
    expect(THEME_KEYS.length).toBeGreaterThan(0);
    expect(THEME_KEYS.length).toBe(DARK_VALUES.length);
  });

  it.each(THEME_KEYS.map((k, i) => [k, DARK_VALUES[i]] as const))(
    'tokens.css default for %s equals the dark theme value %s',
    (key, darkValue) => {
      expect(tokensDefault(key)).toBe(darkValue);
    },
  );
});

const THEMES = ['dark', 'oled', 'light'] as const;
// The swatches plus accents a user could plausibly arrive at some other way.
const ACCENTS = [
  ...ACCENT_SWATCHES.map((a) => a.hex),
  '#ffff00',
  '#00ffff',
  '#ff00ff',
  '#ffffff',
  '#000000',
  '#0000ff',
  '#7f7f7f',
];

describe('accent contrast', () => {
  it.each(ACCENTS)('text on a %s fill reaches 4.5:1', (hex) => {
    expect(contrast(hex, accentTextFor(hex))).toBeGreaterThanOrEqual(4.5);
  });

  for (const theme of THEMES) {
    it.each(ACCENTS)(`accent ink for %s reaches 4.5:1 on every ${theme} surface`, (hex) => {
      const ink = accentInkFor(hex, theme);
      for (const surface of themeSurfaces(theme)) {
        expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // Copper's ink was 4.43:1 on the wash behind the active chip and the playing
  // row in the light theme: it cleared every bare surface, which is all that
  // was checked.
  for (const theme of THEMES) {
    it.each(ACCENTS)(`accent ink for %s reaches 4.5:1 on the ${theme} accent wash`, (hex) => {
      const ink = accentInkFor(hex, theme);
      for (const surface of washedSurfaces(hex, theme)) {
        expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('leaves an already-readable accent untouched on dark', () => {
    expect(accentInkFor('#f2a33c', 'dark')).toBe('#f2a33c');
  });
});

describe('control boundary token', () => {
  for (const theme of THEMES) {
    it(`--border-ui reaches 3:1 on every ${theme} surface`, () => {
      const border = themeToken(theme, '--border-ui') as string;
      for (const surface of themeSurfaces(theme)) {
        expect(contrast(border, surface)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('light semantic colours', () => {
  const themesSrc = readFileSync(
    fileURLToPath(new URL('../styles/themes.css', import.meta.url)),
    'utf8',
  );
  const light = (name: string): string => {
    const m = themesSrc.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    if (!m?.[1]) throw new Error('missing light ' + name);
    return m[1];
  };
  it.each(['--green', '--red', '--yellow'])('%s reaches 4.5:1 on every light surface', (name) => {
    for (const surface of themeSurfaces('light')) {
      expect(contrast(light(name), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('dark semantic colours', () => {
  it.each(['--green', '--red', '--yellow'])('%s reaches 4.5:1 on every dark and oled surface', (name) => {
    const value = tokensDefault(name) as string;
    for (const theme of ['dark', 'oled'] as const) {
      for (const surface of themeSurfaces(theme)) {
        expect(contrast(value, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
