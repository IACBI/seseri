/**
 * Inline SVG flags for the language menu — Windows renders no emoji flags, so
 * these are drawn by hand (24×16, simplified but recognizable at 20px).
 * Self-contained by design: the CSP allows no external image hosts to fail.
 * Constant markup, no interpolated data — innerHTML is safe here.
 */

import type { LangCode } from '../i18n/types';

const wrap = (body: string): string =>
  `<svg class="flag" viewBox="0 0 24 16" aria-hidden="true" focusable="false">${body}</svg>`;

export const FLAGS: Record<LangCode, string> = {
  tr: wrap(
    `<rect width="24" height="16" fill="#e30a17"/>` +
      `<circle cx="10" cy="8" r="4" fill="#fff"/>` +
      `<circle cx="11" cy="8" r="3.2" fill="#e30a17"/>` +
      `<polygon fill="#fff" points="15.4,6.3 15.8,7.45 17.02,7.47 16.05,8.21 16.4,9.38 15.4,8.68 14.4,9.38 14.75,8.21 13.78,7.47 15,7.45"/>`,
  ),
  en: wrap(
    `<rect width="24" height="16" fill="#012169"/>` +
      `<path d="M0,0 24,16 M24,0 0,16" stroke="#fff" stroke-width="3.2"/>` +
      `<path d="M0,0 24,16 M24,0 0,16" stroke="#C8102E" stroke-width="1.3"/>` +
      `<path d="M12,0 V16 M0,8 H24" stroke="#fff" stroke-width="5.3"/>` +
      `<path d="M12,0 V16 M0,8 H24" stroke="#C8102E" stroke-width="3.2"/>`,
  ),
  de: wrap(
    `<rect width="24" height="16" fill="#000"/>` +
      `<rect y="5.33" width="24" height="5.34" fill="#DD0000"/>` +
      `<rect y="10.67" width="24" height="5.33" fill="#FFCC00"/>`,
  ),
  fr: wrap(
    `<rect width="8" height="16" fill="#002395"/>` +
      `<rect x="8" width="8" height="16" fill="#fff"/>` +
      `<rect x="16" width="8" height="16" fill="#ED2939"/>`,
  ),
  es: wrap(
    `<rect width="24" height="16" fill="#AA151B"/>` +
      `<rect y="4" width="24" height="8" fill="#F1BF00"/>`,
  ),
  ar: wrap(
    `<rect width="24" height="16" fill="#165d31"/>` +
      `<rect x="5" y="5" width="14" height="1.7" rx="0.85" fill="#fff" opacity="0.92"/>` +
      `<rect x="4.5" y="9.6" width="15" height="1.3" rx="0.65" fill="#fff"/>`,
  ),
  ja: wrap(
    `<rect width="24" height="16" fill="#fff"/>` + `<circle cx="12" cy="8" r="4.8" fill="#BC002D"/>`,
  ),
  ru: wrap(
    `<rect width="24" height="16" fill="#fff"/>` +
      `<rect y="5.33" width="24" height="5.34" fill="#0039A6"/>` +
      `<rect y="10.67" width="24" height="5.33" fill="#D52B1E"/>`,
  ),
};

/** Native (endonym) display names, shown next to the flags. */
export const NATIVE_NAMES: Record<LangCode, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ja: '日本語',
  ru: 'Русский',
};
