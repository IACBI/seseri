# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.
Instead, use GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository page) or contact the
maintainer directly.

You can expect an initial response within a week.

## Scope

- **Client:** no accounts, no cookies — settings/progress live in
  `localStorage`, feed cache and download metadata in IndexedDB, downloaded
  audio in the Cache API. External requests go to `itunes.apple.com`, the
  optional Seseri Worker, Google Fonts, and podcast hosts' own CDNs. The public CORS proxies
  (allorigins/codetabs/corsproxy) are **opt-in and off by default** — see
  below. A strict Content Security Policy (no `'unsafe-inline'` scripts, no
  frames at all) is declared in `index.html`; remote data is only inserted
  through a typed DOM builder. Values restored from `localStorage` are
  validated against an allow-list before reaching CSS custom properties or the
  media element.
- **Worker (`worker/`):** a stateless proxy on Cloudflare. Feeds whose URL
  carries a subscriber credential are served with `Cache-Control: no-store` and
  never written to the shared edge cache. It enforces an SSRF guard on user-supplied URLs (re-validated on every redirect hop —
  redirects are followed manually, max 3 hops, and each `Location` target must
  pass the same private-host checks), response size caps, a feed-shape check so
  `/v1/feed` returns only bodies that begin like RSS, Atom or RDF, and rate
  limiting per client network prefix; it stores no user data. The `Origin`
  check is browser-side CORS policy, not authentication: any client can send
  `Origin: https://iacbi.github.io`, and the app is a public static client with
  no secret that could prove a request came from it. It stops other sites'
  pages from calling the proxy; it does not stop `curl`. A proxied body is
  also bounded in two ways a per-request cap cannot manage on its own: the drain
  has its own deadline (the fetch timeout covers reaching a response, not
  reading it, so a one-byte-a-second upstream used to pin a request and its
  buffer indefinitely), and the bytes being drained across every concurrent
  request in one isolate are capped in aggregate — a handful of maximum-size
  feeds at once would otherwise take the isolate over its memory limit and kill
  every request in flight on it. Both answer with a 5xx and a `Retry-After`.
  `/v1/feed` is a feed fetcher, not a general URL fetcher: a body that does not
  start with an XML root of `rss`, `feed` or `rdf:RDF` (after an optional BOM,
  declaration, comments and DOCTYPE) is refused with 415 and never edge-cached.
  That check looks at the bytes, not the upstream's `Content-Type`, so it holds
  against a host that lies about its type.
  A localhost `Origin` is accepted only by a Worker that is itself running on
  localhost — `wrangler dev` needs it, and until 4.2.4 the deployed Worker
  honoured the header too, which any client could simply send. Proxied bodies are returned with
  `X-Content-Type-Options: nosniff` and under a content type that cannot render
  as a document. The SSRF check parses
  addresses rather than pattern-matching them, so IPv4-mapped IPv6
  (`::ffff:169.254.169.254`), the unspecified address, CGNAT `100.64/10`,
  link-local and NAT64-embedded private addresses are all rejected. Targets
  are also limited to ports 80 and 443 (an explicit default port is fine; any
  other would turn the proxy into a port scanner for whatever a public host runs
  besides its web server), and `*.workers.dev` is refused, since proxying a
  worker back into a worker is a request loop. `/v1/itunes` re-checks its host
  on every redirect hop, not just the first request. Every response from
  `/v1/feed`, `/v1/itunes` and `/v1/parse` — errors and cache hits included —
  carries `Content-Security-Policy: default-src 'none'; sandbox` as well as
  `nosniff`, so a body that is somehow rendered as a document can do nothing.
- **Private (paid) feeds:** services like Patreon, Memberful and Substack put a
  subscriber token in the feed URL itself. Such URLs are never sent to the
  public CORS proxies — they go only to the app's own Worker, and the feed
  fails with an explanatory message if no Worker is configured. Ordinary public
  feeds are unaffected.

## Cross-device sync

Sync is opt-in and account-free. The pairing code is 15 bytes from
`crypto.getRandomValues`; two independent values are derived from it with
HKDF-SHA256 using different `info` strings — the id the server files the row
under, and an AES-GCM-256 key. The Worker therefore stores ciphertext it cannot
read, and an id recovered from a log or a database dump decrypts nothing.

The threat model, stated plainly:

- **The code is a bearer token.** Anyone holding it can read and overwrite that
  row. This is inherent to silent background sync — the code has to be enough to
  re-derive the key and to pair a further device. It is kept out of URLs (a URL
  reaches request logs, history and `Referer`) and out of the JSON backup file,
  and it travels in the `x-sync-id` header.
- **Losing the code loses the synced copy.** There is no recovery by design.
  Each device keeps its own local data regardless.
- **Revocation** is `DELETE /v1/sync` plus generating a fresh code.
- **A clobbered row cannot destroy local state.** Anything that fails to
  authenticate is reported and ignored; local is authoritative on every device.
- **Rate limiting** is per client network prefix and per hashed sync id, on its
  own namespaces of the platform rate limiting binding, so sync traffic cannot
  spend the proxies' budget.
- Blobs are capped at 128 KiB, never cached (`cache-control: no-store`, and the
  service worker skips the route), and rows untouched for 180 days are swept.
- **Creating a row needs no credential** (the id is whatever the caller
  invents), so it is limited separately from reads and updates. Each address
  gets five creations an hour, counted in storage inside the limiter object —
  an in-memory count would reset whenever an idle instance is evicted — and
  creation is refused, not allowed, while that object is unreachable. A row that
  was created and never written again (rev 1) is swept after 7 days instead of
  180; a device in real use pushes on every change and is never affected. A
  table-wide ceiling (50,000 rows or 1 GiB, overridable with the
  `SYNC_MAX_ROWS` / `SYNC_MAX_BYTES` variables) refuses further creations with
  503 while leaving updates alone; the count is cached per isolate for 30
  seconds, so it is a soft cap that a burst can overshoot slightly.
- **The server clock is not trusted without bound.** The client uses
  `x-sync-time` to correct its own timestamps, and ignores any reading more than
  24 hours from the device clock (a value restored from storage is held to the
  same limit), so a hostile or broken server cannot make every local edit look
  ancient or every remote one look newer than anything local.
- **A replayed row is detected.** AES-GCM cannot tell an old blob from a new
  one: both authenticate. Each push therefore carries a counter inside the
  encrypted payload, one above the highest any device has seen, and a device
  stores the highest it has seen. A pulled row below it is neither applied nor
  overwritten (the status shows an error, and the next push from a device with a
  higher counter repairs the row). A payload with no counter, from an older
  build, is accepted. Decompression of a payload is capped at 1 MiB and fails
  closed, so a crafted blob cannot expand into memory.

## Known residual risks

- The SSRF guard is hostname-based; it cannot resolve DNS, so a hostname that
  *resolves* to a private address (DNS-rebinding style) is not fully
  preventable inside Workers. Cloudflare's own egress restrictions on
  RFC 1918 space mitigate this in practice.
- Rate limiting counts in a Durable Object — one instance per key, so the count
  is correct rather than per-machine. Two earlier limiters were not: a KV
  counter went fully open for everybody once its daily write quota was gone, and
  Cloudflare's rate limiting binding is documented as permissive and eventually
  consistent (measured against the deployed Worker before 4.2.6: a 200-request
  burst from one address drew no refusal at all). That binding is kept as the
  fallback for when the object cannot be reached, because a loose brake still
  beats failing open. Keys are the IPv4 address or the IPv6 /64, so an attacker
  with addresses across many prefixes draws a budget per prefix — the SSRF
  guard, the feed-shape check, the size cap, the drain deadline and the
  isolate-wide drain budget are what bound that. The `Origin` header is not a
  limit: it is a value the caller chooses.
- Rate limits count requests, not bytes. A per-address byte budget would mean
  charging the limiter object a second time per proxied response (the size is
  only known after the upstream is drained), doubling its calls against a
  100,000-a-day free allowance and moving the failure point to the limiter
  itself. Bytes are bounded per request (20 MB), in aggregate per isolate, by the
  drain deadline, and by the edge cache, which serves repeats without fetching.
- Rollback detection has two gaps by design. A blob from before the counter
  existed (no counter) is accepted, so replaying one is not caught; and a
  genuine server-side restore to an older row makes devices refuse it until
  someone pushes past their counter or re-pairs. The sync blob's authenticated
  data stays the version byte alone: binding a context string would make every
  existing blob fail to open, and a fallback to the old form would reopen the
  very blobs the binding was meant to exclude. The key is already unique to the
  pairing code, so a blob cannot be substituted from another pairing.
- The Windows installer is currently unsigned (SmartScreen warning expected)
  pending a code-signing certificate.
- Credential detection for private feeds is tuned for precision: it inspects
  query parameters and embedded userinfo, but not path segments, because public
  feeds legitimately carry opaque ids and UUIDs in their paths
  (`feeds.acast.com/public/shows/<uuid>`). A service that puts its token only
  in the path is therefore still proxied. Configure the Worker
  (`VITE_API_BASE`) to avoid the public proxies entirely.
- `frame-ancestors` cannot be enforced: it is ignored in a `<meta>` CSP by
  specification, and GitHub Pages cannot set response headers. The app is
  therefore framable by other origins. Putting the Worker (or any host that can
  set headers) in front of the site is the only fix.
- `connect-src` allows `https:` at large. Downloading an episode, and caching
  one while it plays, both fetch the enclosure from whichever host the feed
  names — a podcast's audio can be anywhere, so an allow-list would have to
  contain the whole podcast internet. Until 4.2.2 the directive was an
  allow-list and both features were silently blocked in production for every
  third-party host. It is no wider than `media-src` and `img-src`, which
  already accept any https origin, and the app holds no account, cookie or
  token that could be exfiltrated through it. `script-src` stays `'self'`, so
  this does not widen what can execute. The Windows shell declares its own
  policy in `desktop/src-tauri/tauri.conf.json`; it was left as an allow-list
  when the web one was widened in 4.2.2 and was brought back into line in
  4.2.4, with `tests/unit/desktop-csp.test.ts` failing if the two drift again.
- Public CORS proxies, **when the user turns them on**, see the URL of every
  *public* feed opened, and the app races three of them and parses whichever
  answers first — so any one of them can alter the XML, enclosure URLs
  included. They are off by default and exist only as a fallback for when the
  Worker is unreachable; configuring the Worker removes the third parties from
  the path entirely.
- YouTube support was removed in 4.2.0. Nothing in the app or the Worker
  contacts YouTube, Piped or Invidious any more, and the origins those needed
  are gone from both CSPs. Subscriptions saved as `yt:` ids no longer resolve
  and are skipped rather than rendered as rows that cannot open.

Reports about XSS via podcast/RSS metadata, CSP bypasses, Service Worker
cache poisoning, or Worker SSRF/validation gaps are especially appreciated.
