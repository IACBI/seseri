import { applyLang, isLangCode } from '../../i18n';
import { clearAllDownloads, storageInfo } from '../../player/offline';
import { clearProgress, saveProgressNow } from '../../storage/progress';
import { local } from '../../storage/local';
import { exportOpml, parseOpml } from '../../storage/opml';
import { subscriptions, toggleSubscription, isSubscribed } from '../../storage/subscriptions';
import { toast } from '../toast';
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
  const panel = must<HTMLDialogElement>('settingsPanel');

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

  function fmtBytes(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
    return n + ' B';
  }

  async function refreshStorageUsage(): Promise<void> {
    const el = must('storageUsage');
    const info = await storageInfo();
    el.textContent =
      t('storage_usage', fmtBytes(info.usageBytes), fmtBytes(info.quotaBytes)) +
      (info.downloadCount ? ` · ${info.downloadCount} ⤓ ${fmtBytes(info.downloadBytes)}` : '');
  }

  // Native <dialog>: modal focus trap + Esc for free; the slide animation is
  // driven by the .open class, so close() waits for the transition to finish.
  function open(): void {
    if (panel.open) return;
    syncInputs(settings());
    panel.showModal();
    requestAnimationFrame(() => panel.classList.add('open'));
    document.body.classList.add('settings-open');
    void refreshStorageUsage();
  }
  function close(): void {
    if (!panel.open) return;
    panel.classList.remove('open');
    document.body.classList.remove('settings-open');
    setTimeout(() => panel.close(), 440);
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

  // ── data section ─────────────────────────────────────────────────
  function saveFile(name: string, mime: string, content: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  must('btnOpmlExport').addEventListener('click', () => {
    saveFile('seseri-subscriptions.opml', 'text/x-opml', exportOpml(subscriptions()));
  });

  const opmlFile = must<HTMLInputElement>('opmlFile');
  must('btnOpmlImport').addEventListener('click', () => opmlFile.click());
  opmlFile.addEventListener('change', () => {
    const f = opmlFile.files?.[0];
    opmlFile.value = '';
    if (!f) return;
    void f.text().then((xml) => {
      try {
        const entries = parseOpml(xml);
        let added = 0;
        for (const e of entries) {
          if (!isSubscribed(e.id)) {
            toggleSubscription({ id: e.id, name: e.name, artist: '', art: '' });
            added++;
          }
        }
        toast(t('opml_imported', added));
      } catch {
        toast(t('opml_invalid'), 'error');
      }
    });
  });

  must('btnJsonExport').addEventListener('click', () => {
    const dump: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const key of ['pp_settings', 'pp_favs', 'pp_prog']) {
      dump[key] = local.get(key, null);
    }
    saveFile('seseri-backup.json', 'application/json', JSON.stringify(dump, null, 2));
  });

  must('btnClearDownloads').addEventListener('click', () => {
    void clearAllDownloads().then(() => {
      toast(t('dl_removed'));
      void refreshStorageUsage();
    });
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
  // Clicks on the ::backdrop land outside the panel's box
  panel.addEventListener('click', (e) => {
    const r = panel.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      close();
    }
  });
  panel.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: run the animated close instead of snapping shut
    close();
  });

  // First paint of side-effect settings
  applySide(settings());

  return { open, close, isOpen: () => panel.open };
}
