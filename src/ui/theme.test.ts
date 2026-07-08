import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
