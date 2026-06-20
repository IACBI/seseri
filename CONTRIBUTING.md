# Contributing

Thanks for your interest! This is a deliberately simple project: one HTML file,
no build step, no dependencies.

## Getting started

```bash
git clone https://github.com/IACBI/seseri.git
cd seseri
python -m http.server 8080   # or: npx serve .
```

Open `http://localhost:8080` and start hacking on `index.html`.

## Guidelines

- **Keep it dependency-free.** No frameworks, no npm packages, no build tools.
- **Single file.** App logic, styles and markup live in `index.html`; only the
  Service Worker (`sw.js`) and the manifest are separate.
- **i18n.** Any user-visible string must be added to **all 8 languages** in the
  `LANGS` object (TR, EN, DE, FR, ES, AR, JA, RU). Machine translation is fine;
  mark uncertain ones in the PR description.
- **Security.** All dynamic content inserted via `innerHTML` must go through
  `esc()`. Keep the CSP `<meta>` tag in sync with any new external origin.
- **PWA.** If you change cached assets, bump the `CACHE` version in `sw.js`.

## Pull requests

1. Fork, create a branch, make your change.
2. Test locally in at least one Chromium browser and one of Firefox/Safari.
3. Describe **what** and **why** in the PR; screenshots welcome for UI changes.

## Reporting bugs

Open a GitHub issue with steps to reproduce, expected vs. actual behavior,
and your browser/OS. For security issues see [SECURITY.md](SECURITY.md).
