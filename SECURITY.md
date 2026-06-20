# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.
Instead, use GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository page) or contact the
maintainer directly.

You can expect an initial response within a week.

## Scope

This is a fully client-side application:

- No backend, no accounts, no cookies — all data stays in `localStorage`.
- External requests go only to `itunes.apple.com` (search/lookup),
  `api.allorigins.win` / `corsproxy.io` (CORS proxies for RSS feeds and as an
  iTunes fallback), Google Fonts, and the podcast hosts' own audio CDNs.
- A Content Security Policy is declared in `index.html`; all dynamic content
  is HTML-escaped before insertion.

Reports about XSS via podcast/RSS metadata, CSP bypasses, or Service Worker
cache poisoning are especially appreciated.
