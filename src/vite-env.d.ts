/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** "1" enables cross-device sync. Separate from VITE_API_BASE so sync can be
   *  switched off without also killing the feed and iTunes proxies. */
  readonly VITE_SYNC?: string;
}

/**
 * Version from package.json, injected by vite.config.ts. Used by the
 * crash-recovery screen and the Settings diagnostics block, so a bug report
 * says which build it came from.
 */
declare const __APP_VERSION__: string;
