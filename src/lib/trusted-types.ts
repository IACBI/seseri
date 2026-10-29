/**
 * Trusted Types, enforced by the CSP (`require-trusted-types-for 'script'`).
 *
 * The XSS invariant in CONTRIBUTING.md says `innerHTML` only ever receives
 * constant markup. This turns that rule into one the browser checks: every HTML
 * sink goes through the default policy below, which refuses anything carrying
 * script-capable constructs. Constant markup never does, so nothing changes for
 * the app; a future slip that hands feed data to `innerHTML` throws instead of
 * rendering it.
 *
 * `DOMParser` is the exception: show notes are parsed into a detached document
 * that never executes or renders, and their HTML legitimately contains anything.
 * Browsers without Trusted Types (Firefox, Safari) ignore all of this; the CSP's
 * `script-src 'self'` still applies there.
 */

const RISKY = /<\s*\/?\s*(script|iframe|object|embed|base|meta|link|frame|frameset|form)\b|\son[a-z]+\s*=|javascript:/i;

/** True when markup could run script or change where the page loads from. */
export function unsafeMarkup(html: string): boolean {
  return RISKY.test(html);
}

/** Script URLs: only this origin's service worker is ever loaded by URL. */
export function allowedScriptUrl(url: string, base: string): boolean {
  try {
    const u = new URL(url, base);
    return u.origin === new URL(base).origin && u.pathname.endsWith('/sw.js');
  } catch {
    return false;
  }
}

interface TrustedTypePolicyFactoryLike {
  createPolicy(
    name: string,
    rules: {
      createHTML?: (input: string, type: string, sink: string) => string;
      createScriptURL?: (input: string) => string;
    },
  ): unknown;
}

function install(): void {
  const tt = (globalThis as { trustedTypes?: TrustedTypePolicyFactoryLike }).trustedTypes;
  if (!tt) return;
  try {
    tt.createPolicy('default', {
      createHTML(input, _type, sink) {
        if (sink.startsWith('DOMParser') || !unsafeMarkup(input)) return input;
        throw new TypeError('Trusted Types: markup with script-capable content refused');
      },
      createScriptURL(input) {
        if (allowedScriptUrl(input, location.href)) return input;
        throw new TypeError('Trusted Types: script URL refused');
      },
    });
  } catch {
    // A second evaluation (HMR) finds the policy already there, which is fine.
  }
}

install();
