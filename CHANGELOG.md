# Changelog

## 2.1.0 — 2026-06-20

### Added
- **Waveform scrubber** — the flat progress bar is now an amplitude waveform.
  Bars are generated locally from a deterministic per-episode seed (mulberry32
  hashed from the track id; no audio analysis, which is impossible on
  cross-origin podcast MP3s). The played region fills with the accent via
  `clip-path`; drag to scrub with a time tooltip, a leading-edge playhead,
  keyboard support, and a subtle per-bar "breathing" only while playing.
- **Living equalizer** — the now-playing equalizer animates only during
  playback, and the currently-playing episode row shows a mini-equalizer in
  place of its index.
- **Design-token system** — spacing (`--s-*`), type (`--fs-*`), motion-duration
  (`--d-*`) and elevation scales; player rhythm and transitions routed through
  them. Now-playing title crossfades on track change.

### Fixed
- **Podcast load failure / "Failed to fetch."** The iTunes API echoes the
  request origin into `Access-Control-Allow-Origin`, but its CDN cached
  responses without varying on origin, so a response cached for one site was
  served to another and the browser blocked it as a CORS mismatch. Requests now
  go through `itunesFetch()` with a unique cache-busting parameter (plus a CORS
  proxy fallback), so every request gets a fresh, correctly-attributed response.
- **Light theme readability.** Surface/text tokens are properly themed; the
  wordmark sheen is now theme-aware (a violet shimmer on light instead of white,
  so "Seseri" no longer disappears under its animation); cleaner hero vignette;
  AA-legible captions on white.

### Changed
- **Path-independent deployment.** `manifest.json` `scope`/`start_url`, `sw.js`,
  and `404.html` now resolve relative paths, so the app runs at any base URL
  without per-path configuration (the project moved to the `seseri` repo →
  `iacbi.github.io/seseri/`). The Service Worker is **network-first for
  navigations** (new deploys are picked up immediately) and cache-first for
  static assets; cache bumped to `seseri-v2`.

### Performance
- Removed the stacked `backdrop-filter` blurs from the settings drawer (overlay
  + sliding panel + sticky header) that caused a large FPS drop on open/scroll;
  the drawer is now a solid surface with a plain scrim and composited slide.
- Episode rows use `content-visibility` so off-screen rows in long feeds are not
  rendered until scrolled into view.
- Continuous background motion pauses while the settings drawer is open; the
  animated hero-glow `blur()` filter was dropped (the radial gradient is already
  soft); scroll containers use momentum + `overscroll-behavior: contain`.

## 2.0.0 — 2026-06-18

### Changed
- **Rebrand to “Seseri.”** The app's display name is now *Seseri* everywhere it
  is user-facing: page title, brand mark, meta/Open Graph tags, PWA manifest
  (`name`/`short_name`), `document.title`, privacy policy and both READMEs. The
  GitHub Pages deploy path (`/podcast-player/`) is unchanged.
- **New visual identity.** Custom animated sound-wave SVG logo (replacing the
  headphone emoji) reused as the favicon; a signature electric-violet accent
  with depth gradients and glow over a deeper “studio” dark canvas; refreshed
  accent swatches. Three-role type system: Space Grotesk (display), DM Sans
  (body), DM Mono (labels/data). Dark, Light and OLED themes re-tuned to the
  new palette.
- Service Worker cache bumped to `seseri-v1`.

### Added
- Motion design: hero stagger-in with ambient glow, search↔player screen
  transitions, staggered episode-list reveal, shimmering skeleton loaders, a
  now-playing equalizer (animates only during playback), and spring button
  feedback. All animations honor `prefers-reduced-motion`.
- First-run interface language is auto-detected from `navigator.language`
  (falls back to Turkish).
- Responsive player controls wrap cleanly on narrow screens.

### Fixed
- Strings that bypassed the i18n system and stayed Turkish in every language
  are now localized in all 8 languages: episode-count unit, loading/skeleton
  text, error prefix, the “no episodes found” message, and the episode-name
  fallback (new `ep_fallback` key). Language switching no longer relies on a
  fragile hardcoded string comparison.

### Security
- RSS/iTunes artwork URLs are validated as `https` before being assigned to an
  `<img>` (matches the CSP `img-src` policy); thumbnails use
  `loading="lazy"` + `decoding="async"`; external links in the privacy policy
  use `rel="noopener noreferrer"`.

## 1.1.1 — 2026-06-10

### Fixed
- Light theme redesigned for readability: new palette (white cards on a soft
  grey canvas, darker text, stronger borders), accent-aware button text color
  via a luma check, and an accent-tinted active-row highlight that stays
  visible on white. Browser `theme-color` now follows the selected theme.
  Dark theme remains the default on first launch.
- Hardcoded blue hover/highlight colors (`.play-btn`, `.search-btn`, active
  episode row) now follow the selected accent color instead of always blue.
- "Oldest → Newest" option in the settings sort selector was missing its i18n
  binding and stayed in Turkish after a language change.
- `<html lang>` attribute now updates when the interface language changes
  (better screen-reader pronunciation and font selection).

### Changed
- Author/copyright attribution updated to **𝓐.𝓒.𝓑** (LICENSE, READMEs,
  `<meta name="author">`).
- README (EN + TR) rewritten: feature/shortcut tables, badges, quick-start and
  deployment sections, author section.
- Service Worker cache bumped to `podcast-player-v4`.

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
