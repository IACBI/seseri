// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { modalOpen } from './modal';

afterEach(() => {
  document.body.replaceChildren();
});

describe('modalOpen', () => {
  it('is false with no dialog, and with one that is closed', () => {
    expect(modalOpen()).toBe(false);
    document.body.append(document.createElement('dialog'));
    expect(modalOpen()).toBe(false);
  });

  it('is true while a dialog is open', () => {
    const d = document.createElement('dialog');
    document.body.append(d);
    d.setAttribute('open', '');
    expect(modalOpen()).toBe(true);
    d.removeAttribute('open');
    expect(modalOpen()).toBe(false);
  });
});
