/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The CSP <meta> in index.html carries dev-only origins (the local worker at
// 127.0.0.1:8787 and the Vite HMR websocket via bare `ws:`). Strip them from
// the production HTML so they never ship. Fail loudly if a token is missing so
// a CSP edit that drops one doesn't silently disable this.
function stripDevCsp(): Plugin {
  return {
    name: 'strip-dev-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // ` ws:` is safe here: there is no `wss:` in the CSP, so this cannot
      // clip a longer scheme. ` http://127.0.0.1:8787` occurs twice
      // (media-src and connect-src); replaceAll removes both.
      for (const token of [' http://127.0.0.1:8787', ' ws:']) {
        if (!html.includes(token)) {
          throw new Error(`strip-dev-csp: expected token missing: ${token}`);
        }
        html = html.replaceAll(token, '');
      }
      return html;
    },
  };
}

export default defineConfig({
  // Live site is served from a sub-path (GitHub Pages); relative base keeps
  // the build path-independent like the legacy app.
  base: './',
  server: { port: 5199 },
  plugins: [
    stripDevCsp(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // we register manually in main.ts
      manifest: false, // public/manifest.webmanifest is authored by hand
      devOptions: { enabled: false },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
