import { describe, expect, it } from 'vitest';
import { chronological } from './order';
import type { Episode } from './types';

/** A `pubDate` no `Date` parser reads: non-English day and month names. */
const UNREADABLE = 'Pzt, 01 Oca 2024 10:00:00 +0300';

function ep(id: string, releaseDate: string): Episode {
  return {
    trackId: id,
    trackName: id,
    releaseDate,
    episodeUrl: `https://cdn.example.com/${id}.mp3`,
    trackTimeMillis: 0,
  };
}

const ids = (list: readonly Episode[]): string[] => list.map((e) => e.trackId);

describe('chronological', () => {
  it('sorts a dated feed oldest-first', () => {
    const list = chronological([
      ep('c', '2024-01-03'),
      ep('a', '2024-01-01'),
      ep('b', '2024-01-02'),
    ]);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('reverses a feed with no dates, which every source hands over newest-first', () => {
    expect(ids(chronological([ep('c', ''), ep('b', ''), ep('a', '')]))).toEqual(['a', 'b', 'c']);
  });

  it('treats dates it cannot read like missing ones', () => {
    // Newest-first as published. Sorting on the unreadable values left this in
    // source order, so the newest episode was listed as number 1.
    const list = chronological([ep('c', UNREADABLE), ep('b', UNREADABLE), ep('a', UNREADABLE)]);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('does not let one unreadable date scramble the readable ones', () => {
    const list = chronological([
      ep('f', '2024-01-06'),
      ep('e', UNREADABLE),
      ep('d', '2024-01-04'),
      ep('c', '2024-01-03'),
      ep('b', '2024-01-02'),
      ep('a', '2024-01-01'),
    ]);
    const readable = ids(list).filter((id) => id !== 'e');
    expect(readable).toEqual(['a', 'b', 'c', 'd', 'f']);
  });
});
