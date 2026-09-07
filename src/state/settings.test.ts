// @vitest-environment jsdom
/**
 * Stored settings are attacker-shaped input in one specific sense: three of
 * them (`fontSize`, `rowHeight`, `accentColor`) are written straight into CSS
 * custom properties and one (`defaultSpeed`) into `audio.playbackRate`. The
 * loader used to accept anything whose `typeof` matched, so "a string" was the
 * only requirement for reaching `style.setProperty`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, setSetting, settings } from './settings';

function store(value: unknown): void {
  localStorage.setItem('pp_settings', JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  settings.set({ ...DEFAULT_SETTINGS });
});

describe('loadSettings validation', () => {
  it('keeps values the UI can actually produce', () => {
    store({ defaultSpeed: 1.5, skipBack: 30, fontSize: '15px', rowHeight: '66px', theme: 'oled' });
    loadSettings();
    expect(settings()).toMatchObject({
      defaultSpeed: 1.5,
      skipBack: 30,
      fontSize: '15px',
      rowHeight: '66px',
      theme: 'oled',
    });
  });

  it.each([
    ['fontSize', 'url(https://evil.example/x)'],
    ['fontSize', '13px; background: red'],
    ['rowHeight', '9999px'],
    ['accentColor', 'javascript:alert(1)'],
    ['accentColor', 'red'],
    ['accentColor', '#ff'],
    ['defaultSpeed', 99],
    ['defaultSpeed', -1],
    ['skipBack', 100000],
    ['theme', 'neon'],
    ['defaultSort', 'sideways'],
  ] as const)('falls back to the default for %s = %o', (key, value) => {
    store({ [key]: value });
    loadSettings();
    expect(settings()[key]).toBe(DEFAULT_SETTINGS[key]);
  });

  it('rejects a value of the wrong type', () => {
    store({ autoNext: 'yes', showDl: 1, defaultSpeed: '2' });
    loadSettings();
    expect(settings().autoNext).toBe(DEFAULT_SETTINGS.autoNext);
    expect(settings().showDl).toBe(DEFAULT_SETTINGS.showDl);
    expect(settings().defaultSpeed).toBe(DEFAULT_SETTINGS.defaultSpeed);
  });

  it('writes the sanitised set back, so a bad value is not re-read forever', () => {
    store({ defaultSpeed: 99, fontSize: '15px' });
    loadSettings();
    const written = JSON.parse(localStorage.getItem('pp_settings') ?? '{}');
    expect(written.defaultSpeed).toBe(DEFAULT_SETTINGS.defaultSpeed);
    expect(written.fontSize).toBe('15px'); // the acceptable one survives
  });

  it('leaves storage untouched when everything was acceptable', () => {
    store({ fontSize: '15px' });
    loadSettings();
    expect(JSON.parse(localStorage.getItem('pp_settings') ?? '{}')).toEqual({ fontSize: '15px' });
  });

  it('survives junk in place of the settings object', () => {
    localStorage.setItem('pp_settings', '"not an object"');
    expect(() => loadSettings()).not.toThrow();
    expect(settings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('defaults the third-party proxy fallback to off', () => {
    loadSettings();
    expect(settings().allowPublicProxies).toBe(false);
  });
});

/**
 * The volume slider writes on `input`, which fires at pointer rate. Every one
 * of those used to serialise the whole settings object into localStorage
 * synchronously while the pointer was still moving.
 */
describe('setSetting throttles the write but not the signal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Retire any write still pending from the previous case — swapping timer
    // implementations drops the callback but not the module's handle.
    saveSettings();
    settings.set({ ...DEFAULT_SETTINGS });
    localStorage.clear();
  });
  afterEach(() => {
    saveSettings();
    vi.useRealTimers();
  });

  it('updates the signal immediately, so both volume controls stay in step', () => {
    setSetting('volume', 0.25);
    expect(settings().volume).toBe(0.25);
  });

  it('writes once for a whole drag rather than once per pointer sample', () => {
    for (let v = 0; v <= 20; v++) setSetting('volume', v / 20);
    expect(localStorage.getItem('pp_settings')).toBeNull(); // nothing yet
    vi.advanceTimersByTime(500);
    const written = JSON.parse(localStorage.getItem('pp_settings') ?? '{}');
    expect(written.volume).toBe(1);
  });

  it('flushes synchronously when saveSettings is called on the way out', () => {
    setSetting('volume', 0.5);
    saveSettings();
    expect(JSON.parse(localStorage.getItem('pp_settings') ?? '{}').volume).toBe(0.5);
  });

  it('does not write again after a flush cancelled the pending timer', () => {
    setSetting('volume', 0.5);
    saveSettings();
    localStorage.removeItem('pp_settings');
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem('pp_settings')).toBeNull();
  });
});
