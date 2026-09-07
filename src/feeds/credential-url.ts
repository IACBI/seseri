/**
 * Detects feed URLs that carry a subscriber credential.
 *
 * NOTE: `src/feeds/credential-url.ts` and `worker/src/credential-url.ts` are
 * kept byte-identical — the client uses this to decide what may reach a public
 * proxy, the Worker to decide what may reach the shared edge cache, and the two
 * answers must never disagree. They are duplicated rather than shared because
 * the Worker is a separate npm package with its own tsconfig, and a
 * cross-package import would drag the client build graph into it.
 * `credential-url.test.ts` fails if they drift.
 *
 * Private podcast services (Patreon, Memberful, Substack, Supercast …) put the
 * listener's token in the feed URL itself. Handing such a URL to a public CORS
 * proxy discloses that credential to a third-party operator — on every feed
 * open and every refresh. Those URLs must only ever go to our own backend.
 *
 * Tuned for precision, not recall: a false positive refuses to load a feed that
 * actually works, which is worse for the user than the residual leak. So this
 * matches credential-looking *query* data and embedded userinfo only, and
 * deliberately does not guess at path segments — public feeds legitimately carry
 * UUIDs in their paths (`feeds.acast.com/public/shows/<uuid>`), so a
 * path-token rule would break them. That gap is recorded in SECURITY.md.
 */

const SECRET_PARAM =
  /^(auth|authorization|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|key|secret|password|passwd|pwd|sig|signature|hmac|jwt|session|session[_-]?id|feed[_-]?token|user[_-]?token|subscriber[_-]?id|member[_-]?id|pass|credential)$/i;

/** Token-ish enough to be a credential rather than a slug or a numeric id. */
function looksOpaque(v: string): boolean {
  if (v.length < 24) return false;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(v)) return false;
  // A dash-separated word slug is a title, not a secret.
  if (/^[a-z]+(-[a-z]+)+$/.test(v)) return false;
  const hasDigit = /\d/.test(v);
  const hasAlpha = /[A-Za-z]/.test(v);
  const mixedCase = /[a-z]/.test(v) && /[A-Z]/.test(v);
  return (hasDigit && hasAlpha) || mixedCase || /^[0-9a-f]{24,}$/i.test(v);
}

/** True when the URL embeds something that must not reach a third party. */
export function carriesCredential(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return true;
  for (const [name, value] of u.searchParams) {
    if (SECRET_PARAM.test(name.trim())) return true;
    if (looksOpaque(value)) return true;
  }
  return false;
}

/**
 * Thrown instead of leaking. Recognised by the UI so it can explain that the
 * feed needs the app's own backend rather than showing a generic failure.
 */
export const PRIVATE_FEED_ERROR = 'private-feed';
