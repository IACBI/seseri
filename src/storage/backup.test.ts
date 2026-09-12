// @vitest-environment jsdom
/**
 * Restoring a backup is the one operation that can corrupt data on a device
 * that was never touched. A pre-sync file carries positions but no timestamps;
 * leaving the timestamps from before the restore in place would stamp
 * months-old positions as fresh, and the next merge would push them over the
 * other device's genuinely current data — where nobody restored anything and
 * nothing looks wrong.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_KEYS, exportBackup, restoreBackup } from './backup';

const NOW = 1_700_000_000_000;

function seedSyncedDevice(): void {
  localStorage.setItem('pp_prog', JSON.stringify({ '111': 900 }));
  localStorage.setItem('pp_prog_at', JSON.stringify({ '111': NOW }));
  localStorage.setItem('pp_favs', JSON.stringify([{ id: 'f1', name: 'A', artist: '', art: '' }]));
  localStorage.setItem('pp_last_at', JSON.stringify({ f1: NOW }));
  localStorage.setItem('pp_subs_at', JSON.stringify({ f1: NOW }));
  localStorage.setItem('pp_subs_rm', JSON.stringify({ f9: NOW }));
  localStorage.setItem('pp_queue', JSON.stringify([]));
  localStorage.setItem('pp_queue_at', JSON.stringify(NOW));
  localStorage.setItem('pp_played', JSON.stringify({ '111': NOW }));
  localStorage.setItem('pp_played_rm', JSON.stringify({ '222': NOW }));
  localStorage.setItem('pp_feed_speed', JSON.stringify({ f1: 1.5 }));
}

/** What a backup taken before sync existed looks like: values, no stamps. */
const PRE_SYNC_FILE = JSON.stringify({
  exportedAt: '2026-01-01T00:00:00.000Z',
  pp_prog: { '111': 30 },
  pp_favs: [{ id: 'f2', name: 'B', artist: '', art: '' }],
  pp_queue: [],
});

beforeEach(() => {
  localStorage.clear();
});

describe('restoreBackup', () => {
  it('writes every key the file carries', () => {
    expect(restoreBackup(PRE_SYNC_FILE)).toBe(true);

    expect(JSON.parse(localStorage.getItem('pp_prog') ?? '{}')).toEqual({ '111': 30 });
  });

  it.each([
    ['pp_prog_at', 'pp_prog'],
    ['pp_last_at', 'pp_favs'],
    ['pp_subs_at', 'pp_favs'],
    ['pp_subs_rm', 'pp_favs'],
    ['pp_queue_at', 'pp_queue'],
  ])('drops the stale %s when the file restores %s without it', (stamp) => {
    seedSyncedDevice();

    restoreBackup(PRE_SYNC_FILE);

    expect(localStorage.getItem(stamp)).toBeNull();
  });

  it('keeps the sidecars a modern backup supplies', () => {
    seedSyncedDevice();
    const file = JSON.stringify({
      pp_prog: { '111': 30 },
      pp_prog_at: { '111': NOW - 86_400_000 },
    });

    restoreBackup(file);

    expect(JSON.parse(localStorage.getItem('pp_prog_at') ?? '{}')).toEqual({
      '111': NOW - 86_400_000,
    });
  });

  it('leaves a sidecar alone when the file does not restore its value either', () => {
    seedSyncedDevice();

    restoreBackup(JSON.stringify({ pp_settings: { theme: 'dark' } }));

    expect(JSON.parse(localStorage.getItem('pp_prog_at') ?? '{}')).toEqual({ '111': NOW });
  });

  it.each([
    ['malformed json', '{nope'],
    ['an array', '[]'],
    ['a bare string', '"hello"'],
    ['somebody else‑s json', '{"tracks":[1,2,3]}'],
  ])('refuses %s and changes nothing', (_label, text) => {
    seedSyncedDevice();

    expect(restoreBackup(text)).toBe(false);
    expect(JSON.parse(localStorage.getItem('pp_prog') ?? '{}')).toEqual({ '111': 900 });
  });
});

describe('played marks', () => {
  it('round-trip, so a restored device knows what it has heard', () => {
    seedSyncedDevice();
    const file = exportBackup();
    localStorage.clear();

    expect(restoreBackup(file)).toBe(true);
    expect(JSON.parse(localStorage.getItem('pp_played') ?? '{}')).toEqual({ '111': NOW });
    expect(JSON.parse(localStorage.getItem('pp_played_rm') ?? '{}')).toEqual({ '222': NOW });
  });

  it('drops stale tombstones when the file has marks but no tombstones', () => {
    // Same argument as every other sidecar: tombstones left over from before
    // the restore belong to marks that are no longer there, and would resurrect
    // episodes the listener had reset.
    seedSyncedDevice();
    expect(
      restoreBackup(
        JSON.stringify({ pp_prog: {}, pp_played: { '333': NOW } }),
      ),
    ).toBe(true);
    expect(localStorage.getItem('pp_played')).toBe(JSON.stringify({ '333': NOW }));
    expect(localStorage.getItem('pp_played_rm')).toBeNull();
  });
});

describe('per-show speeds', () => {
  it('travel with the backup, which is how a deliberate device move goes', () => {
    // Not synced — how fast you like to listen belongs to the device, like the
    // font size and the volume — so the backup file is the only way they move.
    seedSyncedDevice();
    const file = exportBackup();
    localStorage.clear();

    expect(restoreBackup(file)).toBe(true);
    expect(JSON.parse(localStorage.getItem('pp_feed_speed') ?? '{}')).toEqual({ f1: 1.5 });
  });
});

describe('exportBackup', () => {
  it('round-trips a synced device through export and restore', () => {
    seedSyncedDevice();
    const file = exportBackup();
    localStorage.clear();

    expect(restoreBackup(file)).toBe(true);

    for (const key of BACKUP_KEYS) {
      if (key === 'pp_settings') continue; // never seeded above
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('never puts the pairing code in the file', () => {
    seedSyncedDevice();
    localStorage.setItem('pp_sync', JSON.stringify({ code: 'ZZSECRETZZ', rev: 3, skewMs: 0 }));

    expect(exportBackup()).not.toContain('ZZSECRETZZ');
  });
});
