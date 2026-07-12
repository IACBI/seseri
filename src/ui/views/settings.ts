/**
 * Settings view — playback, appearance (theme + accent swatches from
 * theme.ts ACCENT_SWATCHES), list, language, data sections.
 * WP-0 STUB: WP-F ports the legacy panel
 * (`git show ed59840:src/ui/screens/settings.ts` + the SETTINGS_PANEL markup
 * in `git show ed59840:src/ui/shell.ts`) behind this exact signature.
 * MUST keep writing --player-font-size / --list-row-height on documentElement.
 * Keep the legacy element IDs: s_defaultSpeed, s_skipBack, s_skipForward,
 * s_autoNext, s_resumePos, s_fontSize, s_rowHeight, s_theme, s_defaultSort,
 * s_showDl, s_lang, colorSwatches, storageUsage, btnOpmlExport, btnOpmlImport,
 * btnJsonExport, btnClearDownloads, btnClearProgress, btnClearAll, opmlFile.
 */

import { registerView, viewEl, type View } from '../views';

export interface SettingsViewDeps {
  onDataCleared(): void;
}

export function initSettingsView(deps: SettingsViewDeps): View {
  void deps;
  const el = viewEl('settings');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="settings_heading">Ayarlar</h1>
      <div class="empty-state" data-i18n="loading_eps">Yükleniyor...</div>
    </div>`;

  const view: View = { name: 'settings', el };
  registerView(view);
  return view;
}
