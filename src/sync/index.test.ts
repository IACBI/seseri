// @vitest-environment jsdom
/**
 * What schedules a sync.
 *
 * The transport is faked — this is about when the orchestrator decides to talk
 * to the server, not about the server. Keys, sealing and merging are real.
 */
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  pulls: 0,
  pushes: 0,
  rev: 0,
  /** What the next pull hands back; null means "nothing stored yet". */
  remote: null as Uint8Array | null,
  /** The blob the last push sent. */
  last: null as Uint8Array | null,
}));
vi.mock('./transport', () => ({
  SYNC_AVAILABLE: true,
  getSkewMs: () => 0,
  setSkewMs: () => undefined,
  pullBlob: async () => {
    transport.pulls++;
    return transport.remote
      ? { kind: 'ok', blob: transport.remote, rev: transport.rev }
      : { kind: 'empty' };
  },
  pushBlob: async (_id: string, blob: Uint8Array) => {
    transport.pushes++;
    transport.last = blob;
    return { kind: 'ok', rev: ++transport.rev };
  },
  deleteBlob: async () => true,
}));

import { initSync, startSync, syncNow, syncState, unlinkSync } from './index';
import { decodeCode } from './code';
import { deriveKeys, sealPayload } from './crypto';
import { emptyPayload } from './merge';
import { isPlayed, loadPlayed, markPlayed } from '../storage/played';

/** The debounce in index.ts. */
const DEBOUNCE_MS = 30_000;

/**
 * Sealing goes through WebCrypto and CompressionStream — real async work that
 * fake timers do not drive — so wait on the outcome, not on a number of turns.
 */
async function until(pred: () => boolean, label: string, ms = 4000): Promise<void> {
  // `performance.now`, not `Date.now`: it is not among the faked clocks here.
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('timed out waiting for: ' + label);
}

/** Let any sync the last step started run to completion. */
async function idle(): Promise<void> {
  await until(() => syncState().status !== 'syncing', 'the sync to finish');
}

beforeAll(() => {
  // jsdom's Blob has no `.stream()`, which the gzip step in `sealPayload` uses.
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  loadPlayed();
  initSync(); // wires the listeners; nothing stored yet, so nothing to adopt
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await startSync();
  await until(() => syncState().status === 'ok', 'the first sync');
  transport.pulls = 0;
  transport.pushes = 0;
  transport.remote = null;
});

afterEach(() => {
  vi.useRealTimers();
  unlinkSync();
  // Sealed with the pairing just dropped; the next test's fresh code could
  // not open it, and its first sync would stop at "unreadable".
  transport.remote = null;
});

describe('a played mark schedules a sync', () => {
  it('marking an episode heard by hand is pushed after the debounce', async () => {
    markPlayed('ep-1');

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await idle();
    expect(transport.pushes).toBe(0);

    vi.advanceTimersByTime(1);
    await until(() => transport.pushes === 1, 'the push');
    await idle();
    expect(transport.pulls).toBe(1);
  });

  it('marks written by an inbound merge do not schedule another sync', async () => {
    // Another device has heard ep-remote. Sealed with this pairing's own key,
    // exactly as that device would have.
    const code = syncState().code ?? '';
    const keys = await deriveKeys(decodeCode(code) as Uint8Array);
    transport.remote = await sealPayload(keys, {
      ...emptyPayload(),
      played: { 'ep-remote': { at: Date.now() } },
    });

    await syncNow();
    await idle();
    expect(isPlayed('ep-remote')).toBe(true); // the merge really wrote the mark
    const afterCycle = transport.pushes;

    // Without the `applying` guard, the mark the merge wrote would queue a
    // sync of its own, and that one the next — forever.
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    await idle();
    expect(transport.pushes).toBe(afterCycle);
  });
});

describe('returning to the app', () => {
  it('pulls when the window regains focus, so a device left open sees the other one’s progress', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    window.dispatchEvent(new Event('focus'));
    await until(() => transport.pulls === 1, 'the pull');
    await idle();
  });

  it('does not pull again for a focus right after a sync', async () => {
    window.dispatchEvent(new Event('focus'));
    await idle();
    expect(transport.pulls).toBe(0);
  });
});

describe('a cycle that changes nothing', () => {
  it('does not rewrite a row that already holds exactly what this device has', async () => {
    transport.remote = transport.last;
    await syncNow();
    await idle();
    expect(transport.pulls).toBe(1);
    expect(transport.pushes).toBe(0);
  });
});
