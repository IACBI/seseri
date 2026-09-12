// @vitest-environment jsdom
/**
 * Lazy show notes. The risk this guards is a network request per episode
 * change — or worse, per render — on a feed that simply has no notes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from './types';

const fetchEpisodeNotes = vi.hoisted(() => vi.fn<(u: string, id: string) => Promise<string>>());
const patchCachedEpisode = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('./proxy-chain', () => ({ fetchEpisodeNotes }));
vi.mock('../storage/db', () => ({ patchCachedEpisode }));

import { loadEpisodeNotes, resetEpisodeNotesCache } from './episode-notes';

const FEED = 'rss:https://feeds.example.com/pod.xml';

function ep(overrides: Partial<Episode> = {}): Episode {
  return {
    trackId: 'g1',
    trackName: 'Ep 1',
    releaseDate: '',
    episodeUrl: 'https://cdn.example.com/1.mp3',
    trackTimeMillis: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetEpisodeNotesCache();
  fetchEpisodeNotes.mockReset();
  patchCachedEpisode.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('loadEpisodeNotes', () => {
  it('returns notes already on the episode without asking the network', async () => {
    await expect(loadEpisodeNotes(FEED, ep({ description: '<p>here</p>' }))).resolves.toBe(
      '<p>here</p>',
    );
    expect(fetchEpisodeNotes).not.toHaveBeenCalled();
  });

  it('fetches by feed url and track id when they are missing', async () => {
    fetchEpisodeNotes.mockResolvedValue('<p>fetched</p>');
    await expect(loadEpisodeNotes(FEED, ep())).resolves.toBe('<p>fetched</p>');
    expect(fetchEpisodeNotes).toHaveBeenCalledWith('https://feeds.example.com/pod.xml', 'g1');
  });

  it('keeps what it fetched, so a reload and offline still have it', async () => {
    fetchEpisodeNotes.mockResolvedValue('<p>fetched</p>');
    await loadEpisodeNotes(FEED, ep());
    expect(patchCachedEpisode).toHaveBeenCalledWith(FEED, 'g1', {
      description: '<p>fetched</p>',
    });
  });

  it('asks once per episode, however many times it is rendered', async () => {
    fetchEpisodeNotes.mockResolvedValue('<p>fetched</p>');
    await loadEpisodeNotes(FEED, ep());
    await loadEpisodeNotes(FEED, ep());
    await loadEpisodeNotes(FEED, ep());
    expect(fetchEpisodeNotes).toHaveBeenCalledTimes(1);
  });

  it('remembers a negative answer, so a feed with no notes is asked once', async () => {
    fetchEpisodeNotes.mockResolvedValue('');
    await expect(loadEpisodeNotes(FEED, ep())).resolves.toBe('');
    await expect(loadEpisodeNotes(FEED, ep())).resolves.toBe('');
    expect(fetchEpisodeNotes).toHaveBeenCalledTimes(1);
    // Nothing to keep, so nothing was written.
    expect(patchCachedEpisode).not.toHaveBeenCalled();
  });

  it('shares one request between simultaneous renders', async () => {
    let release = (_: string): void => undefined;
    fetchEpisodeNotes.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const a = loadEpisodeNotes(FEED, ep());
    const b = loadEpisodeNotes(FEED, ep());
    release('<p>shared</p>');
    await expect(a).resolves.toBe('<p>shared</p>');
    await expect(b).resolves.toBe('<p>shared</p>');
    expect(fetchEpisodeNotes).toHaveBeenCalledTimes(1);
  });

  it('treats episodes separately', async () => {
    fetchEpisodeNotes.mockImplementation(async (_u, id) => `notes for ${id}`);
    await expect(loadEpisodeNotes(FEED, ep({ trackId: 'g1' }))).resolves.toBe('notes for g1');
    await expect(loadEpisodeNotes(FEED, ep({ trackId: 'g2' }))).resolves.toBe('notes for g2');
    expect(fetchEpisodeNotes).toHaveBeenCalledTimes(2);
  });

  it('does not try for a feed whose id carries no url', async () => {
    // An Apple feed id is a bare numeric collection id, and its episodes
    // already arrive with notes from the lookup response.
    await expect(loadEpisodeNotes('777000111', ep())).resolves.toBe('');
    expect(fetchEpisodeNotes).not.toHaveBeenCalled();
  });

  it('answers empty for an episode with no id', async () => {
    await expect(loadEpisodeNotes(FEED, ep({ trackId: '' }))).resolves.toBe('');
    expect(fetchEpisodeNotes).not.toHaveBeenCalled();
  });
});
