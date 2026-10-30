// @vitest-environment jsdom
/**
 * Which glyphs mirror under `dir="rtl"`.
 *
 * The transport row is laid out with logical flex, so in Arabic the order is
 * reversed: "next" sits on the left, "previous" on the right, and the timeline
 * runs right to left. The skip glyphs were left unmirrored, so each one pointed
 * toward the play button instead of away from it — "next" looked like
 * "previous". The sidebar glyph draws its narrow pane on the left, which in RTL
 * is the wrong edge: the sidebar is on the right. Play and pause are shapes,
 * not directions, and stay as they are.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderShell } from '../shell';
import { initNowPlaying } from './now-playing';
import type { PlaybackController } from '../playback-controller';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  const app = document.createElement('div');
  document.body.append(app);
  renderShell(app);
  initNowPlaying({ playback: {} as PlaybackController, openQueue: () => undefined });
});

const flips = (id: string): boolean =>
  document.querySelector(`#${id} svg`)?.classList.contains('icon-flip') ?? false;

describe('directional glyphs', () => {
  it('mirror: previous / next on the dock and on the sheet, and the sidebar', () => {
    for (const id of ['miniPrev', 'miniNext', 'btnPrev', 'btnNext', 'navCollapse']) {
      expect(flips(id), id).toBe(true);
    }
  });

  it('do not mirror: play and pause', () => {
    for (const id of ['miniPlay', 'btnPlay']) expect(flips(id), id).toBe(false);
  });
});
