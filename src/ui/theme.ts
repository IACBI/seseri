import type { ThemeName } from '../state/settings';
import { settings } from '../state/settings';

type ResolvedTheme = Exclude<ThemeName, 'auto'>;

/** "Sinyal" surfaces — dark values MUST equal the tokens.css :root defaults
 *  (theme.test.ts guards the parity so there is no pre-hydration flash). */
const THEME_VALUES: Record<ResolvedTheme, string[]> = {
  //       --bg       --bg2      --surface  --surface2 --border   --border2  --text     --text2    --text3    --border-ui
  // --border-ui is the control boundary (inputs, toggle track, range track):
  // >=3:1 against bg, bg2, surface and surface2 (WCAG 1.4.11); --border and
  // --border2 stay decorative.
  // "Kor" — ember charcoal. Text ramp tuned for readability: --text2 ~10:1,
  // --text3 ~5.7:1 on --bg (small mono labels stay comfortably above AA).
  dark: ['#171310', '#1e1915', '#262019', '#302822', '#3e342a', '#4e4234', '#f6f1e7', '#cabfae', '#9a8d76', '#80725a'],
  // "Gece" — true black, same warm ramp lifted for OLED (text3 ~6.4:1).
  oled: ['#000000', '#0d0b09', '#171310', '#211b15', '#2e261e', '#3f3529', '#f8f3e9', '#c6bbaa', '#998c74', '#77694f'],
  // --text3 #6b6150: ≥4.5:1 on --bg/--surface (WCAG AA for the small mono labels)
  light: ['#f6f4f0', '#edeae4', '#ffffff', '#faf8f4', '#e5e0d6', '#d2cabc', '#1d1914', '#59503f', '#6b6150', '#8c8068'],
};
const THEME_KEYS = [
  '--bg', '--bg2', '--surface', '--surface2', '--border', '--border2', '--text', '--text2', '--text3', '--border-ui',
];

/** The user-pickable accent set — amber "dial glow" is the identity default. */
export const ACCENT_SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#f2a33c', name: 'Amber' },
  { hex: '#e07a4f', name: 'Copper' },
  { hex: '#e0584f', name: 'Signal Red' },
  { hex: '#58b283', name: 'Moss' },
  { hex: '#3fa8a0', name: 'Teal' },
  { hex: '#5c8fd6', name: 'Sky' },
  { hex: '#a98fd6', name: 'Lilac' },
];

/** Pre-4.0 saved accents → their nearest Sinyal equivalent (UI-only remap, so
 *  the frozen settings storage keeps its legacy value untouched). */
const LEGACY_ACCENT_MAP: Record<string, string> = {
  '#8b7cf6': '#f2a33c', // violet (old default) → amber (new default)
  '#5b8af5': '#5c8fd6', // blue → sky
  '#43d49a': '#58b283', // green → moss
  '#f06a6a': '#e0584f', // red → signal red
  '#e6bb4f': '#f2a33c', // amber → amber
  '#f5845b': '#e07a4f', // coral → copper
  '#34d8e0': '#3fa8a0', // cyan → teal
};

/** Resolve a stored accent (possibly pre-4.0) to the hex actually painted. */
export function normalizeAccent(stored: string): string {
  return LEGACY_ACCENT_MAP[stored.toLowerCase()] ?? stored;
}

const prefersLight =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

/** The theme actually painted ('auto' resolved against the OS preference). */
export function resolveTheme(theme: ThemeName): ResolvedTheme {
  if (theme === 'auto') return prefersLight?.matches ? 'light' : 'dark';
  return theme in THEME_VALUES ? theme : 'dark';
}

// OS theme flips repaint immediately while the setting is 'auto'
prefersLight?.addEventListener('change', () => {
  if (settings().theme === 'auto') applyTheme('auto');
});

export function applyTheme(theme: ThemeName): void {
  const resolved = resolveTheme(theme);
  const vals = THEME_VALUES[resolved];
  const root = document.documentElement;
  THEME_KEYS.forEach((k, i) => root.style.setProperty(k, vals[i] ?? ''));
  root.classList.remove('theme-dark', 'theme-light', 'theme-oled');
  root.classList.add('theme-' + resolved);
  // Keep the browser chrome (address/status bar) in sync
  const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (metaTheme && vals[0]) metaTheme.content = vals[0];
  // accent-soft / accent-text depend on the theme
  applyAccent(settings().accentColor);
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: readonly number[]): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1-21). */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const INK_DARK = '#1a1510';
const INK_LIGHT = '#ffffff';

/** Text colour for content on a filled accent: whichever of the dark ink and
 *  white has the higher real contrast. A luma threshold picked white for
 *  Copper/Moss/Teal/Sky at 2.6-3.7:1. */
export function accentTextFor(accent: string): string {
  return contrast(accent, INK_DARK) >= contrast(accent, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** One of the injected theme tokens (e.g. '--border-ui') for a resolved theme. */
export function themeToken(theme: ResolvedTheme, key: string): string | undefined {
  return THEME_VALUES[theme][THEME_KEYS.indexOf(key)];
}

/** Every surface accent-coloured text can land on in a theme. */
export function themeSurfaces(theme: ResolvedTheme): string[] {
  return THEME_VALUES[theme].slice(0, 4);
}

// A hair above 4.5 so browser rounding cannot dip under AA.
const INK_TARGET = 4.6;

/**
 * The accent as it may be used for text, links and focus rings: the accent
 * itself where it already clears AA on every surface (dark, OLED), otherwise
 * pushed toward white (dark themes) or black (light) until it does. Fills keep
 * the pure --accent; only thin strokes and glyphs use this.
 */
export function accentInkFor(accent: string, theme: ResolvedTheme): string {
  const surfaces = themeSurfaces(theme);
  const worst = (c: string): number => Math.min(...surfaces.map((x) => contrast(c, x)));
  const toward = theme === 'light' ? 0 : 255;
  const base = channels(accent);
  for (let step = 0; step <= 20; step++) {
    const k = step / 20;
    const c = toHex(base.map((v) => v + (toward - v) * k));
    if (worst(c) >= INK_TARGET) return c;
  }
  return toHex([toward, toward, toward]);
}

export function applyAccent(stored: string): void {
  const c = normalizeAccent(stored);
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const root = document.documentElement;
  // Darker companion shade for gradient depth (~78% luminance)
  const dim =
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(v * 0.78)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  // Brighter companion. This was a static amber in tokens.css and was never
  // recomputed, so picking Teal left the scrubber playhead and its glow amber.
  // Tuned so the default accent still lands on ~#ffc46b (no visible change).
  const lift = (v: number): number => Math.min(255, Math.round(v * 1.05 + 30));
  const accent2 =
    '#' +
    [r, g, b]
      .map((v) => lift(v).toString(16).padStart(2, '0'))
      .join('');

  root.style.setProperty('--accent', c);
  root.style.setProperty('--accent-2', accent2);
  root.style.setProperty('--accent-dim', dim);
  root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${c} 0%, ${dim} 100%)`);
  root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.18)`);
  // Soft row highlight: stronger in light theme so it stays visible on white
  root.style.setProperty(
    '--accent-soft',
    `rgba(${r},${g},${b},${resolveTheme(settings().theme) === 'light' ? 0.14 : 0.1})`,
  );
  root.style.setProperty('--accent-text', accentTextFor(c));
  root.style.setProperty('--accent-ink', accentInkFor(c, resolveTheme(settings().theme)));
}
