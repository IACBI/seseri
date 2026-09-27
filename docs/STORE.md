# Seseri — Release guide (Worker → Web → Windows → Google Play)

Every packaged app opens the **live HTTPS site**, so app updates come from the
web: a new web deploy reaches Windows and Android users without a new package.
Order matters when setting up: the Worker first, then the website, then the
packages.

---

## 0) Prerequisites

- A Cloudflare account (the free plan is enough).
- The GitHub repository `IACBI/seseri`; the live site is served from it by
  GitHub Pages.
- A Google Play Console account ($25, once) — only for Android.
- The privacy policy URL, which ships with the site:
  `https://iacbi.github.io/seseri/privacy-policy.html`

Windows does not go through a store (see §3), so no Microsoft Partner Center
account is needed.

---

## 1) Deploy the Worker (Cloudflare)

```bash
cd worker
npx wrangler login      # approve in the browser
npx wrangler deploy
```

The deploy creates everything the Worker binds to except the database: the
rate-limiter Durable Object (declared under `migrations` in
`worker/wrangler.jsonc`), the platform `ratelimits` bindings it falls back on,
and the daily cron that sweeps abandoned sync rows.

**On a new Cloudflare account**, sync needs its D1 database:

1. Create one and put its id in `database_id` in `worker/wrangler.jsonc`.
2. Create the table: `npx wrangler d1 migrations apply seseri-sync --remote`.

**On a site other than `iacbi.github.io`**, add its origin to
`ALLOWED_ORIGINS` in `worker/src/index.ts`. The Worker refuses every other
origin with 403, which is what stops it being an open proxy.

Note the URL in the deploy output: `https://seseri-api.<account>.workers.dev`.

**Nothing deploys the Worker automatically.** A push to `main` deploys only the
website, so a Worker change sits in the repository looking shipped until someone
runs `npx wrangler deploy` by hand.

**Check it from outside** after every deploy. The edge cache serves responses
from before the deploy for up to an hour on URLs it already holds, so probe with
a fresh URL:

```bash
API=https://seseri-api.<account>.workers.dev

curl -s "$API/"
# → {"name":"seseri-api","ok":true}

curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: http://localhost' \
  "$API/v1/parse?url=https%3A%2F%2Ffeeds.simplecast.com%2F54nAGcIl&limit=1&x=$RANDOM"
# → 403: a forged Origin is refused

curl -s -H 'Origin: https://iacbi.github.io' \
  "$API/v1/parse?url=https%3A%2F%2Ffeeds.simplecast.com%2F54nAGcIl&limit=1&x=$RANDOM"
# → JSON with "total" and one episode
```

Do not use `/v1/itunes` as the health check. Apple refuses requests from
Cloudflare's servers from time to time (`{"error":"upstream 403"}` or
`upstream 429`) whatever the Worker does; the app then calls iTunes directly
from the browser, so a 502 there does not mean the deploy is broken.

If `curl` cannot complete the TLS handshake with `*.workers.dev` on your machine,
run `node scripts/smoke-live.cjs` instead. It checks the deployed site through a
real browser. For the Origin check, drive a page with
`page.setExtraHTTPHeaders({ Origin: 'http://localhost' })` and read
`response.status()`.

---

## 2) Deploy the website (GitHub Pages)

`.github/workflows/pages.yml` builds and deploys on every push to `main`.
Set it up once:

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables:**
   - `VITE_API_BASE` = `https://seseri-api.<account>.workers.dev`
   - `VITE_SYNC` = `1` to turn on cross-device sync, or leave it unset

   Both are baked into the build. Leaving `VITE_API_BASE` empty builds an app
   that parses feeds on the device and has no sync.

The CSP in `index.html` needs no change for the Worker: `connect-src` and
`media-src` already allow any `https:` origin.

Then check `https://iacbi.github.io/seseri/`: search works, an episode
downloads and plays in airplane mode, settings open —
`node scripts/smoke-live.cjs` checks most of this, including CSP violations,
against the real CDNs.

---

## 3) Windows app (no store — a downloadable installer)

The desktop app is the **Tauri v2** shell in `desktop/`. It opens the live site
in WebView2, so every web deploy reaches desktop users at once. The installer
is about 1.8 MB.

### Building and publishing

Pushing a `v*` tag runs `.github/workflows/desktop.yml`, which builds the NSIS
installer and attaches it to a **draft** GitHub Release. Fill in the release
notes and publish it. The version comes from `desktop/src-tauri/tauri.conf.json`,
which must match `package.json` — `tests/unit/version-sync.test.ts` fails if
any of the seven files that carry the version disagree.

To build locally instead:

```bash
cd desktop
npm install          # once
npx tauri build      # the first run compiles the Rust dependencies (5–15 min)
```

Output: `desktop/src-tauri/target/release/bundle/nsis/Seseri_<version>_x64-setup.exe`

The link for the README and the site:
`https://github.com/IACBI/seseri/releases/latest`

### Worth knowing

- **SmartScreen warning:** the installer is not code-signed, so Windows shows
  "Windows protected your PC" on first run; the user chooses **More info → Run
  anyway**. Removing it takes a code-signing certificate (Azure Trusted Signing,
  about $10/month, or an OV certificate from about $70/year). The warning also
  fades on its own as the file gathers downloads.
- **Updates:** app content comes from the web, so an installer built for an old
  version keeps working and keeps up with the site. A new installer is only
  needed by users when the shell itself changes (icon, window, permissions).
- **Icons** are regenerated from the "signal" mark (the five-bar frequency sign)
  with `npx tauri icon ../public/icons/icon-512.png`; the source PNGs come from
  `public/icons/seseri.svg` via `node scripts/icons.cjs`. Only needed when the
  brand image changes.

---

## 4) Google Play (Android / TWA)

1. In [PWABuilder](https://www.pwabuilder.com/), enter the live URL →
   **Package for Stores → Android**.
2. Settings:
   - Package ID: `io.github.iacbi.seseri`
   - App name `Seseri`; the theme colour is filled in from the manifest.
   - **Signing key: "Create new"** — PWABuilder generates it. **Keep the
     `signing.keystore` and its passwords from the downloaded zip for good**:
     without them no update can ever be published.
3. The zip contains `app-release-bundle.aab` (what Play gets) and
   `assetlinks.json` (with the SHA-256 fingerprint).
4. **Digital Asset Links — this repository cannot serve them.** Android reads
   the file **only from the origin's root**:
   `https://iacbi.github.io/.well-known/assetlinks.json`. The app lives under
   `/seseri/`, so a file in this repository would never be read.

   Publish PWABuilder's `assetlinks.json` under `.well-known/` in the **user
   site repository** (`IACBI/iacbi.github.io`) and check that
   `https://iacbi.github.io/.well-known/assetlinks.json` shows the fingerprint.
   *(Without it the app opens with the browser's address bar showing.)*

   The alternative is moving the app to its own domain and serving the file
   from that domain's root.
5. Play Console: https://play.google.com/console → **Create app** → name
   `Seseri`, App (not game), Free.
6. **Testing → Internal testing → Create release** → upload the `.aab` → add
   yourself as a tester → install on a phone and check: installation, opening
   offline, audio in the background, media controls in the notification shade,
   and that no address bar shows.
7. **Grow → Store presence → Main store listing:** description, 512 px icon,
   1024×500 feature graphic, phone screenshots —
   `public/screenshots/narrow-home.png` and `narrow-feed.png` are current
   (regenerate with `node scripts/store-shots.cjs` whenever the UI changes).
   The description should match the app as it is: the warm charcoal and amber
   "Sinyal" design, Home / Search / Library / Settings in a bottom tab bar (a
   left rail on large screens), and the Now Playing sheet.
8. **Policy → App content:** the privacy policy URL, the Data safety form (no
   data collected; everything stays on the device — cross-device sync is
   opt-in and end-to-end encrypted), and the IARC questionnaire.
9. **Production → Create release** → the same `.aab` → **Submit for review**
   (the first review can take several days).

> **Terms of service:** releases before 4.2.0 had a YouTube audio feature, a
> third-party terms-of-service risk. It is gone; the app talks only to RSS feeds
> and the Apple Podcasts catalogue.

### Background playback (what to tell users)

A TWA runs in Chrome's own process: once `navigator.mediaSession` metadata is
set, Chrome shows the media notification and runs a foreground service itself,
so audio normally carries on with the screen off. When it is reported to stop,
there are two real causes:

1. **The network.** An episode streams in pieces, and a request that dropped
   while the phone slept used to end playback for good.
   `src/player/recovery.ts` now re-resolves the source and continues from the
   same second, and `src/player/prefetch.ts` caches the whole episode in the
   background so playback stops depending on the network (Settings → "Cache
   while playing").
2. **Manufacturer battery management.** Xiaomi, Samsung and Huawei kill apps
   aggressively in a way no web-based app can work around. Put this in the store
   description and the FAQ: **Settings → Apps → Seseri → Battery →
   "Unrestricted"**.

To check: while playing, `adb shell dumpsys media_session` lists a session, and
`adb logcat` shows the episode requests continuing in the background.

---

## 5) iOS (App Store) — status and roadmap

**There is no packaged iOS build.** On iPhone and iPad Seseri works as a PWA
from Safari (Share → Add to Home Screen), with the known limits of iOS PWAs:

- Background and lock-screen audio work, but the media controls are less
  consistent than on Android.
- Safari may **evict** storage (Cache API, IndexedDB) under pressure or after
  long disuse, so downloaded episodes are not guaranteed to stay
  (`navigator.storage.persist()` is limited on iOS).
- There is no install prompt; the user adds the app by hand.
- The volume slider is hidden: iOS does not let a page set the volume.

**The way to a real App Store package** is PWABuilder's iOS package (a WKWebView
wrapper) or a Capacitor shell. Either needs (**credential-blocked** — nothing in
the code is in the way):

1. Apple Developer Program membership ($99/year).
2. Signing in Xcode (macOS required) and an App Store Connect record.
3. App Review: to avoid a "just a website wrapper" rejection, stress what the
   app does natively (offline downloads, the media session).

The YouTube terms-of-service risk noted at the end of §4 does not apply to iOS
either: that feature is gone.

The concrete steps — `capacitor.config.ts`, the `Info.plist` keys and the
`AppDelegate.swift` change — are in [IOS.md](IOS.md). None of them has been
verified: they cannot be built without macOS and an Apple Developer account.

Until then iOS support is documented as "Safari PWA".

---

## 6) Updates

- **App content and code:** deploy the web again. The Windows and Android
  packages open the same live site, so users get it at once.
- **Packaged metadata** — manifest identity, icons, shortcuts: build a new
  package in PWABuilder, raise its version and resubmit (on Android, **with the
  same keystore**).

## Release checklist

The full sequence, with the traps, is in `CLAUDE.md` (Releasing); the manual
checks are in [TESTPLAN.md](TESTPLAN.md).

- [ ] `npm run verify` green (lint, typecheck, app and Worker unit tests, build).
- [ ] `npm run smoke` green (seven headless browser smokes, 89 assertions).
- [ ] The version raised in all seven places — `version-sync.test.ts` checks.
- [ ] `CHANGELOG.md`, `README.md` (both languages) and `docs/TESTPLAN.md` updated
      for anything that changed behaviour; screenshots regenerated if the UI
      changed (`store-shots.cjs`, `shot.cjs`).
- [ ] Tag `vX.Y.Z` pushed; the draft Release from `desktop.yml` filled in with
      Turkish and English notes, then published.
- [ ] **The Worker deployed by hand if it changed**, and probed from outside
      (§1): the forged Origin gets 403, `/v1/parse` answers.
- [ ] `ALLOWED_ORIGINS` in `worker/src/index.ts` lists the site's origin.
- [ ] Live: `node scripts/smoke-live.cjs` — search, a feed, playback, a download
      from the podcast's own CDN, no CSP violations.
- [ ] Android only: `assetlinks.json` with the real fingerprint served from the
      **origin's root** (`iacbi.github.io/.well-known/`, not this repository).
