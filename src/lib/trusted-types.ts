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

const RISKY_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'base',
  'meta',
  'link',
  'frame',
  'frameset',
  'form',
]);

/**
 * Browsers drop ASCII whitespace and control characters anywhere in a URL
 * scheme, so `java\tscript:` runs. Attribute values arrive here already
 * entity-decoded by the parser, which is what catches `java&#x73;cript:`.
 */
const SCRIPT_SCHEME = /^(javascript|vbscript):/;

function schemeOf(value: string): string {
  let out = '';
  for (const ch of value) if (ch.charCodeAt(0) > 0x20) out += ch;
  return out.toLowerCase();
}

/**
 * The regex alone is a blacklist over text, and HTML has more ways to spell a
 * handler than a pattern can enumerate: `<svg/onload=…>` (no space before
 * `on`) and an entity-encoded `javascript:` both passed it. So the markup is
 * also parsed, and the verdict is taken from what the parser actually built —
 * every element name, every attribute name, every decoded attribute value.
 * The regex stays in front: it is cheap, and it covers the parts a body-context
 * parse can read differently from the sink's own context.
 */
function unsafeTree(html: string): boolean {
  if (typeof DOMParser === 'undefined') return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const roots: ParentNode[] = [doc];
  while (roots.length) {
    const root = roots.pop() as ParentNode;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (RISKY_TAGS.has(el.localName.toLowerCase())) return true;
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) return true;
        if (SCRIPT_SCHEME.test(schemeOf(attr.value))) return true;
      }
      // A template's children live in a separate fragment that querySelectorAll
      // does not enter.
      if (el instanceof HTMLTemplateElement) roots.push(el.content);
    }
  }
  return false;
}

/** True when markup could run script or change where the page loads from. */
export function unsafeMarkup(html: string): boolean {
  return RISKY.test(html) || unsafeTree(html);
}

/**
 * Every legitimate input is one of a few dozen constants, rendered again on
 * each view mount; parsing them once is enough. Bounded so that a caller
 * feeding it runtime strings cannot grow it without limit.
 */
const APPROVED_MAX = 256;
const approved = new Set<string>();

function approve(html: string): boolean {
  if (approved.has(html)) return true;
  if (unsafeMarkup(html)) return false;
  if (approved.size < APPROVED_MAX) approved.add(html);
  return true;
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
        // The DOMParser exemption also covers unsafeTree's own parse, which
        // re-enters this policy.
        if (sink.startsWith('DOMParser') || approve(input)) return input;
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
