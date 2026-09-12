# Contributing

Thanks for your interest. Seseri is a Vite + TypeScript single-page app with no
UI framework: the DOM is built by hand, state lives in a ~50-line signal
implementation, and an optional Cloudflare Worker proxies feeds.

## Getting started

```bash
git clone https://github.com/IACBI/seseri.git
cd seseri
npm install
npm run dev          # http://localhost:5199
```

The Worker is optional for local work — without it the app talks to iTunes
directly and, if you opt in, to public CORS proxies. To run it:

```bash
npm run worker:dev   # wrangler dev on 127.0.0.1:8787
```

Before opening a pull request:

```bash
npm run verify       # lint + typecheck + unit tests + build + worker checks
```

## Guidelines

- **No frameworks.** `src/ui/h.ts` builds elements; `src/state/signals.ts` is
  the whole reactivity layer. Reach for a dependency only when the alternative
  is genuinely worse, and say why in the PR.
- **Feed data never reaches the DOM as markup.** Anything from a feed, a search
  result or a URL goes through `h()` or `textContent`. `innerHTML` is allowed
  only for a static constant with nothing interpolated into it — ESLint fails
  the build on interpolation, concatenation, `insertAdjacentHTML` and `eval`.
  Show notes are reduced to text plus https-only links first
  (`src/feeds/show-notes.ts`).
- **i18n is compile-time checked.** A user-visible string means a key in
  `src/i18n/types.ts` and a translation in **all eight** files under
  `src/i18n/langs/`. Machine translation is fine — flag the uncertain ones in
  the PR. `completeness.test.ts` fails on a missing key.
- **Style through tokens.** Colours, spacing, radii and durations come from
  `src/styles/tokens.css`; use logical properties (`inline-size`,
  `margin-inline-start`) so RTL keeps working. One stylesheet per view.
- **Respect the quiet defaults.** `prefers-reduced-motion` must leave a usable
  static state, focus must stay visible, and touch targets stay at 44px.
- **Touching a stored position?** `pp_prog` has sidecar keys that must move in
  lockstep with it — `pp_prog_at`, and the same pattern for `pp_last_at`,
  `pp_subs_at`/`pp_subs_rm` and `pp_queue_at`. They carry the timestamps sync
  resolves conflicts with. Write the value first and the stamp second: a fresh
  stamp on an old position beats genuinely newer data on the other device, while
  a stale stamp on a real position only loses a conflict it should lose.
  `pp_played`/`pp_played_rm` need no separate stamp — both are
  `episodeId → when`, so the value *is* the timestamp — and an unplayed mark
  wins a tie inside the simultaneity window, because undoing is the deliberate
  act. Anything added to `BACKUP_KEYS` needs the matching guard in
  `restoreBackup`.
- **New external origin?** Update the CSP in `index.html`, and say what it is
  for in `SECURITY.md` if it changes the app's exposure.
- **New setting?** Add it to `Settings`, `DEFAULT_SETTINGS` and — unless it is
  free-form — the `ALLOWED` map in `src/state/settings.ts`, which is what stops
  a tampered `localStorage` value reaching the DOM or the audio element.
- **The feed scanner exists twice, byte for byte.** `src/feeds/rss-scan.ts`
  and `worker/src/rss-scan.ts` are the same file: the Worker parses the archive
  when one is configured and the browser parses it when one is not, and a
  client must not get a different answer depending on which ran.
  `rss-scan.parity.test.ts` fails if they drift, so edit both. The same holds
  for `credential-url.ts`.
- **Formatting.** The repository is not uniformly Prettier-formatted. Format
  the files you touched; do not run `prettier --write` across the tree.

## Testing

`npm test` runs the unit suites (jsdom where a DOM is needed). Anything with
real behaviour worth protecting gets a test — parsers, the sleep timer, the
recovery watchdog, playback wiring.

The headless smokes drive the built app in a real browser, which is the only
place layout, playback and the service worker are actually exercised. They find
a Chromium themselves and honour `SESERI_BROWSER`; CI runs all six on every
push.

```bash
npm run smoke                       # all six, in order — 74 assertions
node scripts/smoke-shell.cjs        # boot, navigation, theme, language
node scripts/smoke-p3-offline.cjs   # download → offline reload → playback
node scripts/smoke-p5-mini.cjs      # mini dock, queue, back-navigation
node scripts/smoke-chapters.cjs     # chapters, scrubber markers, transcript
node scripts/smoke-longlist.cjs     # the render window over a 900-episode feed
node scripts/smoke-p6-sync.cjs      # two devices pairing and converging
node scripts/smoke-live.cjs         # the deployed site, real CDNs
```

`docs/TESTPLAN.md` is the manual checklist for a release.

## Pull requests

1. Fork, branch, change.
2. `npm run verify` green, plus whichever smoke script covers the area.
3. Say **what** and **why**. Screenshots for UI changes; note anything you could
   not verify yourself (an iOS device, a store submission) rather than implying
   it was tested.

## Reporting bugs

Open an issue with steps to reproduce, expected vs. actual, and your
browser/OS. For security issues see [SECURITY.md](SECURITY.md).
