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
- **A built bundle cannot reach the local Worker.** `stripDevCsp` removes
  `http://127.0.0.1:8787` from `connect-src` in *every* build, so anything
  driving `vite preview` against `wrangler dev` is refused by the page's own
  CSP. Use the dev server for that (`smoke-p4-worker.cjs` does).

## Verifying at the UI

Unit tests cover no layout and no playback wiring. The headless smokes do, and
they need Edge at
`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`:

```bash
node scripts/smoke-p5-mini.cjs      # dock, queue, back-navigation
node scripts/smoke-p3-offline.cjs   # download → offline reload → playback
node scripts/smoke-live.cjs         # the deployed site against real CDNs
```

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
