import { pbPause, pbPlay } from './engine';

export interface MediaSessionActions {
  seekBack(): void;
  seekForward(): void;
  prevTrack(): void;
  nextTrack(): void;
}

/** Lock-screen / headset media controls. */
export function initMediaSession(actions: MediaSessionActions): void {
  if (!('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => pbPlay());
    ms.setActionHandler('pause', () => pbPause());
    ms.setActionHandler('seekbackward', () => actions.seekBack());
    ms.setActionHandler('seekforward', () => actions.seekForward());
    ms.setActionHandler('previoustrack', () => actions.prevTrack());
    ms.setActionHandler('nexttrack', () => actions.nextTrack());
  } catch {
    /* partial support — fine */
  }
}

export function setMediaMetadata(meta: {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
}): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artworkUrl ? [{ src: meta.artworkUrl }] : [],
    });
  } catch {
    /* metadata is progressive enhancement */
  }
}
