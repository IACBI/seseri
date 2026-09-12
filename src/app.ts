import { applyLang, t } from './i18n';
import { initMediaSession } from './player/media-session';
import { checkPlaybackHealth } from './player/recovery';
import { initKeepAwake } from './player/keep-awake';
import { initSleepTimer } from './player/sleep-timer';
import { initShortcuts } from './ui/shortcuts';
import { requestPersistence } from './player/offline';
import { pbCurrent, pbDuration, pbSeekTo, pbSetMuted, pbSetVolume } from './player/engine';
import {
  applyAppBadge,
  inbox,
  loadInbox,
  pendingInbox,
  sweepSubscriptions,
} from './feeds/inbox';
import { loadPlayed, playedRevision } from './storage/played';
import { loadProgress, saveProgressNow, setQuotaListener } from './storage/progress';
import { local } from './storage/local';
import { loadSubscriptions, subscriptions } from './storage/subscriptions';
import { loadQueue } from './state/queue';
import { loadFeedSpeeds } from './state/feed-speed';
import { loadSettings, saveSettings, settings, type Settings } from './state/settings';
import type { FeedRequest } from './feeds/types';
import { bindI18nDom } from './ui/i18n-dom';
import { initMiniPlayer } from './ui/mini-player';
import { initNav, type NavDestination } from './ui/nav';
import { initOfflineBanner } from './ui/offline-banner';
import { createPlaybackController } from './ui/playback-controller';
import { initRouter, parseLocation, type AppView } from './ui/router';
import { renderShell, must } from './ui/shell';
import { applyAccent, applyTheme } from './ui/theme';
import { toast } from './ui/toast';
import { showView, type ViewName } from './ui/views';
import { initHomeView } from './ui/views/home';
import { initLibraryView } from './ui/views/library';
import { initNowPlaying } from './ui/views/now-playing';
import { initPodcastView } from './ui/views/podcast';
import { initQueueView } from './ui/views/queue';
import { initSearchView } from './ui/views/search';
import { initSettingsView } from './ui/views/settings';
import { initSync, syncFlush } from './sync';

export function boot(): void {
  renderShell(must('app'));

  // ── state & appearance ───────────────────────────────────────────
  loadSettings();
  loadProgress();
  // After the positions: a mark is read against them.
  loadPlayed();
  loadSubscriptions();
  loadQueue();
  loadInbox();
  loadFeedSpeeds();
  const S = settings();
  applyTheme(S.theme);
  applyAccent(S.accentColor);
  applyLang(S.lang);
  document.documentElement.style.setProperty('--player-font-size', S.fontSize);
  document.documentElement.style.setProperty('--list-row-height', S.rowHeight);
  // One place writes the element's level, so the two volume controls never
  // have to agree with each other — both of them only write settings.
  const applyVolume = (s: Settings): void => {
    pbSetVolume(s.volume);
    pbSetMuted(s.muted);
  };
  applyVolume(S);
  settings.subscribe(applyVolume);
  setQuotaListener(() => toast(t('storage_full'), 'error'));
  requestPersistence(); // keep downloads/idb safe from storage-pressure eviction
  initOfflineBanner();
  // After the loaders: sync reads what they just restored, and pushes it.
  initSync();

  // ── playback session (single instance, shared by all views) ──────
  const playback = createPlaybackController();

  // Remembered across sessions for the "Resume" app shortcut (?resume=1)
  const rememberFeed = (req: FeedRequest): void => {
    local.set('pp_last_feed', req);
  };

  /**
   * Central "open a feed" intent — every entry point funnels through here.
   * `resume` is opt-in: opening a feed is browsing, and browsing must never
   * touch the transport. Only the surfaces that mean "continue where I left
   * off" pass it.
   */
  const openFeed = (
    req: FeedRequest,
    opts: { push?: boolean; focus?: boolean; resume?: boolean } = {},
  ): void => {
    rememberFeed(req);
    playback.openFeed(req);
    if (opts.resume) playback.resumeLastPlayed();
    showView('podcast', { focus: opts.focus ?? true });
    router.feedOpened(req, opts.push ?? true);
  };

  // ── views ─────────────────────────────────────────────────────────
  /**
   * Open a feed and start one specific episode. The new-episodes rail and an
   * `?ep=` deep link both mean exactly this.
   */
  const openEpisode = (
    req: FeedRequest,
    trackId: string,
    opts: { push?: boolean; autoplay?: boolean; at?: number } = {},
  ): void => {
    rememberFeed(req);
    playback.openAndPlay(req, trackId, {
      autoplay: opts.autoplay ?? true,
      ...(opts.at ? { at: opts.at } : {}),
    });
    showView('podcast', { focus: false });
    router.feedOpened(req, opts.push ?? true);
  };

  const home = initHomeView({
    openFeed: (req) => openFeed(req),
    resumeFeed: (req) => openFeed(req, { resume: true }),
    playEpisode: (req, trackId) => openEpisode(req, trackId),
    checkForNew: async () => {
      const result = await sweepSubscriptions(subscriptions(), { force: true });
      toast(result.found ? t('toast_new_found', result.found) : t('toast_no_new'));
    },
  });
  // (Phase 3 wires search.restoreFocus into back-navigation focus hand-off.)
  initSearchView({ openFeed: (req) => openFeed(req) });
  initLibraryView({ openFeed: (req) => openFeed(req) });
  const nowPlayingSheet = initNowPlaying({
    playback,
    openQueue: () => goView('queue'),
  });
  initPodcastView({
    playback,
    onBack: () => {
      if (router.canGoBack()) history.back();
      else router.goHome();
    },
    openNowPlaying: () => nowPlayingSheet.open(),
  });
  initQueueView();
  initSettingsView({ onDataCleared: () => home.refresh() });

  // Static markup is in place — localize it (re-runs on language change).
  bindI18nDom();

  // ── router & navigation ───────────────────────────────────────────
  const router = initRouter({
    showFeed: (req) => {
      rememberFeed(req);
      playback.openFeed(req);
      showView('podcast');
    },
    showHome: () => {
      saveProgressNow();
      nowPlayingSheet.close();
      showView('home'); // playback continues — the mini player takes over
    },
    showView: (view: AppView) => showView(view as ViewName),
  });

  /** Nav/tab intent: home is the bare path, other views get ?view=. */
  const goView = (dest: NavDestination | 'queue'): void => {
    nowPlayingSheet.close();
    if (dest === 'home') {
      router.goHome();
      return;
    }
    showView(dest);
    router.viewOpened(dest);
  };
  initNav({ go: goView });

  initMiniPlayer({ playback, onOpen: () => nowPlayingSheet.open() });
  // Restores a timer that survived a reload; both surfaces already render from
  // the sleep signal by this point.
  initSleepTimer(() => toast(t('sleep_done')));
  initShortcuts();

  // ── media session ────────────────────────────────────────────────
  initMediaSession({
    // The platform's own suggested offset wins when it sends one (Android Auto
    // and some headsets do); otherwise the user's skip setting applies.
    seekBack: (offset) => pbSeekTo(Math.max(0, pbCurrent() - (offset ?? settings().skipBack))),
    seekForward: (offset) => {
      const d = pbDuration();
      if (d) pbSeekTo(Math.min(pbCurrent() + (offset ?? settings().skipForward), d));
    },
    prevTrack: () => playback.prev(),
    nextTrack: () => playback.next(),
    seekTo: (seconds) => pbSeekTo(Math.max(0, seconds)),
    stop: () => playback.reset(),
  });

  // ── persistence on exit ──────────────────────────────────────────
  // Sync flushes *after* the local write in each of these: the push reads what
  // `saveProgressNow` just committed, not the value from five seconds ago.
  // `saveSettings` is here because the settings write is throttled now — a
  // slider let go a fraction of a second before the tab closes must still land.
  const persistAndPush = (): void => {
    saveSettings();
    saveProgressNow();
    syncFlush();
  };
  window.addEventListener('beforeunload', persistAndPush);
  window.addEventListener('pagehide', persistAndPush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persistAndPush();
      return;
    }
    // Coming back to the foreground is the only moment iOS lets us repair
    // anything: WebKit may have suspended the page mid-stream and killed the
    // element's in-flight range request without ever firing `error`.
    checkPlaybackHealth();
  });
  // Page Lifecycle: Chrome discards a frozen background tab's network state,
  // and `resume` is the one signal that it happened.
  document.addEventListener('resume', () => checkPlaybackHealth());
  initKeepAwake();

  /**
   * What is new in the shows you follow.
   *
   * Deferred rather than awaited: the sweep touches the network once per
   * subscription and must never be in front of the first paint. Repeated on
   * return to the foreground because a phone keeps the tab alive for days, and
   * `sweepSubscriptions` throttles per feed so a quick tab switch costs
   * nothing.
   */
  const badge = (): void => applyAppBadge(pendingInbox().length);
  const sweep = (): void => {
    void sweepSubscriptions(subscriptions()).then(badge);
  };
  badge();
  inbox.subscribe(badge);
  // A mark can empty the rail without the inbox itself changing.
  playedRevision.subscribe(badge);
  setTimeout(sweep, 2500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sweep();
  });

  // ── initial route (deep links preserved) ─────────────────────────
  const route = parseLocation();
  const resumeReq =
    new URLSearchParams(location.search).get('resume') === '1'
      ? local.get<FeedRequest | null>('pp_last_feed', null)
      : null;
  const initialReq =
    route.kind === 'feed'
      ? route.req
      : resumeReq && ['itunes', 'rss', 'yt'].includes(resumeReq.kind)
        ? resumeReq
        : null;
  if (initialReq && route.kind === 'feed' && route.episodeId) {
    /**
     * A shared episode link. It loads that episode and seeks to the moment the
     * link names, but does not start playing: a cold page load has no user
     * gesture, so the browser would refuse anyway, and a link that starts
     * making noise the instant it opens is not a link anyone wants to receive.
     */
    openEpisode(initialReq, route.episodeId, {
      push: false,
      autoplay: false,
      ...(route.at ? { at: route.at } : {}),
    });
  } else if (initialReq) {
    // Cold deep link: don't steal focus on first paint, replace (no push).
    // The "Resume" app shortcut asked to continue; a shared ?podcast= link did not.
    openFeed(initialReq, { push: false, focus: false, resume: initialReq === resumeReq });
  } else if (route.kind === 'view') {
    showView(route.view as ViewName, { focus: false });
  } else {
    showView('home', { focus: false });
  }
}
