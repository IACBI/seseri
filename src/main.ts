import './styles/index.css';
import { boot } from './app';
import { showFatal } from './ui/fatal';

/**
 * `boot()` was called bare here, so anything it threw left the page blank with
 * no way out but devtools. Both production occurrences were a stored value it
 * could not survive (`"junk"` in `pp_settings`, a `null` inside `pp_favs`) —
 * the exact failure the recovery screen can undo.
 */
try {
  boot();
} catch (err) {
  showFatal(err);
}

// SW yalnızca production build'de: dev'de HMR ile çakışmasın.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch((err) => {
      console.warn('SW register failed', err);
    });
  });
}
