import type { LangCode } from '../i18n/types';
import { isLangCode, detectLang } from '../i18n';
import { local } from '../storage/local';
import { signal } from './signals';

export type ThemeName = 'auto' | 'dark' | 'light' | 'oled';
export type SortDir = 'asc' | 'desc';
export type PrefetchMode = 'always' | 'wifi' | 'never';

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
  /** Tint the Now Playing background with a colour sampled from the artwork. */
  ambientArt: boolean;
  /**
   * Allow feed fetches to fall back to third-party CORS proxies when the app's
   * own Worker cannot be reached. Off by default: those operators see the URL
   * of every feed opened, and — because the app races three of them and takes
   * the first answer — any one of them can return altered XML, including
   * enclosure URLs pointing somewhere else.
   */
  allowPublicProxies: boolean;
  /**
   * Cache the playing episode in the background so playback stops depending on
   * the network once the copy lands — the difference between surviving a locked
   * screen and not. `wifi` is the default: it only backs off when the browser
   * positively reports a cellular connection, which iOS never does.
   */
  prefetchAudio: PrefetchMode;
  /**
   * Desktop sidebar collapsed to an icon rail. A layout preference rather than
   * a playback one, but it belongs with the rest of what a returning visitor
   * expects to find the way they left it.
   */
  navCollapsed: boolean;
  /**
   * Output level, 0–1. Separate from `muted` so unmuting returns to the level
   * the listener actually chose rather than to full volume. iOS ignores both
   * (see pbVolumeSettable) and the control hides itself there.
   */
  volume: number;
  muted: boolean;
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
  ambientArt: true,
  allowPublicProxies: false,
  prefetchAudio: 'wifi',
  navCollapsed: false,
  volume: 1,
  muted: false,
};

/**
 * Allowed values for the settings that are not free-form. `fontSize`,
 * `rowHeight` and `accentColor` are written straight into CSS custom
 * properties, so a stored value must be one the UI can actually produce rather
 * than merely "a string".
 */
const ALLOWED: Partial<Record<keyof Settings, ReadonlySet<unknown>>> = {
  defaultSpeed: new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]),
  skipBack: new Set([5, 10, 15, 30, 60]),
  skipForward: new Set([10, 15, 30, 45, 60, 90]),
  fontSize: new Set(['11px', '13px', '15px', '17px']),
  rowHeight: new Set(['42px', '54px', '66px']),
  theme: new Set(['auto', 'dark', 'light', 'oled']),
  defaultSort: new Set(['asc', 'desc']),
  prefetchAudio: new Set(['always', 'wifi', 'never']),
};

/** Hex colours only — the accent feeds several `rgb()`/gradient tokens. */
const HEX = /^#[0-9a-f]{6}$/i;

function acceptable<K extends keyof Settings>(key: K, value: unknown): boolean {
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return false;
  if (key === 'accentColor') return typeof value === 'string' && HEX.test(value);
  // Written straight to audio.volume, which throws outside 0–1.
  if (key === 'volume') return typeof value === 'number' && value >= 0 && value <= 1;
  const allowed = ALLOWED[key];
  return allowed ? allowed.has(value) : true;
}

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

export function loadSettings(): void {
  const raw = local.get<unknown>('pp_settings', null);
  // Anything that is not a plain object is treated as absent. `"junk"` is
  // truthy and not an object, and the language check below used `in` on it,
  // which threw a TypeError and took the whole boot down.
  const saved: Partial<Settings> | null =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<Settings>) : null;
  const next = { ...DEFAULT_SETTINGS };
  let rejected = false;
  if (saved) {
    for (const k of Object.keys(next) as Array<keyof Settings>) {
      const v = saved[k];
      if (v === undefined) continue;
      // A matching `typeof` used to be the only check, so any string reached
      // `style.setProperty` and any number reached `audio.playbackRate`.
      if (acceptable(k, v)) (next as Record<string, unknown>)[k] = v;
      else rejected = true;
    }
  }
  if (!saved || !('lang' in saved) || !isLangCode(String(next.lang))) {
    next.lang = detectLang();
  }
  settings.set(next);
  // Write the sanitised set back, so a rejected value does not sit in storage
  // being re-rejected on every load.
  if (rejected) local.set('pp_settings', next);
}

/**
 * Persisting is throttled; the signal is not.
 *
 * Most settings change once when a user taps a control, but the volume slider
 * fires `input` at pointer rate — and every one of those used to serialise the
 * whole settings object into localStorage synchronously, on the main thread,
 * while the pointer was still moving. The signal still updates immediately (it
 * is what keeps the two volume controls agreeing mid-drag); only the write is
 * coalesced.
 */
const SAVE_DELAY_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Write now, cancelling any pending throttled write. Called on the way out. */
export function saveSettings(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  local.set('pp_settings', settings());
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    local.set('pp_settings', settings());
  }, SAVE_DELAY_MS);
}

/** Update one field, persist, notify subscribers. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.update((s) => ({ ...s, [key]: value }));
  scheduleSave();
}
