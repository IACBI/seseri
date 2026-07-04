import { local } from './local';

/** Resume positions: episode id → seconds. Legacy key `pp_prog`. */
let prog: Record<string, number> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let onQuotaPruned: (() => void) | null = null;

export function loadProgress(): void {
  prog = local.get<Record<string, number>>('pp_prog', {});
  if (!prog || typeof prog !== 'object') prog = {};
}

export function getProgress(id: string): number {
  return prog[id] ?? 0;
}

export function setProgress(id: string, seconds: number): void {
  prog[id] = seconds;
  scheduleSave();
}

export function clearProgress(): void {
  prog = {};
  saveProgressNow();
}

/** Quota recovery: drop the oldest half of saved positions (legacy behavior). */
function pruneProgress(): void {
  const keys = Object.keys(prog);
  for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete prog[k];
  local.set('pp_prog', prog);
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

/** Throttled: at most one write per 5 s while playing. */
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    local.set('pp_prog', prog, pruneProgress);
    saveTimer = null;
  }, 5000);
}

export function saveProgressNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  local.set('pp_prog', prog, pruneProgress);
}

/** Last-played episode per feed. Legacy keys `pp_last_<feedId>`. */
export function getLastPlayed(feedId: string): string | null {
  return local.rawGet('pp_last_' + feedId);
}

export function setLastPlayed(feedId: string, episodeId: string): void {
  local.rawSet('pp_last_' + feedId, episodeId);
}
