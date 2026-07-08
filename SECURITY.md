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
  optional Seseri Worker, public CORS proxies (allorigins/codetabs/corsproxy),
  Piped/Invidious instances, Google Fonts, and podcast hosts' own CDNs. A
  strict Content Security Policy (no `'unsafe-inline'` scripts) is declared in
  `index.html`; remote data is only inserted through a typed DOM builder.
- **Worker (`worker/`):** a stateless proxy on Cloudflare. It enforces an
  SSRF guard on user-supplied URLs (re-validated on every redirect hop —
  redirects are followed manually, max 3 hops, and each `Location` target must
  pass the same private-host checks), response size caps, a CORS origin
  allowlist and per-IP rate limiting; it stores no user data.

## Known residual risks

- The SSRF guard is hostname-based; it cannot resolve DNS, so a hostname that
  *resolves* to a private address (DNS-rebinding style) is not fully
  preventable inside Workers. Cloudflare's own egress restrictions on
  RFC 1918 space mitigate this in practice.
- The Windows installer is currently unsigned (SmartScreen warning expected)
  pending a code-signing certificate.

Reports about XSS via podcast/RSS metadata, CSP bypasses, Service Worker
cache poisoning, or Worker SSRF/validation gaps are especially appreciated.
