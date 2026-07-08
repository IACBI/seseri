import type { Episode } from '../feeds/types';
import { httpsOnly } from '../lib/safe';
import { ytServiceAudioUrl } from '../youtube/piped';

export type DownloadOutcome = 'ok' | 'no-url';

/**
 * Download an episode via a temporary <a download>. YouTube items resolve a
 * real audio URL on demand. (P3 replaces this with Cache API offline copies.)
 */
export async function downloadEpisode(ep: Episode, feedIsYT: boolean): Promise<DownloadOutcome> {
  let src = httpsOnly(ep.episodeUrl || '');
  if (!src && feedIsYT && ep.ytId) {
    try {
      const u = await ytServiceAudioUrl(ep.ytId);
      if (u) {
        ep.episodeUrl = u;
        src = httpsOnly(u);
      }
    } catch {
      /* resolution failed — reported below */
    }
  }
  if (!src) return 'no-url';

  // Keep letters (incl. Turkish), digits, spaces, dashes; cap length.
  const name =
    (ep.trackName || 'bolum')
      .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
      .trim()
      .substring(0, 80) || 'bolum';
  const a = document.createElement('a');
  a.href = src;
  a.download = name + '.mp3';
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return 'ok';
}
