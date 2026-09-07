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
  pass the same private-host checks), response size caps, an app-origin
  requirement so the proxy endpoints cannot be used as an open proxy, and
  per-IP rate limiting; it stores no user data. The SSRF check parses
  addresses rather than pattern-matching them, so IPv4-mapped IPv6
  (`::ffff:169.254.169.254`), the unspecified address, CGNAT `100.64/10`,
  link-local and NAT64-embedded private addresses are all rejected.
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
- **Rate limiting** is per IP and per hashed sync id, using the platform rate
  limiting binding rather than the KV counter the proxies use.
- Blobs are capped at 128 KiB, never cached (`cache-control: no-store`, and the
  service worker skips the route), and rows untouched for 180 days are swept.

## Known residual risks

- The SSRF guard is hostname-based; it cannot resolve DNS, so a hostname that
  *resolves* to a private address (DNS-rebinding style) is not fully
  preventable inside Workers. Cloudflare's own egress restrictions on
  RFC 1918 space mitigate this in practice.
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
  this does not widen what can execute.
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
