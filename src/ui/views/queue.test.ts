// @vitest-environment jsdom
/**
 * Moving or removing a row rebuilds the whole list. Keyboard focus must land on
 * the same control of the same episode, or of the row that took its place,
 * rather than falling back to the body.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { queue, type QueueItem } from '../../state/queue';
import { renderShell } from '../shell';
import { initQueueView } from './queue';

function item(n: number): QueueItem {
  return { feedId: 'f', trackId: String(n), title: `Ep ${n}`, feedName: 'Show' };
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.queue-row'));
}

function control(i: number, action: string): HTMLButtonElement {
  const btn = rows()[i]?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!btn) throw new Error(`no ${action} control on row ${i}`);
  return btn;
}

function rowTitle(i: number): string | null {
  return rows()[i]?.querySelector('.queue-name')?.textContent ?? null;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  queue.set([item(1), item(2), item(3)]);
  initQueueView();
});

describe('queue focus across a re-render', () => {
  it('keeps focus on the move-down control of the episode after it moves', () => {
    control(0, 'down').focus();
    control(0, 'down').click();

    expect(rowTitle(1)).toBe('Ep 1');
    expect(document.activeElement).toBe(control(1, 'down'));
  });

  it('moves focus to the next row when the focused episode is removed', () => {
    control(0, 'remove').focus();
    control(0, 'remove').click();

    expect(rowTitle(0)).toBe('Ep 2');
    expect(document.activeElement).toBe(control(0, 'remove'));
  });

  it('falls back to the previous row when the last one is removed', () => {
    control(2, 'remove').focus();
    control(2, 'remove').click();

    expect(rows().length).toBe(2);
    expect(document.activeElement).toBe(control(1, 'remove'));
    expect(rowTitle(1)).toBe('Ep 2');
  });

  it('focuses the list when the last episode is removed', () => {
    queue.set([item(9)]);
    control(0, 'remove').focus();
    control(0, 'remove').click();

    expect(rows().length).toBe(0);
    expect(document.activeElement).toBe(document.querySelector('.queue-list'));
  });
});
