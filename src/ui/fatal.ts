/**
 * Crash recovery screen.
 *
 * `boot()` ran unguarded until now: anything it threw left the page blank, and
 * both times that happened in production the cause was a value in
 * localStorage — so the one action that would have fixed it (clear the stored
 * data) was the one action the user had no way to reach. The app came up blank
 * and stayed blank until storage was cleared by hand, from devtools.
 *
 * This is that action, plus enough detail to paste into an issue.
 *
 * Deliberately thin. It builds its own DOM, leans only on tokens already in
 * the stylesheet, and reaches for nothing but the reset it offers: whatever it
 * depended on could be the thing that just failed. The wipe is confirmed
 * in-place rather than through `confirm.ts` for the same reason — a recovery
 * screen that needs another module to work is not a recovery screen.
 */

import { applyLang, detectLang, langApplied, t } from '../i18n';
import { hardReset, type HardResetReport } from '../storage/reset';
import { h } from './h';

export interface FatalHandlers {
  /** Reload the page. Injected so the builder is testable. */
  reload(): void;
  /** Wipe every store, then reload. */
  wipe(): Promise<void>;
}

/** One line per failed boot, capped — a stack is long and the screen is small. */
const MAX_DETAIL_CHARS = 4000;

/**
 * A readable description of whatever was thrown. `Error` is the common case,
 * but a rejected fetch or a string throw has to render too, and neither has a
 * `.stack`.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(`${err.name}: ${err.message}`);
    if (err.stack) parts.push(err.stack);
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) parts.push('cause: ' + String(cause));
  } else if (typeof err === 'string') {
    parts.push(err);
  } else {
    try {
      parts.push(JSON.stringify(err) ?? String(err));
    } catch {
      parts.push(String(err)); // circular / exotic throw
    }
  }
  // De-duplicated: `err.stack` usually starts with the same "name: message".
  const text = parts.length > 1 && parts[1]?.startsWith(parts[0] ?? '') ? parts.slice(1).join('\n') : parts.join('\n');
  return text.slice(0, MAX_DETAIL_CHARS);
}

/** Facts worth having in a bug report that cost nothing to collect. */
export function bootContext(): string {
  const lines: string[] = [];
  lines.push('seseri ' + (__APP_VERSION__ || 'dev'));
  try {
    lines.push('ua: ' + navigator.userAgent);
  } catch {
    /* no navigator (never in a browser, but the builder is unit-tested) */
  }
  try {
    lines.push('url: ' + location.href);
  } catch {
    /* no location */
  }
  lines.push('lang: ' + (langApplied() ? 'applied' : 'not applied'));
  return lines.join('\n');
}

/**
 * Build the screen. Pure DOM plus the injected handlers — no globals touched,
 * so a test can assert the behaviour without a page to reload.
 */
export function buildFatalScreen(err: unknown, handlers: FatalHandlers): HTMLElement {
  const detail = describeError(err) + '\n\n' + bootContext();

  const reloadBtn = h(
    'button',
    { className: 's-btn', type: 'button', on: { click: () => handlers.reload() } },
    t('fatal_reload'),
  );

  /**
   * Two taps, not a dialog. The first arms the button and the second wipes, so
   * a destructive action still cannot happen on one stray click while the
   * screen stays free of dependencies.
   */
  let armed = false;
  const wipeBtn = h('button', {
    className: 's-btn danger',
    type: 'button',
    on: {
      click: () => {
        if (!armed) {
          armed = true;
          wipeBtn.textContent = t('fatal_wipe_confirm');
          wipeBtn.classList.add('armed');
          return;
        }
        wipeBtn.disabled = true;
        void handlers.wipe();
      },
    },
  });
  wipeBtn.textContent = t('fatal_wipe');

  const pre = h('pre', { className: 'fatal-detail' });
  pre.textContent = detail; // never innerHTML: this string contains user data

  return h(
    'div',
    { className: 'fatal', attrs: { role: 'alert' } },
    h(
      'div',
      { className: 'fatal-box' },
      h('h1', { className: 'fatal-title' }, t('fatal_title')),
      h('p', { className: 'fatal-body' }, t('fatal_body')),
      h('div', { className: 'fatal-actions' }, reloadBtn, wipeBtn),
      h(
        'details',
        { className: 'fatal-more' },
        h('summary', { className: 'fatal-summary' }, t('fatal_details')),
        pre,
      ),
    ),
  );
}

/**
 * Replace the page with the recovery screen.
 *
 * Mounts into `#app` when it is there and onto `<body>` when it is not — the
 * shell may be exactly what failed to render.
 */
export function showFatal(err: unknown): void {
  // The crash can precede `applyLang`, which would leave the screen in the
  // default language rather than the user's.
  if (!langApplied()) {
    try {
      applyLang(detectLang());
    } catch {
      /* i18n itself is unusable — the fallback strings still render */
    }
  }

  // Console first: whatever happens to the DOM below, the error is recorded.
  console.error('boot failed', err);

  const screen = buildFatalScreen(err, {
    reload: () => location.reload(),
    wipe: async () => {
      await hardReset();
      location.reload();
    },
  });

  const host = document.getElementById('app') ?? document.body;
  host.replaceChildren(screen);
  document.body.classList.add('has-fatal');
}

/** Re-exported so Settings can describe the same reset outcome. */
export type { HardResetReport };
