// First, before any module can touch an HTML sink.
import './lib/trusted-types';
import './styles/index.css';
import { boot } from './app';
import { isLangCode, loadLang } from './i18n';
import { showFatal } from './ui/fatal';

/**
 * `boot()` was called bare here, so anything it threw left the page blank with
 * no way out but devtools. Both production occurrences were a stored value it
 * could not survive (`"junk"` in `pp_settings`, a `null` inside `pp_favs`) —
 * the exact failure the recovery screen can undo.
 */
function start(): void {
  try {
    boot();
  } catch (err) {
    showFatal(err);
  }
}

/**
 * A saved language outside the main chunk is fetched before the first paint,
 * or the shell would flash in the fallback and then re-render. Read raw: the
 * settings loader runs inside `boot`, and a bad value here only means no
 * preload.
 */
function savedLang(): string | null {
  try {
    const lang = (JSON.parse(localStorage.getItem('pp_settings') ?? 'null') as { lang?: unknown })
      ?.lang;
    return typeof lang === 'string' ? lang : null;
  } catch {
    return null;
  }
}

/**
 * GitHub Pages cannot send `frame-ancestors`, and the CSP <meta> cannot carry
 * it, so another site could frame the app and steer clicks onto its reset or
 * sync controls. Framed, it offers only a link to open itself.
 */
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function offerTopLevel(): void {
  const a = document.createElement('a');
  a.href = location.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'Seseri ↗';
  a.className = 'framed-open';
  document.body.replaceChildren(a);
}

const lang = savedLang();
if (framed()) {
  offerTopLevel();
} else if (lang && isLangCode(lang)) {
  void loadLang(lang).then(start, start);
} else {
  start();
}

// SW yalnızca production build'de: dev'de HMR ile çakışmasın.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch((err) => {
      console.warn('SW register failed', err);
    });
  });
}
