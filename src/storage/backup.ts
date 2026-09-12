import { local } from './local';

/**
 * The JSON backup: which keys it carries, and how a file is written back.
 *
 * Extracted from the settings view so the sidecar rule below is reachable from
 * a test. It is the one part of the backup that can corrupt *another* device's
 * data, which makes it the part most worth pinning down.
 */

/**
 * Keys the backup round-trips. The queue joined them when it gained its own
 * store; the sidecars joined when sync gained timestamps.
 *
 * `pp_sync` is excluded on purpose: the pairing code is the credential for the
 * whole sync row, and a backup file gets mailed around and dropped in cloud
 * storage.
 */
export const BACKUP_KEYS = [
  'pp_settings',
  'pp_favs',
  'pp_prog',
  'pp_prog_at',
  'pp_queue',
  'pp_last_at',
  'pp_subs_at',
  'pp_subs_rm',
  'pp_queue_at',
  'pp_played',
  'pp_played_rm',
  'pp_feed_speed',
] as const;

/**
 * Sidecars that carry a timestamp for the value they sit beside. If a restored
 * file supplies the value but not its stamp, the stamp on disk belongs to data
 * that no longer exists and has to go with it.
 */
const SIDECARS: ReadonlyArray<readonly [value: string, stamp: string]> = [
  ['pp_prog', 'pp_prog_at'],
  ['pp_favs', 'pp_last_at'],
  ['pp_favs', 'pp_subs_at'],
  ['pp_favs', 'pp_subs_rm'],
  ['pp_queue', 'pp_queue_at'],
  // `pp_played` IS its own stamp map (id → when), so the pair here exists only
  // to tie the tombstones to it: a file with the marks but not the tombstones
  // would resurrect episodes the listener had reset.
  ['pp_played', 'pp_played_rm'],
];

export function exportBackup(): string {
  const dump: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  for (const key of BACKUP_KEYS) dump[key] = local.get(key, null);
  return JSON.stringify(dump, null, 2);
}

/**
 * Restore a backup. There was an export button and no import, which makes the
 * export not a backup at all — nothing could ever be recovered from it.
 *
 * Written straight to the same localStorage keys, after which the caller
 * reloads: every loader (`loadSettings`, `loadSubscriptions`, `loadProgress`,
 * `loadQueue`) already validates its own shape on the way in, so a hand-edited
 * file is rejected field by field rather than trusted here.
 */
export function restoreBackup(text: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const dump = data as Record<string, unknown>;

  // A file with none of the keys is somebody else's JSON, not a backup.
  if (!BACKUP_KEYS.some((k) => dump[k] !== undefined && dump[k] !== null)) return false;

  for (const key of BACKUP_KEYS) {
    const value = dump[key];
    if (value === undefined || value === null) continue;
    local.set(key, value);
  }

  /**
   * A backup taken before sync existed has no sidecars, and the loop above
   * skips absent keys. Leaving the current ones in place would stamp the
   * restored (old) positions as freshly written, and on the next merge they
   * would beat the genuinely newer data on the *other* device — where nobody
   * restored anything and nothing looks wrong.
   */
  for (const [value, stamp] of SIDECARS) {
    if (dump[value] !== undefined && dump[value] !== null && dump[stamp] === undefined) {
      local.remove(stamp);
    }
  }
  return true;
}
