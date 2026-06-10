# Changelog

## 1.1.0 — 2026-06-10

### Fixed
- Sort toggle no longer highlights the wrong episode while one is playing
  (active episode was captured *after* the list was reversed).
- Filtering the episode list keeps tracking the playing episode; next/previous
  buttons are disabled instead of jumping to an unrelated episode.
- Service Worker offline fallback pointed at `/index.html` instead of
  `/podcast-player/index.html`; SW registration now uses a relative path.
- `404.html` redirected to the domain root instead of `/podcast-player/`.
- Episode durations were always formatted in Turkish ("2sa 30dk") regardless
  of the selected language; dates/durations now re-format on language change.
- The search button label reverted to Turkish ("Ara →") after every search.
- `localStorage` quota errors are now handled by pruning old progress entries
  and warning the user instead of silently losing data.
- Playback position is also flushed on `visibilitychange` (iOS Safari does not
  reliably fire `beforeunload`).
- Relative seeking is ignored until the audio duration is known instead of
  clamping the position to 0.

### Added
- Direct RSS feed URL support (via public CORS proxies: AllOrigins, corsproxy.io).
- Subscriptions: star podcasts and see them on the home screen.
- Shareable deep links: `?podcast=<id>` and `?rss=<url>`.
- Media Session API: lock-screen / headset controls with episode metadata.
- Sleep timer (15/30/60 minutes).
- Global keyboard shortcuts: Space, ←/→, ↑/↓.
- Accessibility: episode rows are keyboard-focusable buttons, settings panel
  is a proper dialog, icon buttons have labels.
- English README (`README.md`) + Turkish `README.tr.md`, LICENSE,
  CONTRIBUTING.md, SECURITY.md, Open Graph meta tags.

## 1.0.0 — 2026-03

- Initial release: iTunes search, full player, resume, themes, 8 languages,
  PWA with offline shell.
