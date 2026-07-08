import { signal } from './signals';

/** What the transport is currently loaded with (null = nothing yet). */
export interface NowPlaying {
  title: string;
  feedName: string;
  art: string;
}

export const nowPlaying = signal<NowPlaying | null>(null);
