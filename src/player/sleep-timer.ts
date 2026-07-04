import { pbPause } from './engine';

let timer: ReturnType<typeof setTimeout> | null = null;

/** Set (or clear with 0) the sleep timer. onDone fires when playback stops. */
export function setSleepTimer(minutes: number, onDone: () => void): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (minutes > 0) {
    timer = setTimeout(() => {
      pbPause();
      timer = null;
      onDone();
    }, minutes * 60000);
  }
}

export function sleepTimerActive(): boolean {
  return timer !== null;
}
