# Changelog

> **Versioning.** The patch number moves one step at a time and runs up to 99;
> reaching 100 rolls into the minor instead — `4.1.99` → `4.2.0`. Releases are
> not semver-major-bumped for feature work.

## 4.2.6 — 2026-09-10

### A rate limit that actually counts

Backend only, and a direct follow-up to 4.2.5: that release moved the limiter
off KV onto Cloudflare's rate limiting binding, and the release notes said
plainly that the new one is documented as permissive — a counter per location
*and* per machine. Measured against the deployed Worker, 200 requests from one
address drew no refusal at all, because the colo spread them across machines
that each stayed under 60. A limit nobody reaches is not a limit.

Counting now happens in a Durable Object: one instance per key, globally,
single-threaded, so the count is simply correct. The 61st request of a minute
is refused, and the tests assert exactly that against a real object rather than
a mock.

Three things keep it cheap. The instance is addressed by the client's own key,
so Cloudflare places it next to whoever created it and a caller's requests reach
their own counter over a short hop. A refusal is remembered in the isolate that
received it, so a flood stops touching the object at all until its window rolls
over — the expensive path is the legitimate request, and there are sixty of
those a minute. And the counter lives in memory, never in storage: an instance
only goes idle once the traffic it was counting has stopped, which is exactly
when forgetting is the right answer.

The window slides instead of resetting on the minute, so the old trick of
spending a full budget at 0:59 and another at 1:01 is gone. Sync's two budgets
moved to the same limiter. The platform limiter stays wired up as the fallback
for when the object cannot be reached — unreachable must not mean unlimited,
which is precisely how the KV counter failed.

**Needs a manual Worker deploy** (`npm --prefix worker run deploy`); the deploy
also applies the Durable Object migration.

## 4.2.5 — 2026-09-10

### The Worker's limits bounded one request each, never the sum

Backend-only release from an external vulnerability report. Nothing in the app
changes; three of the six findings were against the YouTube audio proxy, which
no longer exists.

**The rate limiter could be switched off by anybody, for everybody.** It counted
in KV, one write per request — spent before the count was compared, so even the
requests it refused paid for the privilege — out of a free-tier budget of 1000
writes a day for the whole account. Roughly a thousand requests exhausted it,
every write after that failed into a swallowed `catch`, and the counter froze at
zero: from then until 00:00 UTC the limiter allowed everything, on every route,
with nothing logged. Sync already avoided this by metering on the platform rate
limiting binding; the proxies now use the same one, on their own namespace, so
no request spends a KV write at all. The KV binding is gone — nothing else used
it, and a fresh deployment no longer has to create one.

The trade is precision for survivability, and it is worth being plain about it:
Cloudflare documents this limiter as permissive and eventually consistent, with
a counter per location *and* per machine. Measured against the deployed Worker,
a 200-request burst from one address drew no refusal at all — a colo spreads it
across machines that each stay under 60. It is a brake, not a wall. What bounds
a caller who ignores it is everything below: the origin requirement, the size
cap, the drain deadline and the aggregate budget.

**One IPv6 host could mint its own budgets.** The counter was keyed on the
literal client address, and a single machine picks whatever interface id it
likes inside its own /64 — so counting up in the last four groups drew a fresh
60-per-minute budget on every request. Keys are now the network prefix: IPv6
collapses to its /64, IPv4 stays literal (a /24 would put unrelated CGNAT
customers in one bucket). Sync's per-address budget uses the same key.

**A stalled upstream could park a request forever.** The fetch timeout covers
reaching a response, not reading it — the timer is cleared the moment the
headers arrive. An upstream that answered instantly and then sent one byte a
second held the request, its connection and its growing buffer for as long as it
kept the socket open. The body read has its own 30-second deadline now (~5.5
Mbps for a full 20 MB feed, far past what any real host needs); past it the
upstream is cancelled and the caller gets a 504, which the client already treats
as "Worker down" and answers from the public proxies.

**Enough concurrent feeds could kill the isolate.** The 20 MB cap bounds one
body. One Cloudflare isolate serves every request routed to it at that colo and
they share its ~128 MB, so a handful of maximum-size feeds at once — the proxy
fetches whatever URL it is handed — took it over the limit and killed every
request in flight on it, other listeners' included. Bytes being read across all
concurrent requests in an isolate are now capped in aggregate at 48 MB; past it
a request gets 503 with `Retry-After` rather than everyone getting nothing. Real
feeds are hundreds of kilobytes, so it takes ~90 concurrent ones to bind. Each
body also peaks at about half what it used to: the chunk list is released as it
is copied instead of being held alongside the finished buffer.

**This release needs a manual Worker deploy** (`npm --prefix worker run
deploy`). Pushing to `main` deploys only the Pages site, and every fix above is
server-side.

## 4.2.4 — 2026-09-07

### A blank app, an open proxy, and a screen that stopped staying awake

Housekeeping release: no new features, six real defects.

**The app could refuse to start.** A single malformed entry in the stored
subscription list threw while it was being read — inside boot, before anything
rendered — and the value causing it lives in `localStorage`, so it did it again
on every reload. The app came up blank and stayed blank until site data was
cleared. Two ways in: restoring a hand-edited backup file (`pp_favs` was copied
in without validation, though `restoreBackup`'s own note claimed every loader
checked its shape), and a sync payload from another build. `loadSubscriptions`
now drops what does not fit and keeps the rest, the way the queue and settings
loaders already did, and leaves the stored value alone so nothing is destroyed.
The sync payload check now also rejects a subscription without a usable id and a
queue row without a feed or track id.

**The Worker's open-proxy guard could be walked past.** The feed and iTunes
proxies are restricted to the app's own `Origin`, with any localhost origin
allowed so `wrangler dev` works. But a header is not proof of anything —
`curl -H 'Origin: http://localhost'` was enough to use the deployed proxy as a
general-purpose one and to seed its shared edge cache. A localhost origin is now
accepted only by a Worker that is itself running on localhost, which the request
URL settles and a caller cannot forge. Proxy responses also carry
`X-Content-Type-Options: nosniff`, and the feed proxy now refuses SVG, XHTML and
script content types rather than only HTML.

**The screen wake lock never came back.** It was released by the OS under
battery saver and the code meant to notice — but it did so by assigning to
`released`, which is a read-only property, so the assignment threw and was
swallowed. The stale handle then made every later attempt short-circuit: one
drop and the screen was free to sleep for the rest of the session. It now
listens for the sentinel's own `release` event and re-acquires while playback
still wants it.

**The desktop shell blocked its own downloads.** 4.2.2 fixed the web
`connect-src`, which had been an allow-list that silently blocked episode
downloads and background caching for every third-party host. The Windows shell
carries its own policy in `tauri.conf.json` and was not part of that fix, so it
still enumerated a handful of CDNs. It now matches the shipped web policy, and a
test fails if the two drift apart again.

**Dragging the volume slider re-rendered the episode list.** `input` fires at
pointer rate, and every one of those wrote the whole settings object to
`localStorage` synchronously *and* re-emitted the browse session — which makes
the podcast view rebuild a row signature for every episode in the archive. On a
long feed that was thousands of signature builds a second for a control no row
renders. The settings write is now coalesced (and flushed on the way out, so
nothing is lost), and the list only re-renders for the two settings its rows
actually read.

**The sleep timer stopped saving its place in a background tab.** The
crash-recovery write fired only when the countdown landed exactly on a
fifteen-second multiple. With one-second ticks it always does; a throttled tab
delivers coarse ticks that step straight over them, and the stored value froze.
It is counted now instead of derived.

**A smoke script that could not pass.** `smoke-p4-worker.cjs` drove a *built*
bundle against the local Worker — but every build has the loopback origin
stripped from its CSP, so the page refused its own request and nothing rendered.
It has been silently unrunnable since that strip was added, which is also why
the Worker path had no end-to-end coverage. It runs against the dev server now,
cross-origin, so the open-proxy guard is exercised rather than bypassed, and it
refuses to start when a leftover server holds its port — a stale bundle serving
the SPA fallback in place of a feed reads as "invalid rss" and looks like a
parser bug.

Also: the pairing code's stored revision is no longer overwritten before it is
read back at startup, the Worker's copy of the private-feed detector is
byte-identical to the client's again (with a test to keep it that way), and dead
code left behind by earlier refactors is gone.

## 4.2.3 — 2026-09-07

### Listen on one device, carry on from another

Progress, subscriptions and the queue can now follow you between a PC and a
phone. There is no account: one device generates a **pairing code**, you type it
into the other, and that is the whole setup.

The code never leaves your devices. Two independent values are derived from it
(HKDF-SHA256): the id the server files a row under, and the AES-GCM key that
encrypts the contents. The Worker stores opaque bytes it cannot read, and an id
recovered from a log decrypts nothing.

- **What travels:** resume positions, the last-played episode per feed,
  subscriptions and the queue. **Settings deliberately do not** — a phone's font
  size and volume have no business overwriting a desktop's.
- **Conflicts.** Positions carry timestamps in new sidecar keys (`pp_prog_at`,
  `pp_last_at`, `pp_subs_at`, `pp_subs_rm`, `pp_queue_at`); `pp_prog` itself is
  unchanged, so old backups still restore and a rollback needs no migration.
  Writes less than a minute apart are treated as concurrent and the *further*
  position wins, because a position jumping backwards is the failure people
  notice. Unsubscribing travels as a tombstone, or the other device's copy would
  simply resurrect it.
- **Clock skew.** Every response carries the server's time; the client measures
  its own offset from the round-trip midpoint and compares like with like. A
  stamp more than 48 hours ahead is treated as a wrong clock, not a newer write.
- **Compare-and-set.** Pushes carry `If-Match`; a stale one is refused with 409
  and the winning blob, so the client merges and retries instead of silently
  discarding the other device's entries.
- Unlinking is local and keeps everything on the device. "Delete server data"
  removes the stored blob for every device. Losing the code loses the synced
  copy — the UI says so before generating one.

**Resume made reliable.** `canplay` can fire before the audio element will
accept a seek, and the saved position was then silently dropped — playback
started from the top and the next `timeupdate` wrote that over it. The resume
now retries until the seek takes, and stops once the listener is genuinely under
way. This bug predates sync; it just became much easier to see.

**Service worker.** `/v1/sync` responses are never cached. The worker normally
lives on another origin and was skipped anyway, but a same-origin deployment
would have had stale-while-revalidate replay another device's blob, and a cache
miss hand the client the app shell to decode as ciphertext.

**Rate limiting.** Sync does not go through the KV limiter. That limiter spends
a KV write per request out of a 1000/day free-tier budget shared with the feed
and iTunes proxies — and it degrades open once the budget is gone, which would
take the whole Worker down rather than just sync. Sync uses the platform rate
limiting binding instead.

## 4.2.2 — 2026-09-06

### Volume, a sidebar worth using, and downloads that reach the CDN

**Volume control.** The app could play at exactly one level — whatever the
device was set to — which is a strange gap in a player. There is now a speaker
and a slider in Now Playing on every device, and in the mini dock from 1024px
up, where there is room for it. The two surfaces render from the same state
(`ui/volume-control.ts`, the arrangement `sleep-control.ts` already used), so
they cannot disagree. The level and the mute flag are remembered.

- Muting keeps the level you chose, so unmuting returns to it rather than to
  full volume. Dragging up from silence counts as unmuting. Pressing the
  speaker while the slider sits at zero raises the level, so the button is
  never something that visibly does nothing.
- The engine now multiplies two separate things — the listener's level and the
  sleep timer's fade — instead of the fade saving and restoring `audio.volume`
  behind everyone's back. Moving the slider mid-fade no longer cancels the
  fade, and a cancelled fade no longer restores a level nobody asked for.
- **On iOS the control hides itself.** WebKit makes `audio.volume` read-only
  there: the hardware buttons are the only volume control a web page can have.
  A slider that did nothing would be worse than no slider, so it is not drawn.
- Native `<input type="range">`, for the pointer, touch and keyboard handling
  it brings — arrows, Home/End, Page Up/Down — and the screen-reader semantics.
- The dock's end cluster gained a spacing rhythm it did not have: 4px between a
  control and its own icon, 12px between one control and the next. The volume
  slider had been sitting flush against the sleep timer's moon.

**The sidebar collapses and reopens without hunting for a control.** The toggle
sat at the foot of the rail, small and easy to miss. Open, it is now beside the
wordmark at the top, drawn as a sidebar glyph rather than a chevron.

Collapsed, it is not drawn at all, because the rail itself is the control:

- **Pointing at the rail peeks it open** — full width, labels and all — and
  moving away closes it again. The panel floats *over* the page rather than
  pushing it, so a pointer crossing the edge never shifts what you were
  reading. Opening waits 120ms and closing 320ms, so clipping the edge on the
  way past does not make it flap. Those delays are timed in `ui/nav.ts` rather
  than written as CSS `transition-delay`, because they belong to the pointer:
  as a delay on the rail itself, they also applied to pressing the toggle, and
  the collapse looked like it had hung. The rail is positioned rather than a
  flex item in both states for the same reason — switching between the two
  layouts mid-change made the content jump to its new place while the rail was
  still sliding. And the peek is held by `:has(:focus-visible)`, not
  `:focus-within`: clicking the toggle leaves it focused under the pointer, and
  that used to hold the panel open against you.
- **Clicking anywhere on the rail pins it open.** The destinations keep their
  own job: clicking one navigates and leaves the rail collapsed.
- The icons sit in exactly the same place peeking or not, so nothing slides out
  from under the pointer; only the width and the labels change.
- `[` toggles it from the keyboard (listed in the `?` cheatsheet), matched by
  physical key too — on a Turkish Q layout that key types `ğ` and `[` needs
  AltGr. Tabbing into the rail peeks it, and the invisible button covering the
  brand mark draws itself again on focus, so the action stays reachable and
  labelled without an icon sitting there at rest.

**Now Playing fits shorter screens.** Adding a row cost vertical space, so the
sheet now compacts under 740px tall: the artwork is capped against the viewport
height as well as its width, the hero scrubber and the play button shrink, and
the rhythm tightens. A 375×667 phone shows every control — and the episode
notes — without scrolling, which it did not do before.

**Downloading an episode works again.** The app's own CSP had `connect-src` as
an allow-list of API hosts, so the `fetch` behind *Download* — and behind
*cache while playing*, which 4.2.0 added to keep a locked screen playing — was
blocked for every episode whose audio sits on the podcast's own CDN, which is
to say nearly all of them. Both failed silently in production while working
locally, where the test audio is same-origin. `connect-src` now allows `https:`;
`SECURITY.md` records why, and `scripts/smoke-live.cjs` now downloads a real
episode so the deployed site is exercised against a third-party host.

  Verified in production: an episode saves in a few seconds and plays back from
  the cache. What the app can no longer do is get in its own way — whether a
  given download completes is still the host's business, since a CDN that does
  not answer a cross-origin request (or a redirect chain where one hop does
  not) is beyond the page's reach. Streaming is unaffected either way: `<audio>`
  needs no CORS.

**Housekeeping.**

- Dead code removed: `pbMuted`, `pbBufferedEnd`, `pbReadyState`, `pbSrc`,
  `playingEpisode`, `isPlayingTrack`, `wantsToPlay`, `svcJson` and a test seam
  with no test. Nothing referenced any of them.
- `smoke-live.cjs` still asserted that Search shows a YouTube section, removed
  in 4.2.0; `smoke-p3-offline.cjs` read the playback clock from the Now Playing
  sheet, which by design does not update while the sheet is closed. Both were
  reporting failures that were not there.
- `CONTRIBUTING.md` still described the v1 app — one HTML file, no build step,
  `esc()`, a `LANGS` object — and has been rewritten for what the project
  actually is. `CLAUDE.md` (new) records the same ground for an agent, plus the
  traps: HMR forking module instances, the sheet that is never `display:none`,
  and not running Prettier across a tree that was never uniformly formatted.
- Reference and store screenshots regenerated: the manifest's install
  screenshots were showing a 4.1 UI. `scripts/shot.cjs` defaulted to an output
  directory that does not exist.

## 4.2.1 — 2026-09-06

### Layout and legibility pass

Six things reported from a phone and a laptop, fixed where each of them
actually lived.

- **Long titles are readable again.** An episode title too wide for the mini
  dock drifts slowly to its end, rests, and drifts back, instead of stopping at
  an ellipsis — the part that distinguishes "15. Bölüm" from "16. Bölüm" was
  exactly the part being cut. It moves only when the text really overflows, and
  under `prefers-reduced-motion` it stays put with the ellipsis it always had.
  In episode lists — where 142 drifting rows would be chaos — the title wraps to
  two lines instead. The Now Playing headline now takes three.
- **The language switcher sits in the window's corner on a laptop.** It used to
  ride the right edge of the 720px reading column, which on a wide screen is
  nowhere near the corner it appeared to be aiming for.
- **The sleep timer is the size of what it says.** A native select is as wide as
  its widest option, so the control sat as a 100–120px box reading "—", twice
  the width of the speed control beside it. It is now measured against the
  option actually showing: narrow when off, wider only while "End of episode" is
  chosen. On a phone that also frees the sleep, speed and queue controls to
  share one row while the timer is idle.
- **The seconds on the skip buttons are centred.** They were an overlaid `<span>`
  nudged by a percentage; they are now `<text>` inside the icon's own
  coordinate system, where the circular arrow is centred on (12, 12) — exact at
  any icon size and in any font.
- **Now Playing opens full-screen on a laptop too.** It used to become a panel
  pinned to one corner, which made the player read as a widget rather than the
  place you had just navigated to. Past 1240px the content stays in a centred
  column so a wide window does not stretch it.
- **The desktop sidebar collapses to an icon rail.** A button at the foot of the
  rail folds it to 76px, keeping every destination reachable as an icon with its
  name on hover; the mini dock and the content area move with it, and the choice
  is remembered.

## 4.2.0 — 2026-09-04

### YouTube support removed

The app could no longer deliver what it promised for YouTube — ad-free audio
that keeps playing with the screen off — so the feature is gone rather than
left half-working.

Measured against the deployed Worker on 2026-09-04: **10% of videos resolved to
an audio stream**, down from the ~95% recorded on 2026-07-30. Two independent
gates now gate it, both enforced by YouTube:

- `getBasicInfo` answers `LOGIN_REQUIRED — Sign in to confirm you're not a bot`
  for most videos when the request comes from a datacenter IP. The same call
  from a residential IP succeeds, so it is the egress address that is walled,
  not the code.
- Even when a stream URL resolves, it serves only the first ~2 MB; every range
  past that answers 403 — including from the machine that resolved it. The rest
  of the file needs an attestation token the Worker cannot produce (BotGuard
  needs a JS runtime `workerd` does not allow).

Neither is fixable inside the Worker, and working around them is an arms race
against a moving target. Removed rather than pretended.

- **Client:** `src/youtube/` deleted (Worker client + Atom fallback). The `yt`
  feed kind, `YouTubeRef`, `Episode.ytId`, `FeedMeta.kind`/`yt`, the `?yt=`
  route, the YouTube column in Search, the noembed title backfill and the
  `i.ytimg.com` artwork ladder all went with it.
- **Worker:** `/v1/yt/list`, `/v1/yt/search`, `/v1/yt/resolve` and
  `/v1/yt/audio` are gone, along with `innertube.ts`, the `youtubei.js`
  dependency, the audio-proxy rate-limit budgets and the `yta2:` KV namespace
  usage. `/v1/feed` and `/v1/itunes` are unchanged.
- **Existing data:** a subscription stored as a `yt:` id now resolves to null
  and its row is skipped instead of rendering as a feed that cannot open. An
  OPML file exported by an older version still imports — its podcast entries
  are kept, its YouTube ones skipped. A shared `?yt=` link lands on Home.
- `noembed.com` left the CSP; `VITE_ENABLE_YT` (documented but never
  implemented) left `vite-env.d.ts`.

### Playback survives a backgrounded tab

This work predates the removal and applies to every episode, YouTube or not.

- **`player/recovery.ts` (new).** The element fires `stalled` and then `error`
  when a range request dies mid-episode, and nothing retried it — that is how
  playback died with the screen off. A watchdog now re-resolves the source and
  continues from the same second, with a 1/2/4/8/15 s backoff and a five-attempt
  budget that resets on real progress. It tracks the user's transport intent, so
  a pause the user asked for is never undone, and it stays quiet while offline,
  retrying the moment `online` fires.
- **`player/prefetch.ts` (new).** While an episode streams, its bytes are pulled
  into the same Cache API store a download uses; when the copy completes the
  element is switched to it at the same position, rate and play state. After
  that, playback needs no network at all. Settings → "Cache while playing"
  (`always` / `wifi` / `never`, default `wifi`); self-managed copies are hidden
  from Downloads and evicted oldest-first past 500 MB, and a copy the user saved
  deliberately is never evicted.
- **`player/keep-awake.ts` (new).** Screen Wake Lock while playing and visible.
  It does not keep audio alive with the screen off — nothing web-side can — it
  stops the tab being throttled while the user has the app open.
- `engine.ts` surfaces `stalled`/`waiting` and carries `MediaError.code`; the
  element gets `playsinline` and `preload="auto"` (iOS refuses to play a
  fullscreen-capable element in the background without the former).
- Foregrounding, and Chrome's Page Lifecycle `resume`, re-check that something
  meant to be playing actually is — on iOS that is the only repair point after
  WebKit suspends the page.
- `audio.play()` is called through `?.catch` — it predates its own promise and
  returns undefined on some engines.

### Worker hardening

- Audio chunking moved from 4 MB/16 MB to 8 MB/32 MB, halving continuation
  requests while staying at four subrequests per response (the free plan allows
  50). *(Route removed later in this release; kept here for the record.)*
- KV TTL for a resolved format is derived from the URL's own `expire` parameter
  instead of a fixed 1800 s that contradicted its own comment.

### Docs

- README (both languages), `SECURITY.md`, `docs/STORE.md` and `docs/TESTPLAN.md`
  no longer describe a YouTube feature. `docs/IOS.md` (new) records the
  unverified Capacitor/iOS procedure; `docs/STORE.md` gains an Android
  background-playback note, including the OEM battery setting no web app can
  work around.

## 4.1.27 — 2026-07-31

### Playback session (the "opening a podcast stops the music" bug)

- **Browsing a feed no longer touches the transport.** One `session` object
  meant both "the feed on screen" and "the thing playing", so `openFeed` called
  `embedStop()`, `clearQueue()` and then `audio.load()` for the newly-opened
  feed's last-played episode — which stops the element even with
  `autoplay: false`. Opening a podcast you had listened to before killed
  whatever was playing and wiped the queue. The playing session now lives in
  `player/session.ts` and is written only when the user actually starts an
  episode; `ui/playback-controller.ts` keeps the browse session and derives the
  "now playing" row highlight from the other. Reproduced end-to-end before and
  after, and pinned by `src/ui/playback-controller.test.ts`.
- **prev / next / auto-next follow the playing feed**, not whichever list is on
  screen — they used to walk the browsed feed's array and could jump to an
  unrelated episode.
- **The queue survives.** Entries carry `{ feedId, trackId, title, feedName }`,
  persist to `localStorage`, span feeds, and are no longer cleared by opening
  anything. Auto-next can therefore continue into another show's episode,
  loading that feed from cache or the network as needed.
- Continue-listening rows and the `?resume=1` shortcut now ask for a resume
  explicitly (`resumeLastPlayed()`), which is the behaviour that used to be a
  side effect of opening any feed at all.
- Transport keyboard shortcuts work wherever something is playing, instead of
  requiring the feed view to be open.

### YouTube: ad-free or not at all

- **The `youtube-nocookie` iframe fallback is gone.** It played ads and stopped
  the moment the screen locked — the two things the app promises YouTube
  listeners it will not do. A video whose audio cannot be resolved now says so.
  The decision was measured, not assumed (`scripts/yt-resolve-rate.cjs`):
  ~95% of podcast/talk videos resolve to a real audio stream, ~43% of
  music-label ones. Removing it also drops the YouTube iframe API, two CSP
  origins and `frame-src` entirely — the app now loads no frames at all.
- **The public Piped audio path was dead and is removed.** Zero successes
  across 70 videos through the Worker's pool, and all seven instances failed a
  direct `/streams` probe. Piped/Invidious remain for listing.
- **Long episodes no longer cut out mid-file.** `/v1/yt/audio` streamed a whole
  file in 1 MB chunks, so a ~57 MB episode needed ~57 subrequests and blew the
  free plan's 50-per-request limit; the error was swallowed and the response
  closed short of its promised `content-length`, which the browser reported as
  a generic media error. Ranged requests are now answered with at most 16 MB in
  4 MB chunks, and the client comes back for the rest.
- **`Range: bytes=1-` no longer bypasses the rate limit** on the audio proxy —
  only `bytes=0-` was counted, and that route has no Origin gate to fall back
  on.
- `api.rss2json.com` is no longer the primary source for YouTube Atom feeds.

### YouTube listings: 15 episodes → the whole channel

- **`/v1/yt/list` now uses the same Innertube session that resolves audio.** It
  went through a health-checked Piped/Invidious pool that was measured
  completely dead — every instance 502/403 on every listing endpoint, from this
  machine and from Cloudflare — so every YouTube show in the app was falling
  through to the Atom feed and showing exactly its newest ~15 items.

  Measured against the **deployed** Worker on fresh channels: ~150 episodes on
  average (60–360), 70–92% of channels answering, median 14 s and p90 20 s for
  the first open, then edge-cached for 15 minutes. Titles and durations on 100%
  of rows. The success rate swings between runs because YouTube's bot wall
  treats datacenter IPs inconsistently — a local machine pages the same channels
  to 360 items every time, Cloudflare does not, which is why the numbers here
  are the production ones and not the far prettier local ones.
- **Failures degrade to exactly the old behaviour.** When the Worker cannot list
  a channel, the app falls back to YouTube's Atom feed — the same ~15 items
  every channel used to be capped at — so this is an improvement in every
  outcome rather than a trade.
- Channel paging is time-boxed (8 s) with the first page retried up to three
  times, after measuring that an unbounded walk averaged 248 items but took a
  median of 30 s and up to 55 s, which the client abandons at 25 s.
- **A partial listing says so.** "150 episodes ✓ · older episodes could not be
  loaded" — a prefix of a channel is never presented as the whole channel.
- Absolute upload dates are merged in from YouTube's own Atom feed. Innertube
  reports only relative ages ("1 hour ago"), and turning that into a timestamp
  would be inventing precision, so items the Atom feed does not reach simply
  carry no date.
- **Fixed a sort bug this exposed:** a single dated item was enough to switch
  the list to chronological sorting, which then treated every undated episode
  as epoch 0 and flung them to one end. Chronological sorting now requires most
  of the feed to be dated.
- Removed with the dead pool: `worker/src/yt.ts` entirely, the half-hourly
  health-check cron, the client's Piped/Invidious listing and search
  fallbacks, `svcFirst`, and **twelve upstream origins from both CSPs**.
  `src/youtube/piped.ts` became `src/youtube/service.ts` — it had no Piped left
  in it.

### Truncated archives are now visible

- Apple's lookup returns a small slice of a show and says nothing about it:
  measured, The Daily reports `trackCount` 2676 and hands back **41** episodes;
  Radiolab reports 859 and hands back 200. The status line now reads
  "41 episodes ✓ · of 2676 in the archive" instead of implying the show is 41
  episodes long. (Switching these feeds to their RSS `feedUrl` would lift the
  cap but re-key every episode and orphan saved positions — left as an open
  decision, not done silently.)

### Media session

- Added the `seekto` handler, so the lock-screen scrubber actually seeks
  (position state was already advertised, which drew the bar but did nothing),
  plus `stop` and the platform's own `seekOffset`.
- `playbackState` is now reported, and position state uses the real playback
  rate rather than the stored preference.
- Each action handler is registered separately: one unsupported action used to
  drop every handler after it.

### Privacy & security

- **Third-party CORS proxies are opt-in** (Settings → Privacy, default off).
  Three operators were raced for every feed, so each saw what the user listens
  to and whichever answered first decided what got parsed — enclosure URLs
  included.
- **Paid feeds are never written to the shared edge cache.** They are routed
  through the Worker precisely because they must not reach a third party, and
  were then being stored under `Cache-Control: public` for 15 minutes.
- Restored settings are validated against an allow-list before reaching CSS
  custom properties or `audio.playbackRate`, and the sanitised set is written
  back.

### Data & correctness

- **"Clear all data" now actually clears it.** It only emptied `localStorage`,
  leaving the IndexedDB feed/resume/download stores and the `seseri-audio`
  Cache bucket — potentially gigabytes of downloaded episodes — in place.
- **JSON backups can be restored.** There was an export button and no import,
  which makes the export not a backup.
- **The download fallback no longer claims success it cannot observe.** A
  cross-origin `download` attribute is ignored, so the file was opened in a tab
  while the toast said "saved".
- **Episode notes work for Apple podcasts.** The lookup response carries them;
  nothing read it, so the Now Playing notes panel was permanently empty unless
  the feed had been opened by direct RSS URL.
- **The Apple storefront follows the UI language** instead of being pinned to
  `country=tr` for all eight languages.
- OPML-imported subscriptions get their artwork and author backfilled the first
  time the feed is opened.

### Removed

- Unreferenced exports: `currentView`, `rssMeta`, `sleepActive`, `bindSelect`,
  and the `focusInput` / `restoreFocus` pair in the search view (the latter is
  now folded into `focusTarget`, so back-navigation really does return focus to
  the row that opened the feed). Stale "WP-0 stub" / "P3 replaces this" notes
  that no longer described the code.

## 4.1.26 — 2026-07-30

### Artwork resolution
- **Cover art is no longer upscaled from a thumbnail.** Feeds opened through
  iTunes search only ever stored `artworkUrl100` — a 100×100 image — which the
  Now Playing hero then stretched to 300–320 CSS px (600–840 device px on a
  retina screen). Renditions are now derived per surface from the URL itself
  (`lib/art.ts`): the hero requests 640–1024 px WebP, list rows request 1×/2×/3×
  of their box. Because the upgrade happens at render time, existing
  subscriptions and cached feeds get sharp artwork with no data migration.
- `<picture>` + WebP on the hero (~4× lighter than the equivalent JPEG), with a
  one-shot non-WebP retry, since `<picture>` does not fall back on a 404.
- YouTube thumbnails pick from `default`/`mqdefault`/`hqdefault` only — the
  larger `sddefault`/`maxresdefault` renditions 404 on older uploads, which
  inside a `srcset` would render a broken image. Small rows now request
  `default.jpg` instead of always pulling `mqdefault`.
- Per-episode `<itunes:image>` is now parsed from RSS; previously every episode
  fell back to the channel cover.
- OS media controls advertise 96/256/512 px artwork with `sizes`, prefer the
  episode's own cover over the feed cover, and report position state so the lock
  screen can scrub.
- Fixed: the mini dock kept the previous podcast's cover on a track with no
  artwork; library rows loaded artwork eagerly; only search rows recovered from
  a dead artwork URL. All artwork surfaces now share one tile builder.

### Player & interface
- **Sleep timer rebuilt.** It was a bare `setTimeout`: it kept counting down
  while playback was paused, was lost on reload, offered three fixed presets and
  cut the audio dead. Now it counts only while playback is actually running,
  survives a reload, adds a live countdown and a **+5 min** button, offers any
  duration (1–600) alongside the presets, can stop at the **end of the episode**
  instead, and fades out over the last 30 seconds — restoring the volume
  afterwards, so a cancelled or extended timer never leaves playback muted.
  "End of episode" also beats the queue and auto-next.
- The two sleep controls (Now Playing and the mini dock) previously kept each
  other in sync by reaching across the DOM with `getElementById`. Both now render
  from one signal and cannot disagree.
- **Ambient colour from the artwork**: the Now Playing background picks up the
  cover's dominant colour. Sampling uses a separate off-document image, because
  setting `crossOrigin` on the visible artwork would make it fail to load
  outright on hosts that send no CORS header; when sampling is not possible the
  page simply keeps the user's accent. Never overrides the chosen accent colour,
  and can be turned off in Settings → Appearance.
- **Episode notes** in the Now Playing sheet. Feed descriptions are
  attacker-controlled HTML, so rather than add a sanitizer they are reduced to
  plain text plus https-only links and rebuilt as real nodes — no markup string
  ever reaches the DOM, and the app keeps its single runtime dependency.
  `content:encoded`, `description` and `itunes:summary` are all read.
- **Keyboard shortcut card** (`?`). The shortcuts already existed but were
  documented nowhere.
- The Now Playing sheet is now a real modal: everything behind it is `inert`
  while it is open (and the sheet itself while dismissed), so focus and the
  accessibility tree behave correctly without `display: none`, which would kill
  the YouTube embed.
- Fixed: `--accent-2` was a static amber that `applyAccent` never recomputed, so
  choosing Teal (or any non-amber accent) left the scrubber playhead, its glow
  and the mini progress hover amber.

### Performance
- **The episode list no longer rebuilds itself on unrelated events.** It is keyed
  by `trackId` and only rows whose state actually changed are replaced. Measured
  on a 42-episode feed: an unrelated settings change went from rebuilding every
  row to **0**, a queue toggle to **1**, switching episode to **2**. A real list
  change (sort, filter, new feed) still rebuilds once, as it must. Feeds
  routinely carry thousands of items, so this scales with the archive.
- The list also stopped stealing the reader's scroll position: `scrollIntoView`
  now fires only when the playing episode changes. Five queue toggles used to
  cause five scroll jumps; now zero.
- Home's "continue listening" rail reads a small `resume` projection from
  IndexedDB (new store, schema v2) instead of deserializing every subscribed
  feed's entire archive on every visit home. Falls back to the old path for
  feeds last played before the store existed.
- The YouTube embed's 250 ms progress poll never stopped on pause — it kept
  making cross-iframe calls for the rest of the session, including while the tab
  was in the background.
- The scrubber forced a layout on every `pointermove` (up to 1 kHz on a
  high-polling-rate mouse). The rect is cached and updates are coalesced into a
  frame; the hover time bubble is unchanged.
- Offline downloads stream into the Cache API instead of buffering the whole
  episode in the JS heap — a 150 MB episode was a 150 MB allocation. Available
  space is now checked first, with a real message instead of a generic failure.
- Queue rows no longer scan the whole episode list for each title
  (O(queue × episodes)), and the episode list no longer calls `queuePosition`
  per row (O(episodes × queue)).
- `fmtDate` builds one `Intl.DateTimeFormat` per language instead of one per
  call, and its cache no longer evicts the entries the same render still needs.
- Capped the background noembed title backfill, which was unbounded across a
  playlist of any size.
- Progress/scrubber DOM writes are skipped while the tab is hidden or the Now
  Playing sheet is dismissed.
- Deliberately **not** done: lazy-loading the 8 locale dictionaries. Measured,
  the 7 inactive ones are ~12 KB of a 47 KB gzipped bundle, and `applyLang` runs
  before first paint — making it async would trade a flash of untranslated text
  (and a late RTL flip for Arabic) for a small win.

### Security
- SSRF guard rewritten to parse addresses instead of pattern-matching them.
  IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`), the
  unspecified address `::`, CGNAT `100.64/10`, link-local `fe80::/10` and
  NAT64-embedded private addresses all previously passed the check.
- `/v1/yt/audio` was entirely exempt from rate limiting. It now has its own
  budget, counted on stream starts only so seeking still works.
- The audio chunk fetch used a bare `fetch`, bypassing the Worker's own manual
  redirect re-validation; it now goes through `fetchWithTimeout`, and the
  upstream URL is host-checked before streaming.
- Proxy endpoints now require the app's `Origin`, so the Worker cannot be used
  as a general-purpose open proxy or to seed its edge cache. `/v1/yt/audio` is
  excluded because `<audio>` sends no `Origin`.
- **Private feed URLs are no longer sent to public CORS proxies.** Patreon /
  Memberful / Substack-style feeds carry a subscriber token in the URL, and all
  three proxies were being raced in parallel — disclosing it to three operators
  on every open and refresh.
- `audio.src` was the one media sink `httpsOnly` never covered, despite
  receiving URLs from third-party Piped instances.
- `?rss=` and the search box accepted plain `http://`, unlike RSS enclosures
  which already required `https:`.
- CSP: added `base-uri 'none'` and `form-action 'none'` (neither inherits from
  `default-src`). Tauri now ships a real CSP instead of `null`.
- Service worker cache name is derived from the build manifest. It was a
  hardcoded constant *and* on the never-delete list, so the shell cache could
  never be pruned: superseded assets accumulated indefinitely and non-hashed
  files stayed stale until the constant was bumped by hand. Those now
  revalidate in the background.
- The no-interpolation-into-`innerHTML` invariant is enforced by lint rather
  than by prose in `CONTRIBUTING.md`.
- Removed a dead `sessionStorage('redirect')` write in `404.html` that nothing
  read, and the unreachable `assetlinks.json` placeholder (Android reads app
  links only from the origin root, and the app is served from `/seseri/`).

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
  directly in the dock, and the progress hairline is a tap/drag seek slider —
  no need to open the full player for everyday control. On wider screens the
  transport (prev / skip / play / skip / next) sits centred, with the sleep
  timer and speed selector grouped at the end (both kept in sync with the
  sheet's controls). The expand chevron or the title area still opens the
  Now Playing sheet (scrubber, queue, YouTube video frame).
- **YouTube embed → audio background rescue**: when a track has to start on
  the iframe fallback (which a locked phone pauses), the app keeps retrying
  audio resolution in the background and hot-swaps to the `<audio>` element
  at the same position the moment a stream resolves — restoring lock-screen
  playback and Media Session controls without interrupting the listener.
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
