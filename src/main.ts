import './styles/tokens.css';
import './styles/themes.css';
import './styles/base.css';
import './styles/components.css';
import { boot } from './app';

boot();

// SW yalnızca production build'de: dev'de HMR ile çakışmasın.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch((err) => {
      console.warn('SW register failed', err);
    });
  });
}
