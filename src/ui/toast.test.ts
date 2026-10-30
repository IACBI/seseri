// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initToast, toast } from './toast';

describe('toast live region', () => {
  it('is in the page before the first message, so that message is announced', () => {
    expect(document.querySelector('.toast-host')).toBeNull();

    initToast();

    const host = document.querySelector('.toast-host');
    expect(host?.getAttribute('aria-live')).toBe('polite');
    expect(host?.childElementCount).toBe(0);
  });

  it('puts messages into that same region', () => {
    initToast();
    toast('Saved');

    const hosts = document.querySelectorAll('.toast-host');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.textContent).toBe('Saved');
  });
});
