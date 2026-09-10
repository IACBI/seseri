/**
 * Per-client budgets, counted in a Durable Object.
 *
 * Two limiters were tried before this one and both leaked.
 *
 * A KV counter spent one write per request — before it compared anything, so
 * even the requests it refused paid — out of a free-tier budget of 1000 writes
 * a day for the whole account. Roughly a thousand requests exhausted it, every
 * write after that failed into a swallowed `catch`, and the counter froze at
 * zero: the limiter allowed everything, on every route, until 00:00 UTC.
 *
 * The platform rate limiting binding cannot be starved like that, but
 * Cloudflare documents it as "permissive, eventually consistent, and
 * intentionally designed to not be used as an accurate accounting system",
 * with a separate counter per location and per machine. Measured against the
 * deployed worker: a 200-request burst from one address drew no refusal at all,
 * because the colo spread it across machines that each stayed under the limit.
 *
 * A Durable Object is one instance per key, globally, single-threaded — so the
 * count is simply correct. Two things keep it cheap:
 *
 *   - The instance is addressed by the client's own key, so Cloudflare places
 *     it near whoever created it: a caller's requests reach their own counter
 *     over a short hop, and a flood is already next to its own instance.
 *   - A refusal is remembered in the isolate that received it, so refused
 *     traffic stops touching the object until its window rolls over. The
 *     expensive path is the legitimate request, and there are 60 of those a
 *     minute; the cheap path is the millionth request of a flood.
 *
 * The free plan gives Durable Objects 100,000 requests a day — the same number
 * the Worker itself gets, and only allowed requests reach the object, so the
 * limiter cannot run out before the thing it protects does. Its other budget is
 * duration (13,000 GB-s/day, and an instance sleeps ~10 s after its last
 * request), which a sustained flood on one key can eat; that flood exhausts the
 * Worker's own daily requests long before, and if it does happen the fallback
 * below catches it.
 *
 * The platform limiter stays as the fallback: if the object cannot be reached,
 * a loose brake is still better than the fail-open the KV counter had.
 */
import { DurableObject } from 'cloudflare:workers';
import { parseIpv6 } from './safe-fetch';
import type { RateLimiter } from './env';

const WINDOW_MS = 60_000;

/**
 * One instance per key. The count lives in memory and is never written to
 * storage: a counter that survives eviction is not worth a write per request,
 * and an instance only goes idle once the traffic it is counting has stopped —
 * which is exactly when forgetting is the right answer.
 *
 * The window slides rather than resetting on a boundary. A fixed window lets a
 * caller spend the whole budget at 0:59 and the whole budget again at 1:01;
 * weighting the previous window by how much of it is still in view costs one
 * multiplication and removes the doubling.
 */
export class RateLimiterDO extends DurableObject {
  #bucket = 0;
  #prev = 0;
  #cur = 0;

  /**
   * Counts one request against `limit` per minute. Returns 0 when the caller is
   * within budget, otherwise the milliseconds after which it is worth trying
   * again. A refused request is not counted — otherwise a caller that keeps
   * hammering could never come back under the limit.
   */
  take(limit: number): number {
    const now = Date.now();
    const bucket = Math.floor(now / WINDOW_MS);
    if (bucket !== this.#bucket) {
      this.#prev = bucket === this.#bucket + 1 ? this.#cur : 0;
      this.#cur = 0;
      this.#bucket = bucket;
    }
    const elapsed = now % WINDOW_MS;
    const estimate = this.#prev * (1 - elapsed / WINDOW_MS) + this.#cur;
    if (estimate >= limit) return WINDOW_MS - elapsed;
    this.#cur++;
    return 0;
  }
}

/**
 * IPv6 collapses to its /64 — the standard end-site allocation, so a household
 * keeps one budget while one host can no longer mint its own. A single machine
 * picks whatever interface id it likes inside that /64, so counting per literal
 * address handed a client that counted up 2^64 free budgets. IPv4 stays
 * literal: a /24 would put unrelated CGNAT customers in one bucket, and
 * rotating IPv4 needs a proxy pool rather than the address the client owns.
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

/**
 * Keys this isolate has been told to refuse, and until when. Bounded, so a
 * flood spread across many keys cannot grow it without limit; the cap is far
 * above the number of distinct clients one isolate serves in a minute.
 */
const MAX_REMEMBERED = 4096;
const refuseUntil = new Map<string, number>();

function remember(key: string, until: number): void {
  if (refuseUntil.size >= MAX_REMEMBERED) {
    const now = Date.now();
    for (const [k, t] of refuseUntil) if (t <= now) refuseUntil.delete(k);
    // Still full: every entry is live, so drop the oldest insertion for room.
    if (refuseUntil.size >= MAX_REMEMBERED) {
      const oldest = refuseUntil.keys().next().value;
      if (oldest !== undefined) refuseUntil.delete(oldest);
    }
  }
  refuseUntil.set(key, until);
}

/**
 * True when `key` has spent its budget. `name` separates the budgets: the
 * proxies, sync's per-address budget and sync's per-code budget each count in
 * their own instance.
 */
export async function rateLimited(
  limiters: DurableObjectNamespace<RateLimiterDO>,
  fallback: RateLimiter,
  name: string,
  key: string,
  limit: number,
): Promise<boolean> {
  const id = `${name}:${key}`;
  const now = Date.now();
  const until = refuseUntil.get(id);
  if (until !== undefined) {
    if (until > now) return true;
    refuseUntil.delete(id);
  }

  try {
    const stub = limiters.get(limiters.idFromName(id));
    const retryAfterMs = await stub.take(limit);
    if (retryAfterMs <= 0) return false;
    remember(id, now + retryAfterMs);
    return true;
  } catch (e) {
    // Reaching the object is the one thing here that can fail, and it must not
    // fail open the way the KV counter did.
    console.error('rate limiter unreachable:', (e as Error).message);
    const verdict = await fallback.limit({ key: id }).catch(() => ({ success: true }));
    return !verdict.success;
  }
}
