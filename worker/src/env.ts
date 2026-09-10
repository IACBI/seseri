/**
 * Workers Rate Limiting binding.
 *
 * Declared here rather than pulled from generated runtime types so the strict
 * build does not depend on a `wrangler types` step nobody runs.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  /** Per-client-prefix budget for the feed and iTunes proxies. */
  PROXY_IP: RateLimiter;
  /** Per-client-prefix budget for the sync routes. */
  SYNC_IP: RateLimiter;
  /** Per-code budget: one leaked code cannot be hammered from many addresses. */
  SYNC_ID: RateLimiter;
  /** "1" makes every sync route answer 503 without a client deploy. */
  SYNC_DISABLED?: string;
}

export type AppContext = { Bindings: Env };
