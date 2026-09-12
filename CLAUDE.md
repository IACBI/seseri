# Seseri — working notes

Vite + TypeScript SPA, no UI framework. `src/ui/h.ts` builds DOM,
`src/state/signals.ts` is the entire reactivity layer, `worker/` is an optional
Cloudflare Worker (Hono) that proxies RSS and iTunes. Ships as a PWA to GitHub
Pages, plus a Tauri Windows shell in `desktop/`.

`README.md` describes the product and the layout. **`CONTRIBUTING.md` holds the
rules that changes have to satisfy** — the XSS invariant, i18n completeness,
design tokens, settings validation, CSP. Read it; it is not repeated here.

This file is the rest: what to run, what bites, and how a release goes out.

## The gate

```bash
npm run verify   # lint + typecheck + unit tests + build + worker typecheck/tests
```

Run it before claiming anything works. `npm run dev` serves on **5199**.

## Traps

- **Do not run `prettier --write` across the repo.** It is not uniformly
  formatted, and a broad run rewrites ~60 untouched files into the diff. Format
  only what you edited.
- **Vite HMR forks module instances.** After an edit, `import('/src/x.ts')` from
  the console gets a *different* copy than the running app imported
  (`/src/x.ts?t=…`), so writes to it appear to do nothing. Restart the dev
  server for a clean read, or measure through the DOM instead.
- **The `<audio>` element is not in the DOM** — `new Audio()` in
  `src/player/engine.ts`. Nothing can query for it.
- **The Now Playing sheet is never `display:none`.** Closed means
  `visibility:hidden`, so its measurements stay valid — but it also means the
  sheet deliberately skips `timeupdate` work while closed. Read playback time
  from the mini dock (`#miniScrub`) when the sheet is shut.
- **A hidden browser pane freezes transitions.** A width read mid-animation is
  not the settled value; disable transitions before measuring, or assert on the
  class and the computed target instead.
- Episode lists render as `.ep-item`, not `.row`.
- **The smokes leak a vite process each, on Windows.** They spawn it through
  `shell: true`, so `SIGTERM` kills the shell and not the server. The orphans
  hold `esbuild.exe` and rollup's native binding, which makes a later `npm ci`
  fail with `EPERM: unlink` **after it has already emptied `node_modules`**. A
  leftover also squats the port and serves a *stale* bundle to the next run —
  the app then loads the SPA fallback where it expected a feed and reports
  `invalid rss`, which looks like a parser bug and is not one. Sweep them
  before a clean install:
  `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ? { $_.CommandLine -match 'vite' } | % { Stop-Process -Id $_.ProcessId -Force }`
- **Seeding `localStorage` from a page that runs the app is thrown away.**
  The app writes its own state back on `pagehide` (`persistAndPush()` →
  `saveSettings` / `saveProgressNow`), so anything a script set before
  navigating away is overwritten by the defaults. It looks exactly like lost
  progress. Seed from an inert same-origin document instead —
  `/manifest.webmanifest` is the one the smokes use.
- **A request interceptor that matches on a substring intercepts the app
  itself.** The app's own navigation URL carries the feed in `?rss=<encoded>`,
  so `url.includes(FEED)` is true for the page load as well and the page is
  served the feed XML. Bail out on same-origin first:
  `if (u.startsWith(ORIGIN)) return req.continue()`.
- **A dev server left running for a long session serves a stale CSS bundle.**
  New rules appear to have no effect and geometry drifts for no reason.
  Restart it before believing a measurement — this is the same stale-bundle
  trap as the vite orphans, from the other direction.
- **A background tab throttles `setTimeout`.** Anything on a timer — the
  prefetch commitment gate, throttled progress writes — stalls in a tab that
  is not fronted, and the smoke times out with a correct assertion. Call
  `page.bringToFront()` before waiting on time-based behaviour.
- **`#miniScrub`'s `aria-valuenow` is a percentage, not seconds.** Reading it
  as a position makes real-time playback look ten times too slow.
- **A built bundle cannot reach the local Worker.** `stripDevCsp` removes
  `http://127.0.0.1:8787` from `connect-src` in *every* build, so anything
  driving `vite preview` against `wrangler dev` is refused by the page's own
  CSP. Use the dev server for that (`smoke-p4-worker.cjs` does).

## Verifying at the UI

Unit tests cover no layout and no playback wiring. The headless smokes do.
They find a Chromium themselves (`scripts/lib/harness.cjs`: Chrome first — Edge
is also a Chromium but refuses to launch under CDP on this machine, reporting
"Code: 0" and nothing on stderr); `SESERI_BROWSER` overrides, which is what CI
passes.

```bash
npm run smoke                       # the six below, in order — 73 assertions
node scripts/smoke-shell.cjs        # boot, navigation, theme, language
node scripts/smoke-p3-offline.cjs   # download → offline reload → playback
node scripts/smoke-p5-mini.cjs      # dock, queue, back-navigation
node scripts/smoke-chapters.cjs     # chapter list, scrubber markers, transcript
node scripts/smoke-longlist.cjs     # the render window over a 900-episode feed
node scripts/smoke-p6-sync.cjs      # two devices pairing and converging
node scripts/smoke-live.cjs         # the deployed site against real CDNs
```

`smoke:sync` runs last in the chain because it rebuilds `dist` with its own
`VITE_API_BASE` and `VITE_SYNC=1`.

`smoke-live.cjs` is the only one that touches a third-party audio host, which is
where CSP mistakes surface — every local run is same-origin and will pass a CSP
that production rejects. That gap hid broken downloads for two releases.

When the UI changes, regenerate both sets of screenshots: `node
scripts/shot.cjs` (docs) and `node scripts/store-shots.cjs` (the manifest's
install screenshots, which users actually see).

## Releasing

Patch numbers step one at a time to 99, then roll the minor (`4.1.99` → `4.2.0`).

1. Bump `package.json`, `desktop/package.json`,
   `desktop/src-tauri/tauri.conf.json` and the two lockfiles' top-level version.
2. Add a `CHANGELOG.md` section; update `README.md` (both languages) and
   `docs/TESTPLAN.md` for anything that changed behaviour.
3. Commit as `release: X.Y.Z — …`, push, then push tag `vX.Y.Z`.
4. The tag builds the Tauri installer and opens a **draft** GitHub Release.
   Fill it in with Turkish and English sections, then publish.
5. **Deploy the Worker by hand if it changed.** Nothing in `.github/workflows/`
   touches it — pushing to `main` deploys only the Pages site, so a Worker fix
   sits in the repository looking shipped while production still runs the old
   code:

   ```bash
   npm --prefix worker run deploy   # wrangler deploy
   ```

   Then check it from outside, because the edge cache serves pre-deploy
   responses (with pre-deploy headers) for up to an hour on a key it already
   holds — a fresh URL is the only honest probe:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: http://localhost' \
     "$API/v1/itunes?url=<encoded>"   # must be 403 from production
   ```
