# Changelog

## 4.0.0 — 2026-07-12

### "Sinyal" — new visual identity
- Complete restyle: warm charcoal surfaces, amber "radio dial glow" default
  accent (`#f2a33c`, was violet `#8b7cf6`), and a new type system —
  Bricolage Grotesque (display) / Schibsted Grotesk (UI) / Spline Sans Mono
  (numerals/labels).
- Signature **frequency-line** waveform motif: the hero scrubber in the new
  Now Playing sheet, and an animated line on the mini player while playing.
- The 4 themes (Auto / Dark / Light / OLED Black) are kept, restyled to the
  new palette. Dark ("Kor") and OLED ("Gece") text ramps are tuned for
  readability — secondary text ~10:1 and tertiary/mono labels ~5.7–6.4:1 on
  the background; navigation labels use the secondary tier. The accent picker
  now offers **7** Sinyal swatches (Amber, Copper, Signal Red, Moss, Teal,
  Sky, Lilac); **previously saved accents are remapped to their nearest new
  swatch** on the fly (`ui/theme.ts` → `normalizeAccent`) — the stored
  setting itself is left untouched, so rolling back is non-destructive.
- **New brand mark**: the "sinyal" crest — five round-capped frequency bars —
  replaces the S monogram everywhere (in-app logo, favicon, PWA/launcher
  icons, monochrome themed icon). The in-app mark breathes gently and the
  "Seseri" wordmark carries a soft signal sheen; both are static under
  `prefers-reduced-motion`.
- YouTube artwork now loads from the official `i.ytimg.com` CDN (derived
  from the video id) instead of Piped/Invidious instance proxies, which
  frequently go dark; search-result artwork also falls back to a calm
  placeholder tile when an image fails to load.
- **Mini player → mini transport**: skip back/forward and play/pause live
  directly in the dock (plus previous/next and a speed selector on wider
  screens), and the progress hairline is a tap/drag seek slider — no need to
  open the full player for everyday control. The expand chevron or the title
  area still opens the Now Playing sheet (scrubber, sleep timer, queue,
  YouTube video frame).
- **Language menu with real flags**: a custom accessible listbox
  (`ui/lang-menu.ts`) with hand-drawn inline SVG flags (`ui/flags.ts`) —
  Windows renders no emoji flags, and native `<option>` can't show images.
  It now lives on the Home header too, not only in Settings.

### Information architecture — full redesign
- New primary navigation: a bottom tab bar on mobile / left sidebar on
  desktop — **Home / Search / Library / Settings**.
- **Home**: a "continue listening" rail built from cached progress +
  subscriptions data, plus a subscriptions grid.
- **Search**: iTunes search and RSS/YouTube paste share one screen, with
  progressive dual-source results.
- **Library**: Subscriptions and Downloads tabs with a storage-usage
  summary; replaces the old home-screen favorites rows.
- **Podcast detail**: episode list with sort/filter (unchanged data, new
  frame).
- **Now Playing**: a full-screen sheet on mobile / floating panel on
  desktop, with transport, sleep timer, speed, and queue access — the mini
  player now opens this sheet instead of navigating back into the feed.
- **Queue**: promoted from a sort-bar dropdown to its own page view.
- **Settings**: promoted from a modal `<dialog>` to its own page view (same
  sections and stored options).

### Routing
- New `?view=search|library|queue|settings` deep links alongside the
  existing `?podcast=` / `?rss=` / `?yt=` params, which are unchanged.
- Back-button contract: one step from any feed/view always returns home
  (`ui/router.ts` replaces rather than pushes between non-home states).
- PWA manifest: `theme_color`/`background_color` updated to `#171310`; the
  "Search" shortcut now opens `?view=search` instead of the bare start URL.

### Architecture
- UI split into a headless **playback-controller**
  (`src/ui/playback-controller.ts`) plus per-view modules under
  `src/ui/views/` (`home`, `search`, `library`, `podcast`, `queue`,
  `settings`, `now-playing`) registered through a small view registry
  (`src/ui/views.ts`) and a shared nav controller (`src/ui/nav.ts`). The
  old `src/ui/screens/` (`player.ts`, `settings.ts`) and
  `src/ui/queue-panel.ts` are retired; their logic moved into the new view
  modules.
- Styles split by concern — `tokens` / `themes` / `base` / `layout` /
  `controls` / `overlays` / `signal-line`, plus one CSS file per view under
  `src/styles/views/` — assembled through `src/styles/index.css`;
  `components.css` is retired.
- The runtime layer (`player/`, `feeds/`, `storage/`, `state/`, worker,
  service worker) is untouched by the rewrite.
- `src/ui/router.test.ts` grown to cover the new `?view=` routes (29 tests).

### i18n
- 18 new keys across all 8 languages for the new nav/home/library/queue/
  now-playing UI (`nav_*`, `home_*`, `lib_*`, `np_open`, `np_close`).

### Kept / compatible
- All legacy deep links (`?podcast=`, `?rss=`, `?yt=`) still work unchanged.
- Stored data keys (`pp_prog`, `pp_favs`, `pp_last_*`, settings) are
  untouched — no migration needed, no data loss on upgrade.
- Offline downloads, OPML import/export, sleep timer, media-session
  integration, keyboard shortcuts (Space/arrows while a feed or the Now
  Playing sheet is open), RTL (Arabic), `prefers-reduced-motion`, and focus
  management all carry over as-is.
- **116+ unit tests green** (client); worker suite untouched by this
  redesign.

## 3.1.0 — 2026-07-08

### Added
- **Queue panel** (`src/ui/queue-panel.ts`): the play queue finally has a UI —
  a dropdown on the sort bar lists queued episodes with keyboard-accessible
  move up/down, remove and clear controls, plus a count badge.
- **Styled confirm dialog** (`src/ui/confirm.ts`): replaces native `confirm()`
  and covers all four destructive actions consistently — clear progress,
  clear all data, **clear downloads and unsubscribe now confirm too**
  (previously they ran without asking). Cancel is default-focused.
- **Offline banner** (`src/ui/offline-banner.ts`): a quiet status strip when
  the connection drops (downloads keep playing).
- Success toasts on OPML / JSON backup export.
- **Desktop CI** (`.github/workflows/desktop.yml`): pushing a `v*` tag builds
  the NSIS installer on `windows-latest` and attaches it to a draft GitHub
  Release; non-blocking `npm audit` job added to `ci.yml`.
- CI quality gate on GitHub Actions (`.github/workflows/ci.yml` — the full
  `npm run verify` chain on every push/PR; formerly parked in `docs/`).
- Unified loading/empty/error boxes (`src/ui/states.ts`): search and player
  now share one pattern; errors get `role="alert"` and a retry button.
- Localized `close` label (8 languages) for the settings close button.
- **Unit tests 51 → 104** (+ worker 22 → 26): queue, router history, offline
  cache-key invariant, feed resolution, theme-token parity, redirect guard.

### Security
- **Worker redirect SSRF closed** (`worker/src/safe-fetch.ts`): upstream
  redirects are now followed manually (max 3 hops) and every `Location`
  target is re-validated against the private-host guard.
- **Production CSP no longer ships dev origins**: a build-only Vite plugin
  strips `http://127.0.0.1:8787` and bare `ws:` from `dist/index.html`
  (dev stays untouched; the plugin fails the build on token drift).

### Accessibility / UX
- Focus management on navigation: opening a feed moves focus to the feed
  title; going back restores it to the originating row/search input;
  deep-link cold loads don't steal focus.
- `aria-label` on the language and speed selects; `aria-busy` on result and
  episode lists while loading.
- **RTL**: direction-relevant physical CSS converted to logical properties —
  Arabic now mirrors the episode list, badges, settings drawer and toggles.
- **Touch targets**: interactive controls extended to ≥44px hit areas
  (settings, sort, transport, back, list actions) without visual changes.
- **Safe areas**: `viewport-fit=cover` + `safe-area-inset-top` padding on the
  header, home top bar and settings drawer (notched devices in standalone
  PWA mode).
- Design-token adoption across `components.css` (type/spacing/radius/motion)
  plus a single z-index scale (`--z-*`).

### Desktop
- `Cargo.toml`/`desktop/package.json` metadata fixed (crate `seseri`, real
  author/license/repository — was scaffold "A Tauri App"/"you"); all four
  version fields aligned at 3.1.0.

### Docs
- `SECURITY.md`: redirect re-validation documented; DNS-rebinding residual
  and unsigned-installer status listed as known risks.
- `docs/STORE.md`: iOS (App Store) durum/yol haritası section; KV id
  instruction de-drifted; release checklist updated.

### Changed
- **YouTube stream resolution rewritten** (`worker/src/innertube.ts`): the old
  path had broken on every front — PO-token enforcement caps IOS/MWEB/WEB
  URLs at the first ~2 MB, the TV/embedded clients now fail playability or
  need a JS evaluator workerd can't run, and the public Piped/Invidious pool
  is dead. Resolution now uses the PO-token-exempt `ANDROID_VR` client with a
  server-generated session and no player JS (direct URLs, full-range, lower
  CPU). **Caveat:** from the deployed Cloudflare Worker's datacenter IP,
  YouTube returns "Sign in to confirm you're not a bot" for most videos, so
  server-side audio (and thus lock-screen/background playback) succeeds only
  for the subset that isn't IP-walled; the rest fall back to the iframe embed,
  which mobile browsers pause on screen lock. Self-hosting the Worker on a
  residential IP (or adding cookie auth) lifts the wall. A one-time toast now
  warns when the embed fallback is in use (new i18n key `yt_embed_bg`).

### Fixed
- Search result rows are keyboard-operable (`role="button"`, `tabindex`,
  Enter/Space) — previously mouse/touch only.
- Focus rings restored on selects/range inputs that had `outline: none`
  with no `:focus-visible` replacement.
- Light theme tertiary text (`--text3`) darkened to meet WCAG AA (≥4.5:1).
- Sort direction label no longer wraps into 2–3 lines on narrow screens
  (hidden ≤520px; the toggle button still shows the direction).

### Removed
- Stale `docs/screens-v1/` screenshots (superseded by `screens-v2`).

## 3.0.0 — 2026-07-04

Full rewrite of the 3,700-line single-file app into a Vite + strict TypeScript
modular architecture (same features, same stored data — `pp_*` localStorage
keys remain compatible). Highlights:

### Added
- **YouTube search by name**: search results now show a YouTube section
  (channels, playlists, videos) next to podcasts — no link pasting needed.
  Worker endpoint `/v1/yt/search` (Innertube with a Piped-pool fallback),
  client falls back to public instances when the Worker is down.
- **YouTube background / lock-screen playback**: the Worker resolves streams
  via Innertube (multi-client, deciphered) and proxies the audio bytes
  range-aware (`/v1/yt/audio`) — the app plays them in a plain `<audio>`
  element with Media Session, so background and lock-screen controls work.
  Falls back to public Piped, then the official embed.
- **Offline listening**: episode downloads live in the Cache API and play
  (and seek) with no connection; feeds are cached in IndexedDB and refresh in
  the background (stale-while-revalidate).
- **Cloudflare Worker backend** (`worker/`): RSS/iTunes proxy with edge
  caching, SSRF guards and rate limiting, plus YouTube listing/stream
  resolution over a cron-health-checked Piped/Invidious pool. The client
  falls back to public proxies when the Worker is unreachable.
- **Mini player**: leaving a feed keeps playing; a floating transport on the
  home screen returns to the loaded feed without reloading.
- **Play queue**: queue episodes as "up next"; the queue wins over list order.
- **Auto theme** (default): follows the OS `prefers-color-scheme` live.
- **Desktop two-pane layout** (≥900px): library rail beside the episode pane.
- **OPML import/export**, JSON backup, storage usage + clear-downloads.
- **New "S" monogram brand** — single-stroke geometric S; the in-app logo
  draws itself once on load. Maskable + monochrome PNG variants generated
  from one SVG master (`scripts/icons.cjs`).
- **Store readiness**: completed web manifest (id, categories, shortcuts incl.
  a working `?resume=1`, wide/narrow screenshots, `launch_handler`,
  `display_override`), `.well-known/assetlinks.json` template, and a full
  release guide in `docs/STORE.md`.
- **Quality**: 51 frontend + 22 worker unit tests, `npm run verify` chain,
  headless-Edge smoke scripts (offline, worker, mini-player/queue).

### Changed
- Episode rows show a progress hairline and a "listened" state; feed-load
  errors offer a real retry button; settings drawer is a native `<dialog>`
  (focus trap + Esc); player status is announced via `aria-live`.
- CSP no longer needs `'unsafe-inline'` for scripts (typed DOM builder, no
  inline handlers).
- Back button on deep-linked visits now navigates home instead of leaving
  the site.

## 2.3.0 — 2026-06-20

### Changed
- **YouTube playback now uses a real audio stream when possible.** YouTube shows
  are resolved through public **Piped / Invidious** instances to a direct audio
  URL played by the normal `<audio>` element — so they behave like any podcast:
  **ad-free, background / lock-screen playback, resume, download**, the full
  episode list (up to ~200) **with real dates and durations**, highest-bitrate
  audio. Several instances are tried in parallel. On the embed fallback, missing
  episode titles are filled from noembed (keyless CORS oembed).
- **Graceful fallback.** If no Piped/Invidious instance serves the content (these
  public servers are often rate-limited or blocked by YouTube), the app falls back
  to the keyless feed (latest ~15) and the official `youtube-nocookie` IFrame
  embed for playback — in which case the embed's limits apply (possible ads, no
  mobile-background, no download). The video stays hidden (audio-only presentation).

### Notes
- Background playback, ad-free and per-episode dates depend on a healthy
  third-party instance; availability is outside the app's control.

## 2.2.0 — 2026-06-20

### Added
- **YouTube shows (link-based).** Paste a YouTube **playlist, channel or video**
  link into the search box to listen to shows that publish on YouTube. The episode
  list is built from YouTube's keyless Atom feed (the same CORS-proxy path used for
  RSS), and playback uses YouTube's official privacy-friendly IFrame embed
  (`youtube-nocookie.com`) — no API key, no third-party stream servers. The
  existing transport (play/pause, skip, scrubber, speed, prev/next, sleep timer,
  resume, lock-screen controls, deep links `?yt=…`, subscriptions) all work through
  a shared playback layer, so audio podcasts behave exactly as before.

### Notes / limitations (YouTube items only)
- YouTube's feed exposes only the **latest ~15 entries** (shown newest-aligned).
- **Download** is not offered for YouTube items (YouTube Terms); the per-row
  download button is hidden for these feeds.
- **Background audio** follows YouTube's own rules: it keeps playing in an
  unfocused desktop tab / installed PWA, but mobile browsers pause when the screen
  locks or the app is backgrounded — there is no compliant way to override that.
- A video whose owner disabled embedding can't be played; the player reports it.

### Security
- Content Security Policy tightened to the minimum needed for the embed:
  `script-src` adds only `https://www.youtube.com` (the IFrame API loader) and a
  new `frame-src` allows only `youtube-nocookie.com` / `youtube.com`. Service
  Worker cache bumped to `seseri-v3`.

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
