import { t } from '../i18n';

/**
 * The reason a load failed, in the reader's language, for the text that follows
 * "Error: ".
 *
 * The raw `Error.message` used to be appended as it came: a Turkish reader saw
 * "Hata: Failed to fetch" (Chrome's wording — Safari says "Load failed",
 * Firefox something longer), or "invalid rss". An HTTP status is left as it is,
 * because "HTTP 503" means the same thing in every language and is what
 * someone filing a bug needs; anything unrecognised also stays as it came, so
 * a new failure is never reduced to a vague sentence.
 *
 * An `AbortError` is read as a timeout. Callers filter out the aborts they
 * made themselves (the reader moving on) before they get here.
 */
export function errorText(e: unknown): string {
  const err = e as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof err?.name === 'string' ? err.name : '';
  const message = typeof err?.message === 'string' ? err.message : String(e);
  if (name === 'AbortError' || name === 'TimeoutError') return t('err_timeout');
  if (/^HTTP \d{3}$/.test(message)) return message;
  if (
    name === 'SyntaxError' ||
    /^(invalid rss|invalid api response|empty response)$/.test(message)
  ) {
    return t('err_response');
  }
  if (name === 'TypeError' || message === 'fetch failed') return t('err_network');
  return message;
}
