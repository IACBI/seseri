import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_BYTES } from './code';
import { deriveKeys, openPayload, sealPayload } from './crypto';
import { emptyPayload } from './merge';
import type { SyncPayload } from './types';

/**
 * The claim this feature makes to its users is that the server stores bytes it
 * cannot read. These tests are that claim: the blob never contains the
 * plaintext, a wrong code recovers nothing, and the id the server files the row
 * under says nothing about the code that produced it.
 */

const T0 = 1_700_000_000_000;

function codeBytes(seed: number): Uint8Array {
  return Uint8Array.from({ length: CODE_BYTES }, (_v, i) => (i * 31 + seed) & 255);
}

function samplePayload(trackId = '111'): SyncPayload {
  return {
    ...emptyPayload(),
    progress: { [trackId]: { t: 942.5, at: T0 } },
    lastPlayed: { f1: { ep: trackId, at: T0 } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sealPayload / openPayload', () => {
  it('recovers a payload sealed with the same code', async () => {
    const keys = await deriveKeys(codeBytes(1));
    const payload = samplePayload();

    const blob = await sealPayload(keys, payload);

    expect(await openPayload(keys, blob)).toEqual(payload);
  });

  it('recovers nothing with a different code', async () => {
    const a = await deriveKeys(codeBytes(1));
    const b = await deriveKeys(codeBytes(2));

    const blob = await sealPayload(a, samplePayload());

    await expect(openPayload(b, blob)).resolves.toBeNull();
  });

  it('never puts the plaintext in the blob', async () => {
    const keys = await deriveKeys(codeBytes(3));

    const blob = await sealPayload(keys, samplePayload('ZZMARKERZZ'));

    expect(Buffer.from(blob).includes(Buffer.from('ZZMARKERZZ'))).toBe(false);
  });

  it('produces a different blob every time it seals the same payload', async () => {
    const keys = await deriveKeys(codeBytes(4));
    const payload = samplePayload();

    const first = await sealPayload(keys, payload);
    const second = await sealPayload(keys, payload);

    expect(first).not.toEqual(second);
    expect(first.length).toBe(second.length);
  });

  it('rejects a flipped version byte, so a gzip blob cannot be downgraded', async () => {
    const keys = await deriveKeys(codeBytes(5));
    const blob = await sealPayload(keys, samplePayload());

    blob[0] = blob[0] === 2 ? 1 : 2;

    await expect(openPayload(keys, blob)).resolves.toBeNull();
  });

  it.each([0, 5, 20, -1])('rejects a blob with the byte at %i flipped', async (offset) => {
    const keys = await deriveKeys(codeBytes(6));
    const blob = await sealPayload(keys, samplePayload());
    const i = offset < 0 ? blob.length + offset : offset;

    blob[i] = (blob[i] ?? 0) ^ 0xff;

    await expect(openPayload(keys, blob)).resolves.toBeNull();
  });

  it('rejects a truncated blob', async () => {
    const keys = await deriveKeys(codeBytes(7));
    const blob = await sealPayload(keys, samplePayload());

    await expect(openPayload(keys, blob.slice(0, 10))).resolves.toBeNull();
  });

  it('rejects a blob whose version this build does not know', async () => {
    const keys = await deriveKeys(codeBytes(8));
    const blob = await sealPayload(keys, samplePayload());

    blob[0] = 9;

    await expect(openPayload(keys, blob)).resolves.toBeNull();
  });

  it('compresses when CompressionStream is available', async () => {
    const keys = await deriveKeys(codeBytes(9));

    const blob = await sealPayload(keys, samplePayload());

    expect(blob[0]).toBe(2);
  });

  it('falls back to an uncompressed blob when CompressionStream is missing', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const keys = await deriveKeys(codeBytes(10));
    const payload = samplePayload();

    const blob = await sealPayload(keys, payload);

    expect(blob[0]).toBe(1);
    expect(await openPayload(keys, blob)).toEqual(payload);
  });

  it('rejects a payload of a shape this build cannot merge', async () => {
    const keys = await deriveKeys(codeBytes(11));
    // Reach past sealPayload's type to seal something structurally wrong, the
    // way a future version of the app could.
    const blob = await sealPayload(keys, { v: 1, nonsense: true } as unknown as SyncPayload);

    await expect(openPayload(keys, blob)).resolves.toBeNull();
  });
});

describe('deriveKeys', () => {
  it('produces a 43-character base64url id, matching what the worker validates', async () => {
    const { syncId } = await deriveKeys(codeBytes(12));

    expect(syncId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives the same code the same id every time', async () => {
    const a = await deriveKeys(codeBytes(13));
    const b = await deriveKeys(codeBytes(13));

    expect(a.syncId).toBe(b.syncId);
  });

  it('leaks nothing about the code: codes differing in one byte give unrelated ids', async () => {
    const ids: string[] = [];
    for (let last = 0; last < 64; last++) {
      const raw = codeBytes(0);
      raw[CODE_BYTES - 1] = last;
      ids.push((await deriveKeys(raw)).syncId);
    }

    expect(new Set(ids).size).toBe(64);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        let shared = 0;
        while (shared < a.length && a[shared] === b[shared]) shared++;
        expect(shared).toBeLessThanOrEqual(2);
      }
    }
  });
});
