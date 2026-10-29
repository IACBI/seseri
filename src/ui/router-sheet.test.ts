// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedRequest } from '../feeds/types';
import { bindSheetHistory, initRouter, type AppView } from './router';

const FEED = '/?podcast=1550551126';

/** jsdom runs a traversal on a timer; resolve once its popstate has fired. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
  });
}

function makeHandlers() {
  return {
    showFeed: vi.fn<(req: FeedRequest) => void>(),
    showHome: vi.fn<() => void>(),
    showView: vi.fn<(view: AppView) => void>(),
  };
}

/** A sheet whose open/close behave like the real one's visible state. */
function makeSheet() {
  const sheet = {
    shown: false,
    open: vi.fn(() => {
      sheet.shown = true;
    }),
    close: vi.fn(() => {
      sheet.shown = false;
    }),
    isOpen: () => sheet.shown,
  };
  return sheet;
}

beforeEach(() => {
  history.replaceState(null, '', FEED);
});

describe('sheet history', () => {
  it('pushes one tagged entry at the same URL on open', () => {
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);
    const before = history.length;

    sheet.shown = true;
    hist.opened();
    hist.opened(); // idempotent while its entry is current

    expect(history.length).toBe(before + 1);
    expect(location.pathname + location.search).toBe(FEED);
    expect(history.state).toMatchObject({ npSheet: true });
    hist.closed(true);
  });

  it('dismissing pops the entry and does not re-run the router', async () => {
    const h = makeHandlers();
    initRouter(h);
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    sheet.shown = true;
    hist.opened();
    const done = settled();
    sheet.shown = false; // what dismiss() does before asking for the pop
    hist.closed(false);
    await done;

    expect(history.state).not.toMatchObject({ npSheet: true });
    expect(h.showFeed).not.toHaveBeenCalled();
    expect(h.showHome).not.toHaveBeenCalled();
  });

  it('the back gesture closes an open sheet without touching the router', async () => {
    const h = makeHandlers();
    initRouter(h);
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    sheet.shown = true;
    hist.opened();
    const done = settled();
    history.back();
    await done;

    expect(sheet.close).toHaveBeenCalledTimes(1);
    expect(sheet.shown).toBe(false);
    expect(h.showFeed).not.toHaveBeenCalled();
  });

  it('forward re-opens the sheet it closed, still without routing', async () => {
    const h = makeHandlers();
    initRouter(h);
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    sheet.shown = true;
    hist.opened();
    let done = settled();
    history.back();
    await done;
    done = settled();
    history.forward();
    await done;

    expect(sheet.open).toHaveBeenCalledTimes(1);
    expect(h.showFeed).not.toHaveBeenCalled();
    hist.closed(true);
  });

  it('closing for a navigation leaves no extra entry behind', () => {
    const router = initRouter(makeHandlers());
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    sheet.shown = true;
    hist.opened();
    const withSheet = history.length;
    sheet.shown = false;
    hist.closed(true);
    router.viewOpened('queue');

    // The spent entry became the queue entry instead of stacking a new one.
    expect(history.length).toBe(withSheet);
    expect(location.search).toBe('?view=queue');
  });

  it('goHome from a spent entry replaces it too', () => {
    const router = initRouter(makeHandlers());
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    sheet.shown = true;
    hist.opened();
    const withSheet = history.length;
    sheet.shown = false;
    hist.closed(true);
    router.goHome();

    expect(history.length).toBe(withSheet);
    expect(location.search).toBe('');
  });

  it('a traversal that changes the URL is still navigation', async () => {
    const h = makeHandlers();
    initRouter(h);
    const sheet = makeSheet();
    const hist = bindSheetHistory(sheet);

    history.pushState(null, '', '/?view=library');
    history.pushState(null, '', FEED);
    sheet.shown = true;
    hist.opened();
    const done = settled();
    history.go(-2);
    await done;

    expect(location.search).toBe('?view=library');
    expect(h.showView).toHaveBeenCalledWith('library');
    expect(sheet.shown).toBe(false);
  });
});
