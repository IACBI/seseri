/**
 * Per-client budget for the proxy routes, on the platform rate limiting
 * binding.
 *
 * It used to be a KV counter, and KV made it leak in two directions.
 *
 * The counter spent one KV write per request — before it compared anything, so
 * even the requests it refused paid — out of a free-tier budget of 1000 writes
 * a day for the whole account. Roughly a thousand requests exhausted it, and
 * every write after that failed into a swallowed `catch`, leaving the counter
 * frozen at zero: the limiter stopped limiting anybody, on every route,
 * silently, until the quota reset at 00:00 UTC. Sync already answered that with
 * the platform limiter; the proxies now use the same one, so nothing in the
 * request path spends a KV write at all.
 *
 * The key is the client's network prefix, not its literal address. A single
 * IPv6 host chooses its own interface id inside its /64, so per-address
 * counting handed a client that changed the last four groups a fresh budget on
 * every request — 2^64 of them, for free.
 */
import { parseIpv6 } from './safe-fetch';
import type { RateLimiter } from './env';

/**
 * IPv6 collapses to its /64 — the standard end-site allocation, so a household
 * keeps one budget while one host can no longer mint its own. IPv4 stays
 * literal: a /24 would put unrelated CGNAT customers in the same bucket, and
 * rotating IPv4 needs a proxy pool rather than the address the client already
 * owns.
 */
export function clientKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const groups = parseIpv6(ip.replace(/^\[|\]$/g, ''));
  if (!groups) return ip;
  return (
    groups
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(':') + '::/64'
  );
}

export async function rateLimited(limiter: RateLimiter, ip: string): Promise<boolean> {
  // The edge sets `cf-connecting-ip` on every request it routes and overwrites
  // whatever the client sent, so an empty one means a local `wrangler dev` or a
  // test rather than a caller who managed to hide.
  if (!ip) return false;
  return !(await limiter.limit({ key: clientKey(ip) })).success;
}
