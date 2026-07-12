import { t, currentLang } from '../i18n';

const dateCache = new Map<string, string>();

// Locale-formatted dates change with the language — drop the cache on switch.
currentLang.subscribe(() => dateCache.clear());

export function fmtDate(s: string): string {
  if (!s) return '';
  const hit = dateCache.get(s);
  if (hit !== undefined) return hit;
  try {
    const r = new Date(s).toLocaleDateString(currentLang(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (dateCache.size >= 500) {
      const first = dateCache.keys().next().value;
      if (first !== undefined) dateCache.delete(first);
    }
    dateCache.set(s, r);
    return r;
  } catch {
    return '';
  }
}

export function fmtDur(ms: number): string {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}${t('dur_h')} ${String(m).padStart(2, '0')}${t('dur_m')}` : `${m}${t('dur_m')}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
