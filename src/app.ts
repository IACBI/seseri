import { applyLang } from './i18n';
import { t } from './i18n';
import { initMediaSession } from './player/media-session';
import { requestPersistence } from './player/offline';
import { pbCurrent, pbDuration, pbPaused, pbSeekTo } from './player/engine';
import { loadProgress, saveProgressNow, setQuotaListener } from './storage/progress';
import { local } from './storage/local';
import { loadSubscriptions } from './storage/subscriptions';
import { loadSettings, settings } from './state/settings';
import type { FeedRequest } from './feeds/types';
import { bindI18nDom } from './ui/i18n-dom';
import { initMiniPlayer } from './ui/mini-player';
import { initOfflineBanner } from './ui/offline-banner';
import { initRouter, parseLocation } from './ui/router';
import { renderShell, must } from './ui/shell';
import { initPlayerScreen } from './ui/screens/player';
import { initSearchScreen } from './ui/screens/search';
import { initSettingsPanel } from './ui/screens/settings';
import { applyAccent, applyTheme } from './ui/theme';
import { toast } from './ui/toast';

export function boot(): void {
  const app = must('app');
  renderShell(app);

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
  bindI18nDom();
  setQuotaListener(() => toast(t('storage_full'), 'error'));
  requestPersistence(); // keep downloads/idb safe from storage-pressure eviction
  initOfflineBanner();

  // ── screens & router ─────────────────────────────────────────────
  let lastFeedReq: FeedRequest | null = null;
  // Remembered across sessions for the "Resume" app shortcut (?resume=1)
  const rememberFeed = (req: FeedRequest): void => {
    lastFeedReq = req;
    local.set('pp_last_feed', req);
  };

  const search = initSearchScreen({
    openFeed: (req) => {
      rememberFeed(req);
      player.openFeed(req);
      router.feedOpened(req);
    },
  });

  const player = initPlayerScreen({
    onFeedOpened: (req) => {
      rememberFeed(req);
      /* URL handled by the router (avoids double push) */
    },
    onClosed: () => {
      search.show();
      search.restoreFocus(); // return focus to the row/input that opened the feed
    },
    onBack: () => {
      if (router.canGoBack()) history.back();
      else router.goHome();
    },
  });

  const router = initRouter({
    showFeed: (req) => {
      rememberFeed(req);
      player.openFeed(req);
    },
    showHome: () => {
      saveProgressNow();
      player.hide(); // playback continues — the mini player takes over
    },
  });

  initMiniPlayer({
    onOpen: () => {
      if (!lastFeedReq) return;
      player.openFeed(lastFeedReq);
      router.feedOpened(lastFeedReq);
    },
  });

  const settingsPanel = initSettingsPanel({
    onDataCleared: () => {
      if (player.isOpen()) {
        /* list re-render happens via settings subscription */
      }
    },
  });
  must('settingsBtn').addEventListener('click', () => settingsPanel.open());

  // ── media session ────────────────────────────────────────────────
  initMediaSession({
    seekBack: () => pbSeekTo(Math.max(0, pbCurrent() - settings().skipBack)),
    seekForward: () => {
      const d = pbDuration();
      if (d) pbSeekTo(Math.min(pbCurrent() + settings().skipForward, d));
    },
    prevTrack: () => must('btnPrev').click(),
    nextTrack: () => must('btnNext').click(),
  });
  void pbPaused;

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
    rememberFeed(initialReq);
    player.openFeed(initialReq, false); // cold deep-link: don't steal focus on first paint
    router.feedOpened(initialReq, false);
    search.renderFavs(); // desktop rail is visible alongside the feed
  } else {
    search.show();
    search.focusInput();
  }
}
