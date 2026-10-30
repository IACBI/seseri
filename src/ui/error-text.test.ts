// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLang, langDict } from '../i18n';
import { errorText } from './error-text';

beforeEach(async () => {
  await applyLang('tr');
});

describe('errorText', () => {
  it('translates a failed fetch instead of passing the browser wording through', () => {
    // Chrome / Safari / Firefox each word this differently; all are TypeErrors.
    for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting']) {
      expect(errorText(new TypeError(message))).toBe(langDict('tr').err_network);
    }
    expect(errorText(new Error('fetch failed'))).toBe(langDict('tr').err_network);
  });

  it('translates an unreadable body', () => {
    for (const message of ['invalid rss', 'invalid api response', 'empty response']) {
      expect(errorText(new Error(message))).toBe(langDict('tr').err_response);
    }
    expect(errorText(new SyntaxError('Unexpected token < in JSON'))).toBe(
      langDict('tr').err_response,
    );
  });

  it('reads an abort as a timeout', () => {
    expect(errorText(new DOMException('aborted', 'AbortError'))).toBe(langDict('tr').err_timeout);
  });

  it('keeps an HTTP status as it is', () => {
    expect(errorText(new Error('HTTP 503'))).toBe('HTTP 503');
  });

  it('keeps a failure it does not recognise', () => {
    expect(errorText(new Error('quota exceeded'))).toBe('quota exceeded');
    expect(errorText('plain string')).toBe('plain string');
  });
});
