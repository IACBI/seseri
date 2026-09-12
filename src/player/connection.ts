/**
 * What the radio will put up with.
 *
 * Two features ask the same question — the background prefetch of the playing
 * episode, and auto-downloading new episodes — and they were about to answer it
 * twice. The answer is deliberately conservative in one direction only: it
 * backs off when the browser *positively* reports a problem, and assumes
 * everything is fine when it says nothing, because on iOS it always says
 * nothing.
 */

export type NetworkPolicy = 'always' | 'wifi' | 'never';

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

/** Cheap, best-effort read of the radio; absent on iOS, where we assume wifi. */
function connection(): Connection | undefined {
  return (navigator as Navigator & { connection?: Connection }).connection;
}

/**
 * True when a background transfer is allowed right now.
 *
 * `saveData` is the listener telling the browser to spare their data, and is
 * honoured whatever the policy says. A 2g radio is refused for the same reason:
 * the transfer would spend the allowance without finishing.
 */
export function transferAllowed(policy: NetworkPolicy): boolean {
  if (policy === 'never') return false;
  const c = connection();
  if (c?.saveData) return false;
  if (c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g') return false;
  if (policy === 'always') return true;
  // 'wifi': only back off when the browser says it is on cellular.
  return c?.type !== 'cellular';
}
