import type { LangCode } from '../i18n/types';
import { isLangCode, detectLang } from '../i18n';
import { local } from '../storage/local';
import { signal } from './signals';

export type ThemeName = 'auto' | 'dark' | 'light' | 'oled';
export type SortDir = 'asc' | 'desc';

/** User settings — persisted under the legacy `pp_settings` key (same shape). */
export interface Settings {
  defaultSpeed: number;
  skipBack: number;
  skipForward: number;
  autoNext: boolean;
  resumePos: boolean;
  fontSize: string;
  rowHeight: string;
  theme: ThemeName;
  defaultSort: SortDir;
  showDl: boolean;
  accentColor: string;
  lang: LangCode;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultSpeed: 1,
  skipBack: 15,
  skipForward: 30,
  autoNext: true,
  resumePos: true,
  fontSize: '13px',
  rowHeight: '54px',
  theme: 'auto',
  defaultSort: 'asc',
  showDl: true,
  accentColor: '#f2a33c',
  lang: 'tr',
};

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

export function loadSettings(): void {
  const saved = local.get<Partial<Settings> | null>('pp_settings', null);
  const next = { ...DEFAULT_SETTINGS };
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(next) as Array<keyof Settings>) {
      const v = saved[k];
      if (v !== undefined && typeof v === typeof next[k]) {
        (next as Record<string, unknown>)[k] = v;
      }
    }
  }
  if (!saved || !('lang' in saved) || !isLangCode(String(next.lang))) {
    next.lang = detectLang();
  }
  settings.set(next);
}

export function saveSettings(): void {
  local.set('pp_settings', settings());
}

/** Update one field, persist, notify subscribers. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.update((s) => ({ ...s, [key]: value }));
  saveSettings();
}
