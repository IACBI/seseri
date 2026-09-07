import { onEngine } from '../player/engine';
import { playing } from '../player/session';
import { queue } from '../state/queue';
import { signal } from '../state/signals';
import { local } from '../storage/local';
import { saveProgressNow } from '../storage/progress';
import { subscriptions } from '../storage/subscriptions';
import { decodeCode, generateCode } from './code';
import { deriveKeys, openPayload, sealPayload } from './crypto';
import type { SyncKeys } from './crypto';
import { capPayload, emptyPayload, mergePayload } from './merge';
import { applyPayload, readLocalPayload } from './snapshot';
import {
  SYNC_AVAILABLE,
  deleteBlob,
  getSkewMs,
  pullBlob,
  pushBlob,
  setSkewMs,
} from './transport';
import type { SyncPayload } from './types';

/**
 * Orchestration: when to sync, and what to do with the result.
 *
 * The cycle is always pull → merge → apply → push. Pushing without pulling
 * first is what compare-and-set exists to prevent, so a 409 sends us back
 * through the merge rather than retrying the same blob.
 *
 * One rule outranks everything else here: a remote payload that cannot be read
 * — wrong code, corrupted row, a version this build does not understand —
 * never touches local state. Local is authoritative on every device; the blob
 * is a copy.
 */

const STATE_KEY = 'pp_sync';

/**
 * Long enough that a two-hour listen costs tens of writes rather than hundreds,
 * short enough not to matter: the forced pushes below cover every moment a user
 * would actually pick up the other device.
 */
const DEBOUNCE_MS = 30_000;

/** Beyond this the payload is capped rather than rejected by the server. */
const MAX_PROGRESS_ENTRIES = 1500;

const MAX_CONFLICT_RETRIES = 2;

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'unavailable' | 'unreadable';

export interface SyncState {
  linked: boolean;
  /** The pairing code, for the settings screen to show. */
  code: string | null;
  status: SyncStatus;
  lastSyncAt: number;
}

export const syncState = signal<SyncState>({
  linked: false,
  code: null,
  status: 'idle',
  lastSyncAt: 0,
});

interface Stored {
  code: string;
  rev: number;
  skewMs: number;
}

let keys: SyncKeys | null = null;
let rev = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;
let wired = false;
/** True while a pull is being written, so its own writes do not queue a sync. */
let applying = false;

function store(): void {
  const code = syncState().code;
  if (!code) return;
  local.set(STATE_KEY, { code, rev, skewMs: getSkewMs() } satisfies Stored);
}

function setStatus(status: SyncStatus, touched = false): void {
  syncState.set({
    ...syncState(),
    status,
    lastSyncAt: touched ? Date.now() : syncState().lastSyncAt,
  });
}

/** The merge compares server-clock stamps, and this device's clock may be off. */
function nowServer(): number {
  return Date.now() + getSkewMs();
}

/**
 * The episode playing right now is left out of an inbound merge: a stale remote
 * value would land and be overwritten by the next `timeupdate` a second later,
 * which is a write storm and a visible flicker on the mini scrub.
 */
function excluded(): Set<string> {
  const id = playing()?.trackId;
  return id ? new Set([id]) : new Set<string>();
}

async function adopt(codeText: string): Promise<boolean> {
  const bytes = decodeCode(codeText);
  if (!bytes) return false;
  keys = await deriveKeys(bytes);
  rev = 0;
  syncState.set({ linked: true, code: codeText, status: 'idle', lastSyncAt: 0 });
  store();
  return true;
}

/** Generate a fresh pairing code on this device. Returns it for display. */
export async function startSync(): Promise<string | null> {
  if (!SYNC_AVAILABLE) return null;
  const code = generateCode();
  if (!(await adopt(code))) return null;
  void syncNow();
  return code;
}

/** Pair with a code typed in from another device. */
export async function linkSync(typed: string): Promise<boolean> {
  if (!SYNC_AVAILABLE) return false;
  if (!(await adopt(typed))) return false;
  await syncNow();
  return true;
}

/** Stop syncing on this device. Local listening history is untouched. */
export function unlinkSync(): void {
  keys = null;
  rev = 0;
  local.remove(STATE_KEY);
  syncState.set({ linked: false, code: null, status: 'idle', lastSyncAt: 0 });
}

/** Delete the stored blob for everyone, then unlink here. */
export async function forgetRemote(): Promise<boolean> {
  if (!keys) return false;
  const ok = await deleteBlob(keys.syncId);
  unlinkSync();
  return ok;
}

/**
 * Write a merged payload, and hand back what was actually written.
 *
 * The re-read is load-bearing. Pulling is an `await`, and anything the user did
 * during it — unsubscribing, reordering the queue — is already in storage but
 * absent from the payload computed before it. Writing that payload wholesale
 * would silently undo their tap, and because the stores are replaced rather
 * than patched, even the tombstone recording the change would disappear.
 * Reading and writing here happen with no `await` between them, so there is no
 * window left.
 *
 * Returning the result also keeps the push honest: what goes to the server is
 * what this device now holds.
 */
function applyLocally(payload: SyncPayload): SyncPayload {
  applying = true;
  try {
    const fresh = mergePayload(readLocalPayload(getSkewMs()), payload, nowServer());
    applyPayload(fresh, getSkewMs(), excluded());
    return fresh;
  } finally {
    applying = false;
  }
}

async function readRemote(blob: Uint8Array): Promise<SyncPayload | null> {
  return keys ? openPayload(keys, blob) : null;
}

async function pushMerged(merged: SyncPayload): Promise<boolean> {
  if (!keys) return false;
  let payload = merged;
  let attempt = 0;

  for (;;) {
    const sealed = await sealPayload(keys, capPayload(payload, MAX_PROGRESS_ENTRIES));
    const res = await pushBlob(keys.syncId, sealed, rev);

    if (res.kind === 'ok') {
      rev = res.rev;
      store();
      return true;
    }
    if (res.kind === 'conflict' && attempt++ < MAX_CONFLICT_RETRIES) {
      // Somebody wrote between our pull and our push. The 409 carried their
      // blob, so merge into it rather than retrying ours unchanged.
      const theirs = await readRemote(res.blob);
      if (!theirs) {
        setStatus('unreadable');
        return false;
      }
      payload = applyLocally(mergePayload(payload, theirs, nowServer()));
      rev = res.rev;
      continue;
    }
    setStatus(res.kind === 'unavailable' ? 'unavailable' : 'error');
    return false;
  }
}

/** One full cycle. Safe to call at any time; overlapping calls are serialised. */
export async function syncNow(): Promise<void> {
  if (!SYNC_AVAILABLE || !keys) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus('syncing');

  try {
    // Flush the throttled position write first, or the payload is up to five
    // seconds behind what the user just listened to.
    saveProgressNow();

    const pulled = await pullBlob(keys.syncId);
    if (pulled.kind === 'unavailable') {
      setStatus('unavailable');
      return;
    }
    if (pulled.kind === 'error') {
      setStatus('error');
      return;
    }

    let remote = emptyPayload();
    if (pulled.kind === 'ok') {
      const opened = await readRemote(pulled.blob);
      if (!opened) {
        // Wrong code or a clobbered row. Stop — pushing over it would destroy
        // whatever is actually there, and wiping local would destroy this
        // device's history for a fault that is entirely remote.
        setStatus('unreadable');
        return;
      }
      remote = opened;
      rev = pulled.rev;
    } else {
      rev = 0;
    }

    const merged = applyLocally(mergePayload(readLocalPayload(getSkewMs()), remote, nowServer()));

    if (await pushMerged(merged)) setStatus('ok', true);
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

/** Coalesce bursts of activity into one sync. */
export function syncSoon(): void {
  if (!SYNC_AVAILABLE || !keys || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

/**
 * Last-gasp push on the way out. Deliberately not a full cycle: there is no
 * time to pull and merge at unload, so this sends what we have and lets the
 * next launch resolve any conflict.
 */
export function syncFlush(): void {
  if (!SYNC_AVAILABLE || !keys) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saveProgressNow();
  const snapshot = capPayload(readLocalPayload(getSkewMs()), MAX_PROGRESS_ENTRIES);
  const active = keys;
  void sealPayload(active, snapshot).then((sealed) =>
    pushBlob(active.syncId, sealed, rev, { keepalive: true }),
  );
}

function wire(): void {
  if (wired) return;
  wired = true;
  onEngine((e) => {
    // Pause and end are the moments a listener is most likely to walk to the
    // other device; everything else rides the debounce.
    if (e.type === 'pause' || e.type === 'ended') syncSoon();
  });
  // Subscribing or reordering the queue is worth carrying over promptly. The
  // `applying` guard is load-bearing: a pull writes these same signals, and
  // without it every sync would schedule the next one, forever.
  subscriptions.subscribe(() => {
    if (!applying) syncSoon();
  });
  queue.subscribe(() => {
    if (!applying) syncSoon();
  });
}

export function initSync(): void {
  if (!SYNC_AVAILABLE) return;
  wire();

  const saved = local.get<Partial<Stored> | null>(STATE_KEY, null);
  if (!saved || typeof saved.code !== 'string') return;
  const code = saved.code;
  if (typeof saved.skewMs === 'number') setSkewMs(saved.skewMs);

  void (async () => {
    if (!(await adopt(code))) {
      // A stored code that no longer parses is not recoverable; leaving it
      // would retry forever against an id we cannot derive.
      unlinkSync();
      return;
    }
    rev = typeof saved.rev === 'number' ? saved.rev : 0;
    await syncNow();
  })();
}
