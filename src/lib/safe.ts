/**
 * Only https URLs may reach media/img elements (feeds are untrusted);
 * matches the CSP and avoids mixed-content / javascript: surprises.
 */
export function httpsOnly(u: string | undefined | null): string {
  return /^https:\/\//i.test(u || '') ? (u as string) : '';
}
