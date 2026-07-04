import { applyLang, isLangCode } from '../../i18n';
import { clearProgress, saveProgressNow } from '../../storage/progress';
import { local } from '../../storage/local';
import { settings, setSetting, type Settings, type SortDir, type ThemeName } from '../../state/settings';
import { pbSetRate } from '../../player/engine';
import { t } from '../../i18n';
import { applyAccent, applyTheme } from '../theme';
import { must } from '../shell';

export interface SettingsPanel {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function initSettingsPanel(opts: { onDataCleared: () => void }): SettingsPanel {
  const overlay = must('settingsOverlay');
  const panel = must('settingsPanel');

  const sSpeed = must<HTMLSelectElement>('s_defaultSpeed');
  const sSkipBack = must<HTMLSelectElement>('s_skipBack');
  const sSkipFwd = must<HTMLSelectElement>('s_skipForward');
  const sAutoNext = must<HTMLInputElement>('s_autoNext');
  const sResume = must<HTMLInputElement>('s_resumePos');
  const sFontSize = must<HTMLSelectElement>('s_fontSize');
  const sRowHeight = must<HTMLSelectElement>('s_rowHeight');
  const sTheme = must<HTMLSelectElement>('s_theme');
  const sSort = must<HTMLSelectElement>('s_defaultSort');
  const sShowDl = must<HTMLInputElement>('s_showDl');
  const sLang = must<HTMLSelectElement>('s_lang');

  function syncInputs(S: Settings): void {
    sSpeed.value = String(S.defaultSpeed);
    sSkipBack.value = String(S.skipBack);
    sSkipFwd.value = String(S.skipForward);
    sAutoNext.checked = S.autoNext;
    sResume.checked = S.resumePos;
    sFontSize.value = S.fontSize;
    sRowHeight.value = S.rowHeight;
    sTheme.value = S.theme;
    sSort.value = S.defaultSort;
    sShowDl.checked = S.showDl;
    sLang.value = S.lang;
    document.querySelectorAll<HTMLElement>('.s-color-swatch').forEach((sw) => {
      sw.classList.toggle('active', sw.dataset.color === S.accentColor);
    });
  }

  function applySide(S: Settings): void {
    document.documentElement.style.setProperty('--player-font-size', S.fontSize);
    document.documentElement.style.setProperty('--list-row-height', S.rowHeight);
  }

  function open(): void {
    syncInputs(settings());
    overlay.classList.add('open');
    panel.classList.add('open');
    document.body.classList.add('settings-open');
  }
  function close(): void {
    overlay.classList.remove('open');
    panel.classList.remove('open');
    document.body.classList.remove('settings-open');
  }

  // ── wiring ───────────────────────────────────────────────────────
  sSpeed.addEventListener('change', () => {
    const v = parseFloat(sSpeed.value) || 1;
    setSetting('defaultSpeed', v);
    pbSetRate(v);
  });
  sSkipBack.addEventListener('change', () => setSetting('skipBack', parseInt(sSkipBack.value) || 15));
  sSkipFwd.addEventListener('change', () => setSetting('skipForward', parseInt(sSkipFwd.value) || 30));
  sAutoNext.addEventListener('change', () => setSetting('autoNext', sAutoNext.checked));
  sResume.addEventListener('change', () => setSetting('resumePos', sResume.checked));
  sFontSize.addEventListener('change', () => {
    setSetting('fontSize', sFontSize.value);
    applySide(settings());
  });
  sRowHeight.addEventListener('change', () => {
    setSetting('rowHeight', sRowHeight.value);
    applySide(settings());
  });
  sTheme.addEventListener('change', () => {
    setSetting('theme', sTheme.value as ThemeName);
    applyTheme(settings().theme);
  });
  sSort.addEventListener('change', () => setSetting('defaultSort', sSort.value as SortDir));
  sShowDl.addEventListener('change', () => setSetting('showDl', sShowDl.checked));
  sLang.addEventListener('change', () => {
    if (isLangCode(sLang.value)) {
      setSetting('lang', sLang.value);
      applyLang(sLang.value);
    }
  });

  const swatches = must('colorSwatches');
  swatches.addEventListener('click', (e) => {
    const sw = (e.target as HTMLElement).closest<HTMLElement>('.s-color-swatch');
    if (!sw?.dataset.color) return;
    document.querySelectorAll('.s-color-swatch').forEach((s) => s.classList.remove('active'));
    sw.classList.add('active');
    setSetting('accentColor', sw.dataset.color);
    applyAccent(sw.dataset.color);
  });
  swatches.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const sw = (e.target as HTMLElement).closest<HTMLElement>('.s-color-swatch');
    if (sw) {
      e.preventDefault();
      sw.click();
    }
  });

  must('btnClearProgress').addEventListener('click', () => {
    if (!confirm(t('confirm_clear_progress'))) return;
    clearProgress();
    opts.onDataCleared();
  });
  must('btnClearAll').addEventListener('click', () => {
    if (!confirm(t('confirm_clear_all'))) return;
    saveProgressNow();
    local.clear();
    location.reload();
  });

  must('settingsClose').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });

  // First paint of side-effect settings
  applySide(settings());

  return { open, close, isOpen: () => panel.classList.contains('open') };
}
