import { applyLang, t } from './i18n';
import { initMediaSession } from './player/media-session';
import { requestPersistence } from './player/offline';
import { pbCurrent, pbDuration, pbSeekTo } from './player/engine';
import { loadProgress, saveProgressNow, setQuotaListener } from './storage/progress';
import { local } from './storage/local';
import { loadSubscriptions } from './storage/subscriptions';
import { loadSettings, settings } from './state/settings';
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

export function boot(): void {
  renderShell(must('app'));

  // ── state & appearance ───────────────────────────────────────────
  loadSettings();
  loadProgress();
  loadSubscriptions();
  const S = settings();
  applyTheme(S.theme);
  applyAccent(S.accentColor);
  applyLang(S.lang);
  document.documentElement.style.setProperty('--player-font-size', S.fontSize);
  document.documentElement.style.setProperty('--list-row-height', S.rowHeight);
  setQuotaListener(() => toast(t('storage_full'), 'error'));
  requestPersistence(); // keep downloads/idb safe from storage-pressure eviction
  initOfflineBanner();

  // ── playback session (single instance, shared by all views) ──────
  const playback = createPlaybackController();

  // Remembered across sessions for the "Resume" app shortcut (?resume=1)
  const rememberFeed = (req: FeedRequest): void => {
    local.set('pp_last_feed', req);
  };

  /** Central "open a feed" intent — every entry point funnels through here. */
  const openFeed = (req: FeedRequest, opts: { push?: boolean; focus?: boolean } = {}): void => {
    rememberFeed(req);
    playback.openFeed(req);
    showView('podcast', { focus: opts.focus ?? true });
    router.feedOpened(req, opts.push ?? true);
  };

  // ── views ─────────────────────────────────────────────────────────
  const home = initHomeView({ openFeed: (req) => openFeed(req) });
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
  initQueueView({ playback });
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

  initMiniPlayer({ onOpen: () => nowPlayingSheet.open() });

  // ── media session ────────────────────────────────────────────────
  initMediaSession({
    seekBack: () => pbSeekTo(Math.max(0, pbCurrent() - settings().skipBack)),
    seekForward: () => {
      const d = pbDuration();
      if (d) pbSeekTo(Math.min(pbCurrent() + settings().skipForward, d));
    },
    prevTrack: () => playback.prev(),
    nextTrack: () => playback.next(),
  });

  // ── persistence on exit ──────────────────────────────────────────
  window.addEventListener('beforeunload', saveProgressNow);
  window.addEventListener('pagehide', saveProgressNow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveProgressNow();
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
  if (initialReq) {
    // Cold deep link: don't steal focus on first paint, replace (no push).
    openFeed(initialReq, { push: false, focus: false });
  } else if (route.kind === 'view') {
    showView(route.view as ViewName, { focus: false });
  } else {
    showView('home', { focus: false });
  }
}
