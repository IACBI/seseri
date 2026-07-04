import { applyLang } from './i18n';
import { t } from './i18n';
import { initMediaSession } from './player/media-session';
import { requestPersistence } from './player/offline';
import { pbCurrent, pbDuration, pbPaused, pbSeekTo } from './player/engine';
import { loadProgress, saveProgressNow, setQuotaListener } from './storage/progress';
import { loadSubscriptions } from './storage/subscriptions';
import { loadSettings, settings } from './state/settings';
import { bindI18nDom } from './ui/i18n-dom';
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

  // ── screens & router ─────────────────────────────────────────────
  const search = initSearchScreen({
    openFeed: (req) => {
      player.openFeed(req);
      router.feedOpened(req);
    },
  });

  const player = initPlayerScreen({
    onFeedOpened: () => {
      /* URL handled by the router (avoids double push) */
    },
    onClosed: () => search.show(),
  });

  const router = initRouter({
    showFeed: (req) => player.openFeed(req),
    showHome: () => {
      saveProgressNow();
      player.reset();
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
  if (route.kind === 'feed') {
    player.openFeed(route.req);
    router.feedOpened(route.req, false);
  } else {
    search.show();
    search.focusInput();
  }
}
