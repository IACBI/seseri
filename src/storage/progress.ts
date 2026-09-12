import { local } from './local';

/** Resume positions: episode id → seconds. Legacy key `pp_prog`. */
let prog: Record<string, number> = {};

/**
 * When each position was written: episode id → ms epoch. Sidecar key
 * `pp_prog_at`, deliberately *not* folded into `pp_prog`.
 *
 * Cross-device sync needs a timestamp per entry to resolve conflicts, but
 * changing the shape of `pp_prog` would invalidate every backup file ever
 * exported and make a rollback a data migration. Kept beside it, the timestamps
 * are additive: an older build ignores this key, and deleting it costs nothing
 * but conflict resolution (a missing stamp reads as 0, which loses to nothing —
 * see `SIMULTANEITY_MS` in src/sync/merge.ts).
 */
let progAt: Record<string, number> = {};

/** Same idea for the per-feed last-played pointers. Key `pp_last_at`. */
let lastAt: Record<string, number> = {};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let onQuotaPruned: (() => void) | null = null;

const LAST_PREFIX = 'pp_last_';

function asRecord(v: unknown): Record<string, number> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
}

export function loadProgress(): void {
  prog = local.get<Record<string, number>>('pp_prog', {});
  if (!prog || typeof prog !== 'object') prog = {};
  progAt = asRecord(local.get<unknown>('pp_prog_at', {}));
  lastAt = asRecord(local.get<unknown>('pp_last_at', {}));

  // Stamps for positions that no longer exist would accumulate forever, since
  // pruning only ever touches `prog`.
  for (const k of Object.keys(progAt)) {
    if (!(k in prog)) delete progAt[k];
  }

  // Pointers written before the sidecar existed report 0 rather than going
  // missing, so a first sync merges them instead of ignoring them.
  for (const key of local.keys(LAST_PREFIX)) {
    const feedId = key.slice(LAST_PREFIX.length);
    if (!(feedId in lastAt)) lastAt[feedId] = 0;
  }
}

export function getProgress(id: string): number {
  return prog[id] ?? 0;
}

export function setProgress(id: string, seconds: number): void {
  prog[id] = seconds;
  progAt[id] = Date.now();
  scheduleSave();
}

/**
 * Forget one episode's position. Used by "mark as unplayed", which means start
 * it again from the beginning rather than from where it was abandoned.
 */
export function clearProgressFor(episodeId: string): void {
  if (prog[episodeId] === undefined && progAt[episodeId] === undefined) return;
  delete prog[episodeId];
  delete progAt[episodeId];
  saveProgressNow();
}

export function clearProgress(): void {
  prog = {};
  progAt = {};
  lastAt = {};
  saveProgressNow();
}

/** Quota recovery: drop the oldest half of saved positions (legacy behavior). */
function pruneProgress(): void {
  const keys = Object.keys(prog);
  for (const k of keys.slice(0, Math.ceil(keys.length / 2))) {
    delete prog[k];
    delete progAt[k];
  }
  local.set('pp_prog', prog);
  local.set('pp_prog_at', progAt);
  onQuotaPruned?.();
}

/** UI hook: called once when quota forces pruning (shows a status message). */
export function setQuotaListener(fn: () => void): void {
  let warned = false;
  onQuotaPruned = () => {
    if (!warned) {
      warned = true;
      fn();
    }
  };
}

/**
 * Positions first, stamps second, and never the other way round.
 *
 * If the second write fails on quota the result is a real position wearing a
 * stale or absent stamp, which loses its next conflict — harmless. Reversed, it
 * would be a fresh stamp on an old position, which would beat genuinely newer
 * data on the other device.
 */
function writeAll(): void {
  local.set('pp_prog', prog, pruneProgress);
  local.set('pp_prog_at', progAt);
  local.set('pp_last_at', lastAt);
}

/** Throttled: at most one write per 5 s while playing. */
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    writeAll();
    saveTimer = null;
  }, 5000);
}

export function saveProgressNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeAll();
}

/** Last-played episode per feed. Legacy keys `pp_last_<feedId>`. */
export function getLastPlayed(feedId: string): string | null {
  return local.rawGet(LAST_PREFIX + feedId);
}

export function setLastPlayed(feedId: string, episodeId: string): void {
  local.rawSet(LAST_PREFIX + feedId, episodeId);
  lastAt[feedId] = Date.now();
  local.set('pp_last_at', lastAt);
}

/**
 * Move saved positions (and their stamps) from one episode id to another.
 *
 * The one caller is the Apple→RSS archive switch: the same episode is `trackId`
 * 1000123 to Apple and `<guid>abc` in the show's own feed, and without this
 * every position a listener had saved would be orphaned the moment the full
 * archive replaced the truncated listing. Returns how many moved.
 *
 * A destination that already has a position is left alone: it was written
 * against the new id, so it is the newer of the two by construction.
 */
export function remapProgressIds(pairs: ReadonlyArray<readonly [string, string]>): number {
  let moved = 0;
  for (const [from, to] of pairs) {
    if (from === to) continue;
    const value = prog[from];
    if (value === undefined) continue;
    if (prog[to] === undefined) {
      prog[to] = value;
      const at = progAt[from];
      if (at !== undefined) progAt[to] = at;
      moved++;
    }
    delete prog[from];
    delete progAt[from];
  }
  if (moved) saveProgressNow();
  return moved;
}

/** Point a feed's last-played marker at a new episode id. */
export function remapLastPlayed(feedId: string, pairs: ReadonlyArray<readonly [string, string]>): boolean {
  const current = getLastPlayed(feedId);
  if (!current) return false;
  const hit = pairs.find(([from]) => from === current);
  if (!hit || hit[0] === hit[1]) return false;
  // Keeps the existing stamp: nothing about when it was played has changed.
  local.rawSet(LAST_PREFIX + feedId, hit[1]);
  return true;
}

/** Everything sync needs to read, copied so callers cannot mutate the live maps. */
export function progressSnapshot(): {
  prog: Record<string, number>;
  progAt: Record<string, number>;
  lastAt: Record<string, number>;
} {
  return { prog: { ...prog }, progAt: { ...progAt }, lastAt: { ...lastAt } };
}

/**
 * Apply a merged set from another device in one write.
 *
 * Additive on purpose: entries the merge did not mention are left alone, and
 * nothing here ever deletes a position. A remote payload that failed to decrypt
 * must never be able to empty local history.
 */
export function mergeProgress(
  entries: Record<string, { t: number; at: number }>,
  lastPlayed: Record<string, { ep: string; at: number }>,
): void {
  for (const [id, entry] of Object.entries(entries)) {
    prog[id] = entry.t;
    progAt[id] = entry.at;
  }
  for (const [feedId, entry] of Object.entries(lastPlayed)) {
    if (local.rawGet(LAST_PREFIX + feedId) !== entry.ep) {
      local.rawSet(LAST_PREFIX + feedId, entry.ep);
    }
    lastAt[feedId] = entry.at;
  }
  saveProgressNow();
}
