import type { ThemeName } from '../state/settings';
import { settings } from '../state/settings';

type ResolvedTheme = Exclude<ThemeName, 'auto'>;

const THEME_VALUES: Record<ResolvedTheme, string[]> = {
  //       --bg       --bg2      --surface  --surface2 --border   --border2  --text     --text2    --text3
  dark: ['#0b0c11', '#101117', '#15161e', '#1c1e28', '#23252f', '#30333f', '#edeff7', '#9aa0b8', '#5d6280'],
  oled: ['#000000', '#08080a', '#0e0e12', '#16161c', '#202027', '#2c2c36', '#f2f2f6', '#8a8a99', '#46465a'],
  light: ['#f4f5f8', '#ecedf2', '#ffffff', '#f7f8fb', '#e7e9f0', '#d3d7e1', '#14161d', '#4c5165', '#6e7488'],
};
const THEME_KEYS = [
  '--bg', '--bg2', '--surface', '--surface2', '--border', '--border2', '--text', '--text2', '--text3',
];

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

export function applyAccent(c: string): void {
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
  root.style.setProperty('--accent', c);
  root.style.setProperty('--accent-dim', dim);
  root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${c} 0%, ${dim} 100%)`);
  root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.18)`);
  // Soft row highlight: stronger in light theme so it stays visible on white
  root.style.setProperty(
    '--accent-soft',
    `rgba(${r},${g},${b},${resolveTheme(settings().theme) === 'light' ? 0.14 : 0.1})`,
  );
  // Black text on light/yellow-ish accents, white otherwise (WCAG-ish luma)
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  root.style.setProperty('--accent-text', luma > 170 ? '#15171f' : '#ffffff');
}
