import type { Episode } from '../feeds/types';
import { httpsOnly } from '../lib/safe';

/**
 * `'opened'` — the URL was handed to the browser, which is all we can observe.
 * There is deliberately no `'ok'`: this runs only after the Cache API path
 * failed on CORS, so the target is always cross-origin, and a cross-origin
 * `download` attribute is ignored by every browser. The old code set one
 * anyway and reported `'ok'` unconditionally, so the user was told "saved" for
 * a file that had merely been opened in a tab.
 */
export type DownloadOutcome = 'opened' | 'no-url';

/**
 * Last-resort handoff for an episode whose CDN refuses CORS: open the audio URL
 * so the user can save it with the browser's own controls.
 */
export function downloadEpisode(ep: Episode): DownloadOutcome {
  const src = httpsOnly(ep.episodeUrl || '');
  if (!src) return 'no-url';

  /**
   * The return value cannot be read as success or failure here: with
   * `noopener` set, `window.open` "returns null" by specification, whatever
   * happens to the window. The old `if (!w) return 'no-url'` therefore
   * reported failure on *every* successful open, so a listener downloading
   * from a CORS-less CDN — a tracking redirect like podtrac fronts a lot of
   * big shows — was told the download link could not be found while the
   * browser was already fetching the file.
   *
   * Dropping `noopener` would make the handle readable again, at the price of
   * handing a cross-origin page a reference to ours. That is not a trade worth
   * making to word a toast, so the outcome is what we can honestly claim: the
   * URL was handed over. A popup blocker can still swallow it, which is why
   * the message says "opened in a new tab" rather than "saved".
   */
  window.open(src, '_blank', 'noopener,noreferrer');
  return 'opened';
}
