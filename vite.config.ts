/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
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

/**
 * Preload the two Latin faces the first paint uses. They are referenced only
 * from CSS `url()`, so the browser finds them after the stylesheet is parsed and
 * the text swaps fonts after first paint; the hashed names exist only in the
 * bundle, hence a plugin rather than a tag in index.html.
 */
function preloadFonts(faces: string[]): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {});
        return faces.map((face) => {
          // The hash is exactly 8 characters, so `-latin-ext-…` cannot match.
          const re = new RegExp(`^assets/${face}-[\\w-]{8}\\.woff2$`);
          const href = files.find((f) => re.test(f));
          if (!href) throw new Error(`preload-fonts: no bundled file for ${face}`);
          return {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href },
            injectTo: 'head' as const,
          };
        });
      },
    },
  };
}

const pkgVersion: string = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  // Read from package.json rather than hand-maintained: the release checklist
  // bumps that file, and a version the app reports wrongly is worse than none.
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  // Live site is served from a sub-path (GitHub Pages); relative base keeps
  // the build path-independent like the legacy app.
  base: './',
  server: { port: 5199 },
  plugins: [
    stripDevCsp(),
    preloadFonts(['schibsted-grotesk-latin', 'bricolage-grotesque-latin']),
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
        // Store screenshots and the 512px icons are read only by the install
        // UI, from the network; precaching them doubled the install download.
        globIgnores: ['screenshots/**', 'icons/*-512.png'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
