// @vitest-environment jsdom
/**
 * The recovery screen. Two things are load-bearing: the destructive action
 * cannot fire on one click, and the error detail — which contains whatever a
 * feed or a stored value put in the message — reaches the DOM as text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLang } from '../i18n';
import { bootContext, buildFatalScreen, describeError, showFatal } from './fatal';

beforeEach(() => {
  document.body.className = '';
  document.body.replaceChildren();
  applyLang('en');
});

function handlers(): { reload: ReturnType<typeof vi.fn>; wipe: ReturnType<typeof vi.fn> } {
  return { reload: vi.fn(), wipe: vi.fn(async () => undefined) };
}

describe('describeError', () => {
  it('renders an Error as name, message and stack without repeating the header', () => {
    const err = new Error('pp_settings is not an object');
    err.stack = 'Error: pp_settings is not an object\n    at loadSettings (settings.ts:1:1)';
    const text = describeError(err);
    expect(text).toContain('at loadSettings');
    // The stack already opens with "Error: <message>", so the header must not
    // appear twice.
    expect(text.match(/pp_settings is not an object/g)).toHaveLength(1);
  });

  it('renders an Error with no stack', () => {
    const err = new Error('boom');
    delete err.stack;
    expect(describeError(err)).toBe('Error: boom');
  });

  it('includes a cause when there is one', () => {
    const err = new Error('outer', { cause: new Error('inner') });
    delete err.stack;
    expect(describeError(err)).toContain('cause: Error: inner');
  });

  it('renders a thrown string', () => {
    expect(describeError('just a string')).toBe('just a string');
  });

  it('renders a thrown object', () => {
    expect(describeError({ code: 22 })).toBe('{"code":22}');
  });

  it('survives a circular throw', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe('[object Object]');
  });

  it('caps the detail so a runaway stack cannot fill the screen', () => {
    const err = new Error('x');
    err.stack = 'y'.repeat(10_000);
    expect(describeError(err).length).toBe(4000);
  });
});

describe('bootContext', () => {
  it('names the build and the language state', () => {
    const text = bootContext();
    expect(text).toMatch(/^seseri \S+/);
    expect(text).toContain('lang: applied');
  });
});

describe('buildFatalScreen', () => {
  it('offers a reload that calls straight through', () => {
    const h = handlers();
    const screen = buildFatalScreen(new Error('x'), h);
    const reload = screen.querySelectorAll('button')[0] as HTMLButtonElement;

    expect(reload.textContent).toBe('Reload');
    reload.click();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.wipe).not.toHaveBeenCalled();
  });

  it('needs two clicks before it wipes anything', () => {
    const h = handlers();
    const screen = buildFatalScreen(new Error('x'), h);
    const wipe = screen.querySelectorAll('button')[1] as HTMLButtonElement;

    expect(wipe.textContent).toBe('Clear data');
    wipe.click();
    expect(h.wipe).not.toHaveBeenCalled();
    expect(wipe.textContent).toBe('Are you sure? Tap again to delete');
    expect(wipe.classList.contains('armed')).toBe(true);

    wipe.click();
    expect(h.wipe).toHaveBeenCalledTimes(1);
    // Disabled straight away: a third click must not start a second wipe.
    expect(wipe.disabled).toBe(true);
  });

  it('puts the error detail in the DOM as text, never as markup', () => {
    const err = new Error('<img src=x onerror="alert(1)"> & <script>bad()</script>');
    delete err.stack;
    const screen = buildFatalScreen(err, handlers());
    const pre = screen.querySelector('.fatal-detail') as HTMLElement;

    expect(pre.querySelector('img')).toBeNull();
    expect(pre.querySelector('script')).toBeNull();
    expect(pre.childNodes).toHaveLength(1);
    expect(pre.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(pre.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('announces itself to assistive technology', () => {
    const screen = buildFatalScreen(new Error('x'), handlers());
    expect(screen.getAttribute('role')).toBe('alert');
  });

  it('renders in the active language', () => {
    applyLang('tr');
    const screen = buildFatalScreen(new Error('x'), handlers());
    expect(screen.querySelector('.fatal-title')?.textContent).toBe('Uygulama açılamadı');
  });
});

describe('showFatal', () => {
  it('mounts into #app and hides the shell', () => {
    const app = document.createElement('div');
    app.id = 'app';
    app.textContent = 'half-rendered shell';
    document.body.append(app);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    showFatal(new Error('nope'));

    expect(app.querySelector('.fatal')).not.toBeNull();
    expect(app.textContent).not.toContain('half-rendered shell');
    expect(document.body.classList.contains('has-fatal')).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to <body> when the shell mount point is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    showFatal('no #app at all');
    expect(document.body.querySelector('.fatal')).not.toBeNull();
    spy.mockRestore();
  });
});
